import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { loadClientModule } from '../support/fake-loader.mjs';
import { normalizeOverride } from '../../host/core/override-store.mjs';

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'));

const ok = (value) => ({ ok: true, value });
const fail = (code, message) => ({ ok: false, error: { code, message } });

function remoteWith({ namespaces = [], catalog = { groups: [] }, mutate } = {}) {
    return {
        session: { modelCatalog: async () => ok(catalog) },
        settings: {
            describe: async () => ok({ namespaces }),
            mutate: async (ns, ops, revision) => {
                mutate?.(ns, ops, revision);
                return ok({ value: { overrides: ops[0].value } });
            },
        },
    };
}

/** Values built inside the vm carry that realm's prototypes; compare structure. */
const plain = (value) => JSON.parse(JSON.stringify(value));

function apiOf(records) {
    if (records.slotRegister.length === 0 && records.slotInject.length > 0) records.slotInject[0].callback();
    return records.slotRegister[0].options.inject().picker;
}

test('the written entry is accepted by the Host half and exists in both locale files', async () => {
    const calls = [];
    const { plugin, ctx, records } = loadClientModule({
        remote: remoteWith({ namespaces: [], mutate: (...args) => calls.push(args) }),
    });
    plugin.apply(ctx);
    await apiOf(records).writeOverride('child-1', { provider: 'buddy', model: 'hy4free', reasoningEffort: 'high' });
    const written = plain(calls[0][1][0].value[0]);
    assert.deepEqual(normalizeOverride(written), written, 'the Host side accepts what the Client side writes');

    // Runtime dictionaries are flat (`picker.label`); the locale files nest the
    // same keys (`picker.label`), so the cross-check walks the dotted path.
    const hasPath = (tree, dotted) => dotted
        .split('.')
        .reduce((node, part) => (node === null || node === undefined ? undefined : node[part]), tree) !== undefined;
    for (const file of ['locale/en.json', 'locale/zh.json']) {
        const parsed = JSON.parse(readFileSync(fileURLToPath(new URL(`../../${file}`, import.meta.url)), 'utf8'));
        for (const key of Object.keys(records.locale[0].dicts.en)) {
            assert.ok(hasPath(parsed, key), `${file} is missing ${key}`);
        }
    }
});

test('the loader definition and the plugin object match the module ABI', () => {
    const { definition, plugin } = loadClientModule();
    assert.equal(definition.id, pkg.name, 'the module-table id must equal the package name');
    assert.deepEqual([...plugin.inject], ['slots', 'locale', 'remote', 'remote.session', 'remote.settings']);
    assert.equal(typeof plugin.apply, 'function');
    assert.equal(plugin[Symbol.toStringTag], 'Module');
});

test('apply registers dictionaries, stylesheet and exactly one seat entry', () => {
    const { plugin, ctx, records } = loadClientModule({ remote: remoteWith() });
    plugin.apply(ctx);

    assert.equal(records.locale.length, 1);
    assert.equal(records.locale[0].ns, 'teammate-model-picker');
    const { zh, en } = records.locale[0].dicts;
    assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort(), 'both dictionaries must carry the same keys');
    assert.ok(Object.keys(zh).length >= 15);

    assert.equal(records.effects.length, 2);

    assert.equal(records.slotInject.length, 1);
    assert.equal(records.slotInject[0].key, 'conversation.input.right');
    records.slotInject[0].callback();
    assert.equal(records.slotRegister.length, 1);
    assert.deepEqual(records.slotRegister[0].options, {
        name: 'conversation.input.right',
        id: 'teammate-model-picker',
        order: 10,
        locale: 'teammate-model-picker',
        inject: records.slotRegister[0].options.inject,
    });
    assert.equal(typeof records.slotRegister[0].component, 'function');
});

test('a context without the seat service fails closed and says so', () => {
    const { plugin } = loadClientModule();
    const warns = [];
    const bare = {
        effect: () => {},
        locale: { register: () => {} },
        remote: {},
        logger: { warn: (message) => warns.push(message) },
    };
    assert.doesNotThrow(() => plugin.apply(bare));
    assert.equal(warns.length, 1);
    assert.match(warns[0], /slots/);
});

test('catalog shape is asserted instead of being read optimistically', async () => {
    const { plugin, ctx, records } = loadClientModule({ remote: remoteWith({ catalog: { groups: [{ id: 'g', name: 'G', models: [] }] } }) });
    plugin.apply(ctx);
    const api = apiOf(records);
    assert.deepEqual(await api.loadCatalog(), { groups: [{ id: 'g', name: 'G', models: [] }] });

    const bad = loadClientModule({ remote: remoteWith({ catalog: {} }) });
    bad.plugin.apply(bad.ctx);
    await assert.rejects(() => apiOf(bad.records).loadCatalog(), /expected \{ groups: \[\] \}/);

    const missingModels = loadClientModule({ remote: remoteWith({ catalog: { groups: [{ id: 'g', name: 'G' }] } }) });
    missingModels.plugin.apply(missingModels.ctx);
    await assert.rejects(() => apiOf(missingModels.records).loadCatalog(), /models: \[\]/);

    const errored = loadClientModule({ remote: { session: { modelCatalog: async () => fail('boom', 'no catalog') } } });
    errored.plugin.apply(errored.ctx);
    await assert.rejects(() => apiOf(errored.records).loadCatalog(), /model catalog: boom: no catalog/);
});

test('the namespace read reports revision, overrides and the showPicker switch', async () => {
    const namespaces = [{
        ns: 'teammate-model-picker',
        revision: 7,
        value: { overrides: [{ childSessionId: 'c', provider: 'p', model: 'm' }], showPicker: false },
    }];
    const { plugin, ctx, records } = loadClientModule({ remote: remoteWith({ namespaces }) });
    plugin.apply(ctx);
    const api = apiOf(records);
    const state = await api.readNamespace();
    assert.equal(state.revision, 7);
    assert.equal(state.showPicker, false);
    assert.deepEqual(plain(state.overrides), [{ childSessionId: 'c', provider: 'p', model: 'm' }]);
    assert.deepEqual(plain(api.overrideFor(state, 'c')), { provider: 'p', model: 'm' });
    assert.equal(api.overrideFor(state, 'other'), null);
    assert.equal(api.showPickerFrom(null), true, 'unknown namespace keeps the picker visible');
    assert.equal(api.showPickerFrom({ showPicker: undefined }), true);
    assert.equal(api.showPickerFrom({ showPicker: false }), false);
});

test('an unknown namespace is null, a broken describe is an error', async () => {
    const none = loadClientModule({ remote: remoteWith({ namespaces: [] }) });
    none.plugin.apply(none.ctx);
    assert.equal(await apiOf(none.records).readNamespace(), null);

    const broken = loadClientModule({ remote: { settings: { describe: async () => ok({}), mutate: async () => ok({}) } } });
    broken.plugin.apply(broken.ctx);
    await assert.rejects(() => apiOf(broken.records).readNamespace(), /expected \{ namespaces: \[\] \}/);
});

test('writeOverride sends one op with the whole list and the observed revision', async () => {
    const calls = [];
    const namespaces = [{
        ns: 'teammate-model-picker',
        revision: 3,
        value: { overrides: [{ childSessionId: 'other', provider: 'x', model: 'y' }] },
    }];
    const { plugin, ctx, records } = loadClientModule({
        remote: remoteWith({ namespaces, mutate: (...args) => calls.push(args) }),
    });
    plugin.apply(ctx);
    const list = await apiOf(records).writeOverride('child-1', { provider: 'buddy', model: 'hy4free', reasoningEffort: 'high' });

    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'teammate-model-picker');
    assert.deepEqual(plain(calls[0][1]), [{
        op: 'set',
        path: ['overrides'],
        value: [
            { childSessionId: 'other', provider: 'x', model: 'y' },
            { childSessionId: 'child-1', provider: 'buddy', model: 'hy4free', reasoningEffort: 'high' },
        ],
    }]);
    assert.equal(calls[0][2], 3, 'the observed revision is handed back unchanged');
    assert.equal(list.length, 2);
});

test('an override without effort carries no empty effort key', async () => {
    const calls = [];
    const { plugin, ctx, records } = loadClientModule({
        remote: remoteWith({ namespaces: [], mutate: (...args) => calls.push(args) }),
    });
    plugin.apply(ctx);
    await apiOf(records).writeOverride('child-1', { provider: 'buddy', model: 'hy4free' });
    const entry = plain(calls[0][1][0].value[0]);
    assert.deepEqual(entry, { childSessionId: 'child-1', provider: 'buddy', model: 'hy4free' });
    assert.equal('reasoningEffort' in entry, false);
});

test('clearOverride writes the list without that teammate, even when it empties', async () => {
    const calls = [];
    const namespaces = [{
        ns: 'teammate-model-picker',
        revision: 4,
        value: { overrides: [{ childSessionId: 'child-1', provider: 'p', model: 'm' }] },
    }];
    const { plugin, ctx, records } = loadClientModule({ remote: remoteWith({ namespaces, mutate: (...args) => calls.push(args) }) });
    plugin.apply(ctx);
    const list = await apiOf(records).clearOverride('child-1');
    assert.deepEqual(plain(calls[0][1]), [{ op: 'set', path: ['overrides'], value: [] }]);
    assert.deepEqual(plain(list), []);
});

test('a first write with no namespace entry still submits (revision undefined)', async () => {
    const calls = [];
    const { plugin, ctx, records } = loadClientModule({ remote: remoteWith({ namespaces: [], mutate: (...args) => calls.push(args) }) });
    plugin.apply(ctx);
    await apiOf(records).writeOverride('child-1', { provider: 'p', model: 'm' });
    assert.equal(calls[0][2], undefined);
    assert.equal(calls[0][1][0].value.length, 1);
});

test('the entry renders for a teammate only, and honours showPicker', async () => {
    const namespaces = [{ ns: 'teammate-model-picker', revision: 1, value: { overrides: [], showPicker: false } }];
    const { plugin, ctx, records, react } = loadClientModule({ remote: remoteWith({ namespaces }) });
    plugin.apply(ctx);
    records.slotInject[0].callback();
    const { component, options } = records.slotRegister[0];
    const api = options.inject().picker;
    const props = (subagent) => ({
        sessionId: 's', useSession: () => subagent, useProjection: () => null, t: (key) => key, picker: api,
    });

    react.beginRender();
    assert.equal(component(props(null)), null, 'Lead sessions render nothing');

    react.beginRender();
    component(props({ address: { childSessionId: 'c' } }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    react.beginRender();
    assert.equal(
        component(props({ address: { childSessionId: 'c' } })),
        null,
        'showPicker: false hides the entry',
    );
});

test('the entry renders a trigger for a teammate when showPicker is on', async () => {
    const namespaces = [{ ns: 'teammate-model-picker', revision: 1, value: { overrides: [], showPicker: true } }];
    const { plugin, ctx, records, react } = loadClientModule({ remote: remoteWith({ namespaces }) });
    plugin.apply(ctx);
    records.slotInject[0].callback();
    const { component, options } = records.slotRegister[0];
    const api = options.inject().picker;
    const teammate = { address: { childSessionId: 'c' } };
    const props = { sessionId: 's', useSession: () => teammate, useProjection: () => null, t: (key) => key, picker: api };

    react.beginRender();
    component(props);
    await new Promise((resolve) => setTimeout(resolve, 0));
    react.beginRender();
    const element = component(props);
    assert.equal(element.type, 'span');
    const trigger = element.children[0];
    assert.equal(trigger.props['aria-haspopup'], 'menu');
    assert.match(trigger.props['aria-label'], /picker\.label/);
});
