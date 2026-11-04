/**
 * The whole gate, in one command: `npm run check`.
 *
 * Static and contract gates only. The behaviour gate needs a real Harness and a
 * real teammate session, so it stays a manual step — see REPORT.md.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const GATES = [
    'check-identity.mjs',
    'check-layers.mjs',
    'check-css-tokens.mjs',
    'check-pack.mjs',
    'check-version.mjs',
    'check-docs.mjs',
];

const failures = [];
for (const gate of GATES) {
    const result = spawnSync(process.execPath, [join(HERE, gate)], { cwd: ROOT, stdio: 'inherit' });
    if (result.status !== 0) failures.push(gate);
}

console.log('\ntests — offline contract gate (node --test tests/)');
const tests = spawnSync(process.execPath, ['--test', 'tests/**/*.test.mjs'], { cwd: ROOT, stdio: 'inherit' });
if (tests.status !== 0) failures.push('node --test tests/**/*.test.mjs');

if (failures.length > 0) {
    console.error(`\ncheck: ${failures.length} gate(s) failed: ${failures.join(', ')}`);
    process.exit(1);
}
console.log('\ncheck: all gates passed');
