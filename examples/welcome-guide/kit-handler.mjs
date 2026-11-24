// A guard handler that answers with the bot kit's brain (examples/welcome-guide/live.bot.json): the same prompt,
// guardrails, limits and live knowledge as the kit bots, in chat only. Use it as a guard's "handler" when the bot runs
// as a guard (gifos-mcp-core's Meeting Bot) instead of the kit runner.
//
// With the guard's stage policy on, the guard calls onMessage only for the person it promoted, and only while this
// seat is on the Stage. This file still answers whatever line it is given.
//
//   npm install @gifos-app/agent              (beside this file; a version with the kit, @gifos-app/agent/kit)
//   GIFOS_BOT_CONFIG=/path/to/live.bot.json   (optional; default: live.bot.json next to this file)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, Knowledge, makeBrain, guarded, systemPrompt, namesMe } from '@gifos-app/agent/kit';

const here = path.dirname(fileURLToPath(import.meta.url));
const cfg = loadConfig(process.env.GIFOS_BOT_CONFIG || path.join(here, 'live.bot.json'));
const knowledge = new Knowledge(cfg.prompt.knowledge, { refreshMin: cfg.prompt.refresh_min, maxChars: cfg.prompt.max_knowledge_chars });
const brain = guarded(makeBrain(cfg, { knowledge }), cfg);
const history = new Map();   // meeting_id -> recent turns

export async function onMessage(message, room) {
  const text = String(message.text || '');
  if (!namesMe(cfg, text) && !(cfg.answer === 'questions' && /\?\s*$/.test(text))) return;
  await knowledge.fresh();
  const turns = history.get(room.meeting_id) || [];
  const reply = await brain.reply({ system: systemPrompt(cfg, knowledge.context(text, cfg.prompt.max_knowledge_chars)), history: turns.slice(-8), text, from: message.from, fromId: message.from });
  if (!reply) return;
  turns.push({ role: 'user', content: `${message.from}: ${text}` }, { role: 'assistant', content: reply });
  history.set(room.meeting_id, turns.slice(-16));
  await room.sendChat(reply);
}
