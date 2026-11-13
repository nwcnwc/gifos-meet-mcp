// A guard handler that lets the bot talk with people through Claude (Anthropic SDK).
//
// The guard calls onMessage(message, room) on the lead bot for every chat or spoken line a person sends in the
// guarded room. message: { text, from, kind: 'chat' | 'speech', at }. room.sendChat(text) answers in chat;
// room.say(text) speaks (when the bot has a voice set up).
//
//   npm install @anthropic-ai/sdk          (beside this file)
//   export ANTHROPIC_API_KEY=...           (or an `ant auth login` profile)
//
// It answers lines that name the bot or ask a question, keeps a short history per room, and never answers itself.
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();
const BOT = process.env.GIFOS_BOT_NAME || 'GifOS Welcome';
const SYSTEM = `You are ${BOT}, the host bot of a public GifOS video room. Be warm and brief: one or two short sentences, plain text, no markdown. ` +
  'Help people find their way (camera, microphone, chat, the Vote button to remove someone who is out of line). ' +
  'Never ask for personal details. If someone is in danger or reports abuse, tell them to use Vote and to contact local services.';
const history = new Map();   // meeting_id -> recent turns
const MAX_TURNS = 20;

function addressed(text) {
  const t = String(text || '').toLowerCase();
  return t.includes(BOT.toLowerCase()) || /\?\s*$/.test(t) || /^(hi|hey|hello)\b/.test(t);
}

export async function onMessage(message, room) {
  if (!addressed(message.text)) return;
  const turns = history.get(room.meeting_id) || [];
  turns.push({ role: 'user', content: `${message.from}: ${message.text}` });
  let response;
  try {
    response = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 1024,
      output_config: { effort: 'low' },          // chat replies: fast and short
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',                        // a declined request is retried on a fallback model
      system: SYSTEM,
      messages: turns.slice(-MAX_TURNS),
    });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return;   // skip this line; the next one tries again
    if (e instanceof Anthropic.APIError) { console.error('claude-handler: API error ' + e.status); return; }
    throw e;
  }
  if (response.stop_reason === 'refusal') return;
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ').trim();
  if (!text) return;
  turns.push({ role: 'assistant', content: text });
  history.set(room.meeting_id, turns.slice(-MAX_TURNS));
  await room.sendChat(text.slice(0, 2000));
}
