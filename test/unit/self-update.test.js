// scripts/guard-health.mjs decides when a guard bot may restart itself to update (scripts/self-update.sh): only when
// its restart cannot leave the room unheld.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verdict } from '../../scripts/guard-health.mjs';

const now = Date.parse('2026-11-23T12:00:00Z');
const ago = (s) => new Date(now - s * 1000).toISOString();

test('a bot holding the room may restart only while a sibling held it moments ago', () => {
  const v = verdict({ role: 'lead', at: ago(2), seated: true, sibling_seen_at: ago(3) }, now, 20);
  assert.equal(v.level, 3); assert.equal(v.safe, true);
  assert.equal(verdict({ role: 'coadmin', at: ago(2), seated: true, sibling_seen_at: ago(60) }, now, 20).safe, false, 'sibling seen too long ago');
  assert.equal(verdict({ role: 'lead', at: ago(2), seated: true, sibling_seen_at: null }, now, 20).safe, false, 'alone');
  assert.equal(verdict({ role: 'lead', at: ago(2) }, now, 20).safe, false, 'an older core says nothing about siblings: not safe');
});

test('only a room someone else holds is safe for a bot that holds nothing; a bot about to take it back is not', () => {
  assert.equal(verdict({ role: 'held-by-other', at: ago(1), seated: true }, now).safe, true);
  for (const role of ['taking', 'waiting', 'signing-in', 'locked-out']) {
    const v = verdict({ role, at: ago(1), seated: role === 'taking' }, now, 20);
    assert.equal(v.safe, false, role); assert.equal(v.holding, false);
  }
  assert.equal(verdict({ role: 'taking', at: ago(1), seated: true }, now).level, 2);
  assert.equal(verdict({ role: 'waiting', at: ago(1), seated: false }, now).level, 1);
});

test('a core too old to report siblings says so', () => {
  assert.match(verdict({ role: 'lead', at: ago(1), seated: true }, now).why, /too old/);
});

test('no status or a stale one is never safe', () => {
  assert.deepEqual([verdict(null, now).level, verdict(null, now).safe], [0, false]);
  const stale = verdict({ role: 'lead', at: ago(120), seated: true, sibling_seen_at: ago(1) }, now);
  assert.equal(stale.safe, false); assert.equal(stale.level, 1);
});

test('the updater script parses', () => {
  const r = spawnSync('bash', ['-n', fileURLToPath(new URL('../../scripts/self-update.sh', import.meta.url))], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});
