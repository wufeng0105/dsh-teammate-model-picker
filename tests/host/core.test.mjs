import test from 'node:test';
import assert from 'node:assert/strict';

import {
    boundSummary, isRoute, modelSelectionData, modelSwitchNotice, routeLabel, sameRoute,
} from '../../host/core/route.mjs';
import { classifyTeammate, readProjectedRoute } from '../../host/core/teammate.mjs';
import { buildOverrideMap, normalizeOverride, overrideRoute } from '../../host/core/override-store.mjs';
import { planInstall } from '../../host/core/install-plan.mjs';
import { CONTEXT_SUMMARY_MAX_CHARS } from '../../host/contracts.mjs';

test('isRoute accepts exactly the two required fields', () => {
    assert.equal(isRoute({ provider: 'p', model: 'm' }), true);
    assert.equal(isRoute({ provider: '', model: 'm' }), false);
    assert.equal(isRoute({ provider: 'p' }), false);
    assert.equal(isRoute(null), false);
});

test('sameRoute treats absent and undefined effort as the same route', () => {
    const a = { provider: 'p', model: 'm' };
    assert.equal(sameRoute(a, { provider: 'p', model: 'm', reasoningEffort: undefined }), true);
    assert.equal(sameRoute(a, { provider: 'p', model: 'm', reasoningEffort: 'high' }), false);
    assert.equal(sameRoute(a, undefined), false);
    assert.equal(sameRoute(undefined, a), false);
});

test('routeLabel drops the provider when both routes share it', () => {
    const other = { provider: 'p', model: 'other' };
    assert.equal(routeLabel({ provider: 'p', model: 'm' }, other), 'm');
    assert.equal(routeLabel({ provider: 'q', model: 'm' }, other), 'q/m');
});

test('boundSummary keeps the documented 120-char bound and marks truncation', () => {
    const long = 'x'.repeat(400);
    const bounded = boundSummary(long);
    assert.equal(bounded.length, CONTEXT_SUMMARY_MAX_CHARS);
    assert.ok(bounded.endsWith('…'));
    assert.equal(boundSummary('short'), 'short');
});

test('modelSelectionData never carries an explicit empty effort', () => {
    assert.deepEqual(modelSelectionData({ provider: 'p', model: 'm' }), { provider: 'p', model: 'm' });
    assert.deepEqual(
        modelSelectionData({ provider: 'p', model: 'm', reasoningEffort: 'high' }),
        { provider: 'p', model: 'm', reasoningEffort: 'high' },
    );
});

test('modelSwitchNotice copies the official user-message shape', () => {
    const notice = modelSwitchNotice(
        { provider: 'p', model: 'old' },
        { provider: 'p', model: 'new' },
        'fixed-id',
    );
    assert.equal(notice.id, 'fixed-id');
    assert.equal(notice.role, 'user');
    assert.equal(notice.content.length, 1);
    assert.equal(notice.content[0].type, 'text');
    assert.match(notice.content[0].text, /^\[model changed: /);
    assert.deepEqual(notice.source, { kind: 'model-selection', form: 'notice', summary: 'old → new' });
    assert.ok(Object.isFrozen(notice));
    assert.ok(notice.source.summary.length <= CONTEXT_SUMMARY_MAX_CHARS);
});

test('classifyTeammate truth table', () => {
    const base = { headerOrigin: 'subagent', agentId: 'a', hasProjections: true, subagentIdentity: { mode: 'continuable' } };
    assert.equal(classifyTeammate(base), true);
    assert.equal(classifyTeammate({ ...base, headerOrigin: 'lead' }), false);
    assert.equal(classifyTeammate({ ...base, agentId: undefined }), false);
    assert.equal(classifyTeammate({ ...base, subagentIdentity: { mode: 'one-shot' } }), false);
    assert.equal(classifyTeammate({ ...base, subagentIdentity: undefined }), false, 'unreadable identity refuses');
    assert.equal(classifyTeammate({ ...base, subagentIdentity: null }), false);
    assert.equal(
        classifyTeammate({ ...base, hasProjections: false, subagentIdentity: undefined }),
        true,
        'no projection registry at all is the documented header-only fallback',
    );
});

test('readProjectedRoute prefers next over lastUsed', () => {
    assert.deepEqual(readProjectedRoute({ next: { provider: 'n', model: 'n' }, lastUsed: { provider: 'l', model: 'l' } }), { provider: 'n', model: 'n' });
    assert.deepEqual(readProjectedRoute({ lastUsed: { provider: 'l', model: 'l' } }), { provider: 'l', model: 'l' });
    assert.equal(readProjectedRoute(undefined), undefined);
});

test('normalizeOverride drops half-written entries instead of repairing them', () => {
    assert.deepEqual(
        normalizeOverride({ childSessionId: 'c', provider: 'p', model: 'm' }),
        { childSessionId: 'c', provider: 'p', model: 'm' },
    );
    assert.equal(normalizeOverride({ childSessionId: 'c', provider: 'p' }), null);
    assert.equal(normalizeOverride({ childSessionId: '', provider: 'p', model: 'm' }), null);
    assert.equal(normalizeOverride('nope'), null);
    assert.equal(normalizeOverride({ childSessionId: 'c', provider: 'p', model: 'm', reasoningEffort: '' }).reasoningEffort, undefined);
});

test('buildOverrideMap is last-write-wins and skips junk', () => {
    const map = buildOverrideMap([
        { childSessionId: 'c', provider: 'old', model: 'old' },
        null,
        { childSessionId: 'c', provider: 'new', model: 'new' },
    ]);
    assert.equal(map.size, 1);
    assert.deepEqual(map.get('c'), { childSessionId: 'c', provider: 'new', model: 'new' });
    assert.equal(buildOverrideMap(undefined).size, 0);
});

test('overrideRoute returns undefined for no override (invariant I-1 input)', () => {
    assert.equal(overrideRoute(undefined), undefined);
    assert.deepEqual(overrideRoute({ provider: 'p', model: 'm' }), { provider: 'p', model: 'm' });
});

test('planInstall covers all four states', () => {
    const override = { childSessionId: 'c', provider: 'p', model: 'm' };
    assert.deepEqual(planInstall({ existingCurrent: undefined, override: undefined }), { action: 'noop' }, 'I-1: nothing to do, nothing registered');
    assert.deepEqual(planInstall({ existingCurrent: { provider: 'p', model: 'm' }, override }), { action: 'noop' });
    assert.deepEqual(planInstall({ existingCurrent: { provider: 'p', model: 'old' }, override: undefined }), { action: 'dispose' });
    assert.deepEqual(planInstall({ existingCurrent: undefined, override }), { action: 'install', target: { provider: 'p', model: 'm' } });
});
