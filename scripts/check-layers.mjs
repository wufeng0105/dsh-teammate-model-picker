/**
 * Gate: dependency direction, and who may name a Harness contract.
 *
 * Layers: entry → core/adapters → contracts. `core` is pure decision logic and
 * must not know the Harness exists; adapters are the only place a service,
 * event, projection key or slot name may appear. The Client half is a single
 * module by design, so its rule is narrower: two requires, no imports.
 */
import { finish, read, run, specifiersOf, stripComments, walk } from './lib/check.mjs';

const HOST_CONTRACT_STRINGS = [
    'sessionProjections', 'agent/created', 'system-prompt/assemble', 'agent/request',
    'agent/pre-step', 'model/selection', 'conversation.input.right', 'agentDefaultModel',
    'saveSelection',
];

const hostFiles = walk('host');
const coreFiles = hostFiles.filter((file) => file.startsWith('host/core/'));
const adapterFiles = hostFiles.filter((file) => file.startsWith('host/adapters/'));
const indexCode = stripComments(read('index.js'));
const coreCode = Object.fromEntries(coreFiles.map((file) => [file, stripComments(read(file))]));
const contractsCode = stripComments(read('host/contracts.mjs'));
const clientCode = stripComments(read('client.js'));

const offenders = [];
for (const [file, code] of Object.entries({ 'index.js': indexCode, 'host/contracts.mjs': contractsCode, ...coreCode })) {
    for (const needle of HOST_CONTRACT_STRINGS) {
        if (code.includes(`'${needle}'`) || code.includes(`"${needle}"`)) offenders.push(`${file} → ${needle}`);
    }
}

const impureCore = [];
for (const [file, code] of Object.entries({ 'host/contracts.mjs': contractsCode, ...coreCode })) {
    if (/(^|[^.\w])(ctx|window|document)\b/.test(code)) impureCore.push(file);
}

const failed = run('layers — dependency direction (scripts/check-layers.mjs)', [
    {
        id: 'L1',
        what: 'index.js imports only ./host/** (plus node builtins)',
        pass: () => specifiersOf(read('index.js')).every((spec) => spec.startsWith('./host/') || spec.startsWith('node:')),
        detail: () => specifiersOf(read('index.js')).join(' '),
    },
    {
        id: 'L2',
        what: 'core imports never reach an adapter',
        pass: () => coreFiles.every((file) => specifiersOf(read(file)).every((spec) => !spec.includes('adapters/'))),
        detail: () => coreFiles.join(' '),
    },
    {
        id: 'L3',
        what: 'adapters import only contracts (and vendor for the schema)',
        pass: () => adapterFiles.every((file) => specifiersOf(read(file))
            .every((spec) => spec === '../contracts.mjs' || spec.startsWith('../../vendor/'))),
        detail: () => adapterFiles.join(' '),
    },
    {
        id: 'L4',
        what: 'contracts.mjs imports nothing',
        pass: () => specifiersOf(read('host/contracts.mjs')).length === 0,
        detail: () => specifiersOf(read('host/contracts.mjs')).join(' ') || 'leaf',
    },
    {
        id: 'L5',
        what: 'core and contracts never touch ctx/window/document',
        pass: () => impureCore.length === 0,
        detail: () => impureCore.join(' ') || 'pure',
    },
    {
        id: 'L6',
        what: 'no Harness contract string outside an adapter',
        pass: () => offenders.length === 0,
        detail: () => offenders.join('; ') || 'adapters only',
    },
    {
        id: 'L7',
        what: 'client.js requires only react/react-dom and imports nothing',
        pass: () => {
            const requires = [...clientCode.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((match) => match[1]);
            return requires.every((id) => id === 'react' || id === 'react-dom') && specifiersOf(clientCode).length === 0;
        },
        detail: () => [...clientCode.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((match) => match[1]).join(' '),
    },
]);

finish(failed, 'layers');
