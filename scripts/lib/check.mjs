/**
 * Shared plumbing for the gates. Kept tiny on purpose: a gate that needs a
 * framework is a gate nobody runs.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKIP_DIRS = new Set(['.git', '.codegraph', 'node_modules']);

export const abs = (rel) => join(ROOT, rel);
export const exists = (rel) => existsSync(abs(rel));
export const read = (rel) => readFileSync(abs(rel), 'utf8');

export function lineCount(rel) {
    const text = read(rel);
    return text.length === 0 ? 0 : text.split('\n').length;
}

/** Every file under `relDir`, as repo-relative posix paths. */
export function walk(relDir, out = []) {
    for (const entry of readdirSync(abs(relDir), { withFileTypes: true })) {
        if (SKIP_DIRS.has(entry.name)) continue;
        const child = `${relDir}/${entry.name}`;
        if (entry.isDirectory()) walk(child, out);
        else out.push(child);
    }
    return out;
}

/** Comments are not contracts: layer and string rules must ignore them. */
export const stripComments = (text) => text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Import and re-export specifiers, in source order. */
export function specifiersOf(text) {
    const found = [];
    for (const match of text.matchAll(/^(?:import|export)\s[^;]*from\s+'([^']+)'/gm)) found.push(match[1]);
    return found;
}

/**
 * Run a list of `{ id, what, pass(), detail() }` checks and return the number
 * of failures. Each check is isolated: a throwing check fails, it never
 * aborts the gate.
 */
export function run(title, checks) {
    let failed = 0;
    console.log(`\n${title}`);
    for (const check of checks) {
        let pass = false;
        let detail = '';
        try {
            pass = check.pass();
            detail = typeof check.detail === 'function' ? check.detail() : (check.detail ?? '');
        } catch (error) {
            pass = false;
            detail = `threw: ${error.message}`;
        }
        if (pass) console.log(`  OK   ${check.id}  ${check.what}${detail ? ` — ${detail}` : ''}`);
        else {
            failed += 1;
            console.log(`  FAIL ${check.id}  ${check.what}${detail ? ` — ${detail}` : ''}`);
        }
    }
    return failed;
}

export function finish(failed, label) {
    if (failed > 0) {
        console.error(`\n${label}: ${failed} check(s) failed`);
        process.exit(1);
    }
    console.log(`${label}: all checks passed`);
}

export const toPosix = (path) => path.split(sep).join('/');

export function globToRegExp(pattern) {
    const escaped = pattern.split('/').map((part) => part
        .split('*').map((chunk) => chunk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('/');
    return new RegExp(`^${escaped}$`);
}
