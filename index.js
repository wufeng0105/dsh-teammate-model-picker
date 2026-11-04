/**
 * Teammate model picker — Host half.
 *
 * WHY THIS EXISTS
 * A continuable teammate (Agent Teams member / continuable subagent) pins its
 * LLM route at spawn time: `dsh-subagent` snapshots the parent's current route
 * into the durable `subagent/descriptor` session event and `coldResume`
 * reconstructs `agentOptions` from that descriptor only. The Host-side
 * `session.selectModel` Remote refuses subagent-owned sessions
 * (`hasApiSessionSubagentOwner` → `session/agent-busy`), and the official model
 * selector hides itself for them (`sessions.subagentAddress(...) !== void 0`).
 * A teammate on an exhausted quota therefore stays on its dead route.
 *
 * HOW THIS FIXES IT (no new session event types, no new semantics)
 * The agent loop resolves each request route through the `agent/request`
 * waterfall, and `installModelSelection` (@deepseek-ai/dsh-agent) is the
 * official way ordinary sessions override that route per agent. This plugin
 * replicates that installation for teammate agents only:
 *
 *   1. Durable per-teammate overrides live in this row's `Config.overrides`
 *      (volatile fields), written by the client half through the Harness
 *      settings Remote (`settings.mutate`). Profile-patch persistence means the
 *      override survives restarts without any custom storage.
 *   2. On apply (and on every `agent/created` for a continuable subagent), the
 *      plugin installs an agent-scoped selection whose `current` is the stored
 *      override. The three waterfalls below are a faithful copy of
 *      `dsh-agent/lib/types/model-selection.js`, including the durable
 *      `[model changed: …]` user-role notice semantics.
 *   3. When the agent is live, the plugin also appends the EXISTING
 *      `model/selection` session event so the standard `modelSelection`
 *      projection reflects the intent (display + restart derivation). No new
 *      event type is introduced.
 *
 * What this deliberately does NOT do: it never touches
 * `agentDefaultModel.saveSelection` (the global default model) and it only ever
 * installs selections on sessions whose header declares `origin: "subagent"`
 * and whose descriptor identity is `continuable`. Lead sessions and one-shot
 * children are untouched, and "teammate routing is decided by dispatch" is
 * preserved: with no override, the descriptor route applies exactly as before.
 *
 * Zero Harness imports by design: workspace/profile bundles resolve no
 * `@deepseek-ai/*` runtime modules, so every service is reached through
 * `ctx.get(...)`. The Config schema uses @deepseek-ai/schemastery, vendored
 * verbatim under `vendor/` (MIT; licenses included) because the bundle is
 * linked into the profile from its source directory, where bare package
 * imports do not resolve.
 *
 * @module @local/dsh-teammate-model-picker
 */
import { randomUUID } from 'node:crypto';
import Schema from './vendor/schemastery.mjs';

export const name = 'teammate-model-picker';

/**
 * `volatile()` marks the fields the settings Remote may edit live
 * (`volatileForm`/`isVolatilePath` skip non-volatile fields, so without the
 * marker the client picker could neither read nor write this namespace).
 */
export const Config = Schema.object({
    /** Show the picker for teammate sessions (client-side switch). */
    showPicker: Schema.boolean().default(true).volatile(),
    /**
     * Durable per-teammate model overrides, keyed by the teammate's own
     * session id. Written through `settings.mutate` by the picker; replaced
     * wholesale on each pick. `reasoningEffort` may be empty to let the
     * selected model resolve its provider default.
     */
    overrides: Schema.array(Schema.object({
        childSessionId: Schema.string().required(),
        provider: Schema.string().required(),
        model: Schema.string().required(),
        reasoningEffort: Schema.string(),
    })).default([]).volatile(),
});

/** `boundContextSummary` bound (@deepseek-ai/dsh-llm): one line, at most 120 chars. */
const CONTEXT_SUMMARY_MAX_CHARS = 120;
function boundSummary(summary) {
    return summary.length <= CONTEXT_SUMMARY_MAX_CHARS
        ? summary
        : `${summary.slice(0, CONTEXT_SUMMARY_MAX_CHARS - 1)}…`;
}
function sameRoute(left, right) {
    return left !== undefined && right !== undefined
        && left.provider === right.provider
        && left.model === right.model
        && (left.reasoningEffort ?? undefined) === (right.reasoningEffort ?? undefined);
}
function routeLabel(route, other) {
    return route.provider === other.provider ? route.model : `${route.provider}/${route.model}`;
}
/**
 * The durable in-conversation switch notice. Field-for-field the same value
 * `createUserMessage` (@deepseek-ai/dsh-llm) produces for this source, so the
 * transcript row and its `model-selection` source stay canonical without
 * importing the framework.
 */
function modelSwitchNotice(previous, selected) {
    const from = routeLabel(previous, selected);
    const to = routeLabel(selected, previous);
    return Object.freeze({
        id: randomUUID(),
        role: 'user',
        content: Object.freeze([
            Object.freeze({
                type: 'text',
                text: `[model changed: assistant turns above this point were generated by ${from}; the session continues with ${to}]`,
            }),
        ]),
        source: Object.freeze({
            kind: 'model-selection',
            form: 'notice',
            summary: boundSummary(`${from} → ${to}`),
        }),
    });
}

/** Pick the effective route the session currently shows in the standard projection. */
function projectedRoute(projections, session) {
    try {
        const view = projections?.snapshot?.(session, ['modelSelection'])?.values?.modelSelection;
        return view?.next ?? view?.lastUsed ?? undefined;
    } catch {
        return undefined;
    }
}

export function apply(ctx, config) {
    const projections = ctx.get('sessionProjections');

    /** agent → { dispose, selection } — every disposer also lives in the plugin effect below. */
    const installed = new Map();
    ctx.effect(() => () => {
        for (const entry of installed.values()) {
            try {
                entry.dispose();
            } catch (error) {
                ctx.logger?.warn?.(`teammate-model-picker: selection teardown failed: ${String(error)}`);
            }
        }
        installed.clear();
    }, 'teammate-model-picker: agent selections');

    /**
     * Read one volatile Config field. A `volatile()` field validates into an
     * accessor object (`{ get() }`), NOT a plain value — see
     * `dsh-agent-default-model`, which reads `this.config.provider.get()`.
     */
    function volatileValue(field, fallback) {
        if (field === undefined || field === null) return fallback;
        if (typeof field === 'object' && typeof field.get === 'function') {
            const value = field.get();
            return value === undefined ? fallback : value;
        }
        return field;
    }

    /** Read the current durable override table into a fresh map. */
    function overridesNow() {
        const map = new Map();
        const list = volatileValue(config.overrides, []);
        for (const entry of Array.isArray(list) ? list : []) {
            if (entry && typeof entry.childSessionId === 'string'
                && typeof entry.provider === 'string' && entry.provider.length > 0
                && typeof entry.model === 'string' && entry.model.length > 0) {
                map.set(entry.childSessionId, entry);
            }
        }
        return map;
    }

    /**
     * Whether this agent is a continuable teammate. The two checks are
     * BOTH mandatory: `header.origin === 'subagent'` and, whenever the
     * projection registry is composed, `subagent.mode === 'continuable'`.
     * Only a deployment with no `sessionProjections` service at all falls back
     * to the header alone — that is the documented "no registry composed" case,
     * not a projection miss.
     */
    function isContinuableTeammate(agent) {
        const header = agent?.session?.header;
        if (header?.origin !== 'subagent' || typeof agent.id !== 'string') return false;
        if (projections === undefined) return true;
        try {
            const identity = projections.snapshot(agent.session, ['subagent'])?.values?.subagent;
            if (identity === null || identity === undefined) return false;
            return identity.mode === 'continuable';
        } catch {
            return false;
        }
    }

    /**
     * Record the override as the standard durable model-selection intent on the
     * live child session. Reuses the existing `model/selection` event type —
     * the same event the session controller appends for ordinary sessions — so
     * the `modelSelection` projection (and anything reading it) shows the new
     * route before the first request lands. Never duplicates a route already
     * recorded.
     */
    function recordSelection(agent, selected) {
        try {
            const current = projectedRoute(projections, agent.session);
            if (sameRoute(current, selected)) return;
            agent.session.append('model/selection', {
                provider: selected.provider,
                model: selected.model,
                ...(selected.reasoningEffort === undefined ? {} : { reasoningEffort: selected.reasoningEffort }),
            });
        } catch (error) {
            ctx.logger?.warn?.(`teammate-model-picker: recording model/selection failed: ${String(error)}`);
        }
    }

    /**
     * Install (or refresh, or remove) this plugin's selection on one live
     * teammate agent. The three waterfalls are the official
     * `installModelSelection` contract: prompt assembly snapshots the route,
     * `agent/request` rewrites the request route, and `agent/pre-step` appends
     * the durable switch notice when the route actually changed.
     */
    function install(agent) {
        const override = overridesNow().get(agent.id);
        const existing = installed.get(agent);
        const target = override === undefined ? undefined : {
            provider: override.provider,
            model: override.model,
            ...(override.reasoningEffort ? { reasoningEffort: override.reasoningEffort } : {}),
        };
        if (existing !== undefined && sameRoute(existing.selection.current, target)) return;
        if (existing !== undefined) {
            existing.dispose();
            installed.delete(agent);
        }
        if (target === undefined) return;
        const selection = { current: target, assembled: undefined };
        const agentCtx = agent.ctx;
        const disposeAssembly = agentCtx.on('system-prompt/assemble', async (_assembly, _context, next) => {
            const selected = selection.current;
            const assembled = await next();
            selection.assembled = selected;
            if (selected === undefined) return assembled;
            return {
                ...assembled,
                variables: {
                    ...assembled.variables,
                    provider: selected.provider,
                    model: selected.model,
                },
            };
        });
        const disposeRequest = agentCtx.on('agent/request', async (_payload, next) => {
            const resolved = await next();
            const selected = selection.assembled;
            if (selected === undefined) return resolved;
            const { reasoningEffort: _inheritedEffort, ...withoutInheritedEffort } = resolved;
            return {
                ...withoutInheritedEffort,
                provider: selected.provider,
                model: selected.model,
                ...(selected.reasoningEffort === undefined ? {} : { reasoningEffort: selected.reasoningEffort }),
            };
        });
        const disposeNotice = agentCtx.on('agent/pre-step', async ({ agent: subject, messages, signal, step }, next) => {
            const decision = await next();
            if (decision.kind === 'reject' || signal.aborted) return decision;
            if (decision.messages.length === 0 && (step === 1 || messages.length > 0)) return decision;
            const selected = selection.assembled;
            const previous = subject.session.requestHeader()?.config;
            if (selected === undefined || previous === undefined || sameRoute(selected, previous)) return decision;
            return { ...decision, messages: [...decision.messages, modelSwitchNotice(previous, selected)] };
        }, { prepend: true });
        installed.set(agent, {
            selection,
            dispose: () => {
                disposeAssembly();
                disposeRequest();
                disposeNotice();
            },
        });
        recordSelection(agent, target);
        ctx.logger?.info?.(`teammate-model-picker: teammate "${agent.id}" will continue on ${target.provider}/${target.model}`);
    }

    // `ctx.on` already owns its disposer on this plugin's fiber
    // (cordis/lib/index.js:335-344), so unloading the plugin removes this
    // listener together with the installed selections above.
    ctx.on('agent/created', ({ agent }) => {
        if (isContinuableTeammate(agent)) install(agent);
    });
    // Cover agents that materialized before this plugin activated (fresh
    // install, config-driven restart, or Host reload with resident teammates):
    // the same sweep is what re-applies overrides after the settings write
    // restarts this row.
    for (const agent of ctx.get('agents')?.list?.() ?? []) {
        if (isContinuableTeammate(agent)) install(agent);
    }
}
