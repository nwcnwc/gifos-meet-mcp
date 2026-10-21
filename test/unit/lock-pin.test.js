// The install file pins gifos-mcp-core over https, at the same commit as
// package.json. npm writes git+ssh into the lock when it re-resolves a
// GitHub pin; an install from that lock needs an SSH key for GitHub, and
// npm skips the integrity check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(REPO, f), 'utf8'));

test('package-lock resolves gifos-mcp-core over https at the package.json commit, with an integrity', () => {
  const pin = read('package.json').dependencies['gifos-mcp-core'];
  assert.match(pin, /^git\+https:\/\/github\.com\/nwcnwc\/gifos-mcp-core\.git#[0-9a-f]{40}$/);
  const lock = read('package-lock.json');
  assert.equal(lock.packages[''].dependencies['gifos-mcp-core'], pin);
  const core = lock.packages['node_modules/gifos-mcp-core'];
  assert.equal(core.resolved, pin);
  assert.match(core.integrity || '', /^sha512-/);
  assert.equal(JSON.stringify(lock).includes('git+ssh:'), false);
});
