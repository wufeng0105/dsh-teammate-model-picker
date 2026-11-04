/**
 * Gate: one identity, five places.
 *
 * `teammate-model-picker` is simultaneously the Loader row id, the settings
 * namespace, the locale namespace and the slot entry id; the package name is
 * the Client module-table id. Renaming any one of them alone is the documented
 * footgun, so the equality is asserted instead of remembered.
 */
import { finish, read, run, walk } from './lib/check.mjs';

const contracts = read('host/contracts.mjs');
const identity = /export const IDENTITY = '([^']+)'/.exec(contracts)?.[1];
const packageName = /export const PACKAGE_NAME = '([^']+)'/.exec(contracts)?.[1];

const pkg = JSON.parse(read('package.json'));
const patch = read('cordis.patch.yml');
const rowId = /^\s*-\s*id:\s*(\S+)\s*$/m.exec(patch)?.[1];
const rowName = /^\s*name:\s*'([^']+)'\s*$/m.exec(patch)?.[1];

const client = read('client.js');
const ns = /const NS = '([^']+)'/.exec(client)?.[1];
const settingsNs = /const ROW_ID = '([^']+)'/.exec(client)?.[1];
const entryId = /const ENTRY_ID = '([^']+)'/.exec(client)?.[1];
const moduleId = /__ModuleLoader__\.load\(\{\s*id: '([^']+)'/.exec(client)?.[1];

const checks = [
    {
        id: 'I1',
        what: 'contracts.mjs carries the canonical identity',
        pass: () => identity === 'teammate-model-picker' && typeof packageName === 'string',
        detail: () => `IDENTITY=${identity} PACKAGE_NAME=${packageName}`,
    },
    {
        id: 'I2',
        what: 'package.json name equals PACKAGE_NAME',
        pass: () => pkg.name === packageName,
        detail: () => `package.json=${pkg.name}`,
    },
    {
        id: 'I3',
        what: 'cordis.patch.yml row id/name equal IDENTITY/PACKAGE_NAME',
        pass: () => rowId === identity && rowName === packageName,
        detail: () => `row id=${rowId} name=${rowName}`,
    },
    {
        id: 'I4',
        what: 'client.js NS, ROW_ID and ENTRY_ID equal IDENTITY',
        pass: () => ns === identity && settingsNs === identity && entryId === identity,
        detail: () => `NS=${ns} ROW_ID=${settingsNs} ENTRY_ID=${entryId}`,
    },
    {
        id: 'I5',
        what: 'the Client module-table id equals PACKAGE_NAME',
        pass: () => moduleId === packageName,
        detail: () => `module id=${moduleId}`,
    },
    {
        id: 'I6',
        what: 'index.js exports its plugin name from the single source',
        pass: () => /export const name = IDENTITY;/.test(read('index.js')),
        detail: () => 'no second literal',
    },
];

/**
 * Drift detectors over every text file in the tree. Excluded: DECISIONS.md
 * (local-only) and the two files that must NAME the retired scope or a wrong
 * one in order to police it — this gate and its negative test. The bare repo
 * name (README title, GitHub URL) is legitimate; only a *scoped* package
 * specifier is checked, and it must be the canonical one.
 */
const textFiles = walk('.').map((path) => path.replace(/^\.\//, ''))
    .filter((path) => !['DECISIONS.md', 'scripts/check-identity.mjs', 'tests/negative/gates.test.mjs'].includes(path));
const retiredScope = [];
const misScopedName = [];
for (const file of textFiles) {
    const text = read(file);
    if (text.includes('@local/')) retiredScope.push(file);
    for (const match of text.matchAll(/@([a-z0-9][a-z0-9-]*)\/dsh-teammate-model-picker/g)) {
        if (`@${match[1]}/dsh-teammate-model-picker` !== packageName) {
            misScopedName.push(`${file} (@${match[1]}/…)`);
        }
    }
}

checks.push(
    {
        id: 'I7',
        what: 'the retired @local/ scope appears nowhere in the repo',
        pass: () => retiredScope.length === 0,
        detail: () => retiredScope.join(' ') || 'clean',
    },
    {
        id: 'I8',
        what: 'the plugin name only ever appears as the full PACKAGE_NAME',
        pass: () => misScopedName.length === 0,
        detail: () => misScopedName.join(' ') || 'no bare or mis-scoped occurrence',
    },
);

const failed = run('identity — one string, five places (scripts/check-identity.mjs)', checks);

finish(failed, 'identity');
