/**
 * Gate: the docs stay small, current and traceable.
 *
 * Prose that describes code goes stale silently, so two rules are enforced:
 * a budget (docs must stay a small fraction of the code they describe), and
 * traceability (every `file:line` a doc cites must exist and be in range).
 * A doc that fails either rule is a doc that will lie within one release.
 */
import { exists, finish, lineCount, read, run, walk } from './lib/check.mjs';

const REQUIRED = ['README.md', 'DESIGN.md', 'CONTEXT.md', 'CHANGELOG.md'];
// Count every doc the project keeps, including the internal decision record and
// the verification record: a budget that excludes the files it applies to is a
// budget that measures nothing.
const BUDGETED = [...REQUIRED, 'REPORT.md', 'DECISIONS.md'].filter(exists);
const REFERENCED = BUDGETED;

const DOC_BUDGET = 400;
const codeFiles = ['index.js', 'client.js', ...walk('host'), ...walk('tools'), ...walk('scripts')];
const docLines = BUDGETED.reduce((sum, file) => sum + lineCount(file), 0);
const codeLines = codeFiles.reduce((sum, file) => sum + lineCount(file), 0);

const FORBIDDEN = ['待确认', 'TBD', 'TODO', 'FIXME', '视情况'];
const markers = [];
for (const file of BUDGETED) {
    const text = read(file);
    for (const word of FORBIDDEN) if (text.includes(word)) markers.push(`${file}: "${word}"`);
}

const badRefs = [];
for (const file of REFERENCED) {
    for (const match of read(file).matchAll(/([\w./-]+\.(?:mjs|js|json|yml|yaml|md|ps1)):(\d+)(?:-(\d+))?/g)) {
        const [, target, start, end] = match;
        if (!exists(target)) {
            badRefs.push(`${file} → ${target}:${start} is not a file in this repo`);
            continue;
        }
        const max = lineCount(target);
        if (Number(start) > max || (end !== undefined && Number(end) > max)) {
            badRefs.push(`${file} → ${target}:${start}${end ? `-${end}` : ''} but the file has ${max} lines`);
        }
    }
}

const readme = exists('README.md') ? read('README.md') : '';

const failed = run('docs (scripts/check-docs.mjs)', [
    {
        id: 'D1',
        what: 'the four required docs exist',
        pass: () => REQUIRED.every(exists),
        detail: () => REQUIRED.filter((file) => !exists(file)).join(' ') || REQUIRED.join(' '),
    },
    {
        id: 'D2',
        what: `docs stay within ${DOC_BUDGET} lines`,
        pass: () => docLines <= DOC_BUDGET,
        detail: () => `${docLines} lines across ${BUDGETED.length} files`,
    },
    {
        id: 'D3',
        what: 'docs stay under a third of the code they describe',
        pass: () => docLines * 3 <= codeLines,
        detail: () => `${docLines} doc vs ${codeLines} code lines`,
    },
    {
        id: 'D4',
        what: 'no unresolved markers in docs',
        pass: () => markers.length === 0,
        detail: () => markers.join('; ') || 'clean',
    },
    {
        id: 'D5',
        what: 'every file:line a doc cites resolves',
        pass: () => badRefs.length === 0,
        detail: () => badRefs.join('; ') || 'all references resolve',
    },
    {
        id: 'D6',
        what: 'README points at the design and the verification record',
        pass: () => readme.includes('DESIGN.md') && readme.includes('REPORT.md'),
        detail: () => 'DESIGN.md + REPORT.md',
    },
]);

finish(failed, 'docs');
