// Why: DSH's session log is the only durable record of what a teammate session
// was routed to, so every reader (CLI, doctor, tests) must agree on its shape.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';

export const SESSION_LOG_FILENAME = 'session.v4.jsonl.zstd';

const FILENAME_PATTERN = /^session\.v(\d+)\.jsonl\.zstd$/;

export function sessionsRoot(env = process.env) {
    return join(env.USERPROFILE ?? env.HOME ?? '', '.dsh', 'sessions');
}

export function detectFormat(fileName) {
    const name = basename(String(fileName));
    const match = FILENAME_PATTERN.exec(name);
    if (match === null) {
        return { ok: false, format: 'other', reason: `not a session log filename: ${name} (expected session.v<N>.jsonl.zstd)` };
    }
    if (match[1] !== '4') {
        return { ok: false, format: 'other', reason: `session log format v${match[1]} is unsupported here (this reader knows v4)` };
    }
    return { ok: true, format: 'v4', reason: 'v4 zstd-framed JSONL session log' };
}

export function readSessionLog(file) {
    const format = detectFormat(file);
    if (!format.ok) throw new Error(`${format.reason}: ${file}`);
    let text;
    try {
        // Why: DSH appends by concatenating zstd frames; one inflate yields the whole stream.
        text = zstdDecompressSync(readFileSync(file)).toString('utf8');
    } catch (cause) {
        throw new Error(`cannot zstd-decompress ${file}: ${cause.message}`);
    }
    const events = [];
    for (const [index, line] of text.split('\n').entries()) {
        if (line.length === 0) continue;
        try {
            events.push(JSON.parse(line));
        } catch (cause) {
            // Why: a half-written tail line means the log itself is damaged; say so instead of dropping it.
            throw new Error(`invalid JSONL at line ${index + 1} of ${file}: ${cause.message}`);
        }
    }
    return { events, lines: events.length };
}

const ROUTE_TYPES = new Set(['subagent/descriptor', 'model/selection', 'request/header', 'turn/end']);

export function routeRecords(events) {
    const records = [];
    for (const line of events) {
        // Why: newer logs wrap each record in an envelope, older ones are bare events.
        const event = line?.type === 'event' && line.event !== undefined ? line.event : line;
        if (event?.type === undefined || !ROUTE_TYPES.has(event.type)) continue;
        records.push({ type: event.type, seq: event.seq, data: event.data });
    }
    return records;
}

export function findSessions(root, needle) {
    if (!statSync(root).isDirectory()) throw new Error(`sessions root is not a directory: ${root}`);
    const found = [];
    for (const workspace of readdirSync(root)) {
        const workspacePath = join(root, workspace);
        if (!statSync(workspacePath).isDirectory()) continue;
        for (const session of readdirSync(workspacePath)) {
            if (!session.includes(needle)) continue;
            const file = join(workspacePath, session, SESSION_LOG_FILENAME);
            try {
                if (statSync(file).isFile()) found.push({ workspace, session, file });
            } catch { /* not every entry under a workspace is a session directory */ }
        }
    }
    return found;
}
