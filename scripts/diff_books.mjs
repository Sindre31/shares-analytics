#!/usr/bin/env node
/* Diff model books between the previous commit's data and the fresh snapshot.
   Prepends a dated entry to CHANGES.md when any default book changed membership
   or a top-5 weight moved by more than 2pp. Run by the nightly workflow. */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

function loadMeridian(dataSrc, ukey) {
  const w = {};
  global.window = w;
  global.localStorage = { getItem: () => ukey, setItem: () => {} };
  // eslint-disable-next-line no-eval
  eval(dataSrc.replace(/window\./g, 'global.window.'));
  const modelsSrc = readFileSync('assets/models.js', 'utf8');
  // eslint-disable-next-line no-eval
  eval(modelsSrc.replace('})(window);', '})(global.window);'));
  return w.MERIDIAN;
}

function books(M) {
  const out = {};
  for (const m of M.MODELS) {
    const state = {}; (m.controls || []).forEach(c => state[c.k] = c.def);
    const r = m.compute(state);
    out[m.code] = Object.fromEntries(r.weights.map(x => [x.t, x.w]));
  }
  return out;
}

let oldSrc;
try {
  oldSrc = execSync('git show HEAD:assets/data.js', { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
} catch {
  console.log('no previous data.js in git — skipping diff');
  process.exit(0);
}
const newSrc = readFileSync('assets/data.js', 'utf8');
if (oldSrc === newSrc) { console.log('data unchanged'); process.exit(0); }

const lines = [];
for (const ukey of ['oslo', 'global']) {
  let oldB, newB;
  try { oldB = books(loadMeridian(oldSrc, ukey)); } catch (e) { console.log(`old ${ukey} unloadable (${e.message}) — skipping universe`); continue; }
  try { newB = books(loadMeridian(newSrc, ukey)); } catch (e) { console.log(`new ${ukey} unloadable (${e.message})`); continue; }
  for (const code of Object.keys(newB)) {
    const o = oldB[code] || {}, n = newB[code];
    const entered = Object.keys(n).filter(t => !(t in o) && n[t] > 0.005);
    const exited = Object.keys(o).filter(t => !(t in n) && o[t] > 0.005);
    const moved = Object.keys(n).filter(t => t in o && Math.abs(n[t] - o[t]) > 0.02)
      .sort((a, b) => Math.abs(n[b] - o[b]) - Math.abs(n[a] - o[a])).slice(0, 3)
      .map(t => `${t} ${(o[t] * 100).toFixed(1)}→${(n[t] * 100).toFixed(1)}%`);
    if (entered.length || exited.length || moved.length) {
      const bits = [];
      if (entered.length) bits.push(`in: ${entered.join(', ')}`);
      if (exited.length) bits.push(`out: ${exited.join(', ')}`);
      if (moved.length) bits.push(`moved: ${moved.join('; ')}`);
      lines.push(`- **${ukey.toUpperCase()} / ${code}** — ${bits.join(' · ')}`);
    }
  }
}

if (!lines.length) { console.log('no material book changes'); process.exit(0); }
const date = process.env.DIFF_DATE || new Date().toISOString().slice(0, 10);
const entry = `## ${date}\n\n${lines.join('\n')}\n\n`;
const prev = existsSync('CHANGES.md') ? readFileSync('CHANGES.md', 'utf8').replace(/^# Model book changes\n\n/, '') : '';
writeFileSync('CHANGES.md', `# Model book changes\n\n${entry}${prev}`);
console.log(`CHANGES.md updated — ${lines.length} change line(s)`);
