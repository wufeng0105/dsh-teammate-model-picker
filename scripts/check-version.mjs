/**
 * Gate: the declared DSH range still says what was actually tested.
 *
 * `engines.dsh` is not decoration — the plugin market reads it to decide
 * whether to show the plugin on a given host. Claiming a range wider than the
 * tested one turns an untested host into an install that silently does nothing.
 * The tested version therefore lives in code (`TESTED_DSH_VERSION`) and the
 * range, the code and the changelog have to agree.
 */
import { spawnSync } from 'node:child_process';
import { ROOT, exists, finish, read, run } from './lib/check.mjs';

/** The release tag must name the version the manifest already claims. */
function latestTag() {
    if (!exists('.git')) return { kind: 'skip', detail: 'no .git in this checkout' };
    const result = spawnSync('git', ['describe', '--tags', '--abbrev=0'], { cwd: ROOT, encoding: 'utf8' });
    if (result.status !== 0) return { kind: 'none', detail: 'no tags yet' };
    return { kind: 'tag', tag: result.stdout.trim() };
}

const contracts = read('host/contracts.mjs');
const tested = /export const TESTED_DSH_VERSION = '([^']+)'/.exec(contracts)?.[1] ?? '';
const pkg = JSON.parse(read('package.json'));
const range = String(pkg.engines?.dsh ?? '').trim();
const bounds = /^>=(\S+)\s+<(\S+)$/.exec(range);
const [major, minor] = tested.split('.').map(Number);
const expectedUpper = Number.isFinite(major) && Number.isFinite(minor) ? `${major}.${minor + 1}.0` : '';
const changelog = read('CHANGELOG.md');

const failed = run('engines.dsh (scripts/check-version.mjs)', [
    {
        id: 'V1',
        what: 'engines.dsh is an explicit >=X <Y range',
        pass: () => bounds !== null,
        detail: () => `engines.dsh="${range}"`,
    },
    {
        id: 'V2',
        what: 'the lower bound is the tested version',
        pass: () => bounds !== null && bounds[1] === tested,
        detail: () => `range=${bounds?.[1]} tested=${tested}`,
    },
    {
        id: 'V3',
        what: 'the upper bound is the next minor (no untested major/minor claimed)',
        pass: () => bounds !== null && bounds[2] === expectedUpper,
        detail: () => `range<${bounds?.[2]} expected<${expectedUpper}`,
    },
    {
        id: 'V4',
        what: 'the changelog records the tested version',
        pass: () => tested.length > 0 && changelog.includes(tested),
        detail: () => tested || 'TESTED_DSH_VERSION missing',
    },
    {
        id: 'V5',
        what: 'the newest release tag names the manifest version',
        pass: () => {
            const tag = latestTag();
            if (tag.kind === 'skip' || tag.kind === 'none') return true;
            return tag.tag === `v${pkg.version}` || tag.tag === pkg.version;
        },
        detail: () => {
            const tag = latestTag();
            return tag.kind === 'tag' ? `tag=${tag.tag} version=${pkg.version}` : tag.detail;
        },
    },
]);

finish(failed, 'engines.dsh');
