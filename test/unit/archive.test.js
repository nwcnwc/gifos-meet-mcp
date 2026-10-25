import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MeetingArchive, archiveConfig } from '../../src/archive.js';

const homes = [];
const home = () => { const h = fs.mkdtempSync(path.join(os.tmpdir(), 'gifos-arch-')); homes.push(h); return h; };
after(() => { for (const h of homes) fs.rmSync(h, { recursive: true, force: true }); });

function fakeTimers() {
  const t = { fns: [], setInterval(fn) { const h = { fn }; t.fns.push(h); return h; }, clearInterval(h) { t.fns = t.fns.filter((x) => x !== h); } };
  return t;
}
function fakeBot() {
  return {
    calls: [],
    async startRecording(id) { this.calls.push('start'); },
    async getRecording(id, o) { this.calls.push('get'); fs.writeFileSync(path.join(o.dir, o.file), 'x'.repeat(10)); return { size: 10, mime: 'video/webm' }; },
  };
}
const m = { meeting_id: 'm1', session_id: 's1', room: 'abc', topic: 'T', link: 'https://gifos.app/#/m/abc', started_at: '2026-10-24T01:00:00Z', transcribing: true };

test('defaults: record and transcribe on; GIFOS_ALWAYS_RECORD=0 turns recording off', () => {
  assert.equal(archiveConfig({}).alwaysRecord, true);
  assert.equal(archiveConfig({}).segmentMs, 15 * 60000);
  assert.equal(archiveConfig({ GIFOS_ALWAYS_RECORD: '0', GIFOS_RECORD_SEGMENT_MIN: '2' }).alwaysRecord, false);
  assert.equal(archiveConfig({ GIFOS_RECORD_SEGMENT_MIN: '2' }).segmentMs, 120000);
});

test('join records, rotation writes segments, leave writes transcript and meta', async () => {
  const h = home(); const bot = fakeBot(); const timers = fakeTimers();
  const transcript = { lines: [{ meeting_id: 'm1', ts: 't', kind: 'speech', speaker: 'Ada', text: 'hello' }, { meeting_id: 'x', text: 'other' }] };
  const a = new MeetingArchive({ home: h, bot, transcript, timers, opts: { alwaysRecord: true, segmentMs: 1000, flushMs: 1000 } });
  await a.joined(m);
  const dir = path.join(h, 'meetings', '2026-10-24-abc-m1');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'))).recording, true);
  const rot = timers.fns.find((x) => x.fn.toString().includes('rotate'));
  await rot.fn(); await a.live.get('m1').busy;
  await new Promise((r) => setImmediate(r));
  await a.leaving(m);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json')));
  assert.equal(meta.state, 'ended');
  assert.deepEqual(meta.segments.map((s) => s.file), ['recording-001.webm', 'recording-002.webm']);
  assert.equal(meta.transcript_lines, 1);
  assert.match(fs.readFileSync(path.join(dir, 'transcript.md'), 'utf8'), /\*\*Ada\*\*: hello/);
  assert.deepEqual(bot.calls, ['start', 'get', 'start', 'get']);
  assert.equal(timers.fns.length, 0, 'timers cleared');
  assert.equal(a.get('m1').segments[1].path, path.join(dir, 'recording-002.webm'));
});

test('a restart marks a live folder interrupted; recording off still archives the transcript', async () => {
  const h = home(); const bot = fakeBot();
  const a = new MeetingArchive({ home: h, bot, transcript: { lines: [] }, timers: fakeTimers(), opts: { alwaysRecord: false, segmentMs: 1000, flushMs: 1000 } });
  await a.joined(m);
  assert.deepEqual(bot.calls, []);
  const b = new MeetingArchive({ home: h, bot, transcript: { lines: [] }, timers: fakeTimers() });
  assert.equal(b.list()[0].state, 'interrupted');
  await a.flushAll();
  assert.equal(a.list()[0].state, 'saved_on_shutdown');
  assert.throws(() => a.get('zz'), /No archived meeting/);
});
