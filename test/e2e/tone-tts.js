// A text-to-speech stand-in for the e2e: answers every request with a WAV of a
// swept tone SECS long (default 3 s). The bot's say path needs some voice; with
// no TTS at all it plays a 0.2 s blip, too short for the page meter (it
// samples every 500 ms) to catch every time. A 3 s line is always measurable.
import http from 'node:http';

export function toneWav(secs = 3, rate = 24000) {
  const n = Math.round(rate * secs);
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const env = Math.min(1, t * 20, (secs - t) * 20);
    b.writeInt16LE(Math.round(0.3 * env * 32767 * Math.sin(2 * Math.PI * (300 + 60 * Math.sin(t * 3)) * t)), 44 + i * 2);
  }
  return b;
}

export function startToneTts(secs = 3) {
  const wav = toneWav(secs);
  return new Promise((resolve, reject) => {
    const srv = http.createServer((q, r) => { q.resume(); r.writeHead(200, { 'content-type': 'audio/wav' }); r.end(wav); });
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => resolve({ url: 'http://127.0.0.1:' + srv.address().port + '/tts', secs, close: () => new Promise((ok) => srv.close(ok)) }));
  });
}
