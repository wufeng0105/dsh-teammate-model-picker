/**
 * L0 adapter — the contract registry and the two Host-side probes.
 *
 * The registry is the upgrade checklist: it lives in code because a prose list
 * of "what we depend on" goes stale silently, while a list a script reads and
 * a probe exercises cannot. `node tools/doctor.mjs --contracts` prints it.
 *
 * Probes never decide routing and never throw: a failing probe reports, and the
 * caller falls back to "no override" (the dispatched route), which is the
 * plugin's safe state.
 */
/** `log(level, message)` — a function, not a logger object: the caller owns the prefix. */
const say = (log, level, message) => {
    try {
        log?.(level, message);
    } catch {
        /* logging must never break routing */
    }
};

export const CONTRACTS = Object.freeze([
    { id: 'A1', area: 'service', optional: false, contract: 'ctx.get("agents").list()', probe: 'startup' },
    { id: 'A2', area: 'service', optional: true, contract: 'ctx.get("sessionProjections").snapshot(session, [key]).values[key]', probe: 'startup (absence is the documented fallback)' },
    { id: 'A3', area: 'config', optional: false, contract: 'volatile() validates into an accessor { get() }', probe: 'startup' },
    { id: 'B1', area: 'event', optional: false, contract: 'system-prompt/assemble runs before agent/request', probe: 'runtime witness' },
    { id: 'B2', area: 'event', optional: false, contract: 'agent/request: next() resolves the request config; extra keys survive a spread', probe: 'runtime witness' },
    { id: 'B3', area: 'event', optional: false, contract: 'agent/pre-step: ({agent,messages,signal,step}, next) → decision{kind,messages}', probe: 'runtime witness' },
    { id: 'B4', area: 'event', optional: false, contract: 'session.append("model/selection", {provider,model,reasoningEffort?})', probe: 'runtime witness' },
    { id: 'C1', area: 'projection', optional: false, contract: 'modelSelection view exposes { next, lastUsed }', probe: 'runtime witness' },
    { id: 'C2', area: 'projection', optional: false, contract: 'subagent identity { mode: "continuable" }', probe: 'runtime witness' },
    { id: 'D1', area: 'header', optional: false, contract: 'session.header.origin === "subagent"', probe: 'runtime witness' },
    { id: 'D2', area: 'api', optional: false, contract: 'session.requestHeader().config', probe: 'runtime witness' },
    { id: 'E1', area: 'client', optional: false, contract: 'slot conversation.input.right exists and is a list seat', probe: 'client runtime' },
    { id: 'E2', area: 'remote', optional: false, contract: 'settings.describe() / settings.mutate(ns, ops, revision)', probe: 'client shape assertions' },
    { id: 'E3', area: 'remote', optional: false, contract: 'session.modelCatalog() { groups[].models[] }', probe: 'client shape assertions' },
    { id: 'F1', area: 'schema', optional: false, contract: 'schemastery ~standard{version:1, vendor:"schemastery"}', probe: 'tools/doctor.mjs C4 (own side only)' },
    { id: 'F2', area: 'storage', optional: false, contract: 'session.v4.jsonl.zstd layout under ~/.dsh/sessions', probe: 'tools/doctor.mjs C3' },
]);

/** Startup check: what can be answered before the first request. */
export function runStartupProbe({ ctx, config, log }) {
    const findings = [];
    if (typeof ctx?.get?.('agents')?.list !== 'function') {
        findings.push({ id: 'A1', level: 'error', message: 'the "agents" service has no list() — the plugin cannot sweep teammates, so no override will ever be applied' });
    }
    const overrides = config?.overrides;
    const overridesShapeOk = overrides === undefined || overrides === null
        || Array.isArray(overrides) || typeof overrides?.get === 'function';
    if (!overridesShapeOk) {
        findings.push({ id: 'A3', level: 'warn', message: 'Config.overrides is neither an array nor a volatile accessor — reading it as empty' });
    }
    if (Array.isArray(overrides)) {
        findings.push({ id: 'A3', level: 'warn', message: 'Config.overrides arrived as a plain array, not a volatile accessor — the settings Remote may no longer be able to write it' });
    }
    for (const finding of findings) {
        say(log, finding.level, `probe ${finding.id}: ${finding.message}`);
    }
    return findings;
}

/**
 * Runtime witness: the only way to observe contracts that no static check can
 * see. Each finding is emitted once — the point is a readable diagnosis on the
 * first request, not a log flood.
 */
export function createRuntimeWitness(log) {
    const seen = new Set();
    const once = (id, level, message) => {
        if (seen.has(id)) return;
        seen.add(id);
        say(log, level, `probe ${id}: ${message}`);
    };
    return {
        /** B1: called from the request path with the assemble snapshot's presence. */
        request(assembledOk) {
            if (!assembledOk) {
                once('B1', 'error', 'system-prompt/assemble did not run before agent/request; the override is NOT applied and the dispatched route stays in place');
            }
        },
        /** B3: a decision whose messages are not an array means the shape moved. */
        preStepBroken() {
            once('B3', 'warn', 'agent/pre-step decision.messages is not an array — skipping the [model changed] notice');
        },
        appended() {
            seen.add('B4-ok');
        },
        appendFailed(error) {
            once('B4', 'error', `session.append("model/selection") failed: ${String(error)}`);
        },
        projectionReadFailed(key, error) {
            once(`C:${key}`, 'warn', `projection "${key}" could not be read: ${String(error)}`);
        },
        findings() {
            return [...seen];
        },
    };
}
