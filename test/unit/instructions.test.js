// The owner's goal and instructions for a meeting (gifos-mcp-core keeps them):
// join_meeting takes them, meeting_status hands them back, the schedule
// keeps them per day. Without them nothing changes: the bot transcribes.
// Also checks the daily check-ins recipe Grok Bot reads at install.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../../src/server.js';
import { loadConfig } from 'gifos-mcp-core/src/config.js';
import { MeetingStore } from 'gifos-mcp-core/src/meetings.js';
import { tmpHome } from './fixtures/tmp-home.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LINK = 'http://127.0.0.1:19510/run.html#v=checkin-alex';
const PW = 'amber-gate-77';
const GOAL = 'Daily check-in for the owner. Ask: what did you finish, what is next, anything blocking? Up to two follow-ups each. 15 minutes.';

class FakeBot {
  constructor() { this.calls = []; this.seq = 0; }
  async ensureStarted() {}
  async join(link, password) { this.calls.push(['join', link, password]); return 'mt_' + (++this.seq); }
  async leave(id) { this.calls.push(['leave', id]); }
  async transcribe(id, on) { this.calls.push(['transcribe', id, on]); }
  async say(id, text) { this.calls.push(['say', id, text]); }
  async transcript() { return ''; }
  async info() { return { state: 'ready', bot_name: 'notes-test' }; }
}

let home, bot, client;
const call = (name, args = {}) => client.callTool({ name, arguments: args });
const json = (r) => JSON.parse(r.content[0].text);

beforeEach(async () => {
  home = tmpHome('gifos-meet-instr-');
  const cfg = loadConfig({ GIFOS_MCP_HOME: home, GIFOS_URL: 'http://127.0.0.1:19510/' });
  bot = new FakeBot();
  const server = createServer({ cfg, meetings: new MeetingStore(home), bot });
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'unit', version: '1' });
  await Promise.all([server.connect(a), client.connect(b)]);
});

test('join_meeting, schedule_meeting, update_schedule and import_schedule offer an optional instructions field', async () => {
  const { tools } = await client.listTools();
  for (const name of ['join_meeting', 'schedule_meeting', 'update_schedule']) {
    const t = tools.find((x) => x.name === name);
    assert.ok(t.inputSchema.properties.instructions, name);
    assert.equal(t.inputSchema.properties.instructions.maxLength, 4000, name);
    assert.equal((t.inputSchema.required || []).includes('instructions'), false, name);
  }
  const imp = tools.find((x) => x.name === 'import_schedule');
  assert.ok(imp.inputSchema.properties.orders.items.properties.instructions);
});

test('join_meeting with instructions: returned, kept 0600, and handed back by meeting_status', async () => {
  const m = json(await call('join_meeting', { link: LINK, topic: 'Check-in: Alex', instructions: GOAL }));
  assert.equal(m.state, 'live');
  assert.equal(m.instructions, GOAL);
  assert.equal(json(await call('meeting_status', { meeting_id: m.meeting_id })).instructions, GOAL);
  const file = path.join(home, 'meetings.json');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).meetings[0].instructions, GOAL);
  // Nothing in them is run: the bot was only asked to join and transcribe.
  assert.deepEqual(bot.calls.map((c) => c[0]), ['join', 'transcribe']);
});

test('join_meeting without instructions is unchanged: no field, transcribe only', async () => {
  const m = json(await call('join_meeting', { link: LINK }));
  assert.deepEqual(Object.keys(m).sort(), ['created_at', 'ended_at', 'link', 'meeting_id', 'muted', 'start_time', 'started_at', 'state', 'thinking', 'topic', 'transcribing']);
  assert.equal('instructions' in json(await call('meeting_status', { meeting_id: m.meeting_id })), false);
  assert.deepEqual(bot.calls.map((c) => c[0]), ['join', 'transcribe']);
});

test('instructions over 4000 characters are refused and nothing joins', async () => {
  const r = await call('join_meeting', { link: LINK, instructions: 'x'.repeat(4001) });
  assert.equal(r.isError, true);
  assert.equal(bot.calls.length, 0);
});

test('a daily check-in: schedule with instructions, list them, change them, import another', async () => {
  const made = json(await call('create_meeting', { name: 'Check-in: Alex', room_password: PW }));
  const start = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const order = json(await call('schedule_meeting', { link: made.link, room_password: PW, start, recurrence: 'RRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR', timezone: 'America/New_York', instructions: GOAL }));
  assert.equal(order.instructions, GOAL);
  let rows = json(await call('list_schedule')).orders;
  assert.ok(rows.length >= 1);
  for (const r of rows) assert.equal(r.instructions, GOAL);
  json(await call('update_schedule', { schedule_id: order.schedule_id, instructions: GOAL + ' Ask about the release.' }));
  rows = json(await call('list_schedule')).orders;
  for (const r of rows) assert.equal(r.instructions, GOAL + ' Ask about the release.');
  const other = json(await call('create_meeting', { name: 'Check-in: Sam', room_password: PW }));
  json(await call('import_schedule', { orders: [{ link: other.link, room_password: PW, start, external_id: 'sam-daily', topic: 'Check-in: Sam', instructions: 'Ask Sam.' }] }));
  rows = json(await call('list_schedule')).orders;
  assert.equal(rows.find((r) => r.topic === 'Check-in: Sam').instructions, 'Ask Sam.');
  assert.equal(JSON.stringify(rows).includes(PW), false);
  assert.equal(fs.statSync(path.join(home, 'schedule.json')).mode & 0o777, 0o600);
});

test('the daily check-ins recipe is there, covers each step, and names no private party', () => {
  const file = path.join(ROOT, 'docs', 'recipes', 'daily-checkins.md');
  const doc = fs.readFileSync(file, 'utf8');
  for (const want of ['instructions', 'schedule_meeting', 'RRULE', 'wait_lines', 'say', 'send_chat', 'get_transcript', 'tail_events',
    'consent', 'stop', 'Escalation', 'opt-in', 'report', 'GIFOS_MCP_HOME', 'transcribe only']) {
    assert.ok(doc.toLowerCase().includes(want.toLowerCase()), want);
  }
  // Names that must never appear in this public repo, kept as SHA-256 of the
  // lower-case word so the check does not name them either.
  const banned = new Set(['27d97328cdf4f5467b5088f7f882ba0820130d653d7ea24a8411377696bac5b4','78694ef0d6afe7e41ccd4e32c5a0a432401aeb460224cff6ad626f17f42c9dde','1b94e66f181af67da7b20d86f4d3985799095913f727287e5f086fb8db5e89e6']);
  const words = doc.toLowerCase().match(/[a-z0-9]+/g) || [];
  for (const w of words) assert.equal(banned.has(crypto.createHash('sha256').update(w).digest('hex')), false, 'a private name in the recipe');
  assert.equal(/\+?\d{3}[ .-]\d{3}[ .-]\d{4}/.test(doc), false, 'a phone number in the recipe');
  assert.equal(/[\w.+-]+@[\w-]+\.[\w.]+/.test(doc), false, 'an email address in the recipe');
  const skill = fs.readFileSync(path.join(ROOT, 'skills', 'gifos-meet', 'SKILL.md'), 'utf8');
  assert.match(skill, /docs\/recipes\/daily-checkins\.md/);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(pkg.files.includes('docs/recipes'), 'the recipe ships with the package');
});
