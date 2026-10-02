/* Mowgli company page: renders /api/company/:ticker into the approved Deep Field tiles, then fills the
   price-dependent figures from /api/quote/:ticker. No mock data: a section without data does not appear,
   a missing figure shows as a dash, and every number carries its source on hover (title). */
(() => {
'use strict';
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const T = (s) => (s ? ` title="${esc(s)}"` : '');
// D89 accounting notes: at most two muted lines, the full sentence on hover; any beyond two ride on the last line's hover
const readerNotes = (list) => { const l = (list || []).slice(); if (!l.length) return ''; const shown = l.slice(0, 2); if (l.length > 2) shown[1] = { ...shown[1], title: l.slice(1).map((x) => x.title).join('\n\n') }; return shown.map((x) => `<div class="v-self note rnote"${T(x.title)}>ⓘ ${esc(x.text)}</div>`).join(''); };
const DASH = '<span class="dash">—</span>';
const ticker = MG.tickerFromPath();

/* ---------- formatting ---------- */
const SYM = { USD: '$', TWD: 'NT$', EUR: '€', GBP: '£', CAD: 'C$', JPY: '¥' };
function money(v, cur = 'USD') {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const s = SYM[cur] ?? cur + ' ', a = Math.abs(v), neg = v < 0 ? '−' : '';
  let t;
  if (a >= 1e12) t = (a / 1e12).toFixed(2) + 'T';
  else if (a >= 1e11) t = (a / 1e9).toFixed(0) + 'B';
  else if (a >= 1e10) t = (a / 1e9).toFixed(1) + 'B';
  else if (a >= 1e9) t = (a / 1e9).toFixed(2) + 'B';
  else if (a >= 1e8) t = (a / 1e6).toFixed(0) + 'M';
  else if (a >= 1e6) t = (a / 1e6).toFixed(1) + 'M';
  else if (a >= 1e3) t = (a / 1e3).toFixed(0) + 'K';
  else t = a.toFixed(0);
  return neg + s + t;
}
const perShare = (v, cur = 'USD') => (typeof v === 'number' ? (v < 0 ? '−' : '') + (SYM[cur] ?? cur + ' ') + Math.abs(v).toFixed(2) : null);
const pct = (p, dp = 1) => (typeof p === 'number' && Number.isFinite(p) ? (p < 0 ? '−' : '') + Math.abs(p).toFixed(Math.abs(p) >= 100 ? 0 : dp) + '%' : null);
const spct = (p, dp = 1) => (typeof p === 'number' ? (p > 0 ? '+' : '') + pct(p, dp) : null);
const cls = (p) => (typeof p === 'number' ? (p > 0 ? 'up' : p < 0 ? 'dn' : '') : '');
const shortDate = (d) => { const t = Date.parse(d); return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : d; };
function growthHtml(g, cur, extraTitle = '') {
  if (!g) return DASH;
  if (g.nm) return `<span${T('n.m. (not meaningful): ' + (g.reason || '') + (extraTitle ? '\n' + extraTitle : ''))}>n.m.</span>`;
  if (g.words) return `<span${T(`Change ${money(g.change, cur) || g.change}${extraTitle ? '\n' + extraTitle : ''}`)}>${esc(g.words)}</span>`;
  return `<span class="${cls(g.pct)}"${T(extraTitle)}>${spct(g.pct)}</span>`;
}
const firstSentence = (s) => { if (!s) return ''; const m = s.match(/^(.{40,}?[.!?])\s/); return m ? m[1] : s; };

/* ---------- colours: the design's Deep Field sky, keyed on sector and the logo's own colour ---------- */
const SECTORS = {
  travel: { sp: '#120b16', c: ['#7a3450', '#1f6070', '#8a4a26'], dust: '#ffc49a' },
  semis: { sp: '#04100f', c: ['#0e6258', '#1f3596', '#3a2a8a'], dust: '#8ff0dc' },
  telecom: { sp: '#070b1c', c: ['#1c4a92', '#0e6a82', '#46287e'], dust: '#9fd4ff' },
  staples: { sp: '#100b06', c: ['#7a5222', '#2f5a33', '#6a2e1c'], dust: '#ffd79a' },
  default: { sp: '#08091a', c: ['#2c2e6a', '#302056', '#18345e'], dust: '#aa96ff' } };
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => { const A = hex(a), B = hex(b); return '#' + A.map((v, i) => Math.round(v * (1 - t) + B[i] * t).toString(16).padStart(2, '0')).join(''); };
function stars(cv, n, col, maxA, maxR, seed) {
  const W = cv.width = innerWidth, Hh = cv.height = innerHeight, x = cv.getContext('2d'); x.clearRect(0, 0, W, Hh);
  const [r, g, b] = hex(col), c = r + ',' + g + ',' + b; let s = seed; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647; const N = Math.round(n * W * Hh / (2560 * 1300));
  for (let i = 0; i < N; i++) {
    const px = rnd() * W, py = rnd() * Hh, rad = Math.pow(rnd(), 3) * maxR + .35, a = (.15 + rnd() * .85) * maxA;
    x.beginPath(); x.arc(px, py, rad, 0, 6.283); x.fillStyle = 'rgba(' + c + ',' + a.toFixed(3) + ')'; x.fill();
    if (rad > maxR * .7) { const gr = x.createRadialGradient(px, py, 0, px, py, rad * 5); gr.addColorStop(0, 'rgba(' + c + ',' + (a * .35).toFixed(3) + ')'); gr.addColorStop(1, 'rgba(' + c + ',0)'); x.fillStyle = gr; x.beginPath(); x.arc(px, py, rad * 5, 0, 6.283); x.fill(); }
  }
}
let DUST = '#aa96ff';
function applyTheme(theme) {
  const sec = SECTORS[theme.sky] || SECTORS.default, fam = theme.brand || sec.c[0], hint = sec.c[0];
  const c = [mix(mix(fam, hint, .12), '#05060d', .5), mix(fam, '#05060d', .66), mix(mix(fam, hint, .2), '#05060d', .74)];
  const r = document.body.style;
  DUST = mix(fam, '#ffffff', .45);
  r.setProperty('--sp', mix(fam, '#04050a', .93)); ['--c1', '--c2', '--c3'].forEach((k, i) => r.setProperty(k, c[i]));
  r.setProperty('--tint', fam); r.setProperty('--dust', DUST); r.setProperty('--brand', fam);
  // accent (dates, chips) lifted until it reads on the dark cards: relative luminance at least 0.30
  const lum = (h) => hex(h).map((v) => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }).reduce((a, v, i) => a + v * [.2126, .7152, .0722][i], 0);
  let acc = fam; for (let k = 1; lum(acc) < .30 && k <= 10; k++) acc = mix(fam, '#ffffff', k * .08);
  r.setProperty('--acc', acc);
  r.setProperty('--op', .56); r.setProperty('--bop', .35);
  drawStars();
}
function drawStars() { stars($('#st1'), 1400, mix('#dce1ff', DUST, .15), .7, 1.4, 11); stars($('#st2'), 120, mix('#fff5e1', DUST, .25), .9, 2.0, 29); }
function sizeBand() { const h = $('.head').getBoundingClientRect(); document.body.style.setProperty('--bandh', (h.bottom + Math.max(18, h.height * .28)) + 'px'); }

/* ---------- D90 switchboard: what each box draws (public/lib/switchboard.mjs resolves Adam's switches) ----------
   S.st(id, d) is 'MAIN' (the box's main view), 'ON' (the expanded view only) or null (not drawn). d is the day-one
   state written at each call site: it is used only when the switchboard could not be loaded, so the page then draws
   the day-one defaults (with a small notice) instead of a blank. */
let SB = null, SBLIB = null, SBERR = null, S = null;
// slots the live price fills: drawn with a dash even when the payload has no data for them (absentFrom calls them absent)
const ALWAYS = ['marketValue', 'dividendYield', 'buybackYield', 'sharesValue.marketValueLine'];
const DAY_ONE_BOXES = ['company', 'cls', 'money', 'next', 'brands', 'fin', 'val', 'geo', 'earn'];
let SBSEQ = 0, SBSTALE = null; // SBSTALE: why the last refresh failed while earlier switches are still in use
async function loadSwitchboard() {
  const seq = ++SBSEQ;
  try {
    const [lib, r] = await Promise.all([import(MG.base + 'lib/switchboard.mjs'), fetch(MG.switchboardUrl(), { cache: 'no-store' })]);
    const j = await r.json();
    if (!r.ok || !j?.catalogLite || !j?.settings) throw new Error(j?.error?.message || `switchboard answered ${r.status}`);
    if (seq !== SBSEQ) return false; // a newer request is under way
    SBLIB = lib; SB = j; SBERR = null; SBSTALE = null;
  } catch (e) {
    if (seq !== SBSEQ) return false;
    if (SB) SBSTALE = e.message || String(e); // keep the last good switches
    else SBERR = e.message || String(e);
  }
  return true;
}
function fallbackSel(why) {
  return { fallback: true, why, st: (id, d) => d, form: (id, d) => d, box: () => true, asks: () => true, peek: (id, d) => d, sort: (ids) => ids,
    order: DAY_ONE_BOXES, pin: (id) => (id === 'cls' ? 'company' : null), headline: [], label: (id) => id };
}
function selection(c) {
  if (!SB || !SBLIB) return fallbackSel(SBERR || 'not loaded');
  try {
    const cat = SB.catalogLite;
    const res = SBLIB.resolve(cat, SB.settings, { type: c.type, absent: SBLIB.absentFrom(cat, c).filter((id) => !ALWAYS.includes(id)) });
    const intent = SBLIB.resolve(cat, SB.settings, { type: c.type }); // what the settings ask for before the company's data is consulted
    const st = new Map(), forms = {}, bx = new Map(), rank = new Map();
    for (const b of res.boxes) {
      bx.set(b.id, b); Object.assign(forms, b.forms);
      b.main.forEach((id) => st.set(id, 'MAIN')); b.on.forEach((id) => st.set(id, 'ON'));
      [...b.main, ...b.on].forEach((id, i) => rank.set(id, i));
    }
    const known = new Map(cat.metrics.map((m) => [m.id, m]));
    const asked = new Set(intent.boxes.map((b) => b.id));
    return {
      fallback: false,
      st: (id, d) => (known.has(id) ? st.get(id) || null : d), // an id the catalog does not know keeps its day-one state
      form: (id, d) => forms[id] ?? d,
      box: (id) => bx.get(id) || null,
      asks: (id) => asked.has(id),
      peek: (id) => bx.get(id)?.peek || [],
      sort: (ids) => [...ids].sort((a, b) => (rank.get(a) ?? 1e9) - (rank.get(b) ?? 1e9)),
      order: intent.boxes.map((b) => b.id).filter((id) => id !== 'hero'), // a box the settings ask for may still draw a note (Valuation not computed)
      pin: (id) => bx.get(id)?.pin ?? null,
      headline: res.headline,
      label: (id) => known.get(id)?.label || id,
    };
  } catch (e) { return fallbackSel(e.message || String(e)); }
}
// an item switched ON (expanded view only) is drawn in its usual place but hidden until the box is expanded
const xo = (html) => (html ? `<div class="xo">${html}</div>` : '');
// whether a box draws its usual peek: the peek names one of its items, or the box is slim, so its one collapsed line
// falls to the ON items, which carry the same figures
// (src: the items whose data that peek shows; the slim fallback uses it only when one of them is not OFF)
const natPeek = (box, ids, slim, src = ids) => S.peek(box, ids).some((id) => ids.includes(id)) || (slim && src.some((id) => S.st(id, 'MAIN')));
// the resolver's peek items this box does not draw natively (a fall-through to another item), as short figures
const xPeek = (c, box, ids, own) => [own, ...S.peek(box, ids).filter((id) => !ids.includes(id)).map((id) => peekPart(c, id))].filter(Boolean).join(' · ');
const put = (state, html) => (!html || !state ? '' : state === 'ON' ? xo(html) : html);

/* ---------- tiles ---------- */
const XP ='<button class="xp" aria-label="Expand"><svg viewBox="0 0 16 16"><path class="o" d="M9 2h5v5M7 14H2V9M14 2 9.5 6.5M2 14l4.5-4.5"/><path class="c" d="M10 6h4M6 10H2M10 6V2M6 10v4"/></svg></button>';
const CHIP = { company: 'Company ›', money: 'Business ›', brands: 'Brands ›', val: 'Valuation ›', geo: 'Regions ›', fin: 'Financials ›', earn: 'Earnings ›', next: 'Plans ›' };
// slim: the box has nothing in its main view (only items switched ON): header, chip and peek, and it still expands
const tile = (id, label, peek, std, full, door = '', slim = false) =>
  `<section class="tile ${id}${slim ? ' slim' : ''}" data-id="${id}"><div class="in"><div class="th"><div class="lbl">${label}</div><div class="doorl">${door}<span class="door xpl" title="Expand">${CHIP[id]}</span></div>${XP}</div><div class="peek">${peek}</div><div class="body"><div class="std${id === 'company' ? ' bsx' : ''}">${std}</div><div class="full">${full}</div></div></div></section>`;
const kv = (label, val, note = '', title = '') => (val ? `<div class="kv"${T(title)}><span>${label}</span><b>${val}</b><i>${note}</i></div>` : '');
const sec = (h, inner) => (inner ? `<div class="sec">${h ? `<h5>${h}</h5>` : ''}${inner}</div>` : '');

function profileSrc(c, extra) {
  return [extra, c.profileReviewed && `Company profile (data/companies/${c.ticker}/profile.json), reviewed ${c.profileReviewed}${c.profileAgainst ? ' against ' + c.profileAgainst : ''}`].filter(Boolean).join('\n');
}

function basicsTile(c) {
  if (!S.box('company')) return '';
  const tick = [c.displayTicker, c.exchange].filter(Boolean).join(' · ');
  const classes = c.classTickers ? `<p class="bcl">Several share classes, one company: <b>${c.classTickers.map(esc).join(', ')}</b></p>` : '';
  const vi = c.valuationInputs, sh = vi.shares;
  const gc = (label, val, title = '') => (val ? `<div${T(title)}><span>${label}</span><b>${val}</b></div>` : '');
  const live = (id, label, val, note = '') => ({ grid: `<div id="${id}"><span>${label}</span><b>${val}</b></div>`, row: `<div class="kv" id="${id}"><span>${label}</span><b>${val}</b><i>${note}</i></div>` });
  const site = c.website ? `<a href="${esc(c.website)}" target="_blank" rel="noopener" style="color:var(--accx)">${esc(c.website.replace(/^https?:\/\/(www\.)?/, ''))}</a>` : '';
  const shv = sh ? (sh.value / 1e6).toLocaleString('en-US', { maximumFractionDigits: 1 }) + 'M' : '';
  const shT = sh ? `${sh.combined ? sh.combined + '\n' : ''}${sh.source.form} filed ${sh.source.filed} · accession ${sh.source.accn} · ${sh.source.tag || ''}` : '';
  const hqT = profileSrc(c, c.hq?.note);
  const hqV = c.hq ? esc(c.hq.text) : '';
  const longDesc = c.description && c.description !== firstSentence(c.description);
  const dd = vi.declaredDividend;
  // filing names never break across lines (10‑Q, not "10-" then "Q")
  const nb = (s) => (s ? s.replace(/\b(10|20|8|6)-(K|Q|F)\b/g, '$1‑$2') : s);
  const auth = nb(vi.authorisationText);
  // long prose fields get a short main-view form; the prose itself goes to the expanded view
  const fyeShort = c.fiscalYearEnd ? c.fiscalYearEnd.split(/\s*[(;]/)[0] : '';
  // the short form only from the parsed authorisation (remaining amount at its latest as-of date, with an expiry;
  // server/lib/metrics.js parseAuthorisation); without it, no short form and the text stays in the expanded view
  const pa = vi.authorisation;
  const authShort = pa && typeof pa.amount === 'number' ? money(pa.amount) : '';
  const authTitle = pa ? `Remaining at ${pa.asOf}${pa.expiry ? ', expires ' + pa.expiry : ''}\nCompany profile: ${vi.authorisationText || ''}` : '';
  // every Basics item: its group, its day-one state, its cell in the main grid and its row in the expanded view
  // (long: too long for a grid cell, so its row is drawn in the main view too)
  const I = {
    marketValue: { g: 'sharesValue', d: 'MAIN', ...live('v-mv', 'Market value', DASH, 'at today\'s price') },
    hq: { g: 'identity', d: 'MAIN', grid: c.hq ? `<div${T(hqT)}><span>Headquarters</span><b>${hqV}</b></div>` : '', row: kv('Headquarters', hqV, '', hqT) },
    dividendYield: { g: 'sharesValue', d: 'MAIN', ...live('v-dy', 'Dividend yield', DASH) },
    buybackYield: { g: 'sharesValue', d: 'MAIN', ...live('v-by', 'Buyback yield<em class="lx">, past / next 12m</em>', `${DASH} / ${DASH}`) },
    legalName: { g: 'identity', d: 'ON', grid: gc('Legal name', esc(c.legalName), c.cik ? 'CIK ' + c.cik : ''), row: kv('Legal name', esc(c.legalName), c.cik ? 'CIK ' + esc(c.cik) : '') },
    'identity.exchangeTicker': { g: 'identity', d: 'ON', grid: gc('Exchange · ticker', esc(tick)), row: kv('Exchange · ticker', esc(tick), c.classTickers ? 'classes: ' + esc(c.classTickers.join(', ')) : '') },
    fiscalYearEnd: { g: 'identity', d: 'ON', grid: fyeShort !== c.fiscalYearEnd ? gc('Fiscal year ends', esc(fyeShort), c.fiscalYearEnd) : gc('Fiscal year ends', esc(c.fiscalYearEnd)), row: kv('Fiscal year ends', esc(c.fiscalYearEnd)), prose: fyeShort !== c.fiscalYearEnd },
    founded: { g: 'identity', d: 'ON', grid: gc('Founded', c.founded ? esc(c.founded.value) : '', profileSrc(c)), row: kv('Founded', c.founded ? esc(c.founded.value) : '', 'profile', profileSrc(c)) },
    employees: { g: 'identity', d: 'ON', grid: gc('Employees', c.employees ? c.employees.value.toLocaleString('en-US') : '', profileSrc(c, c.employees?.note)), row: kv('Employees', c.employees ? c.employees.value.toLocaleString('en-US') : '', c.employees?.asOf ? 'as of ' + esc(c.employees.asOf) : '', profileSrc(c, c.employees?.note)) },
    website: { g: 'identity', d: 'ON', grid: gc('Website', site), row: kv('Website', site) },
    'identity.hq': { g: 'identity', d: 'ON', grid: gc('Headquarters', hqV, hqT), row: kv('Headquarters', hqV, '', hqT) },
    sharesOutstanding: { g: 'sharesValue', d: 'ON', grid: gc('Shares outstanding', shv, shT), row: sh ? kv(`Shares outstanding, ${esc(shortDate(sh.date))}`, shv, esc(sh.source.form || ''), shT) : '' },
    sharesPerADS: { g: 'sharesValue', d: 'ON', grid: gc('Shares per ADS', vi.sharesPerADS ? String(vi.sharesPerADS) : '', vi.adsNote || ''), row: vi.sharesPerADS ? kv('Shares per ADS', String(vi.sharesPerADS), 'filing', vi.adsNote || '') : '' },
    'sharesValue.marketValueLine': { g: 'sharesValue', d: 'ON', long: true, row: `<div id="v-mvline">${kv('Market value: today’s price × shares', DASH, 'computed')}</div>` },
    dividendDeclared: { g: 'sharesValue', d: 'ON', long: true, row: dd ? kv(`Dividend declared: $${dd.annual.toFixed(2)} a year per share${dd.quarterly ? ` ($${dd.quarterly.toFixed(2)} a quarter)` : ''}`, '<span id="v-dy2">—</span>', 'at today\'s price', dd.source) : '' },
    buybackAuthorisation: { g: 'sharesValue', d: 'ON', long: !authShort, prose: !!authShort, grid: authShort ? gc('Buyback authorisation', esc(authShort), authTitle) : '', row: auth ? `<div class="kv"${T('Company profile: ' + auth)}><span>Buyback authorisation: ${esc(auth.length > 160 ? auth.slice(0, 157) + '…' : auth)}</span><b></b><i>profile</i></div>` : '' },
    'about.descriptionFull': { g: 'about', d: 'ON', long: true, row: longDesc ? `<div class="note" style="font-size:.84em;color:var(--ink2)">${esc(c.description)}</div>` : '' },
  };
  // the same figure switched on twice in one view (settings that overlap) is drawn once, in its richer form
  const DUP = { 'identity.hq': 'hq', marketValue: 'sharesValue.marketValueLine' };
  const state0 = (id) => S.st(id, I[id].d);
  const state = (id) => { const s = state0(id); return s && DUP[id] && state0(DUP[id]) === s && I[DUP[id]].row ? null : s; };
  const ids = Object.keys(I).filter(state);
  const mainIds = S.sort(ids.filter((id) => state(id) === 'MAIN'));
  const gridIds = mainIds.filter((id) => !I[id].long && I[id].grid);
  const rowIds = mainIds.filter((id) => (I[id].long || !I[id].grid) && I[id].row);
  // the ticker line and the first sentence of the description head the main view (each dropped when its fuller
  // form, the exchange · ticker field or the whole description, is switched into the same view)
  let tk = S.st('exchangeTicker', 'MAIN'), ds = c.description ? S.st('description', 'MAIN') : null;
  if (tk && state('identity.exchangeTicker') === tk) tk = null;
  if (ds && longDesc && state('about.descriptionFull') === ds) ds = null;
  // a value too long for its cell spans two columns
  const span = (h) => (gridIds.length > 4 && ((/<b>([\s\S]*?)<\/b><\/div>$/.exec(h)?.[1] || '').replace(/<[^>]+>/g, '').length > 18) ? h.replace(/^<div/, '<div style="grid-column:span 2"') : h);
  const bidIn = put(tk, `<p class="btk">${esc(tick)}</p>${classes}`) + put(ds, `<p${T(profileSrc(c))}>${esc(firstSentence(c.description))}</p>`);
  // the day-one grid (market value, headquarters, dividend yield, buyback yield) keeps its tuned column widths;
  // any other set of fields gets n even columns up to four, and three columns (several rows) beyond that
  const dayOne = gridIds.join() === (c.hq ? 'marketValue,hq,dividendYield,buybackYield' : 'marketValue,dividendYield,buybackYield');
  const grid = gridIds.length ? `<div class="sg b4${dayOne ? '' : ' bn'}"${dayOne ? '' : ` style="--n:${gridIds.length > 4 ? 3 : gridIds.length}"`}>${gridIds.map((id) => span(I[id].grid)).join('')}</div>` : '';
  const rows = rowIds.map((id) => I[id].row).join('');
  const std = (bidIn ? `<div class="bid"><div>${bidIn}</div></div>` : '') + (grid ? `
    ${grid}` : '') + (rows ? `<div class="bxr">${rows}</div>` : '');
  const onIds = S.sort(ids.filter((id) => state(id) === 'ON'));
  // a prose field shown short in the main view keeps its full text in the expanded view
  const prose = gridIds.filter((id) => I[id].prose);
  const grp = (g) => S.sort([...onIds, ...prose]).filter((id) => I[id].g === g).map((id) => I[id].row || '').join('');
  const full = sec('Identity', grp('identity')) + sec('Shares &amp; value', grp('sharesValue')) + sec('What it does', grp('about'));
  // peek: headquarters (or the ticker) until the price arrives, then the market value in front of it
  const P = S.peek('company', ['hq', 'marketValue']);
  const extra = P.filter((id) => id !== 'hq' && id !== 'marketValue').map((id) => peekPart(c, id)).filter(Boolean);
  const head = P.includes('hq') && c.hq ? hqV : P.includes('hq') || P.includes('marketValue') ? esc(c.displayTicker) : '';
  let peekTxt = [head, ...extra].filter(Boolean).join(' · ');
  // a box with nothing in its main view still says something collapsed: the headquarters or the ticker
  if (!peekTxt && !(tk === 'MAIN' || ds === 'MAIN' || gridIds.length || rowIds.length)) peekTxt = (['hq', 'identity.hq'].some((id) => S.st(id, 'MAIN')) && hqV) || esc(c.displayTicker);
  BASICS_PEEK = { mv: P.includes('marketValue'), hq: P.includes('hq') && !!c.hq, extra: extra.join(' · ') };
  const hasMain = tk === 'MAIN' || ds === 'MAIN' || !!gridIds.length || !!rows;
  return tile('company', 'Basics', peekTxt ? `<span id="v-peek">${peekTxt}</span>` : '', std, full, '', !hasMain);
}
let BASICS_PEEK = { mv: true, hq: false, extra: '' };

/* D87: Mowgli's own Cat and Sub (each linking to its place on the List page), the conventional GICS label, and up to five companies of the same Sub.
   The box does not expand, so an item switched ON is drawn like a MAIN one. */
function classTile(c) {
  const k = c.classification;
  if ((!k && !c.gics) || !S.box('cls')) return '';
  const on = (id) => !!S.st(id, 'MAIN');
  const list = MG.isStatic ? `${MG.base}list/` : '/list';
  const link = (x, what) => `<a href="${list}#${esc(x.anchor)}"${T(`Show ${what} on the List page`)}>${esc(x.name)}</a>`;
  const row = (l, v, t = '') => `<div class="kv2"${T(t)}><span>${l}</span><b>${v}</b></div>`;
  const rows = [
    k && on('cat') && row('Cat', link(k.cat, 'this Cat')),
    k?.sub && on('sub') && row('Sub', link(k.sub, 'this Sub')),
    c.gics && on('gics') && row('GICS', `${esc(c.gics.sector)}${c.gics.industry ? ' › ' + esc(c.gics.industry) : ''}`, c.gics.note ? c.gics.note : 'Conventionally filed as (GICS)'),
  ].filter(Boolean).join('');
  const peers = k?.peers?.length && on('subPeers') ? `<div class="kv2 pr2"><span>Peers</span><div class="peers">${k.peers.map((p) => `<span class="pe"${T(p.ticker)}>${p.logo ? `<img src="${esc(MG.logoBase + p.logo.replace(/^\/logos\//, ''))}" alt="">` : '<i></i>'}<em>${esc(p.name)}</em></span>`).join('')}</div></div>` : '';
  if (!rows && !peers) return '';
  return `<section class="tile cls"><div class="in"><div class="th"><div class="lbl">Classification</div></div><div class="cbody">${rows}${peers}</div></div></section>`;
}

const SW = ['#6f7fd8', '#3f9fb4', '#5fae7d', '#e0a34a', '#c77d9a', '#b08a3e', '#8f7fd0', '#a6a3b8'];
function moneyTile(c) {
  const bl = c.businessLines;
  if (!bl.length || !S.box('money')) return '';
  const sLines = S.st('businessLines', 'MAIN'), sFig = S.st('businessLineFigures', 'ON');
  const lineSrc = (b) => profileSrc(c, [b.revenue && `Revenue ${money(b.revenue.amount, b.revenue.currency)}${b.revenue.period ? ', ' + b.revenue.period : ''}`, b.revenueNote, b.shareBasis, b.source].filter(Boolean).join(' · '));
  const groups = [];
  for (const b of bl) { let g = groups.find((x) => x.key === (b.group || '')); if (!g) groups.push(g = { key: b.group || '', lines: [] }); g.lines.push(b); }
  const block = (lines, key) => {
  const withShare = lines.filter((b) => typeof b.share?.fraction === 'number' && b.share.fraction > 0);
  const bar = withShare.length ? `<div class="tbar">${withShare.map((b, i) => `<div style="flex:${b.share.fraction};background:${SW[i % SW.length]}"${T(b.name + ': ' + pct(b.share.fraction * 100, 0) + ' of revenue\n' + lineSrc(b))}>${b.share.fraction >= .08 ? pct(b.share.fraction * 100, 0) : ''}</div>`).join('')}</div>` : '';
  const rows = lines.map((b) => {
    const i = withShare.indexOf(b);
    const sw = i >= 0 ? `<span class="tsw" style="background:${SW[i % SW.length]};display:inline-block;width:.7em;height:.7em;border-radius:3px;margin-right:.45em"></span>` : '';
    const share = b.share?.fraction != null ? pct(b.share.fraction * 100, 0) : b.share?.text ? esc(b.share.text) : DASH;
    return `<tr${T(lineSrc(b))}><td class="wrap">${sw}${esc(b.name)}${b.how ? `<div class="bl-how">${b.how.length > 170 ? `<span class="sh">${esc(b.how.slice(0, 167))}…</span><span class="lg">${esc(b.how)}</span>` : esc(b.how)}</div>` : ''}</td><td class="n"><b>${share}</b></td></tr>`;
  }).join('');
  return `<div>${key ? `<h5>${esc(key.replace(/^by /i, 'By '))}</h5>` : ''}${bar}<table class="hk ut"><tr><th>Business line</th><th class="n">% of revenue</th></tr>${rows}</table></div>`;
  };
  const withShare = bl.filter((b) => typeof b.share?.fraction === 'number' && b.share.fraction > 0 && (b.group || '') === groups[0].key);
  const std = put(sLines, groups.map((g) => block(g.lines, groups.length > 1 ? g.key || 'Other lines' : '')).join('<div style="height:1.1em"></div>'));
  const frows = bl.map((b) => {
    const rev = b.revenue ? `<span${T(lineSrc(b))}>${money(b.revenue.amount, b.revenue.currency)}</span>${b.revenue.period ? `<small>${esc(b.revenue.period)}</small>` : ''}` : DASH;
    const op = b.operatingProfit ? `<span${T(profileSrc(c, [b.operatingProfit.label, b.operatingProfit.period, b.operatingProfit.note].filter(Boolean).join(' · ')))}>${money(b.operatingProfit.amount, b.operatingProfit.currency)}</span>${b.operatingProfit.label ? `<small>${esc(b.operatingProfit.label)}</small>` : ''}` : DASH;
    const mg = b.margin ? `<span${T(profileSrc(c, b.margin.label))}>${pct(b.margin.fraction * 100)}</span>` : DASH;
    return `<tr><td class="wrap">${esc(b.name)}${b.description ? `<div class="bl-how">${esc(b.description)}</div>` : ''}</td><td class="n">${rev}</td><td class="n">${op}</td><td class="n">${mg}</td><td class="wrap">${b.marketShare ? esc(b.marketShare) : DASH}</td></tr>`;
  }).join('');
  const full = !sFig ? '' : sec('Each line in figures (company profile)', `<table class="tt ut"><tr><th>Line</th><th class="n">Revenue</th><th class="n">Operating profit</th><th class="n">Margin</th><th>Market share</th></tr>${frows}</table>`);
  const top = withShare.slice().sort((a, b) => b.share.fraction - a.share.fraction)[0];
  const peek0 = !natPeek('money', ['businessLines'], sLines !== 'MAIN', ['businessLines', 'businessLineFigures']) ? '' : top ? `<b>${esc(top.name)}</b> ${pct(top.share.fraction * 100, 0)} of revenue` : `${bl.length} business line${bl.length > 1 ? 's' : ''}`;
  const peek = xPeek(c, 'money', ['businessLines'], peek0);
  return tile('money', 'How it makes money', peek, std, full, '', sLines !== 'MAIN');
}

function brandsTile(c) {
  const br = c.brands;
  if (!br.length || !S.box('brands')) return '';
  const sMain = S.st('brands', 'MAIN'), sAll = S.st('brandsAll', 'ON');
  const short = (s) => (s ? s.split(/;\s/)[0] : '');
  const src = (b) => profileSrc(c, [b.share, b.note, b.source].filter(Boolean).join(' · '));
  // a column no brand has a value for is not drawn
  const anyShare = br.some((b) => b.share), anyPart = br.some((b) => b.segment), anyNote = br.some((b) => b.note);
  const part = (b) => (anyPart ? `<td class="wrap">${esc(b.segment || '')}</td>` : '');
  const rows = br.slice(0, 12).map((b) => `<tr${T(src(b))}><td>${esc(b.name)}</td>${part(b)}${anyShare ? `<td class="wrap">${b.share ? esc(short(b.share)) : DASH}</td>` : ''}</tr>`).join('');
  const std = put(sMain, `<div><table class="hk"><tr><th>Brand or subsidiary</th>${anyPart ? '<th>Part of</th>' : ''}${anyShare ? '<th>Share</th>' : ''}</tr>${rows}</table>${br.length > 12 ? `<div class="note" style="margin-top:.4em">${br.length - 12} more on expand</div>` : ''}</div>`);
  const frows = br.map((b) => `<tr${T(src(b))}><td>${esc(b.name)}</td>${part(b)}${anyShare ? `<td class="wrap">${b.share ? esc(b.share) : DASH}</td>` : ''}${anyNote ? `<td class="wrap">${esc(b.note || '')}</td>` : ''}</tr>`).join('');
  const full = !sAll ? '' : sec('Every brand and subsidiary (company profile)', `<table class="tt"><tr><th>Name</th>${anyPart ? '<th>Part of</th>' : ''}${anyShare ? '<th>Share</th>' : ''}${anyNote ? '<th>Note</th>' : ''}</tr>${frows}</table>`);
  const peek = br.slice(0, 3).map((b) => `<b>${esc(b.name)}</b>`).join(' · ') + (br.length > 3 ? ` +${br.length - 3}` : '');
  return tile('brands', 'Brands &amp; subsidiaries', xPeek(c, 'brands', ['brands'], natPeek('brands', ['brands'], sMain !== 'MAIN', ['brands', 'brandsAll']) ? peek : ''), std, full, '', sMain !== 'MAIN');
}

function spark(series, fmt, cur) {
  if (!series || !series.some(Boolean)) return '';
  const vals = series.map((x) => (x ? x.v : null)), got = vals.filter((v) => v != null);
  const mx = Math.max(...got, 0), mn = Math.min(...got, 0);
  return `<div class="spk">${vals.map((v, i) => v == null ? `<i style="height:0;background:none"${T('missing')}></i>` : `<i style="height:${Math.max(6, (v - mn) / (mx - mn || 1) * 100)}%${v < 0 ? ';background:color-mix(in oklab,var(--dn) 55%,transparent)' : ''}"${T((series[i].src ? '' : '') + fmt(v, cur) + (series[i].src ? '\n' + series[i].src : ''))}></i>`).join('')}</div>`;
}

/* Financials tile cells (server/lib/fin_cells.js): bars with a zero line, so a negative value hangs below it */
const fmtUnit = (u, v, cur) => (u === 'pct' ? pct(v) : u === 'perShare' ? perShare(v, cur) : money(v, cur));
function bars(points, fmt, kind) {
  const vals = (points || []).map((p) => (typeof p.v === 'number' ? p.v : null)), got = vals.filter((v) => v != null);
  if (!got.length) return '';
  const mx = Math.max(...got, 0), mn = Math.min(...got, 0), rg = mx - mn || 1, z = (mx / rg) * 100;
  const last = vals.length - 1;
  const slot = (p, i) => {
    const v = vals[i], tip = `${p.p}${p.k || kind ? ' · ' + (p.k || kind) : ''}\n${v != null ? fmt(v) : p.nm ? 'n.m.' + (p.reason ? ': ' + p.reason : '') : p.note || 'not in the filings data'}${v != null && p.note ? '\n' + p.note : ''}`;
    if (v == null) return `<s class="ms"${T(tip)}></s>`;
    const top = v >= 0 ? z - (v / rg) * 100 : z, h = Math.abs(v) / rg * 100;
    return `<s${T(tip)}><i class="${v < 0 ? 'ng' : ''}${i === last ? ' cu' : ''}" style="top:${top.toFixed(1)}%;height:${h.toFixed(1)}%"></i></s>`;
  };
  return `<div class="fsp">${mn < 0 ? `<u style="top:${z.toFixed(1)}%"></u>` : ''}${points.map(slot).join('')}</div>`;
}
// the rolling-TTM line of the expanded view: segments break where a TTM is missing; hover any slot for its value
function tline(points, fmt) {
  const vals = (points || []).map((p) => (typeof p.v === 'number' ? p.v : null)), got = vals.filter((v) => v != null);
  if (!got.length) return '';
  // scaled to its own range (a line needs no zero base), but never stretched over less than a fifth of its size, so a flat series stays flat
  let mx = Math.max(...got), mn = Math.min(...got);
  const need = .2 * Math.max(Math.abs(mx), Math.abs(mn)), mid = (mx + mn) / 2;
  if (mx - mn < need) { mx = mid + need / 2; mn = mid - need / 2; }
  const rg = mx - mn || 1, n = vals.length;
  const X = (i) => ((i + .5) / n) * 100, Y = (v) => 2 + (1 - (v - mn) / rg) * 36;
  const segs = []; let run = [];
  vals.forEach((v, i) => { if (v == null) { if (run.length) segs.push(run); run = []; } else run.push([X(i), Y(v)]); });
  if (run.length) segs.push(run);
  const lines = segs.map((sg) => (sg.length > 1 ? `<polyline points="${sg.map(([a, b]) => a.toFixed(2) + ',' + b.toFixed(2)).join(' ')}"/>` : `<line x1="${(sg[0][0] - .8).toFixed(2)}" x2="${(sg[0][0] + .8).toFixed(2)}" y1="${sg[0][1].toFixed(2)}" y2="${sg[0][1].toFixed(2)}"/>`)).join('');
  const zero = mn < 0 && mx > 0 ? `<line class="z" x1="0" x2="100" y1="${Y(0).toFixed(2)}" y2="${Y(0).toFixed(2)}"/>` : '';
  const hov = points.map((p, i) => `<s${T(`${p.p} · trailing twelve months\n${vals[i] != null ? fmt(vals[i]) : p.nm ? 'n.m.' + (p.reason ? ': ' + p.reason : '') : 'missing'}${p.note ? '\n' + p.note : ''}`)}></s>`).join('');
  return `<div class="ftl"><svg viewBox="0 0 100 40" preserveAspectRatio="none">${zero}${lines}</svg><div class="fhv">${hov}</div></div>`;
}
const shortP = (p) => String(p || '').replace(/FY(\d{2})(\d{2})\b/, 'FY$2');
function vsHtml(x, cur) {
  const v = x.vs;
  if (!v) return '';
  const t = T(x.vsLabel);
  if (v.pts != null) return `<span class="${cls(v.pts)}"${t}>${v.pts > 0 ? '+' : v.pts < 0 ? '−' : ''}${Math.abs(v.pts).toFixed(1)} pts</span> vs ${esc(v.vs)}`;
  if (v.change != null) return `${v.release ? `<span${t}>release</span> · ` : ''}<span${t}>${v.change > 0 ? '+' : ''}${money(v.change, cur)}</span> vs ${esc(v.vs)}`;
  if (v.pct != null) return `<span class="${cls(v.pct)}"${t}>${spct(v.pct)}</span> vs ${esc(v.vs)}`;
  return `<span${t}>${esc(v.words)}</span> vs ${esc(v.vs)}`;
}

function finTile(c) {
  const f = c.fin;
  if (!f || !S.box('fin')) return '';
  const h = f.headline, cur = f.currency;
  const g = h.revenueGrowth || {};
  const om = h.operatingMargin;
  const tl = f.tile;
  // the payload carries every cell for the type; the switchboard picks and orders them (day-one fallback without it:
  // net margin only where operating margin is absent)
  let have = tl?.cells || [];
  if (S.fallback) have = have.filter((x, _, all) => !(x.id === 'netMargin' && all.some((y) => y.id === 'opMargin')));
  // the ten-year history series (chart.*), drawn as bar-only cells when switched on
  const ch = f.chart;
  const chartCells = ch?.years ? ['revenue', 'cashEarnings', 'operatingMargin'].filter((k) => Array.isArray(ch[k])).map((k) => ({
    id: 'chart.' + k, label: S.label('chart.' + k).replace(/, ten fiscal years.*$/, ', 10 yrs'), unit: k === 'operatingMargin' ? 'pct' : 'money', chartOnly: true, now: null,
    annual: ch.years.map((p, i) => ({ p, v: typeof ch[k][i]?.v === 'number' ? ch[k][i].v : null, note: ch[k][i]?.src })),
  })) : [];
  const byId = new Map([...have, ...chartCells].map((x) => [x.id, x]));
  const stOf = (x) => S.st(x.id, x.chartOnly ? null : 'MAIN');
  const drawn = S.sort([...byId.keys()].filter((id) => stOf(byId.get(id)))).map((id) => byId.get(id));
  const cells = drawn.filter((x) => !x.chartOnly); // the measure cells: the trends rows and the notes follow them
  const mainN = drawn.filter((x) => stOf(x) === 'MAIN').length;
  const formOf = (x) => (x.chartOnly ? 'chart' : S.form(x.id, 'both'));
  const fmtOf = (x) => (v) => fmtUnit(x.unit, v, cur);
  // main tile: the last ten fiscal years, then the TTM bar (highlighted) when the basis is a TTM that is not itself the latest fiscal year
  const withTtm = tl && tl.basis.basis === 'TTM' && !tl.basis.isFy;
  const tileSeries = (x) => {
    const pts = x.annual.map((p) => ({ ...p, k: 'fiscal year' }));
    if (withTtm && x.ttm) { const t = x.ttm[x.ttm.length - 1]; pts.push({ ...t, p: 'TTM to ' + t.p, k: 'trailing twelve months', ax: 'TTM' }); }
    return { pts };
  };
  const ceSt = S.st('cashEarningsLine', 'MAIN');
  const cell = (x) => {
    const n = x.now, fm = fmtOf(x), form = formOf(x), bar = form !== 'number', num = form !== 'chart';
    const own = n && n.label !== tl?.basis.label ? ` · ${esc(shortP(n.label))}` : '';
    const val = n ? (n.nm ? 'n.m.' : fm(n.v) + (n.computed ? '<sup class="calc">calc</sup>' : '')) : DASH;
    const title = [x.def ? `${x.label}: ${x.def}` : x.label, n && `${n.label}${n.note ? ' · ' + n.note : ''}`, n?.nm && 'n.m.: ' + n.reason, n?.src, !n && x.missing?.title].filter(Boolean).join('\n');
    const s = tileSeries(x), sp = bar ? bars(s.pts, fm) : '';
    const lastP = s.pts[s.pts.length - 1];
    const ax = `<div class="fax"><span>${sp ? esc(shortP(s.pts[0].p)) : '&nbsp;'}</span><span>${sp ? esc(lastP.ax || shortP(lastP.p)) : ''}</span></div>`;
    let sub;
    // free cash flow: its year-ago change, and Mowgli's cash earnings on a second short line
    if (x.id === 'fcf' && x.cashEarnings && ceSt) sub = `${n ? vsHtml(x, cur) || '&nbsp;' : '&nbsp;'}</em><em${ceSt === 'ON' ? ' class="xo"' : ''}><span${T(`Cash earnings = free cash flow − stock-based pay (A4), ${x.cashEarnings.label}\n${x.cashEarnings.src}`)}>cash earnings ${money(x.cashEarnings.v, cur)}</span>`;
    else if (n) sub = vsHtml(x, cur);
    else if (x.fyFigure) sub = `<span${T(`${x.missing?.title || ''}\n${x.fyFigure.label}: ${x.fyFigure.src}`)}>${esc(shortP(x.fyFigure.label))}: ${fm(x.fyFigure.v)}</span>`;
    else sub = x.missing?.text ? `<span${T(x.missing.title)}>${esc(x.missing.text)}</span>` : '';
    const html = `<div class="fc${bar ? '' : ' nb'}" data-cell="${esc(x.id)}"><span>${esc(x.label)}${own}</span>${num ? `<b${T(title)}>${val}</b>` : ''}${bar ? (sp || '<div class="fsp"></div>') + ax : ''}<em>${sub || '&nbsp;'}</em></div>`;
    return put(stOf(x), html);
  };
  // D89 accounting notes, only for the cells actually drawn (each note names the cells it explains)
  const drawnIds = new Set(drawn.map((x) => x.id));
  const rn = (c.valuationInputs?.readerNotes?.financials || []).filter((x) => !Array.isArray(x.lines) || x.lines.some((l) => drawnIds.has(l)));
  // a note sits in the main view when one of its cells is there; a note whose cells are all expanded-only goes with them
  const mainIds = new Set(drawn.filter((x) => stOf(x) === 'MAIN').map((x) => x.id));
  const rnMain = rn.filter((x) => !Array.isArray(x.lines) || x.lines.some((l) => mainIds.has(l))), rnOn = rn.filter((x) => !rnMain.includes(x));
  const noteM = [], noteO = [];
  const note = (id, text) => { const s = S.st(id, 'MAIN'); if (s === 'MAIN') noteM.push(text); else if (s === 'ON') noteO.push(text); };
  if (drawn.some((x) => formOf(x) !== 'number')) note('finBarsCaption', withTtm ? 'Bars: ten fiscal years, then the trailing twelve months (bright); change vs the twelve months a year earlier.' : 'Bars: ten fiscal years, the latest bright; change vs the year before.');
  if (c.isInsurer && !rn.some((x) => x.id === 'A9')) note('insurerFloatNote', 'Insurers collect premiums long before claims are paid, so a growing insurer’s cash flow looks better than its profit.');
  if (cur !== 'USD') note('currencyNote', `Figures in ${cur}, as filed.`);
  const fnt = (l) => `<div class="v-self note fnt"${T(l.join('\n'))}>${esc(l.join(' '))}</div>`;
  // the other single figures: the margins (expanded view on day one) and the computed headline figures (off on day one)
  const q = g.quarter;
  const figs = {
    'margins.grossMargin': ['ON', 'Margins', kv('Gross margin', h.grossMargin ? (h.grossMargin.nm ? 'n.m.' : pct(h.grossMargin.pct)) : '', h.grossMargin ? esc(h.grossMargin.label) + (h.grossMargin.computed ? ' · computed' : '') : '', h.grossMargin ? h.grossMargin.src : '')],
    'margins.operatingMargin': ['ON', 'Margins', kv('Operating margin', om ? (om.nm ? 'n.m.' : pct(om.pct)) : '', om ? esc(om.label) : '', om ? om.src : '')],
    'margins.netMargin': ['ON', 'Margins', kv('Net margin', h.netMargin ? (h.netMargin.nm ? 'n.m.' : pct(h.netMargin.pct)) : '', h.netMargin ? esc(h.netMargin.label) : '', h.netMargin ? h.netMargin.src : '')],
    'headline.revenue': [null, 'Other figures', h.revenue ? kv('Revenue', money(h.revenue.v, cur), esc(h.revenue.label), h.revenue.src) : ''],
    'headline.cashEarnings': [null, 'Other figures', h.cashEarnings ? kv('Cash earnings', money(h.cashEarnings.v, cur), esc(h.cashEarnings.label || ''), h.cashEarnings.src) : ''],
    revenueGrowth: [null, 'Other figures', q?.pct != null ? kv('Revenue growth', `<span class="${cls(q.pct)}">${spct(q.pct)}</span>`, esc(q.label || ''), q.src) : ''],
  };
  // switches changed: a single figure that repeats a drawn cell in the same view is left out (the cell is richer)
  const SAME = { 'margins.operatingMargin': 'opMargin', 'margins.netMargin': 'netMargin', 'headline.revenue': 'revenue' };
  const dupOf = (id) => SAME[id] && byId.has(SAME[id]) && stOf(byId.get(SAME[id])) === S.st(id, figs[id][0]);
  const figIds = S.sort(Object.keys(figs).filter((id) => figs[id][2] && S.st(id, figs[id][0]) && !dupOf(id)));
  // rows balanced: per row = ceil(n / rows) with at most 4 a row (5 when the box is wide)
  const perRow = (max) => (mainN ? Math.ceil(mainN / Math.ceil(mainN / max)) : 4);
  const p4 = perRow(4), p5 = perRow(5);
  const gcls = (p4 !== 4 ? ' c' + p4 : '') + (p5 !== p4 ? ' w' + p5 : '');
  const figMain = figIds.filter((id) => S.st(id, figs[id][0]) === 'MAIN').map((id) => figs[id][2]).join('');
  const figOn = (head) => figIds.filter((id) => S.st(id, figs[id][0]) === 'ON' && figs[id][1] === head).map((id) => figs[id][2]).join('');
  const rnSt = S.st('readerNotesFinancials', 'MAIN');
  const std = (drawn.length ? `<div class="v-self fgr${gcls}">${drawn.map(cell).join('')}</div>` : '')
    + (figMain ? `<div class="fkv">${figMain}</div>` : '') + fnt(noteM) + (noteO.length ? xo(fnt(noteO)) : '') + put(rnSt, readerNotes(rnMain)) + (rnSt && rnOn.length ? xo(readerNotes(rnOn)) : '');

  // expanded view: per measure, single quarters, the rolling TTM line and fiscal years
  const rng = (pts) => (pts?.length ? `${shortP(pts[0].p)}–${shortP(pts[pts.length - 1].p)}` : '');
  const anyQ = cells.find((x) => x.quarters), anyT = cells.find((x) => x.ttm);
  const trows = cells.map((x) => {
    const fm = fmtOf(x);
    return `<div class="ftr"><span${T(x.def || '')}>${esc(x.label)}</span><div>${x.quarters ? bars(x.quarters, fm, 'quarter') || DASH : ''}</div><div>${x.ttm ? tline(x.ttm, fm) || DASH : DASH}</div><div>${bars(x.annual, fm, 'fiscal year') || DASH}</div></div>`;
  }).join('');
  const trends = cells.length && S.st('trends', 'ON') ? sec('Trends', `<div class="ftb"><div class="ftr fth"><span></span><span>Quarters<small>${anyQ ? esc(rng(anyQ.quarters)) : '&nbsp;'}</small></span><span${T('Trailing twelve months at each quarter end')}>Trailing year<small>${anyT ? esc(rng(anyT.ttm)) : '&nbsp;'}</small></span><span>Fiscal years<small>${esc(rng(cells[0].annual))}</small></span></div>${trows}</div>`) : '';

  const table = (t0, title) => {
    // each statement line is its own switch (stmt.<line id>); a table with no line switched on is not drawn
    const t = t0 && { ...t0, rows: t0.rows.filter((r) => S.st('stmt.' + r.id, 'ON')) };
    if (!t || !t.rows.length) return '';
    // Most recent period on the left, older periods to the right (Adam, D64); the API sends oldest first.
    const head = `<tr><th></th>${[...t.cols].reverse().map((x) => `<th>${esc(x)}</th>`).join('')}</tr>`;
    const body = t.rows.map((r) => `<tr${T(r.missing)}><td class="lbl2">${esc(r.label)}</td>${[...r.cells].reverse().map((x) => {
      if (!x) return `<td${T(r.missing || 'Not in the filings data for this period')}>${DASH}</td>`;
      const v = r.unit === 'perShare' ? perShare(x.v, cur) : money(x.v, cur);
      const y = x.yoy ? (x.yoy.pct != null ? `<small class="${cls(x.yoy.pct)}">${spct(x.yoy.pct)}</small>` : `<small>${esc(x.yoy.words || 'n.m.')}</small>`) : '<small>&nbsp;</small>';
      return `<td${T((x.computed ? 'computed · ' : '') + x.src)}>${v}${y}</td>`;
    }).join('')}</tr>`).join('');
    return sec(title, `<table class="ft">${head}${body}</table>`);
  };
  const full = `<div class="v-self" style="flex-direction:column">${trends}${sec('Margins', figOn('Margins'))}${table(f.annual, 'Annual · growth vs the year before')}${table(f.quarterly, 'Quarterly · growth vs the same quarter a year earlier')}${sec('Other figures', figOn('Other figures'))}</div>`;
  const lbl = `<span class="v-self">Financials${tl ? ' · ' + esc(tl.basis.label) : h.revenue ? ' · ' + esc(h.revenue.label) : ''}</span>`;
  const door = '<span class="door soon" title="coming">Full financials (coming)</span>';
  const pp = {
    'peek.revenue': h.revenue && `Revenue <b>${money(h.revenue.v, cur)}</b>`,
    'peek.revenueGrowthQ': g.quarter?.pct != null && `<b class="${cls(g.quarter.pct)}">${spct(g.quarter.pct)}</b> last quarter`,
    'margins.operatingMargin': om && om.pct != null && `operating margin <b>${pct(om.pct)}</b>`,
  };
  const peek = S.peek('fin', Object.keys(pp)).map((id) => (id in pp ? pp[id] : peekPart(c, id))).filter(Boolean).join(' · ');
  const hasMain = mainN > 0 || !!figMain || (rnSt === 'MAIN' && rn.length > 0);
  return tile('fin', lbl, peek, std, full, door, !hasMain);
}

/* ---------- valuation box (D86) and geography box (D71) ---------- */
const mfmt = (m, v) => (m.kind === 'yield' ? pct(v, 1) : typeof v === 'number' ? (v < 0 ? '−' : '') + Math.abs(v).toFixed(Math.abs(v) >= 100 ? 0 : 1) + '×' : null);
const okYear = (m) => (y) => (m.kind === 'yield' ? y.pct : y.v) != null;
let VAL_PEEK = null; // the measure the collapsed Valuation box shows (null: the box's headline measure, day one)
function valTile(c) {
  const box = c.valuationInputs?.box;
  if (!box) return '';
  if (box.status !== 'ok') return S.asks('val') ? tile('val', 'Valuation', esc(box.reason || ''), `<div class="note">${esc(box.reason || 'Not computed.')}</div>`, '') : '';
  if (!S.box('val')) return '';
  // the measures in the switchboard's order (day-one fallback: the headline measure first)
  const ordered = S.fallback ? [...box.measures].sort((a, b) => (b.headline ? 1 : 0) - (a.headline ? 1 : 0)) : S.sort(box.measures.map((m) => m.id)).map((id) => box.measures.find((m) => m.id === id));
  const ms = ordered.filter((m) => S.st(m.id, 'MAIN'));
  const formOf = (m) => S.form(m.id, 'both');
  const range = ms.some((m) => formOf(m) === 'both'); // the 10-year range column is drawn only when a measure uses it
  const nr = range ? '' : ' nr';
  const basisTxt = box.basis.basis === 'FY' ? `${box.basis.label} annual report` : box.basis.label;
  const catName = box.peers?.cat?.name || 'Cat';
  const rangeTxt = (a, b) => (a ? (a === b ? `priced ${a}` : `priced ${a} to ${b}`) : '');
  const onFY = (k) => (k ? `; ${k} on latest fiscal year` : '');
  const named = (m, pe) => (pe?.values?.length ? pe.values.map((x) => `${x.ticker} ${mfmt(m, x.value)}${x.basis === 'FY' ? ' FY' : ''}`).join(' · ') : '');
  const detail = [];
  const rows = ms.map((m) => {
    const h = box.history?.[m.id], pe = box.peers?.measures?.[m.id];
    // D86: a Sub median from 3 peers up; below that the whole Cat's median is the one figure shown, named Sub peers on hover and in the expanded view
    const subMed = pe && pe.median != null, catMed = !subMed && pe?.cat?.median != null;
    const nm = pe && !subMed ? named(m, pe) : '';
    const peer = subMed ? mfmt(m, pe.median) : catMed ? `<small>Cat</small>${mfmt(m, pe.cat.median)}` : DASH;
    const catTitle = pe?.cat ? `${catName}: ${pe.cat.n} of ${pe.cat.m} companies have it${pe.cat.median != null ? `, median ${mfmt(m, pe.cat.median)}, ${rangeTxt(box.peers.cat?.pricedFrom, box.peers.cat?.pricedTo)}${onFY(pe.cat.onFY)}` : ', too few for a median'}` : '';
    const peerTitle = !pe ? 'No peer group' : subMed
      ? `Median of ${pe.n} peers in ${box.peers.sub}, ${rangeTxt(box.peers.pricedFrom, box.peers.pricedTo)}${onFY(pe.onFY)}`
      : [`Only ${pe.n} of ${pe.m} peers in ${box.peers.sub} have this figure; a median needs at least ${box.peers.minimum}`, nm && `Named: ${nm}${pe.onFY ? ' (FY = latest fiscal year)' : ''}`, catTitle].filter(Boolean).join('\n');
    const have = h && h.n && h.low != null;
    const ys = have ? h.years.filter(okYear(m)) : [];
    const span = have ? `${ys[0]?.period} to ${ys[ys.length - 1]?.period}` : '';
    const hist = have ? `Own range, ${h.n} fiscal years ${span}, each at its fiscal-year-end price\nLow ${mfmt(m, h.low)} · median ${mfmt(m, h.median)} · high ${mfmt(m, h.high)}` : 'No 10-year history available';
    const tag = m.basis ? `<small class="vtag"${T(`${m.basis.label} annual report`)}>${esc(m.basis.label)}</small>` : '';
    detail.push(`<tr${T(m.long || '')}><td>${esc(m.name)}${tag}</td><td class="n">${have ? `${mfmt(m, h.low)} · ${mfmt(m, h.median)} · ${mfmt(m, h.high)}<small>${esc(span)}</small>` : DASH}</td><td class="n">${subMed ? `${mfmt(m, pe.median)}<small>median of ${pe.n}</small>` : nm ? `${esc(nm)}<small>${pe.n} of ${pe.m}, too few for a median</small>` : DASH}</td><td class="n">${pe?.cat?.median != null ? `${mfmt(m, pe.cat.median)}<small>${pe.cat.n} of ${pe.cat.m}</small>` : DASH}</td></tr>`);
    const vr = !range ? '' : formOf(m) !== 'both' ? `
      <span class="vr"></span>` : `
      <span class="vr"${T(hist)}><span class="vbar" data-lo="${have ? h.low : ''}" data-md="${have ? h.median : ''}" data-hi="${have ? h.high : ''}"><i class="mid"></i><i class="now"></i></span></span>`;
    return put(S.st(m.id, 'MAIN'), `<div class="vrow${m.headline ? ' hd' : ''}${nr}" id="vb-${esc(m.id)}"${T(m.long || '')}>
      <span class="vn">${esc(m.name)}${tag}</span><b class="vv">${DASH}</b>${vr}
      <span class="vp"${T(peerTitle)}>${peer}</span></div>`);
  }).join('');
  const rnSt = S.st('readerNotesValuation', 'MAIN');
  const vnotes = put(rnSt, readerNotes(c.valuationInputs.readerNotes?.valuation));
  const std = ms.length ? `<div class="vhead${nr}"><span></span><span>Today</span>${range ? '<span>10-year range</span>' : ''}<span>Peers</span></div>${rows}<div class="note vnote">${esc(basisTxt)} · live price</div>${vnotes}` : vnotes;
  const dt = `<table class="tt vdt"><tr><th>Measure</th><th class="n">Own low · median · high</th><th class="n"${T(box.peers?.sub || '')}>Sub peers</th><th class="n"${T(catName)}>Cat median</th></tr>${detail.join('')}</table>`;
  const prices = box.peers ? `Peers ${rangeTxt(box.peers.pricedFrom, box.peers.pricedTo)}. ` : '';
  const src = Object.entries(box.sources || {}).map(([k, x]) => `<div class="note" style="white-space:pre-line"><b>${esc(k)}</b>: ${esc(String(x))}</div>`).join('');
  const full = (ms.length && S.st('valuationRangeAndPeers', 'ON') ? sec('Range and peers', dt + `<div class="note" style="margin-top:.4em">Today at the live price; own range at each fiscal-year-end price. ${esc(prices)}FY = latest fiscal year.</div>`) : '')
    + (S.st('valuationSources', 'ON') ? sec('Where the figures come from', `<div class="note">Basis ${esc(basisTxt)}. ${box.historyPrices ? esc(box.historyPrices.source) + '.' : ''}</div>${src}`) : '');
  VAL_PEEK = S.fallback ? null : S.peek('val').find((id) => box.measures.some((m) => m.id === id)) || '';
  // a box with no peek measure and nothing else to show is hidden
  if (!VAL_PEEK && !ms.length && !(rnSt === 'MAIN' && c.valuationInputs.readerNotes?.valuation?.length)) return '';
  const hasMain = ms.some((m) => S.st(m.id, 'MAIN') === 'MAIN') || (rnSt === 'MAIN' && !!c.valuationInputs.readerNotes?.valuation?.length);
  // the peek: the resolver's peek measure, filled at the live price; none named, no peek (never a lone dash)
  return tile('val', 'Valuation', VAL_PEEK === '' ? '' : '<span id="vb-peek">—</span>', std, full, '', !hasMain);
}
function fillValuation(q) {
  const box = C.valuationInputs?.box;
  const now = q?.valuation?.valuationBox;
  if (!box || box.status !== 'ok' || !now || now.status !== 'ok') return;
  for (const m of now.measures) {
    const def = box.measures.find((x) => x.id === m.id);
    if (!def) continue;
    const v = def.kind === 'yield' ? m.pct : m.v;
    const html = v != null ? mfmt(def, v) : m.nm ? `<span${T('n.m.: ' + (m.reason || ''))}>n.m.</span>` : `<span${T(m.reason || '')}>—</span>`;
    fillLive(m.id, html);
    const row = document.getElementById('vb-' + m.id); if (!row) continue;
    $('.vv', row).innerHTML = html;
    const bar = $('.vbar', row);
    if (!bar) continue; // drawn as a number only
    const lo = parseFloat(bar.dataset.lo), hi = parseFloat(bar.dataset.hi), md = parseFloat(bar.dataset.md);
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) { bar.style.visibility = 'hidden'; continue; }
    const a = v != null ? Math.min(lo, v) : lo, b = v != null ? Math.max(hi, v) : hi, at = (x) => ((x - a) / (b - a) * 100).toFixed(1) + '%';
    $('.mid', bar).style.left = at(md);
    const nw = $('.now', bar); if (v != null) nw.style.left = at(v); else nw.style.display = 'none';
    bar.style.setProperty('--lo', at(lo)); bar.style.setProperty('--hi', at(hi));
  }
  const hd = VAL_PEEK === null ? box.measures.find((x) => x.headline) : box.measures.find((x) => x.id === VAL_PEEK), hn = hd && now.measures.find((m) => m.id === hd.id);
  const pk = document.getElementById('vb-peek');
  if (pk && hn) { const v = hd.kind === 'yield' ? hn.pct : hn.v; pk.innerHTML = v != null ? `${esc(hd.name)} <b>${mfmt(hd, v)}</b>` : ''; }
}

/* a figure as short text, for the headline strip and a peek that falls through to another item; figures the live price
   fills are placeholders (data-hs) filled by fillLive; '' when the company has no such figure */
const LIVE_IDS = ['marketValue', 'dividendYield', 'buybackYield'];
// returns {html, title}: the title carries the period, the source and whether Mowgli computed it
function metricValue(c, id) {
  const f = c.fin, h = f?.headline || {}, cur = f?.currency;
  const none = { html: '', title: '' };
  const cell = f?.tile?.cells?.find((x) => x.id === id);
  if (cell) { const n = cell.now; return n ? { html: n.nm ? 'n.m.' : fmtUnit(cell.unit, n.v, cur), title: [n.label, n.computed && 'computed by Mowgli', n.nm && 'n.m.: ' + n.reason, n.src].filter(Boolean).join('\n') } : none; }
  if (id === 'peek.revenueGrowthQ' || id === 'revenueGrowth') { const q = h.revenueGrowth?.quarter; return q?.pct != null ? { html: `<span class="${cls(q.pct)}">${spct(q.pct)}</span>`, title: [q.label, q.src].filter(Boolean).join('\n') } : none; }
  const m = /^(?:margins|headline|peek)\.(\w+)$/.exec(id);
  if (m && h[m[1]]) { const x = h[m[1]]; const html = x.nm ? 'n.m.' : x.pct != null ? pct(x.pct) : x.v != null ? money(x.v, cur) : ''; return html ? { html, title: [x.label, x.computed && 'computed by Mowgli', x.src].filter(Boolean).join('\n') } : none; }
  if (LIVE_IDS.includes(id) || (c.valuationInputs?.box?.measures || []).some((x) => x.id === id)) return { html: `<span data-hs="${esc(id)}">—</span>`, title: 'At the live price; computed by Mowgli' };
  const vi = c.valuationInputs || {};
  const text = {
    hq: c.hq?.text, 'identity.hq': c.hq?.text, legalName: c.legalName, fiscalYearEnd: c.fiscalYearEnd, founded: c.founded?.value,
    employees: c.employees?.value?.toLocaleString('en-US'), sharesOutstanding: vi.shares ? (vi.shares.value / 1e6).toLocaleString('en-US', { maximumFractionDigits: 1 }) + 'M' : '',
    sharesPerADS: vi.sharesPerADS ? String(vi.sharesPerADS) : '', exchangeTicker: [c.displayTicker, c.exchange].filter(Boolean).join(' · '),
  }[id];
  return text ? { html: esc(text), title: profileSrc(c) } : none;
}
// the figure's own short name where the payload has one (a Financials cell, a valuation measure), else the catalog label
const shortLabel = (c, id) => c.fin?.tile?.cells?.find((x) => x.id === id)?.label || c.valuationInputs?.box?.measures?.find((x) => x.id === id)?.name || S.label(id).replace(/ \(series\)$/, '');
const peekPart = (c, id) => { const v = metricValue(c, id); return v.html ? `<span${T(v.title)}>${esc(shortLabel(c, id))} <b>${v.html}</b></span>` : ''; };
const fillLive = (id, html) => document.querySelectorAll(`[data-hs="${id}"]`).forEach((e) => { e.innerHTML = html; });

/* Stylised low-detail world map for the geography box (D71): areas shaded by share; unmappable labels are listed in the rows only. */
const GEO_AREAS = {
  NA: ['North America', ['-168,66 -140,70 -95,72 -80,70 -62,60 -55,50 -67,44 -76,35 -81,25 -97,26 -117,32 -125,40 -124,48 -135,58 -150,60']],
  LA: ['Latin America', ['-117,32 -97,26 -90,21 -87,21 -83,10 -77,8 -72,12 -60,10 -50,0 -35,-6 -40,-22 -48,-27 -58,-38 -65,-42 -68,-55 -74,-50 -72,-30 -77,-12 -81,-3 -78,8 -86,12 -95,16 -105,20 -110,24']],
  EU: ['Europe', ['-10,36 -9,43 -4,48 2,51 8,55 10,58 5,62 15,69 28,71 45,68 60,60 60,50 40,46 28,41 24,36 12,38 3,37']],
  MEA: ['Middle East & Africa', ['-17,15 -10,30 -6,35 10,37 25,32 34,31 36,36 44,38 55,37 62,27 58,22 52,16 43,12 51,11 40,-3 40,-15 35,-25 27,-34 18,-34 12,-18 9,-1 8,5 -8,4']],
  CN: ['China', ['74,38 80,45 90,48 105,42 120,48 135,48 122,40 122,30 118,22 108,21 98,24 90,28 80,32']],
  JP: ['Japan', ['130,31 136,34 141,36 142,41 145,44 141,45 139,38 132,35']],
  RA: ['Rest of Asia-Pacific', ['62,27 66,36 74,38 80,32 90,28 98,24 108,21 106,10 100,2 104,1 98,8 98,16 92,22 88,22 80,14 77,8 72,20 68,24', '125,34 129,35 129,38 126,38', '95,5 104,-2 106,-6 115,-8 125,-9 120,-1 110,2 100,5', '120,18 124,12 126,7 122,8']],
  OC: ['Australia & Oceania', ['114,-22 122,-18 130,-12 137,-12 142,-11 146,-19 153,-26 150,-37 141,-38 130,-32 115,-34', '172,-35 178,-38 172,-46 167,-46']],
};
function geoAreasFor(label) {
  const s = String(label).toLowerCase().replace(/non[-\s]?(u\.?s\.?a?|united states)/g, 'foreign'), a = new Set();
  if (/\b(u\.?s\.?a?|united states|canada|north america)\b/.test(s)) a.add('NA');
  if (/americas/.test(s)) { a.add('NA'); a.add('LA'); }
  if (/latin|south america|central america|mexico|brazil/.test(s)) a.add('LA');
  if (/emea/.test(s)) { a.add('EU'); a.add('MEA'); }
  if (/europe/.test(s)) a.add('EU');
  if (/middle east|africa/.test(s)) a.add('MEA');
  if (/china|hong kong|taiwan/.test(s)) a.add('CN');
  if (/japan/.test(s)) a.add('JP');
  if (/korea|india|singapore|indonesia|vietnam|thailand|philippines|(rest of|other) asia/.test(s)) a.add('RA');
  if (/australia|oceania|new zealand/.test(s)) a.add('OC');
  if (/asia|apac/.test(s) && !/(rest of|other) asia/.test(s) && !/\b(china|japan)\b/.test(s)) ['CN', 'JP', 'RA', 'OC'].forEach((k) => a.add(k));
  if (/(rest of|other) asia pacific/.test(s)) a.add('OC');
  return [...a];
}
function geoMap(regs, y) {
  const tot = {}, who = {};
  for (const r of regs) {
    const ks = geoAreasFor(r.label);
    for (const k of ks) { tot[k] = (tot[k] || 0) + r.share / ks.length; (who[k] = who[k] || []).push(`${r.label} ${pct(r.share * 100, r.share < .1 ? 1 : 0)} (${money(r.value, y.currency)})`); }
  }
  const mx = Math.max(0, ...Object.values(tot));
  if (!mx) return '';
  const pts = (p) => p.split(' ').map((q) => { const [lo, la] = q.split(','); return `${+lo + 180},${80 - la}`; }).join(' ');
  const paths = Object.entries(GEO_AREAS).map(([k, [nm, polys]]) => {
    const on = tot[k] != null;
    const tip = on ? `${nm}: ${pct(tot[k] * 100, tot[k] < .1 ? 1 : 0)} of revenue\n${who[k].join('\n')}` : `${nm}: no revenue split shown`;
    return `<g class="ga${on ? ' on' : ''}"${on ? ` style="--o:${(.3 + .7 * tot[k] / mx).toFixed(2)}"` : ''}><title>${esc(tip)}</title>${polys.map((p) => `<polygon points="${pts(p)}"/>`).join('')}</g>`;
  }).join('');
  return `<svg class="geomap" viewBox="0 0 360 140" role="img" aria-label="World map shaded by revenue share">${paths}</svg>`;
}

function geoTile(c) {
  const g = c.geography;
  if (!g || !S.box('geo')) return '';
  const P = S.peek('geo', ['geoRegions', 'geoUsOnly']);
  if (g.usOnly) {
    const u = g.usOnly, s = S.st('geoUsOnly', 'MAIN');
    if (!s) return '';
    return tile('geo', 'Revenue by region', xPeek(c, 'geo', ['geoRegions', 'geoUsOnly'], natPeek('geo', ['geoUsOnly'], s !== 'MAIN') ? 'United States only' : ''), put(s, `<div class="note" style="font-size:.88em;color:var(--ink2)"${T(u.note || '')}>${u.substantially ? 'Substantially all revenue is in the United States' : 'Revenue is entirely in the United States'}.</div><div class="note">${esc(u.form || '')} filed ${esc(u.filed || '')}: “${esc(String(u.text).slice(0, 200))}”</div>`), '', '', s !== 'MAIN');
  }
  const y = (g.years || [])[0];
  if (!y || !y.regions?.length) return '';
  const s = S.st('geoRegions', 'MAIN'), form = S.form('geoRegions', 'tableAndMap');
  const regs = [...y.regions].sort((a, b) => b.share - a.share);
  const srcT = (r) => `${r.label}: ${money(r.value, y.currency)} of ${money(y.total, y.currency)}\n${y.src?.form || ''} filed ${y.src?.filed || ''} · accession ${y.src?.accn || ''} · ${y.src?.tag || ''}`;
  const rows = regs.map((r, i) => `<div class="grow"${T(srcT(r))}><span class="gn"><i style="background:${SW[i % SW.length]}"></i>${esc(r.label)}</span><span class="gbar"><i style="width:${(r.share * 100).toFixed(1)}%;background:${SW[i % SW.length]}"></i></span><b>${pct(r.share * 100, r.share < .1 ? 1 : 0)}</b><span class="gm">${money(r.value, y.currency)}</span></div>`).join('');
  // form: tableAndMap (day one), table (the rows only) or map (the map only, drawn larger)
  const std = put(s, `<div class="geowrap${form === 'map' ? ' gmo' : ''}">${form !== 'map' ? `<div class="georows">${rows}</div>` : ''}${form !== 'table' ? geoMap(regs, y) : ''}</div><div class="note vnote">${esc(y.period)}, ${esc(y.src?.form || '')} annual report, revenue ${money(y.total, y.currency)}${y.complete ? '' : '. The regions shown do not add up to all revenue.'}</div>`);
  const efq = (list) => list.map((yy) => `<div class="efq"><h5>${esc(yy.period)} · revenue ${money(yy.total, yy.currency)}</h5>${[...yy.regions].sort((a, b) => b.share - a.share).map((r) => `<div class="kv"><span>${esc(r.label)}</span><b>${pct(r.share * 100, 1)}</b><i>${money(r.value, yy.currency)}</i></div>`).join('')}</div>`).join('');
  const others = S.st('geoEarlierYears', 'ON') ? efq((g.years || []).slice(1)) : '';
  const quarters = S.st('geoQuarters', null) ? efq((g.quarters || []).filter((x) => x.regions?.length)) : '';
  const full = (others ? sec('Earlier years', others) : '') + (quarters ? sec('Quarters', quarters) : '');
  return tile('geo', 'Revenue by region', xPeek(c, 'geo', ['geoRegions', 'geoUsOnly'], natPeek('geo', ['geoRegions'], s !== 'MAIN', ['geoRegions', 'geoEarlierYears']) ? `<b>${esc(regs[0].label)}</b> ${pct(regs[0].share * 100, 0)}` : ''), std, full, '', s !== 'MAIN');
}

function resultClass(r) { const s = String(r || '').toLowerCase(); return /beat|raised/.test(s) ? 'beat' : /miss|cut|lower/.test(s) ? 'miss' : 'inl'; }
function metricMoney(metric, v) {
  if (typeof v !== 'number') return esc(v);
  const m = String(metric);
  const sign = v < 0 ? '−' : '';
  if (/\(\$M\)/.test(m)) return `${sign}$${Math.abs(v).toLocaleString('en-US')}M`;
  if (/\(\$B\)/.test(m)) return `${sign}$${Math.abs(v).toFixed(2)}B`;
  if (/EPS/i.test(m)) return `${sign}$${Math.abs(v).toFixed(2)}`;
  return `${sign}${Math.abs(v).toLocaleString('en-US')}`;
}
// items: the expected-vs-actual rows; guidance: the guidance row (separate switches in the latest quarter)
function expectationRows(q, { items = true, guidance = true } = {}) {
  if (!q) return '';
  const rows = !items ? '' : (q.items || []).filter((it) => typeof it.expected === 'number' && typeof it.actual === 'number').map((it) => {
    const rc = resultClass(it.result), gp = it.gap != null && it.expected ? (it.gap / Math.abs(it.expected)) * 100 : null;
    const w = gp != null ? Math.min(50, Math.max(2, Math.abs(gp) * 5)) : 0;
    const bar = gp != null ? `<span class="gb"><i class="${rc}" style="${gp >= 0 ? 'left' : 'right'}:50%;width:${w.toFixed(1)}%"></i></span>` : '';
    const gapTxt = it.gap != null ? `${it.gap > 0 ? '+' : ''}${metricMoney(it.metric, it.gap)}${gp != null ? ', ' + spct(gp) : ''}` : '';
    return `<div class="er2"${T(`Expected: ${it.expectedBy || 'source not named'}\n${it.source || ''}`)}><span>${esc(it.metric.replace(/\s*\(\$[MB]\)/, ''))}</span><span><span class="bd ${rc}">${esc(String(it.result).toUpperCase())}</span>${bar}<small class="g-${rc}">${esc(gapTxt)}</small> <span class="efig">${metricMoney(it.metric, it.actual)} vs ${metricMoney(it.metric, it.expected)}</span></span></div>`;
  }).join('');
  const gd = q.guidance ? `<div class="er2"${T((q.guidance.prior ? 'Prior: ' + q.guidance.prior + '\n' : '') + (q.guidance.source || ''))}><span>Guidance</span><span><span class="bd ${resultClass(q.guidance.change)}">${esc(String(q.guidance.change || '').toUpperCase())}</span> <small>${esc(q.guidance.new || '')}</small></span></div>` : '';
  return rows + (guidance ? gd : '');
}
function reactionLine(q, note) {
  const r = q?.reaction;
  if (!r || (typeof r.nextDay !== 'number' && typeof r.nextWeek !== 'number')) return '';
  return `<div class="er1"${T([note, r.note, r.closes, r.source].filter(Boolean).join('\n'))}>Stock: report day <b class="${cls(r.nextDay)}">${spct(r.nextDay) || '—'}</b> · week after <b class="${cls(r.nextWeek)}">${spct(r.nextWeek) || '—'}</b></div>`;
}
function actualRows(qq, cur) {
  const row = (label, x, fmt) => (x ? `<div class="er2"${T(x.src)}><span>${label}</span><span><b>${fmt(x.v, cur)}</b> ${x.yoy ? (x.yoy.pct != null ? `<small class="${cls(x.yoy.pct)}">${spct(x.yoy.pct)} vs a year earlier</small>` : `<small>${esc(x.yoy.words)}</small>`) : ''}</span></div>` : '');
  return row('Revenue', qq.revenue, money) + row('Diluted EPS', qq.eps, perShare);
}
function earnTile(c) {
  const qs = c.fin?.quarters || [];
  if (!qs.length || !S.box('earn')) return '';
  const cur = c.fin.currency, latest = qs[0];
  const st = (id) => S.st(id, id === 'earnEarlierQuarters' ? 'ON' : 'MAIN');
  const E = c.earnings, byLabel = new Map((E?.quarters || []).map((q) => [q.period, q]));
  const eq = byLabel.get(latest.label);
  const briefs = (eq?.briefs || []).slice(0, 3).map((b) => `<li${T(b.text + (b.source ? '\n' + b.source : ''))}><b>${esc(b.text.split(/[:;]/)[0])}</b>${b.text.includes(':') ? ' · ' + esc(b.text.split(':').slice(1).join(':').trim().split(/;\s|\.\s/)[0]) : ''}</li>`).join('');
  let upNext = '';
  const nx = E?.next;
  if (nx && nx.expectedDate && nx.dateSource) {
    const exp = (nx.items || []).filter((i) => typeof i.expected === 'number' && i.source).map((i) => `<span${T(`${i.expectedBy || ''}\n${i.source}`)}>${esc(i.metric)} expected <b>${metricMoney(/EPS/i.test(i.metric) ? 'EPS' : i.metric, i.expected)}</b></span>`).join(' · ');
    upNext = `<div class="enx"${T(nx.dateSource)}>Up next · <b>${esc(shortDate(nx.expectedDate))}</b>${nx.dateConfirmed ? '' : ' (expected, not confirmed)'}${exp ? ' · ' + exp : ''}</div>`;
  }
  // each part of the latest quarter is its own switch
  const parts = { earnActuals: actualRows(latest, cur), earnExpectations: expectationRows(eq, { guidance: false }), earnGuidance: expectationRows(eq, { items: false }), earnBriefs: briefs ? `<ul class="eb">${briefs}</ul>` : '', earnReaction: reactionLine(eq, E?.reactionNote), earnNext: upNext };
  const P_ = (id) => put(st(id), parts[id]);
  const std = `<div class="ers">${P_('earnActuals')}${P_('earnExpectations')}${P_('earnGuidance')}</div>${P_('earnBriefs')}${P_('earnReaction')}${P_('earnNext')}`;
  const hasMain = Object.keys(parts).some((id) => parts[id] && st(id) === 'MAIN');
  const efq = qs.slice(1).map((q) => {
    const e = byLabel.get(q.label);
    const efb = (e?.briefs || []).map((b) => `<li${T(b.source)}>${esc(b.text)}</li>`).join('');
    return `<div class="efq"><h5>${esc(q.label)}${e?.reportDate ? ' · ' + esc(shortDate(e.reportDate)) : q.filed ? ` · ${esc(q.form || '')} filed ${esc(shortDate(q.filed))}` : ''}</h5>${actualRows(q, cur)}${expectationRows(e)}${e ? reactionLine(e, E.reactionNote).replace('class="er1"', 'class="er2"') : ''}${efb ? `<ul class="efb">${efb}</ul>` : ''}${e?.reaction?.note ? `<div class="ecov">${esc(e.reaction.note)}</div>` : ''}</div>`;
  }).join('');
  const full = efq && st('earnEarlierQuarters') ? `<div class="efqs">${efq}</div>` : '';
  const when = eq?.reportDate ? `, ${shortDate(eq.reportDate).replace(/ \d{4}$/, '')}` : '';
  const peek0 = !natPeek('earn', ['earnActuals'], !hasMain) ? '' : [latest.revenue && `Revenue <b>${money(latest.revenue.v, cur)}</b>${latest.revenue.yoy?.pct != null ? ` <b class="${cls(latest.revenue.yoy.pct)}">${spct(latest.revenue.yoy.pct)}</b>` : ''}`, latest.eps && `EPS <b>${perShare(latest.eps.v, cur)}</b>`].filter(Boolean).join(' · ');
  const peek = xPeek(c, 'earn', ['earnActuals'], peek0);
  return tile('earn', `Earnings · ${esc(latest.label)}${esc(when)}`, peek, std, full, '', !hasMain);
}

function nextTile(c) {
  const w = c.whatsNext;
  if (!w.length || !S.box('next')) return '';
  const sMain = S.st('whatsNext', 'MAIN'), sAll = S.st('whatsNextAll', 'ON');
  const src = (x) => profileSrc(c, [x.note, x.source].filter(Boolean).join(' · '));
  const std = put(sMain, `<div>${w.slice(0, 4).map((x) => `<div class="nx"${T(src(x))}><time>${esc(x.when)}</time><div class="cl3">${esc(x.text)}</div></div>`).join('')}</div>`);
  const full = !sAll ? '' : sec('Everything dated in the company profile', w.map((x) => `<div class="nx"${T(src(x))}><time>${esc(x.when)}</time><div>${esc(x.text)}${x.note ? `<div class="note">${esc(x.note)}</div>` : ''}${x.source ? `<div class="note">Source: ${esc(x.source)}</div>` : ''}</div></div>`).join(''));
  // the whole first item, wrapped to at most three lines by the page (never cut inside a word, number or date)
  const peek0 = !natPeek('next', ['whatsNext'], sMain !== 'MAIN', ['whatsNext', 'whatsNextAll']) ? ''
    : `<span class="pk3"><b>${esc(w[0].when)}</b> ${esc(w[0].text)}</span>`;
  const peek = xPeek(c, 'next', ['whatsNext'], peek0);
  return tile('next', 'What’s next', peek, std, full, '', sMain !== 'MAIN');
}

/* ---------- expand in place (from the design) ---------- */
let open = null;
function setOpen(id) {
  open = id === open ? null : id;
  const field = $('#field'), t = open ? field.querySelector(`.tile[data-id="${open}"]`) : null;
  field.querySelectorAll('.tile').forEach((x) => { x.classList.toggle('open', x === t); x.classList.toggle('shrunk', !!t && x !== t); });
  const col = t ? t.closest('.fcol') : null;
  field.querySelectorAll('.fcol').forEach((x) => { x.style.flexGrow = col ? (x === col ? 2.6 : .7) : 1; });
}

/* ---------- quote ---------- */
let C = null;
let lastQuote = null; // the last quote drawn, redrawn after the switches change
function renderQuote(q) {
  lastQuote = q;
  const p = $('#pxp'), cEl = $('#pxc');
  if (!q || q.price == null) { p.textContent = '—'; cEl.className = 'c stale'; cEl.innerHTML = `<small${T(q?.error || '')}>price unavailable</small>`; return; }
  const ads = C.valuationInputs.sharesPerADS ? ' per ADS' : '';
  p.innerHTML = `$${q.price.toFixed(2)}`;
  p.title = `${q.symbol}${ads} · ${q.source}${q.fetchedAt ? ' · fetched ' + q.fetchedAt : ''}`;
  const ch = typeof q.change === 'number' ? `${q.change >= 0 ? '+' : '−'}${Math.abs(q.change).toFixed(2)} (${spct(q.changePct, 2)}) today` : '';
  cEl.className = 'c ' + cls(q.change) + (q.stale ? ' stale' : '');
  cEl.innerHTML = `${ch}<small${T(q.stale ? 'Last good quote; live source failed: ' + (q.error || '') : '')}>${esc(q.session || '')}${q.time ? ' · ' + esc(q.time.replace(/^[A-Z][a-z]{2} \d{1,2}, \d{4} /, '')) : ''}${q.stale ? ' · stale' : ''}</small>`;
  fillValuation(q);
  const v = q.valuation || {};
  const mv = v.marketValue;
  const set = (id, html, title) => { const el = document.getElementById(id); if (!el) return; el.querySelector('b').innerHTML = html; if (title) el.title = title; else el.removeAttribute('title'); };
  set('v-mv', mv ? money(mv.v) : DASH, mv ? `${mv.src}\nPrice: ${q.symbol} ${q.price}${q.stale ? ' (stale)' : ''}` : 'No share count in the filings data');
  const dy = v.dividendYield;
  set('v-dy', dy && dy.pct != null ? pct(dy.pct, 2) : DASH, dy ? dy.src : 'No dividend stated in the profile or paid over the last 12 months in the filings data');
  const bp = v.buybackPrev, bn = v.buybackNext;
  const prevTxt = bp && bp.pct != null ? pct(bp.pct) : DASH;
  const nextTxt = bn && bn.pct != null ? pct(bn.pct) : bn && bn.longWindow ? money(bn.amount) + ' to ' + shortDate(bn.expiry) : DASH;
  fillLive('marketValue', mv ? money(mv.v) : DASH);
  fillLive('dividendYield', dy && dy.pct != null ? pct(dy.pct, 2) : DASH);
  fillLive('buybackYield', `${prevTxt} / ${nextTxt}`);
  set('v-by', `${prevTxt} / ${nextTxt}`, [bp ? 'Prev 12: ' + bp.src : 'Prev 12: no buyback figure for the last 12 months in the filings data', bn ? 'Next 12: ' + bn.src : 'Next 12: ' + (v.buybackNextNote || 'no dated authorisation stated')].join('\n\n'));
  const pk = document.getElementById('v-peek');
  if (pk && mv && BASICS_PEEK.mv) pk.innerHTML = `Worth <b>${money(mv.v)}</b>${BASICS_PEEK.hq ? ' · ' + esc(C.hq.text) : ''}${BASICS_PEEK.extra ? ' · ' + BASICS_PEEK.extra : ''}`;
  const line = document.getElementById('v-mvline');
  if (line && !mv) line.innerHTML = kv('Market value: today’s price × shares', DASH, 'computed', 'No share count in the filings data');
  else if (line) line.innerHTML = kv(`Market value: today's price${C.valuationInputs.sharesPerADS ? ' per ADS ÷ ' + C.valuationInputs.sharesPerADS : ''} × shares at ${esc(shortDate(mv.sharesDate))}`, money(mv.v), 'computed', mv.src);
  const d2 = document.getElementById('v-dy2');
  if (d2) d2.textContent = dy && dy.pct != null ? pct(dy.pct, 2) : '—';
}
let lastLive = null;
async function loadQuote() {
  if (!MG.isStatic) {
    try { const r = await fetch(`/api/quote/${encodeURIComponent(C.ticker)}`); renderQuote(await r.json()); }
    catch (e) { renderQuote({ price: null, error: e.message }); }
    return;
  }
  // Published site: the live price comes from the Cloudflare relay; if it is unavailable the price baked at
  // publish time is shown, labelled with its date and "stale", never a blank.
  try {
    if (!MG.quoteWorker) throw new Error('no live price relay configured');
    const r = await fetch(`${MG.quoteWorker}/quote?t=${encodeURIComponent(C.ticker)}`);
    const q = await r.json();
    if (!r.ok || q.price == null) throw new Error((q.error && q.error.message) || q.error || 'no live price');
    const { valuation } = await import(MG.base + 'valuation.mjs');
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    lastLive = { ...q, valuation: valuation(C.valuationInputs, q.price, today) };
    renderQuote(lastLive);
  } catch (e) {
    if (lastLive) { renderQuote({ ...lastLive, stale: true, error: e.message }); return; }
    const b = C.bakedQuote;
    if (!b || b.price == null) { renderQuote({ price: null, error: e.message }); return; }
    renderQuote({ ...b, stale: true, session: `price as of ${String(b.bakedAt || '').slice(0, 10)}`, time: null, error: `${e.message}; showing the price captured when the site was published (${b.bakedAt})` });
  }
}

/* ---------- switcher ---------- */
let LIST = [];
function setupSwitcher() {
  const q = $('#q'), box = $('#sugg');
  let sel = 0, hits = [];
  const show = () => {
    const s = q.value.trim().toUpperCase();
    if (!s) { box.classList.remove('on'); return; }
    hits = LIST.filter((c) => c.ticker.startsWith(s) || c.aliases.some((a) => a.startsWith(s))).concat(LIST.filter((c) => !c.ticker.startsWith(s) && !c.aliases.some((a) => a.startsWith(s)) && c.name.toUpperCase().includes(s))).slice(0, 8);
    sel = 0;
    box.innerHTML = hits.map((c, i) => `<a href="${MG.pageUrl(c.ticker)}" class="${i === sel ? 'sel' : ''}">${c.logo ? `<img src="${esc(c.logo)}" alt="">` : '<span class="nl"></span>'}<b>${esc(c.ticker)}</b><span>${esc(c.name)}</span></a>`).join('') || '<a><span></span><b></b><span>No match among the profiled companies</span></a>';
    box.classList.add('on');
  };
  q.addEventListener('input', show);
  q.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sel = (sel + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % Math.max(1, hits.length); [...box.children].forEach((a, i) => a.classList.toggle('sel', i === sel)); }
    else if (e.key === 'Enter' && hits[sel]) location.href = MG.pageUrl(hits[sel].ticker);
    else if (e.key === 'Escape') { q.value = ''; box.classList.remove('on'); q.blur(); }
  });
  q.addEventListener('blur', () => setTimeout(() => box.classList.remove('on'), 150));
  addEventListener('keydown', (e) => { if (e.key === '/' && document.activeElement.tagName !== 'INPUT') { e.preventDefault(); q.focus(); } });
  fetch(MG.companiesUrl()).then((r) => r.json()).then((l) => { LIST = l; }).catch(() => {});
}

/* ---------- page ---------- */
function render(c) {
  C = c;
  document.title = `${c.name} · Mowgli`;
  applyTheme(c.theme);
  const hero = $('#hero'), b = document.body;
  $('#hname').textContent = c.name;
  $('#htick').textContent = [c.displayTicker, (c.exchange || '').split(/[\s(;,]/)[0]].filter(Boolean).join(' · ');
  if (c.logo) {
    b.style.setProperty('--logo', `url("${c.logo.url}")`);
    $('#hreal').src = c.logo.url;
    b.dataset.multi = c.logo.multi ? '1' : '0';
    b.dataset.named = '1';
    $('#hsub').textContent = c.name;
    const im = new Image();
    im.onload = () => { const a = (im.naturalWidth || 300) / (im.naturalHeight || 100); b.style.setProperty('--hlw', (3.6 * a) + 'rem'); };
    im.src = c.logo.url;
  } else { hero.classList.add('nologo'); b.dataset.named = '0'; }

  drawTiles(c);

  const lf = c.fin?.latestFiling;
  const parts = [
    lf && `SEC EDGAR filings to ${lf.form} filed ${lf.filed}`,
    c.profileReviewed && `company profile reviewed ${c.profileReviewed}`,
    c.earnings && `earnings expectations and reactions: earnings.json as of ${c.earnings.asOf}`,
    'price: Nasdaq real-time last sale (Yahoo fallback)',
    c.logo?.source && `logo: ${c.logo.source}`,
  ].filter(Boolean);
  const src = $('#src');
  src.textContent = 'Sources: ' + parts.join(' · ');
  src.title = [lf && `Latest filing: ${lf.form} filed ${lf.filed}, accession ${lf.accn}`, c.profileAgainst && `Profile reviewed against: ${c.profileAgainst}`, c.profileConflicts ? `${c.profileConflicts} open data conflict(s) recorded in the profile` : '', (c.fin?.conflicts || []).length ? `${c.fin.conflicts.length} open conflict(s) in the financials` : ''].filter(Boolean).join('\n');
  sizeBand();
}

// the boxes, the headline strip and the switchboard notice; run again in place when the switches change (D90)
function drawTiles(c) {
  S = selection(c);
  open = null;
  const tiles = { company: basicsTile(c), cls: classTile(c), money: moneyTile(c), brands: brandsTile(c), fin: finTile(c), val: valTile(c), geo: geoTile(c), next: nextTile(c), earn: earnTile(c) };
  const field = $('#field');
  // three content-sized columns; each box goes to the shortest column, so an absent box leaves no gap; a pinned box
  // (Classification under Basics on day one) goes directly under its host, in the host's column
  field.innerHTML = '<div class="fcol"></div><div class="fcol"></div><div class="fcol"></div>';
  field.removeAttribute('data-n');
  const cols = [...field.children];
  for (const id of S.order) {
    if (!tiles[id]) continue;
    const tmp = document.createElement('div'); tmp.innerHTML = tiles[id];
    const el = tmp.firstElementChild, pin = S.pin(id), host = pin && field.querySelector(`.tile.${pin}`);
    if (host) host.after(el);
    else cols.reduce((a, x) => (x.offsetHeight < a.offsetHeight ? x : a)).appendChild(el);
  }
  cols.forEach((x, i) => { if (!x.children.length) x.remove(); else [...x.children].forEach((t) => { t.dataset.c = i; }); });
  // fewer than three columns: each keeps a third of the width, so a lone box does not stretch across the page
  if (field.children.length && field.children.length < 3) field.dataset.n = field.children.length;
  field.querySelectorAll('.tile').forEach((t) => t.addEventListener('click', (e) => { if (e.target.closest('a') || !t.dataset.id) return; setOpen(t.dataset.id); }));

  // headline strip under the logo: the metrics Adam marks for it, in his order (none on day one, so nothing is drawn)
  $('#hstrip')?.remove();
  const hs = S.headline.map((id) => { const v = metricValue(c, id); return `<span${T([S.label(id), v.title].filter(Boolean).join('\n'))}>${esc(shortLabel(c, id))}<b>${v.html || DASH}</b></span>`; }).join('');
  if (hs) $('#htick').insertAdjacentHTML('afterend', `<div class="hstrip" id="hstrip">${hs}</div>`);

  $('#sbn')?.remove();
  if (S.fallback) document.body.insertAdjacentHTML('beforeend', `<div class="sbn" id="sbn"${T('Switchboard: ' + S.why)}>Display settings could not be loaded; showing the standard layout.</div>`);
  else if (SBSTALE) document.body.insertAdjacentHTML('beforeend', `<div class="sbn" id="sbn"${T('Switchboard: ' + SBSTALE)}>Display settings could not be refreshed; showing the last loaded.</div>`);
  sizeBand();
}

addEventListener('resize', () => { sizeBand(); drawStars(); });
addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) setOpen(open); });
setupSwitcher();
document.body.classList.add('instant');
// the settings page posts on this channel after a save: re-read the switches and redraw the boxes in place
try {
  new BroadcastChannel('mowgli-switchboard').onmessage = async () => {
    if (!(await loadSwitchboard()) || !C) return;
    drawTiles(C);
    if (lastQuote) renderQuote(lastQuote);
  };
} catch { /* no BroadcastChannel: the page keeps its switches until reloaded */ }
Promise.all([fetch(MG.companyUrl(ticker)), loadSwitchboard()]).then(async ([r]) => {
  const j = await r.json();
  if (!r.ok) { applyTheme({ sky: 'default' }); document.body.insertAdjacentHTML('beforeend', `<div class="err">${esc(j.error?.message || j.error || 'Not found')}</div>`); return; }
  render(j);
  loadQuote();
  setInterval(loadQuote, 30000);
  requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.remove('instant')));
}).catch((e) => { document.body.insertAdjacentHTML('beforeend', `<div class="err">Could not load: ${esc(e.message)}</div>`); });
})();
