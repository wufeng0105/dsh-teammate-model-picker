/**
 * L1 core — decide what to do with one live agent, given the durable table.
 * Split from the effectful install so the decision — including the
 * "no override ⇒ touch nothing" invariant — is testable without a Harness.
 */
import { sameRoute } from './route.mjs';
import { overrideRoute } from './override-store.mjs';

/**
 * @returns {{action:'noop'}|{action:'dispose'}|{action:'install', target:object}}
 *   noop    nothing to change (also: no override and nothing installed)
 *   dispose an override was removed — tear the existing selection down
 *   install (re)install a selection for `target`
 */
export function planInstall({ existingCurrent, override }) {
    const target = overrideRoute(override);
    if (existingCurrent !== undefined && sameRoute(existingCurrent, target)) return { action: 'noop' };
    if (target === undefined) return existingCurrent === undefined ? { action: 'noop' } : { action: 'dispose' };
    return { action: 'install', target };
}
