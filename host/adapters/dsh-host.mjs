/**
 * L0 adapter — the only place in the Host half that names Harness contracts.
 *
 * Every export is a thin accessor: no decisions, no defaults, no retries.
 * `scripts/check-layers.mjs` asserts these strings appear nowhere else, and
 * `CONTRACTS` in `./probe.mjs` is the machine-readable list of what each one
 * assumes — that list, not prose, is what an upgrade has to be checked against.
 */
import { IDENTITY } from '../contracts.mjs';

/** Services read through `ctx.get`. */
export const SERVICE = Object.freeze({
    projections: 'sessionProjections',
    agents: 'agents',
});

/** Events subscribed through `ctx.on` / an agent context. */
export const EVENT = Object.freeze({
    agentCreated: 'agent/created',
    systemPromptAssemble: 'system-prompt/assemble',
    agentRequest: 'agent/request',
    agentPreStep: 'agent/pre-step',
});

/** Projection keys handed to `sessionProjections.snapshot()`. */
export const PROJECTION = Object.freeze({
    modelSelection: 'modelSelection',
    subagent: 'subagent',
});

/** The one session event type this plugin appends — never a new one. */
export const MODEL_SELECTION_EVENT = 'model/selection';

export function projectionsOf(ctx) {
    return ctx.get(SERVICE.projections);
}

export function loggerOf(ctx) {
    return ctx.logger;
}

/** `ctx.on` already owns its disposer on this plugin's fiber, so we keep none. */
export function onAgentCreated(ctx, handler) {
    return ctx.on(EVENT.agentCreated, ({ agent }) => handler(agent));
}

export function listAgents(ctx) {
    return ctx.get(SERVICE.agents)?.list?.() ?? [];
}

export function effectOn(ctx, register, label) {
    return ctx.effect(register, label);
}

/**
 * One projection view. A throwing snapshot is handed to `onError` instead of
 * being swallowed: the caller turns it into a readable finding, because a
 * silently-false teammate check is indistinguishable from "nothing to do".
 */
export function projectionView(projections, session, key, onError) {
    if (projections === undefined || projections === null) return undefined;
    try {
        return projections.snapshot?.(session, [key])?.values?.[key];
    } catch (error) {
        onError?.(error);
        return undefined;
    }
}

export function headerOrigin(agent) {
    return agent?.session?.header?.origin;
}

export function appendModelSelection(session, data) {
    session.append(MODEL_SELECTION_EVENT, data);
}

export function requestConfig(session) {
    return session.requestHeader()?.config;
}

export function onAssemble(agentCtx, handler) {
    return agentCtx.on(EVENT.systemPromptAssemble, handler);
}

export function onRequest(agentCtx, handler) {
    return agentCtx.on(EVENT.agentRequest, handler);
}

/** `{ prepend: true }` is part of the copied contract, not a preference. */
export function onPreStep(agentCtx, handler) {
    return agentCtx.on(EVENT.agentPreStep, handler, { prepend: true });
}

export function pluginLabel(what) {
    return `${IDENTITY}: ${what}`;
}
