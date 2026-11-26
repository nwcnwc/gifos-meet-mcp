// The two kinds of meeting, in the words the GifOS screens use: a public majority-rules meeting (open meeting) is type open,
// "Host a private meeting" (a private, hosted meeting) is type admin. The API values stay open / admin. "public" and
// "majority-rules" (the retired "open-floor" still read) are one kind, "private" and "hosted" the other, and there are only two kinds: no tool text, briefing
// or README line may put a word of one beside a word of the other. create_meeting takes the screen words too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../../src/server.js';
import { INSTRUCTIONS } from '../../src/briefing.js';
import { loadConfig } from 'gifos-mcp-core/src/config.js';
import { MeetingStore } from 'gifos-mcp-core/src/meetings.js';
import { tmpHome } from './fixtures/tmp-home.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PUB = '(?:public|open[- ]floor|majority[- ]rules)', PRIV = '(?:private|hosted)', GAP = '[\\s,;:/()–—-]*(?:and|or|&)?[\\s,;:/()–—-]*';
const MIX = new RegExp('\\b' + PUB + GAP + PRIV + '\\b|\\b' + PRIV + GAP + PUB + '\\b', 'i');
const OLD = [/\bopen[- ]floor\b/i, /\bopen rooms?\b/i, /\bopen-room\b/i, /\badmin rooms?\b/i, /\ba room with a host\b/i, /\bOPEN room\b/, /\bADMIN room\b/];

async function open() {
  const home = tmpHome('gifos-meet-kind-');
  const cfg = loadConfig({ GIFOS_MCP_HOME: home, GIFOS_URL: 'http://127.0.0.1:19510/', GIFOS_BOT_NAME: 'notes-test', GIFOS_BOT_PASSWORD: 'quiet-cedar-42' });
  const bot = { ensureStarted: async () => {}, info: async () => ({ state: 'ready' }) };
  const server = createServer({ cfg, meetings: new MeetingStore(home), bot });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'unit', version: '1' });
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, done: async () => { await client.close(); fs.rmSync(home, { recursive: true, force: true }); } };
}
const textsOf = (list) => list.flatMap((t) => [[t.name, (t.title || '') + ' ' + (t.description || '')]]
  .concat(Object.entries((t.inputSchema && t.inputSchema.properties) || {}).map(([p, s]) => [t.name + '.' + p, s.description || ''])));
const clean = (where, text) => {
  for (const re of OLD) assert.equal(re.test(text), false, where + ' says ' + re + ': ' + (text.match(new RegExp('.{0,80}' + re.source + '.{0,80}', 'i')) || [''])[0]);
  const m = text.match(new RegExp('.{0,60}(?:' + MIX.source + ').{0,60}', 'i'));
  assert.equal(m, null, where + ' mixes the two kinds: ' + (m && m[0]));
};

test('create_meeting names both kinds the way the screens do; type keeps the values open and admin', async () => {
  const { client, done } = await open();
  const { tools } = await client.listTools();
  await done();
  const c = tools.find((t) => t.name === 'create_meeting');
  const type = c.inputSchema.properties.type;
  assert.deepEqual(type.enum, ['open', 'admin'], 'the API values are unchanged');
  assert.match(type.description, /open[^.]*public majority-rules meeting/);
  assert.match(type.description, /admin[^.]*private meeting/);
  assert.match(c.description, /public majority-rules meeting \(open meeting\)/);
  assert.match(c.description, /Host a private meeting/);
});

test('no tool text, briefing paragraph or README line uses an old room name or mixes the two kinds', async () => {
  const { client, done } = await open();
  const { tools } = await client.listTools();
  await done();
  for (const [where, text] of textsOf(tools)) clean(where, text);
  INSTRUCTIONS.split('\n\n').forEach((p, i) => clean('briefing paragraph ' + (i + 1), p));
  fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8').split('\n').forEach((l, i) => clean('README.md:' + (i + 1), l));
  for (const w of ['public majority-rules meeting (open meeting)', 'private meeting', 'Host a private meeting', 'type admin', 'type open']) assert.ok(INSTRUCTIONS.includes(w), 'the briefing says ' + w);
  assert.ok(['a public hosted meeting', 'private open-floor', 'public or private meetings'].every((s) => MIX.test(s)));
  assert.ok(['a private, hosted meeting', 'a public majority-rules meeting'].every((s) => !MIX.test(s)));
});

test('create_meeting takes the screen words and the old ones for type, and refuses a mixed phrase', async () => {
  const { client, done } = await open();
  const make = async (type) => client.callTool({ name: 'create_meeting', arguments: { name: 'Kind ' + type, type } });
  try {
    for (const t of ['open', 'public', 'open floor', 'Open-floor', 'a public open-floor meeting', 'majority rules', 'a public majority-rules meeting']) {
      const r = await make(t);
      assert.ok(!r.isError, t + ': ' + r.content[0].text);
      assert.equal(JSON.parse(r.content[0].text).host_runs_room, false, t + ' makes a public majority-rules meeting');
    }
    for (const t of ['admin', 'private', 'hosted', 'Host a private meeting', 'a private, hosted meeting']) {
      const r = await make(t);
      assert.ok(!r.isError, t + ': ' + r.content[0].text);
      assert.equal(JSON.parse(r.content[0].text).host_runs_room, true, t + ' makes a private meeting');
    }
    for (const t of ['public hosted', 'private open-floor', 'zoom']) assert.equal((await make(t)).isError, true, t + ' is refused');
  } finally { await done(); }
});

// The role is "host" wherever a person or an agent reads it; "admin" stays only as the API value (type / mode "admin",
// the admin_password parameter name) and in code.
const API_ADMIN = /\b(?:type|mode)[:=]?\s*["'`]?admin\b["'`]?|["'`]admin["'`]|\badmin_password\b|\badmin:|\bfor admin\b|\bopen \/ admin\b|\bopen or admin\b|`admin`/gi;
const sayAdmin = (t) => /\badmins?\b|\bco-admins?\b|Make me admin/i.test(String(t).replace(API_ADMIN, ' '));
function literals(file) {
  const out = [];
  fs.readFileSync(path.join(ROOT, 'src', file), 'utf8').split('\n').forEach((ln, i) => {
    const t = ln.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
    for (const m of ln.replace(/\s\/\/\s.*$/, '').matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
      const v = m[1] ?? m[2] ?? m[3];
      if (/\s/.test(v)) out.push([file + ':' + (i + 1), v]);
    }
  });
  return out;
}

test('the role is "host" in every tool text, message, the briefing and the README; admin only as the API value', async () => {
  const { client, done } = await open();
  const { tools } = await client.listTools();
  await done();
  for (const [where, text] of textsOf(tools)) assert.equal(sayAdmin(text), false, where + ' says admin: ' + text.slice(0, 300));
  for (const f of ['tools.js', 'briefing.js']) for (const [where, v] of literals(f)) {
    const m = String(v).replace(API_ADMIN, ' ').match(/.{0,70}(?:\badmins?\b|Make me admin).{0,70}/i);
    assert.equal(m, null, where + ' says admin: ' + (m && m[0]));
  }
  fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8').split('\n').forEach((l, i) => {
    const m = l.replace(API_ADMIN, ' ').match(/.{0,70}(?:\badmins?\b|Make me admin).{0,70}/i);
    assert.equal(m, null, 'README.md:' + (i + 1) + ' says admin: ' + (m && m[0]));
  });
  assert.ok(INSTRUCTIONS.includes('Make me host') && /host password/.test(INSTRUCTIONS), 'the briefing names the host role');
});

test('create_meeting takes "host" for type admin', async () => {
  const { client, done } = await open();
  try {
    const r = await client.callTool({ name: 'create_meeting', arguments: { name: 'Kind host', type: 'host' } });
    assert.ok(!r.isError, r.content[0].text);
    assert.equal(JSON.parse(r.content[0].text).host_runs_room, true);
  } finally { await done(); }
});

test('a public open-floor meeting can be taken over as host only with a GifOS staff pass, never a plan (not "has no host")', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const brief = INSTRUCTIONS;
  for (const [name, t] of [['README', readme], ['briefing', brief]]) {
    assert.equal(/\bhas no host\b|\bthere is no host\b/i.test(t), false, name + ' still claims an open-floor meeting has no host');
    assert.match(t, /staff pass/, name + ' names the staff pass');
    assert.equal(/\$5\+ (?:subscriber|plan)[^.]*take over|\$5\+ subscription file|capturing a public/i.test(t), false, name + ' still offers taking over to a plan');
    assert.equal(/any plan/.test(t) && /take over as host|Make me host|capture/.test(t) && /\$2 plan can take/.test(t), false);
  }
  // No plan qualifies for Make me host (staff pass only, 2026-11-26).
  assert.doesNotMatch(brief, /\$5 or \$10|\$5\/\$10/);
  assert.doesNotMatch(readme, /\$5 or \$10|\$5\/\$10/);
});
