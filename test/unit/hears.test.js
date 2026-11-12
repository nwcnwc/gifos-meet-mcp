import { test } from 'node:test';
import assert from 'node:assert/strict';
import { peakOver, heardOver } from '../e2e/hears.js';
import { toneWav } from '../e2e/tone-tts.js';

const ring = [
  { t: 1000, r: { 'direct:abcdef12xx': { db: -120 }, 'direct:other999': { db: -10 } } },
  { t: 2000, r: { 'direct:abcdef12xx': { db: -28 } } },
  { t: 3000, r: { 'direct:abcdef12xx': { db: -95 } } },
];
test('the peak over the window decides, not one second', () => {
  assert.equal(peakOver(ring, 'abcdef12', 1000, 3000), -28);
  assert.equal(heardOver(ring, 'abcdef12', 1000, 3000), true);
  assert.equal(heardOver(ring, 'abcdef12', 3000, 4000), false);
  assert.equal(heardOver(ring, 'abcdef12', 1000, 1000), false, 'another peer is not the bot');
  assert.equal(heardOver(ring, '', 1000, 3000), false);
});
test('the tone stand-in is a 3 s mono WAV', () => {
  const b = toneWav(3, 24000);
  assert.equal(b.toString('ascii', 0, 4), 'RIFF');
  assert.equal(b.readUInt32LE(40), 3 * 24000 * 2);
});
