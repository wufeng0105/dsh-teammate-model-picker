/**
 * Test adapter for the Host port (`host/adapters/dsh-host.mjs`).
 *
 * It records rather than simulates: every registration, every service read and
 * every append is observable, so assertions are made on what the Harness would
 * actually receive. Pairs with the production adapter — a port with one
 * adapter is only an indirection.
 */

export function createFakeCtx({ services = {}, logger } = {}) {
    const log = { info: [], warn: [], error: [] };
    const getCalls = [];
    const listeners = new Map();
    const effects = [];
    const ctx = {
        get(name) {
            getCalls.push(name);
            return services[name];
        },
        on(event, handler) {
            const list = listeners.get(event) ?? [];
            list.push(handler);
            listeners.set(event, list);
            return () => {
                const index = list.indexOf(handler);
                if (index >= 0) list.splice(index, 1);
            };
        },
        effect(register, label) {
            const dispose = register();
            effects.push({ label, dispose });
            return dispose;
        },
        logger: logger ?? {
            info: (message) => log.info.push(message),
            warn: (message) => log.warn.push(message),
            error: (message) => log.error.push(message),
        },
    };
    return { ctx, log, getCalls, listeners, effects, services };
}

export function createFakeAgent({
    id = 'child-1',
    headerOrigin = 'subagent',
    subagent,
    requestHeaderConfig,
} = {}) {
    const appended = [];
    const agentListeners = new Map();
    const agent = {
        id,
        session: {
            header: { origin: headerOrigin },
            append(type, data) {
                appended.push({ type, data });
            },
            requestHeader() {
                return requestHeaderConfig === undefined ? undefined : { config: requestHeaderConfig };
            },
        },
        ctx: {
            on(event, handler, options) {
                const list = agentListeners.get(event) ?? [];
                list.push({ handler, options });
                agentListeners.set(event, list);
                return () => {
                    const index = list.findIndex((entry) => entry.handler === handler);
                    if (index >= 0) list.splice(index, 1);
                };
            },
        },
    };
    return { agent, appended, agentListeners };
}

export function createFakeProjections({ values = {}, throwFor = [] } = {}) {
    return {
        snapshot(_session, keys) {
            const key = keys[0];
            if (throwFor.includes(key)) throw new Error(`snapshot(${key}) unavailable`);
            return { values: { [key]: values[key] } };
        },
    };
}

/** The single registered handler for an event, with the options it was given. */
export function listenerFor(agentListeners, event) {
    const list = agentListeners.get(event) ?? [];
    return list.length === 0 ? undefined : list[list.length - 1];
}

/** Drive one waterfall listener: `next()` yields the supplied values in order. */
export function callWaterfall(entry, args, nextResults = []) {
    let index = 0;
    const next = async () => nextResults[index++];
    return entry.handler(...args, next);
}
