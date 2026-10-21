// The Whisper e2e clip is real speech: a WAV long enough to hold the
// sentence, loud enough to pass the Whisper app's silence gate, and its
// words are a valid E2E_EXPECT.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SPEECH_WAV, SPEECH_WORDS } from '../e2e/whisper.js';
import { expectSpecProblem, heardWords } from '../e2e/expect.js';

function readWav(file) {
  const b = fs.readFileSync(file);
  assert.equal(b.toString('ascii', 0, 4), 'RIFF');
  assert.equal(b.toString('ascii', 8, 12), 'WAVE');
  let p = 12; let fmt = null; let data = null;
  while (p + 8 <= b.length) {
    const id = b.toString('ascii', p, p + 4); const n = b.readUInt32LE(p + 4);
    if (id === 'fmt ') fmt = { format: b.readUInt16LE(p + 8), channels: b.readUInt16LE(p + 10), rate: b.readUInt32LE(p + 12), bits: b.readUInt16LE(p + 22) };
    if (id === 'data') data = b.subarray(p + 8, p + 8 + n);
    p += 8 + n + (n & 1);
  }
  return { fmt, data };
}

test('the Whisper e2e clip is a mono WAV (Kokoro writes 32-bit float) with speech in it', () => {
  const { fmt, data } = readWav(SPEECH_WAV);
  const float = fmt.format === 3 && fmt.bits === 32;
  assert.ok(float || (fmt.format === 1 && fmt.bits === 16), JSON.stringify(fmt));
  assert.equal(fmt.channels, 1);
  const size = fmt.bits / 8;
  const n = data.length / size;
  const seconds = n / fmt.rate;
  assert.ok(seconds > 2 && seconds < 20, 'seconds ' + seconds);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const s = float ? data.readFloatLE(i * 4) : data.readInt16LE(i * 2) / 32768;
    // Corrupt q8 audio is NaN or far outside -1..1.
    assert.ok(Number.isFinite(s) && s >= -1 && s <= 1, 'sample ' + i + ' ' + s);
    sum += s * s;
  }
  const rms = Math.sqrt(sum / n);
  // Offline Captions does not ask the model below 0.0025.
  assert.ok(rms > 0.02, 'rms ' + rms);
});

test('the clip\'s words are a valid E2E_EXPECT', () => {
  assert.equal(expectSpecProblem(SPEECH_WORDS), '');
  assert.equal(heardWords('The budget meeting is in the garden tomorrow morning.', SPEECH_WORDS).ok, true);
  assert.equal(heardWords('you', SPEECH_WORDS).ok, false);
});
