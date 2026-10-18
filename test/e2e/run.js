// End-to-end: a real GifOS, a real MCP client over stdio, a real meeting.
//
//   GIFOS_APP_DIR=../gifos-app MEETING_BOT_SRC=../gifos-apps-source/meeting-bot \
//   E2E_SPEECH_WAV=/path/to/speech.wav npm run test:e2e
//
// 1. Serves GIFOS_APP_DIR on 127.0.0.1:19510; Meeting Bot comes from its store
//    listing, or is packed from MEETING_BOT_SRC and added to that store.
// 2. Starts a relay (RELAY_SCRIPT, on 19511) or uses E2E_RELAY.
// 3. Spawns bin/gifos-meet-mcp.js over stdio and drives it with an MCP client:
//    create_meeting -> start_meeting -> a second headless browser joins as
//    "Alice" and plays speech -> get_transcript is non-empty -> share_content,
//    mute/unmute, list_meetings, status -> end_meeting -> the bot is gone.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { chromium } from 'playwright';
import { launchInstalled } from 'gifos-mcp-core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { packApp, startSite } from './site.js';
import { missingApps } from './listed-apps.js';
import { workDir } from './work.js';
import { SYNTH_STT, SYNTH_TTS, SYNTH_LLM } from './synth.js';
import { expectSpecProblem, heardWords } from './expect.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const SITE_DIR = process.env.GIFOS_APP_DIR ? path.resolve(process.env.GIFOS_APP_DIR) : '';
const BOT_SRC = process.env.MEETING_BOT_SRC ? path.resolve(process.env.MEETING_BOT_SRC) : '';
const SITE_PORT = Number(process.env.E2E_SITE_PORT || 19510);
const RELAY_PORT = Number(process.env.E2E_RELAY_PORT || 19511);
const STT = process.env.E2E_STT || 'whisper';            // whisper | synthetic
const SPEECH = process.env.E2E_SPEECH_WAV ? path.resolve(process.env.E2E_SPEECH_WAV) : ''; // Chromium needs an absolute path
const EXPECT_SPEC = process.env.E2E_EXPECT || '';
const EXPECT = STT === 'synthetic' ? /synthetic speech/i : null;
const PROOF = path.resolve(process.env.E2E_PROOF_DIR || path.join(REPO, '.e2e', 'proof'));
// An already-set GIFOS_URL or E2E_GIFOS_URL is the site under test (the same
// setting the gate and a person use). Otherwise this file serves GIFOS_APP_DIR.
const GIVEN_URL = String(process.env.E2E_GIFOS_URL || process.env.GIFOS_URL || '').replace(/\/$/, '');
const BASE = GIVEN_URL || ('http://127.0.0.1:' + SITE_PORT);
const TRANSCRIPT_WAIT_MS = Number(process.env.E2E_TRANSCRIPT_WAIT_MS || 300000);
const CALL = { timeout: 600000 };
const BOT_LOOK_NAME = 'Notes for Ada';
// A real 2x2 PNG, the bot's picture.
function tinyPng() {
  const T = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = T[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(2, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.from([0, 255, 0, 0, 0, 255, 0, 0, 0, 0, 255, 255, 255, 0]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
} // the first call may install apps and start two browsers

let failures = 0;
const t0 = Date.now();
const stamp = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(6) + 's';
const say = (s) => console.log(stamp() + ' ' + s);
const check = (name, cond, detail) => {
  say((cond ? 'PASS' : 'FAIL') + ' — ' + name + (detail ? '  (' + String(detail).slice(0, 300) + ')' : ''));
  if (!cond) failures++;
  return cond;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (r) => (r && r.content && r.content[0] && r.content[0].text) || '';

function need(cond, msg) { if (!cond) { console.error('e2e setup: ' + msg); process.exit(2); } }

function noiseWav(dest) {
  const rate = 44100, loud = rate * 2, quiet = Math.floor(rate * 1.2);
  const data = Buffer.alloc((loud + quiet) * 2);
  let seed = 1;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return (seed / 0x100000000) * 2 - 1; };
  for (let i = 0; i < loud; i++) data.writeInt16LE((Math.max(-1, Math.min(1, 0.55 * Math.sin(2 * Math.PI * 440 * i / rate) + 0.4 * rnd())) * 32767) | 0, i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(dest, Buffer.concat([h, data]));
}

async function waitPort(port, ms) {
  const net = await import('node:net');
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const ok = await new Promise((r) => { const s = net.connect(port, '127.0.0.1', () => { s.end(); r(true); }); s.on('error', () => r(false)); });
    if (ok) return true;
    await sleep(200);
  }
  return false;
}

async function main() {
  if (!GIVEN_URL) need(SITE_DIR && fs.existsSync(path.join(SITE_DIR, 'run.html')), 'set GIFOS_APP_DIR to a gifos-app checkout (release/0.9.23 or later), or set GIFOS_URL / E2E_GIFOS_URL to a site that already serves one');
  const listed = !!(SITE_DIR && fs.existsSync(path.join(SITE_DIR, 'apps', 'meeting-bot', 'app.json')));
  if (!GIVEN_URL) need(listed || (BOT_SRC && fs.existsSync(path.join(BOT_SRC, 'manifest.json'))),
    'this GifOS store has no meeting-bot listing: set MEETING_BOT_SRC to the meeting-bot source folder (gifos-apps-source)');
  need(STT === 'whisper' || STT === 'synthetic', 'E2E_STT is whisper or synthetic');
  need(STT !== 'whisper' || (SPEECH && fs.existsSync(SPEECH)), 'whisper mode needs E2E_SPEECH_WAV, a WAV generated with Kokoro fp32 (scripts/speech-wav.mjs in gifos-mcp-core)');
  need(!expectSpecProblem(EXPECT_SPEC), expectSpecProblem(EXPECT_SPEC));
  need(STT !== 'whisper' || heardWords('', EXPECT_SPEC).words > 0, 'whisper mode needs E2E_EXPECT, the words in that WAV separated by |; at least 80% of them must be heard');
  fs.mkdirSync(PROOF, { recursive: true });
  const work = workDir('gifos-mcp-e2e-');
  const wav = SPEECH || path.join(work, 'noise.wav');
  if (!SPEECH) noiseWav(wav);
  if (GIVEN_URL && STT === 'synthetic') {
    const missing = await missingApps(BASE, ['stt-synthetic', 'tts-synthetic', 'llm-synthetic']);
    need(missing.length === 0, 'GIFOS_URL ' + BASE + ' is missing ' + missing.join(', ') + '. Those apps have to be listed, or unset GIFOS_URL and use a local checkout.');
  }
  say(GIVEN_URL
    ? ('site ' + BASE + ' (GIFOS_URL); STT ' + STT + '; speech ' + path.basename(wav))
    : ('site ' + BASE + ' from the gifos-app checkout; STT ' + STT + '; speech ' + path.basename(wav)));

  // ---- local GifOS with Meeting Bot in its store (skipped when GIFOS_URL is set) ----
  const logo = GIVEN_URL ? null : fs.readFileSync(path.join(REPO, 'assets', 'logo-512.png'));
  // Meeting Bot from MEETING_BOT_SRC when given, else the site's own store listing.
  const extra = [];
  if (!GIVEN_URL && BOT_SRC) {
    const bot = await packApp(BOT_SRC, SITE_DIR, ['manifest.json', 'index.html', 'app.js', 'protocol.js', 'voice.js', 'help.md', 'CONTROL.md', 'listing.json']);
    extra.push({ slug: 'meeting-bot', ...bot, cover: logo });
  }
  if (!GIVEN_URL && STT === 'synthetic') {
    const apps = [['stt-synthetic', SYNTH_STT], ['tts-synthetic', SYNTH_TTS], ['llm-synthetic', SYNTH_LLM]];
    for (const [slug, files] of apps) {
      const dir = path.join(work, slug);
      fs.mkdirSync(dir);
      for (const [n, t] of Object.entries(files)) fs.writeFileSync(path.join(dir, n), t);
      extra.push({ slug, ...(await packApp(dir, SITE_DIR, ['manifest.json', 'index.html'])), cover: logo });
    }
  }
  let site = null;
  if (!GIVEN_URL) site = await startSite({ siteDir: SITE_DIR, port: SITE_PORT, extraApps: extra });
  else say('using GIFOS_URL ' + BASE + ' (no local site)');
  const listing = JSON.parse(await (await fetch(BASE + '/apps/meeting-bot/app.json')).text());
  check('local GifOS store lists meeting-bot', listing.appId === 'meeting-bot',
    (BOT_SRC ? 'packed from MEETING_BOT_SRC' : 'the site\'s own listing') + ', version ' + listing.version + ', ' + listing.bytes + ' bytes, sha256 ' + String(listing.sha256).slice(0, 12));

  let relayProc = null;
  let relay = process.env.E2E_RELAY || '';
  if (process.env.RELAY_SCRIPT) {
    relay = 'ws://127.0.0.1:' + RELAY_PORT;
    relayProc = spawn(process.execPath, [process.env.RELAY_SCRIPT], { env: { ...process.env, RELAY_PORT: String(RELAY_PORT) }, stdio: ['ignore', 'ignore', 'pipe'] });
    relayProc.stderr.on('data', (d) => process.stdout.write('  [relay] ' + d));
    need(await waitPort(RELAY_PORT, 15000), 'the relay did not start on ' + RELAY_PORT);
  }
  say('relay ' + (relay || '(GifOS default)'));

  // ---- the MCP server, over stdio ----
  const mcpHome = path.join(work, 'mcp-home');
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(REPO, 'bin', 'gifos-meet-mcp.js')],
    env: {
      ...process.env,
      GIFOS_URL: BASE,
      GIFOS_RELAY: relay,
      GIFOS_MCP_HOME: mcpHome,
      GIFOS_STT_APP: STT === 'synthetic' ? 'stt-synthetic' : 'offline-stt-whisper',
      GIFOS_TTS_APP: STT === 'synthetic' ? 'tts-synthetic' : '',
      GIFOS_TTS_ENGINE: STT === 'synthetic' ? 'kokoro' : 'none',
      GIFOS_MCP_SHOTS: PROOF,
    },
    stderr: 'pipe',
  });
  transport.stderr.on('data', (d) => process.stdout.write('  ' + String(d).replace(/\n(?=.)/g, '\n  ')));
  const client = new Client({ name: 'gifos-mcp-e2e', version: '1' });
  let human = null;
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    check('MCP server lists its tools over stdio', tools.length === 31 && names.includes('wait_lines') && names.includes('set_bot_profile') && !names.includes('set_voice') && names.includes('say') && names.includes('schedule_meeting') && names.includes('leave_meeting'), names.join(', '));

    const created = await client.callTool({ name: 'create_meeting', arguments: { name: 'Demo meeting', admin_password: 'owner-key-77' } }, undefined, CALL);
    const meeting = JSON.parse(text(created));
    check('create_meeting returns a link on the local GifOS, a room the host runs, and the invite details',
      meeting.link && meeting.link.startsWith(BASE + '/run.html#v=') && /&av=[0-9a-f]{24}/.test(meeting.link) && meeting.meeting_id &&
      meeting.invite && meeting.invite.join_url === meeting.link && !text(created).includes('owner-key-77'), meeting.link);

    // The operator's name and picture for the bot, set before it joins.
    const face = path.join(work, 'bot-face.png');
    fs.writeFileSync(face, tinyPng());
    const look = await client.callTool({ name: 'set_bot_profile', arguments: { name: BOT_LOOK_NAME, picture_path: face } }, undefined, CALL);
    check('set_bot_profile takes a name and a picture', !look.isError && JSON.parse(text(look)).picture === true, text(look));
    const started = await client.callTool({ name: 'start_meeting', arguments: { meeting_id: meeting.meeting_id } }, undefined, CALL);
    const live = started.isError ? null : JSON.parse(text(started));
    if (!check('start_meeting: the bot installs from the store, joins and transcribes', live && live.state === 'live' && live.transcribing, text(started))) throw new Error('start failed');

    const st = JSON.parse(text(await client.callTool({ name: 'status', arguments: {} }, undefined, CALL)));
    check('status: bot ready, one live meeting, STT app installed', st.bot.state === 'ready' && st.live_meetings.length === 1 && st.bot.stt_ready, JSON.stringify(st));

    // ---- a person joins and talks ----
    human = await launchInstalled((o) => chromium.launch(o), {
      headless: true,
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture=' + wav,
        '--autoplay-policy=no-user-gesture-required'],
    }, {}).then((r) => r.browser);
    const hctx = await human.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['camera', 'microphone'] });
    await hctx.addInitScript({ content: 'try{localStorage.setItem("gifos_name","Alice");localStorage.setItem("gifos_meet_bar","0");sessionStorage.setItem("gifos_appeared","1");' +
      (relay ? 'localStorage.setItem("gifos_relay",' + JSON.stringify(relay) + ');' : '') + '}catch(e){}' });
    // Alice's browser has no speech engine (as in Firefox), so Meet Bot is the
    // one that writes her down. Headless Chromium exposes the API without a
    // working engine, which would make her claim her own voice and write nothing.
    await hctx.addInitScript({ content: 'try{window.webkitSpeechRecognition=undefined;window.SpeechRecognition=undefined;}catch(e){}' });
    const alice = await hctx.newPage();
    alice.on('pageerror', (e) => say('  [alice] ' + e.message));
    await alice.goto(meeting.link + '&DEBUG=on', { waitUntil: 'domcontentloaded', timeout: 90000 });
    await alice.locator('.tile .botbadge').first().waitFor({ timeout: 90000 });
    let tile = '';
    for (let i = 0; i < 40; i++) {
      tile = await alice.locator('.tile', { has: alice.locator('.botbadge') }).first().innerText();
      if (/bot/.test(tile)) break;
      await sleep(500);
    }
    // GifOS joins with the mic off; Alice turns hers on to talk.
    // GifOS 0.9.23b fades the call buttons after 3 s without input; a person
    // moves the pointer to reach them, so the test does too.
    await alice.mouse.move(200, 200); await alice.mouse.move(220, 220);
    await alice.locator('#mic').click();
    const micOn = await alice.waitForSelector('#mic:not(.off)', { timeout: 15000 }).then(() => true, () => false);
    check('Alice turns her microphone on', micOn);
    check('Alice sees the 🤖 bot badge', /bot/.test(tile), tile.replace(/\s+/g, ' '));
    check('Alice sees the bot under the name its operator chose', tile.includes(BOT_LOOK_NAME), tile.replace(/\s+/g, ' '));
    const faceHash = crypto.createHash('sha256').update(fs.readFileSync(face)).digest('hex');
    let shown = '';
    for (let i = 0; i < 60 && shown !== faceHash; i++) {
      shown = await alice.evaluate(() => { const t = [...document.querySelectorAll('.tile')].find((x) => x.querySelector('.botbadge')); const img = t && t.querySelector('img.avatar-img'); return img ? img.getAttribute('data-hash') : ''; });
      if (shown !== faceHash) await sleep(500);
    }
    check('Alice sees the picture its operator chose on the bot tile', shown === faceHash, shown || 'no picture');
    await alice.screenshot({ path: path.join(PROOF, 'alice-sees-bot.png') });

    let transcript = '';
    let heard = { words: 0, hit: 0, ok: false };
    const aliceSaid = (body) => /^Alice: /m.test(body) && (STT === 'synthetic' ? EXPECT.test(body) : heard.ok);
    const end = Date.now() + TRANSCRIPT_WAIT_MS;
    while (Date.now() < end) {
      const r = await client.callTool({ name: 'get_transcript', arguments: { meeting_id: meeting.meeting_id } }, undefined, CALL);
      transcript = r.isError ? '' : text(r);
      if (STT === 'whisper') heard = heardWords(transcript, EXPECT_SPEC);
      if (aliceSaid(transcript)) break;
      await sleep(5000);
    }
    if (!aliceSaid(transcript)) say('status at transcript timeout: ' + text(await client.callTool({ name: 'status', arguments: {} }, undefined, CALL)));
    say('transcript so far:\n' + transcript.split('\n').slice(0, 12).map((l) => '    | ' + l).join('\n'));
    check('get_transcript returns Alice\'s words', aliceSaid(transcript), STT === 'whisper' ? (heard.hit + '/' + heard.words + ' words in ' + EXPECT_SPEC) : ('expect ' + EXPECT));

    if (STT === 'synthetic') {
      const said = await client.callTool({ name: 'say', arguments: { meeting_id: meeting.meeting_id, text: 'Hello from the bot' } }, undefined, CALL);
      const spoken = said.isError ? null : JSON.parse(text(said));
      check('say speaks through the assigned text-to-speech provider', spoken && spoken.spoken === true, text(said));
      // The bot answers nothing on its own: no conversation turn, switches off.
      await sleep(5000);
      const round = JSON.parse(text(await client.callTool({ name: 'status', arguments: {} }, undefined, CALL)));
      const cmds = (round.bot && round.bot.commands) || [];
      const voice = round.voice || {};
      check('status: Meet Bot holds both switches off and spoke no turn of its own',
        voice.handed === true && voice.speak === false && voice.respond_to_command === false && !cmds.some((c) => c.op === 'conversation'),
        JSON.stringify({ voice, commands: cmds }));
    }

    const waited = JSON.parse(text(await client.callTool({ name: 'wait_lines', arguments: { meeting_id: meeting.meeting_id, since: 0, timeout_ms: 1000 } }, undefined, CALL)));
    check('wait_lines returns Alice\'s lines', waited.lines.some((l) => l.speaker === 'Alice' && l.kind === 'speech'), JSON.stringify(waited.lines.slice(0, 3)));

    const shared = await client.callTool({ name: 'share_content', arguments: { meeting_id: meeting.meeting_id, text: 'Agenda for the demo meeting: intro, questions.' } }, undefined, CALL);
    check('share_content answers', !shared.isError, text(shared));
    await alice.locator('#chatbtn').click();
    await alice.locator('#chatlog', { hasText: 'Agenda for the demo meeting' }).waitFor({ timeout: 30000 }).then(() => true, () => false)
      .then((seen) => check('Alice sees the shared text in chat', seen));
    await alice.screenshot({ path: path.join(PROOF, 'alice-chat.png') });

    const muted = JSON.parse(text(await client.callTool({ name: 'mute', arguments: { meeting_id: meeting.meeting_id } }, undefined, CALL)));
    // GifOS 0.9.23 transcribes in every browser and shows no per-tile chip for it.
    check('mute stops transcribing', muted.muted === true && muted.transcribing === false);
    const unmuted = JSON.parse(text(await client.callTool({ name: 'unmute', arguments: { meeting_id: meeting.meeting_id } }, undefined, CALL)));
    check('unmute turns transcribing back on', unmuted.transcribing === true);

    const now = JSON.parse(text(await client.callTool({ name: 'list_meetings', arguments: {} }, undefined, CALL)));
    check('list_meetings shows the live meeting', now.meetings.length === 1 && now.meetings[0].state === 'live');

    const ended = JSON.parse(text(await client.callTool({ name: 'end_meeting', arguments: { meeting_id: meeting.meeting_id } }, undefined, CALL)));
    check('end_meeting: the bot leaves and keeps the transcript', ended.state === 'ended' && ended.transcript_lines >= 1, JSON.stringify(ended));
    const gone = await alice.waitForFunction(() => !document.querySelector('.tile .botbadge'), null, { timeout: 45000 }).then(() => true, () => false);
    check('Alice no longer sees the bot', gone);
    await alice.screenshot({ path: path.join(PROOF, 'alice-after-end.png') });

    const after = await client.callTool({ name: 'get_transcript', arguments: { meeting_id: meeting.meeting_id } }, undefined, CALL);
    check('get_transcript still works after end_meeting', !after.isError && /^Alice: /m.test(text(after)), text(after).slice(0, 200));
  } catch (e) {
    check('suite ran', false, e && e.stack ? e.stack.split('\n').slice(0, 5).join(' | ') : String(e));
  } finally {
    if (human) await human.close().catch(() => {});
    await client.close().catch(() => {});
    if (relayProc) relayProc.kill();
    if (site && site.close) { try { await site.close(); } catch (e) { /* already closed */ } }
  }
  say(failures ? failures + ' FAILURE(S)' : 'ALL PASS');
  say('screenshots in ' + PROOF);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
