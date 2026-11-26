// meet.gifos.app links are accepted: rewritten to gifos.app/meet before any tool sees them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMeetLink, normalizeLinksInTools } from '../../src/links.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../../src/server.js';
import { loadConfig } from 'gifos-mcp-core/src/config.js';
import { MeetingStore } from 'gifos-mcp-core/src/meetings.js';
import { roomFromLink, verifierFromLink, gifosHostAllowed, isBroadcastLink } from 'gifos-mcp-core/src/links.js';
import { tmpHome } from './fixtures/tmp-home.js';

const V = 'a'.repeat(24);

test('meet.gifos.app paths map to gifos.app/meet, keeping query and hash', () => {
  assert.equal(normalizeMeetLink('https://meet.gifos.app/'), 'https://gifos.app/meet/');
  assert.equal(normalizeMeetLink('https://meet.gifos.app/welcome'), 'https://gifos.app/meet#room=welcome');
  assert.equal(normalizeMeetLink('https://meet.gifos.app/welcome/' + V + '?x=1#relay=x'), 'https://gifos.app/meet?x=1#room=welcome&v=' + V + '&relay=x');
  assert.equal(normalizeMeetLink('https://MEET.gifos.app/room-1'), 'https://gifos.app/meet#room=room-1');
});

test('other links pass through untouched', () => {
  for (const l of ['https://gifos.app/meet/welcome', 'http://meet.gifos.app/x', 'https://evil.example/meet.gifos.app/x', 'not a url']) assert.equal(normalizeMeetLink(l), l);
});

test('a normalised link is a link the shared code understands', () => {
  const n = normalizeMeetLink('https://meet.gifos.app/welcome/' + V);
  assert.equal(roomFromLink(n), 'welcome');
  assert.equal(verifierFromLink(n), V);
  assert.equal(gifosHostAllowed(n, 'https://gifos.app'), true);
});

test('the wrap rewrites the link argument and leaves other tools alone', async () => {
  const seen = [];
  const server = { _registeredTools: { a: { handler: async (args) => seen.push(args) }, b: { handler: async (args) => seen.push(args) } } };
  normalizeLinksInTools(server);
  normalizeLinksInTools(server); // twice must not double wrap
  await server._registeredTools.a.handler({ link: 'https://meet.gifos.app/r1', password: 'p' });
  await server._registeredTools.b.handler({ name: 'x' });
  assert.deepEqual(seen, [{ link: 'https://gifos.app/meet#room=r1', password: 'p' }, { name: 'x' }]);
});

test('join_meeting on the real server joins the gifos.app/meet link for a meet.gifos.app link', async () => {
  const home = tmpHome('gifos-mcp-ml-');
  const cfg = loadConfig({ GIFOS_MCP_HOME: home, GIFOS_URL: 'https://gifos.app', GIFOS_VOICE: '0' });
  const meetings = new MeetingStore(home);
  const calls = [];
  const bot = {
    async ensureStarted() {}, async join(link) { calls.push(link); return 'mt_1'; }, async transcribe() {},
    async transcript() { return ''; }, async leave() {}, async info() { return { state: 'ready', bot_name: 'b', password: 'x' }; },
  };
  const server = createServer({ cfg, meetings, bot, botPassword: 'x' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'unit', version: '1' });
  await server.connect(a);
  await client.connect(b);
  const r = await client.callTool({ name: 'join_meeting', arguments: { link: 'https://meet.gifos.app/welcome?x=1' } });
  assert.notEqual(r.isError, true, JSON.stringify(r.content));
  assert.equal(calls[0], 'https://gifos.app/meet?x=1#room=welcome');
  await client.close();
});

test('every link builder emits the fragment form', async () => {
  const room = 'welcome';
  for (const link of [
    normalizeMeetLink('https://meet.gifos.app/' + room),
    normalizeMeetLink('https://meet.gifos.app/' + room + '/' + V),
  ]) {
    const u = new URL(link);
    assert.equal(u.pathname, '/meet');
    assert.equal(u.pathname.includes(room), false);
    assert.equal(new URLSearchParams(u.hash.replace(/^#/, '')).get('room'), room);
  }
  const home = tmpHome('gifos-mcp-frag-');
  const cfg = loadConfig({ GIFOS_MCP_HOME: home, GIFOS_URL: 'https://gifos.app', GIFOS_VOICE: '0' });
  const meetings = new MeetingStore(home);
  const bot = {
    async ensureStarted() {}, async join() { return 'mt_1'; }, async transcribe() {},
    async transcript() { return ''; }, async leave() {}, async info() { return { state: 'ready', bot_name: 'b' }; },
  };
  // A base36 room can contain any single letter. The bot password must not be one, or scrub would rewrite the link before the test reads it.
  const server = createServer({ cfg, meetings, bot, botPassword: 'unit-bot-pw' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'unit', version: '1' });
  await server.connect(a);
  await client.connect(b);
  const open = JSON.parse((await client.callTool({ name: 'create_meeting', arguments: { name: 'Open' } })).content[0].text);
  const ou = new URL(open.link);
  const oroom = new URLSearchParams(ou.hash.replace(/^#/, '')).get('room');
  assert.equal(ou.pathname, '/meet');
  assert.equal(ou.pathname.includes(oroom), false);
  assert.match(ou.hash, /^#room=[0-9a-z]{24}$/);
  const priv = JSON.parse((await client.callTool({ name: 'create_meeting', arguments: { name: 'Private', type: 'admin', host_password: 'host-pass-1' } })).content[0].text);
  const pu = new URL(priv.link);
  const ph = new URLSearchParams(pu.hash.replace(/^#/, ''));
  assert.equal(pu.pathname, '/meet');
  assert.match(ph.get('room'), /^[0-9a-z]{24}$/);
  assert.match(ph.get('v'), /^[a-f0-9]{24}$/);
  assert.equal(pu.pathname.includes(ph.get('room')), false);
  await client.close();
});

test('old path forms and the fragment form both name the room', () => {
  const R = 'Room42';
  const Ver = '3783bb03122c41d92d295bab';
  const rows = [
    ['https://gifos.app/meet/' + R, R, '', false],
    ['https://gifos.app/meet/' + R + '/' + Ver, R, Ver, false],
    ['https://gifos.app/cast/' + R + '/' + Ver, R, Ver, true],
    ['https://gifos.app/meet#room=' + R, R, '', false],
    ['https://gifos.app/meet#room=' + R + '&v=' + Ver, R, Ver, false],
    ['https://gifos.app/cast#room=' + R + '&v=' + Ver + '&at=1', R, Ver, true],
    ['https://gifos.app/run.html#room=' + R + '&v=' + Ver + '&cast=1', R, Ver, true],
    ['https://gifos.app/run.html#room=' + R + '&v=' + Ver, R, Ver, false],
  ];
  for (const [link, room, ver, cast] of rows) {
    assert.equal(normalizeMeetLink(link), link);
    assert.equal(roomFromLink(link), room, link);
    assert.equal(verifierFromLink(link), ver, link);
    assert.equal(isBroadcastLink(link), cast, link);
  }
  // The old page-entry form names no room.
  assert.equal(roomFromLink('https://gifos.app/run.html#v=' + R + '&av=' + Ver + '&bc=1'), '');
  assert.equal(roomFromLink('https://gifos.app/run.html#v=' + Ver), '');
  const fromMeet = normalizeMeetLink('https://meet.gifos.app/' + R);
  assert.equal(new URL(fromMeet).pathname, '/meet');
  assert.equal(roomFromLink(fromMeet), R);
  const hosted = normalizeMeetLink('https://meet.gifos.app/' + R + '/' + Ver);
  assert.equal(hosted, 'https://gifos.app/meet#room=' + R + '&v=' + Ver);
  assert.equal(roomFromLink(hosted), R);
  assert.equal(verifierFromLink(hosted), Ver);
});
