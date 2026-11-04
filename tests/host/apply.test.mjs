import test from 'node:test';
import assert from 'node:assert/strict';

import { apply, inject, name } from '../../index.js';
import {
    callWaterfall, createFakeAgent, createFakeCtx, createFakeProjections, listenerFor,
} from '../support/fake-host.mjs';

const OVERRIDE = { childSessionId: 'child-1', provider: 'provider-a', model: 'model-x', reasoningEffort: 'high' };

function boot({
    overrides = [],
    configShape = 'raw',
    agentOptions = {},
    projections = undefined,
    agents = undefined,
} = {}) {
    const built = createFakeAgent(agentOptions);
    const projectionsService = projections === undefined
        ? createFakeProjections({ values: { subagent: agentOptions.subagent ?? { mode: 'continuable' } } })
        : projections;
    const services = { agents: { list: () => agents ?? [built.agent] } };
    if (projectionsService !== null) services.sessionProjections = projectionsService;
    const fake = createFakeCtx({ services });
    const config = configShape === 'accessor' ? { overrides: { get: () => overrides } } : { overrides };
    apply(fake.ctx, config);
    return { ...built, ...fake };
}

/** `agentListeners` is keyed by event; what matters is how many handlers remain. */
const handlers = (agentListeners) => [...agentListeners.values()].reduce((total, list) => total + list.length, 0);

test('module ABI: name and the declared service dependency', () => {
    assert.equal(name, 'teammate-model-picker');
    assert.deepEqual(inject, ['agents']);
});

test('I-1: with no override the plugin registers nothing at all', () => {
    const { agentListeners, appended, log } = boot();
    assert.equal(agentListeners.size, 0);
    assert.equal(appended.length, 0);
    assert.equal(log.info.length, 0);
});

test('I-2: only the documented services are ever read', () => {
    const { getCalls } = boot({ overrides: [OVERRIDE] });
    for (const call of getCalls) {
        assert.ok(['agents', 'sessionProjections'].includes(call), `unexpected service read: ${call}`);
    }
});

test('an override installs the three waterfalls and records the intent once', async () => {
    const { agent, appended, agentListeners, log } = boot({ overrides: [OVERRIDE] });

    const assemble = listenerFor(agentListeners, 'system-prompt/assemble');
    const request = listenerFor(agentListeners, 'agent/request');
    const preStep = listenerFor(agentListeners, 'agent/pre-step');
    assert.ok(assemble && request && preStep, 'all three waterfalls must be registered');
    assert.deepEqual(preStep.options, { prepend: true }, 'prepend:true is part of the copied contract');

    assert.deepEqual(appended, [{
        type: 'model/selection',
        data: { provider: 'provider-a', model: 'model-x', reasoningEffort: 'high' },
    }]);
    assert.equal(log.info.length, 1);
    assert.match(log.info[0], /child-1/);

    const assembled = await callWaterfall(assemble, [{}, {}], [{ variables: { keep: 'me' } }]);
    assert.deepEqual(assembled.variables, { keep: 'me', provider: 'provider-a', model: 'model-x' });

    const resolved = { provider: 'old', model: 'old-model', reasoningEffort: 'low', maxTokens: 128000 };
    const rewritten = await callWaterfall(request, [{}], [resolved]);
    assert.deepEqual(rewritten, {
        provider: 'provider-a', model: 'model-x', reasoningEffort: 'high', maxTokens: 128000,
    });
    assert.equal(log.error.length, 0, 'assemble ran first, so the B1 witness stays quiet');
});

test('request drops the inherited effort when the override carries none', async () => {
    const plain = { childSessionId: 'child-1', provider: 'provider-a', model: 'model-x' };
    const { agentListeners } = boot({ overrides: [plain] });
    const assemble = listenerFor(agentListeners, 'system-prompt/assemble');
    const request = listenerFor(agentListeners, 'agent/request');
    await callWaterfall(assemble, [{}, {}], [{ variables: {} }]);
    const rewritten = await callWaterfall(request, [{}], [{ provider: 'old', model: 'old', reasoningEffort: 'low' }]);
    assert.deepEqual(rewritten, { provider: 'provider-a', model: 'model-x' });
});

test('the switch notice is appended only past the first step', async () => {
    const { agent, agentListeners } = boot({
        overrides: [OVERRIDE],
        agentOptions: { requestHeaderConfig: { provider: 'old', model: 'old-model' } },
    });
    const assemble = listenerFor(agentListeners, 'system-prompt/assemble');
    await callWaterfall(assemble, [{}, {}], [{ variables: {} }]);
    const preStep = listenerFor(agentListeners, 'agent/pre-step');

    const first = await callWaterfall(preStep, [{ agent, messages: [], signal: { aborted: false }, step: 1 }], [{ kind: 'ok', messages: [] }]);
    assert.deepEqual(first.messages, [], 'step 1 with no messages is left alone');

    const later = await callWaterfall(preStep, [{ agent, messages: [], signal: { aborted: false }, step: 2 }], [{ kind: 'ok', messages: [] }]);
    assert.equal(later.messages.length, 1);
    assert.equal(later.messages[0].source.kind, 'model-selection');
    assert.equal(later.messages[0].source.form, 'notice');
    assert.equal(later.messages[0].role, 'user');
});

test('the B1 witness reports a missing assemble instead of failing silently', async () => {
    const { agentListeners, log } = boot({ overrides: [OVERRIDE] });
    const request = listenerFor(agentListeners, 'agent/request');
    await callWaterfall(request, [{}], [{ provider: 'old', model: 'old' }]);
    assert.equal(log.error.length, 1);
    assert.match(log.error[0], /B1/);
});

test('disposing the plugin effect removes the agent listeners and is idempotent', () => {
    const { agentListeners, effects } = boot({ overrides: [OVERRIDE] });
    assert.equal(handlers(agentListeners), 3);
    effects[0].dispose();
    assert.equal(handlers(agentListeners), 0);
    effects[0].dispose();
    assert.equal(handlers(agentListeners), 0);
});

test('resident agents are swept at apply, later ones arrive through agent/created', () => {
    const resident = { overrides: [OVERRIDE] };
    const first = boot({ overrides: [OVERRIDE] });
    assert.equal(first.appended.length, 1);

    const second = boot({ overrides: [OVERRIDE], agents: [] });
    assert.equal(second.appended.length, 0, 'nothing resident, nothing installed');
    const late = createFakeAgent({ id: 'child-1' });
    second.listeners.get('agent/created')[0]({ agent: late.agent });
    assert.deepEqual(late.appended.map((entry) => entry.type), ['model/selection']);
    assert.equal(resident.overrides.length, 1);
});

test('a one-shot child and a Lead session are left alone', () => {
    const oneShot = boot({ overrides: [OVERRIDE], agentOptions: { subagent: { mode: 'one-shot' } } });
    assert.equal(oneShot.agentListeners.size, 0);
    assert.equal(oneShot.appended.length, 0);

    const lead = boot({ overrides: [OVERRIDE], agentOptions: { headerOrigin: 'lead' } });
    assert.equal(lead.agentListeners.size, 0);
});

test('an unreadable subagent projection refuses and says so', () => {
    const projections = createFakeProjections({ throwFor: ['subagent'] });
    const { agentListeners, appended, log } = boot({ overrides: [OVERRIDE], projections });
    assert.equal(handlers(agentListeners), 0, 'never guess a teammate identity');
    assert.equal(appended.length, 0);
    assert.equal(log.warn.filter((line) => line.includes('C:subagent')).length, 1);
});

test('a deployment with no projection registry falls back to the header', () => {
    const { appended, agentListeners } = boot({ overrides: [OVERRIDE], projections: null });
    assert.equal(agentListeners.size, 3);
    assert.equal(appended.length, 1);
});

test('both config shapes are read; a plain array trips the A3 probe', () => {
    const accessor = boot({ overrides: [OVERRIDE], configShape: 'accessor' });
    assert.equal(accessor.appended.length, 1);
    assert.equal(accessor.log.warn.filter((line) => line.includes('A3')).length, 0);

    const raw = boot({ overrides: [OVERRIDE], configShape: 'raw' });
    assert.equal(raw.appended.length, 1);
    assert.equal(raw.log.warn.filter((line) => line.includes('A3')).length, 1);
});

test('a missing agents service is reported at startup', () => {
    const fake = createFakeCtx({ services: {} });
    apply(fake.ctx, { overrides: [] });
    assert.equal(fake.log.error.length, 1);
    assert.match(fake.log.error[0], /A1/);
});
