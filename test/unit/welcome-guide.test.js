// The welcome guide configs (examples/welcome-guide): the live bot stays voiceless and without an avatar (it runs on
// a small computer), the demo pair has both, and no config holds a secret or a private link.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'examples', 'welcome-guide');
const load = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
const SECRET = /^(key|api_key|apikey|token|secret|password|authorization)$/i;
function secrets(o, at = '') {
  const out = [];
  for (const [k, v] of Object.entries(o || {})) {
    if (SECRET.test(k) && v) out.push(at + k);
    if (v && typeof v === 'object') out.push(...secrets(v, at + k + '.'));
  }
  return out;
}

test('the live welcome bot has no voice and no avatar', () => {
  const c = load('live.bot.json');
  assert.equal(c.voice.provider, 'none');
  assert.equal(c.avatar.enabled, false);
  assert.equal(c.brain.provider, 'fixed');
});

test('the demo pair has voice and avatar on, and leads by rank', () => {
  const mia = load('mia.demo.bot.json'); const leo = load('leo.demo.bot.json');
  for (const c of [mia, leo]) { assert.notEqual(c.voice.provider, 'none'); assert.equal(c.avatar.enabled, true); }
  assert.deepEqual([mia.rank, leo.rank], [0, 1]);
  assert.deepEqual(mia.siblings, { Leo: 1 }); assert.deepEqual(leo.siblings, { Mia: 0 });
});

test('every config: a first name, says it is a bot, live knowledge, guardrails, no secrets, a placeholder link', () => {
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.bot.json'))) {
    const c = load(f);
    assert.match(c.name, /^[A-Z][a-z]+$/, f);
    assert.match(c.declaration, /bot/i, f);
    assert.deepEqual(c.prompt.knowledge, ['https://gifos.app/llms.txt', 'https://gifos.app/meet/llms.txt'], f);
    assert.ok(c.prompt.guardrails.some((g) => /personal data/.test(g)), f);
    assert.ok(c.prompt.guardrails.some((g) => /bot/.test(g)), f);
    assert.deepEqual(secrets(c), [], f);
    assert.equal(c.link, 'https://gifos.app/meet/your-room', f);
  }
});
