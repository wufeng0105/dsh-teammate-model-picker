/**
 * Gate: the stylesheet is tokens only.
 *
 * The CSS is a copy of the official ModelSelect sheet, so the only thing that
 * keeps it honest across Harness upgrades is a machine-checkable rule: no
 * literal colour, and every custom property comes from the theme namespaces.
 */
import { finish, read, run } from './lib/check.mjs';

const client = read('client.js');
const css = /const css = ([\s\S]*?);\s*const tagId/.exec(client)?.[1] ?? '';
const hexColours = css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
const colourFunctions = css.match(/\b(?:rgba?|hsla?|color-mix)\(/g) ?? [];
const customProps = [...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1]);
const foreignProps = customProps.filter((name) => !/^--(dsw|dsh)-/.test(name));

const failed = run('css tokens (scripts/check-css-tokens.mjs)', [
    {
        id: 'S1',
        what: 'the stylesheet was found in client.js',
        pass: () => css.length > 100,
        detail: () => `${css.length} chars`,
    },
    {
        id: 'S2',
        what: 'no literal hex colour',
        pass: () => hexColours.length === 0,
        detail: () => hexColours.join(' ') || 'none',
    },
    {
        id: 'S3',
        what: 'no rgb()/hsl()/color-mix() colour',
        pass: () => colourFunctions.length === 0,
        detail: () => colourFunctions.join(' ') || 'none',
    },
    {
        id: 'S4',
        what: 'every custom property is --dsw-* or --dsh-*',
        pass: () => foreignProps.length === 0,
        detail: () => `${customProps.length} props${foreignProps.length ? `, foreign: ${foreignProps.join(' ')}` : ''}`,
    },
]);

finish(failed, 'css tokens');
