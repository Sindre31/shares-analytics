/* ============================================================
   charts.js — lightweight SVG chart helpers (no deps)
   All return SVG markup strings. Terminal-styled.
   ============================================================ */
(function (g) {
  const NS = 'http://www.w3.org/2000/svg';
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const MF = 'IBM Plex Mono, ui-monospace, monospace'; // quote-free for SVG attrs

  // deterministic RNG (mulberry32)
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashStr(s){ let h=2166136261; for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619);} return h>>>0; }

  function esc(s){ return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
  const fmtPct = (v,d=1)=> (v>=0?'':'') + v.toFixed(d) + '%';

  /* ---------- DONUT / allocation ---------- */
  function donut(items, opts={}) {
    // items: [{label, value, color}]
    const size = opts.size || 220, sw = opts.stroke || 26;
    const r = (size - sw) / 2 - 2, cx = size/2, cy = size/2;
    const C = 2 * Math.PI * r;
    const total = items.reduce((s,i)=>s + i.value, 0) || 1;
    let off = 0;
    let segs = '';
    items.forEach((it,idx) => {
      const frac = it.value / total;
      const len = frac * C;
      const dash = `${len} ${C - len}`;
      const rot = (off / C) * 360 - 90;
      segs += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${it.color}" stroke-width="${sw}"
                 stroke-dasharray="${dash}" stroke-dashoffset="0"
                 transform="rotate(${rot} ${cx} ${cy})"
                 class="donut-seg" data-i="${idx}" style="transition:opacity .15s">
                 <title>${esc(it.label)} — ${(frac*100).toFixed(1)}%</title></circle>`;
      off += len;
    });
    const center = opts.center || '';
    return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" class="chart-donut">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${css('--line')}" stroke-width="${sw}"/>
      ${segs}
      ${center ? `<text x="${cx}" y="${cy-4}" text-anchor="middle" font-family="${MF}" font-size="11" fill="${css('--fg-mute')}" letter-spacing="1">${esc(center.top||'')}</text>
                  <text x="${cx}" y="${cy+16}" text-anchor="middle" font-family="${MF}" font-size="22" font-weight="600" fill="${css('--fg')}">${esc(center.mid||'')}</text>`:''}
    </svg>`;
  }

  /* ---------- LINE / performance ---------- */
  function line(series, opts={}) {
    // series: [{name, color, data:[numbers], dash?}]  data = cumulative index (start 100)
    const w = opts.w || 640, h = opts.h || 230;
    const padL = 6, padR = 10, padT = 14, padB = 22;
    const iw = w - padL - padR, ih = h - padT - padB;
    let lo = Infinity, hi = -Infinity, n = 0;
    series.forEach(s => { s.data.forEach(v => { lo=Math.min(lo,v); hi=Math.max(hi,v); }); n=Math.max(n,s.data.length); });
    if (!isFinite(lo)) { lo = 90; hi = 110; }
    const pad = (hi-lo)*0.08 || 1; lo -= pad; hi += pad;
    const X = i => padL + (i/(n-1))*iw;
    const Y = v => padT + ih - ((v-lo)/(hi-lo))*ih;

    // gridlines (4)
    let grid = '';
    for (let k=0;k<=4;k++){ const yy=padT+ (k/4)*ih; const val = hi-(k/4)*(hi-lo);
      grid += `<line x1="${padL}" x2="${w-padR}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}" stroke="${css('--line-soft')}" stroke-width="1"/>
               <text x="${w-padR}" y="${(yy-3).toFixed(1)}" text-anchor="end" font-family="${MF}" font-size="9.5" fill="${css('--fg-faint')}">${val.toFixed(0)}</text>`;
    }
    // x labels (months ~ even)
    let xlab = '';
    const ticks = opts.xlabels || [];
    ticks.forEach(t => { const xx=X(t.i); xlab += `<text x="${xx.toFixed(1)}" y="${h-6}" text-anchor="middle" font-family="${MF}" font-size="9.5" fill="${css('--fg-faint')}">${esc(t.t)}</text>`; });

    let paths = '';
    series.forEach((s,si) => {
      let d = '';
      s.data.forEach((v,i)=>{ d += (i?'L':'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1) + ' '; });
      // area fill for first/primary series
      if (s.fill) {
        const area = d + `L${X(s.data.length-1).toFixed(1)} ${(padT+ih).toFixed(1)} L${padL} ${(padT+ih).toFixed(1)} Z`;
        paths += `<path d="${area}" fill="url(#lg${si})" opacity="0.5"/>`;
      }
      paths += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width||1.6}" ${s.dash?`stroke-dasharray="${s.dash}"`:''} stroke-linejoin="round" stroke-linecap="round"/>`;
    });
    let defs = '<defs>';
    series.forEach((s,si)=>{ if(s.fill) defs += `<linearGradient id="lg${si}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.color}" stop-opacity="0.28"/><stop offset="1" stop-color="${s.color}" stop-opacity="0"/></linearGradient>`; });
    defs += '</defs>';

    return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none" class="chart-line">${defs}${grid}${paths}${xlab}</svg>`;
  }

  /* ---------- HORIZONTAL BARS ---------- */
  function hbars(items, opts={}) {
    // items:[{label,value,color}] value can be +/-
    const w = opts.w || 360, rowH = opts.rowH || 26, gap = 6;
    const h = items.length*(rowH+gap);
    const maxAbs = Math.max(...items.map(i=>Math.abs(i.value)), opts.min||0.001);
    const labW = opts.labW || 96;
    const zeroX = opts.signed ? labW + (w-labW)/2 : labW;
    const trackW = opts.signed ? (w-labW)/2 : (w-labW);
    let rows='';
    items.forEach((it,i)=>{
      const y = i*(rowH+gap);
      const bw = (Math.abs(it.value)/maxAbs)*trackW;
      const x = it.value<0 ? zeroX-bw : zeroX;
      const col = it.color || (it.value<0?css('--down'):css('--up'));
      rows += `<text x="0" y="${y+rowH/2+4}" font-family="${MF}" font-size="11" fill="${css('--fg-dim')}">${esc(it.label)}</text>
        <rect x="${zeroX - (opts.signed?trackW:0)}" y="${y}" width="${opts.signed?trackW*2:trackW}" height="${rowH}" fill="${css('--bg-2')}" rx="1"/>
        <rect x="${x.toFixed(1)}" y="${y}" width="${Math.max(0,bw).toFixed(1)}" height="${rowH}" fill="${col}" opacity="0.85" rx="1"/>
        <text x="${w}" y="${y+rowH/2+4}" text-anchor="end" font-family="${MF}" font-size="11" fill="${css('--fg')}" font-variant-numeric="tabular-nums">${esc(it.disp!=null?it.disp:it.value)}</text>`;
    });
    return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" class="chart-bars">${rows}</svg>`;
  }

  /* ---------- SCATTER (risk vs return) ---------- */
  function scatter(points, opts={}) {
    // points:[{x,y,label,code,color,r?}]
    const w = opts.w || 640, h = opts.h || 360;
    const padL=44, padR=18, padT=18, padB=38;
    const iw=w-padL-padR, ih=h-padT-padB;
    const xs=points.map(p=>p.x), ys=points.map(p=>p.y);
    let xlo=Math.min(...xs), xhi=Math.max(...xs), ylo=Math.min(...ys), yhi=Math.max(...ys);
    const xp=(xhi-xlo)*0.18||1, yp=(yhi-ylo)*0.18||1; xlo-=xp;xhi+=xp;ylo-=yp;yhi+=yp;
    const X=v=>padL+((v-xlo)/(xhi-xlo))*iw, Y=v=>padT+ih-((v-ylo)/(yhi-ylo))*ih;
    let grid='';
    for(let k=0;k<=4;k++){ const yy=padT+(k/4)*ih, val=yhi-(k/4)*(yhi-ylo);
      grid+=`<line x1="${padL}" x2="${w-padR}" y1="${yy}" y2="${yy}" stroke="${css('--line-soft')}"/>
             <text x="${padL-8}" y="${yy+3}" text-anchor="end" font-family="${MF}" font-size="9.5" fill="${css('--fg-faint')}">${val.toFixed(1)}</text>`;
      const xx=padL+(k/4)*iw, xval=xlo+(k/4)*(xhi-xlo);
      grid+=`<line x1="${xx}" x2="${xx}" y1="${padT}" y2="${padT+ih}" stroke="${css('--line-soft')}"/>
             <text x="${xx}" y="${h-padB+16}" text-anchor="middle" font-family="${MF}" font-size="9.5" fill="${css('--fg-faint')}">${xval.toFixed(1)}</text>`;
    }
    // greedy label de-overlap: nudge colliding labels vertically
    const placed=[];
    function labelY(lx, cy){
      const w=36, hh=11;
      let yy=cy+3.5, tries=0, dir=1;
      while (tries<10 && placed.some(b=>Math.abs(b.x-lx)<w && Math.abs(b.y-yy)<hh)){
        tries++; dir=-dir;
        yy = cy+3.5 + dir*Math.ceil(tries/2)*hh;
      }
      placed.push({x:lx,y:yy});
      return yy;
    }
    let dots='';
    points.forEach((p,i)=>{
      const cx=X(p.x), cy=Y(p.y), r=p.r||5;
      const ly=labelY(cx+r+5, cy);
      dots+=`<g class="sc-pt" data-code="${esc(p.code||'')}" style="cursor:pointer">
        <circle cx="${cx}" cy="${cy}" r="${r+6}" fill="${p.color}" opacity="0.10"/>
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="${p.color}" stroke="${css('--bg')}" stroke-width="1.5"/>
        <text x="${cx+r+5}" y="${ly}" font-family="${MF}" font-size="10" fill="${css('--fg-dim')}">${esc(p.code||'')}</text>
        <title>${esc(p.label)} — vol ${p.x.toFixed(1)}% / ret ${p.y.toFixed(1)}%</title></g>`;
    });
    const axt = `<text x="${padL+iw/2}" y="${h-4}" text-anchor="middle" font-family="${MF}" font-size="9.5" letter-spacing="1.5" fill="${css('--fg-mute')}">${esc(opts.xlabel||'VOLATILITY %')}</text>
      <text transform="translate(13 ${padT+ih/2}) rotate(-90)" text-anchor="middle" font-family="${MF}" font-size="9.5" letter-spacing="1.5" fill="${css('--fg-mute')}">${esc(opts.ylabel||'EXP. RETURN %')}</text>`;
    return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" class="chart-scatter">${grid}${dots}${axt}</svg>`;
  }

  /* ---------- sparkline (tiny) ---------- */
  function spark(data, color, w=120, h=28){
    let lo=Math.min(...data), hi=Math.max(...data); if(hi===lo)hi+=1;
    const X=i=>(i/(data.length-1))*w, Y=v=>h-2-((v-lo)/(hi-lo))*(h-4);
    let d=''; data.forEach((v,i)=>d+=(i?'L':'M')+X(i).toFixed(1)+' '+Y(v).toFixed(1)+' ');
    return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><path d="${d}" fill="none" stroke="${color}" stroke-width="1.4"/></svg>`;
  }

  /* simulate a cumulative monthly return path -> index starting at 100 */
  function simPath(months, annRet, annVol, seed) {
    const rand = rng(seed>>>0);
    const mr = annRet/100/12, mv = annVol/100/Math.sqrt(12);
    let idx = 100; const out=[100];
    for (let i=0;i<months;i++){
      // box-muller
      const u1=Math.max(1e-9,rand()), u2=rand();
      const z=Math.sqrt(-2*Math.log(u1))*Math.cos(2*Math.PI*u2);
      idx *= (1 + mr + mv*z);
      out.push(idx);
    }
    return out;
  }
  function maxDrawdown(path){ let peak=path[0], mdd=0; for(const v of path){ if(v>peak)peak=v; const dd=(v-peak)/peak; if(dd<mdd)mdd=dd; } return mdd*100; }

  g.Charts = { donut, line, hbars, scatter, spark, simPath, maxDrawdown, rng, hashStr, fmtPct, esc, css };
})(window);
