/* ============================================================
   asset.js — instrument view for the full Nordnet catalog.
   asset.html?id=<nordnet id>  (any share or fund)
   asset.html?t=<yahoo ticker> (model-universe member, incl. ETFs)
   Shares: real history, correlations, cross-model table.
   Funds:  Nordnet return summary, fees, rating, facts.
   ============================================================ */
(function () {
  const M = window.MERIDIAN, C = window.Charts, MER = window.MER;
  const { esc } = C;
  const P = MER.paths('index');
  const COUNTS = (window.MERIDIAN_DATA || {}).counts || {};
  const TOTAL = (COUNTS.shares || 0) + (COUNTS.funds || 0);
  const SHARDS = 256;
  const fetchDetail = id => fetch(`data/s/${(+id) % SHARDS}.json`).then(r => r.json()).then(sh => {
    const d = sh[String(id)];
    if (!d) throw new Error('not in shard');
    return d;
  });

  const fmtChg = v => v == null ? '—' : `<span class="${v >= 0 ? 'up' : 'down'}">${v >= 0 ? '▲' : '▼'} ${Math.abs(v).toFixed(2)}%</span>`;
  const pct = (v, d = 1) => v == null ? '—' : (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d) + '%';

  function chrome(extra) {
    document.body.insertAdjacentHTML('afterbegin', MER.header(null, 'index') + MER.ticker());
    document.body.insertAdjacentHTML('beforeend', MER.footer(extra));
    MER.startClock(); MER.initSearch('index');
  }

  function kpi(k, v, sub, cls) { return `<div class="kpi"><div class="k">${k}</div><div class="v ${cls || ''}">${v}</div><div class="sub">${sub || ''}</div></div>`; }

  function nordnetBtn(d) {
    const url = d.type === 'EQ' && d.slug
      ? `https://www.nordnet.no/aksjer/kurser/${encodeURIComponent(d.slug)}`
      : `https://www.nordnet.no/market/funds/${d.id}`;
    return `<a class="btn" href="${url}" target="_blank" rel="noopener">OPEN IN NORDNET ↗</a>`;
  }

  /* ---------- model books at default settings ---------- */
  function modelBooks(yt) {
    return M.MODELS.map(m => {
      const state = {}; (m.controls || []).forEach(c => state[c.k] = c.def);
      const r = m.compute(state);
      const i = r.weights.findIndex(x => x.t === yt);
      return { m, w: i >= 0 ? r.weights[i].w : 0, rank: i >= 0 ? i + 1 : null, n: r.weights.length };
    });
  }

  function crossModelPanel(yt) {
    const books = modelBooks(yt);
    const held = books.filter(b => b.w > 0).length;
    const avgW = books.reduce((s, b) => s + b.w, 0) / books.length;
    return `
      <div class="panel mt16">
        <div class="panel-head">ACROSS ALL MODELS · DEFAULT SETTINGS
          <div class="right"><span class="mono dim">HELD BY ${held}/${books.length} · AVG ${(avgW * 100).toFixed(1)}%</span></div>
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
      </div>`;
  }

  function notInUniversePanel(d) {
    return `
      <div class="panel mt16">
        <div class="panel-head">MODEL UNIVERSE</div>
        <div class="panel-body"><p class="dim" style="margin:0;font-size:12.5px;line-height:1.6">
          ${esc(d.name)} is searchable but sits outside the model universe — the ${M.U.length}-instrument book the ten models trade
          (the most-traded Oslo Børs names with ≥3y history, plus UCITS diversifiers). It is still fully tradable on Nordnet.
        </p></div>
      </div>`;
  }

  /* ---------- correlations vs model universe ---------- */
  function corrPanel(rets) {
    if (!rets || rets.length < 24) return '';
    const n = Math.min(36, rets.length);
    const tail = rets.slice(-n);
    const mean = arr => arr.reduce((s, v) => s + v, 0) / arr.length;
    const mA = mean(tail), sdA = Math.sqrt(tail.reduce((s, v) => s + (v - mA) * (v - mA), 0) / n) || 1e-9;
    const D = window.MERIDIAN_DATA;
    const out = M.U.map(u => {
      const b = (D.rets[u.t] || []).slice(-n);
      if (b.length < n) return null;
      const mB = mean(b), sdB = Math.sqrt(b.reduce((s, v) => s + (v - mB) * (v - mB), 0) / n) || 1e-9;
      let c = 0; for (let k = 0; k < n; k++) c += (tail[k] - mA) * (b[k] - mB);
      return { u, r: (c / n) / (sdA * sdB) };
    }).filter(Boolean).sort((p, q) => q.r - p.r);
    if (!out.length) return '';
    const row = o => `<div class="view-row"><span class="sw2" style="background:${o.u.color}"></span>
      <span class="mono" style="width:84px">${esc(o.u.t)}</span>
      <span class="dim" style="font-size:11px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(o.u.name)}</span>
      <span class="mono ${o.r >= 0 ? 'up' : 'down'}">${o.r >= 0 ? '+' : '−'}${Math.abs(o.r).toFixed(2)}</span></div>`;
    return `<div class="panel mt16"><div class="panel-head">CORRELATIONS · VS MODEL UNIVERSE</div><div class="panel-body tight">
      <div class="panel-head" style="border-top:none;font-size:9px">MOST CORRELATED</div>${out.slice(0, 4).map(row).join('')}
      <div class="panel-head" style="font-size:9px">LEAST / NEGATIVE</div>${out.slice(-3).reverse().map(row).join('')}
    </div></div>`;
  }

  /* ---------- performance chart from monthly returns ---------- */
  function perfBlock(d, color) {
    const maxM = (d.rets || []).length;
    if (maxM < 13) return { html: '', wire: () => {} };
    const wins = [[36, '3Y'], [60, '5Y'], [120, '10Y']].filter(w => w[0] <= maxM || w[0] === 36);
    const html = `
      <div class="panel">
        <div class="panel-head">PERFORMANCE · GROWTH OF 100 · VS ${esc(M.BENCH.code)}
          <div class="right"><div class="seg" id="segWin">${wins.map((w, i) => `<button data-w="${w[0]}" class="${i === 0 ? 'on' : ''}">${w[1]}</button>`).join('')}</div></div>
        </div>
        <div class="panel-body"><div id="perfChart"></div><div class="legend mt12" id="perfLegend"></div></div>
      </div>`;
    function draw(win) {
      const w = Math.min(win, maxM);
      const path = (() => { const out = [100]; let idx = 100; d.rets.slice(-w).forEach(r => { idx *= (1 + r); out.push(idx); }); return out; })();
      const pB = M.benchPath(w);
      const yrs = Math.round(w / 12), xlabels = [];
      for (let q = 0; q <= yrs; q++) xlabels.push({ i: Math.round((q / yrs) * w), t: q === yrs ? 'NOW' : `Y−${yrs - q}` });
      document.getElementById('perfChart').innerHTML = C.line([
        { name: d.sym || d.name, color, data: path, fill: true, width: 1.8 },
        { name: M.BENCH.code, color: C.css('--fg-mute'), data: pB, dash: '4 3', width: 1.3 },
      ], { h: 240, xlabels });
      const eA = path[path.length - 1], eB = pB[pB.length - 1];
      document.getElementById('perfLegend').innerHTML = `
        <div class="li"><span class="sw2" style="background:${color}"></span>${esc(d.sym || d.name)} <span class="mono ${eA >= 100 ? 'up' : 'down'}" style="margin-left:6px">${((eA / 100 - 1) * 100).toFixed(1)}%</span></div>
        <div class="li"><span class="sw2" style="background:${C.css('--fg-mute')}"></span>${esc(M.BENCH.code)} <span class="mono dim" style="margin-left:6px">${((eB / 100 - 1) * 100).toFixed(1)}%</span></div>
        <div class="li" style="margin-left:auto"><span class="dim">EXCESS</span> <span class="mono ${eA >= eB ? 'up' : 'down'}">${(eA - eB).toFixed(1)} pts</span></div>`;
    }
    function wire() {
      document.querySelectorAll('#segWin button').forEach(b => b.addEventListener('click', () => {
        document.querySelectorAll('#segWin button').forEach(x => x.classList.remove('on'));
        b.classList.add('on'); draw(+b.dataset.w);
      }));
      draw(36);
    }
    return { html, wire };
  }

  /* ---------- SHARE view ---------- */
  function renderShare(d) {
    const u = d.yt && M.byT(d.yt);
    const color = u ? u.color : 'oklch(0.70 0.15 152)';
    const st = d.stats || {};
    const r = d.ratios || {};
    document.title = `${d.sym} · ${d.name} — MERIDIAN PMX`;
    // returns arrays are zero-padded to the full window — trim to actual listing history
    const realRets = (d.rets || []).slice(-Math.min(d.months || 0, (d.rets || []).length));
    const perf = perfBlock({ ...d, rets: realRets }, color);
    document.getElementById('app').innerHTML = `
      <div class="wrap page">
        <div class="model-hero fade-in">
          <div class="mh-left">
            <div class="mh-no mono" style="color:${color}">${esc(d.sym)}</div>
            <div>
              <h1 class="mh-title">${esc(d.name)}</h1>
              <p class="mh-tag">${esc(d.cat)} · ${esc(d.ccy)} · last ${d.px > 0 ? d.px.toFixed(2) : '—'} ${fmtChg(d.chg)} on the day
                ${d.owners ? `· <span class="mono dim">${d.owners.toLocaleString('en-US')} owners on Nordnet</span>` : ''}</p>
            </div>
          </div>
          <div class="mh-right">
            <span class="badge ${u ? 'g' : ''}">${u ? '● IN MODEL UNIVERSE' : '○ OUTSIDE MODEL UNIVERSE'}</span>
            ${nordnetBtn(d)}
          </div>
        </div>

        <div class="kpis fade-in">
          ${u ? kpi('Exp. Return', u.er.toFixed(1) + '%', 'μ estimate · ann.', 'up') : kpi('1Y Return', pct(d.y && d.y.yield_1y), 'Nordnet', d.y && d.y.yield_1y >= 0 ? 'up' : 'down')}
          ${kpi('Volatility', st.vol != null ? st.vol.toFixed(1) + '%' : '—', (st.src || 'realized') + ' · ann. σ')}
          ${kpi('Beta vs ' + M.BENCH.code, st.beta != null ? st.beta.toFixed(2) : '—', st.src || '—')}
          ${kpi('12-1 Momentum', st.mom != null ? pct(st.mom) : '—', 'trailing yr, ex last mo', st.mom >= 0 ? 'up' : 'down')}
          ${kpi('P/E', r.pe ? r.pe.toFixed(1) : '—', 'trailing')}
          ${kpi('P/B', r.pb ? r.pb.toFixed(2) : '—', 'price / book')}
          ${kpi('Yield', r.div != null ? r.div.toFixed(2) + '%' : '—', 'dividend')}
          ${kpi('History', d.months + ' mo', 'monthly data')}
        </div>

        <div class="model-grid mt16">
          <div class="main">
            ${perf.html}
            ${u ? crossModelPanel(d.yt) : notInUniversePanel(d)}
          </div>
          <div class="side">
            <div class="panel">
              <div class="panel-head">RETURNS · NORDNET</div>
              <div class="panel-body"><div class="kv">
                ${['yield_1m|1 month', 'yield_3m|3 months', 'yield_ytd|YTD', 'yield_1y|1 year', 'yield_3y|3 years', 'yield_5y|5 years', 'yield_10y|10 years']
                  .map(s => { const [k, lbl] = s.split('|'); const v = d.y ? d.y[k] : null;
                    return `<span class="kk">${lbl}</span><span class="vv ${v >= 0 ? 'up' : 'down'}">${pct(v)}</span>`; }).join('')}
              </div></div>
            </div>
            <div id="corrSlot"></div>
            <div class="panel mt16">
              <div class="panel-head">SNAPSHOT</div>
              <div class="panel-body"><div class="kv">
                <span class="kk">Ticker</span><span class="vv">${esc(d.sym)}</span>
                <span class="kk">ISIN</span><span class="vv">${esc(d.isin || '—')}</span>
                <span class="kk">Currency</span><span class="vv">${esc(d.ccy)}</span>
                <span class="kk">Last close</span><span class="vv">${d.px > 0 ? d.px.toFixed(2) : '—'}</span>
                <span class="kk">Owners @ Nordnet</span><span class="vv">${(d.owners || 0).toLocaleString('en-US')}</span>
                <span class="kk">Data as of</span><span class="vv">${esc(M.ASOF)}</span>
              </div></div>
            </div>
          </div>
        </div>
      </div>`;
    perf.wire();
    document.getElementById('corrSlot').outerHTML = corrPanel(realRets);
    wireRows();
  }

  /* ---------- FUND view ---------- */
  function renderFund(d) {
    const f = d.fund || {};
    document.title = `${d.name} — MERIDIAN PMX`;
    const stars = f.ms ? '★'.repeat(f.ms) + '<span class="mute">' + '★'.repeat(5 - f.ms) + '</span>' : '—';
    const bars = ['yield_1m|1M', 'yield_3m|3M', 'yield_ytd|YTD', 'yield_1y|1Y', 'yield_3y|3Y', 'yield_5y|5Y', 'yield_10y|10Y']
      .map(s => { const [k, lbl] = s.split('|'); const v = d.y ? d.y[k] : null; return v == null ? null : { label: lbl, value: v, disp: pct(v) }; })
      .filter(Boolean);
    document.getElementById('app').innerHTML = `
      <div class="wrap page">
        <div class="model-hero fade-in">
          <div class="mh-left">
            <div class="mh-no mono" style="color:var(--info);font-size:18px;max-width:120px;line-height:1.25">FOND</div>
            <div>
              <h1 class="mh-title">${esc(d.name)}</h1>
              <p class="mh-tag">${esc(d.cat)} · ${esc(d.ccy)} · NAV ${d.px > 0 ? d.px.toFixed(2) : '—'} ${fmtChg(d.chg)}
                ${d.owners ? `· <span class="mono dim">${d.owners.toLocaleString('en-US')} owners on Nordnet</span>` : ''}</p>
            </div>
          </div>
          <div class="mh-right">
            <span class="badge b">○ FUND — OUTSIDE MODEL UNIVERSE</span>
            ${f.selection ? '<span class="badge g">NORDNET SELECTION</span>' : ''}
            ${nordnetBtn(d)}
          </div>
        </div>

        <div class="kpis fade-in">
          ${kpi('1Y Return', pct(d.y && d.y.yield_1y), 'cumulative', d.y && d.y.yield_1y >= 0 ? 'up' : 'down')}
          ${kpi('3Y Return', pct(d.y && d.y.yield_3y), 'cumulative', d.y && d.y.yield_3y >= 0 ? 'up' : 'down')}
          ${kpi('Yearly Fee', f.calcFee != null ? f.calcFee.toFixed(2) + '%' : (f.fee != null ? f.fee.toFixed(2) + '%' : '—'), 'effective, via Nordnet')}
          ${kpi('Morningstar', stars, 'rating')}
          ${kpi('Risk', f.risk != null ? f.risk + ' / 7' : '—', esc(f.riskGroup || 'KIID scale'))}
          ${kpi('Fund Size', f.aum != null ? f.aum.toFixed(2) + ' bn' : '—', esc(d.ccy))}
          ${kpi('ESG', f.esg != null ? String(f.esg) : '—', esc(f.sfdr || ''))}
          ${kpi('Min. Buy', f.minInv != null ? f.minInv.toLocaleString('en-US') : '—', esc(d.ccy))}
        </div>

        <div class="model-grid mt16">
          <div class="main">
            <div class="panel">
              <div class="panel-head">RETURNS · NORDNET DATA</div>
              <div class="panel-body"><div id="fundBars"></div>
                <div class="map-note mono">Nordnet does not expose fund NAV history publicly — periods are cumulative returns as reported. OBX 1Y for reference: ${pct((window.MERIDIAN_DATA.rets['__BENCH__'].slice(-12).reduce((a, r) => a * (1 + r), 1) - 1) * 100)}</div>
              </div>
            </div>
            ${notInUniversePanel(d)}
          </div>
          <div class="side">
            <div class="panel">
              <div class="panel-head">FUND FACTS</div>
              <div class="panel-body"><div class="kv">
                <span class="kk">Category</span><span class="vv">${esc(d.cat)}</span>
                <span class="kk">Type</span><span class="vv">${esc(f.type || '—')}</span>
                <span class="kk">Manager</span><span class="vv">${esc(f.admin || '—')}</span>
                <span class="kk">ISIN</span><span class="vv">${esc(d.isin || '—')}</span>
                <span class="kk">Listed fee</span><span class="vv">${f.fee != null ? f.fee.toFixed(2) + '%' : '—'}</span>
                <span class="kk">Effective fee</span><span class="vv">${f.calcFee != null ? f.calcFee.toFixed(2) + '%' : '—'}</span>
                <span class="kk">SFDR</span><span class="vv">${esc(f.sfdr || '—')}</span>
                <span class="kk">Data as of</span><span class="vv">${esc(M.ASOF)}</span>
              </div></div>
            </div>
          </div>
        </div>
      </div>`;
    document.getElementById('fundBars').innerHTML = C.hbars(bars, { w: 640, labW: 56, rowH: 24, signed: true });
    wireRows();
  }

  /* ---------- ETF / model member without Nordnet detail ---------- */
  function renderUMember(u) {
    const d = { id: null, sym: u.t, yt: u.t, name: u.name, type: 'EQ', cat: u.sector, ccy: u.ccy,
                isin: null, px: u.px, chg: u.chg, owners: null, slug: u.slug,
                ratios: { pe: u.pe, pb: u.pb, div: u.div },
                stats: { vol: u.vol, beta: u.beta, mom: u.mom }, y: null,
                months: (window.MERIDIAN_DATA.rets[u.t] || []).length,
                rets: window.MERIDIAN_DATA.rets[u.t] || [] };
    renderShare(d);
  }

  function wireRows() {
    document.querySelectorAll('tr.clickable[data-href]').forEach(tr => tr.addEventListener('click', e => {
      if (e.target.closest('[data-info]')) return;
      location.href = tr.dataset.href;
    }));
    document.querySelectorAll('[data-info]').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation(); MER.openInfo(M.modelById(b.dataset.info));
    }));
  }

  function renderUnknown(msg) {
    document.getElementById('app').innerHTML = `<div class="wrap page">
      <div class="section-bar"><h2>${esc(msg)}</h2><div class="hr"></div></div>
      <div class="panel"><div class="panel-body">
        <p class="dim" style="margin:0 0 14px">Search any of the ${TOTAL.toLocaleString('en-US')} Nordnet instruments in the box above, or open a model-universe name:</p>
        <div class="wrap-flex" style="gap:8px">${M.U.slice(0, 30).map(x => `<a class="btn" href="asset.html?t=${encodeURIComponent(x.t)}"><span style="color:${x.color}">●</span> ${esc(x.t)}</a>`).join('')}</div>
      </div></div></div>`;
  }

  async function init() {
    const q = new URLSearchParams(location.search);
    const id = q.get('id'), t = q.get('t');
    chrome(id ? `ASSET · NN ${id}` : t ? `ASSET · ${t}` : 'ASSET LOOKUP');

    if (id) {
      try {
        const d = await fetchDetail(id);
        if (d.type === 'FND') renderFund(d); else renderShare(d);
      } catch (e) {
        renderUnknown('UNKNOWN INSTRUMENT · ' + id);
      }
      return;
    }
    if (t) {
      const u = M.byT(t);
      if (!u) return renderUnknown('UNKNOWN TICKER · ' + t);
      if (u.nn) {
        try {
          const d = await fetchDetail(u.nn);
          return renderShare(d);
        } catch (e) { /* fall back to local data */ }
      }
      return renderUMember(u);
    }
    renderUnknown('ASSET LOOKUP');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
