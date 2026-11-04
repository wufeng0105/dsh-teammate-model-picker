// Session-log inspector used to verify the teammate model picker.
//
// DSH persists each session as `session.v4.jsonl.zstd` (one zstd frame set of
// JSONL records). This script decompresses one session (or every session whose
// id contains the given prefix) and prints the model-relevant events:
// `subagent/descriptor` (the pinned spawn route), `model/selection` (a durable
// switch intent), `request/header` (the route each LLM request actually used),
// and `turn/end` failures.
//
// Usage:
//   node tools/session-model-log.mjs <sessionIdOrPrefix> [--all-events]
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';

const home = join(process.env.USERPROFILE ?? '', '.dsh', 'sessions');
const needle = process.argv[2];
const verbose = process.argv.includes('--all-events');
if (needle === undefined) {
    console.error('usage: node tools/session-model-log.mjs <sessionIdOrPrefix> [--all-events]');
    process.exit(2);
}

/** Find every persisted session directory whose name contains the needle. */
function findSessions(root, match) {
    const found = [];
    for (const workspace of readdirSync(root)) {
        const workspacePath = join(root, workspace);
        if (!statSync(workspacePath).isDirectory()) continue;
        for (const entry of readdirSync(workspacePath)) {
            if (!entry.includes(match)) continue;
            const file = join(workspacePath, entry, 'session.v4.jsonl.zstd');
            try {
                if (statSync(file).isFile()) found.push({ workspace, session: entry, file });
            } catch { /* not a session directory */ }
        }
    }
    return found;
}

/** Decompress one log; concatenated frames are joined by the JSONL line breaks. */
function readLog(file) {
    const bytes = zstdDecompressSync(readFileSync(file));
    return bytes.toString('utf8').split('\n').filter((line) => line.length > 0).map((line) => JSON.parse(line));
}

function short(value) {
    const text = JSON.stringify(value);
    return text.length > 400 ? `${text.slice(0, 400)}…` : text;
}

for (const { workspace, session, file } of findSessions(home, needle)) {
    const lines = readLog(file);
    const records = [];
    for (const line of lines) {
        // Records may be `{type:'event', event:{...}}` envelopes or bare events.
        const event = line.type === 'event' && line.event !== undefined ? line.event : line;
        if (event.type === undefined) continue;
        if (verbose
            || event.type === 'subagent/descriptor'
            || event.type === 'model/selection'
            || event.type === 'request/header'
            || event.type === 'turn/end') {
            records.push({ type: event.type, seq: event.seq, data: event.data });
        }
    }
    console.log(`\n=== ${session}  (${workspace})  ${lines.length} lines`);
    for (const record of records) {
        if (record.type === 'request/header') {
            const config = record.data?.header?.config ?? record.data?.config ?? record.data;
            console.log(`  [${String(record.seq).padStart(4)}] request/header  ${short(config)}`);
        } else if (record.type === 'subagent/descriptor') {
            console.log(`  [${String(record.seq).padStart(4)}] subagent/descriptor  ${short(record.data)}`);
        } else if (record.type === 'model/selection') {
            console.log(`  [${String(record.seq).padStart(4)}] model/selection  ${short(record.data)}`);
        } else if (record.type === 'turn/end') {
            const reason = record.data?.reason;
            const text = reason?.kind === 'error' ? `ERROR ${JSON.stringify(reason)}` : reason?.kind;
            console.log(`  [${String(record.seq).padStart(4)}] turn/end  ${text}`);
        } else {
            console.log(`  [${String(record.seq).padStart(4)}] ${record.type}  ${short(record.data)}`);
        }
    }
}
