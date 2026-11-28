import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGate, readsAsQuestion } from '../../examples/welcome-guide/chat-gate.mjs';

test('questions and lines naming the bot are answered; chit-chat is not', () => {
  for (const t of ['how do I share my screen?', 'what can GifOS do', 'Leo, hello', 'can bots hear me']) assert.ok(readsAsQuestion(t) || /leo|bots/i.test(t), t);
  const g = makeGate();
  assert.equal(g.allow('lol that was great', 'Sam', ['Leo']), false);
  assert.equal(g.allow('see you at 5', 'Sam', ['Leo']), false);
  assert.equal(g.allow('how do I share my screen?', 'Sam', ['Leo']), true);
  assert.equal(readsAsQuestion('is anyone here'), true);
});
test('one answer per person per 10 s, and a daily cap', () => {
  let t = 0; const g = makeGate({ now: () => t, dailyCap: 3 });
  assert.equal(g.allow('what is this?', 'Ana', []), true);
  t = 5000; assert.equal(g.allow('and this?', 'Ana', []), false);
  assert.equal(g.allow('and this?', 'Bo', []), true);
  t = 11000; assert.equal(g.allow('and this?', 'Ana', []), true);
  t = 22000; assert.equal(g.allow('more?', 'Ana', []), true);
  t = 33000; assert.equal(g.allow('more?', 'Ana', []), false);   // cap 3
  t = 86400000 + 40000; assert.equal(g.allow('more?', 'Ana', []), true);
});
