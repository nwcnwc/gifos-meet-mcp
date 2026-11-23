// Scores a test/e2e/self-update-proof.sh run:  node test/e2e/self-update-score.mjs <work dir>
// PASS needs all of:
//   held      from the first sample where both bots held the room, at least one bot holds it at every monitor sample
//   apart     no two restart windows (a round's "restarting" up to its UPDATED / ROLLED BACK line) overlap
//   versions  v2, v3, v6 UPDATED on both; v4 skipped on both with failing tests and never restarted onto;
//             v5 rolled back on both
import fs from 'node:fs';
import path from 'node:path';

const W = process.argv[2];
const read = (f) => { try { return fs.readFileSync(path.join(W, f), 'utf8'); } catch (e) { return ''; } };
const versions = Object.fromEntries(read('versions.txt').trim().split('\n').filter(Boolean).map((l) => l.split(' ')).map(([k, v]) => [k, v.slice(0, 7)]));
const out = []; let pass = true;
const check = (ok, text) => { out.push((ok ? 'ok   ' : 'FAIL ') + text); if (!ok) pass = false; };

// held
const samples = read('monitor.log').split('\n').filter(Boolean).map((l) => {
  const m = l.match(/^(\S+) A=(\{.*?\}) B=(\{.*?\}) pinA/);
  if (!m) return null;
  try { return { t: Date.parse(m[1]), a: JSON.parse(m[2]), b: JSON.parse(m[3]) }; } catch (e) { return null; }
}).filter(Boolean);
const first = samples.findIndex((s) => s.a.level === 3 && s.b.level === 3);
let unheld = 0, gapStart = null, longest = 0, bothHeld = 0, oneHeld = 0;
for (const s of samples.slice(Math.max(0, first))) {
  const a = s.a.level === 3, b = s.b.level === 3;
  if (a && b) bothHeld++; else if (a || b) oneHeld++;
  if (!a && !b) { unheld++; if (gapStart === null) gapStart = s.t; longest = Math.max(longest, s.t - gapStart); } else gapStart = null;
}
const span = first >= 0 ? (samples[samples.length - 1].t - samples[first].t) / 60000 : 0;
check(first >= 0 && unheld === 0, `held: ${samples.length - Math.max(0, first)} samples over ${span.toFixed(1)} min after both first held; both ${bothHeld}, one ${oneHeld}, none ${unheld}` + (unheld ? ` (longest gap ${(longest / 1000).toFixed(0)} s)` : ''));

// restart windows
const lines = (x) => read(`journal-update-${x}.log`).split('\n').map((l) => {
  const m = l.match(/^(\S+) \S+ [^:]+: self-update: (.*)$/);
  return m ? { t: Date.parse(m[1].replace(/([+-]\d\d)(\d\d)$/, '$1:$2')), x, msg: m[2] } : null;
}).filter(Boolean);
const J = { A: lines('A'), B: lines('B') };
const windows = [];
for (const x of ['A', 'B']) {
  let open = null;
  for (const l of J[x]) {
    if (/^restarting /.test(l.msg)) open = { x, from: l.t, to: null, what: l.msg };
    else if (open && /^(UPDATED|ROLLED BACK|rolled back to)/.test(l.msg)) { open.to = l.t; open.end = l.msg; windows.push(open); open = null; }
  }
  if (open) windows.push(Object.assign(open, { to: Infinity, end: '(no end)' }));
}
windows.sort((p, q) => p.from - q.from);
let overlaps = 0;
for (let i = 1; i < windows.length; i++) if (windows[i].from < windows[i - 1].to && windows[i].x !== windows[i - 1].x) overlaps++;
check(windows.length > 0 && overlaps === 0, `apart: ${windows.length} restart windows, ${overlaps} overlapping`);
for (const w of windows) out.push(`       ${w.x} ${new Date(w.from).toISOString()} +${((w.to - w.from) / 1000).toFixed(0)} s  ${w.what} -> ${w.end}`);

// versions
const has = (x, re) => J[x].some((l) => re.test(l.msg));
for (const v of ['v2', 'v3', 'v6']) for (const x of ['A', 'B']) check(versions[v] && has(x, new RegExp(`^UPDATED \\w+ -> ${versions[v]}`)), `${v} ${versions[v]} updated on ${x}`);
for (const x of ['A', 'B']) {
  check(versions.v4 && has(x, new RegExp(`^SKIP ${versions.v4}: npm test failed`)) && !has(x, new RegExp(`^restarting .* on ${versions.v4}`)), `v4 ${versions.v4} (failing test) skipped on ${x}, never restarted onto`);
  check(versions.v5 && has(x, new RegExp(`^ROLLBACK to \\w+: ${versions.v5} did not take its seat back`)) && has(x, /^ROLLED BACK to /), `v5 ${versions.v5} (no seat) rolled back on ${x}`);
}
check(has('A', /^an earlier round stopped mid-swap; putting \w+ back/) && has('A', /^back on \w+; this round ends here/) && /ok: A recovered from the interrupted swap/.test(read('proof.log')), 'crash: an interrupted swap was finished on A and A holds again');
check(J.A.concat(J.B).some((l) => /^same lockfile: node_modules copied/.test(l.msg)) && J.A.concat(J.B).some((l) => /^the lockfile moved: npm ci done/.test(l.msg)), 'both build paths ran (copied node_modules; npm ci for the package.json change)');
const unsafe = ['A', 'B'].map((x) => `${x} ${J[x].filter((l) => /^SKIP this round/.test(l.msg)).length}`).join(', ');
out.push(`info rounds skipped because a restart was not safe: ${unsafe}`);
out.push(pass ? 'PASS' : 'FAIL');
console.log(out.join('\n'));
process.exit(pass ? 0 : 1);
