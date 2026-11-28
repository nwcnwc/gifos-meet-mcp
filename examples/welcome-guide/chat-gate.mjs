// Which chat lines the welcome bots answer, and how often. Pure; the unit test drives it.
// A line is answered when it reads as a question (ends with "?", or opens with a question word) or names the bot
// (or "bots"/"guide"). Chit-chat between people is ignored. Each person (by name: a reload is a new seat id) gets
// at most one answer per PER_PERSON_S and DAILY_CAP a day.
export const PER_PERSON_S = 10;
export const DAILY_CAP = 20;
const QWORD = /^\s*(hey,?\s+|hi,?\s+|so,?\s+)?(how|what|whats|what's|why|when|where|who|which|can|could|does|do|is|are|will|would|should|did|any(one|body)|tell me|explain)\b/i;

export function readsAsQuestion(text) {
  const t = String(text || '').trim();
  if (t.length < 3 || t.length > 1000) return false;
  return /\?\s*$/.test(t) || (QWORD.test(t) && t.length >= 8);
}
export function addressesBots(text, names = []) {
  const t = String(text || '');
  return names.some((n) => n && new RegExp('\\b' + String(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(t)) || /\b(bots?|guide)\b/i.test(t);
}

export function makeGate({ now = Date.now, perPersonS = PER_PERSON_S, dailyCap = DAILY_CAP } = {}) {
  const last = new Map(); const day = new Map();
  return {
    // true: answer this line (and the person's clock starts); false: stay quiet
    allow(text, from, names) {
      if (!(readsAsQuestion(text) || addressesBots(text, names))) return false;
      const who = String(from || '').trim().toLowerCase(); const t = now();
      if (who) {
        if (t - (last.get(who) ?? -Infinity) < perPersonS * 1000) return false;
        const d = (day.get(who) || []).filter((x) => t - x < 86400000);
        if (d.length >= dailyCap) { day.set(who, d); return false; }
        d.push(t); day.set(who, d); last.set(who, t);
      }
      return true;
    },
  };
}
