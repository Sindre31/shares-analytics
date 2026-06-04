/* ============================================================
   asset.js — single-share view: how one instrument performs
   across all 10 models. Open via asset.html?t=TICKER
   ============================================================ */
(function () {
  const M = window.MERIDIAN, C = window.Charts, MER = window.MER;
  const { esc } = C;

  function init() {
    const t = new URLSearchParams(location.search).get('t');
    const a = M.byT(t);

    document.body.insertAdjacentHTML('afterbegin', MER.header(null, 'index') + MER.ticker());
    document.body.insertAdjacentHTML('beforeend', MER.footer(a ? `ASSET · ${a.t} · ${a.sector.toUpperCase()}` : 'ASSET LOOKUP'));
    MER.startClock(); MER.initSearch('index');

    const root = document.getElementById('app');
    if (!a) {
      root.innerHTML = `<div class="wrap page">
        <div class="section-bar"><h2>UNKNOWN TICKER${t ? ' · ' + esc(t) : ''}</h2><div class="hr"></div></div>
        <div class="panel"><div class="panel-body">
          <p class="dim" style="margin:0 0 14px">Pick a share from the universe, or use the search box above.</p>
          <div class="wrap-flex" style="gap:8px">${M.U.map(x => `<a class="btn" href="asset.html?t=${encodeURIComponent(x.t)}"><span style="color:${x.color}">●</span> ${esc(x.t)}</a>`).join('')}</div>
        </div></div></div>`;
      return;
    }
    document.title = `${a.t} · ${a.name} — MERIDIAN PMX`;

    // run every model at default settings, find this asset's position
    const books = M.MODELS.map(m => {
      const state = {}; (m.controls || []).forEach(c => state[c.k] = c.def);
      const r = m.compute(state);
      const i = r.weights.findIndex(x => x.t === a.t);
      return { m, w: i >= 0 ? r.weights[i].w : 0, rank: i >= 0 ? i + 1 : null, n: r.weights.length };
    });
    const held = books.filter(b => b.w > 0);
    const avgW = books.reduce((s, b) => s + b.w, 0) / books.length;
    const maxB = books.reduce((p, b) => b.w > p.w ? b : p, books[0]);

    root.innerHTML = `
      <div class="wrap page">
        <div class="model-hero fade-in">
          <div class="mh-left">
            <div class="mh-no mono" style="color:${a.color}">${esc(a.t.split('.')[0])}</div>
            <div>
              <h1 class="mh-title">${esc(a.name)}</h1>
              <p class="mh-tag">${esc(a.sector)} · ${esc(a.ccy)} · last ${a.px.toFixed(2)}
                <span class="mono ${a.chg >= 0 ? 'up' : 'down'}">${a.chg >= 0 ? '▲' : '▼'} ${Math.abs(a.chg).toFixed(2)}%</span> on the day</p>
            </div>
          </div>
          <div class="mh-right">
            <span class="badge ${held.length ? 'g' : 'r'}">${held.length ? '● HELD BY ' + held.length + ' / ' + books.length + ' MODELS' : '○ HELD BY NO MODEL'}</span>
            <span class="badge">${esc(a.t)}</span>
            <span class="cat-tag">TRADABLE ON NORDNET NO</span>
          </div>
        </div>

        <div class="kpis fade-in" style="grid-template-columns:repeat(4,1fr)">
          <div class="kpi"><div class="k">Exp. Return</div><div class="v up">${a.er.toFixed(1)}%</div><div class="sub">μ estimate · ann.</div></div>
          <div class="kpi"><div class="k">Volatility</div><div class="v">${a.vol.toFixed(1)}%</div><div class="sub">2y realized · ann. σ</div></div>
          <div class="kpi"><div class="k">Beta vs ${esc(M.BENCH.code)}</div><div class="v">${a.beta.toFixed(2)}</div><div class="sub">2y daily</div></div>
          <div class="kpi"><div class="k">12-1 Momentum</div><div class="v ${a.mom >= 0 ? 'up' : 'down'}">${a.mom >= 0 ? '+' : '−'}${Math.abs(a.mom).toFixed(1)}%</div><div class="sub">trailing yr, ex last mo</div></div>
          <div class="kpi"><div class="k">P/E</div><div class="v">${a.pe ? a.pe.toFixed(1) : '—'}</div><div class="sub">trailing</div></div>
          <div class="kpi"><div class="k">P/B</div><div class="v">${a.pb ? a.pb.toFixed(2) : '—'}</div><div class="sub">price / book</div></div>
          <div class="kpi"><div class="k">Yield</div><div class="v">${a.div.toFixed(2)}%</div><div class="sub">dividend</div></div>
          <div class="kpi"><div class="k">Mkt Cap</div><div class="v">${a.mcap >= 1000 ? (a.mcap / 1000).toFixed(2) + 'T' : a.mcap.toFixed(0) + 'B'}</div><div class="sub">NOK</div></div>
        </div>

        <div class="model-grid mt16">
          <div class="main">
            <div class="panel">
              <div class="panel-head">PERFORMANCE · GROWTH OF 100 · VS ${esc(M.BENCH.code)}
                <div class="right">
                  <div class="seg" id="segWin">
                    <button data-w="36" class="on">3Y</button><button data-w="60">5Y</button><button data-w="120">10Y</button>
                  </div>
                </div>
              </div>
              <div class="panel-body"><div id="perfChart"></div><div class="legend mt12" id="perfLegend"></div></div>
            </div>

            <div class="panel mt16">
              <div class="panel-head">ACROSS ALL MODELS · DEFAULT SETTINGS
                <div class="right"><span class="mono dim">AVG WEIGHT ${(avgW * 100).toFixed(1)}%</span></div>
              </div>
              <div class="panel-body tight">
                <table class="tbl">
                  <thead><tr><th class="tleft">Model</th><th class="tleft">Class</th><th>Status</th><th>Weight</th><th>Rank</th><th></th></tr></thead>
                  <tbody>${books.map(b => `
                    <tr class="clickable" data-href="models/${MER.fileFor(b.m)}">
                      <td class="tleft"><span class="mono" style="font-weight:600">${esc(b.m.code)}</span> <span class="asset-name">${esc(b.m.name)}</span></td>
                      <td class="tleft dim">${esc(b.m.cat)}</td>
                      <td>${b.w > 0 ? '<span class="badge g">● HELD</span>' : '<span class="badge">○ EXCLUDED</span>'}</td>
                      <td><div class="wbar"><i style="width:${Math.min(100, b.w * 100 * 2.2)}%"></i><span>${(b.w * 100).toFixed(1)}%</span></div></td>
                      <td class="dim">${b.rank ? '#' + b.rank + ' / ' + b.n : '—'}</td>
                      <td><button class="ibtn" data-info="${b.m.id}" title="About">i</button></td>
                    </tr>`).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div class="side">
            <div class="panel">
              <div class="panel-head">WHY MODELS HOLD IT</div>
              <div class="panel-body">
                <p class="dim" style="margin:0;font-size:12.5px;line-height:1.6">
                  ${maxB.w > 0
                    ? `Largest backer: <span class="mono" style="color:var(--up)">${esc(maxB.m.code)}</span> at ${(maxB.w * 100).toFixed(1)}%. `
                    : 'No model holds this name at default settings. '}
                  Each model scores ${esc(a.t.split('.')[0])} on what it cares about — momentum looks at the +${Math.abs(a.mom).toFixed(0)}% trend signal, value at P/E ${a.pe ? a.pe.toFixed(1) : '—'}, risk-based books at its ${a.vol.toFixed(0)}% volatility, factor models at size and quality. Open a model to tune its dials and watch the weight move.
                </p>
              </div>
            </div>

            <div class="panel mt16">
              <div class="panel-head">CORRELATIONS · 3Y MONTHLY</div>
              <div class="panel-body tight" id="corrList"></div>
            </div>

            <div class="panel mt16">
              <div class="panel-head">SNAPSHOT</div>
              <div class="panel-body"><div class="kv">
                <span class="kk">Ticker</span><span class="vv">${esc(a.t)}</span>
                <span class="kk">Sector</span><span class="vv">${esc(a.sector)}</span>
                <span class="kk">Currency</span><span class="vv">${esc(a.ccy)}</span>
                <span class="kk">Last close</span><span class="vv">${a.px.toFixed(2)}</span>
                <span class="kk">1-day</span><span class="vv ${a.chg >= 0 ? 'up' : 'down'}">${a.chg >= 0 ? '+' : '−'}${Math.abs(a.chg).toFixed(2)}%</span>
                <span class="kk">Quality (ROE)</span><span class="vv">${(a.qual * 100).toFixed(0)}%</span>
                <span class="kk">Data as of</span><span class="vv">${esc(M.ASOF)}</span>
              </div></div>
            </div>
          </div>
        </div>
      </div>`;

    // performance vs benchmark
    let win = 36;
    function renderPerf() {
      const pA = M.pathFor([{ t: a.t, w: 1 }], win);
      const pB = M.benchPath(win);
      const yrs = win / 12, xlabels = [];
      for (let q = 0; q <= yrs; q++) xlabels.push({ i: Math.round((q / yrs) * win), t: q === yrs ? 'NOW' : `Y−${yrs - q}` });
      document.getElementById('perfChart').innerHTML = C.line([
        { name: a.t, color: a.color, data: pA, fill: true, width: 1.8 },
        { name: M.BENCH.code, color: C.css('--fg-mute'), data: pB, dash: '4 3', width: 1.3 },
      ], { h: 240, xlabels });
      const eA = pA[pA.length - 1], eB = pB[pB.length - 1];
      document.getElementById('perfLegend').innerHTML = `
        <div class="li"><span class="sw2" style="background:${a.color}"></span>${esc(a.t)} <span class="mono ${eA >= 100 ? 'up' : 'down'}" style="margin-left:6px">${((eA / 100 - 1) * 100).toFixed(1)}%</span></div>
        <div class="li"><span class="sw2" style="background:${C.css('--fg-mute')}"></span>${esc(M.BENCH.code)} <span class="mono dim" style="margin-left:6px">${((eB / 100 - 1) * 100).toFixed(1)}%</span></div>
        <div class="li" style="margin-left:auto"><span class="dim">EXCESS</span> <span class="mono ${eA >= eB ? 'up' : 'down'}">${((eA - eB)).toFixed(1)} pts</span></div>`;
    }
    document.querySelectorAll('#segWin button').forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll('#segWin button').forEach(x => x.classList.remove('on'));
      b.classList.add('on'); win = +b.dataset.w; renderPerf();
    }));
    renderPerf();

    // correlation list — strongest positive & negative vs rest of universe
    const corrs = M.U.filter(x => x.t !== a.t).map(x => ({ x, r: M.rhoOf(a.t, x.t) })).sort((p, q) => q.r - p.r);
    const hi = corrs.slice(0, 4), lo = corrs.slice(-3).reverse();
    const row = o => `<div class="view-row"><span class="sw2" style="background:${o.x.color}"></span>
      <span class="mono" style="width:84px">${esc(o.x.t)}</span>
      <span class="dim" style="font-size:11px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(o.x.name)}</span>
      <span class="mono ${o.r >= 0 ? 'up' : 'down'}">${o.r >= 0 ? '+' : '−'}${Math.abs(o.r).toFixed(2)}</span></div>`;
    document.getElementById('corrList').innerHTML =
      `<div class="panel-head" style="border-top:none;font-size:9px">MOST CORRELATED</div>${hi.map(row).join('')}
       <div class="panel-head" style="font-size:9px">LEAST / NEGATIVE</div>${lo.map(row).join('')}`;

    // interactions
    document.querySelectorAll('tr.clickable[data-href]').forEach(tr => tr.addEventListener('click', e => {
      if (e.target.closest('[data-info]')) return;
      location.href = tr.dataset.href;
    }));
    document.querySelectorAll('[data-info]').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation(); MER.openInfo(M.modelById(b.dataset.info));
    }));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
