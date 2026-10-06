/* The Monitor home page. The look is the approved design (design/monitor/index.html); every value comes from
   the live payload of server/lib/monitor.js: local /api/monitor, or on the published site the Cloudflare Worker's
   /monitor (falling back to the copy baked at publish, marked stale). A missing value shows as a dash, never zero. */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ETF = { 'Information Technology': 'XLK', 'Financials': 'XLF', 'Health Care': 'XLV', 'Consumer Discretionary': 'XLY', 'Consumer Staples': 'XLP', 'Energy': 'XLE', 'Industrials': 'XLI', 'Materials': 'XLB', 'Utilities': 'XLU', 'Real Estate': 'XLRE', 'Communication Services': 'XLC' };
const SHORT = { 'Information Technology': 'Technology', 'Consumer Discretionary': 'Consumer Discretionary', 'Communication Services': 'Communication' };
const S = { p: 'd', zoom: '', open: '', mode: 'cats' };  // mode: cats (default, Mowgli's own scheme, D74) | sec (GICS) | SPY | QQQ | an overlay id (megacaps, hyperscalers)
const isFund = (m) => m === 'SPY' || m === 'QQQ';
Object.assign(S, Object.fromEntries(location.hash.slice(1).split('&').filter(Boolean).map((s) => s.split('=').map(decodeURIComponent))));
const CAP = { d: 3, w: 6, m: 10, y: 30 };
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => { const A = hex(a), B = hex(b); return '#' + A.map((v, i) => Math.round(v * (1 - t) + B[i] * t).toString(16).padStart(2, '0')).join(''); };
const heat = (v) => { if (v == null) return '#3a4148'; const t = Math.max(-1, Math.min(1, v / CAP[S.p])), k = Math.pow(Math.abs(t), .7); return t >= 0 ? mix('#394247', '#2d8a63', k) : mix('#394247', '#b04a44', k); };
const fp = (v, d = 2) => (v == null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d) + '%');
const cls = (v) => (v > 0 ? 'up' : v < 0 ? 'dn' : 'fl');
const money = (v) => (v == null ? '—' : v >= 1e12 ? '$' + (v / 1e12).toFixed(2) + 'T' : '$' + (v / 1e9).toFixed(0) + 'B');
// weights use each company's own size (a company with several share classes is counted once)
const sz = (s) => s.size ?? s.cap ?? 0;
const wavg = (arr, k) => { let s = 0, w = 0; arr.forEach((x) => { if (x[k] != null && sz(x)) { s += x[k] * sz(x); w += sz(x); } }); return w ? s / w : null; };

let P = null;            // the payload being shown
let D = { stocks: [], etf: {}, watch: [], breadthHist: [] };
let bySec = {};
let GR = null;           // grouping maps (Mowgli Cats, GICS labels, overlays) from the payload, joined to the live prices here
let GCACHE = {};         // groupsFor() answers for the payload being shown
let COMPANIES = [];      // Mowgli's own company pages
const LINK = new Map();  // Yahoo-style symbol -> canonical folder ticker
const LOGO = new Map();  // Yahoo-style symbol -> logo url
const ysym = (s) => String(s || '').toUpperCase().replace(/[./ ]/g, '-');
const isMine = (t) => LINK.has(ysym(t));
const LOGOFILES = {};    // every committed logo file by Yahoo-style symbol
const logo = (t) => LOGO.get(ysym(t)) || (LOGOFILES[ysym(t)] ? MG.logoBase + LOGOFILES[ysym(t)] : null);
const co = (t) => (isMine(t) ? ` data-co="${esc(LINK.get(ysym(t)))}"` : '');

/* ---------- sky: one teal family, leaning green on up days and red-violet on down days ---------- */
function stars(cv, n, col, maxA, maxR, seed) {
  const W = cv.width = innerWidth, Hh = cv.height = innerHeight, x = cv.getContext('2d'); x.clearRect(0, 0, W, Hh);
  const [r, g, b] = hex(col), c = r + ',' + g + ',' + b; let s = seed; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647; const N = Math.round(n * W * Hh / (2560 * 1300));
  for (let i = 0; i < N; i++) {
    const px = rnd() * W, py = rnd() * Hh, rad = Math.pow(rnd(), 3) * maxR + .35, a = (.15 + rnd() * .85) * maxA;
    x.beginPath(); x.arc(px, py, rad, 0, 6.283); x.fillStyle = 'rgba(' + c + ',' + a.toFixed(3) + ')'; x.fill();
    if (rad > maxR * .7) { const gr = x.createRadialGradient(px, py, 0, px, py, rad * 5); gr.addColorStop(0, 'rgba(' + c + ',' + (a * .35).toFixed(3) + ')'); gr.addColorStop(1, 'rgba(' + c + ',0)'); x.fillStyle = gr; x.beginPath(); x.arc(px, py, rad * 5, 0, 6.283); x.fill(); }
  }
}
function sky() {
  const spy = D.etf.SPY?.d ?? 0, mood = S.mood === 'up' ? 1.5 : S.mood === 'down' ? -1.5 : S.mood === 'off' ? 0 : spy;
  const t = Math.min(Math.abs(mood) / 1.5, 1) * .28, base = '#2c8c86', fam = mood > 0 ? mix(base, '#3aa06a', t) : mix(base, '#7a4f96', t);
  const r = document.documentElement.style;
  r.setProperty('--c1', mix(mix(fam, '#1d4f7a', .15), '#05070b', .5)); r.setProperty('--c2', mix(fam, '#05070b', .66)); r.setProperty('--c3', mix(mix(fam, '#2a3a70', .25), '#05070b', .72));
  r.setProperty('--tint', fam); r.setProperty('--dust', mix(fam, '#ffffff', .45)); r.setProperty('--sp', mix(fam, '#030507', .93));
  const dust = mix(fam, '#ffffff', .45); stars($('st1'), 1400, mix('#dcf0ff', dust, .15), .7, 1.4, 11); stars($('st2'), 120, mix('#fff5e1', dust, .25), .9, 2, 29);
}

/* ---------- header status + footer ---------- */
const SESSION_TXT = { open: 'Market open', 'pre-market': 'Pre-market', 'after hours': 'After hours', closed: 'Market closed' };
function drawStatus() {
  const q = new Date(P.quoteTime || P.asOf);
  const et = q.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
  const dstr = q.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short', day: 'numeric', month: 'short' });
  const st = $('stat');
  if (P.stale) {
    st.className = 'stat pad bad';
    st.innerHTML = `<i></i><span><b>Stale</b> · live data not answering; showing prices as of <b>${et} ET</b>, ${dstr}${P.baked ? ' (captured when the site was published)' : ''}</span>`;
  } else {
    st.className = 'stat pad' + (P.session === 'open' ? '' : ' off');
    st.innerHTML = `<i></i><span>${SESSION_TXT[P.session] || 'Market'} · prices as of <b>${et} ET</b>, ${dstr}</span>`;
  }
  const n = D.stocks.length;
  const src = `Prices ${P.sources?.prices || 'Yahoo Finance'}, ${dstr} ${et} ET, refreshed every minute · S&amp;P 500 members and GICS sectors ${P.sources?.members || 'Wikipedia'} · breadth counted by Mowgli from live quotes for ${n} members, history from Mowgli's saved daily lines · sector colour = sector fund (XLK…), size = members' market cap · group breakdowns Mowgli industry maps · fund weights State Street (SPY) and Invesco (QQQ) holdings files${P.periodsOk === false ? ' · <b>1W, 1M and YTD moves for companies are unavailable until the site is next published</b>' : ''}`;
  $('src').innerHTML = src; $('src').title = src.replace(/<[^>]+>/g, '');
}

/* ---------- watch charts ---------- */
function spark(vals, base, w = 200, h = 50) {
  if (!vals.length) return '';
  const all = base != null ? [...vals, base] : vals, mn = Math.min(...all), mx = Math.max(...all), rg = mx - mn || 1;
  const X = (i) => i / (vals.length - 1 || 1) * w, Y = (v) => h - (v - mn) / rg * h; const d = vals.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1)).join('');
  const up = vals[vals.length - 1] >= (base ?? vals[0]), col = up ? 'var(--up)' : 'var(--dn)';
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${base != null ? `<line x1="0" x2="${w}" y1="${Y(base)}" y2="${Y(base)}" stroke="rgba(255,255,255,.28)" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>` : ''}<path d="${d}" fill="none" stroke="${col}" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
}
function drawWatch() {
  $('wrow').innerHTML = D.watch.map((w) => {
    const yld = w.s === '^TNX', has = w.p != null;
    const p = !has ? '—' : yld ? w.p.toFixed(2) + '%' : w.s === 'CL=F' ? '$' + w.p.toFixed(2) : w.p.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
    const c = w.ch == null ? '—' : yld ? (w.ch >= 0 ? '+' : '−') + Math.abs(w.ch * 100).toFixed(1) + ' bp' : fp(w.pc);
    const d3 = w.d3m && w.d3m.length ? w.d3m[0] : null;
    const m3 = !has || d3 == null ? '—' : yld ? `<span class="${cls(w.p - d3)}">${(w.p - d3 >= 0 ? '+' : '−') + Math.abs((w.p - d3) * 100).toFixed(0)} bp</span>` : `<span class="${cls(w.m3)}">${fp(w.m3, 1)}</span>`;
    return `<div class="wt pad" title="${esc(w.n)}: line is today so far; dashed line is yesterday's close"><div class="n">${esc(w.n)}</div><div class="r">3 mo ${m3}</div><div class="p">${p}</div><div class="c ${cls(w.ch)}">${c}</div>${spark(w.intra || [], w.prev)}</div>`;
  }).join('');
}

/* ---------- treemap ---------- */
function squarify(items, x, y, w, h) {
  const out = []; const tot = items.reduce((a, b) => a + b.v, 0); if (!tot) return out; const sc = w * h / tot; let rest = items.filter((i) => i.v > 0).sort((a, b) => b.v - a.v).map((i) => ({ ...i, a: i.v * sc }));
  while (rest.length) {
    const sh = Math.min(w, h); let row = [rest[0]], i = 1;
    const worst = (r) => { const s = r.reduce((a, b) => a + b.a, 0), mx = Math.max(...r.map((q) => q.a)), mn = Math.min(...r.map((q) => q.a)); return Math.max(sh * sh * mx / (s * s), (s * s) / (sh * sh * mn)); };
    while (i < rest.length && worst([...row, rest[i]]) <= worst(row)) { row.push(rest[i]); i++; }
    const s = row.reduce((a, b) => a + b.a, 0);
    if (w >= h) { const cw = s / h; let cy = y; row.forEach((r) => { const rh = r.a / cw; out.push({ ...r, x, y: cy, w: cw, h: rh }); cy += rh; }); x += cw; w -= cw; }
    else { const rh = s / w; let cx = x; row.forEach((r) => { const rw = r.a / rh; out.push({ ...r, x: cx, y, w: rw, h: rh }); cx += rw; }); y += rh; h -= rh; }
    rest = rest.slice(i);
  }
  return out;
}
const G = 2; const R = () => parseFloat(getComputedStyle(document.documentElement).fontSize); const box = (r, extra = '') => `left:${r.x + G / 2}px;top:${r.y + G / 2}px;width:${Math.max(0, r.w - G)}px;height:${Math.max(0, r.h - G)}px;${extra}`;
function coCell(s, r, big) {
  const v = s[S.p], fs = Math.max(9, Math.min(R() * (big ? 1.4 : 1.05), Math.sqrt(r.w * r.h) / (big ? 7 : 5.5))); const lg = logo(s.s);
  const show = r.w > 34 && r.h > 20, showV = r.h > fs * 2.6 && r.w > 44;
  let inner = ''; if (show) {
    if (big && lg && r.h > fs * 7 && r.w > fs * 6) inner = `<div class="lg"><img src="${esc(lg)}" alt=""></div><div class="nm">${esc(s.s)}</div><div class="mv">${fp(v)}</div>${r.h > fs * 9 ? `<div class="sm">${esc(s.n)} · ${money(s.cap)}</div>` : ''}`;
    else inner = `<div class="nm">${esc(s.s)}</div>${showV ? `<div class="mv">${fp(v, 1)}</div>` : ''}${big && r.h > fs * 5 && r.w > fs * 7 ? `<div class="sm">${esc(s.n)}</div>` : ''}`;
  }
  return `<div class="cell${big ? ' co' : ''}"${big ? co(s.s) : ''} style="${box(r, `background:${heat(v)};font-size:${fs}px`)}${big && !(lg && r.h > fs * 7) ? ';justify-content:center;align-items:center;text-align:center' : ''}" title="${esc(s.n)} (${esc(s.s)}) ${fp(v)} · ${money(s.cap)}${big && isMine(s.s) ? ' · click to open the company' : ''}">${inner}</div>`;
}
function groups(list, sub) {
  const gs = P.groups?.[sub]; if (!gs) return null; const out = gs.map((g) => ({ name: g.name, list: [] })); const other = { name: 'Other', list: [] };
  list.forEach((s) => { const g = gs.findIndex((x) => x.tickers.includes(s.s)); (g >= 0 ? out[g] : other).list.push(s); });
  return [...out, other].filter((g) => g.list.length);
}
function nest(gs, W, H, big, click) {
  let h = ''; squarify(gs.map((g) => ({ ...g, v: g.list.reduce((a, s) => a + sz(s), 0) })), 0, 0, W, H).forEach((g) => {
    const hh = g.h > 60 && g.w > 70 ? 22 : 0, v = wavg(g.list, S.p);
    h += `<div class="grp" style="${box(g)}">${hh ? `<div class="gh" ${click ? `data-z="${esc(click(g))}"` : ''} title="${esc(g.full || g.name)} ${fp(v)}">${g.badge ? '<span class="badge">Mowgli</span>' : ''}${g.w < 90 ? '' : `<span class="gn">${esc(g.name)}</span>`}<b class="${cls(v)}">${fp(v, 1)}</b></div>` : ''}`;
    squarify(g.list.map((s) => ({ s, v: sz(s) })), 0, hh, g.w - G, g.h - G - hh).forEach((c) => { h += click ? coCell(c.s, c, big).replace('class="cell', 'data-z="' + esc(click(g)) + '" class="cell') : coCell(c.s, c, big); }); h += '</div>';
  }); return h;
}
const legend = (note) => { const c = CAP[S.p]; $('legend').innerHTML = `<span>${fp(-c, 0)}</span><div class="sc">${[-1, -.66, -.33, 0, .33, .66, 1].map((t) => `<i style="background:${heat(t * c)}"></i>`).join('')}</div><span>${fp(c, 0)}</span><span class="note">${note}</span>`; };
/* ---------- Mowgli Cats / overlays: groups joined to the live prices (D75) ---------- */
// [{ id, name, list, subs:[{ id, name, list }] }]: a company is placed once, under its main Sub. A company with no price row
// is left out; one whose placement is unclear sits under "Not yet placed". Moves are weighted by market value in wavg(), which
// skips members with no move instead of counting them as zero.
function groupsFor(mode) {
  if (GCACHE[mode]) return GCACHE[mode];
  let out = null;
  if (GR) {
    const at = (s) => GR.co?.[ysym(s.s)];
    if (mode === 'cats') {
      const cats = GR.cats.map((c) => ({ id: c.id, name: c.name, short: c.short, list: [], subs: c.subs.map((x) => ({ id: x.id, name: x.name, short: x.short, list: [] })) }));
      const un = { id: 'unplaced', name: 'Not yet placed', list: [], subs: [{ id: 'unplaced/unplaced', name: 'Not yet placed', list: [] }] };
      D.grp.forEach((s) => {
        const a = at(s); if (!a) return;
        const c = cats.find((x) => x.id === a[0]), sb = c?.subs.find((x) => x.id === a[1]);
        const g = c || un, sg = sb || (c ? (c.subs.find((x) => x.id === c.id + '/other') || (c.subs.push({ id: c.id + '/other', name: 'Other (not yet placed)', list: [] }), c.subs[c.subs.length - 1])) : un.subs[0]);
        g.list.push(s); sg.list.push(s);
      });
      out = [...cats, un].filter((g) => g.list.length);
      out.forEach((g) => { g.subs = g.subs.filter((x) => x.list.length); });
    } else if (mode === 'sec') {
      const m = new Map();
      D.grp.forEach((s) => {
        const a = at(s); if (!a || !a[2]) return;   // only cited GICS labels are used
        if (!m.has(a[2])) m.set(a[2], { id: a[2], name: a[2], list: [], subs: new Map() });
        const g = m.get(a[2]); g.list.push(s);
        const sn = a[3] || 'Not stated'; if (!g.subs.has(sn)) g.subs.set(sn, { id: a[2] + '/' + sn, name: sn, list: [] });
        g.subs.get(sn).list.push(s);
      });
      out = [...m.values()].map((g) => ({ ...g, subs: [...g.subs.values()] }));
    } else {
      const o = GR.overlays?.find((x) => x.id === mode);
      if (o) { const set = new Set(o.members.map(ysym)); out = [{ id: o.id, name: o.name, list: D.grp.filter((s) => set.has(ysym(s.s))), subs: [], def: o.definition, n: o.members.length }]; }
    }
  }
  return (GCACHE[mode] = out);
}
function drawGrouped(el, W, H) {
  const gs = groupsFor(S.mode), root = 'Mowgli Cats';
  if (!gs) { el.innerHTML = '<div class="msg">The grouping lists did not come with the data, so this view is not available yet.</div>'; $('crumb').innerHTML = ''; legend(''); return; }
  if (S.mode !== 'cats') { /* an overlay: one group of companies */
    const g = gs[0], v = wavg(g.list, S.p);
    el.innerHTML = squarify(g.list.map((s) => ({ s, v: sz(s) })), 0, 0, W, H).map((c) => coCell(c.s, c, true)).join('');
    $('crumb').innerHTML = `<span class="cur">${esc(g.name)}</span><span class="note" style="margin-left:.5rem;font-weight:600">value-weighted move <b class="${cls(v)}">${fp(v, 2)}</b> · ${g.list.length} of ${g.n} members priced here</span>`;
    legend(`${esc(g.def || '')} Box size = market cap; colour = the move. click a box to open the company`);
    return;
  }
  const [cid] = S.zoom ? S.zoom.split('/') : [], g = gs.find((x) => x.id === cid), sub = g && S.zoom.includes('/') ? g.subs.find((x) => x.id === S.zoom) : null;
  let h = '', crumb = `<a data-z="">${root}</a>`;
  if (!g) {
    squarify(gs.map((x) => ({ ...x, v: x.list.reduce((a, s) => a + sz(s), 0), mv: wavg(x.list, S.p) })), 0, 0, W, H).forEach((r) => {
      // a narrow or short tile shows only the %, name in the tooltip; the % is always kept on the tile
      const top = r.list.slice().sort((a, b) => sz(b) - sz(a)).slice(0, 3), nar = r.w < 90 || r.h < 60;
      let fs = Math.max(7, Math.min(R() * 1.5, Math.sqrt(r.w * r.h) / 13));
      fs = nar ? Math.min(fs, (r.w - G) / 4.8, (r.h - G) / 2.4) : Math.min(fs, (r.w - G) / 7.4);
      h += `<div class="cell sec${nar ? ' nar' : ''}" data-z="${esc(r.id)}" style="${box(r, `background:${heat(r.mv)};font-size:${fs}px`)}" title="${esc(r.name)}: value-weighted move ${fp(r.mv)} · ${r.list.length} companies · click to zoom">${nar ? '' : `<div class="nm" style="-webkit-line-clamp:${r.h > fs * 6.2 ? 2 : 1}">${esc(r.short || r.name)}</div>`}<div class="mv">${fp(r.mv)}</div>${r.h > fs * 6 && r.w > fs * 14 ? `<div class="sm">${top.map((s) => `${esc(s.s)} ${fp(s[S.p], 1)}`).join(' · ')}</div>` : ''}</div>`;
    });
    crumb = `<span class="cur">${root}</span><span class="note" style="margin-left:.5rem;font-weight:600">click a Cat to zoom in</span>`;
  } else if (!sub) {
    h = nest(g.subs.map((x) => ({ name: x.short || x.name, full: x.name, list: x.list, id: x.id })), W, H, false, (x) => x.id);
    crumb += `<span class="sep">›</span><span class="cur">${esc(g.name)}</span><span class="note" style="margin-left:.5rem;font-weight:600">value-weighted ${fp(wavg(g.list, S.p), 1)}</span>`;
  } else {
    h = squarify(sub.list.map((s) => ({ s, v: sz(s) })), 0, 0, W, H).map((c) => coCell(c.s, c, true)).join('');
    crumb += `<span class="sep">›</span><a data-z="${esc(g.id)}">${esc(g.name)}</a><span class="sep">›</span><span class="cur">${esc(sub.name)}</span><span class="note" style="margin-left:.5rem;font-weight:600">value-weighted ${fp(wavg(sub.list, S.p), 1)}</span>`;
  }
  el.innerHTML = h; $('crumb').innerHTML = crumb;
  legend('Box size = market cap of the companies placed here (each company once, under its main Sub); colour = value-weighted move, companies with no price left out · click to go deeper');
}
function drawMap() {
  document.body.classList.toggle('etf', isFund(S.mode)); $('hl').classList.toggle('on', S.mode === 'SPY'); document.querySelectorAll('#mode button').forEach((x) => x.classList.toggle('on', x.dataset.m === S.mode));
  if (!P) return;
  if (isFund(S.mode)) return drawEtf();
  const el = $('map'), W = el.clientWidth, H = el.clientHeight;
  if (S.mode !== 'sec') return drawGrouped(el, W, H); const [sec, sub] = S.zoom ? S.zoom.split('/') : [];
  const secName = sec && Object.keys(ETF).find((k) => ETF[k] === sec); let h = '', crumb = `<a data-z="">S&amp;P 500</a>`;
  if (!secName) { /* level 0: sectors */
    const items = Object.keys(ETF).map((n) => ({ n, e: ETF[n], v: (bySec[n] || []).reduce((a, s) => a + sz(s), 0), mv: D.etf[ETF[n]]?.[S.p] ?? null }));
    squarify(items, 0, 0, W, H).forEach((r) => {
      const top = (bySec[r.n] || []).slice().sort((a, b) => sz(b) - sz(a)).slice(0, 3); const fs = Math.max(R() * .85, Math.min(R() * 1.5, Math.sqrt(r.w * r.h) / 13));
      h += `<div class="cell sec" data-z="${r.e}" style="${box(r, `background:${heat(r.mv)};font-size:${fs}px`)}" title="${esc(r.n)}: sector fund ${r.e} ${fp(r.mv)} · click to zoom"><div class="nm">${esc(SHORT[r.n] || r.n)}</div><div class="mv">${fp(r.mv)}</div>${r.h > fs * 6 && r.w > fs * 16 ? `<div class="sm">${r.e} · ${top.map((s) => `${esc(s.s)} ${fp(s[S.p], 1)}`).join(' · ')}</div>` : ''}</div>`;
    });
    crumb = `<span class="cur">S&amp;P 500</span><span class="note" style="margin-left:.5rem;font-weight:600">click a sector to zoom in</span>`;
  } else if (!sub) { /* level 1: sub-industries of one sector, companies inside */
    const subs = {}; (bySec[secName] || []).forEach((s) => (subs[s.sub] = subs[s.sub] || []).push(s));
    h = nest(Object.entries(subs).map(([name, list]) => ({ name, list, badge: !!P.groups?.[name] })), W, H, false, (g) => sec + '/' + g.name);
    crumb += `<span class="sep">›</span><span class="cur">${esc(secName)}</span><span class="note" style="margin-left:.5rem;font-weight:600">sector fund ${sec} ${fp(D.etf[sec]?.[S.p])}</span>`;
  } else { /* level 2: one sub-industry, Mowgli groups where we have them */
    const list = (bySec[secName] || []).filter((s) => s.sub === sub), gs = groups(list, sub);
    h = gs ? nest(gs, W, H, true, null) : squarify(list.map((s) => ({ s, v: sz(s) })), 0, 0, W, H).map((c) => coCell(c.s, c, true)).join('');
    crumb += `<span class="sep">›</span><a data-z="${sec}">${esc(secName)}</a><span class="sep">›</span><span class="cur">${esc(sub)}</span>${gs ? '<span class="badge" style="margin-left:.4rem">Mowgli breakdown</span>' : ''}`;
  }
  el.innerHTML = h; $('crumb').innerHTML = crumb;
  legend(`${!secName ? 'Box size = combined market cap of the sector’s S&P 500 members; colour = its sector fund' : sub ? 'Box size = market cap; companies in several Mowgli groups sit under their main one' : 'Box size = market cap; group move is value-weighted'} · click to go deeper`);
}
/* ---------- ETF holdings: official fund weights ---------- */
const TH = 0.15;
const fmtDay = (iso) => (iso ? new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null);
function drawEtf() {
  const E = P.etf?.[S.mode.toLowerCase()], el = $('map'); S.p = 'd';
  if (!E) { el.innerHTML = '<div class="msg">The fund’s official holdings file could not be read, so there are no weights to show.</div>'; $('hl').innerHTML = ''; $('crumb').innerHTML = `<span class="cur">${S.mode}</span>`; legend(''); return; }
  const all = E.h.filter((h) => h.w > 0 && !/future/i.test(h.n)), fut = E.h.filter((h) => /future/i.test(h.n)).reduce((a, h) => a + h.w, 0);
  const boxes = S.mode === 'SPY' ? all.filter((h) => +h.w.toFixed(2) >= TH) : all, rest = S.mode === 'SPY' ? all.filter((h) => +h.w.toFixed(2) < TH) : [];
  const W = el.clientWidth, H = el.clientHeight;
  el.innerHTML = squarify(boxes.map((h) => ({ hd: h, v: h.w })), 0, 0, W, H).map((r) => {
    const h = r.hd, fs = Math.max(9, Math.min(R() * 1.3, Math.sqrt(r.w * r.h) / 5.5)), lg = logo(h.t);
    const show = r.w > 30 && r.h > 18, withLogo = lg && r.h > fs * 6.5 && r.w > fs * 5;
    const inner = !show ? '' : (withLogo ? `<div class="lg"><img src="${esc(lg)}" alt=""></div>` : '') + `<div class="nm">${esc(h.t)}</div>${r.h > fs * 2.5 && r.w > 40 ? `<div class="mv">${fp(h.d, withLogo ? 2 : 1)}</div>` : ''}${r.h > fs * 5.5 && r.w > fs * 6 ? `<div class="sm">${h.w.toFixed(2)}% of fund</div>` : ''}`;
    return `<div class="cell co"${co(h.t)} style="${box(r, `background:${heat(h.d)};font-size:${fs}px`)}" title="${esc(h.n)} (${esc(h.t)}) · ${h.w.toFixed(2)}% of ${S.mode} · today ${fp(h.d)}${isMine(h.t) ? ' · click to open the company' : ''}">${inner}</div>`;
  }).join('');
  $('hl').innerHTML = S.mode === 'SPY' ? `<h5>${rest.length} smaller holdings (under ${TH}% each, ${rest.reduce((a, h) => a + h.w, 0).toFixed(1)}% of the fund)</h5><div class="sc2">${rest.map((h) => `<div class="hr"${co(h.t)} title="${esc(h.n)}${isMine(h.t) ? ' · click to open the company' : ''}"><b>${esc(h.t)}</b><span>${esc(h.n)}</span><i>${h.w.toFixed(2)}%</i><em class="${cls(h.d)}">${fp(h.d)}</em></div>`).join('')}</div>` : '';
  const d = fmtDay(E.asOf) || (E.asOfText || '').replace(/.*As of\s*/i, '') || 'an unknown date';
  $('crumb').innerHTML = `<span class="cur">${S.mode === 'SPY' ? 'SPY · S&amp;P 500 fund' : 'QQQ · Nasdaq 100 fund'}</span><span class="note" style="margin-left:.5rem;font-weight:600">${all.length} holdings · official weights as of ${d}, ${S.mode === 'SPY' ? 'State Street' : 'Invesco'}</span>`;
  legend(`Box size = weight in the fund (${esc(E.src)}); colour = today's move${fut ? ` · excludes index futures (${fut.toFixed(2)}%)` : ''} · click a box to open the company (where Mowgli has one)`);
}

/* ---------- breadth ---------- */
// days before the series was recorded are left off; a missing day inside it (a gap marker, D84) breaks the line
const line = (H, k, col, max = 100) => { const all = H.map((x) => x[k] ?? null), f = all.findIndex((x) => x != null), v = f < 0 ? [] : all.slice(f); if (v.filter((x) => x != null).length < 2) return ''; let pen = 'M'; const d = v.map((y, i) => { if (y == null) { pen = 'M'; return ''; } const s = pen + (i / (v.length - 1) * 200).toFixed(1) + ' ' + (30 - y / max * 30).toFixed(1); pen = 'L'; return s; }).join(''); return `<svg viewBox="0 0 200 30" preserveAspectRatio="none">${max === 100 ? '<line x1="0" x2="200" y1="15" y2="15" stroke="rgba(255,255,255,.18)" stroke-dasharray="2 3" vector-effect="non-scaling-stroke"/>' : ''}<path d="${d}" fill="none" stroke="${col}" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>`; };
const split = (a, b) => `<div class="bar"><i class="u" style="width:${a / (a + b || 1) * 100}%"></i><i class="d" style="width:${b / (a + b || 1) * 100}%"></i></div>`;
const vfmt = (v) => (v / 1e9).toFixed(2) + 'B';
const pctOf = (list, k) => { const known = list.filter((s) => s[k] != null); return known.length ? known.filter((s) => s[k]).length / known.length * 100 : null; };
const pf = (v) => (v == null ? '—' : v.toFixed(0) + '%');
function drawBreadth() {
  const st = D.stocks.filter((s) => s.d != null), N = st.length;
  const adv = st.filter((s) => s.d > 0).length, dec = st.filter((s) => s.d < 0).length;
  const a50 = pctOf(st, 'a50'), a200 = pctOf(st, 'a200'), hlk = st.filter((s) => s.nh != null && s.nl != null), nh = hlk.filter((s) => s.nh).length, nl = hlk.filter((s) => s.nl).length;
  const uv = st.filter((s) => s.d > 0).reduce((a, s) => a + (s.vol || 0), 0), dv = st.filter((s) => s.d < 0).reduce((a, s) => a + (s.vol || 0), 0);
  const H = D.breadthHist || [];
  const HL = H.map((x) => ({ h: x.hl ? x.nh / x.hl * 100 : null, l: x.hl ? x.nl / x.hl * 100 : null })), hlMax = Math.max(5, ...HL.map((x) => Math.max(x.h ?? 0, x.l ?? 0)));
  const firstQ = H.find((x) => x.source === 'yahoo-quote')?.d, bnote = firstQ ? `Lines before ${firstQ} were rebuilt from daily closes (averages computed by Mowgli); from ${firstQ} on each line is saved after the close using Yahoo's 50- and 200-day averages.` : 'Rebuilt from daily closes (averages computed by Mowgli); today so far uses the Yahoo-supplied averages.';
  const hlPct = (v) => (hlk.length ? (v / hlk.length * 100).toFixed(1) + '%' : '—');
  $('bn').textContent = N + ' stocks · ' + (P.session === 'open' ? 'live' : 'last session');
  $('bgrid').innerHTML =
    `<div class="br"><div class="k">Rising vs falling today</div><div class="v"><span class="up">${adv}</span> / <span class="dn">${dec}</span></div>${split(adv, dec)}</div>` +
    `<div class="br"><div class="k">Share of stocks above their average price</div><div class="v"><small title="${esc(bnote)}">last ${H.length} days, dashed = half</small></div><div class="two"><div><b>${pf(a50)}</b><span>above<br>50-day</span>${line(H, 'a50', 'var(--accx)')}</div><div><b>${pf(a200)}</b><span>above<br>200-day</span>${line(H, 'a200', '#c9c2e8')}</div></div></div>` +
    `<div class="br"><div class="k">New 52-week highs vs lows</div><div class="v"><span class="up">${nh}</span> / <span class="dn">${nl}</span><small>of ${hlk.length} stocks</small></div>${split(nh, nl)}<div class="two"><div><b class="up">${hlPct(nh)}</b><span>at a new<br>high</span>${line(HL, 'h', '#3f9a74', hlMax)}</div><div><b class="dn">${hlPct(nl)}</b><span>at a new<br>low</span>${line(HL, 'l', '#b8574e', hlMax)}</div></div></div>` +
    `<div class="br"><div class="k">Volume in rising vs falling stocks</div><div class="v"><span class="up">${vfmt(uv)}</span> / <span class="dn">${vfmt(dv)}</span><small>shares</small></div>${split(uv, dv)}</div>`;
  /* expanded: breadth by sector */
  $('bfull').innerHTML = `<table class="st"><tr><th>Sector</th><th>Rising / falling today</th><th>Above 50-day</th><th>Above 200-day</th><th>New highs / lows</th><th>Sector fund today</th></tr>` +
    Object.keys(ETF).map((n) => {
      const l = (bySec[n] || []).filter((s) => s.d != null), u = l.filter((s) => s.d > 0).length, d = l.filter((s) => s.d < 0).length;
      return `<tr><td>${esc(n)}</td><td><span class="up">${u}</span> / <span class="dn">${d}</span><span class="mini">${`<i style="background:#3f9a74;width:${u / (u + d || 1) * 100}%"></i><i style="background:#b8574e;width:${d / (u + d || 1) * 100}%"></i>`}</span></td><td>${pf(pctOf(l, 'a50'))}</td><td>${pf(pctOf(l, 'a200'))}</td><td>${l.filter((s) => s.nh).length} / ${l.filter((s) => s.nl).length}</td><td class="${cls(D.etf[ETF[n]]?.d)}">${fp(D.etf[ETF[n]]?.d)}</td></tr>`;
    }).join('') + `</table><p class="note" style="margin-top:.6rem">Above-average and 52-week counts use Yahoo's own 50- and 200-day averages and 52-week ranges against the current price; moves and volume are the current session's and change until the 4:00 PM ET close.</p>`;
}

/* ---------- movers ---------- */
const MV = { m: S.mode, g: S.mode === 'cats' ? S.zoom : '' };   // which grouping the list follows, and which group in it ('' = all)
const mvPool = () => {
  if (MV.m === 'SPY') return { list: D.stocks, floor: true };
  if (MV.m === 'QQQ') { const q = new Set((P.etf?.qqq?.h || []).map((h) => ysym(h.t))); return { list: D.grp.filter((s) => q.has(ysym(s.s))), floor: true }; }
  const gs = groupsFor(MV.m) || [];
  if (!MV.g) return { list: gs.flatMap((g) => g.list), floor: MV.m === 'cats' || MV.m === 'sec' };
  const top = gs.find((g) => g.id === MV.g.split('/')[0]), sub = top?.subs.find((x) => x.id === MV.g);
  return { list: (MV.g.includes('/') ? sub : top)?.list || [], floor: false };
};
function drawMovers() {
  document.querySelectorAll('#mvmode button').forEach((x) => x.classList.toggle('on', x.dataset.m === MV.m));
  const sel = $('mvg'), gs = MV.m === 'cats' || MV.m === 'sec' ? groupsFor(MV.m) : null;
  sel.classList.toggle('on', !!gs);
  if (gs) { sel.innerHTML = `<option value="">All ${MV.m === 'cats' ? 'Cats' : 'GICS sectors'}</option>` + gs.map((g) => `<option value="${esc(g.id)}">${esc(g.name)}</option>` + g.subs.map((x) => `<option value="${esc(x.id)}">\u00a0\u00a0${esc(x.name)}</option>`).join('')).join(''); sel.value = MV.g; if (sel.value !== MV.g) { MV.g = ''; sel.value = ''; } }
  const seen = new Set(), pool = mvPool();
  const bigco = pool.list.filter((s) => s.d != null && (!pool.floor || (s.cap != null && s.cap >= 1e11))).sort((a, b) => b.d - a.d || sz(b) - sz(a)).filter((s) => { const k = s.co || s.s; if (seen.has(k)) return false; seen.add(k); return true; });
  const mrow = (s) => { const lg = logo(s.s); return `<div class="mr"${co(s.s)} title="${esc(s.n)} · ${money(s.cap)}${isMine(s.s) ? ' · click to open the company' : ''}"><div class="lg${lg ? '' : ' tx'}">${lg ? `<img src="${esc(lg)}" alt="">` : esc(s.s)}</div><div class="nm"><b>${esc(s.s)}</b>${esc(s.n)}</div><div class="v ${cls(s.d)}">${fp(s.d)}</div></div>`; };
  $('mvn').textContent = bigco.length + ' companies' + (pool.floor ? ' over $100B' : '');
  const k = bigco.length > 1 ? Math.min(5, Math.floor(bigco.length / 2)) : bigco.length;
  $('mv2').innerHTML = bigco.length ? `<div><h5>Up most</h5>${bigco.slice(0, k).map(mrow).join('')}</div><div><h5>Down most</h5>${bigco.length > 1 ? bigco.slice(-k).reverse().map(mrow).join('') : ''}</div>` : '<div class="msg">No priced companies in this group.</div>';
}
function followMap() { MV.m = S.mode; MV.g = S.mode === 'cats' ? S.zoom : ''; drawMovers(); }   // the list follows the heat map's grouping and zoom
$('mvmode').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; MV.m = b.dataset.m; MV.g = ''; drawMovers(); });
$('mvg').addEventListener('change', (e) => { MV.g = e.target.value; drawMovers(); });

/* ---------- interaction ---------- */
$('mode').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; if (S.mode !== b.dataset.m) S.zoom = ''; S.mode = b.dataset.m; if (isFund(S.mode)) S.p = 'd'; document.querySelectorAll('#per button').forEach((x) => x.classList.toggle('on', x.dataset.p === S.p)); save(); drawMap(); followMap(); });
document.addEventListener('click', (e) => { const c = e.target.closest('[data-co]'); if (c && c.dataset.co) location.href = MG.pageUrl(c.dataset.co); });
$('heat').addEventListener('click', (e) => { const z = e.target.closest('[data-z]'); if (!z) return; const v = z.dataset.z; if (v === '' && !S.zoom) return; if (v === S.zoom) return; S.zoom = v; save(); drawMap(); followMap(); });
function periodTips() {
  const R = P?.periodRefs || {}, fd = (d) => (d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null);
  [['w', R.w ? `1 week: from the close on ${fd(R.w)}, the last close at least 7 days before the latest session` : '1 week'], ['m', R.m ? `1 month: from the close on ${fd(R.m)}, the last close on or before the same date one month earlier` : '1 month'], ['y', 'Year to date: from the last close of the previous year']]
    .forEach(([k, t]) => { const b = document.querySelector(`#per button[data-p="${k}"]`); if (b) b.title = t; });
}
$('per').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; S.p = b.dataset.p; document.querySelectorAll('#per button').forEach((x) => x.classList.toggle('on', x === b)); save(); drawMap(); });
document.querySelectorAll('#per button').forEach((x) => x.classList.toggle('on', x.dataset.p === S.p));
function applyOpen() { const f = $('field'); f.className = 'field' + (S.open ? ' open-' + S.open : ''); ['heat', 'breadth'].forEach((t) => $(t).classList.toggle('open', S.open === t)); requestAnimationFrame(drawMap); }
document.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); S.open = S.open === b.dataset.x ? '' : b.dataset.x; save(); applyOpen(); }));
function save() { const h = Object.entries(S).filter(([k, v]) => v && !(k === 'p' && v === 'd') && !(k === 'mode' && v === 'cats')).map(([k, v]) => k + '=' + encodeURIComponent(v).replace(/%2F/g, '/')).join('&'); history.replaceState(null, '', '#' + h); }
function sizeBand() { const h = document.querySelector('.head').getBoundingClientRect(); document.body.style.setProperty('--bandh', (h.bottom + Math.max(18, h.height * .4)) + 'px'); }
addEventListener('resize', () => { sky(); drawMap(); sizeBand(); });

/* search: the profiled companies, same as the company page */
let sel = 0, hits = [];
(function setupSwitcher() {
  const q = $('q'), box2 = $('sugg');
  const show = () => {
    const s = q.value.trim().toUpperCase();
    if (!s) { box2.classList.remove('on'); return; }
    hits = COMPANIES.filter((c) => c.ticker.startsWith(s) || c.aliases.some((a) => a.startsWith(s))).concat(COMPANIES.filter((c) => !c.ticker.startsWith(s) && !c.aliases.some((a) => a.startsWith(s)) && c.name.toUpperCase().includes(s))).slice(0, 8);
    sel = 0;
    box2.innerHTML = hits.map((c, i) => `<a href="${MG.pageUrl(c.ticker)}" class="${i === sel ? 'sel' : ''}">${c.logo ? `<img src="${esc(c.logo)}" alt="">` : '<span class="nl"></span>'}<b>${esc(c.ticker)}</b><span>${esc(c.name)}</span></a>`).join('') || '<a><span></span><b></b><span>No match among the profiled companies</span></a>';
    box2.classList.add('on');
  };
  q.addEventListener('input', show);
  q.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sel = (sel + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % Math.max(1, hits.length); [...box2.children].forEach((a, i) => a.classList.toggle('sel', i === sel)); }
    else if (e.key === 'Enter' && hits[sel]) location.href = MG.pageUrl(hits[sel].ticker);
    else if (e.key === 'Escape') { q.value = ''; box2.classList.remove('on'); q.blur(); }
  });
  q.addEventListener('blur', () => setTimeout(() => box2.classList.remove('on'), 150));
  addEventListener('keydown', (e) => { if (e.key === '/' && document.activeElement.tagName !== 'INPUT') { e.preventDefault(); q.focus(); } });
})();

/* ---------- data ---------- */
function adopt(p) {
  P = p;
  D = { stocks: p.stocks || [], etf: p.sectors || {}, watch: p.watch || [], breadthHist: p.breadthHist || [] };   // a gap marker ({ d, gap: true }) has no values: a break in the chart
  GR = p.groupings || GR; GCACHE = {}; D.grp = [...D.stocks, ...(p.extra || [])];
  bySec = {}; D.stocks.forEach((s) => (bySec[s.sec] = bySec[s.sec] || []).push(s));
}
function render() {
  periodTips(); drawStatus(); drawWatch(); drawBreadth(); drawMovers(); sky(); drawMap();
}
async function fetchLive() {
  const url = MG.monitorUrl();
  if (url) {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) { if (!MG.isStatic) throw e; }
  }
  const b = await fetch(MG.monitorBakedUrl()).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  return { ...b, stale: true, baked: true };
}
let failing = false;
let bakedGr = null;
// The Cloudflare Worker leaves the grouping lists out of its answer to keep it small, so they are taken from the copy baked at publish.
async function groupingsFrom(p) {
  if (p.groupings || GR) return p.groupings || GR;
  const u = MG.monitorBakedUrl(); if (!u) return null;
  bakedGr ||= fetch(u).then((r) => (r.ok ? r.json() : null)).then((b) => b?.groupings || null).catch(() => null);
  const g = await bakedGr; if (!g) bakedGr = null; return g;
}
async function refresh() {
  try {
    const p = await fetchLive();
    if (!p || !Array.isArray(p.stocks)) throw new Error('unexpected answer');
    p.groupings = await groupingsFrom(p);
    failing = false; adopt(p); render();
  } catch (e) {
    if (P) { P = { ...P, stale: true }; drawStatus(); return; }
    failing = true;
    $('stat').className = 'stat pad bad';
    $('stat').innerHTML = `<i></i><span><b>No data</b> · the market data sources are not answering; retrying every minute</span>`;
    $('map').innerHTML = '<div class="msg">Market data is not available right now. This page retries every minute.</div>';
  }
}
(async () => {
  try {
    try { Object.assign(LOGOFILES, await fetch(MG.logosUrl()).then((r) => r.json())); } catch { /* grey ticker boxes instead */ }
    COMPANIES = await fetch(MG.companiesUrl()).then((r) => r.json());
    for (const c of COMPANIES) for (const t of [c.ticker, ...c.aliases]) { LINK.set(ysym(t), c.ticker); if (c.logo) LOGO.set(ysym(t), c.logo); }
  } catch { /* the page still works, without links and logos */ }
  sky(); sizeBand(); applyOpen();
  await refresh();
  setInterval(() => { if (!document.hidden) refresh(); }, 60_000);
})();
