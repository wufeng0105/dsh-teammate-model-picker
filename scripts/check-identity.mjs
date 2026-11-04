/**
 * Gate: one identity, five places.
 *
 * `teammate-model-picker` is simultaneously the Loader row id, the settings
 * namespace, the locale namespace and the slot entry id; the package name is
 * the Client module-table id. Renaming any one of them alone is the documented
 * footgun, so the equality is asserted instead of remembered.
 */
import { finish, read, run } from './lib/check.mjs';

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

const failed = run('identity — one string, five places (scripts/check-identity.mjs)', [
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
]);

finish(failed, 'identity');
