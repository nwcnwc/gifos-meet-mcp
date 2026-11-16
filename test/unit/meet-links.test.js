// meet.gifos.app links are accepted: rewritten to gifos.app/meet before any tool sees them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMeetLink, normalizeLinksInTools } from '../../src/links.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../../src/server.js';
import { loadConfig } from 'gifos-mcp-core/src/config.js';
import { MeetingStore } from 'gifos-mcp-core/src/meetings.js';
import { roomFromLink, verifierFromLink, gifosHostAllowed } from 'gifos-mcp-core/src/links.js';
import { tmpHome } from './fixtures/tmp-home.js';

const V = 'a'.repeat(24);

test('meet.gifos.app paths map to gifos.app/meet, keeping query and hash', () => {
  assert.equal(normalizeMeetLink('https://meet.gifos.app/'), 'https://gifos.app/meet/');
  assert.equal(normalizeMeetLink('https://meet.gifos.app/welcome'), 'https://gifos.app/meet/welcome');
  assert.equal(normalizeMeetLink('https://meet.gifos.app/welcome/' + V + '?x=1#v=ignored'), 'https://gifos.app/meet/welcome/' + V + '?x=1#v=ignored');
  assert.equal(normalizeMeetLink('https://MEET.gifos.app/room-1'), 'https://gifos.app/meet/room-1');
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
  assert.deepEqual(seen, [{ link: 'https://gifos.app/meet/r1', password: 'p' }, { name: 'x' }]);
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
  assert.equal(calls[0], 'https://gifos.app/meet/welcome?x=1');
  await client.close();
});
