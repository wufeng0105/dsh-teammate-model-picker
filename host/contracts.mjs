/**
 * L3 contracts — pure data only. No Harness runtime, no I/O, no decisions.
 *
 * These strings are the single source for every identity the plugin carries.
 * `scripts/check-identity.mjs` asserts that the four files which must agree
 * actually agree: package.json (name) / cordis.patch.yml (row id + row name) /
 * index.js (plugin name) / client.js (settings namespace, locale namespace,
 * slot entry id). Renaming any one of them alone is the documented footgun.
 */

/** Row id = settings namespace = locale namespace = slot entry id. */
export const IDENTITY = 'teammate-model-picker';

/** npm package name = Cordis row `name` = Client module-table id. */
export const PACKAGE_NAME = '@wufeng0105/dsh-teammate-model-picker';

/** The three fields that decide which LLM answers a request. Nothing else routes. */
export const ROUTE_FIELDS = Object.freeze(['provider', 'model', 'reasoningEffort']);

/** Element shape of `Config.overrides`: one durable override per teammate session. */
export const OVERRIDE_FIELDS = Object.freeze(['childSessionId', 'provider', 'model', 'reasoningEffort']);

/**
 * `boundContextSummary` bound (@deepseek-ai/dsh-llm): one line, at most 120
 * chars. Kept here because the notice text and the Harness must agree on it.
 */
export const CONTEXT_SUMMARY_MAX_CHARS = 120;

/**
 * The DSH version this plugin was actually verified against. `package.json`
 * `engines.dsh` must start here and stop at the next minor: claiming a range
 * wider than the tested one turns an untested host into a silent no-op.
 * `scripts/check-version.mjs` asserts the range, this constant and CHANGELOG.md
 * all agree.
 */
export const TESTED_DSH_VERSION = '0.2.1-rc.5';
