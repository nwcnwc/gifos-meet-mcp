// talk:true on a join. Meet Bot is still handed both switches off inside the
// join (the assistant is the brain by default). talk then turns on only
// respond_to_command and speak, so a line addressed to the bot gets a reply,
// and that line is handed to the calling agent: wait_for_speech blocks until
// one arrives, and a logging notification carries the same line.
//
// Every later join hands the quiet pair again. While a talk meeting is still
// live, that quiet pair is put back on afterwards, or the next join would
// turn the reply loop off.
import { z } from 'zod';
import { meetingId } from 'gifos-mcp-core';

export const PLAIN = 'Turning the microphone on and transcribing does not make the bot answer. talk:true does.';

const TALK_ON = { respond_to_command: true, speak: true };
const WAKE = /^(?:hey |ok |hi |hello )?(?:bot|bart|bott|bots|bought)\b/i;
const QUESTION = /^(?:what|who|when|where|why|how|which|can you|could you|would you|will you)\b/i;

export function addressedTo(text, names) {
  const t = String(text || '').trim();
  if (!t) return false;
  const low = t.toLowerCase();
  for (const name of names || []) {
    const n = String(name || '').trim().toLowerCase();
    if (n && low.includes(n)) return true;
  }
  return WAKE.test(t) || QUESTION.test(t) || /\?\s*$/.test(t);
}

function oldVoice(settings) {
  return !!(settings && (settings.conversation_voice != null || settings.llm || settings.tts || settings.stt));
}

function quietPair(settings) {
  return !!(settings && settings.respond_to_command === false && settings.speak === false && !oldVoice(settings));
}

export function attachTalk(server, ctx) {
  const { transcript, meetings, bot, ourNames, ok, guarded, need } = ctx;
  const talkIds = new Set();
  const queues = new Map();
  const waiters = new Map();

  server.server.registerCapabilities({ logging: {} });

  function names() {
    return (typeof ourNames === 'function' ? ourNames() : []).map((n) => String(n || '').trim()).filter(Boolean);
  }

  function liveTalk() {
    for (const id of [...talkIds]) {
      const m = meetings.get(id);
      if (!m || m.state !== 'live') talkIds.delete(id);
    }
    return talkIds.size > 0;
  }

  if (typeof bot.setVoice === 'function') {
    const orig = bot.setVoice.bind(bot);
    bot.setVoice = async (settings) => {
      const result = await orig(settings);
      if (quietPair(settings) && liveTalk()) {
        queueMicrotask(() => { orig({ ...TALK_ON }).catch(() => {}); });
      }
      return result;
    };
  }

  function notify(row) {
    server.sendLoggingMessage({
      level: 'notice',
      logger: 'talk',
      data: {
        talk: true,
        meeting_id: row.meeting_id,
        seq: row.seq,
        speaker: row.speaker,
        text: row.text,
        kind: row.kind,
      },
    }).catch(() => {});
  }

  function deliver(row) {
    const id = row.meeting_id;
    const bucket = queues.get(id) || [];
    bucket.push(row);
    queues.set(id, bucket);
    const queue = waiters.get(id);
    const waiter = queue && queue.shift();
    if (waiter) {
      if (!queue.length) waiters.delete(id);
      clearTimeout(waiter.timer);
      waiter.resolve(bucket.shift());
    }
    notify(row);
  }

  const off = transcript.onLine((row) => {
    if (!row || row.kind === 'spoken' || !talkIds.has(row.meeting_id)) return;
    const who = names();
    if (who.some((n) => n.toLowerCase() === String(row.speaker || '').trim().toLowerCase())) return;
    if (!addressedTo(row.text, who)) return;
    deliver(row);
  });
  const origClose = server.close.bind(server);
  server.close = async () => { off(); return origClose(); };

  async function arm(meetingId) {
    talkIds.add(meetingId);
    if (typeof bot.setVoice !== 'function') {
      talkIds.delete(meetingId);
      throw new Error('Meeting Bot has no setVoice method, so talk:true cannot start the reply loop.');
    }
    const handed = await bot.setVoice({ ...TALK_ON });
    const took = handed && handed.result;
    if (!handed || handed.applied === false || !took || took.speak !== true || took.respond_to_command !== true) {
      talkIds.delete(meetingId);
      throw new Error((handed && handed.gap) || 'Meeting Bot did not turn the reply loop on.');
    }
  }

  server.registerTool('wait_for_speech', {
    title: 'Wait until someone addresses the bot',
    description: PLAIN + ' Blocks until a line addressed to the bot (its name, "bot", or a question) arrives in a meeting joined with talk:true, then returns that line. Call it again after you answer. With talk left off this does nothing: the bot does not answer.',
    inputSchema: {
      meeting_id: meetingId,
      timeout_ms: z.number().int().min(0).max(30000).optional().describe('How long to wait. Default 20000, at most 30000.'),
    },
  }, guarded(async ({ meeting_id, timeout_ms }) => {
    const m = need(meeting_id);
    if (!talkIds.has(m.meeting_id) || m.state !== 'live') {
      throw new Error(PLAIN + ' This meeting is not in talk mode, so the bot does not answer.');
    }
    const bucket = queues.get(m.meeting_id);
    if (bucket && bucket.length) {
      const row = bucket.shift();
      return ok(speechView(m.meeting_id, row));
    }
    const wait = timeout_ms == null ? 20000 : timeout_ms;
    const row = await new Promise((resolve) => {
      const waiter = { resolve, timer: null };
      waiter.timer = setTimeout(() => {
        const queue = waiters.get(m.meeting_id);
        if (queue) {
          const i = queue.indexOf(waiter);
          if (i >= 0) queue.splice(i, 1);
          if (!queue.length) waiters.delete(m.meeting_id);
        }
        resolve(null);
      }, wait);
      const queue = waiters.get(m.meeting_id) || [];
      queue.push(waiter);
      waiters.set(m.meeting_id, queue);
    });
    if (!row) return ok({ meeting_id: m.meeting_id, talk: true, line: null });
    return ok(speechView(m.meeting_id, row));
  }));

  return { arm, plain: PLAIN };
}

function speechView(meetingId, row) {
  return {
    meeting_id: meetingId,
    talk: true,
    line: { seq: row.seq, ts: row.ts, speaker: row.speaker, text: row.text, kind: row.kind },
  };
}
