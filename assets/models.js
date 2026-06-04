/* ============================================================
   models.js — universe, 10 portfolio models, weight logic, info
   Real market data — snapshot lives in assets/data.js.
   ============================================================ */
(function (g) {
  const D = g.MERIDIAN_DATA;
  const RF = D.rf; // risk-free % (13-week T-bill yield)
  const BENCH = { code: D.bench.code, ticker: D.bench.ticker, name: D.bench.name,
                  er: D.bench.er, vol: D.bench.vol, px: D.bench.px, chg: D.bench.chg };

  // categorical palette (oklch, dark-friendly)
  const PAL = [
    'oklch(0.70 0.15 152)', 'oklch(0.72 0.12 200)', 'oklch(0.70 0.13 235)',
    'oklch(0.68 0.13 285)', 'oklch(0.70 0.14 330)', 'oklch(0.68 0.16 25)',
    'oklch(0.74 0.14 60)', 'oklch(0.78 0.14 95)', 'oklch(0.74 0.15 130)',
    'oklch(0.70 0.10 180)', 'oklch(0.66 0.12 255)', 'oklch(0.72 0.13 310)',
    'oklch(0.70 0.14 8)', 'oklch(0.76 0.12 45)', 'oklch(0.72 0.10 160)',
    'oklch(0.58 0.05 250)', 'oklch(0.50 0.02 250)'
  ];

  // universe: real assets from the data snapshot (er/vol/beta/mom/pe/pb/div/mcap/qual)
  const U = D.universe.map((a,i)=>({ ...a, color:PAL[i % PAL.length] }));
  const CASH = D.cash, BOND = D.bond;

  const MAP = Object.fromEntries(U.map(a=>[a.t,a]));
  const byT = t => MAP[t];

  // pairwise correlations — computed from the last 36 real monthly returns
  const RHO = (function(){
    const ts = U.map(a=>a.t), n=36;
    const series = Object.fromEntries(ts.map(t=>[t, D.rets[t].slice(-n)]));
    const mean = Object.fromEntries(ts.map(t=>[t, series[t].reduce((s,v)=>s+v,0)/n]));
    const sd = Object.fromEntries(ts.map(t=>{
      const m=mean[t]; return [t, Math.sqrt(series[t].reduce((s,v)=>s+(v-m)*(v-m),0)/n)||1e-9];
    }));
    const R = {};
    ts.forEach(a=>{ R[a]={}; ts.forEach(b=>{
      let c=0; for(let k=0;k<n;k++) c+=(series[a][k]-mean[a])*(series[b][k]-mean[b]);
      R[a][b] = (c/n)/(sd[a]*sd[b]);
    });});
    return R;
  })();
  function rho(a,b){ return RHO[a.t][b.t]; }
  const rhoOf = (ta,tb) => RHO[ta][tb];

  /* real growth-of-100 backtest paths (monthly rebalanced) */
  function pathFor(weights, months){
    const out=[100]; let idx=100;
    const T = D.rets[U[0].t].length, start = Math.max(0, T-months);
    for (let k=start;k<T;k++){
      let pr=0; weights.forEach(x=>{ pr += x.w * (D.rets[x.t] ? D.rets[x.t][k] : 0); });
      idx *= (1+pr); out.push(idx);
    }
    return out;
  }
  function benchPath(months){
    const out=[100]; let idx=100;
    const r = D.rets[D.bench.ticker], start = Math.max(0, r.length-months);
    for (let k=start;k<r.length;k++){ idx *= (1+r[k]); out.push(idx); }
    return out;
  }
  // portfolio metrics from weights [{t,w}]
  function metrics(weights){
    let er=0, beta=0, divy=0, varsum=0;
    weights.forEach(x=>{ const a=byT(x.t); er+=x.w*a.er; beta+=x.w*a.beta; divy+=x.w*a.div; });
    for (let i=0;i<weights.length;i++) for (let j=0;j<weights.length;j++){
      const ai=byT(weights[i].t), aj=byT(weights[j].t);
      varsum += weights[i].w*weights[j].w*(ai.vol/100)*(aj.vol/100)*rho(ai,aj);
    }
    const vol = Math.sqrt(Math.max(0,varsum))*100;
    const sharpe = vol>0 ? (er-RF)/vol : 0;
    // diversification: effective number of holdings (inverse HHI)
    const hhi = weights.reduce((s,x)=>s+x.w*x.w,0);
    return { er, vol, beta, divy, sharpe, effN: hhi>0?1/hhi:0 };
  }

  // utils
  const z = (arr) => { const m=arr.reduce((s,v)=>s+v,0)/arr.length; const sd=Math.sqrt(arr.reduce((s,v)=>s+(v-m)*(v-m),0)/arr.length)||1; return arr.map(v=>(v-m)/sd); };
  function norm(list){ // [{t,raw}] -> [{t,w}] desc
    const pos = list.filter(x=>x.raw>1e-9); const s=pos.reduce((a,x)=>a+x.raw,0)||1;
    return pos.map(x=>({t:x.t,w:x.raw/s})).sort((a,b)=>b.w-a.w);
  }
  const RISKY = U.filter(a=>a.t!==CASH);
  const EQUITY = U.filter(a=>![CASH,BOND].includes(a.t));
  function capw(list){ return norm(list.map(a=>({t:a.t,raw:a.mcap}))); }

  /* ---------- model compute functions ---------- */
  // Each returns { weights:[{t,w}], extras:[{k,v}], cash?:number }

  function eqw(){ // equal weight 1/N (ex-cash)
    const n = RISKY.length;
    return { weights: RISKY.map(a=>({t:a.t,w:1/n})).sort((a,b)=>b.w-a.w),
             extras:[{k:'Holdings',v:n},{k:'Rebalance',v:'Quarterly'}] };
  }

  function mom(s){ // momentum top-K, weight by momentum^g
    const K = s.k ?? 6, gpow = 1.3;
    const ranked = EQUITY.filter(a=>a.mom>0).sort((a,b)=>b.mom-a.mom).slice(0,K);
    const w = norm(ranked.map(a=>({t:a.t,raw:Math.pow(a.mom,gpow)})));
    return { weights:w, extras:[{k:'Lookback',v:'12-1 month'},{k:'Top decile',v:K+' / '+EQUITY.length},{k:'Reform',v:'Monthly'}] };
  }

  function val(s){ // value: cheapest by composite
    const K = s.k ?? 6;
    const cand = EQUITY.filter(a=>a.pe>0);
    const zE = z(cand.map(a=>1/a.pe)), zB = z(cand.map(a=>1/Math.max(0.3,a.pb))), zD = z(cand.map(a=>a.div));
    const scored = cand.map((a,i)=>({a, sc: 0.45*zE[i]+0.35*zB[i]+0.20*zD[i]}));
    const top = scored.sort((x,y)=>y.sc-x.sc).slice(0,K);
    const w = norm(top.map(o=>({t:o.a.t, raw: Math.max(0.05, o.sc - top[top.length-1].sc + 0.3)})));
    return { weights:w, extras:[{k:'Screen',v:'P/E·P/B·Yield'},{k:'Held',v:K+' names'},{k:'Margin of safety',v:'≥ 25%'}] };
  }

  function minv(s){ // minimum variance, inverse-variance with weight cap
    const cap = (s.cap ?? 20)/100;
    let w = norm(RISKY.map(a=>({t:a.t,raw:1/(a.vol*a.vol)})));
    for (let it=0; it<6; it++){ // iterative cap
      let over=0, room=0;
      w.forEach(x=>{ if(x.w>cap){ over+=x.w-cap; x.w=cap; x.capped=true;} });
      const free = w.filter(x=>!x.capped); const fs = free.reduce((a,x)=>a+x.w,0)||1;
      if (over>1e-6) free.forEach(x=>x.w+=over*(x.w/fs));
    }
    w = w.sort((a,b)=>b.w-a.w);
    return { weights:w, extras:[{k:'Objective',v:'min σ²p'},{k:'Max weight',v:(cap*100).toFixed(0)+'%'},{k:'Long-only',v:'Yes'}] };
  }

  function rp(s){ // risk parity (inverse vol) scaled to target vol via cash sleeve
    const target = s.target ?? 8;
    const base = norm(RISKY.map(a=>({t:a.t,raw:1/a.vol})));
    const bvol = metrics(base).vol;
    let k = Math.min(1, target/bvol);
    const w = base.map(x=>({t:x.t,w:x.w*k}));
    const cash = 1-k; if (cash>0.001) w.push({t:CASH,w:cash});
    return { weights:w.sort((a,b)=>b.w-a.w), cash, extras:[{k:'Risk budget',v:'Equal ERC'},{k:'Target σ',v:target.toFixed(1)+'%'},{k:'Invested',v:(k*100).toFixed(0)+'%'}] };
  }

  function mvo(s){ // mean-variance utility maximization
    const lam = s.lambda ?? 2.0;
    const w = norm(RISKY.map(a=>({t:a.t, raw: (a.er-RF) - 0.5*lam*(a.vol*a.vol)/100 })));
    if (!w.length) // no risky asset clears the utility hurdle -> hold cash
      return { weights:[{t:CASH,w:1}], cash:1, extras:[{k:'Objective',v:'max  μ−½λσ²'},{k:'Risk aversion λ',v:lam.toFixed(1)},{k:'Frontier',v:'All cash — hurdle unmet'}] };
    return { weights:w, extras:[{k:'Objective',v:'max  μ−½λσ²'},{k:'Risk aversion λ',v:lam.toFixed(1)},{k:'Frontier',v:'Tangency tilt'}] };
  }

  function capm(s){ // market portfolio + risk-free (two-fund separation)
    const eq = (s.equity ?? 85)/100;
    const mkt = capw(RISKY);
    const w = mkt.map(x=>({t:x.t,w:x.w*eq}));
    const cash = 1-eq; if (cash>0.001) w.push({t:CASH,w:cash});
    const mktPrem = (BENCH.er-RF);
    return { weights:w.sort((a,b)=>b.w-a.w), cash, mktPrem,
             extras:[{k:'Market sleeve',v:(eq*100).toFixed(0)+'%'},{k:'Risk-free',v:(cash*100).toFixed(0)+'%'},{k:'Equity risk prem.',v:mktPrem.toFixed(1)+'%'}] };
  }

  // Black-Litterman views (manager tilts)
  const BL_VIEWS = [
    {t:'KOG.OL',  dir:'OVER', f:1.7, txt:'European defence spending supercycle'},
    {t:'SALM.OL', dir:'OVER', f:1.3, txt:'Tight salmon supply supports prices'},
    {t:'DNB.OL',  dir:'OVER', f:1.2, txt:'Resilient NII, strong capital returns'},
    {t:'EQNR.OL', dir:'UNDER',f:0.6, txt:'Softer oil & gas price deck −2.0%'},
    {t:'TEL.OL',  dir:'UNDER',f:0.75,txt:'Mature telecom growth headwind'},
  ].filter(v=>MAP[v.t]); // only views on names actually in the model universe
  function bl(s){
    const c = (s.conf ?? 40)/100;
    const eqm = capw(RISKY);
    const tiltMap = Object.fromEntries(BL_VIEWS.map(v=>[v.t,v.f]));
    const tilted = norm(eqm.map(x=>({t:x.t, raw: x.w*(tiltMap[x.t]||1)})));
    const tMap = Object.fromEntries(tilted.map(x=>[x.t,x.w]));
    const eMap = Object.fromEntries(eqm.map(x=>[x.t,x.w]));
    const blend = RISKY.map(a=>({t:a.t, raw:(1-c)*(eMap[a.t]||0) + c*(tMap[a.t]||0)}));
    return { weights:norm(blend), views:BL_VIEWS,
             extras:[{k:'Prior',v:'Mkt equilibrium'},{k:'View confidence',v:(c*100).toFixed(0)+'%'},{k:'Active views',v:BL_VIEWS.length}] };
  }

  function ff5(s){ // factor tilts
    const bSize=(s.size ?? 0.30), bVal=(s.value ?? 0.40), bProf=(s.prof ?? 0.30);
    const cand = EQUITY;
    const fSize = z(cand.map(a=>-Math.log(a.mcap)));     // small = high
    const fVal  = z(cand.map(a=>1/Math.max(0.3,a.pb)));  // cheap = high
    const fProf = z(cand.map(a=>a.qual));                // quality = high
    const w = norm(cand.map((a,i)=>({t:a.t, raw: Math.exp(bSize*fSize[i]+bVal*fVal[i]+bProf*fProf[i]) - 0.3 })));
    return { weights:w, extras:[{k:'SMB load',v:bSize.toFixed(2)},{k:'HML load',v:bVal.toFixed(2)},{k:'RMW load',v:bProf.toFixed(2)}] };
  }

  // HRP clusters (static)
  // clusters derived from sector classification (universe is selected dynamically)
  const HRP_CLUSTERS = (function(){
    const DIVERS = ['Global Equity','Fixed Income'];
    const groups = {};
    RISKY.forEach(a=>{
      const k = DIVERS.includes(a.sector) ? 'Global Diversifiers' : a.sector;
      (groups[k] = groups[k] || []).push(a.t);
    });
    const out = [], loose = [];
    Object.entries(groups).forEach(([k, m]) => { m.length >= 2 ? out.push({name:k, members:m}) : loose.push(...m); });
    if (loose.length) out.push({name:'Other', members:loose});
    return out;
  })();
  function hrp(){
    // allocate inverse-cluster-vol across clusters, inverse-vol within (softer than 1/σ²)
    const clVar = HRP_CLUSTERS.map(c=>{
      const ws = norm(c.members.map(t=>({t,raw:1/byT(t).vol})));
      const v = metrics(ws.map(x=>({t:x.t,w:x.w}))).vol;
      return { c, ws, v };
    });
    const across = norm(clVar.map(o=>({t:o.c.name, raw:1/o.v})));
    const aMap = Object.fromEntries(across.map(x=>[x.t,x.w]));
    let w=[];
    clVar.forEach(o=>{ const cw=aMap[o.c.name]; o.ws.forEach(x=>w.push({t:x.t,w:x.w*cw})); });
    return { weights:w.sort((a,b)=>b.w-a.w), clusters:clVar,
             extras:[{k:'Clusters',v:HRP_CLUSTERS.length},{k:'Linkage',v:'Ward'},{k:'Allocation',v:'Recursive bisection'}] };
  }

  /* ---------- model registry ---------- */
  const MODELS = [
    { id:'mvo', code:'MVO', no:'01', name:'Mean-Variance Optimization', cat:'Optimization',
      tagline:'Maximize return per unit of variance along the efficient frontier.',
      interactive:true, seed:1011, compute:mvo,
      controls:[{k:'lambda',label:'Risk aversion λ',min:0.5,max:6,step:0.1,def:2.0,fmt:v=>v.toFixed(1)}],
      info:{ origin:'Harry Markowitz, 1952', class:'Modern Portfolio Theory',
        summary:'The founding model of modern portfolio theory. It selects weights that maximize a quadratic utility — expected return penalized by variance — tracing the efficient frontier of optimal risk/return trade-offs.',
        how:['Estimate expected returns μ and the covariance matrix Σ','Maximize utility U = wᵀμ − ½λ·wᵀΣw','Higher λ pushes the solution toward lower-variance books','Long-only, fully-invested constraint applied'],
        formula:'max  wᵀμ − ½λ wᵀΣw   s.t.  Σw = 1,  w ≥ 0',
        pros:['Theoretically optimal mean-variance trade-off','Single intuitive risk knob (λ)','Foundation for most quant allocators'],
        cons:['Highly sensitive to return estimates','Concentrates in a few names','Ignores estimation error ("error maximization")'] } },

    { id:'capm', code:'CAPM', no:'02', name:'Capital Asset Pricing Model', cat:'Equilibrium',
      tagline:'Hold the market portfolio; dial risk with the risk-free asset.',
      interactive:true, seed:2022, compute:capm,
      controls:[{k:'equity',label:'Market sleeve %',min:0,max:100,step:5,def:85,fmt:v=>v.toFixed(0)+'%'}],
      info:{ origin:'Sharpe · Lintner · Mossin, 1964', class:'Equilibrium / Single-factor',
        summary:'In equilibrium every investor holds the cap-weighted market portfolio and adjusts risk by blending it with the risk-free asset (two-fund separation). Expected return is linear in market beta.',
        how:['Form the cap-weighted market portfolio','Blend with risk-free T-bills to set total risk','Each asset priced by its beta to the market','No security selection — pure market exposure'],
        formula:'E[Rᵢ] = R_f + βᵢ ( E[R_m] − R_f )',
        pros:['Cheap, transparent, low turnover','No estimation of alpha required','Hard benchmark to beat after costs'],
        cons:['Single factor — empirically incomplete','Assumes everyone holds the market','Beta alone underprices small / value'] } },

    { id:'black-litterman', code:'BL', no:'03', name:'Black-Litterman', cat:'Bayesian',
      tagline:'Blend market equilibrium with the manager’s subjective views.',
      interactive:true, seed:3033, compute:bl,
      controls:[{k:'conf',label:'View confidence',min:0,max:100,step:5,def:40,fmt:v=>v.toFixed(0)+'%'}],
      info:{ origin:'Fischer Black & Robert Litterman, 1990', class:'Bayesian / MPT extension',
        summary:'A Bayesian framework that starts from the market-implied equilibrium returns (the CAPM prior) and tilts them toward the manager’s explicit views, weighted by stated confidence. Produces stable, intuitive allocations.',
        how:['Reverse-optimize market weights into implied returns (prior)','Express views as expected out/under-performance','Combine prior + views by confidence (posterior)','Re-optimize on blended returns'],
        formula:'E[R] = [(τΣ)⁻¹ + PᵀΩ⁻¹P]⁻¹ [(τΣ)⁻¹Π + PᵀΩ⁻¹Q]',
        pros:['Well-diversified, stable weights','Cleanly incorporates discretionary views','Avoids MVO’s extreme corner solutions'],
        cons:['Requires specifying view confidence Ω','Still depends on covariance estimate','Views can embed manager bias'] } },

    { id:'risk-parity', code:'RP', no:'04', name:'Risk Parity', cat:'Risk-based',
      tagline:'Equalize each asset’s contribution to total portfolio risk.',
      interactive:true, seed:4044, compute:rp,
      controls:[{k:'target',label:'Target volatility',min:4,max:14,step:0.5,def:8,fmt:v=>v.toFixed(1)+'%'}],
      info:{ origin:'Bridgewater "All Weather", 1996', class:'Risk-based allocation',
        summary:'Rather than weighting by capital, risk parity sizes positions so each contributes equally to portfolio risk — low-volatility assets get larger weights. A target-volatility cash sleeve scales the whole book.',
        how:['Estimate each asset’s volatility / risk contribution','Weight inversely to volatility (equal risk contribution)','Scale exposure to hit a target portfolio volatility','Hold the remainder in cash (or apply leverage)'],
        formula:'RCᵢ = wᵢ (Σw)ᵢ / σp  =  1/N   ∀ i',
        pros:['Robust diversification across regimes','Less reliant on return forecasts','Smoother drawdown profile'],
        cons:['Can over-weight low-vol / bonds','Often needs leverage for return','Volatility ≠ true risk'] } },

    { id:'min-variance', code:'MINV', no:'05', name:'Minimum Variance', cat:'Risk-based',
      tagline:'The lowest-volatility point on the efficient frontier.',
      interactive:true, seed:5055, compute:minv,
      controls:[{k:'cap',label:'Max weight cap',min:8,max:40,step:1,def:20,fmt:v=>v.toFixed(0)+'%'}],
      info:{ origin:'Frontier corner of Markowitz MPT', class:'Risk-based allocation',
        summary:'Ignores expected returns entirely and solves only for the global minimum-variance portfolio. Empirically delivers strong risk-adjusted returns thanks to the low-volatility anomaly, with a weight cap to limit concentration.',
        how:['Use only the covariance matrix Σ','Solve for weights minimizing wᵀΣw','Apply a per-name weight cap for diversification','No expected-return inputs needed'],
        formula:'min  wᵀΣw   s.t.  Σw = 1,  0 ≤ w ≤ cap',
        pros:['No return forecast required','Exploits low-volatility anomaly','Strong realized Sharpe historically'],
        cons:['Concentrates in defensive sectors','Sensitive to covariance estimate','Can lag in strong bull markets'] } },

    { id:'fama-french', code:'FF5', no:'06', name:'Fama-French Multi-Factor', cat:'Factor',
      tagline:'Tilt toward size, value and profitability premia.',
      interactive:true, seed:6066, compute:ff5,
      controls:[
        {k:'size', label:'SMB · Size load',  min:-1,max:1,step:0.05,def:0.30,fmt:v=>v.toFixed(2)},
        {k:'value',label:'HML · Value load', min:-1,max:1,step:0.05,def:0.40,fmt:v=>v.toFixed(2)},
        {k:'prof', label:'RMW · Quality load',min:-1,max:1,step:0.05,def:0.30,fmt:v=>v.toFixed(2)} ],
      info:{ origin:'Eugene Fama & Kenneth French, 1993 / 2015', class:'Multi-factor model',
        summary:'Extends CAPM with compensated risk factors. This book tilts the equity universe toward small-cap (SMB), cheap (HML) and highly profitable (RMW) names, with each factor exposure independently controllable.',
        how:['Score every asset on each factor (z-scores)','Combine factor loads into a composite tilt','Exponentially weight toward high-scoring names','Sliders set the strength of each factor exposure'],
        formula:'E[R] − R_f = β·MKT + s·SMB + h·HML + r·RMW + c·CMA',
        pros:['Captures empirically robust premia','Diversified factor sources of return','Transparent, controllable tilts'],
        cons:['Factors endure long droughts','Crowding can erode premia','Higher turnover than the market'] } },

    { id:'equal-weight', code:'EQW', no:'07', name:'Equal Weight (1/N)', cat:'Naive',
      tagline:'Allocate 1/N to every name — the naive benchmark that’s hard to beat.',
      interactive:false, seed:7077, compute:eqw,
      controls:[],
      info:{ origin:'DeMiguel, Garlappi & Uppal, 2009', class:'Naive diversification',
        summary:'Assigns identical weight to every asset and rebalances periodically. Despite using no optimization, the 1/N rule frequently matches or beats sophisticated optimizers out-of-sample because it carries zero estimation error.',
        how:['Assign weight 1/N to each of the N assets','Rebalance on a fixed schedule','No estimates of return, risk or covariance','Implicit small-cap and contrarian tilt'],
        formula:'wᵢ = 1 / N   ∀ i',
        pros:['Zero estimation error','Maximally diversified by count','Tough out-of-sample benchmark'],
        cons:['Ignores risk differences','Higher rebalancing turnover','Equal weight ≠ equal risk'] } },

    { id:'momentum', code:'MOM', no:'08', name:'Momentum', cat:'Factor',
      tagline:'Buy recent winners; ride the trend on a 12-1 month signal.',
      interactive:true, seed:8088, compute:mom,
      controls:[{k:'k',label:'Holdings (top-K)',min:3,max:10,step:1,def:6,fmt:v=>v.toFixed(0)}],
      info:{ origin:'Jegadeesh & Titman, 1993', class:'Cross-sectional factor',
        summary:'Ranks assets by trailing 12-month return (skipping the most recent month) and holds the strongest performers, weighted by momentum strength. One of the most persistent anomalies across markets and asset classes.',
        how:['Measure 12-1 month trailing return per asset','Rank and select the top-K winners','Weight proportional to momentum strength','Reform monthly as ranks change'],
        formula:'signalᵢ = Π_{t−12}^{t−1}(1+rᵢ) − 1 ;  hold top decile',
        pros:['Strong, pervasive historical premium','Works across asset classes','Captures trends early'],
        cons:['Sharp crashes at reversals','High turnover & trading costs','No downside protection'] } },

    { id:'value', code:'VAL', no:'09', name:'Value', cat:'Factor',
      tagline:'Own the cheapest names by price multiples, with a margin of safety.',
      interactive:true, seed:9099, compute:val,
      controls:[{k:'k',label:'Holdings (cheapest-K)',min:3,max:10,step:1,def:6,fmt:v=>v.toFixed(0)}],
      info:{ origin:'Graham & Dodd, 1934 · Fama-French HML', class:'Fundamental / factor',
        summary:'Screens for statistically cheap securities using a composite of earnings yield, book-to-price and dividend yield, then concentrates in the cheapest names. Buys assets trading below intrinsic value with a margin of safety.',
        how:['Score each name on P/E, P/B and dividend yield','Composite into a single cheapness rank','Hold the cheapest-K, weighted by value score','Demand a margin of safety vs. intrinsic value'],
        formula:'score = 0.45·z(E/P) + 0.35·z(B/P) + 0.20·z(yield)',
        pros:['Long-run value premium','Buys assets at a discount','Naturally contrarian'],
        cons:['"Value traps" — cheap for a reason','Can underperform for years','Tilts to old-economy sectors'] } },

    { id:'hrp', code:'HRP', no:'10', name:'Hierarchical Risk Parity', cat:'Machine Learning',
      tagline:'Cluster the universe, then allocate risk down the tree.',
      interactive:false, seed:1100, compute:hrp,
      controls:[],
      info:{ origin:'Marcos López de Prado, 2016', class:'ML / graph-based',
        summary:'A modern alternative to Markowitz that avoids inverting the covariance matrix. It clusters assets by correlation, builds a tree, and allocates capital by recursive bisection — producing stable, well-diversified books that are robust to estimation noise.',
        how:['Cluster assets hierarchically by correlation distance','Quasi-diagonalize the covariance matrix','Recursively bisect, splitting risk between branches','Inverse-variance weight within each cluster'],
        formula:'dᵢⱼ = √(½(1 − ρᵢⱼ)) → linkage → recursive bisection',
        pros:['No matrix inversion → numerically stable','Robust out-of-sample diversification','Handles large, noisy universes'],
        cons:['Sensitive to clustering / linkage choice','Less intuitive to explain','Newer, shorter live track record'] } },
  ];

  g.MERIDIAN = { U, MAP, byT, RISKY, EQUITY, MODELS, RF, BENCH, metrics, PAL,
                 HRP_CLUSTERS, BL_VIEWS, ASOF: D.asof, pathFor, benchPath, rhoOf,
                 CASH, BOND, modelById: id => MODELS.find(m=>m.id===id) };
})(window);
