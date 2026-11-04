#!/usr/bin/env node
// Why: the model picker's effect is only visible in the persisted session log,
// so this stays a thin printer over tools/lib/session-log.mjs.
//
// Prints the model-relevant events of every session whose id contains the given
// prefix: `subagent/descriptor` (the pinned spawn route), `model/selection` (a
// durable switch intent), `request/header` (the route each request actually
// used) and `turn/end` failures.
//
// Usage:
//   node tools/session-model-log.mjs <sessionIdOrPrefix> [--all-events]
import { findSessions, readSessionLog, routeRecords, sessionsRoot } from './lib/session-log.mjs';

const needle = process.argv[2];
const verbose = process.argv.includes('--all-events');
if (needle === undefined) {
    console.error('usage: node tools/session-model-log.mjs <sessionIdOrPrefix> [--all-events]');
    process.exit(2);
}

const short = (value) => {
    const text = JSON.stringify(value) ?? String(value);
    return text.length > 400 ? `${text.slice(0, 400)}…` : text;
};

const unwrap = (line) => (line?.type === 'event' && line.event !== undefined ? line.event : line);

for (const { workspace, session, file } of findSessions(sessionsRoot(), needle)) {
    const { events, lines } = readSessionLog(file);
    // Why: --all-events exists to chase schema drift, so it must not inherit the route filter.
    const records = verbose
        ? events.map(unwrap).filter((event) => event?.type !== undefined).map((event) => ({ type: event.type, seq: event.seq, data: event.data }))
        : routeRecords(events);
    console.log(`\n=== ${session}  (${workspace})  ${lines} lines`);
    for (const { type, seq, data } of records) {
        const head = `  [${String(seq).padStart(4)}]`;
        if (type === 'request/header') {
            console.log(`${head} request/header  ${short(data?.header?.config ?? data?.config ?? data)}`);
        } else if (type === 'turn/end') {
            const reason = data?.reason;
            console.log(`${head} turn/end  ${reason?.kind === 'error' ? `ERROR ${JSON.stringify(reason)}` : reason?.kind}`);
        } else {
            console.log(`${head} ${type}  ${short(data)}`);
        }
    }
}
