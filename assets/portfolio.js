/* ============================================================
   portfolio.js — "My Book": your actual Nordnet holdings vs the models.
   Holdings live in localStorage (mer_portfolio = [{id, qty}]).
   Add via search or paste a Nordnet CSV export (matched by ISIN/name).
   All computation client-side; nothing leaves the browser.
   ============================================================ */
(function () {
  const M = window.MERIDIAN, C = window.Charts, MER = window.MER;
  const { esc } = C;
  const D = window.MERIDIAN_DATA;
  const FX = Object.assign({ NOK: 1, EUR: 11.6, USD: 10.4, SEK: 1.05, DKK: 1.55, CAD: 7.6, CHF: 12.9, GBP: 13.3 }, D.fx || {});
  const LS = 'mer_portfolio';

  const load = () => { try { return JSON.parse(localStorage.getItem(LS)) || []; } catch (e) { return []; } };
  const save = h => { try { localStorage.setItem(LS, JSON.stringify(h)); } catch (e) {} };

  const fmtNOK = v => 'kr ' + Math.round(v).toLocaleString('en-US');
  const pct = (v, d = 1) => v == null ? '—' : (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d) + '%';

  let holdings = load();          // [{id, qty}]
  let details = {};               // id -> shard detail
  let modelSel = 'mvo';

  async function fetchDetails(ids) {
    const need = [...new Set(ids.map(i => (+i) % 256))];
    const shards = await Promise.all(need.map(s => fetch(`data/s/${s}.json`).then(r => r.json()).catch(() => ({}))));
    const bySh = Object.fromEntries(need.map((s, i) => [s, shards[i]]));
    const out = {};
    ids.forEach(id => { const d = (bySh[(+id) % 256] || {})[String(id)]; if (d) out[id] = d; });
    return out;
  }

  function rowsFromHoldings() {
    return holdings.map(h => {
      const d = details[h.id];
      if (!d) return null;
      const px = d.px || 0;
      const valNOK = h.qty * px * (FX[d.ccy] || 1);
      return { id: h.id, qty: h.qty, d, px, valNOK };
    }).filter(Boolean);
  }

  /* ---------- CSV import (Nordnet export: ISIN/name/qty columns) ---------- */
  async function importCSV(text) {
    const CAT = await MER.loadCatalog('index');
    const byIsin = {}; CAT.forEach(c => { if (c.isin) byIsin[c.isin.toUpperCase()] = c; });
    const byName = {}; CAT.forEach(c => { byName[(c.name || '').toLowerCase()] = c; });
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (!lines.length) return { added: 0, missed: [] };
    const sep = (lines[0].match(/;/g) || []).length >= (lines[0].match(/\t/g) || []).length ? ';' : '\t';
    const head = lines[0].toLowerCase().split(sep).map(s => s.replace(/"/g, '').trim());
    const idx = {
      isin: head.findIndex(h => h.includes('isin')),
      name: head.findIndex(h => h.includes('verdipapir') || h.includes('navn') || h.includes('name') || h.includes('instrument')),
      qty: head.findIndex(h => h === 'antall' || h.includes('antall') || h.includes('quantity') || h.includes('qty') || h.includes('beholdning')),
    };
    const hasHeader = idx.isin >= 0 || idx.qty >= 0;
    const dataLines = hasHeader ? lines.slice(1) : lines;
    let added = 0; const missed = [];
    for (const line of dataLines) {
      const cells = line.split(sep).map(s => s.replace(/"/g, '').trim());
      let c = null;
      if (idx.isin >= 0 && cells[idx.isin]) c = byIsin[cells[idx.isin].toUpperCase()];
      if (!c && idx.name >= 0 && cells[idx.name]) c = byName[cells[idx.name].toLowerCase()];
      if (!c && !hasHeader) { // free-form "TICKER qty" lines
        const mfree = line.match(/^(\S+)[\s;,]+([\d\s.,]+)$/);
        if (mfree) c = CAT.find(x => (x.sym || '').toUpperCase() === mfree[1].toUpperCase());
      }
      const rawQty = idx.qty >= 0 ? cells[idx.qty] : (line.match(/([\d\s.,]+)\s*$/) || [])[1];
      const qty = rawQty ? parseFloat(rawQty.replace(/\s/g, '').replace(',', '.')) : NaN;
      if (c && qty > 0) {
        const ex = holdings.find(h => h.id === c.id);
        if (ex) ex.qty = qty; else holdings.push({ id: c.id, qty });
        added++;
      } else if (line) {
        missed.push(line.slice(0, 60));
      }
    }
    save(holdings);
    return { added, missed };
  }

  /* ---------- analysis ---------- */
  function pathOf(rows, win) {
    const withH = rows.filter(r => (r.d.rets || []).length >= 13);
    const tot = withH.reduce((s, r) => s + r.valNOK, 0) || 1;
    const T = Math.min(win, Math.max(...withH.map(r => r.d.rets.length), 0));
    if (!withH.length || T < 13) return null;
    const out = [100]; let idx = 100;
    for (let k = T; k > 0; k--) {
      let pr = 0;
      withH.forEach(r => { const rr = r.d.rets; pr += (r.valNOK / tot) * (rr[rr.length - k] || 0); });
      idx *= (1 + pr); out.push(idx);
    }
    return { path: out, coverage: withH.reduce((s, r) => s + r.valNOK, 0) / (rows.reduce((s, r) => s + r.valNOK, 0) || 1), T };
  }

  function estVol(rows) {
    const withH = rows.filter(r => (r.d.rets || []).length >= 24);
    if (withH.length < 1) return null;
    const tot = withH.reduce((s, r) => s + r.valNOK, 0) || 1;
    const n = 36;
    const series = withH.map(r => ({ w: r.valNOK / tot, rr: r.d.rets.slice(-n) }));
    const len = Math.min(...series.map(s => s.rr.length));
    const port = [];
    for (let k = 0; k < len; k++) port.push(series.reduce((s, x) => s + x.w * (x.rr[x.rr.length - len + k] || 0), 0));
    const m = port.reduce((s, v) => s + v, 0) / port.length;
    return Math.sqrt(port.reduce((s, v) => s + (v - m) * (v - m), 0) / port.length) * Math.sqrt(12) * 100;
  }

  /* ---------- render ---------- */
  async function render() {
    details = await fetchDetails(holdings.map(h => h.id));
    const rows = rowsFromHoldings().sort((a, b) => b.valNOK - a.valNOK);
    const tot = rows.reduce((s, r) => s + r.valNOK, 0);
    const root = document.getElementById('app');

    if (!rows.length) {
      root.innerHTML = `
        <div class="wrap page">
          <div class="model-hero fade-in"><div class="mh-left"><div>
            <h1 class="mh-title">◈ MY BOOK</h1>
            <p class="mh-tag">Build your actual portfolio and hold it up against all ten models. Everything stays in your browser — nothing is uploaded.</p>
          </div></div></div>
          <div class="cols-2 mt16">
            <div class="panel"><div class="panel-head">ADD HOLDINGS · SEARCH</div><div class="panel-body">
              <p class="dim" style="margin:0 0 10px;font-size:12.5px">Search any of the ${((D.counts.shares || 0) + (D.counts.funds || 0)).toLocaleString('en-US')} Nordnet instruments, set a quantity.</p>
              <div id="addBox"></div>
            </div></div>
            <div class="panel"><div class="panel-head">OR PASTE NORDNET CSV</div><div class="panel-body">
              <p class="dim" style="margin:0 0 10px;font-size:12.5px">Nordnet → Portefølje → Eksporter (CSV). Matched by ISIN, then name. Or paste free-form lines like <span class="mono">EQNR 120</span>.</p>
              <textarea id="csvBox" rows="7" style="width:100%;background:var(--bg);border:1px solid var(--line-2);border-radius:2px;color:var(--fg);font-family:var(--mono);font-size:11px;padding:8px"></textarea>
              <div class="row mt8"><button class="btn primary" id="csvBtn">IMPORT</button><span class="dim mono" id="csvMsg" style="font-size:11px"></span></div>
            </div></div>
          </div>
        </div>`;
      mountAdd(); mountCSV();
      return;
    }

    const perf = pathOf(rows, 120);
    const vol = estVol(rows);
    const hhi = rows.reduce((s, r) => s + Math.pow(r.valNOK / tot, 2), 0);
    const day = rows.reduce((s, r) => s + (r.d.chg != null ? r.valNOK * r.d.chg / 100 : 0), 0);

    root.innerHTML = `
      <div class="wrap page">
        <div class="model-hero fade-in">
          <div class="mh-left"><div>
            <h1 class="mh-title">◈ MY BOOK</h1>
            <p class="mh-tag">${rows.length} holdings · valued in NOK at last close · stored locally in this browser</p>
          </div></div>
          <div class="mh-right">
            <span class="badge g">● ${fmtNOK(tot)}</span>
            <button class="btn ghost" id="clearBtn" style="font-size:10px">CLEAR ALL</button>
          </div>
        </div>

        <div class="kpis fade-in">
          <div class="kpi"><div class="k">Total Value</div><div class="v">${fmtNOK(tot)}</div><div class="sub">at last close · FX→NOK</div></div>
          <div class="kpi"><div class="k">1-Day P&L</div><div class="v ${day >= 0 ? 'up' : 'down'}">${day >= 0 ? '+' : '−'}${fmtNOK(Math.abs(day)).slice(3)}</div><div class="sub">${pct(tot ? day / tot * 100 : null, 2)}</div></div>
          <div class="kpi"><div class="k">Est. Volatility</div><div class="v">${vol != null ? vol.toFixed(1) + '%' : '—'}</div><div class="sub">3y monthly · ann. σ</div></div>
          <div class="kpi"><div class="k">Eff. Holdings</div><div class="v">${(1 / hhi).toFixed(1)}</div><div class="sub">inverse HHI</div></div>
        </div>

        <div class="model-grid mt16">
          <div class="main">
            ${perf ? `<div class="panel">
              <div class="panel-head">PERFORMANCE · CURRENT WEIGHTS, MONTHLY REBALANCED · VS ${esc(M.BENCH.code)}
                <div class="right"><span class="mono dim">${Math.round(perf.coverage * 100)}% OF VALUE HAS HISTORY</span></div>
              </div>
              <div class="panel-body"><div id="perfChart"></div><div class="legend mt12" id="perfLegend"></div></div>
            </div>` : ''}

            <div class="panel ${perf ? 'mt16' : ''}">
              <div class="panel-head">HOLDINGS<div class="right"><span class="mono dim">${rows.length} POSITIONS</span></div></div>
              <div class="panel-body tight"><table class="tbl">
                <thead><tr><th class="tleft">Instrument</th><th>Qty</th><th>Last</th><th>1D</th><th>Value (NOK)</th><th>Weight</th><th></th></tr></thead>
                <tbody>${rows.map(r => `
                  <tr>
                    <td class="tleft"><a class="sym-cell" href="asset.html?id=${r.id}"><span class="sym-chip" style="background:${r.d.type === 'FND' ? 'var(--info)' : 'var(--up-dim)'}"></span><span><span class="mono">${esc(r.d.sym || 'FOND')}</span> <span class="asset-name">${esc(r.d.name)}</span></span></a></td>
                    <td><input type="number" class="qty mono" data-id="${r.id}" value="${r.qty}" min="0" step="any" style="width:84px;background:var(--bg);border:1px solid var(--line-2);color:var(--fg);padding:2px 6px;border-radius:2px;text-align:right"></td>
                    <td class="dim">${r.px > 0 ? r.px.toFixed(2) : '—'} <span class="mute" style="font-size:9px">${esc(r.d.ccy)}</span></td>
                    <td class="${(r.d.chg || 0) >= 0 ? 'up' : 'down'}">${pct(r.d.chg, 2)}</td>
                    <td>${fmtNOK(r.valNOK)}</td>
                    <td><div class="wbar"><i style="width:${Math.min(100, r.valNOK / tot * 100 * 2.2)}%"></i><span>${(r.valNOK / tot * 100).toFixed(1)}%</span></div></td>
                    <td><button class="ibtn rm" data-id="${r.id}" title="Remove" style="font-style:normal">✕</button></td>
                  </tr>`).join('')}
                </tbody></table></div>
            </div>

            <div class="panel mt16">
              <div class="panel-head">VS MODEL ·
                <select id="modelSel" class="btn" style="appearance:auto;padding:3px 8px;font-size:10.5px">${M.MODELS.map(m => `<option value="${m.id}" ${m.id === modelSel ? 'selected' : ''}>${m.code} — ${esc(m.name)}</option>`).join('')}</select>
                <div class="right"><span class="mono dim" id="vsNote"></span></div>
              </div>
              <div class="panel-body tight"><div id="vsTable"></div></div>
            </div>
          </div>

          <div class="side">
            <div class="panel"><div class="panel-head">ADD HOLDING</div><div class="panel-body" id="addBox"></div></div>
            <div class="panel mt16"><div class="panel-head">IMPORT NORDNET CSV</div><div class="panel-body">
              <textarea id="csvBox" rows="5" style="width:100%;background:var(--bg);border:1px solid var(--line-2);border-radius:2px;color:var(--fg);font-family:var(--mono);font-size:10.5px;padding:8px" placeholder="Lim inn CSV-eksport eller 'EQNR 120'-linjer"></textarea>
              <div class="row mt8"><button class="btn" id="csvBtn">IMPORT</button><span class="dim mono" id="csvMsg" style="font-size:10.5px"></span></div>
            </div></div>
            <div class="panel mt16"><div class="panel-head">ALLOCATION</div>
              <div class="panel-body" style="display:flex;flex-direction:column;align-items:center">
                <div id="donut"></div><div class="legend mt16" id="donutLegend" style="align-self:stretch"></div>
              </div>
            </div>
          </div>
        </div>
      </div>`;

    // perf chart
    if (perf) {
      const win = perf.T;
      const pB = M.benchPath(win);
      const yrs = Math.max(1, Math.round(win / 12)), xl = [];
      for (let q = 0; q <= yrs; q++) xl.push({ i: Math.round((q / yrs) * win), t: q === yrs ? 'NOW' : `Y−${yrs - q}` });
      document.getElementById('perfChart').innerHTML = C.line([
        { name: 'MY BOOK', color: C.css('--up'), data: perf.path, fill: true, width: 1.8 },
        { name: M.BENCH.code, color: C.css('--fg-mute'), data: pB, dash: '4 3', width: 1.2 },
      ], { h: 230, xlabels: xl });
      const e1 = perf.path[perf.path.length - 1], e2 = pB[pB.length - 1];
      document.getElementById('perfLegend').innerHTML = `
        <div class="li"><span class="sw2" style="background:${C.css('--up')}"></span>MY BOOK <span class="mono ${e1 >= 100 ? 'up' : 'down'}" style="margin-left:6px">${pct((e1 / 100 - 1) * 100)}</span></div>
        <div class="li"><span class="sw2" style="background:${C.css('--fg-mute')}"></span>${esc(M.BENCH.code)} <span class="mono dim" style="margin-left:6px">${pct((e2 / 100 - 1) * 100)}</span></div>
        <div class="li" style="margin-left:auto"><span class="dim">EXCESS</span> <span class="mono ${e1 >= e2 ? 'up' : 'down'}">${(e1 - e2).toFixed(1)} pts</span></div>`;
    }

    // donut
    const items = rows.slice(0, 12).map((r, i) => ({ label: r.d.sym || r.d.name, value: r.valNOK, color: M.PAL[i % M.PAL.length] }));
    document.getElementById('donut').innerHTML = C.donut(items, { size: 200, stroke: 24, center: { top: 'EFF. N', mid: (1 / hhi).toFixed(1) } });
    document.getElementById('donutLegend').innerHTML = rows.slice(0, 8).map((r, i) => `
      <div class="li" style="justify-content:space-between"><span style="display:flex;align-items:center;gap:7px"><span class="sw2" style="background:${M.PAL[i % M.PAL.length]}"></span>${esc(r.d.sym || (r.d.name || '').slice(0, 16))}</span><span class="mono dim">${(r.valNOK / tot * 100).toFixed(1)}%</span></div>`).join('');

    renderVs(rows, tot);

    // wire
    document.getElementById('modelSel').addEventListener('change', e => { modelSel = e.target.value; renderVs(rows, tot); });
    document.querySelectorAll('.qty').forEach(inp => inp.addEventListener('change', () => {
      const h = holdings.find(x => x.id === +inp.dataset.id);
      if (h) { h.qty = Math.max(0, parseFloat(inp.value) || 0); save(holdings); render(); }
    }));
    document.querySelectorAll('.rm').forEach(b => b.addEventListener('click', () => {
      holdings = holdings.filter(x => x.id !== +b.dataset.id); save(holdings); render();
    }));
    document.getElementById('clearBtn').addEventListener('click', () => {
      if (confirm('Remove all holdings?')) { holdings = []; save(holdings); render(); }
    });
    mountAdd(); mountCSV();
  }

  /* ---------- vs model ---------- */
  function renderVs(rows, tot) {
    const m = M.modelById(modelSel);
    const state = {}; (m.controls || []).forEach(c => state[c.k] = c.def);
    const book = m.compute(state);
    const target = Object.fromEntries(book.weights.map(x => [x.t, x.w]));
    // map holdings -> universe tickers via yt
    const mine = {};
    let mapped = 0;
    rows.forEach(r => {
      const u = r.d.yt && M.byT(r.d.yt);
      if (u) { mine[u.t] = (mine[u.t] || 0) + r.valNOK / tot; mapped += r.valNOK; }
    });
    const ts = [...new Set([...Object.keys(target), ...Object.keys(mine)])];
    const diffs = ts.map(t => {
      const a = M.byT(t);
      const w0 = mine[t] || 0, w1 = target[t] || 0;
      return { t, a, w0, w1, d: w1 - w0, kr: (w1 - w0) * tot };
    }).sort((x, y) => Math.abs(y.kr) - Math.abs(x.kr));
    const unmapped = 1 - mapped / tot;
    document.getElementById('vsNote').textContent =
      unmapped > 0.005 ? Math.round(unmapped * 100) + '% OF VALUE OUTSIDE ' + M.UKEY.toUpperCase() + ' UNIVERSE' : 'FULL COVERAGE';
    document.getElementById('vsTable').innerHTML = `<table class="tbl">
      <thead><tr><th class="tleft">Asset</th><th>You</th><th>${esc(m.code)}</th><th>Δ</th><th>Trade to match</th></tr></thead>
      <tbody>${diffs.slice(0, 25).map(r => `
        <tr class="clickable" data-t="${esc(r.t)}">
          <td class="tleft"><div class="sym-cell"><span class="sym-chip" style="background:${r.a.color}"></span><span class="mono">${esc(r.t)}</span> <span class="asset-name">${esc(r.a.name)}</span></div></td>
          <td class="dim">${(r.w0 * 100).toFixed(1)}%</td>
          <td class="dim">${(r.w1 * 100).toFixed(1)}%</td>
          <td class="${r.d >= 0 ? 'up' : 'down'}">${r.d >= 0 ? '+' : '−'}${Math.abs(r.d * 100).toFixed(1)} pp</td>
          <td class="${r.kr >= 0 ? 'up' : 'down'}">${r.kr >= 0 ? 'BUY ' : 'SELL '}${fmtNOK(Math.abs(r.kr))}</td>
        </tr>`).join('')}
      </tbody></table>
      <div class="map-note mono" style="padding:10px 14px">Top 25 by |trade|. Holdings outside the ${esc(M.UKEY.toUpperCase())} universe are not compared — switch universe (OSL/GLB) if they belong to the other book. Not investment advice.</div>`;
    document.querySelectorAll('#vsTable tr.clickable').forEach(tr =>
      tr.addEventListener('click', () => location.href = `asset.html?t=${encodeURIComponent(tr.dataset.t)}`));
  }

  /* ---------- add-by-search ---------- */
  function mountAdd() {
    const box = document.getElementById('addBox');
    if (!box) return;
    box.innerHTML = `
      <div class="row"><input id="pSearch" type="text" placeholder="⌕ TICKER / NAVN" autocomplete="off"
        style="flex:1;height:30px;padding:0 10px;background:var(--bg);border:1px solid var(--line-2);border-radius:2px;color:var(--fg);font-family:var(--mono);font-size:11px">
        <input id="pQty" type="number" placeholder="ANTALL" min="0" step="any"
        style="width:90px;height:30px;padding:0 8px;background:var(--bg);border:1px solid var(--line-2);border-radius:2px;color:var(--fg);font-family:var(--mono);font-size:11px;text-align:right"></div>
      <div id="pResults" class="mt8"></div>`;
    const inp = document.getElementById('pSearch'), res = document.getElementById('pResults');
    let timer;
    inp.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const CAT = await MER.loadCatalog('index');
        const s = inp.value.trim().toLowerCase();
        if (!s) { res.innerHTML = ''; return; }
        const hits = CAT.filter(c => (c.sym || '').toLowerCase().startsWith(s) || (c.name || '').toLowerCase().includes(s))
          .sort((a, b) => (b.owners || 0) - (a.owners || 0)).slice(0, 6);
        res.innerHTML = hits.map(c => `
          <div class="view-row" style="cursor:pointer" data-add="${c.id}">
            <span class="mono" style="width:70px">${esc(c.sym || 'FOND')}</span>
            <span class="dim" style="font-size:11px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.name)}</span>
            <span class="badge g" style="font-size:9px">+ ADD</span>
          </div>`).join('') || '<div class="dim mono" style="font-size:11px">NO MATCH</div>';
        res.querySelectorAll('[data-add]').forEach(el => el.addEventListener('click', () => {
          const qty = parseFloat(document.getElementById('pQty').value) || 1;
          const id = +el.dataset.add;
          const ex = holdings.find(h => h.id === id);
          if (ex) ex.qty += qty; else holdings.push({ id, qty });
          save(holdings); render();
        }));
      }, 200);
    });
  }

  function mountCSV() {
    const btn = document.getElementById('csvBtn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      const msg = document.getElementById('csvMsg');
      msg.textContent = 'IMPORTING…';
      const r = await importCSV(document.getElementById('csvBox').value);
      msg.textContent = `${r.added} ADDED${r.missed.length ? ' · ' + r.missed.length + ' UNMATCHED' : ''}`;
      if (r.added) setTimeout(render, 600);
    });
  }

  function init() {
    document.body.insertAdjacentHTML('afterbegin', MER.header('portfolio', 'index') + MER.ticker());
    document.body.insertAdjacentHTML('beforeend', MER.footer('MY BOOK · LOCAL ONLY — NOTHING UPLOADED'));
    MER.startClock(); MER.initSearch('index');
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
