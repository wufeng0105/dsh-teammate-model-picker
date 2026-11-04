/**
 * The session-log reader is the behaviour gate's only instrument. It is
 * exercised on a synthetic v4 log built here rather than on a recorded one:
 * a real session log contains machine paths and session ids, and a stored
 * sample would be either a privacy problem or a stale artefact.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zstdCompressSync } from 'node:zlib';

import {
    SESSION_LOG_FILENAME, detectFormat, findSessions, readSessionLog, routeRecords,
} from '../../tools/lib/session-log.mjs';

function writeLog(root, workspace, session, lines) {
    const dir = join(root, workspace, session);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, SESSION_LOG_FILENAME);
    writeFileSync(file, zstdCompressSync(Buffer.from(lines.map((line) => JSON.stringify(line)).join('\n'), 'utf8')));
    return file;
}

test('a synthetic v4 log round-trips and yields the four route records', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-session-log-'));
    try {
        const file = writeLog(root, '--ws--', 'abc123', [
            { type: 'session', id: 'abc123' },
            { type: 'event', event: { type: 'subagent/descriptor', seq: 0, data: { mode: 'continuable' } } },
            { type: 'model/selection', seq: 50, data: { provider: 'provider-a', model: 'model-x' } },
            { type: 'request/header', seq: 59, data: { header: { config: { provider: 'provider-a', model: 'model-x' } } } },
            { type: 'turn/end', seq: 63, data: { reason: { kind: 'completed' } } },
        ]);

        assert.deepEqual(findSessions(root, 'abc123').map((hit) => hit.session), ['abc123']);
        const { events, lines } = readSessionLog(file);
        assert.equal(lines, 5);
        assert.deepEqual(
            routeRecords(events).map((record) => record.type),
            ['subagent/descriptor', 'model/selection', 'request/header', 'turn/end'],
        );
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('the reader refuses to pretend a newer or corrupt log is readable', () => {
    assert.equal(detectFormat(SESSION_LOG_FILENAME).ok, true);
    assert.equal(detectFormat('session.v5.jsonl.zstd').ok, false);

    const root = mkdtempSync(join(tmpdir(), 'dsh-session-log-'));
    try {
        const file = writeLog(root, '--ws--', 'broken', [{ type: 'session' }]);
        writeFileSync(file, Buffer.from('definitely not a zstd frame'));
        assert.throws(() => readSessionLog(file), /zstd|decompress|frame/i);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});
