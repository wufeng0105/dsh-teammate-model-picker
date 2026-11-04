/**
 * Gate: the declared package is the package that would be packed.
 *
 * A bundle manifest is a distribution contract: `files` decides what ships,
 * `exports` decides what can be reached, and `dsh.bundle.patch` decides whether
 * the package is a bundle at all. Anything that ships but is not listed — or is
 * listed but absent — is a defect nobody notices until install time.
 */
import { exists, finish, globToRegExp, read, run, walk } from './lib/check.mjs';

const pkg = JSON.parse(read('package.json'));
const files = Array.isArray(pkg.files) ? pkg.files : [];
const repoFiles = walk('.').map((path) => path.replace(/^\.\//, ''));
const matchers = files.map((entry) => (entry.includes('*') ? globToRegExp(entry) : null));

function covers(path) {
    return files.some((entry, index) => (matchers[index] !== null
        ? matchers[index].test(path)
        : path === entry || path.startsWith(`${entry}/`)));
}

const missing = [];
const emptyGlobs = [];
files.forEach((entry, index) => {
    if (matchers[index] === null) {
        if (!(exists(entry) || repoFiles.some((path) => path.startsWith(`${entry}/`)))) missing.push(entry);
    } else if (!repoFiles.some((path) => matchers[index].test(path))) emptyGlobs.push(entry);
});

const mustShip = ['index.js', 'client.js', 'cordis.patch.yml', 'icon.svg', 'host/contracts.mjs', 'vendor/schemastery.mjs'];
const mustNotShip = ['tests/host/core.test.mjs', 'scripts/check.mjs', 'DECISIONS.md'];

const failed = run('package manifest (scripts/check-pack.mjs)', [
    {
        id: 'P1',
        what: 'every files entry exists and every glob matches something',
        pass: () => missing.length === 0 && emptyGlobs.length === 0,
        detail: () => `${files.length} entries${missing.length ? `, missing: ${missing.join(' ')}` : ''}${emptyGlobs.length ? `, empty globs: ${emptyGlobs.join(' ')}` : ''}`,
    },
    {
        id: 'P2',
        what: 'dsh.bundle.patch is declared and present',
        pass: () => pkg.dsh?.bundle?.patch === './cordis.patch.yml' && exists('cordis.patch.yml'),
        detail: () => String(pkg.dsh?.bundle?.patch),
    },
    {
        id: 'P3',
        what: 'dsh.client declares the web platform',
        pass: () => pkg.dsh?.client?.platform === 'web',
        detail: () => String(pkg.dsh?.client?.platform),
    },
    {
        id: 'P4',
        what: 'every export target resolves',
        pass: () => {
            const targets = Object.values(pkg.exports ?? {});
            return targets.length >= 4 && targets.every((target) => (target.includes('*')
                ? repoFiles.some((path) => globToRegExp(target.replace(/^\.\//, '')).test(path))
                : exists(target.replace(/^\.\//, ''))));
        },
        detail: () => Object.values(pkg.exports ?? {}).join(' '),
    },
    {
        id: 'P5',
        what: 'runtime files are covered by files',
        pass: () => mustShip.every(covers),
        detail: () => mustShip.filter((path) => !covers(path)).join(' ') || 'all covered',
    },
    {
        id: 'P6',
        what: 'dev-only files are not covered by files',
        pass: () => mustNotShip.every((path) => !covers(path)),
        detail: () => mustNotShip.filter(covers).join(' ') || 'none shipped',
    },
    {
        id: 'P7',
        what: 'README.md and LICENSE exist (npm packs them unconditionally)',
        pass: () => exists('README.md') && exists('LICENSE'),
        detail: () => 'present',
    },
]);

finish(failed, 'package manifest');
