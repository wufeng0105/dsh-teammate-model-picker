/**
 * Test adapter for the Client module table and its React runtime.
 *
 * It executes the real `client.js` inside a sandbox and records what the
 * Harness would receive — registration values, remote calls, locale
 * dictionaries — instead of pattern-matching the source text. Source-regex
 * assertions can be satisfied by a comment; these cannot.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const CLIENT_PATH = fileURLToPath(new URL('../../client.js', import.meta.url));

/**
 * Minimal React whose hooks are observable, so a component can be rendered
 * twice with the state its effects produced. `useEffect` runs immediately:
 * the tests await a microtask afterwards and re-render.
 */
export function createReactStub({ createPortal = null } = {}) {
    const store = new Map();
    const setters = new Map();
    let hook = 0;
    return {
        /** Reset the hook cursor so the component can be rendered again. */
        beginRender() { hook = 0; },
        createElement(type, props, ...children) { return { type, props: props ?? {}, children }; },
        useState(initial) {
            const index = hook++;
            if (!store.has(index)) store.set(index, initial);
            const set = (value) => { store.set(index, typeof value === 'function' ? value(store.get(index)) : value); };
            setters.set(index, set);
            return [store.get(index), set];
        },
        useEffect(run) { run(); },
        useLayoutEffect() {},
        useRef() { return { current: null }; },
        useCallback(fn) { return fn; },
        useMemo(fn) { return fn(); },
        createPortal,
    };
}

/** Load `client.js` in a sandbox and materialize its factory. */
export function loadClientModule({ remote = {}, react } = {}) {
    const reactStub = react ?? createReactStub();
    const records = { locale: [], slotInject: [], slotRegister: [], effects: [], warns: [] };
    const ctx = {
        effect(register, label) {
            const dispose = register();
            records.effects.push({ label, dispose });
            return dispose;
        },
        locale: { register(ns, dicts) { records.locale.push({ ns, dicts }); } },
        slots: {
            inject(key, callback) { records.slotInject.push({ key, callback }); },
            register(options, component) {
                // Copy into host-realm objects: the plugin's objects come from the
                // vm realm, and a realm-crossing prototype would break deep equality.
                records.slotRegister.push({ options: { ...options }, component });
                return () => {};
            },
        },
        remote,
        logger: { warn: (message) => records.warns.push(message) },
    };

    let definition = null;
    const sandbox = { window: { __ModuleLoader__: { load(def) { definition = def; } } }, console };
    vm.createContext(sandbox);
    vm.runInContext(readFileSync(CLIENT_PATH, 'utf8'), sandbox, { filename: 'client.js' });

    const plugin = definition.factory((id) => {
        if (id === 'react') return reactStub;
        if (id === 'react-dom') return { createPortal: (node) => node };
        throw new Error(`unexpected require("${id}")`);
    });
    return { definition, plugin, ctx, records, react: reactStub };
}
