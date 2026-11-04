/**
 * L1 core — "is this agent a teammate?" as a pure truth table.
 * The caller (entry) extracts the raw values through the adapter, so every
 * branch below is unit-testable without a Harness.
 */

/**
 * Both checks are mandatory whenever the projection registry is composed:
 * the header must say `subagent` AND the identity must say `continuable`.
 * Only a deployment with no `sessionProjections` service at all falls back to
 * the header alone — that is the documented "no registry composed" case, not a
 * projection miss. A missing or unreadable identity refuses: never guess.
 */
export function classifyTeammate({ headerOrigin, agentId, hasProjections, subagentIdentity }) {
    if (headerOrigin !== 'subagent' || typeof agentId !== 'string') return false;
    if (!hasProjections) return true;
    if (subagentIdentity === null || subagentIdentity === undefined) return false;
    return subagentIdentity.mode === 'continuable';
}

/** Projection view → the route the session currently shows (`next` wins). */
export function readProjectedRoute(view) {
    return view?.next ?? view?.lastUsed ?? undefined;
}
