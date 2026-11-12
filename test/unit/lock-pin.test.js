// gifos-mcp-core is pinned as GitHub's tarball of one commit
// (codeload.github.com/.../tar.gz/<sha>), not a git URL: npx (npm 10, the npm
// that ships with Node 22) cannot install a package whose dependency is a git
// URL ("GitFetcher requires an Arborist constructor"). The lock holds the same
// URL with an integrity, and never git+ssh (that needs an SSH key for GitHub).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(REPO, f), 'utf8'));

test('package-lock resolves gifos-mcp-core as the GitHub tarball of the package.json commit, with an integrity', () => {
  const pin = read('package.json').dependencies['gifos-mcp-core'];
  assert.match(pin, /^https:\/\/codeload\.github\.com\/nwcnwc\/gifos-mcp-core\/tar\.gz\/[0-9a-f]{40}$/);
  const lock = read('package-lock.json');
  assert.equal(lock.packages[''].dependencies['gifos-mcp-core'], pin);
  const core = lock.packages['node_modules/gifos-mcp-core'];
  assert.equal(core.resolved, pin);
  assert.match(core.integrity || '', /^sha512-/);
  assert.equal(JSON.stringify(lock).includes('git+ssh:'), false);
  assert.equal(JSON.stringify(lock).includes('git+https:'), false, 'no git URL anywhere: npx cannot install one');
});
