/**
 * L1 core — the durable override table, keyed by the teammate's own session id.
 * Pure: takes the parsed Config value, returns plain data.
 */

/**
 * A half-written entry is dropped, never repaired: a partial row must not be
 * allowed to route traffic. Empty effort means "let the provider decide".
 */
export function normalizeOverride(entry) {
    if (entry === null || typeof entry !== 'object') return null;
    if (typeof entry.childSessionId !== 'string' || entry.childSessionId.length === 0) return null;
    if (typeof entry.provider !== 'string' || entry.provider.length === 0) return null;
    if (typeof entry.model !== 'string' || entry.model.length === 0) return null;
    return {
        childSessionId: entry.childSessionId,
        provider: entry.provider,
        model: entry.model,
        ...(typeof entry.reasoningEffort === 'string' && entry.reasoningEffort.length > 0
            ? { reasoningEffort: entry.reasoningEffort }
            : {}),
    };
}

/** Last write wins for a given teammate. */
export function buildOverrideMap(list) {
    const map = new Map();
    for (const entry of Array.isArray(list) ? list : []) {
        const normalized = normalizeOverride(entry);
        if (normalized !== null) map.set(normalized.childSessionId, normalized);
    }
    return map;
}

/** The route an override selects, or `undefined` when there is no override. */
export function overrideRoute(override) {
    if (override === undefined) return undefined;
    return {
        provider: override.provider,
        model: override.model,
        ...(override.reasoningEffort ? { reasoningEffort: override.reasoningEffort } : {}),
    };
}
