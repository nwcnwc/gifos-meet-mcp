#!/usr/bin/env node
// How this bot stands in its guarded room, read from its own running server (guard_status over the local MCP HTTP
// port). Used by scripts/self-update.sh before and after a restart. No dependencies: the updater copies this file
// out of the checkout it is about to replace and runs the copy.
//
//   node guard-health.mjs [--port 19520] [--env ~/.config/gifos-guard/env] [--fresh 20]
//
// Prints one JSON line and exits 0:
//   { level, role, seated, holding, sibling_age_s, age_s, safe, why }
//   level  0 no answer (server down, starting, or no guard)   1 running, not seated (or its status is stale)
//          2 seated in the room                               3 holds the room (lead or coadmin)
//   safe   restarting this bot now cannot leave the room unheld: it holds the room and its own seat saw a sibling
//          holding it within --fresh seconds, or someone else holds the room (held-by-other).
//          A bot that holds nothing for another reason (waiting, signing-in, taking, locked-out) may be the one about
//          to take the room back, so it is not safe here; self-update.sh lets it update only once it has been stuck
//          like that across rounds.
// Only GIFOS_MCP_HTTP_TOKEN is read from the env file, and it is never printed.
import fs from 'node:fs';
import os from 'node:os';

export const HOLDING = new Set(['lead', 'coadmin']);
export const SEATED = new Set(['lead', 'coadmin', 'taking', 'held-by-other']);
const STALE_S = 30;   // the guard ticks every 3 s; a status this old means its loop is stuck

// status: one entry of guard_status's guards[] (or null). now: ms.
export function verdict(status, now, freshS = 20) {
  if (!status || !status.role) return { level: 0, role: null, seated: false, holding: false, sibling_age_s: null, age_s: null, safe: false, why: 'no guard status' };
  const age = status.at ? (now - Date.parse(status.at)) / 1000 : null;
  const sibAge = status.sibling_seen_at ? (now - Date.parse(status.sibling_seen_at)) / 1000 : null;
  const fresh = age !== null && age <= STALE_S;
  const seated = fresh && (status.seated === true || SEATED.has(status.role));
  const holding = fresh && HOLDING.has(status.role);
  const level = !fresh ? 1 : holding ? 3 : seated ? 2 : 1;
  const r = (v) => (v === null ? null : Math.round(v));
  const out = { level, role: status.role, seated, holding, sibling_age_s: r(sibAge), age_s: r(age) };
  if (!fresh) return { ...out, safe: false, why: 'the guard status is ' + (age === null ? 'missing' : 'stale (' + r(age) + ' s)') };
  if (status.role === 'held-by-other') return { ...out, safe: true, why: 'someone else holds the room: this bot\'s restart takes nothing from it' };
  if (!holding) return { ...out, safe: false, why: 'this bot holds nothing now (' + status.role + ') and may be the one taking the room back' };
  if (!('sibling_seen_at' in status)) return { ...out, safe: false, why: 'the running gifos-mcp-core is too old to report siblings (no sibling_seen_at)' };
  if (sibAge !== null && sibAge <= freshS) return { ...out, safe: true, why: 'a sibling held the room ' + r(sibAge) + ' s ago' };
  return { ...out, safe: false, why: 'this bot holds the room and sees no sibling holding it' + (sibAge === null ? '' : ' (last ' + r(sibAge) + ' s ago)') };
}

function tokenFrom(file) {
  try {
    const m = fs.readFileSync(file, 'utf8').match(/^\s*GIFOS_MCP_HTTP_TOKEN\s*=\s*(.*)$/m);
    return m ? m[1].trim().replace(/^(['"])(.*)\1$/, '$2') : '';
  } catch (e) { return ''; }
}

// One stateless MCP call: the server builds a fresh MCP server per request, so tools/call needs no session.
async function guardStatus(port, token) {
  const res = await fetch('http://127.0.0.1:' + port + '/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'guard_status', arguments: {} } }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const text = await res.text();
  const json = (res.headers.get('content-type') || '').includes('event-stream')
    ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => JSON.parse(l.slice(5))).find((m) => m.id === 1)
    : JSON.parse(text);
  const body = json && json.result && json.result.content && json.result.content[0] && json.result.content[0].text;
  const parsed = body ? JSON.parse(body) : null;
  return (parsed && Array.isArray(parsed.guards) && parsed.guards[0]) || null;
}

async function main(argv) {
  const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
  const port = Number(opt('--port', 19520));
  const envFile = opt('--env', os.homedir() + '/.config/gifos-guard/env');
  const freshS = Number(opt('--fresh', 20));
  let status = null, err = '';
  try { status = await guardStatus(port, tokenFrom(envFile)); } catch (e) { err = String((e && e.message) || e).slice(0, 120); }
  const v = verdict(status, Date.now(), freshS);
  if (err) v.why = 'no answer from the bot on port ' + port + ': ' + err;
  process.stdout.write(JSON.stringify(v) + '\n');
}

if (import.meta.url === 'file://' + fs.realpathSync(process.argv[1] || '')) main(process.argv.slice(2));
