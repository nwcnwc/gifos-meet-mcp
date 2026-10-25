// Every meeting the bot joins is recorded and transcribed on its own
// (GIFOS_ALWAYS_RECORD, GIFOS_ALWAYS_TRANSCRIBE, both on by default) and kept
// in its own folder:  <home>/meetings/<date>-<room>-<meeting_id>/
//   meta.json              topic, link (no password), times, state, segment list
//   recording-001.webm …   the recording, one file per segment
//   transcript.json / .md  every speech, spoken and chat line
// Long meetings: the recording is rotated every GIFOS_RECORD_SEGMENT_MIN
// minutes (default 15). Each segment is copied to disk in 4 MB slices and the
// browser drops it, so neither process holds a whole meeting. The transcript
// files are rewritten every 30 seconds while the meeting is live.
// The ⏺ recording indicator is the Meeting Bot's own and shows to everyone.
import fs from 'node:fs';
import path from 'node:path';

const SEGMENT_MIN = 15;
const FLUSH_MS = 30000;

export function archiveConfig(env = process.env) {
  const seg = Number(env.GIFOS_RECORD_SEGMENT_MIN);
  return {
    alwaysRecord: env.GIFOS_ALWAYS_RECORD !== '0',
    segmentMs: (seg > 0 ? seg : SEGMENT_MIN) * 60000,
    flushMs: FLUSH_MS,
  };
}

const safe = (s) => String(s || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
const stripPassword = (link) => String(link || '').replace(/#.*$/, (h) => h.replace(/([?&#])(pw|password|p)=[^&]*/gi, '$1$2=hidden'));

export class MeetingArchive {
  constructor({ home, bot, transcript, opts = archiveConfig(), log = () => {}, timers = { setInterval, clearInterval } }) {
    this.root = path.join(home, 'meetings');
    this.bot = bot;
    this.transcript = transcript;
    this.opts = opts;
    this.log = log;
    this.timers = timers;
    this.live = new Map();   // meeting_id -> { dir, meta, rot, flush, busy }
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    this.markInterrupted();
  }

  // A folder still marked live after a restart: the server stopped without
  // saving it. Its transcript and finished segments stay; say what happened.
  markInterrupted() {
    for (const row of this.list()) {
      if (row.state !== 'live') continue;
      this.writeMeta(path.join(this.root, row.folder), { ...row.meta, state: 'interrupted', note: 'The server stopped before this meeting ended; the last recording segment may be missing.' });
    }
  }

  dirFor(m) {
    const day = (m.started_at || new Date().toISOString()).slice(0, 10);
    return path.join(this.root, day + '-' + safe(m.room || 'room') + '-' + safe(m.meeting_id));
  }

  writeMeta(dir, meta) {
    const tmp = path.join(dir, 'meta.json.tmp');
    fs.writeFileSync(tmp, JSON.stringify(meta, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, path.join(dir, 'meta.json'));
  }

  flushTranscript(meetingId, dir) {
    const rows = this.transcript ? this.transcript.lines.filter((l) => l.meeting_id === meetingId) : [];
    const pub = rows.map((l) => ({ ts: l.ts, kind: l.kind, speaker: l.speaker, text: l.text }));
    fs.writeFileSync(path.join(dir, 'transcript.json'), JSON.stringify(pub, null, 2), { mode: 0o600 });
    const md = pub.map((l) => '- ' + (l.ts || '') + ' **' + (l.speaker || '?') + '**' + (l.kind === 'chat' ? ' (chat)' : '') + ': ' + l.text).join('\n');
    fs.writeFileSync(path.join(dir, 'transcript.md'), '# Transcript\n\n' + md + '\n', { mode: 0o600 });
    return pub.length;
  }

  async joined(m) {
    const dir = this.dirFor(m);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const meta = {
      meeting_id: m.meeting_id, topic: m.topic || null, room: m.room || null, link: stripPassword(m.link),
      started_at: m.started_at || new Date().toISOString(), ended_at: null, state: 'live',
      recording: false, transcribing: !!m.transcribing, segments: [], errors: [],
    };
    const slot = { dir, meta, session: m.session_id, rot: null, flush: null, busy: Promise.resolve(), want: false };
    this.live.set(m.meeting_id, slot);
    if (this.opts.alwaysRecord) await this.startRecording(m.meeting_id);
    this.writeMeta(dir, meta);
    slot.flush = this.timers.setInterval(() => { try { this.flushTranscript(m.meeting_id, dir); } catch (e) { /* next tick */ } }, this.opts.flushMs);
    if (slot.flush.unref) slot.flush.unref();
    return meta;
  }

  async startRecording(meetingId) {
    const slot = this.live.get(meetingId);
    if (!slot) return null;
    slot.want = true;
    try {
      await this.bot.startRecording(slot.session);
      slot.meta.recording = true;
    } catch (e) {
      slot.meta.errors.push('start recording: ' + e.message);
      this.log('recording did not start: ' + e.message);
    }
    if (slot.meta.recording && !slot.rot) {
      slot.rot = this.timers.setInterval(() => { this.rotate(meetingId).catch(() => {}); }, this.opts.segmentMs);
      if (slot.rot.unref) slot.rot.unref();
    }
    this.writeMeta(slot.dir, slot.meta);
    return slot.meta;
  }

  // Manual stop: the segment so far goes to disk and no rotation restarts it.
  async stopRecording(meetingId) {
    const slot = this.live.get(meetingId);
    if (!slot) return null;
    slot.want = false;
    if (slot.rot) { this.timers.clearInterval(slot.rot); slot.rot = null; }
    return this.saveSegment(meetingId);
  }

  // Saves what has been recorded so far (getRecording stops it) as the next
  // segment. Serialised per meeting.
  saveSegment(meetingId) {
    const slot = this.live.get(meetingId);
    if (!slot) return Promise.resolve(null);
    const run = slot.busy.then(async () => {
      if (!slot.meta.recording) return null;
      const n = slot.meta.segments.length + 1;
      const file = 'recording-' + String(n).padStart(3, '0') + '.webm';
      try {
        const f = await this.bot.getRecording(slot.session, { dir: slot.dir, file });
        slot.meta.segments.push({ file, size: f.size, mime: f.mime, saved_at: new Date().toISOString() });
      } catch (e) {
        if (!/no recording/i.test(e.message)) slot.meta.errors.push('save recording: ' + e.message);
      }
      slot.meta.recording = false;
      this.writeMeta(slot.dir, slot.meta);
      return slot.meta;
    });
    slot.busy = run.catch(() => {});
    return run;
  }

  async rotate(meetingId) {
    const slot = this.live.get(meetingId);
    if (!slot || !slot.want) return;
    await this.saveSegment(meetingId);
    try { this.flushTranscript(meetingId, slot.dir); } catch (e) { /* next */ }
    if (slot.want && this.live.has(meetingId)) {
      try { await this.bot.startRecording(slot.session); slot.meta.recording = true; }
      catch (e) { slot.meta.errors.push('restart recording: ' + e.message); }
      this.writeMeta(slot.dir, slot.meta);
    }
  }

  async leaving(m, state = 'ended') {
    const slot = this.live.get(m.meeting_id);
    if (!slot) return null;
    slot.want = false;
    if (slot.rot) { this.timers.clearInterval(slot.rot); slot.rot = null; }
    if (slot.flush) { this.timers.clearInterval(slot.flush); slot.flush = null; }
    await this.saveSegment(m.meeting_id);
    const lines = this.flushTranscript(m.meeting_id, slot.dir);
    Object.assign(slot.meta, { state, ended_at: new Date().toISOString(), transcript_lines: lines });
    this.writeMeta(slot.dir, slot.meta);
    this.live.delete(m.meeting_id);
    return slot.meta;
  }

  // Shutdown (SIGINT, SIGTERM, stdin closed): save every live meeting.
  async flushAll() {
    for (const id of [...this.live.keys()]) await this.leaving({ meeting_id: id }, 'saved_on_shutdown').catch(() => {});
  }

  list() {
    let names = [];
    try { names = fs.readdirSync(this.root); } catch (e) { return []; }
    const out = [];
    for (const folder of names.sort().reverse()) {
      let meta;
      try { meta = JSON.parse(fs.readFileSync(path.join(this.root, folder, 'meta.json'), 'utf8')); } catch (e) { continue; }
      out.push({ folder, state: meta.state, meta });
    }
    return out;
  }

  get(key) {
    const row = this.list().find((r) => r.folder === key || r.meta.meeting_id === key);
    if (!row) throw new Error('No archived meeting ' + key + '. list_past_meetings shows them.');
    const dir = path.join(this.root, row.folder);
    const segs = (row.meta.segments || []).map((s) => ({ ...s, path: path.join(dir, s.file) }));
    return { ...row.meta, folder: dir, segments: segs,
      transcript_json: path.join(dir, 'transcript.json'), transcript_md: path.join(dir, 'transcript.md') };
  }
}
