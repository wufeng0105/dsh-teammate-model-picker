/**
 * Teammate model picker — Host half (entry).
 *
 * WHY THIS EXISTS
 * A continuable teammate pins its LLM route at spawn time: `dsh-subagent`
 * snapshots the parent's route into the durable `subagent/descriptor` session
 * event, and `coldResume` rebuilds `agentOptions` from that descriptor only.
 * `session.selectModel` refuses subagent-owned sessions and the official model
 * selector hides itself for them, so a teammate on an exhausted quota stays on
 * its dead route. DESIGN.md records why the user's config layer is the only
 * usable seam; this file is the wiring.
 *
 * TWO INVARIANTS (asserted by tests/host/apply.test.mjs)
 *   I-1 no override ⇒ nothing is registered; the dispatched route applies.
 *   I-2 the global default model is never touched (no `saveSelection` caller).
 *
 * L2 entry: read Config, build the adapter, hand core decisions to it. No
 * domain rule and no Harness contract string lives in this file.
 *
 * @module @wufeng0105/dsh-teammate-model-picker
 */
import { randomUUID } from 'node:crypto';
import { IDENTITY } from './host/contracts.mjs';
import { modelSelectionData, modelSwitchNotice, sameRoute } from './host/core/route.mjs';
import { classifyTeammate, readProjectedRoute } from './host/core/teammate.mjs';
import { buildOverrideMap } from './host/core/override-store.mjs';
import { planInstall } from './host/core/install-plan.mjs';
import {
    PROJECTION, appendModelSelection, effectOn, headerOrigin, listAgents, loggerOf,
    onAgentCreated, onAssemble, onPreStep, onRequest, pluginLabel, projectionView,
    projectionsOf, requestConfig,
} from './host/adapters/dsh-host.mjs';
import { createRuntimeWitness, runStartupProbe } from './host/adapters/probe.mjs';
import { readOverrides } from './host/adapters/config-schema.mjs';

export const name = IDENTITY;

export { Config } from './host/adapters/config-schema.mjs';

/**
 * `agents` is required: without it the plugin can neither sweep resident
 * teammates nor learn about new ones, so staying inactive is the correct
 * outcome. `sessionProjections` is optional — its absence is the documented
 * fallback branch of `classifyTeammate` — so it is read through the adapter
 * instead of being declared here.
 */
export const inject = ['agents'];

export function apply(ctx, config) {
    const rawLogger = loggerOf(ctx);
    // One logging path for the whole plugin: the probe and the witnesses report
    // through the same function, so a finding can never be silently dropped.
    const logTo = (level, message) => {
        try {
            rawLogger?.[level]?.(pluginLabel(message));
        } catch {
            /* logging must never break routing */
        }
    };
    const witness = createRuntimeWitness(logTo);
    const projections = projectionsOf(ctx);

    runStartupProbe({ ctx, config, log: logTo });

    /** agent → { dispose, selection }; every disposer also lives in the effect below. */
    const installed = new Map();
    effectOn(ctx, () => () => {
        for (const entry of installed.values()) {
            try {
                entry.dispose();
            } catch (error) {
                logTo('warn', `selection teardown failed: ${String(error)}`);
            }
        }
        installed.clear();
    }, pluginLabel('agent selections'));

    const overrides = () => buildOverrideMap(readOverrides(config));

    function teammateNow(agent) {
        const hasProjections = projections !== undefined && projections !== null;
        const subagentIdentity = hasProjections
            ? projectionView(projections, agent?.session, PROJECTION.subagent,
                (error) => witness.projectionReadFailed(PROJECTION.subagent, error))
            : undefined;
        return classifyTeammate({
            headerOrigin: headerOrigin(agent),
            agentId: agent?.id,
            hasProjections,
            subagentIdentity,
        });
    }

    /**
     * Record the override as the standard durable model-selection intent on the
     * live child session. Reuses the existing `model/selection` event type, so
     * the `modelSelection` projection reflects the new route before the first
     * request lands. Never duplicates a route already recorded.
     */
    function recordSelection(agent, selected) {
        try {
            const view = projectionView(projections, agent.session, PROJECTION.modelSelection,
                (error) => witness.projectionReadFailed(PROJECTION.modelSelection, error));
            if (sameRoute(readProjectedRoute(view), selected)) return;
            appendModelSelection(agent.session, modelSelectionData(selected));
            witness.appended();
        } catch (error) {
            witness.appendFailed(error);
        }
    }

    /**
     * Install, refresh, or remove this plugin's selection on one live teammate.
     * The three waterfalls are the official `installModelSelection` contract:
     * prompt assembly snapshots the route, `agent/request` rewrites the request
     * route, `agent/pre-step` appends the durable switch notice. Whether to do
     * any of it is decided by `planInstall` (core), not by a branch here.
     */
    function install(agent) {
        const existing = installed.get(agent);
        const plan = planInstall({ existingCurrent: existing?.selection.current, override: overrides().get(agent.id) });

        if (plan.action === 'noop') return;
        if (plan.action === 'dispose') {
            try {
                existing.dispose();
            } catch (error) {
                logTo('warn', `selection teardown failed: ${String(error)}`);
            }
            installed.delete(agent);
            return;
        }

        const target = plan.target;
        const selection = { current: target, assembled: undefined };
        const agentCtx = agent.ctx;
        const disposes = [
            onAssemble(agentCtx, async (_assembly, _context, next) => {
                const selected = selection.current;
                const assembled = await next();
                selection.assembled = selected;
                if (selected === undefined) return assembled;
                return {
                    ...assembled,
                    variables: { ...assembled.variables, provider: selected.provider, model: selected.model },
                };
            }),
            onRequest(agentCtx, async (_payload, next) => {
                const resolved = await next();
                const selected = selection.assembled;
                witness.request(selected !== undefined);
                if (selected === undefined) return resolved;
                const { reasoningEffort: _inheritedEffort, ...withoutInheritedEffort } = resolved;
                return {
                    ...withoutInheritedEffort,
                    provider: selected.provider,
                    model: selected.model,
                    ...(selected.reasoningEffort === undefined ? {} : { reasoningEffort: selected.reasoningEffort }),
                };
            }),
            onPreStep(agentCtx, async ({ agent: subject, messages, signal, step }, next) => {
                const decision = await next();
                if (decision.kind === 'reject' || signal.aborted) return decision;
                if (decision.messages.length === 0 && (step === 1 || messages.length > 0)) return decision;
                const selected = selection.assembled;
                const previous = requestConfig(subject.session);
                if (selected === undefined || previous === undefined || sameRoute(selected, previous)) return decision;
                if (!Array.isArray(decision.messages)) {
                    witness.preStepBroken();
                    return decision;
                }
                return { ...decision, messages: [...decision.messages, modelSwitchNotice(previous, selected, randomUUID())] };
            }),
        ];
        installed.set(agent, {
            selection,
            dispose: () => {
                for (const dispose of disposes) dispose();
            },
        });
        recordSelection(agent, target);
        logTo('info', `teammate "${agent.id}" will continue on ${target.provider}/${target.model}`);
    }

    // `ctx.on` already owns its disposer on this plugin's fiber
    // (cordis: register() hangs it on ctx.fiber.effect), so unloading the
    // plugin removes this listener together with the installed selections above.
    onAgentCreated(ctx, (agent) => {
        if (teammateNow(agent)) install(agent);
    });
    // Cover agents that materialized before this plugin activated (fresh install,
    // config-driven restart, or Host reload with resident teammates): the same
    // sweep is what re-applies overrides after the settings write restarts this row.
    for (const agent of listAgents(ctx)) {
        if (teammateNow(agent)) install(agent);
    }
}
