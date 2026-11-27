#!/usr/bin/env node
// A 24/7 GifOS channel run by an MCP client. No language model: this script calls the same gifos-meet-mcp tools any
// AI assistant can call (open_booth, publish_to_tv, play_video, booth_status), on a timer. See README.md here.
//
//   node examples/channel/channel.mjs <channel.json>
//
// channel.json (paths absolute or relative to the file; see channel.example.json):
//   room           my-channel              the broadcast room's name (a-z 0-9 -)
//   hostPwFile     host.pw                 the room's host password (mode 0600). Whoever knows it owns the channel.
//   credentials    pass.gif                optional: a GifOS credentials GIF (a plan or pass) for the room
//   name           My Channel              the host name viewers see
//   videos         videos                  a folder of video files (played in name order) ...
//   playlist       playlist.json           ... or a list [{ "file": "a.webm" }, ...] of files in that folder
//   listing        { title, description, thumbnail }   optional: list the channel on gifos.tv (thumbnail: a picture file)
//   stateDir       state                   health.json, position.json and the server's home (booth profile)
//   site           https://gifos.app       optional: another GifOS site
//   chrome         /usr/bin/chromium       optional: the browser (else Chrome, Edge or Playwright's Chromium)
//   yieldToPeople  true                    optional filler mode: a person who takes the Stage has it; the videos go on after
//
// It exits non-zero when the channel cannot stay on air; run it under a supervisor that restarts it (systemd units
// here). A restart starts the same video at the second it had reached.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const CFG = path.resolve(process.argv[2] || 'channel.json');
const at = (p) => (p ? path.resolve(path.dirname(CFG), p) : '');
const cfg = JSON.parse(fs.readFileSync(CFG, 'utf8'));
const STATE = at(cfg.stateDir || 'state');
const HEALTH = path.join(STATE, 'health.json');
const POS = path.join(STATE, 'position.json');
const SERVER = fileURLToPath(new URL('../../bin/gifos-meet-mcp.js', import.meta.url));
const STATUS_MS = 10000;
const OFF_AIR_MAX_MS = 3 * 60 * 1000;     // no video going out this long: exit, the supervisor starts a fresh run
fs.mkdirSync(STATE, { recursive: true });

const log = (ev, o) => console.log(JSON.stringify({ t: new Date().toISOString(), ev, ...(o || {}) }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };
const writeJson = (f, o) => { fs.writeFileSync(f + '.tmp', JSON.stringify(o)); fs.renameSync(f + '.tmp', f); };

function videos() {
  const dir = at(cfg.videos || 'videos');
  const names = cfg.playlist ? readJson(at(cfg.playlist), []).map((c) => c && c.file).filter(Boolean)
    : fs.readdirSync(dir).filter((f) => /\.(webm|mp4|mkv|mov|ogv)$/i.test(f)).sort();
  return names.map((f) => path.join(dir, f)).filter((f) => fs.existsSync(f));
}

const client = new Client({ name: 'gifos-channel', version: '1.0.0' });
async function call(name, args) {
  const r = await client.callTool({ name, arguments: args || {} });
  const text = (r.content || []).map((c) => c.text || '').join('');
  if (r.isError) throw new Error(name + ': ' + text);
  try { return JSON.parse(text); } catch (e) { return { text }; }
}

let stopping = false;
async function stop(code, why) {
  if (stopping) return;
  stopping = true;
  log('stop', { why });
  try { await Promise.race([call('close_booth', { booth_id: cfg.room }), sleep(15000)]); } catch (e) { /* the server goes anyway */ }
  try { await client.close(); } catch (e) { /* closing */ }
  process.exit(code);
}
process.on('SIGTERM', () => stop(0, 'SIGTERM'));
process.on('SIGINT', () => stop(0, 'SIGINT'));

async function main() {
  const files = videos();
  if (!files.length) throw new Error('no videos to play');
  const env = { ...process.env, GIFOS_MCP_HOME: path.join(STATE, 'mcp-home'), GIFOS_MCP_LAZY: '1', GIFOS_TTS_ENGINE: 'none' };   // no meeting bot browser and no voice: only the booth
  if (cfg.site) env.GIFOS_URL = cfg.site;
  if (cfg.chrome) env.GIFOS_CHROME = cfg.chrome;
  const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER], env, stderr: 'inherit' });
  transport.onclose = () => { if (!stopping) { log('server.gone'); process.exit(1); } };
  await client.connect(transport);
  log('server', { tools: (await client.listTools()).tools.length });

  const opened = await call('open_booth', {
    room: cfg.room, host_password: fs.readFileSync(at(cfg.hostPwFile), 'utf8').trim(),
    name: cfg.name || undefined, credentials: cfg.credentials ? at(cfg.credentials) : undefined,
  });
  log('open', { link: opened.link, host: opened.host, page: opened.page_version });

  // Start where the last run was: the same file, the same second, then the rest of the list in order.
  const pos = readJson(POS, null);
  let order = files, startAt = 0;
  const k = pos ? files.findIndex((f) => path.basename(f) === pos.file) : -1;
  if (k >= 0) { order = files.slice(k).concat(files.slice(0, k)); startAt = Math.max(0, (pos.pos || 0) - 2); }
  const p = await call('play_video', { booth_id: cfg.room, paths: order, loop: true, start_at_s: startAt || undefined, yield_to_people: !!cfg.yieldToPeople });
  log('play', { file: p.video && p.video.file, at: startAt, files: order.length });

  // gifos.tv: list it once (the booth's profile remembers); a changed title or description goes out with update_tv_listing.
  if (cfg.listing && cfg.listing.title) {
    const s = (await call('booth_status', { booth_id: cfg.room })).booths[0];
    const want = { title: cfg.listing.title, description: cfg.listing.description || '' };
    const seen = readJson(path.join(STATE, 'listed.json'), null);
    const thumb = cfg.listing.thumbnail ? { thumbnail_path: at(cfg.listing.thumbnail) } : { thumbnail_from_stage: true };
    let r = null;
    if (!s.gifos_tv || !s.gifos_tv.listed) r = await call('publish_to_tv', { booth_id: cfg.room, ...want, ...thumb });
    else if (!seen || seen.title !== want.title || seen.description !== want.description) r = await call('update_tv_listing', { booth_id: cfg.room, ...want });
    if (r) { writeJson(path.join(STATE, 'listed.json'), want); log('gifos_tv', { url: r.url }); } else log('gifos_tv', { listed: true, url: s.gifos_tv.url });
  }

  let onAirAt = Date.now(), lastFile = '';
  for (;;) {
    await sleep(STATUS_MS);
    const s = (await call('booth_status', { booth_id: cfg.room })).booths[0];
    if (s.error) throw new Error('the booth stopped: ' + s.error);
    if (s.on_air || s.yielding_to) onAirAt = Date.now();   // a person on the Stage is on air too
    else if (Date.now() - onAirAt > OFF_AIR_MAX_MS) throw new Error('off air for ' + Math.round((Date.now() - onAirAt) / 1000) + ' s');
    if (s.video && s.video.file) {
      writeJson(POS, { file: s.video.file, pos: s.video.pos_s, t: new Date().toISOString() });
      if (s.video.file !== lastFile) { lastFile = s.video.file; log('now', { file: s.video.file, length_s: s.video.length_s }); }
    }
    writeJson(HEALTH, { t: new Date().toISOString(), pid: process.pid, host: s.host, relay: s.relay, on_air: s.on_air, video: s.video, watching: s.watching, yielding_to: s.yielding_to, gifos_tv: s.gifos_tv, page_version: s.page_version, counts: s.counts, last_event: s.last_event });
  }
}

main().catch((e) => { log('fatal', { m: String((e && e.message) || e).slice(0, 400) }); stop(1, 'fatal'); });
