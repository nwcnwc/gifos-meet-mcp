// create_meeting and start_meeting after the live run of 2026-10-24: the
// owner's instructions on the meeting, a clean link, and starts that are
// not real or already passed.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../../src/server.js';
import { loadConfig } from 'gifos-mcp-core/src/config.js';
import { MeetingStore } from 'gifos-mcp-core/src/meetings.js';
import { tmpHome } from './fixtures/tmp-home.js';

class FakeBot {
  constructor() { this.calls = []; this.seq = 0; }
  async ensureStarted() {}
  async join(link, password) { this.calls.push(['join', link, password]); return 'mt_' + (++this.seq); }
  async leave() {}
  async transcribe() {}
  async transcript() { return ''; }
  async info() { return { state: 'ready', bot_name: 'notes-test' }; }
}

const GOAL = 'Take notes. Ask each person for one blocker.';
let bot, client;
const call = (name, args = {}) => client.callTool({ name, arguments: args });
const json = (r) => JSON.parse(r.content[0].text);

beforeEach(async () => {
  const home = tmpHome('gifos-meet-findings-');
  bot = new FakeBot();
  const server = createServer({ cfg: loadConfig({ GIFOS_MCP_HOME: home, GIFOS_URL: 'https://gifos.app' }), meetings: new MeetingStore(home), bot });
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'unit', version: '1' });
  await Promise.all([server.connect(a), client.connect(b)]);
});

test('create_meeting keeps the instructions; start_meeting and meeting_status hand them back', async () => {
  const made = json(await call('create_meeting', { name: 'Stand-up', instructions: GOAL }));
  assert.equal(made.instructions, GOAL);
  const started = json(await call('start_meeting', { meeting_id: made.meeting_id }));
  assert.equal(started.state, 'live');
  assert.equal(started.instructions, GOAL);
  assert.equal(json(await call('meeting_status', { meeting_id: made.meeting_id })).instructions, GOAL);
  assert.equal(json(await call('get_meeting_state', { meeting_id: made.meeting_id })).instructions, GOAL);
});

test('start_meeting can set or change the instructions; without any there are none', async () => {
  const plain = json(await call('create_meeting', { name: 'Plain' }));
  assert.equal('instructions' in plain, false);
  const s = json(await call('start_meeting', { meeting_id: plain.meeting_id, instructions: GOAL }));
  assert.equal(s.instructions, GOAL);
  const again = json(await call('start_meeting', { meeting_id: plain.meeting_id, instructions: 'Only transcribe.' }));
  assert.equal(again.note, 'Already live.');
  assert.equal(again.instructions, 'Only transcribe.');
  assert.equal(json(await call('meeting_status', { meeting_id: plain.meeting_id })).instructions, 'Only transcribe.');
  const none = json(await call('create_meeting', { name: 'None' }));
  json(await call('start_meeting', { meeting_id: none.meeting_id }));
  assert.equal('instructions' in json(await call('meeting_status', { meeting_id: none.meeting_id })), false);
  assert.equal((await call('create_meeting', { name: 'Long', instructions: 'z'.repeat(4001) })).isError, true);
});

test('a plain meeting gets the clean /meet/<room> link, and the bot joins that link', async () => {
  const made = json(await call('create_meeting', { name: 'Clean' }));
  assert.match(made.link, /^https:\/\/gifos\.app\/meet\/[0-9a-z]{24}$/);
  assert.equal(made.invite.join_url, made.link);
  const s = json(await call('start_meeting', { meeting_id: made.meeting_id }));
  assert.equal(s.link, made.link);
  assert.equal(bot.calls[0][1], made.link);
});

test('create_meeting refuses a start that is not a real time or has already passed', async () => {
  const bad = await call('create_meeting', { name: 'x', start: '2026-13-45T99:00' });
  assert.equal(bad.isError, true);
  assert.match(bad.content[0].text, /no such date/);
  const past = await call('create_meeting', { name: 'x', start: '2020-01-01T09:00', timezone: 'America/Los_Angeles' });
  assert.equal(past.isError, true);
  assert.match(past.content[0].text, /in the past/);
  const soon = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  assert.equal((await call('create_meeting', { name: 'x', start: soon })).isError, undefined);
  assert.equal(json(await call('list_meetings')).meetings.length, 1, 'refused meetings are not stored');
});

test('join_meeting refuses a link that is not on GifOS at once', async () => {
  const r = await call('join_meeting', { link: 'https://evil.example.com/meet/abc' });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /not on GifOS/);
  assert.equal(bot.calls.length, 0);
});
