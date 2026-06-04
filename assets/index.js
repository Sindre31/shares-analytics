/* ============================================================
   index.js — landing / overview page
   ============================================================ */
(function () {
  const M = window.MERIDIAN, C = window.Charts, MER = window.MER;
  const { esc } = C;

  const CAT_COLOR = {
    'Optimization': 'oklch(0.70 0.15 152)',
    'Equilibrium':  'oklch(0.72 0.12 200)',
    'Bayesian':     'oklch(0.70 0.13 250)',
    'Risk-based':   'oklch(0.74 0.14 60)',
    'Factor':       'oklch(0.70 0.14 320)',
    'Naive':        'oklch(0.62 0.04 250)',
    'Machine Learning': 'oklch(0.74 0.16 25)',
  };

  // build default snapshot for each model
  function snapshot(m) {
    const state = {};
    (m.controls || []).forEach(c => state[c.k] = c.def);
    const r = m.compute(state);
    const mt = M.metrics(r.weights);
    const path = M.pathFor(r.weights, 36);   // real 3y backtest
    const bench = M.benchPath(36);           // real benchmark (SPY)
    const ret3 = (path[path.length - 1] / 100 - 1) * 100;
    const mdd = C.maxDrawdown(path);
    return { m, mt, path, ret3, mdd, hold: r.weights.length, alpha: ret3 - (bench[bench.length - 1] / 100 - 1) * 100,
             color: CAT_COLOR[m.cat] || 'var(--up)' };
  }

  function init() {
    document.body.insertAdjacentHTML('afterbegin', MER.header('home', 'index') + MER.ticker());
    document.body.insertAdjacentHTML('beforeend', MER.footer('OVERVIEW · 10 MODELS LIVE'));
    MER.startClock();

    const snaps = M.MODELS.map(snapshot);

    const root = document.getElementById('app');
    root.innerHTML = `
      <div class="hero">
        <div class="wrap hero-in">
          <div class="hero-main">
            <div class="eyebrow">Meridian Portfolio Model Exchange · PMX</div>
            <h1 class="hero-h1">Ten models.<br>One universe.<br><span class="up">The optimal book.</span></h1>
            <p class="hero-sub">Ten canonical portfolio-construction models — from Markowitz to machine-learning — each run live against a single universe of ${M.U.length} real assets, on real market data as of ${M.ASOF}. Compare the books they build, then open any model to tune it.</p>
            <div class="hero-cta">
              <a class="btn primary" href="#directory">▸ BROWSE MODELS</a>
              <a class="btn" href="#frontier">▸ RISK / RETURN MAP</a>
            </div>
          </div>
          <div class="hero-side">
            <div class="hs-row"><span class="k">UNIVERSE</span><span class="v mono">${M.U.length} ASSETS</span></div>
            <div class="hs-row"><span class="k">MODELS</span><span class="v mono">${M.MODELS.length}</span></div>
            <div class="hs-row"><span class="k">BENCHMARK</span><span class="v mono">${M.BENCH.code} · ${M.BENCH.er.toFixed(1)}%</span></div>
            <div class="hs-row"><span class="k">RISK-FREE</span><span class="v mono">${M.RF.toFixed(2)}%</span></div>
            <div class="hs-row"><span class="k">REBAL</span><span class="v mono">MONTHLY</span></div>
            <div class="hs-row"><span class="k">AS OF</span><span class="v mono" id="hs-date"></span></div>
            <div class="hs-foot mono">● REAL MARKET DATA · NOT INVESTMENT ADVICE</div>
          </div>
        </div>
      </div>

      <div class="wrap page">
        <div id="frontier" class="section-bar"><h2>RISK / RETURN MAP</h2><span class="cat-tag">EX-ANTE · ANNUALIZED</span><div class="hr"></div></div>
        <div class="frontier-grid">
          <div class="panel">
            <div class="panel-head">EFFICIENT MAP · ALL MODELS + BENCHMARK<div class="right"><span class="mono dim">σ ↔ μ</span></div></div>
            <div class="panel-body"><div id="scatter"></div></div>
          </div>
          <div class="panel">
            <div class="panel-head">READING THE MAP</div>
            <div class="panel-body">
              <p class="dim" style="margin:0 0 12px;font-size:12.5px;line-height:1.6">Each dot is the book a model builds at its default settings — plotted by expected volatility (x) against expected return (y). Up-and-left is better risk-adjusted return.</p>
              <div class="legend" id="catLegend" style="flex-direction:column;gap:8px"></div>
              <div class="map-note mono">◆ ${M.BENCH.code} benchmark · σ ${M.BENCH.vol.toFixed(1)}% / μ ${M.BENCH.er.toFixed(1)}%</div>
            </div>
          </div>
        </div>

        <div id="directory" class="section-bar mt24"><h2>MODEL COMPARISON</h2><span class="cat-tag">CLICK A ROW TO OPEN · SORT BY HEADER</span><div class="hr"></div></div>
        <div class="panel">
          <div class="panel-body tight"><div id="compTable"></div></div>
        </div>

        <div class="section-bar mt24"><h2>INVESTABLE UNIVERSE</h2><span class="cat-tag">${M.U.length} CONSTITUENTS</span><div class="hr"></div></div>
        <div class="panel">
          <div class="panel-body tight"><div id="uniTable"></div></div>
        </div>
      </div>`;

    document.getElementById('hs-date').textContent = M.ASOF;

    // category legend
    document.getElementById('catLegend').innerHTML = Object.entries(CAT_COLOR).map(([k, v]) =>
      `<div class="li"><span class="sw2" style="background:${v}"></span>${esc(k)}</div>`).join('');

    // scatter
    function drawScatter() {
      const pts = snaps.map(s => ({ x: s.mt.vol, y: s.mt.er, code: s.m.code, label: s.m.name, color: s.color, r: 6 }));
      pts.push({ x: M.BENCH.vol, y: M.BENCH.er, code: M.BENCH.code, label: 'Benchmark', color: C.css('--fg-mute'), r: 5 });
      document.getElementById('scatter').innerHTML = C.scatter(pts, { h: 380, xlabel: 'EXPECTED VOLATILITY  σ %', ylabel: 'EXPECTED RETURN  μ %' });
      document.querySelectorAll('#scatter .sc-pt').forEach(g => {
        g.addEventListener('click', () => {
          const code = g.dataset.code; const m = M.MODELS.find(x => x.code === code);
          if (m) location.href = `models/${MER.fileFor(m)}`;
        });
      });
    }
    drawScatter();

    // comparison table (sortable)
    let sortKey = 'no', sortDir = 1;
    const cols = [
      { k: 'no', t: '#', get: s => s.m.no, num: true },
      { k: 'code', t: 'Code', get: s => s.m.code },
      { k: 'name', t: 'Model', get: s => s.m.name },
      { k: 'cat', t: 'Class', get: s => s.m.cat },
      { k: 'er', t: 'Exp.Ret', get: s => s.mt.er, num: true, fmt: v => v.toFixed(1) + '%', cls: () => 'up' },
      { k: 'vol', t: 'Vol', get: s => s.mt.vol, num: true, fmt: v => v.toFixed(1) + '%' },
      { k: 'sharpe', t: 'Sharpe', get: s => s.mt.sharpe, num: true, fmt: v => v.toFixed(2), cls: v => v >= 0.6 ? 'up' : '' },
      { k: 'mdd', t: 'Max DD', get: s => s.mdd, num: true, fmt: v => '−' + Math.abs(v).toFixed(0) + '%', cls: () => 'down' },
      { k: 'hold', t: 'Hold', get: s => s.hold, num: true },
      { k: 'ret3', t: '3Y', get: s => s.ret3, num: true, fmt: v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(0) + '%', cls: v => v >= 0 ? 'up' : 'down' },
    ];
    function drawTable() {
      const sorted = [...snaps].sort((a, b) => {
        const col = cols.find(c => c.k === sortKey);
        let av = col.get(a), bv = col.get(b);
        if (col.num) return (av - bv) * sortDir;
        return String(av).localeCompare(String(bv)) * sortDir;
      });
      const head = cols.map(c => `<th class="sortable${c.num ? '' : ' tleft'}" data-k="${c.k}">${esc(c.t)}${sortKey === c.k ? (sortDir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('') + '<th>Trend</th><th></th>';
      const body = sorted.map(s => {
        const tds = cols.map(c => {
          const v = c.get(s);
          const disp = c.fmt ? c.fmt(v) : v;
          if (c.k === 'code') return `<td class="tleft"><span class="mono" style="color:${s.color};font-weight:600">${esc(disp)}</span></td>`;
          if (c.k === 'name') return `<td class="tleft">${esc(disp)} <span class="badge ${s.m.interactive ? 'g' : ''}" style="margin-left:4px;font-size:8.5px;padding:1px 4px">${s.m.interactive ? 'INT' : 'STC'}</span></td>`;
          if (c.k === 'cat') return `<td class="tleft dim">${esc(disp)}</td>`;
          if (c.k === 'no') return `<td class="tleft mute">${esc(disp)}</td>`;
          const cls = c.cls ? c.cls(v) : '';
          return `<td class="${cls}">${esc(disp)}</td>`;
        }).join('');
        const spark = C.spark(s.path, s.alpha >= 0 ? C.css('--up') : C.css('--down'), 92, 22);
        return `<tr class="clickable" data-id="${s.m.id}">${tds}<td>${spark}</td>
          <td><button class="ibtn" data-info="${s.m.id}" title="About">i</button></td></tr>`;
      }).join('');
      document.getElementById('compTable').innerHTML = `<table class="tbl comp"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
      document.querySelectorAll('#compTable th.sortable').forEach(th => th.addEventListener('click', () => {
        const k = th.dataset.k; if (sortKey === k) sortDir *= -1; else { sortKey = k; sortDir = th.classList.contains('tleft') ? 1 : -1; }
        drawTable();
      }));
      document.querySelectorAll('#compTable tr.clickable').forEach(tr => tr.addEventListener('click', e => {
        if (e.target.closest('[data-info]')) return;
        const m = M.modelById(tr.dataset.id); location.href = `models/${MER.fileFor(m)}`;
      }));
      document.querySelectorAll('#compTable [data-info]').forEach(b => b.addEventListener('click', e => {
        e.stopPropagation(); MER.openInfo(M.modelById(b.dataset.info));
      }));
    }
    drawTable();

    // universe table
    const uni = [...M.U].sort((a, b) => b.mcap - a.mcap);
    const ubody = uni.map(a => `<tr>
      <td class="tleft"><div class="sym-cell"><span class="sym-chip" style="background:${a.color}"></span><span class="mono" style="font-weight:600">${a.t}</span></div></td>
      <td class="tleft asset-name" style="font-size:11.5px">${esc(a.name)}</td>
      <td class="tleft dim">${esc(a.sector)}</td>
      <td class="${a.er >= M.RF ? 'up' : 'dim'}">${a.er.toFixed(1)}%</td>
      <td class="dim">${a.vol.toFixed(0)}%</td>
      <td class="dim">${a.beta.toFixed(2)}</td>
      <td class="dim">${a.mom >= 0 ? '+' : '−'}${Math.abs(a.mom)}%</td>
      <td class="dim">${a.pe || '—'}</td>
      <td class="dim">${a.div.toFixed(1)}%</td>
      <td class="dim">$${a.mcap >= 1000 ? (a.mcap / 1000).toFixed(1) + 'T' : a.mcap + 'B'}</td></tr>`).join('');
    document.getElementById('uniTable').innerHTML = `<table class="tbl"><thead><tr>
      <th class="tleft">Ticker</th><th class="tleft">Name</th><th class="tleft">Sector</th><th>Exp.Ret</th><th>Vol</th><th>β</th><th>12-1 Mom</th><th>P/E</th><th>Yield</th><th>Mkt Cap</th>
      </tr></thead><tbody>${ubody}</tbody></table>`;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
