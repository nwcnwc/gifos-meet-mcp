// Passwords are secrets: the server tells the agent to keep them in a vault, and masks the host passwords it holds.
// (Harness as tools.test.js: a real MCP client/server pair, with the
// browser replaced by a fake bot that records what it was asked to do.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../../src/server.js';
import { loadConfig } from 'gifos-mcp-core/src/config.js';
import { MeetingStore } from 'gifos-mcp-core/src/meetings.js';
import { tmpHome } from './fixtures/tmp-home.js';

class FakeBot {
  constructor() { this.calls = []; this.lines = {}; this.seq = 0; this.started = 0; this.failJoin = ''; }
  async ensureStarted() { this.started++; }
  async join(link, password) {
    this.calls.push(['join', link, password]);
    if (this.failJoin) throw new Error(this.failJoin);
    const id = 'mt_' + (++this.seq);
    this.lines[id] = [];
    return id;
  }
  async leave(id) { this.calls.push(['leave', id]); }
  async transcribe(id, on) { this.calls.push(['transcribe', id, on]); }
  async say(id, text) { this.calls.push(['say', id, text]); }
  async transcript(id) { this.calls.push(['transcript', id]); return (this.lines[id] || []).join('\n'); }
  async info() { return { state: 'ready', bot_name: 'notes-test' }; }
}

let home, cfg, meetings, bot, client;

async function connect() {
  const server = createServer({ cfg, meetings, bot });
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'unit', version: '1' });
  await Promise.all([server.connect(a), client.connect(b)]);
}
const call = (name, args = {}) => client.callTool({ name, arguments: args });
const text = (r) => r.content[0].text;
const json = (r) => JSON.parse(text(r));
const ADMIN = 'owner-key-77';

async function mint(name = 'Demo meeting') {
  const r = json(await call('create_meeting', { name, admin_password: ADMIN }));
  assert.deepEqual(Object.keys(r).sort(), ['host_runs_room', 'invite', 'link', 'meeting_id']);
  assert.equal(r.host_runs_room, true);
  assert.equal(r.invite.join_url, r.link);
  assert.equal(JSON.stringify(r).includes(ADMIN), false);
  const listed = json(await call('list_meetings'));
  const row = listed.meetings.find((m) => m.link === r.link);
  assert.ok(row, 'the minted room is on the meeting list');
  assert.equal(row.topic, name);
  assert.equal('room_password' in row, false);
  assert.equal('admin_password' in row, false);
  return { link: r.link, meeting_id: row.meeting_id, topic: name };
}

beforeEach(async () => {
  home = tmpHome('gifos-mcp-unit-');
  cfg = loadConfig({ GIFOS_MCP_HOME: home, GIFOS_URL: 'http://127.0.0.1:19510/' });
  meetings = new MeetingStore(home);
  bot = new FakeBot();
  await connect();
});

test("a kept host password is masked in a reply (a transcript line), and shown only by get_host_password", async () => {
  const noPw = json(await call("create_meeting", { name: "Board", type: "admin" }));
  const kept = Object.values(JSON.parse(fs.readFileSync(noPw.host_password.kept_in, "utf8")))[0].password;
  bot.room = async (sid, op, a) => (op === "host.signin" ? { bot_is_host: a.password === kept } : {});
  await call("start_meeting", { meeting_id: noPw.meeting_id });
  bot.lines.mt_1.push("Alice: the admin password is " + kept);
  const t = text(await call("get_transcript", { meeting_id: noPw.meeting_id }));
  assert.equal(t.includes(kept), false, "the kept password never comes back in a reply");
  assert.match(t, /\[redacted\]/);
  assert.equal(json(await call("get_host_password", { meeting_id: noPw.meeting_id })).host_password, kept);
});

test("a host password given on a join is masked from then on", async () => {
  const c = await mint();
  bot.room = async (sid, op) => (op === "host.signin" ? { bot_is_host: true } : {});
  await call("start_meeting", { meeting_id: c.meeting_id, host_password: "given-host-pw-91" });
  bot.lines.mt_1.push("Bob: it is given-host-pw-91");
  assert.equal(text(await call("get_transcript", { meeting_id: c.meeting_id })).includes("given-host-pw-91"), false);
});

test("the briefing and every password field tell the agent to keep passwords in a secrets vault", async () => {
  assert.match(client.getInstructions() || "", /keep every password \(host and room\) in a secrets vault/);
  assert.match(client.getInstructions() || "", /Passwords are secrets \(the host password and every room password\)/);
  const { tools } = await client.listTools();
  const missing = [];
  for (const t of tools) for (const [k, v] of Object.entries((t.inputSchema && t.inputSchema.properties) || {})) {
    if (/password/.test(k) && !/secrets vault/.test(v.description || "")) missing.push(t.name + "." + k);
  }
  assert.deepEqual(missing, []);
  assert.match(tools.find((t) => t.name === "get_host_password").description, /secrets vault/);
  const readme = fs.readFileSync(new URL("../../README.md", import.meta.url), "utf8");
  assert.match(readme, /keep every password \(host and room\) in a secrets vault/);
  assert.match(readme, /\*\*Passwords are secrets\*\*/);
});
