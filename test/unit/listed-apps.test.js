// Synthetic speech on a shared site is refused only when an app.json is missing.
import http from 'node:http';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { missingApps } from '../e2e/listed-apps.js';

const SLUGS = ['stt-synthetic', 'tts-synthetic', 'llm-synthetic'];

function serve(files) {
  const server = http.createServer((req, res) => {
    const slug = SLUGS.find((s) => req.url === '/apps/' + s + '/app.json');
    if (!slug || !files[slug]) { res.writeHead(404); res.end(); return; }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ appId: files[slug] }));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, url: 'http://127.0.0.1:' + server.address().port }));
  });
}

test('a site that lists all three speech apps is not missing any', async () => {
  const { server, url } = await serve({ 'stt-synthetic': 'stt-synthetic', 'tts-synthetic': 'tts-synthetic', 'llm-synthetic': 'llm-synthetic' });
  assert.deepEqual(await missingApps(url, SLUGS), []);
  server.close();
});

test('a listed site is missing only the app whose app.json is absent', async () => {
  const { server, url } = await serve({ 'stt-synthetic': 'stt-synthetic', 'tts-synthetic': 'tts-synthetic' });
  assert.deepEqual(await missingApps(url, SLUGS), ['llm-synthetic']);
  server.close();
});
