#!/usr/bin/env node
// Why: one DSH upgrade moves four independent assumptions at once (engine range, profile
// row, log format, Schema contract); one line per check beats re-deriving them by hand.
// Usage: node tools/doctor.mjs [--json] [--contracts]
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SESSION_LOG_FILENAME, findSessions, readSessionLog, sessionsRoot } from './lib/session-log.mjs';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const home = process.env.USERPROFILE ?? process.env.HOME ?? '';
const argv = process.argv.slice(2);
const checks = [];
// Why: an rc build counts as inside `>=x-rc.n <y` only when prerelease ordering is real,
// so versions become a sortable key instead of being compared piecemeal.
const versionKey = (value) => {
    const [core, pre] = String(value).trim().replace(/^[v=]+/, '').split('+')[0].split('-');
    const head = core.split('.').map((n) => String(Number(n)).padStart(6, '0')).join('.');
    if (pre === undefined) return `${head}~`;
    return `${head}-${pre.split('.').map((p) => (/^\d+$/.test(p) ? `0${p.padStart(6, '0')}` : `1${p}`)).join('.')}`;
};
const satisfies = (version, range) => range.trim().split(/\s+/).every((term) => {
    const [, operator = '=', bound] = /^(>=|<=|>|<|=)?(.*)$/.exec(term);
    const left = versionKey(version);
    const right = versionKey(bound);
    const order = left === right ? 0 : (left < right ? -1 : 1);
    return { '>=': order >= 0, '<=': order <= 0, '>': order > 0, '<': order < 0 }[operator] ?? order === 0;
});
async function run(id, fn) {
    let result;
    try { result = await fn(); } catch (error) { result = { status: 'FAIL', note: error.message }; }
    // Why: the DSH-side Schema is sealed inside app.asar, so C4 owes this marker on every line.
    if (id === 'C4') result.note += ' (DSH side unreadable: app.asar)';
    checks.push({ id, ...result });
}
async function contracts() {
    try {
        const { CONTRACTS } = await import('../host/adapters/probe.mjs');
        const list = Array.isArray(CONTRACTS) ? CONTRACTS : Object.values(CONTRACTS ?? {});
        const rows = list.map((entry) => (entry !== null && typeof entry === 'object' ? entry : { value: entry }));
        if (rows.length === 0) throw new Error('probe.mjs exports no CONTRACTS');
        const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
        const cell = (value) => (typeof value === 'string' ? value : JSON.stringify(value) ?? '');
        const width = (key) => Math.max(key.length, ...rows.map((row) => cell(row[key]).length));
        console.log(keys.map((key) => key.padEnd(width(key))).join('  '));
        for (const row of rows) console.log(keys.map((key) => cell(row[key]).padEnd(width(key))).join('  '));
    } catch (error) {
        console.log(`SKIP  contracts  probe.mjs not usable yet: ${error.message}`);
        process.exit(0);
    }
}
if (argv.includes('--contracts')) await contracts();
else {
    await run('C1', () => {
        const range = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).engines?.dsh;
        const file = join(home, '.dsh', 'dsh-runtimes', 'dsh-primary-runtime', 'runtime.json');
        const version = JSON.parse(readFileSync(file, 'utf8')).desktopVersion;
        if (range === undefined || version === undefined) throw new Error(`no engines.dsh or desktopVersion at ${file}`);
        const covered = satisfies(version, range);
        return { status: covered ? 'OK' : 'FAIL', note: `engines.dsh="${range}"  runtime.desktopVersion="${version}"  covered=${covered}` };
    });
    await run('C2', () => {
        const file = join(home, '.dsh', 'profiles', process.env.DSH_PROFILE ?? 'desktop', 'cordis.patch.yml');
        if (!existsSync(file)) return { status: 'SKIP', note: `no profile patch; expected ${file}` };
        const lines = readFileSync(file, 'utf8').split(/\r?\n/);
        const at = lines.findIndex((line) => line.includes('- id: teammate-model-picker'));
        if (at === -1) return { status: 'FAIL', note: `row "teammate-model-picker" is absent from ${file}` };
        return { status: 'OK', note: `${file}  ${lines.slice(at, at + 3).map((line) => line.trim()).join(' / ')}` };
    });
    await run('C3', () => {
        const root = sessionsRoot();
        if (!existsSync(root)) return { status: 'SKIP', note: `no sessions directory; expected ${root}` };
        const [found] = findSessions(root, '');
        if (found === undefined) return { status: 'SKIP', note: `no ${SESSION_LOG_FILENAME} under ${root}` };
        return { status: 'OK', note: `${found.file}  decompressed ${readSessionLog(found.file).lines} events` };
    });
    await run('C4', async () => {
        for (const spec of ['../../vendor/schemastery.mjs', '../vendor/schemastery.mjs', join(repo, 'vendor', 'schemastery.mjs')]) {
            try {
                const { default: Schema } = await import(spec);
                const standard = Schema.prototype['~standard'];
                return { status: 'OK', note: `schema ~standard version=${standard.version} vendor=${standard.vendor}  via "${spec}"` };
            } catch { /* the frozen path may sit one level off; fall through to the repo copy */ }
        }
        throw new Error('vendor/schemastery.mjs is not importable from tools/doctor.mjs');
    });
    const exitCode = checks.some((check) => check.status === 'FAIL') ? 1 : 0;
    if (argv.includes('--json')) console.log(JSON.stringify({ checks, exitCode }, null, 2));
    else for (const check of checks) console.log(`${check.status.padEnd(4)}  ${check.id}  ${check.note}`);
    process.exit(exitCode);
}
