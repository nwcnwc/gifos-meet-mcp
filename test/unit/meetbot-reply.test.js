// A joined bot answers nothing on its own: a question it hears is a line
// for the assistant (wait_lines, to_bot), and the bot speaks exactly the
// line the assistant hands to say.
//
// The real Meet Bot (test/fixtures/meeting-bot, gifos-apps-source a83ff5c)
// runs in headless Chromium. The page is served from memory, and a stub
// `gifos` stands in for the GifOS host: gifos.ai.chat (Smartest),
// gifos.ai.tts, and gifos.meet. The real MeetingBotDriver and the MCP server
// drive it. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../../src/server.js';
import { loadConfig } from 'gifos-mcp-core/src/config.js';
import { MeetingStore } from 'gifos-mcp-core/src/meetings.js';
import { MeetingBotDriver } from 'gifos-mcp-core/src/driver.js';

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'meeting-bot');
const read = (f) => fs.readFileSync(path.join(APP, f), 'utf8');
const BOT = { name: 'harbor-maple', password: 'quiet-cedar-42' };
const QUESTION = 'Hey bot, what is the capital of France?';

// The host side of the app frame. chat answers from the question it gets;
// tts and meet.speak record what the bot said.
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
        return Promise.resolve({ text: /France/i.test(asked) ? 'The capital of France is Paris.' : 'I am not sure.' });
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
    await new Promise((r) => setTimeout(r, 100));
  }
}

test('a joined bot does not answer "Hey bot, what is the capital of France?" by itself; it speaks the line say gives it', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gifos-mcp-reply-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  // Old model settings in the environment are ignored.
  const cfg = loadConfig({
    GIFOS_MCP_HOME: home,
    GIFOS_URL: 'http://127.0.0.1:19510',
    GIFOS_LLM_URL: 'http://127.0.0.1:9/v1',
    GIFOS_LLM_MODEL: 'local-model',
  });

  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('[app] ' + e.message));
  await page.route('http://localhost/meetbot-reply-test', (route) => route.fulfill({ contentType: 'text/html', body: appPage() }));
  await page.goto('http://localhost/meetbot-reply-test');
  await page.waitForFunction(() => window.MeetingBot && window.MeetingBot.version >= 2);

  // localhost is a secure context, so WebCrypto works. page.route answers it.
  // The real driver, pointed at this page instead of a GifOS desktop.
  const driver = new MeetingBotDriver(cfg, BOT);
  driver.bot = { app: page, frame: page };
  await driver.startRun();
  driver.state = 'ready';

  const meetings = new MeetingStore(home);
  const server = createServer({ cfg, meetings, bot: driver, botName: BOT.name, botPassword: BOT.password });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'unit', version: '1' });
  await Promise.all([server.connect(a), client.connect(b)]);
  t.after(() => client.close());
  const json = async (name, args) => {
    const r = await client.callTool({ name, arguments: args || {} });
    assert.notEqual(r.isError, true, r.content[0].text);
    return JSON.parse(r.content[0].text);
  };

  const joined = await json('join_meeting', { link: 'https://gifos.app/meet/capital-room-1' });
  assert.equal(joined.state, 'live');
  const sid = meetings.get(joined.meeting_id).session_id;

  const appVoice = await page.evaluate(() => {
    const s = window.MeetingBot.status();
    return { speak: s.speak, respond_to_command: s.respond_to_command };
  });
  assert.deepEqual(appVoice, { speak: false, respond_to_command: false }, 'the real app took both switches off');

  await page.evaluate(({ sid, q }) => window.gifos.meet.hear(sid, 'Dana', q), { sid, q: QUESTION });
  await new Promise((r) => setTimeout(r, 1500));
  let host = await page.evaluate(() => window.__host);
  assert.equal(host.chat.length, 0, 'no model was asked');
  assert.deepEqual(host.speak, [], 'the bot said nothing on its own');

  // The assistant answers: say hands Meet Bot the words; Text to speech and
  // the meeting get exactly that line.
  const said = await json('say', { meeting_id: joined.meeting_id, text: 'The capital of France is Paris.' });
  assert.equal(said.spoken, true);
  host = await waitFor(async () => { const h = await page.evaluate(() => window.__host); return h.speak.length ? h : null; }, 5000);
  assert.ok(host, 'the line was played into the meeting');
  assert.deepEqual(host.tts, ['The capital of France is Paris.']);
  assert.equal(host.speak.length, 1);
  assert.equal(host.speak[0].id, sid);
  assert.equal(host.speak[0].mime, 'audio/wav');
  assert.equal(host.chat.length, 0, 'still no model');

  const status = await json('status');
  assert.equal(status.voice.handed, true);
  assert.equal(status.voice.gap, null);
  assert.equal(status.voice.speak, false);
});
