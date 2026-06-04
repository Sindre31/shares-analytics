/* ============================================================
   app.js — terminal chrome + model-page renderer + interactivity
   Depends on: charts.js, models.js
   ============================================================ */
(function () {
  const M = window.MERIDIAN, C = window.Charts;
  const { esc } = C;

  /* ---------- path helpers ---------- */
  const fileFor = m => `${m.no}-${m.id}.html`;
  function paths(ctx) {
    const pre = ctx === 'index' ? '' : '../';
    return {
      index: pre + 'index.html',
      model: m => ctx === 'index' ? `models/${fileFor(m)}` : fileFor(m),
      asset: t => `${pre}asset.html?t=${encodeURIComponent(t)}`,   // by yahoo ticker (model universe)
      assetId: id => `${pre}asset.html?id=${encodeURIComponent(id)}`, // by Nordnet id (full catalog)
      data: pre + 'data/i/',
    };
  }

  /* ---------- real last close & 1-day move (from data snapshot) ---------- */
  function dayChange(a) { return a.chg; }
  function lastPx(a) { return a.px; }

  /* ---------- HEADER ---------- */
  function header(activeId, ctx) {
    const P = paths(ctx);
    const nav = M.MODELS.map(m => {
      const on = m.id === activeId ? ' active' : '';
      return `<a href="${P.model(m)}" class="${on.trim()}" title="${esc(m.name)}"><span class="tcode">${m.no}</span> ${m.code}</a>`;
    }).join('');
    return `
    <header class="term-header">
      <a class="th-brand" href="${P.index}">
        <span class="dot"></span>
        <span>MERIDIAN<span style="color:var(--fg-mute);font-weight:400"> · </span><span class="sub">PMX</span></span>
      </a>
      <nav class="th-nav">
        <a href="${P.index}" class="${activeId === 'home' ? 'active' : ''}">◴ OVERVIEW</a>
        ${nav}
      </nav>
      <div class="th-search">
        <input id="globalSearch" type="text" placeholder="⌕ SEARCH SHARE" autocomplete="off" spellcheck="false">
        <div class="th-search-dd" id="searchDD"></div>
      </div>
      <div class="th-right">
        <div class="th-stat"><span class="k">${M.BENCH.code} INDEX</span><span class="v" id="hs-bench">${M.BENCH.px.toLocaleString('en-US',{minimumFractionDigits:2})} <span class="${M.BENCH.chg>=0?'up':'down'}">${M.BENCH.chg>=0?'▲':'▼'}</span></span></div>
        <div class="th-stat"><span class="k">Risk-free</span><span class="v">${M.RF.toFixed(2)}%</span></div>
        <div class="th-stat th-clock"><span class="k">Session</span><span class="v" id="hs-clock">––:––:––</span></div>
      </div>
    </header>`;
  }

  /* ---------- TICKER ---------- */
  function ticker() {
    const cells = M.U.filter(a => a.t !== M.CASH).map(a => {
      const ch = dayChange(a), px = lastPx(a);
      const cls = ch >= 0 ? 'up' : 'down', arr = ch >= 0 ? '▲' : '▼';
      return `<span class="tk"><span class="sym">${a.t}</span><span class="px">${px.toFixed(2)}</span><span class="chg ${cls}">${arr} ${Math.abs(ch).toFixed(2)}%</span></span>`;
    }).join('');
    return `<div class="ticker"><div class="label">LIVE&nbsp;·&nbsp;UNIVERSE</div><div class="ticker-track">${cells}${cells}</div></div>`;
  }

  /* ---------- FOOTER ---------- */
  function footer(extra) {
    const counts = (window.MERIDIAN_DATA || {}).counts || {};
    return `
    <footer class="term-foot">
      <div class="fseg"><span class="live">●</span> LIVE FEED <span class="blink">_</span></div>
      <div class="fseg">MODEL UNIVERSE: ${M.U.length}</div>
      <div class="fseg">CATALOG: ${counts.shares || '—'} AKSJER · ${counts.funds || '—'} FOND</div>
      <div class="fseg">MODELS: ${M.MODELS.length}</div>
      <div class="fseg">${extra || 'DATA: REAL · AS OF ' + M.ASOF}</div>
      <div class="fseg" style="margin-left:auto">MERIDIAN PMX v2.4 · © 2026</div>
    </footer>`;
  }

  /* ---------- lazy catalog (13k instruments — fetched on first search) ---------- */
  let catPromise = null;
  function loadCatalog(ctx) {
    if (window.MERIDIAN_CAT) return Promise.resolve(window.MERIDIAN_CAT);
    if (!catPromise) {
      const pre = ctx === 'index' ? '' : '../';
      catPromise = fetch(pre + 'assets/catalog.json')
        .then(r => r.json())
        .then(c => (window.MERIDIAN_CAT = c))
        .catch(() => (catPromise = null, []));
    }
    return catPromise;
  }

  /* ---------- global search over the full Nordnet catalog ---------- */
  function initSearch(ctx) {
    const P = paths(ctx);
    const inp = document.getElementById('globalSearch'), dd = document.getElementById('searchDD');
    if (!inp || !dd) return;
    let items = [];
    function score(c, s) {
      const sym = (c.sym || '').toLowerCase(), nm = (c.name || '').toLowerCase();
      if (sym === s) return 0;
      if (sym.startsWith(s)) return 1;
      if (nm.startsWith(s)) return 2;
      if (sym.includes(s)) return 3;
      if (nm.includes(s)) return 4;
      return 99;
    }
    function close() { dd.classList.remove('open'); dd.innerHTML = ''; items = []; }
    function open(q) {
      const s = q.trim().toLowerCase();
      if (!s) return close();
      const CAT = window.MERIDIAN_CAT;
      if (!CAT) {
        dd.innerHTML = `<div class="sr mute">LOADING CATALOG <span class="blink">_</span></div>`;
        dd.classList.add('open');
        loadCatalog(ctx).then(() => { if (inp.value.trim()) open(inp.value); });
        return;
      }
      items = CAT.map(c => ({ c, sc: score(c, s) })).filter(x => x.sc < 99)
        .sort((a, b) => a.sc - b.sc || (b.c.owners || 0) - (a.c.owners || 0))
        .slice(0, 9).map(x => x.c);
      if (!items.length) { dd.innerHTML = `<div class="sr mute">NO MATCH · ${CAT.length.toLocaleString('en-US')} INSTRUMENTS</div>`; dd.classList.add('open'); return; }
      dd.innerHTML = items.map(c => {
        const u = c.yt && M.byT(c.yt);
        const chg = c.chg == null ? null : c.chg;
        return `<a class="sr" href="${P.assetId(c.id)}">
          <span class="sym-chip" style="background:${u ? u.color : (c.type === 'FND' ? 'var(--info)' : 'var(--fg-mute)')}"></span>
          <span class="mono" style="min-width:46px">${esc(c.sym || (c.type === 'FND' ? 'FOND' : ''))}</span>
          <span class="srn">${esc(c.name)}</span>
          <span class="cat-tag" style="margin-left:auto;white-space:nowrap">${esc(c.cat || '')}</span>
          <span class="mono ${chg >= 0 ? 'up' : 'down'}" style="width:62px;text-align:right">${chg == null ? '—' : (chg >= 0 ? '▲ ' : '▼ ') + Math.abs(chg).toFixed(2) + '%'}</span>
        </a>`;
      }).join('');
      dd.classList.add('open');
    }
    inp.addEventListener('input', () => open(inp.value));
    inp.addEventListener('focus', () => { loadCatalog(ctx); open(inp.value); });
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter' && items.length) location.href = P.assetId(items[0].id);
      if (e.key === 'Escape') { inp.blur(); close(); }
    });
    document.addEventListener('click', e => { if (!e.target.closest('.th-search')) close(); });
  }

  /* ---------- clock (bench price is a real snapshot — no fake walk) ---------- */
  function startClock() {
    const el = () => document.getElementById('hs-clock');
    function tick() {
      const e = el(); if (e) {
        const d = new Date();
        e.textContent = d.toTimeString().slice(0, 8);
      }
    }
    tick(); setInterval(tick, 1000);
  }

  /* ---------- INFO DRAWER ---------- */
  function ensureDrawer() {
    if (document.getElementById('info-drawer')) return;
    const ov = document.createElement('div'); ov.className = 'info-overlay'; ov.id = 'info-overlay';
    const dr = document.createElement('div'); dr.className = 'info-drawer'; dr.id = 'info-drawer';
    document.body.appendChild(ov); document.body.appendChild(dr);
    ov.addEventListener('click', closeInfo);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeInfo(); });
  }
  function openInfo(m) {
    ensureDrawer();
    const i = m.info;
    const dr = document.getElementById('info-drawer');
    dr.innerHTML = `
      <div class="ih">
        <div>
          <div class="code">MODEL ${m.no} · ${m.code}</div>
          <h3>${esc(m.name)}</h3>
          <div class="row mt8"><span class="badge b">${esc(m.cat)}</span><span class="cat-tag">${esc(i.class)}</span></div>
        </div>
        <button class="ibtn x" onclick="MER.closeInfo()" style="font-style:normal">✕</button>
      </div>
      <div class="ib">
        <div class="info-block"><div class="lbl">Summary</div><p>${esc(i.summary)}</p></div>
        <div class="info-block"><div class="lbl">How the book is built</div><ul>${i.how.map(h => `<li>${esc(h)}</li>`).join('')}</ul></div>
        <div class="info-block"><div class="lbl">Objective / formula</div><div class="formula">${esc(i.formula)}</div></div>
        <div class="info-block"><div class="lbl">Strengths</div><ul>${i.pros.map(p => `<li>${esc(p)}</li>`).join('')}</ul></div>
        <div class="info-block"><div class="lbl">Limitations</div><ul>${i.cons.map(p => `<li>${esc(p)}</li>`).join('')}</ul></div>
        <div class="info-block"><div class="lbl">Provenance</div>
          <div class="kv"><span class="kk">Origin</span><span class="vv">${esc(i.origin)}</span><span class="kk">Class</span><span class="vv">${esc(i.class)}</span><span class="kk">Mode</span><span class="vv">${m.interactive ? 'Interactive' : 'Static book'}</span></div>
        </div>
      </div>`;
    document.getElementById('info-overlay').classList.add('open');
    dr.classList.add('open');
  }
  function closeInfo() {
    const ov = document.getElementById('info-overlay'), dr = document.getElementById('info-drawer');
    if (ov) ov.classList.remove('open'); if (dr) dr.classList.remove('open');
  }

  /* ---------- shared metric helpers ---------- */
  function fmtPct(v, d = 1) { return (v >= 0 ? '' : '−') + Math.abs(v).toFixed(d) + '%'; }

  /* ---------- MODEL PAGE ---------- */
  function renderModel(id) {
    const m = M.modelById(id);
    document.title = `${m.code} · ${m.name} — MERIDIAN PMX`;
    // chrome
    document.body.insertAdjacentHTML('afterbegin', header(id, 'model') + ticker());
    document.body.insertAdjacentHTML('beforeend', footer(`MODEL ${m.no} / ${m.code} · ${m.info.class.toUpperCase()}`));
    startClock(); initSearch('model');

    const root = document.getElementById('app');
    root.innerHTML = `
      <div class="wrap page">
        <div class="model-hero fade-in">
          <div class="mh-left">
            <div class="mh-no mono">${m.no}<span>/ ${M.MODELS.length}</span></div>
            <div>
              <div class="row" style="gap:10px">
                <h1 class="mh-title">${esc(m.code)} <span class="dim">·</span> ${esc(m.name)}</h1>
                <button class="ibtn" id="infoBtn" title="About this model">i</button>
              </div>
              <p class="mh-tag">${esc(m.tagline)}</p>
            </div>
          </div>
          <div class="mh-right">
            <span class="badge ${m.interactive ? 'g' : 'b'}">${m.interactive ? '● INTERACTIVE' : '○ STATIC BOOK'}</span>
            <span class="badge">${esc(m.cat).toUpperCase()}</span>
            <span class="cat-tag">${esc(m.info.origin)}</span>
          </div>
        </div>

        <div class="kpis fade-in" id="kpis"></div>

        <div class="model-grid mt16">
          <div class="main">
            <div class="panel">
              <div class="panel-head">PERFORMANCE · GROWTH OF 100
                <div class="right">
                  <div class="seg" id="segWin">
                    <button data-w="36" class="on">3Y</button><button data-w="60">5Y</button><button data-w="120">10Y</button>
                  </div>
                </div>
              </div>
              <div class="panel-body"><div id="perfChart"></div>
                <div class="legend mt12" id="perfLegend"></div>
              </div>
            </div>

            <div class="panel mt16">
              <div class="panel-head">PORTFOLIO BOOK · TARGET WEIGHTS
                <div class="right"><span id="bookCount" class="mono"></span></div>
              </div>
              <div class="panel-body tight"><div id="bookTable"></div></div>
            </div>

            <div class="panel mt16">
              <div class="panel-head">RISK CONTRIBUTION · BY HOLDING</div>
              <div class="panel-body"><div id="riskBars"></div></div>
            </div>
          </div>

          <div class="side">
            ${m.interactive ? `<div class="panel">
              <div class="panel-head">MODEL CONTROLS
                <div class="right"><button class="btn ghost" id="resetBtn" style="padding:3px 9px;font-size:10px">RESET</button></div>
              </div>
              <div class="panel-body tight" id="controls"></div>
            </div>` : `<div class="panel">
              <div class="panel-head">CONSTRUCTION</div>
              <div class="panel-body"><p class="dim" style="margin:0;font-size:12.5px;line-height:1.6">${esc(m.tagline)} This book is rebalanced on a fixed rule with no tunable parameters.</p></div>
            </div>`}

            <div class="panel mt16">
              <div class="panel-head">ALLOCATION</div>
              <div class="panel-body" style="display:flex;flex-direction:column;align-items:center">
                <div id="donut"></div>
                <div class="legend mt16" id="donutLegend" style="align-self:stretch"></div>
              </div>
            </div>

            <div class="panel mt16">
              <div class="panel-head">MODEL PARAMETERS</div>
              <div class="panel-body" id="extras"></div>
            </div>

            <div id="sidExtra"></div>
          </div>
        </div>

        <div class="model-foot-nav mt24" id="footNav"></div>
      </div>`;

    document.getElementById('infoBtn').addEventListener('click', () => openInfo(m));

    // state
    const state = {};
    (m.controls || []).forEach(c => state[c.k] = c.def);
    let win = 36;

    // controls
    if (m.interactive) {
      const cwrap = document.getElementById('controls');
      cwrap.innerHTML = m.controls.map(c => `
        <div class="ctrl-row">
          <label>${esc(c.label)}</label>
          <input type="range" min="${c.min}" max="${c.max}" step="${c.step}" value="${c.def}" data-k="${c.k}">
          <span class="val" id="cv-${c.k}">${c.fmt(c.def)}</span>
        </div>`).join('');
      cwrap.querySelectorAll('input[type=range]').forEach(inp => {
        inp.addEventListener('input', () => {
          const c = m.controls.find(x => x.k === inp.dataset.k);
          state[inp.dataset.k] = parseFloat(inp.value);
          document.getElementById('cv-' + inp.dataset.k).textContent = c.fmt(parseFloat(inp.value));
          recompute();
        });
      });
      document.getElementById('resetBtn').addEventListener('click', () => {
        m.controls.forEach(c => { state[c.k] = c.def; const inp = cwrap.querySelector(`input[data-k="${c.k}"]`); inp.value = c.def; document.getElementById('cv-' + c.k).textContent = c.fmt(c.def); });
        recompute();
      });
    }

    // window selector
    document.querySelectorAll('#segWin button').forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll('#segWin button').forEach(x => x.classList.remove('on'));
      b.classList.add('on'); win = +b.dataset.w; renderPerf();
    }));

    let cur = null;
    function recompute() { cur = m.compute(state); renderKpis(); renderBook(); renderDonut(); renderRisk(); renderExtras(); renderSideExtra(); renderPerf(); }

    function renderKpis() {
      const mt = M.metrics(cur.weights);
      const path = M.pathFor(cur.weights, win); // real backtest
      const mdd = C.maxDrawdown(path);
      const tiles = [
        { k: 'Exp. Return', v: mt.er.toFixed(1) + '%', s: 'ann. · gross', cls: 'up' },
        { k: 'Volatility', v: mt.vol.toFixed(1) + '%', s: 'ann. σ', cls: '' },
        { k: 'Sharpe', v: mt.sharpe.toFixed(2), s: 'vs ' + M.RF.toFixed(1) + '% rf', cls: mt.sharpe >= 0.6 ? 'up' : '' },
        { k: 'Max Drawdown', v: fmtPct(mdd, 1), s: win / 12 + 'Y window', cls: 'down' },
      ];
      document.getElementById('kpis').innerHTML = tiles.map(t => `
        <div class="kpi"><div class="k">${t.k}</div><div class="v ${t.cls}">${t.v}</div><div class="sub">${t.s}</div></div>`).join('');
    }

    function renderBook() {
      const rows = cur.weights.map(x => {
        const a = M.byT(x.t);
        const wpct = (x.w * 100);
        return `<tr class="clickable" data-t="${esc(a.t)}"><td><div class="sym-cell"><span class="sym-chip" style="background:${a.color}"></span><span><span class="mono">${a.t}</span> <span class="asset-name">${esc(a.name)}</span></span></div></td>
          <td class="dim">${esc(a.sector)}</td>
          <td><div class="wbar"><i style="width:${Math.min(100, wpct * 2.2)}%"></i><span>${wpct.toFixed(1)}%</span></div></td>
          <td class="${a.er >= M.RF ? 'up' : 'dim'}">${a.er.toFixed(1)}%</td>
          <td class="dim">${a.vol.toFixed(0)}%</td>
          <td class="dim">${a.beta.toFixed(2)}</td>
          <td class="dim">${a.div.toFixed(1)}%</td></tr>`;
      }).join('');
      document.getElementById('bookTable').innerHTML = `<table class="tbl">
        <thead><tr><th>Asset</th><th>Sector</th><th>Weight</th><th>Exp.Ret</th><th>Vol</th><th>β</th><th>Yield</th></tr></thead>
        <tbody>${rows}</tbody></table>`;
      document.getElementById('bookCount').textContent = cur.weights.length + ' POSITIONS';
      const P = paths('model');
      document.querySelectorAll('#bookTable tr.clickable').forEach(tr =>
        tr.addEventListener('click', () => location.href = P.asset(tr.dataset.t)));
    }

    function renderDonut() {
      const items = cur.weights.slice(0, 12).map(x => ({ label: M.byT(x.t).name, value: x.w, color: M.byT(x.t).color }));
      const mt = M.metrics(cur.weights);
      document.getElementById('donut').innerHTML = C.donut(items, { size: 210, stroke: 26, center: { top: 'EFF. N', mid: mt.effN.toFixed(1) } });
      document.getElementById('donutLegend').innerHTML = cur.weights.slice(0, 8).map(x => {
        const a = M.byT(x.t);
        return `<div class="li" style="justify-content:space-between"><span style="display:flex;align-items:center;gap:7px"><span class="sw2" style="background:${a.color}"></span>${a.t}</span><span class="mono dim">${(x.w * 100).toFixed(1)}%</span></div>`;
      }).join('');
    }

    function renderRisk() {
      // marginal risk contribution per holding
      const ws = cur.weights;
      const total = M.metrics(ws).vol / 100;
      const items = ws.map(x => {
        const ai = M.byT(x.t);
        let mc = 0;
        ws.forEach(y => { const aj = M.byT(y.t); const corr = M.rhoOf(ai.t, aj.t); mc += y.w * (ai.vol / 100) * (aj.vol / 100) * corr; });
        const rc = total > 0 ? (x.w * mc / total) : 0;
        return { t: x.t, color: ai.color, rc };
      }).sort((a, b) => b.rc - a.rc).slice(0, 8);
      const sum = items.reduce((s, i) => s + i.rc, 0) || 1;
      const bars = items.map(i => ({ label: i.t, value: (i.rc / sum) * 100, color: i.color, disp: (i.rc / sum * 100).toFixed(1) + '%' }));
      document.getElementById('riskBars').innerHTML = C.hbars(bars, { w: 380, labW: 60, rowH: 22 });
    }

    function renderExtras() {
      const ex = cur.extras || [];
      document.getElementById('extras').innerHTML = `<div class="kv">${ex.map(e => `<span class="kk">${esc(e.k)}</span><span class="vv">${esc(String(e.v))}</span>`).join('')}</div>`;
    }

    function renderSideExtra() {
      const el = document.getElementById('sidExtra');
      if (cur.views) {
        el.innerHTML = `<div class="panel mt16"><div class="panel-head">ACTIVE VIEWS · ${cur.views.length}</div><div class="panel-body tight">
          ${cur.views.map(v => `<div class="view-row"><span class="badge ${v.dir === 'OVER' ? 'g' : 'r'}">${v.dir === 'OVER' ? '▲ OVER' : '▼ UNDER'}</span><span class="mono" style="width:46px">${v.t}</span><span class="dim" style="font-size:11.5px;flex:1">${esc(v.txt)}</span></div>`).join('')}
        </div></div>`;
      } else if (cur.clusters) {
        el.innerHTML = `<div class="panel mt16"><div class="panel-head">CLUSTER TREE · INVERSE-VARIANCE</div><div class="panel-body tight">
          ${cur.clusters.map(o => {
            const cw = o.ws.reduce((s, x) => s + x.w, 0);
            return `<div class="clus"><div class="clus-h"><span class="mono">${esc(o.c.name)}</span><span class="mono dim">σ ${o.v.toFixed(1)}%</span></div>
              ${o.ws.map(x => `<div class="clus-m"><span class="sw2" style="background:${M.byT(x.t).color}"></span><span class="mono">${x.t}</span><span class="clus-w mono dim">${(x.w * 100).toFixed(0)}%</span></div>`).join('')}
            </div>`;
          }).join('')}
        </div></div>`;
      } else { el.innerHTML = ''; }
    }

    function renderPerf() {
      const pPort = M.pathFor(cur.weights, win);   // real backtest, monthly rebalanced
      const pBench = M.benchPath(win);             // real benchmark (SPY)
      const yrs = win / 12;
      const xlabels = [];
      for (let q = 0; q <= yrs; q++) xlabels.push({ i: Math.round((q / yrs) * win), t: q === yrs ? 'NOW' : `Y−${yrs - q}` });
      document.getElementById('perfChart').innerHTML = C.line([
        { name: m.code, color: C.css('--up'), data: pPort, fill: true, width: 1.8 },
        { name: M.BENCH.code, color: C.css('--fg-mute'), data: pBench, dash: '4 3', width: 1.3 },
      ], { h: 240, xlabels });
      const endP = pPort[pPort.length - 1], endB = pBench[pBench.length - 1];
      document.getElementById('perfLegend').innerHTML = `
        <div class="li"><span class="sw2" style="background:${C.css('--up')}"></span>${m.code} BOOK <span class="mono ${endP >= 100 ? 'up' : 'down'}" style="margin-left:6px">${((endP / 100 - 1) * 100).toFixed(1)}%</span></div>
        <div class="li"><span class="sw2" style="background:${C.css('--fg-mute')}"></span>${M.BENCH.code} BENCHMARK <span class="mono dim" style="margin-left:6px">${((endB / 100 - 1) * 100).toFixed(1)}%</span></div>
        <div class="li" style="margin-left:auto"><span class="dim">ALPHA</span> <span class="mono ${endP >= endB ? 'up' : 'down'}">${((endP - endB) / 100 * 100).toFixed(1)} pts</span></div>`;
    }

    // foot nav (prev / next model)
    const idx = M.MODELS.findIndex(x => x.id === id);
    const prev = M.MODELS[(idx - 1 + M.MODELS.length) % M.MODELS.length];
    const next = M.MODELS[(idx + 1) % M.MODELS.length];
    document.getElementById('footNav').innerHTML = `
      <a class="fnav" href="${fileFor(prev)}"><span class="dim mono">◀ ${prev.no}</span><span>${esc(prev.name)}</span></a>
      <a class="fnav home" href="../index.html"><span class="mono dim">◴</span><span>ALL MODELS</span></a>
      <a class="fnav r" href="${fileFor(next)}"><span class="dim mono">${next.no} ▶</span><span>${esc(next.name)}</span></a>`;

    recompute();
  }

  window.MER = { header, ticker, footer, startClock, initSearch, loadCatalog, openInfo, closeInfo, renderModel, paths, fileFor, dayChange, lastPx };
})();
