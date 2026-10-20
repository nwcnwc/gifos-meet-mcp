// talk:true starts the listen and respond loop. Mic on and transcribe, with
// talk left off, does not: the bot stays quiet. The gate uses the real Meet
// Bot bundle (test/fixtures/meeting-bot) on http://localhost so WebCrypto
// works. The name in the gate is the fixture word "quill", not a person.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { launchInstalled } from 'gifos-mcp-core';
import { LiveTranscript, watchCaptions } from 'gifos-mcp-core/src/voice/live.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { LoggingMessageNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { createServer } from '../../src/server.js';
import { loadConfig } from 'gifos-mcp-core/src/config.js';
import { MeetingStore } from 'gifos-mcp-core/src/meetings.js';
import { MeetingBotDriver } from 'gifos-mcp-core/src/driver.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP = path.join(ROOT, 'test', 'fixtures', 'meeting-bot');
const read = (f) => fs.readFileSync(path.join(APP, f), 'utf8');
const BOT = { name: 'quill', password: 'quiet-cedar-42' };
const LINE = 'quill are you there';
const REPLY = 'I am here.';
// The bound this test sets. The reply has to land inside it.
const BOUND_MS = 5000;
const PLAIN = 'Turning the microphone on and transcribing does not make the bot answer. talk:true does.';

const STUB = `
window.__host = { chat: [], tts: [], speak: [] };
window.gifos = (function () {
  var subs = { tr: [], pe: [], ch: [], xf: [] };
  var n = 0;
  return {
    launch: function () { return Promise.resolve(null); },
    db: function () { return { get: function () { return Promise.resolve(null); }, put: function () { return Promise.resolve(); } }; },
    ai: {
      models: function () { return Promise.resolve({ available: ['smartest', 'tts', 'stt'] }); },
      chat: function (req) {
        window.__host.chat.push(req);
        var asked = JSON.stringify(req && req.messages || []);
        return Promise.resolve({ text: /quill/i.test(asked) ? ${JSON.stringify(REPLY)} : 'I am not sure.' });
      },
      tts: function (req) {
        window.__host.tts.push(req && req.text);
        return Promise.resolve({ bytes: new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]).buffer, mime: 'audio/wav' });
      }
    },
    aiSetup: function () { return Promise.resolve(); },
    meet: {
      join: function (room) {
        var id = 'mt_' + (++n);
        var code = String(room).replace(/^.*(v=|meet\\/)/, '').replace(/[?&#].*$/, '');
        return Promise.resolve({ meetingId: id, room: code, link: 'https://gifos.app/run.html#v=' + code });
      },
      leave: function () { return Promise.resolve({}); },
      startRecording: function () { return Promise.resolve({ ok: true }); },
      stopRecording: function () { return Promise.resolve({ ok: true }); },
      getRecording: function () { return Promise.resolve({}); },
      sendChat: function () { return Promise.resolve({ ok: true }); },
      transcribe: function () { return Promise.resolve({ ok: true }); },
      sendXfer: function () { return Promise.resolve({}); },
      speak: function (id, audio) {
        window.__host.speak.push({ id: id, text: audio && audio.text, mime: audio && audio.mime, n: audio && audio.bytes ? audio.bytes.byteLength : 0 });
        return Promise.resolve({ spoken: true, text: audio && audio.text });
      },
      watch: function (id, on) { return Promise.resolve({ id: id, watch: !!on }); },
      stopSpeaking: function () { return Promise.resolve({ stopped: true }); },
      raiseHand: function () { return Promise.resolve({ ok: true }); },
      setMic: function () { return Promise.resolve({ ok: true }); },
      setCamera: function () { return Promise.resolve({ ok: true }); },
      onTranscriptLine: function (cb) { subs.tr.push(cb); },
      onParticipants: function (cb) { subs.pe.push(cb); },
      onChat: function (cb) { subs.ch.push(cb); },
      onXfer: function (cb) { subs.xf.push(cb); },
      hear: function (id, by, text) { subs.tr.forEach(function (cb) { cb({ meetingId: id, line: { by: by, text: text, at: Date.now() } }); }); }
    }
  };
})();
`;

function appPage() {
  return read('index.html')
    .replace('<script src="protocol.js"></script>', '<script>' + STUB + '</script><script>' + read('protocol.js') + '</script>')
    .replace('<script src="voice.js"></script>', '<script>' + read('voice.js') + '</script>')
    .replace('<script src="app.js"></script>', '<script>' + read('app.js') + '</script>');
}

async function waitFor(fn, ms) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
}

function oldVoice(settings) {
  return !!(settings && (settings.conversation_voice != null || settings.llm || settings.tts || settings.stt));
}

test('README and the join tools say mic plus transcribe does not make the bot answer', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gifos-mcp-talk-doc-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const cfg = loadConfig({ GIFOS_MCP_HOME: home, GIFOS_URL: 'http://127.0.0.1:19510' });
  const server = createServer({ cfg, meetings: new MeetingStore(home), bot: { async ensureStarted() {}, async info() { return { state: 'ready' }; } } });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'unit', version: '1' });
  await Promise.all([server.connect(a), client.connect(b)]);
  const { tools } = await client.listTools();
  for (const name of ['join_meeting', 'start_meeting', 'set_mic', 'wait_for_speech']) {
    const tool = tools.find((t) => t.name === name);
    assert.ok(tool, name);
    assert.ok(tool.description.includes(PLAIN), name);
  }
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const skill = fs.readFileSync(path.join(ROOT, 'skills', 'gifos-meet', 'SKILL.md'), 'utf8');
  assert.ok(readme.includes(PLAIN), 'README');
  assert.ok(skill.includes(PLAIN), 'skill');
  await client.close();
});

test('mic on and transcribe, with talk left off, does not arm a reply', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gifos-mcp-talk-off-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const cfg = loadConfig({ GIFOS_MCP_HOME: home, GIFOS_URL: 'http://127.0.0.1:19510' });
  const calls = [];
  const bot = {
    async ensureStarted() {},
    async join() { calls.push(['join']); return 'mt_1'; },
    async leave() {},
    async transcribe(id, on) { calls.push(['transcribe', id, on]); },
    async setMic(id, on) { calls.push(['setMic', id, on]); return { applied: true, result: { mic: !!on } }; },
    async setVoice(settings) {
      calls.push(['setVoice', settings]);
      if (oldVoice(settings)) throw new Error('old voice fields');
      return { applied: true, result: { ...settings } };
    },
    async info() { return { state: 'ready', bot_name: 'quill' }; },
  };
  const live = new LiveTranscript(home);
  const server = createServer({ cfg, meetings: new MeetingStore(home), bot, live, botName: 'quill', botPassword: BOT.password });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'unit', version: '1' });
  await Promise.all([server.connect(a), client.connect(b)]);
  const json = async (name, args) => {
    const r = await client.callTool({ name, arguments: args || {} });
    assert.notEqual(r.isError, true, r.content[0].text);
    return JSON.parse(r.content[0].text);
  };
  const joined = await json('join_meeting', { link: 'https://gifos.app/meet/quiet-room-1' });
  assert.equal(joined.transcribing, true);
  assert.equal(joined.talk, undefined);
  await json('set_mic', { meeting_id: joined.meeting_id, on: true });
  const voices = calls.filter((c) => c[0] === 'setVoice').map((c) => c[1]);
  assert.deepEqual(voices, [{ respond_to_command: false, speak: false }]);
  live.append({ meeting_id: joined.meeting_id, speaker: 'guest', text: LINE, kind: 'speech' });
  const waited = await client.callTool({ name: 'wait_for_speech', arguments: { meeting_id: joined.meeting_id, timeout_ms: 200 } });
  assert.equal(waited.isError, true);
  assert.match(waited.content[0].text, /does not make the bot answer/);
  await client.close();
});

test('gate: talk:true, a human says quill, and the bot replies within the bound', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gifos-mcp-talk-gate-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const cfg = loadConfig({ GIFOS_MCP_HOME: home, GIFOS_URL: 'http://127.0.0.1:19510' });
  const { browser } = await launchInstalled((o) => chromium.launch(o), { headless: true }, {});
  t.after(() => browser.close());
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('[app] ' + e.message));
  await page.route('http://localhost/talk-gate', (route) => route.fulfill({ contentType: 'text/html', body: appPage() }));
  await page.goto('http://localhost/talk-gate');
  await page.waitForFunction(() => window.MeetingBot && window.MeetingBot.version >= 2);

  const meetings = new MeetingStore(home);
  const driver = new MeetingBotDriver(cfg, BOT);
  driver.bot = { app: page, frame: page };
  await driver.startRun();
  driver.state = 'ready';
  // The page is already the running app. A caption poll that lands after the
  // page closes sees isClosed() and would call start(), which looks up a store
  // listing and then close()s this bot.
  driver.ensureStarted = async () => {};
  const live = new LiveTranscript(home);
  const captions = watchCaptions({ meetings, bot: driver, live, intervalMs: 50, botName: BOT.name });
  t.after(() => captions.stopAll());

  const server = createServer({
    cfg, meetings, bot: driver, live, captions, botName: BOT.name, botPassword: BOT.password,
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'unit', version: '1' });
  const notes = [];
  client.setNotificationHandler(LoggingMessageNotificationSchema, (note) => notes.push(note));
  await Promise.all([server.connect(a), client.connect(b)]);
  t.after(() => client.close());
  const json = async (name, args) => {
    const r = await client.callTool({ name, arguments: args || {} });
    assert.notEqual(r.isError, true, r.content[0].text);
    return JSON.parse(r.content[0].text);
  };

  // Mic on and transcribing, talk left off: today's behavior, no reply.
  const quiet = await json('join_meeting', { link: 'https://gifos.app/meet/quiet-room-1' });
  assert.equal(quiet.transcribing, true);
  assert.equal(quiet.talk, undefined);
  await json('set_mic', { meeting_id: quiet.meeting_id, on: true });
  const quietSid = meetings.get(quiet.meeting_id).session_id;
  let voice = await page.evaluate(() => {
    const s = window.MeetingBot.status();
    return { speak: s.speak, respond_to_command: s.respond_to_command };
  });
  assert.deepEqual(voice, { speak: false, respond_to_command: false });
  await page.evaluate(({ sid, line }) => window.gifos.meet.hear(sid, 'guest', line), { sid: quietSid, line: LINE });
  await new Promise((r) => setTimeout(r, 1200));
  let host = await page.evaluate(() => window.__host);
  assert.equal(host.chat.length, 0, 'talk left off: no reply was composed');
  assert.deepEqual(host.speak, [], 'talk left off: the bot said nothing');
  await json('end_meeting', { meeting_id: quiet.meeting_id });

  const joined = await json('join_meeting', { link: 'https://gifos.app/meet/talk-room-1', talk: true });
  assert.equal(joined.state, 'live');
  assert.equal(joined.transcribing, true);
  assert.equal(joined.talk, true);
  await json('set_mic', { meeting_id: joined.meeting_id, on: true });
  voice = await page.evaluate(() => {
    const s = window.MeetingBot.status();
    return { speak: s.speak, respond_to_command: s.respond_to_command };
  });
  assert.deepEqual(voice, { speak: true, respond_to_command: true });

  const sid = meetings.get(joined.meeting_id).session_id;
  notes.length = 0;
  const waiting = json('wait_for_speech', { meeting_id: joined.meeting_id, timeout_ms: BOUND_MS });
  await new Promise((r) => setTimeout(r, 30));
  const t0 = Date.now();
  await page.evaluate(({ sid, line }) => window.gifos.meet.hear(sid, 'guest', line), { sid, line: LINE });
  host = await waitFor(async () => {
    const h = await page.evaluate(() => window.__host);
    return h.speak.length ? h : null;
  }, BOUND_MS);
  const elapsed = Date.now() - t0;
  assert.ok(host, 'the bot replied within ' + BOUND_MS + ' ms');
  assert.ok(elapsed <= BOUND_MS, 'reply took ' + elapsed + ' ms, bound is ' + BOUND_MS);
  assert.equal(host.speak[0].text, REPLY);
  assert.equal(host.speak[0].id, sid);
  assert.ok(host.tts.includes(REPLY));

  const heard = await waiting;
  assert.equal(heard.meeting_id, joined.meeting_id);
  assert.equal(heard.talk, true);
  assert.equal(heard.line.speaker, 'guest');
  assert.equal(heard.line.text, LINE);
  assert.ok(notes.some((n) => JSON.stringify(n).includes(LINE)), 'the agent received a talk notification');
});
