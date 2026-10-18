// The words in E2E_EXPECT are separated by |. A transcript passes when at
// least 80% of them show up. One stray word from a silence hallucination
// is not enough. A plain sentence has no separator, so it is one phrase
// and a miss is reported as 0/1. That is a setup mistake, not a hearing.
export function expectSpecProblem(spec) {
  const s = String(spec || '').trim();
  if (s && !s.includes('|') && /\s/.test(s)) {
    return 'E2E_EXPECT needs the words separated by |, for example budget|meeting|friday. A whole sentence is one phrase and fails as 0/1.';
  }
  return '';
}
export function heardWords(transcript, spec) {
  const words = String(spec || '').split('|').map((w) => w.trim().toLowerCase()).filter(Boolean);
  const hay = String(transcript || '').toLowerCase();
  const hit = words.filter((w) => hay.includes(w)).length;
  return { words: words.length, hit, ok: words.length > 0 && hit / words.length >= 0.8 };
}
