// The words in E2E_EXPECT are separated by |. A transcript passes when at
// least 80% of them show up. One stray word from a silence hallucination
// is not enough.
export function heardWords(transcript, spec) {
  const words = String(spec || '').split('|').map((w) => w.trim().toLowerCase()).filter(Boolean);
  const hay = String(transcript || '').toLowerCase();
  const hit = words.filter((w) => hay.includes(w)).length;
  return { words: words.length, hit, ok: words.length > 0 && hit / words.length >= 0.8 };
}
