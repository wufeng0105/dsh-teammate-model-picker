/**
 * A gate that cannot go red is decoration. Each test below breaks one contract
 * on a throwaway copy of the repo and asserts that the matching gate fails —
 * so "the gate passes" means something.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/[\\/]$/, '');

function copyRepo(label) {
    const dir = mkdtempSync(join(tmpdir(), `dsh-gate-${label}-`));
    cpSync(ROOT, dir, {
        recursive: true,
        filter: (src) => {
            const rel = src.slice(ROOT.length);
            return !rel.startsWith(`${sep}.git`) && !rel.startsWith(`${sep}.codegraph`) && !rel.startsWith(`${sep}node_modules`);
        },
    });
    return dir;
}

function patch(dir, rel, edit) {
    const path = join(dir, rel);
    writeFileSync(path, edit(readFileSync(path, 'utf8')));
}

function gate(dir, script) {
    const result = spawnSync(process.execPath, [join(dir, 'scripts', script)], { cwd: dir, encoding: 'utf8' });
    return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

function expectRed(label, script, mutate, expectedId) {
    const dir = copyRepo(label);
    try {
        mutate(dir);
        const { status, output } = gate(dir, script);
        assert.equal(status, 1, `${script} should fail after ${label}:\n${output}`);
        assert.match(output, new RegExp(`FAIL\\s+${expectedId}`), `${script} should name ${expectedId}:\n${output}`);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

test('identity gate goes red when the row id drifts', () => {
    expectRed('identity', 'check-identity.mjs',
        (dir) => patch(dir, 'cordis.patch.yml', (text) => text.replace('id: teammate-model-picker', 'id: renamed-picker')),
        'I3');
});

test('identity gate goes red when the package name appears under another scope', () => {
    expectRed('identity-scope', 'check-identity.mjs',
        (dir) => patch(dir, 'README.md', (text) => text.replace('@wufeng0105/dsh-teammate-model-picker', '@someone-else/dsh-teammate-model-picker')),
        'I8');
});

test('layer gate goes red on a core → adapter import', () => {
    expectRed('layers', 'check-layers.mjs',
        (dir) => patch(dir, 'host/core/route.mjs', (text) => `import { IDENTITY } from '../adapters/dsh-host.mjs';\n${text}`),
        'L2');
});

test('layer gate goes red when a Harness string moves out of an adapter', () => {
    expectRed('layers-string', 'check-layers.mjs',
        (dir) => patch(dir, 'host/core/route.mjs', (text) => `${text}\nexport const EVENT = 'agent/request';\n`),
        'L6');
});

test('css gate goes red on a literal colour', () => {
    expectRed('css', 'check-css-tokens.mjs',
        (dir) => patch(dir, 'client.js', (text) => text.replace('border:0 solid transparent', 'border:0 solid #ffffff')),
        'S2');
});

test('pack gate goes red when a runtime file stops shipping', () => {
    expectRed('pack', 'check-pack.mjs',
        (dir) => patch(dir, 'package.json', (text) => text.replace('    "client.js",\n', '')),
        'P5');
});

test('version gate goes red when the range claims an untested host', () => {
    expectRed('version', 'check-version.mjs',
        (dir) => patch(dir, 'package.json', (text) => text.replace('">=0.2.1-rc.5 <0.3.0"', '">=9.0.0 <10.0.0"')),
        'V2');
});

test('docs gate goes red when the budget is blown', () => {
    expectRed('docs-budget', 'check-docs.mjs',
        (dir) => patch(dir, 'README.md', (text) => `${text}\n${'filler line\n'.repeat(400)}`),
        'D2');
});

test('docs gate goes red on an unresolved marker', () => {
    expectRed('docs-marker', 'check-docs.mjs',
        (dir) => patch(dir, 'DESIGN.md', (text) => `${text}\n待确认\n`),
        'D4');
});

test('docs gate goes red on a reference to a line that does not exist', () => {
    expectRed('docs-ref', 'check-docs.mjs',
        (dir) => patch(dir, 'DESIGN.md', (text) => `${text}\nsee index.js:9999\n`),
        'D5');
});
