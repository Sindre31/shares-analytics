/* ============================================================
   compare.js — two model books side by side.
   compare.html?a=mvo&b=hrp
   ============================================================ */
(function () {
  const M = window.MERIDIAN, C = window.Charts, MER = window.MER;
  const { esc } = C;

  const COL_A = 'oklch(0.70 0.15 152)';   // green
  const COL_B = 'oklch(0.72 0.12 230)';   // blue

  function bookOf(m) {
    const state = {}; (m.controls || []).forEach(c => state[c.k] = c.def);
    const r = m.compute(state);
    const mt = M.metrics(r.weights);
    return { m, weights: r.weights, mt, wmap: Object.fromEntries(r.weights.map(x => [x.t, x.w])) };
  }

  function init() {
    document.body.insertAdjacentHTML('afterbegin', MER.header(null, 'index') + MER.ticker());
    document.body.insertAdjacentHTML('beforeend', MER.footer(`COMPARE · ${M.UKEY.toUpperCase()} UNIVERSE`));
    MER.startClock(); MER.initSearch('index');

    const q = new URLSearchParams(location.search);
    let aId = M.modelById(q.get('a')) ? q.get('a') : 'mvo';
    let bId = M.modelById(q.get('b')) ? q.get('b') : 'hrp';
    let win = 36;

    const root = document.getElementById('app');
    root.innerHTML = `
      <div class="wrap page">
        <div class="model-hero fade-in">
          <div class="mh-left"><div>
            <h1 class="mh-title">COMPARE <span class="dim">·</span> TWO BOOKS</h1>
            <p class="mh-tag">Default settings, ${M.U.length} ${esc(M.ULABEL)}, vs ${esc(M.BENCH.name)}. Pick any two models.</p>
          </div></div>
          <div class="mh-right">
            <div class="row">
              <span class="badge" style="border-color:${COL_A};color:${COL_A}">A</span>
              <select id="selA" class="btn" style="appearance:auto"></select>
              <span class="badge" style="border-color:${COL_B};color:${COL_B}">B</span>
              <select id="selB" class="btn" style="appearance:auto"></select>
            </div>
          </div>
        </div>

        <div class="kpis fade-in" id="kpis" style="grid-template-columns:repeat(4,1fr)"></div>

        <div class="model-grid mt16">
          <div class="main">
            <div class="panel">
              <div class="panel-head">PERFORMANCE · GROWTH OF 100
                <div class="right"><div class="seg" id="segWin">
                  <button data-w="36" class="on">3Y</button><button data-w="60">5Y</button><button data-w="120">10Y</button>
                </div></div>
              </div>
              <div class="panel-body"><div id="perfChart"></div><div class="legend mt12" id="perfLegend"></div></div>
            </div>
            <div class="panel mt16">
              <div class="panel-head">WEIGHT DIFF · BY HOLDING<div class="right"><span class="mono dim" id="diffNote"></span></div></div>
              <div class="panel-body tight"><div id="diffTable"></div></div>
            </div>
          </div>
          <div class="side">
            <div class="panel"><div class="panel-head">BOOK A</div><div class="panel-body" id="cardA"></div></div>
            <div class="panel mt16"><div class="panel-head">BOOK B</div><div class="panel-body" id="cardB"></div></div>
          </div>
        </div>
      </div>`;

    const selA = document.getElementById('selA'), selB = document.getElementById('selB');
    const opts = M.MODELS.map(m => `<option value="${m.id}">${m.no} · ${esc(m.code)} — ${esc(m.name)}</option>`).join('');
    selA.innerHTML = opts; selB.innerHTML = opts;
    selA.value = aId; selB.value = bId;
    selA.addEventListener('change', () => { aId = selA.value; sync(); });
    selB.addEventListener('change', () => { bId = selB.value; sync(); });
    document.querySelectorAll('#segWin button').forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll('#segWin button').forEach(x => x.classList.remove('on'));
      b.classList.add('on'); win = +b.dataset.w; render();
    }));

    function sync() {
      history.replaceState(null, '', `compare.html?a=${aId}&b=${bId}`);
      render();
    }

    function card(el, bk, col) {
      document.getElementById(el).innerHTML = `
        <div class="row" style="gap:8px;margin-bottom:8px">
          <span class="mono" style="font-weight:700;color:${col};font-size:15px">${esc(bk.m.code)}</span>
          <span class="dim" style="font-size:12.5px">${esc(bk.m.name)}</span>
          <button class="ibtn" style="margin-left:auto" data-info="${bk.m.id}">i</button>
        </div>
        <div class="kv">
          <span class="kk">Class</span><span class="vv">${esc(bk.m.cat)}</span>
          <span class="kk">Holdings</span><span class="vv">${bk.weights.length}</span>
          <span class="kk">Eff. N</span><span class="vv">${bk.mt.effN.toFixed(1)}</span>
          <span class="kk">Top</span><span class="vv">${esc(bk.weights[0].t)} ${(bk.weights[0].w * 100).toFixed(1)}%</span>
        </div>
        <a class="btn ghost mt12" style="display:inline-block" href="models/${MER.fileFor(bk.m)}">OPEN MODEL ▸</a>`;
    }

    function render() {
      const A = bookOf(M.modelById(aId)), B = bookOf(M.modelById(bId));
      const pA = M.pathFor(A.weights, win), pB = M.pathFor(B.weights, win), pX = M.benchPath(win);
      const mddA = C.maxDrawdown(pA), mddB = C.maxDrawdown(pB);
      const retA = (pA[pA.length - 1] / 100 - 1) * 100, retB = (pB[pB.length - 1] / 100 - 1) * 100;

      const tile = (k, va, vb, fmt, hiGood) => {
        const fa = fmt(va), fb = fmt(vb);
        const aw = hiGood == null ? null : (hiGood ? va >= vb : va <= vb);
        return `<div class="kpi"><div class="k">${k}</div>
          <div class="v" style="font-size:17px"><span style="color:${COL_A}">${fa}</span> <span class="mute">/</span> <span style="color:${COL_B}">${fb}</span></div>
          <div class="sub">${aw == null ? '' : aw ? esc(A.m.code) + ' leads' : esc(B.m.code) + ' leads'}</div></div>`;
      };
      document.getElementById('kpis').innerHTML =
        tile('Exp. Return', A.mt.er, B.mt.er, v => v.toFixed(1) + '%', true) +
        tile('Volatility', A.mt.vol, B.mt.vol, v => v.toFixed(1) + '%', false) +
        tile('Sharpe', A.mt.sharpe, B.mt.sharpe, v => v.toFixed(2), true) +
        tile((win / 12) + 'Y Return · real', retA, retB, v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(0) + '%', true) +
        tile('Max Drawdown', mddA, mddB, v => '−' + Math.abs(v).toFixed(0) + '%', false) +
        tile('Eff. Holdings', A.mt.effN, B.mt.effN, v => v.toFixed(1), null) +
        tile('Beta', A.mt.beta, B.mt.beta, v => v.toFixed(2), null) +
        tile('Yield', A.mt.divy, B.mt.divy, v => v.toFixed(1) + '%', null);

      const yrs = win / 12, xlabels = [];
      for (let qq = 0; qq <= yrs; qq++) xlabels.push({ i: Math.round((qq / yrs) * win), t: qq === yrs ? 'NOW' : `Y−${yrs - qq}` });
      document.getElementById('perfChart').innerHTML = C.line([
        { name: A.m.code, color: COL_A, data: pA, fill: true, width: 1.8 },
        { name: B.m.code, color: COL_B, data: pB, width: 1.8 },
        { name: M.BENCH.code, color: C.css('--fg-mute'), data: pX, dash: '4 3', width: 1.2 },
      ], { h: 250, xlabels });
      document.getElementById('perfLegend').innerHTML = `
        <div class="li"><span class="sw2" style="background:${COL_A}"></span>${esc(A.m.code)} <span class="mono" style="margin-left:6px;color:${COL_A}">${(retA >= 0 ? '+' : '−') + Math.abs(retA).toFixed(1)}%</span></div>
        <div class="li"><span class="sw2" style="background:${COL_B}"></span>${esc(B.m.code)} <span class="mono" style="margin-left:6px;color:${COL_B}">${(retB >= 0 ? '+' : '−') + Math.abs(retB).toFixed(1)}%</span></div>
        <div class="li"><span class="sw2" style="background:${C.css('--fg-mute')}"></span>${esc(M.BENCH.code)} <span class="mono dim" style="margin-left:6px">${((pX[pX.length - 1] / 100 - 1) * 100).toFixed(1)}%</span></div>
        <div class="li" style="margin-left:auto"><span class="dim">A − B</span> <span class="mono ${retA >= retB ? 'up' : 'down'}">${(retA - retB).toFixed(1)} pts</span></div>`;

      // weight diff table
      const ts = [...new Set([...A.weights.map(x => x.t), ...B.weights.map(x => x.t)])];
      const rows = ts.map(t => {
        const a = M.byT(t), wa = A.wmap[t] || 0, wb = B.wmap[t] || 0;
        return { t, a, wa, wb, d: wa - wb };
      }).sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
      const P = MER.paths('index');
      document.getElementById('diffNote').textContent = ts.length + ' NAMES · SORTED BY |Δ|';
      document.getElementById('diffTable').innerHTML = `<table class="tbl">
        <thead><tr><th class="tleft">Asset</th><th class="tleft">Sector</th>
          <th style="color:${COL_A}">${esc(A.m.code)}</th><th style="color:${COL_B}">${esc(B.m.code)}</th><th>Δ A−B</th></tr></thead>
        <tbody>${rows.slice(0, 40).map(r => `
          <tr class="clickable" data-t="${esc(r.t)}">
            <td class="tleft"><div class="sym-cell"><span class="sym-chip" style="background:${r.a.color}"></span><span class="mono">${esc(r.t)}</span> <span class="asset-name">${esc(r.a.name)}</span></div></td>
            <td class="tleft dim">${esc(r.a.sector)}</td>
            <td><div class="wbar"><i style="width:${Math.min(100, r.wa * 100 * 2.2)}%;background:${COL_A};opacity:.45"></i><span>${(r.wa * 100).toFixed(1)}%</span></div></td>
            <td><div class="wbar"><i style="width:${Math.min(100, r.wb * 100 * 2.2)}%;background:${COL_B};opacity:.45"></i><span>${(r.wb * 100).toFixed(1)}%</span></div></td>
            <td class="${r.d >= 0 ? 'up' : 'down'}">${r.d >= 0 ? '+' : '−'}${Math.abs(r.d * 100).toFixed(1)} pp</td>
          </tr>`).join('')}
        </tbody></table>
        ${rows.length > 40 ? `<div class="map-note mono" style="padding:10px 14px">SHOWING TOP 40 OF ${rows.length} BY |Δ| — remaining diffs are < ${(Math.abs(rows[40].d) * 100).toFixed(1)} pp</div>` : ''}`;
      document.querySelectorAll('#diffTable tr.clickable').forEach(tr =>
        tr.addEventListener('click', () => location.href = P.asset(tr.dataset.t)));

      card('cardA', A, COL_A); card('cardB', B, COL_B);
      document.querySelectorAll('[data-info]').forEach(b => b.onclick = e => { e.stopPropagation(); MER.openInfo(M.modelById(b.dataset.info)); });
      document.title = `${A.m.code} vs ${B.m.code} — MERIDIAN PMX`;
    }
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
