// Did a page hear one voice during one say? The page debug meter keeps a ring of
// one entry per second; each entry holds the PEAK of its 500 ms level samples per
// source (r[key].db). One entry is a short look, so a line is judged by the loudest
// entry over the whole say window, never by the first or the latest one.
export const HEARD_DB = -60;

// ring: [{t, r: {key: {db}}}], key = 'path:<peer id>', botKey = first 8 chars of the bot id.
export function peakOver(ring, botKey, fromMs, toMs) {
  let peak = -120;
  for (const sec of ring || []) {
    if (sec.t < fromMs || sec.t > toMs) continue;
    for (const [k, c] of Object.entries(sec.r || {})) {
      const who = k.split(':')[1];
      if (c && who && who.slice(0, 8) === botKey && c.db > peak) peak = c.db;
    }
  }
  return peak;
}

export const heardOver = (ring, botKey, fromMs, toMs) => !!botKey && peakOver(ring, botKey, fromMs, toMs) > HEARD_DB;
