#!/usr/bin/env node
// End to end, the Meeting Bot with no browser (GIFOS_BOT_MODE=core): a real MCP client over stdio, a local GifOS site
// and relay, and one person (Alice) in a real Chromium page. The bot joins Alice's meeting with no browser of its own,
// is listed in her People, reads her chat and her shared captions, posts chat she sees, and leaves.
//
// Needs: GIFOS_APP_DIR (a gifos-app checkout that serves js/core/node.js), RELAY_SCRIPT (a local relay script) or
// E2E_RELAY, Playwright's Chromium for Alice. E2E_SITE_PORT / E2E_RELAY_PORT pick the ports.
// The bot runs only a signed core: a release site is signed by GifOS; a local copy is signed with a test key
// (the GifOS signer's sign-core tool, --key <test jwk>) and GIFOS_CORE_KEYS=<that key's public half> is set here.
// Against an unsigned site, join_meeting is refused with the SDK's sentence (that is the refusal check).
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { peopleBrowser, personIn, sleep } from './people.js';
import { workDir } from './work.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const SITE_DIR = process.env.GIFOS_APP_DIR ? path.resolve(process.env.GIFOS_APP_DIR) : '';
const SITE_PORT = Number(process.env.E2E_SITE_PORT || 19520);
const RELAY_PORT = Number(process.env.E2E_RELAY_PORT || 19521);
const BASE = 'http://127.0.0.1:' + SITE_PORT;
const CALL = { timeout: 300000 };
const t0 = Date.now();
const say = (s) => console.log(((Date.now() - t0) / 1000).toFixed(1).padStart(6) + 's ' + s);
let fails = 0, passes = 0;
const check = (name, cond, detail) => { if (cond) passes++; else fails++; console.log((cond ? 'PASS — ' : 'FAIL — ') + name + (cond || detail === undefined ? '' : '  ' + String(detail).slice(0, 600))); return cond; };
const text = (r) => (r && r.content && r.content[0] && r.content[0].text) || '';
const until = async (fn, ms) => { const end = Date.now() + ms; let v; for (;;) { try { v = await fn(); } catch (e) { v = null; } if (v) return v; if (Date.now() > end) return null; await sleep(500); } };
const need = (c, m) => { if (!c) { console.error('e2e setup: ' + m); process.exit(2); } };

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.gif': 'image/gif', '.wasm': 'application/wasm' };
function serve(root, port) {
  const srv = http.createServer((q, r) => {
    let p = decodeURIComponent(new URL(q.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
    const f = path.join(root, p);
    if (!f.startsWith(root)) { r.writeHead(403); r.end(); return; }
    fs.readFile(f, (e, b) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); r.end(b); });
  });
  return new Promise((res) => srv.listen(port, '127.0.0.1', () => res(srv)));
}

async function main() {
  need(SITE_DIR && fs.existsSync(path.join(SITE_DIR, 'js', 'core', 'node.js')), 'set GIFOS_APP_DIR to a gifos-app checkout with the GifOS core (js/core/node.js)');
  need(process.env.RELAY_SCRIPT || process.env.E2E_RELAY, 'set RELAY_SCRIPT (a local relay script) or E2E_RELAY');
  const work = workDir('gifos-mcp-e2e-core-');
  const site = await serve(SITE_DIR, SITE_PORT);
  let relayProc = null, relay = process.env.E2E_RELAY || '';
  if (process.env.RELAY_SCRIPT) {
    relay = 'ws://127.0.0.1:' + RELAY_PORT;
    relayProc = spawn(process.execPath, [process.env.RELAY_SCRIPT], { env: { ...process.env, RELAY_PORT: String(RELAY_PORT) }, stdio: ['ignore', 'ignore', 'ignore'] });
    await sleep(1500);
  }
  say('site ' + BASE + ', relay ' + relay);
  const room = 'core-e2e-' + Date.now().toString(36);
  const link = BASE + '/run.html#room=' + room + '&relay=' + encodeURIComponent(relay);

  const browser = await peopleBrowser(process.env.E2E_PEOPLE_WS || '');
  const alice = await personIn(browser, 'Alice', say);
  await alice.page.goto(link, { waitUntil: 'domcontentloaded' });
  const seated = await until(() => alice.page.evaluate(() => !!(window.__gifosVideo && window.__gifosVideo.meshCoord && window.__gifosVideo.meshCoord())), 60000);
  check('Alice is seated in her meeting (a real Chromium page)', !!seated);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(REPO, 'bin', 'gifos-meet-mcp.js')],
    env: { ...process.env, GIFOS_BOT_MODE: 'core', GIFOS_URL: BASE, GIFOS_RELAY: relay, GIFOS_MCP_HOME: path.join(work, 'mcp-home'), GIFOS_BOT_NAME: 'Meeting notes', GIFOS_MCP_LAZY: '1' },
    stderr: 'pipe',
  });
  transport.stderr.on('data', (d) => process.stdout.write('  ' + String(d).replace(/\n(?=.)/g, '\n  ')));
  const client = new Client({ name: 'gifos-mcp-e2e-core', version: '1' });
  try {
    await client.connect(transport);
    const joined = await client.callTool({ name: 'join_meeting', arguments: { link, topic: 'core e2e' } }, undefined, CALL);
    const m = joined.isError ? null : JSON.parse(text(joined));
    check('join_meeting seats the bot with no browser', !!(m && m.meeting_id), text(joined));
    if (!m) return;
    const listed = await until(async () => { const n = await alice.page.evaluate(() => window.__gifosVideo.peopleDump().rows.map((r) => r.name)); return n.includes('Meeting notes') ? n : null; }, 60000);
    check('Alice\'s People lists the bot', !!listed, JSON.stringify(listed));
    // Alice's chat and her shared caption reach the bot
    await alice.page.evaluate(() => { const f = window.__gifosVideo; f.setTranscriptForTest({ mode: 'keep', send: true }); });
    await alice.page.evaluate(() => window.__gifosVideo.sayForTest('Alice asks the bot to take notes'));
    await alice.page.evaluate(() => window.__gifosVideo.addTranscript('Alice says the budget is approved'));
    const tr = await until(async () => { const r = await client.callTool({ name: 'get_transcript', arguments: { meeting_id: m.meeting_id } }, undefined, CALL); const t = text(r); return /budget is approved/.test(t) ? t : null; }, 30000);
    check('get_transcript holds Alice\'s shared caption', !!tr, tr);
    const lines = await until(async () => { const r = await client.callTool({ name: 'tail_lines', arguments: { meeting_id: m.meeting_id } }, undefined, CALL); const t = text(r); return /take notes/.test(t) ? t : null; }, 30000);
    check('the bot\'s lines hold Alice\'s chat', !!lines, lines);
    // the bot's chat reaches Alice
    const sent = await client.callTool({ name: 'send_chat', arguments: { meeting_id: m.meeting_id, text: 'Notes are on. (no browser)' } }, undefined, CALL);
    check('send_chat answers ok', !sent.isError, text(sent));
    const got = await until(async () => { const c = await alice.page.evaluate(() => window.__gifosVideo.chatTexts()); return c.some((x) => /Notes are on/.test(x)) ? c : null; }, 30000);
    check('Alice sees the bot\'s chat line', !!got, JSON.stringify(got));
    // a voice tool says plainly what the no-browser bot lacks
    const spoke = await client.callTool({ name: 'say', arguments: { meeting_id: m.meeting_id, text: 'hello' } }, undefined, CALL);
    check('say (voice) reports its gap instead of failing silently', !!spoke.isError && /interject|voice|spoken/i.test(text(spoke)), text(spoke));
    const left = await client.callTool({ name: 'leave_meeting', arguments: { meeting_id: m.meeting_id } }, undefined, CALL);
    check('leave_meeting answers ok', !left.isError, text(left));
    const gone = await until(async () => { const n = await alice.page.evaluate(() => window.__gifosVideo.peopleDump().rows.map((r) => r.name)); return n.includes('Meeting notes') ? null : n; }, 30000);
    check('Alice\'s People drops the bot', !!gone, JSON.stringify(gone));
  } finally {
    await client.close().catch(() => {});
    await browser.close().catch(() => {});
    if (relayProc) relayProc.kill('SIGTERM');
    site.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
}

main().catch((e) => { fails++; console.log('FAIL — the run finished: ' + String((e && e.stack) || e).slice(0, 800)); }).finally(() => {
  console.log('\n' + passes + ' PASS / ' + fails + ' FAIL');
  process.exit(fails || !passes ? 1 : 0);
});
