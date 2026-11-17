// The banner, --version and the MCP server info name the build that runs: VERSION is package.json's (it said 0.5.3
// in 0.6.0, so a log could not tell which build was running).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { VERSION, product } from '../../src/server.js';

test('VERSION is the package version', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal(VERSION, pkg.version);
  assert.equal(product.version, pkg.version);
});
