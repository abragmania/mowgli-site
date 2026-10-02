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

/* ---------- tiles ---------- */
const XP = '<button class="xp" aria-label="Expand"><svg viewBox="0 0 16 16"><path class="o" d="M9 2h5v5M7 14H2V9M14 2 9.5 6.5M2 14l4.5-4.5"/><path class="c" d="M10 6h4M6 10H2M10 6V2M6 10v4"/></svg></button>';
const CHIP = { company: 'Company ›', money: 'Business ›', brands: 'Brands ›', val: 'Valuation ›', geo: 'Regions ›', fin: 'Financials ›', earn: 'Earnings ›', next: 'Plans ›' };
const tile = (id, label, peek, std, full, door = '') =>
  `<section class="tile ${id}" data-id="${id}"><div class="in"><div class="th"><div class="lbl">${label}</div><div class="doorl">${door}<span class="door xpl" title="Expand">${CHIP[id]}</span></div>${XP}</div><div class="peek">${peek}</div><div class="body"><div class="std${id === 'company' ? ' bsx' : ''}">${std}</div><div class="full">${full}</div></div></div></section>`;
const kv = (label, val, note = '', title = '') => (val ? `<div class="kv"${T(title)}><span>${label}</span><b>${val}</b><i>${note}</i></div>` : '');
const sec = (h, inner) => (inner ? `<div class="sec">${h ? `<h5>${h}</h5>` : ''}${inner}</div>` : '');

function profileSrc(c, extra) {
  return [extra, c.profileReviewed && `Company profile (data/companies/${c.ticker}/profile.json), reviewed ${c.profileReviewed}${c.profileAgainst ? ' against ' + c.profileAgainst : ''}`].filter(Boolean).join('\n');
}

function basicsTile(c) {
  const tick = [c.displayTicker, c.exchange].filter(Boolean).join(' · ');
  const classes = c.classTickers ? `<p class="bcl">Several share classes, one company: <b>${c.classTickers.map(esc).join(', ')}</b></p>` : '';
  const std = `<div class="bid"><div><p class="btk">${esc(tick)}</p>${classes}${c.description ? `<p${T(profileSrc(c))}>${esc(firstSentence(c.description))}</p>` : ''}</div></div>
    <div class="sg b4"><div id="v-mv"><span>Market value</span><b>${DASH}</b></div>${c.hq ? `<div${T(profileSrc(c, c.hq.note))}><span>Headquarters</span><b>${esc(c.hq.text)}</b></div>` : ''}<div id="v-dy"><span>Dividend yield</span><b>${DASH}</b></div><div id="v-by"><span>Buyback yield (prev 12 / next 12)</span><b>${DASH} / ${DASH}</b></div></div>`;
  const vi = c.valuationInputs, sh = vi.shares;
  const ident = [
    kv('Legal name', esc(c.legalName), c.cik ? 'CIK ' + esc(c.cik) : ''),
    kv('Exchange · ticker', esc(tick), c.classTickers ? 'classes: ' + esc(c.classTickers.join(', ')) : ''),
    kv('Fiscal year ends', esc(c.fiscalYearEnd)),
    kv('Founded', c.founded ? esc(c.founded.value) : '', 'profile', profileSrc(c)),
    kv('Employees', c.employees ? c.employees.value.toLocaleString('en-US') : '', c.employees?.asOf ? 'as of ' + esc(c.employees.asOf) : '', profileSrc(c, c.employees?.note)),
    kv('Website', c.website ? `<a href="${esc(c.website)}" target="_blank" rel="noopener" style="color:var(--accx)">${esc(c.website.replace(/^https?:\/\/(www\.)?/, ''))}</a>` : ''),
    kv('Headquarters', c.hq ? esc(c.hq.text) : '', '', profileSrc(c, c.hq?.note)),
  ].join('');
  const shares = [
    sh ? kv(`Shares outstanding, ${esc(shortDate(sh.date))}`, (sh.value / 1e6).toLocaleString('en-US', { maximumFractionDigits: 1 }) + 'M', esc(sh.source.form || ''), `${sh.combined ? sh.combined + '\n' : ''}${sh.source.form} filed ${sh.source.filed} · accession ${sh.source.accn} · ${sh.source.tag || ''}`) : '',
    vi.sharesPerADS ? kv('Shares per ADS', String(vi.sharesPerADS), 'filing', vi.adsNote || '') : '',
    '<div id="v-mvline"></div>',
    vi.declaredDividend ? kv(`Dividend declared: $${vi.declaredDividend.annual.toFixed(2)} a year per share${vi.declaredDividend.quarterly ? ` ($${vi.declaredDividend.quarterly.toFixed(2)} a quarter)` : ''}`, '<span id="v-dy2">—</span>', 'at today\'s price', vi.declaredDividend.source) : '',
    vi.authorisationText ? `<div class="kv"${T('Company profile: ' + vi.authorisationText)}><span>Buyback authorisation: ${esc(vi.authorisationText.length > 160 ? vi.authorisationText.slice(0, 157) + '…' : vi.authorisationText)}</span><b></b><i>profile</i></div>` : '',
  ].join('');
  const full = sec('Identity', ident) + sec('Shares &amp; value', shares) + (c.description && c.description !== firstSentence(c.description) ? sec('What it does', `<div class="note" style="font-size:.84em;color:var(--ink2)">${esc(c.description)}</div>`) : '');
  const peek = `<span id="v-peek">${c.hq ? esc(c.hq.text) : esc(c.displayTicker)}</span>`;
  return tile('company', 'Basics', peek, std, full);
}

/* D87: Mowgli's own Cat and Sub (each linking to its place on the List page), the conventional GICS label, and up to five companies of the same Sub */
function classTile(c) {
  const k = c.classification;
  if (!k && !c.gics) return '';
  const list = MG.isStatic ? `${MG.base}list/` : '/list';
  const link = (x, what) => `<a href="${list}#${esc(x.anchor)}"${T(`Show ${what} on the List page`)}>${esc(x.name)}</a>`;
  const row = (l, v, t = '') => `<div class="kv2"${T(t)}><span>${l}</span><b>${v}</b></div>`;
  const rows = [
    k && row('Cat', link(k.cat, 'this Cat')),
    k?.sub && row('Sub', link(k.sub, 'this Sub')),
    c.gics && row('GICS', `${esc(c.gics.sector)}${c.gics.industry ? ' › ' + esc(c.gics.industry) : ''}`, c.gics.note ? c.gics.note : 'Conventionally filed as (GICS)'),
  ].filter(Boolean).join('');
  const peers = k?.peers?.length ? `<div class="kv2 pr2"><span>Peers</span><div class="peers">${k.peers.map((p) => `<span class="pe"${T(p.ticker)}>${p.logo ? `<img src="${esc(MG.logoBase + p.logo.replace(/^\/logos\//, ''))}" alt="">` : '<i></i>'}<em>${esc(p.name)}</em></span>`).join('')}</div></div>` : '';
  return `<section class="tile cls"><div class="in"><div class="th"><div class="lbl">Classification</div></div><div class="cbody">${rows}${peers}</div></div></section>`;
}

const SW = ['#6f7fd8', '#3f9fb4', '#5fae7d', '#e0a34a', '#c77d9a', '#b08a3e', '#8f7fd0', '#a6a3b8'];
function moneyTile(c) {
  const bl = c.businessLines;
  if (!bl.length) return '';
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
  const std = groups.map((g) => block(g.lines, groups.length > 1 ? g.key || 'Other lines' : '')).join('<div style="height:1.1em"></div>');
  const frows = bl.map((b) => {
    const rev = b.revenue ? `<span${T(lineSrc(b))}>${money(b.revenue.amount, b.revenue.currency)}</span>${b.revenue.period ? `<small>${esc(b.revenue.period)}</small>` : ''}` : DASH;
    const op = b.operatingProfit ? `<span${T(profileSrc(c, [b.operatingProfit.label, b.operatingProfit.period, b.operatingProfit.note].filter(Boolean).join(' · ')))}>${money(b.operatingProfit.amount, b.operatingProfit.currency)}</span>${b.operatingProfit.label ? `<small>${esc(b.operatingProfit.label)}</small>` : ''}` : DASH;
    const mg = b.margin ? `<span${T(profileSrc(c, b.margin.label))}>${pct(b.margin.fraction * 100)}</span>` : DASH;
    return `<tr><td class="wrap">${esc(b.name)}${b.description ? `<div class="bl-how">${esc(b.description)}</div>` : ''}</td><td class="n">${rev}</td><td class="n">${op}</td><td class="n">${mg}</td><td class="wrap">${b.marketShare ? esc(b.marketShare) : DASH}</td></tr>`;
  }).join('');
  const full = sec('Each line in figures (company profile)', `<table class="tt ut"><tr><th>Line</th><th class="n">Revenue</th><th class="n">Operating profit</th><th class="n">Margin</th><th>Market share</th></tr>${frows}</table>`);
  const top = withShare.slice().sort((a, b) => b.share.fraction - a.share.fraction)[0];
  const peek = top ? `<b>${esc(top.name)}</b> ${pct(top.share.fraction * 100, 0)} of revenue` : `${bl.length} business line${bl.length > 1 ? 's' : ''}`;
  return tile('money', 'How it makes money', peek, std, full);
}

function brandsTile(c) {
  const br = c.brands;
  if (!br.length) return '';
  const short = (s) => (s ? s.split(/;\s/)[0] : '');
  const src = (b) => profileSrc(c, [b.share, b.note, b.source].filter(Boolean).join(' · '));
  const anyShare = br.some((b) => b.share);
  const rows = br.slice(0, 12).map((b) => `<tr${T(src(b))}><td>${esc(b.name)}</td><td class="wrap">${esc(b.segment || '')}</td>${anyShare ? `<td class="wrap">${b.share ? esc(short(b.share)) : DASH}</td>` : ''}</tr>`).join('');
  const std = `<div><table class="hk"><tr><th>Brand or subsidiary</th><th>Part of</th>${anyShare ? '<th>Share</th>' : ''}</tr>${rows}</table>${br.length > 12 ? `<div class="note" style="margin-top:.4em">${br.length - 12} more on expand</div>` : ''}</div>`;
  const frows = br.map((b) => `<tr${T(src(b))}><td>${esc(b.name)}</td><td class="wrap">${esc(b.segment || '')}</td><td class="wrap">${b.share ? esc(b.share) : DASH}</td><td class="wrap">${esc(b.note || '')}</td></tr>`).join('');
  const full = sec('Every brand and subsidiary (company profile)', `<table class="tt"><tr><th>Name</th><th>Part of</th><th>Share</th><th>Note</th></tr>${frows}</table>`);
  const peek = br.slice(0, 3).map((b) => `<b>${esc(b.name)}</b>`).join(' · ') + (br.length > 3 ? ` +${br.length - 3}` : '');
  return tile('brands', 'Brands &amp; subsidiaries', peek, std, full);
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
  if (!f) return '';
  const h = f.headline, cur = f.currency;
  const g = h.revenueGrowth || {};
  const om = h.operatingMargin;
  const tl = f.tile, cells = tl?.cells || [];
  const fmtOf = (x) => (v) => fmtUnit(x.unit, v, cur);
  // main tile: the last ten fiscal years, then the TTM bar (highlighted) when the basis is a TTM that is not itself the latest fiscal year
  const withTtm = tl && tl.basis.basis === 'TTM' && !tl.basis.isFy;
  const tileSeries = (x) => {
    const pts = x.annual.map((p) => ({ ...p, k: 'fiscal year' }));
    if (withTtm && x.ttm) { const t = x.ttm[x.ttm.length - 1]; pts.push({ ...t, p: 'TTM to ' + t.p, k: 'trailing twelve months', ax: 'TTM' }); }
    return { pts };
  };
  const cell = (x) => {
    const n = x.now, fm = fmtOf(x);
    const own = n && n.label !== tl.basis.label ? ` · ${esc(shortP(n.label))}` : '';
    const val = n ? (n.nm ? 'n.m.' : fm(n.v) + (n.computed ? '<sup class="calc">calc</sup>' : '')) : DASH;
    const title = [x.def ? `${x.label}: ${x.def}` : x.label, n && `${n.label}${n.note ? ' · ' + n.note : ''}`, n?.nm && 'n.m.: ' + n.reason, n?.src, !n && x.missing?.title].filter(Boolean).join('\n');
    const s = tileSeries(x), sp = bars(s.pts, fm);
    const lastP = s.pts[s.pts.length - 1];
    const ax = `<div class="fax"><span>${sp ? esc(shortP(s.pts[0].p)) : '&nbsp;'}</span><span>${sp ? esc(lastP.ax || shortP(lastP.p)) : ''}</span></div>`;
    let sub;
    // free cash flow: its year-ago change, and Mowgli's cash earnings on a second short line
    if (x.id === 'fcf' && x.cashEarnings) sub = `${n ? vsHtml(x, cur) || '&nbsp;' : '&nbsp;'}</em><em><span${T(`Cash earnings = free cash flow − stock-based pay (A4), ${x.cashEarnings.label}\n${x.cashEarnings.src}`)}>cash earnings ${money(x.cashEarnings.v, cur)}</span>`;
    else if (n) sub = vsHtml(x, cur);
    else if (x.fyFigure) sub = `<span${T(`${x.missing?.title || ''}\n${x.fyFigure.label}: ${x.fyFigure.src}`)}>${esc(shortP(x.fyFigure.label))}: ${fm(x.fyFigure.v)}</span>`;
    else sub = x.missing?.text ? `<span${T(x.missing.title)}>${esc(x.missing.text)}</span>` : '';
    return `<div class="fc"><span>${esc(x.label)}${own}</span><b${T(title)}>${val}</b>${sp || '<div class="fsp"></div>'}${ax}<em>${sub || '&nbsp;'}</em></div>`;
  };
  const notes = [];
  if (cells.length) notes.push(withTtm ? 'Bars: ten fiscal years, then the trailing twelve months (bright); change vs the twelve months a year earlier.' : 'Bars: ten fiscal years, the latest bright; change vs the year before.');
  const rn = c.valuationInputs?.readerNotes?.financials || [];
  if (c.isInsurer && !rn.some((x) => x.id === 'A9')) notes.push('Insurers collect premiums long before claims are paid, so a growing insurer’s cash flow looks better than its profit.');
  if (cur !== 'USD') notes.push(`Figures in ${cur}, as filed.`);
  const std = `<div class="v-self fgr">${cells.map(cell).join('')}</div><div class="v-self note fnt"${T(notes.join('\n'))}>${esc(notes.join(' '))}</div>${readerNotes(rn)}`;

  // expanded view: per measure, single quarters, the rolling TTM line and fiscal years
  const rng = (pts) => (pts?.length ? `${shortP(pts[0].p)}–${shortP(pts[pts.length - 1].p)}` : '');
  const anyQ = cells.find((x) => x.quarters), anyT = cells.find((x) => x.ttm);
  const trows = cells.map((x) => {
    const fm = fmtOf(x);
    return `<div class="ftr"><span${T(x.def || '')}>${esc(x.label)}</span><div>${x.quarters ? bars(x.quarters, fm, 'quarter') || DASH : ''}</div><div>${x.ttm ? tline(x.ttm, fm) || DASH : DASH}</div><div>${bars(x.annual, fm, 'fiscal year') || DASH}</div></div>`;
  }).join('');
  const trends = cells.length ? sec('Trends', `<div class="ftb"><div class="ftr fth"><span></span><span>Quarters<small>${anyQ ? esc(rng(anyQ.quarters)) : '&nbsp;'}</small></span><span${T('Trailing twelve months at each quarter end')}>Trailing year<small>${anyT ? esc(rng(anyT.ttm)) : '&nbsp;'}</small></span><span>Fiscal years<small>${esc(rng(cells[0].annual))}</small></span></div>${trows}</div>`) : '';

  const table = (t, title) => {
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
  const margins = [
    kv('Gross margin', h.grossMargin ? (h.grossMargin.nm ? 'n.m.' : pct(h.grossMargin.pct)) : '', h.grossMargin ? esc(h.grossMargin.label) + (h.grossMargin.computed ? ' · computed' : '') : '', h.grossMargin ? h.grossMargin.src : ''),
    kv('Operating margin', om ? (om.nm ? 'n.m.' : pct(om.pct)) : '', om ? esc(om.label) : '', om ? om.src : ''),
    kv('Net margin', h.netMargin ? (h.netMargin.nm ? 'n.m.' : pct(h.netMargin.pct)) : '', h.netMargin ? esc(h.netMargin.label) : '', h.netMargin ? h.netMargin.src : ''),
  ].join('');
  const full = `<div class="v-self" style="flex-direction:column">${trends}${sec('Margins', margins)}${table(f.annual, 'Annual · growth vs the year before')}${table(f.quarterly, 'Quarterly · growth vs the same quarter a year earlier')}</div>`;
  const lbl = `<span class="v-self">Financials${tl ? ' · ' + esc(tl.basis.label) : h.revenue ? ' · ' + esc(h.revenue.label) : ''}</span>`;
  const door = '<span class="door soon" title="coming">Full financials (coming)</span>';
  const peek = [h.revenue && `Revenue <b>${money(h.revenue.v, cur)}</b>`, g.quarter?.pct != null && `<b class="${cls(g.quarter.pct)}">${spct(g.quarter.pct)}</b> last quarter`, om && om.pct != null && `operating margin <b>${pct(om.pct)}</b>`].filter(Boolean).join(' · ');
  return tile('fin', lbl, peek, std, full, door);
}

/* ---------- valuation box (D86) and geography box (D71) ---------- */
const mfmt = (m, v) => (m.kind === 'yield' ? pct(v, 1) : typeof v === 'number' ? (v < 0 ? '−' : '') + Math.abs(v).toFixed(Math.abs(v) >= 100 ? 0 : 1) + '×' : null);
const okYear = (m) => (y) => (m.kind === 'yield' ? y.pct : y.v) != null;
function valTile(c) {
  const box = c.valuationInputs?.box;
  if (!box) return '';
  if (box.status !== 'ok') return tile('val', 'Valuation', esc(box.reason || ''), `<div class="note">${esc(box.reason || 'Not computed.')}</div>`, '');
  const ms = [...box.measures].sort((a, b) => (b.headline ? 1 : 0) - (a.headline ? 1 : 0));
  const basisTxt = box.basis.basis === 'FY' ? `${box.basis.label} annual report` : box.basis.label;
  const catName = box.peers?.cat?.name || 'Cat';
  const range = (a, b) => (a ? (a === b ? `priced ${a}` : `priced ${a} to ${b}`) : '');
  const onFY = (k) => (k ? `; ${k} on latest fiscal year` : '');
  const named = (m, pe) => (pe?.values?.length ? pe.values.map((x) => `${x.ticker} ${mfmt(m, x.value)}${x.basis === 'FY' ? ' FY' : ''}`).join(' · ') : '');
  const detail = [];
  const rows = ms.map((m) => {
    const h = box.history?.[m.id], pe = box.peers?.measures?.[m.id];
    // D86: a Sub median from 3 peers up; below that the whole Cat's median is the one figure shown, named Sub peers on hover and in the expanded view
    const subMed = pe && pe.median != null, catMed = !subMed && pe?.cat?.median != null;
    const nm = pe && !subMed ? named(m, pe) : '';
    const peer = subMed ? mfmt(m, pe.median) : catMed ? `<small>Cat</small>${mfmt(m, pe.cat.median)}` : DASH;
    const catTitle = pe?.cat ? `${catName}: ${pe.cat.n} of ${pe.cat.m} companies have it${pe.cat.median != null ? `, median ${mfmt(m, pe.cat.median)}, ${range(box.peers.cat?.pricedFrom, box.peers.cat?.pricedTo)}${onFY(pe.cat.onFY)}` : ', too few for a median'}` : '';
    const peerTitle = !pe ? 'No peer group' : subMed
      ? `Median of ${pe.n} peers in ${box.peers.sub}, ${range(box.peers.pricedFrom, box.peers.pricedTo)}${onFY(pe.onFY)}`
      : [`Only ${pe.n} of ${pe.m} peers in ${box.peers.sub} have this figure; a median needs at least ${box.peers.minimum}`, nm && `Named: ${nm}${pe.onFY ? ' (FY = latest fiscal year)' : ''}`, catTitle].filter(Boolean).join('\n');
    const have = h && h.n && h.low != null;
    const ys = have ? h.years.filter(okYear(m)) : [];
    const span = have ? `${ys[0]?.period} to ${ys[ys.length - 1]?.period}` : '';
    const hist = have ? `Own range, ${h.n} fiscal years ${span}, each at its fiscal-year-end price\nLow ${mfmt(m, h.low)} · median ${mfmt(m, h.median)} · high ${mfmt(m, h.high)}` : 'No 10-year history available';
    const tag = m.basis ? `<small class="vtag"${T(`${m.basis.label} annual report`)}>${esc(m.basis.label)}</small>` : '';
    detail.push(`<tr${T(m.long || '')}><td>${esc(m.name)}${tag}</td><td class="n">${have ? `${mfmt(m, h.low)} · ${mfmt(m, h.median)} · ${mfmt(m, h.high)}<small>${esc(span)}</small>` : DASH}</td><td class="n">${subMed ? `${mfmt(m, pe.median)}<small>median of ${pe.n}</small>` : nm ? `${esc(nm)}<small>${pe.n} of ${pe.m}, too few for a median</small>` : DASH}</td><td class="n">${pe?.cat?.median != null ? `${mfmt(m, pe.cat.median)}<small>${pe.cat.n} of ${pe.cat.m}</small>` : DASH}</td></tr>`);
    return `<div class="vrow${m.headline ? ' hd' : ''}" id="vb-${esc(m.id)}"${T(m.long || '')}>
      <span class="vn">${esc(m.name)}${tag}</span><b class="vv">${DASH}</b>
      <span class="vr"${T(hist)}><span class="vbar" data-lo="${have ? h.low : ''}" data-md="${have ? h.median : ''}" data-hi="${have ? h.high : ''}"><i class="mid"></i><i class="now"></i></span></span>
      <span class="vp"${T(peerTitle)}>${peer}</span></div>`;
  }).join('');
  const std = `<div class="vhead"><span></span><span>Today</span><span>10-year range</span><span>Peers</span></div>${rows}<div class="note vnote">${esc(basisTxt)} · live price</div>${readerNotes(c.valuationInputs.readerNotes?.valuation)}`;
  const dt = `<table class="tt vdt"><tr><th>Measure</th><th class="n">Own low · median · high</th><th class="n"${T(box.peers?.sub || '')}>Sub peers</th><th class="n"${T(catName)}>Cat median</th></tr>${detail.join('')}</table>`;
  const prices = box.peers ? `Peers ${range(box.peers.pricedFrom, box.peers.pricedTo)}. ` : '';
  const src = Object.entries(box.sources || {}).map(([k, x]) => `<div class="note" style="white-space:pre-line"><b>${esc(k)}</b>: ${esc(String(x))}</div>`).join('');
  const full = sec('Range and peers', dt + `<div class="note" style="margin-top:.4em">Today at the live price; own range at each fiscal-year-end price. ${esc(prices)}FY = latest fiscal year.</div>`) + sec('Where the figures come from', `<div class="note">Basis ${esc(basisTxt)}. ${box.historyPrices ? esc(box.historyPrices.source) + '.' : ''}</div>${src}`);
  return tile('val', 'Valuation', '<span id="vb-peek">—</span>', std, full);
}
function fillValuation(q) {
  const box = C.valuationInputs?.box;
  const now = q?.valuation?.valuationBox;
  if (!box || box.status !== 'ok' || !now || now.status !== 'ok') return;
  for (const m of now.measures) {
    const row = document.getElementById('vb-' + m.id); if (!row) continue;
    const def = box.measures.find((x) => x.id === m.id);
    const v = def.kind === 'yield' ? m.pct : m.v;
    $('.vv', row).innerHTML = v != null ? mfmt(def, v) : m.nm ? `<span${T('n.m.: ' + (m.reason || ''))}>n.m.</span>` : `<span${T(m.reason || '')}>—</span>`;
    const bar = $('.vbar', row), lo = parseFloat(bar.dataset.lo), hi = parseFloat(bar.dataset.hi), md = parseFloat(bar.dataset.md);
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) { bar.style.visibility = 'hidden'; continue; }
    const a = v != null ? Math.min(lo, v) : lo, b = v != null ? Math.max(hi, v) : hi, at = (x) => ((x - a) / (b - a) * 100).toFixed(1) + '%';
    $('.mid', bar).style.left = at(md);
    const nw = $('.now', bar); if (v != null) nw.style.left = at(v); else nw.style.display = 'none';
    bar.style.setProperty('--lo', at(lo)); bar.style.setProperty('--hi', at(hi));
  }
  const hd = box.measures.find((x) => x.headline), hn = hd && now.measures.find((m) => m.id === hd.id);
  const pk = document.getElementById('vb-peek');
  if (pk && hn) { const v = hd.kind === 'yield' ? hn.pct : hn.v; pk.innerHTML = v != null ? `${esc(hd.name)} <b>${mfmt(hd, v)}</b>` : ''; }
}

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
  if (!g) return '';
  if (g.usOnly) {
    const u = g.usOnly;
    return tile('geo', 'Revenue by region', 'United States only', `<div class="note" style="font-size:.88em;color:var(--ink2)"${T(u.note || '')}>${u.substantially ? 'Substantially all revenue is in the United States' : 'Revenue is entirely in the United States'}.</div><div class="note">${esc(u.form || '')} filed ${esc(u.filed || '')}: “${esc(String(u.text).slice(0, 200))}”</div>`, '');
  }
  const y = (g.years || [])[0];
  if (!y || !y.regions?.length) return '';
  const regs = [...y.regions].sort((a, b) => b.share - a.share);
  const srcT = (r) => `${r.label}: ${money(r.value, y.currency)} of ${money(y.total, y.currency)}\n${y.src?.form || ''} filed ${y.src?.filed || ''} · accession ${y.src?.accn || ''} · ${y.src?.tag || ''}`;
  const rows = regs.map((r, i) => `<div class="grow"${T(srcT(r))}><span class="gn"><i style="background:${SW[i % SW.length]}"></i>${esc(r.label)}</span><span class="gbar"><i style="width:${(r.share * 100).toFixed(1)}%;background:${SW[i % SW.length]}"></i></span><b>${pct(r.share * 100, r.share < .1 ? 1 : 0)}</b><span class="gm">${money(r.value, y.currency)}</span></div>`).join('');
  const std = `<div class="geowrap"><div class="georows">${rows}</div>${geoMap(regs, y)}</div><div class="note vnote">${esc(y.period)}, ${esc(y.src?.form || '')} annual report, revenue ${money(y.total, y.currency)}${y.complete ? '' : '. The regions shown do not add up to all revenue.'}</div>`;
  const others = (g.years || []).slice(1).map((yy) => `<div class="efq"><h5>${esc(yy.period)} · revenue ${money(yy.total, yy.currency)}</h5>${[...yy.regions].sort((a, b) => b.share - a.share).map((r) => `<div class="kv"><span>${esc(r.label)}</span><b>${pct(r.share * 100, 1)}</b><i>${money(r.value, yy.currency)}</i></div>`).join('')}</div>`).join('');
  return tile('geo', 'Revenue by region', `<b>${esc(regs[0].label)}</b> ${pct(regs[0].share * 100, 0)}`, std, others ? sec('Earlier years', others) : '');
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
function expectationRows(q) {
  if (!q) return '';
  const rows = (q.items || []).filter((it) => typeof it.expected === 'number' && typeof it.actual === 'number').map((it) => {
    const rc = resultClass(it.result), gp = it.gap != null && it.expected ? (it.gap / Math.abs(it.expected)) * 100 : null;
    const w = gp != null ? Math.min(50, Math.max(2, Math.abs(gp) * 5)) : 0;
    const bar = gp != null ? `<span class="gb"><i class="${rc}" style="${gp >= 0 ? 'left' : 'right'}:50%;width:${w.toFixed(1)}%"></i></span>` : '';
    const gapTxt = it.gap != null ? `${it.gap > 0 ? '+' : ''}${metricMoney(it.metric, it.gap)}${gp != null ? ', ' + spct(gp) : ''}` : '';
    return `<div class="er2"${T(`Expected: ${it.expectedBy || 'source not named'}\n${it.source || ''}`)}><span>${esc(it.metric.replace(/\s*\(\$[MB]\)/, ''))}</span><span><span class="bd ${rc}">${esc(String(it.result).toUpperCase())}</span>${bar}<small class="g-${rc}">${esc(gapTxt)}</small> <span class="efig">${metricMoney(it.metric, it.actual)} vs ${metricMoney(it.metric, it.expected)}</span></span></div>`;
  }).join('');
  const gd = q.guidance ? `<div class="er2"${T((q.guidance.prior ? 'Prior: ' + q.guidance.prior + '\n' : '') + (q.guidance.source || ''))}><span>Guidance</span><span><span class="bd ${resultClass(q.guidance.change)}">${esc(String(q.guidance.change || '').toUpperCase())}</span> <small>${esc(q.guidance.new || '')}</small></span></div>` : '';
  return rows + gd;
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
  if (!qs.length) return '';
  const cur = c.fin.currency, latest = qs[0];
  const E = c.earnings, byLabel = new Map((E?.quarters || []).map((q) => [q.period, q]));
  const eq = byLabel.get(latest.label);
  const briefs = (eq?.briefs || []).slice(0, 3).map((b) => `<li${T(b.text + (b.source ? '\n' + b.source : ''))}><b>${esc(b.text.split(/[:;]/)[0])}</b>${b.text.includes(':') ? ' · ' + esc(b.text.split(':').slice(1).join(':').trim().split(/;\s|\.\s/)[0]) : ''}</li>`).join('');
  let upNext = '';
  const nx = E?.next;
  if (nx && nx.expectedDate && nx.dateSource) {
    const exp = (nx.items || []).filter((i) => typeof i.expected === 'number' && i.source).map((i) => `<span${T(`${i.expectedBy || ''}\n${i.source}`)}>${esc(i.metric)} expected <b>${metricMoney(/EPS/i.test(i.metric) ? 'EPS' : i.metric, i.expected)}</b></span>`).join(' · ');
    upNext = `<div class="enx"${T(nx.dateSource)}>Up next · <b>${esc(shortDate(nx.expectedDate))}</b>${nx.dateConfirmed ? '' : ' (expected, not confirmed)'}${exp ? ' · ' + exp : ''}</div>`;
  }
  const std = `<div class="ers">${actualRows(latest, cur)}${expectationRows(eq)}</div>${briefs ? `<ul class="eb">${briefs}</ul>` : ''}${reactionLine(eq, E?.reactionNote)}${upNext}`;
  const efq = qs.slice(1).map((q) => {
    const e = byLabel.get(q.label);
    const efb = (e?.briefs || []).map((b) => `<li${T(b.source)}>${esc(b.text)}</li>`).join('');
    return `<div class="efq"><h5>${esc(q.label)}${e?.reportDate ? ' · ' + esc(shortDate(e.reportDate)) : q.filed ? ` · ${esc(q.form || '')} filed ${esc(shortDate(q.filed))}` : ''}</h5>${actualRows(q, cur)}${expectationRows(e)}${e ? reactionLine(e, E.reactionNote).replace('class="er1"', 'class="er2"') : ''}${efb ? `<ul class="efb">${efb}</ul>` : ''}${e?.reaction?.note ? `<div class="ecov">${esc(e.reaction.note)}</div>` : ''}</div>`;
  }).join('');
  const full = efq ? `<div class="efqs">${efq}</div>` : '';
  const when = eq?.reportDate ? `, ${shortDate(eq.reportDate).replace(/ \d{4}$/, '')}` : '';
  const peek = [latest.revenue && `Revenue <b>${money(latest.revenue.v, cur)}</b>${latest.revenue.yoy?.pct != null ? ` <b class="${cls(latest.revenue.yoy.pct)}">${spct(latest.revenue.yoy.pct)}</b>` : ''}`, latest.eps && `EPS <b>${perShare(latest.eps.v, cur)}</b>`].filter(Boolean).join(' · ');
  return tile('earn', `Earnings · ${esc(latest.label)}${esc(when)}`, peek, std, full);
}

function nextTile(c) {
  const w = c.whatsNext;
  if (!w.length) return '';
  const src = (x) => profileSrc(c, [x.note, x.source].filter(Boolean).join(' · '));
  const std = `<div>${w.slice(0, 4).map((x) => `<div class="nx"${T(src(x))}><time>${esc(x.when)}</time><div>${esc(x.text.length > 150 ? x.text.slice(0, 147) + '…' : x.text)}</div></div>`).join('')}</div>`;
  const full = sec('Everything dated in the company profile', w.map((x) => `<div class="nx"${T(src(x))}><time>${esc(x.when)}</time><div>${esc(x.text)}${x.note ? `<div class="note">${esc(x.note)}</div>` : ''}${x.source ? `<div class="note">Source: ${esc(x.source)}</div>` : ''}</div></div>`).join(''));
  return tile('next', 'What’s next', `<b>${esc(w[0].when)}</b> ${esc(w[0].text.slice(0, 90))}${w[0].text.length > 90 ? '…' : ''}`, std, full);
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
function renderQuote(q) {
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
  set('v-by', `${prevTxt} / ${nextTxt}`, [bp ? 'Prev 12: ' + bp.src : 'Prev 12: no buyback figure for the last 12 months in the filings data', bn ? 'Next 12: ' + bn.src : 'Next 12: ' + (v.buybackNextNote || 'no dated authorisation stated')].join('\n\n'));
  const pk = document.getElementById('v-peek');
  if (pk && mv) pk.innerHTML = `Worth <b>${money(mv.v)}</b>${C.hq ? ' · ' + esc(C.hq.text) : ''}`;
  const line = document.getElementById('v-mvline');
  if (line && mv) line.innerHTML = kv(`Market value: today's price${C.valuationInputs.sharesPerADS ? ' per ADS ÷ ' + C.valuationInputs.sharesPerADS : ''} × shares at ${esc(shortDate(mv.sharesDate))}`, money(mv.v), 'computed', mv.src);
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

  const tiles = { company: basicsTile(c), cls: classTile(c), money: moneyTile(c), brands: brandsTile(c), fin: finTile(c), val: valTile(c), geo: geoTile(c), next: nextTile(c), earn: earnTile(c) };
  const field = $('#field');
  // three content-sized columns; each tile goes to the shortest column, so an absent tile leaves no gap
  field.innerHTML = '<div class="fcol"></div><div class="fcol"></div><div class="fcol"></div>';
  const cols = [...field.children];
  for (const id of ['company', 'cls', 'money', 'next', 'brands', 'fin', 'val', 'geo', 'earn']) {
    if (!tiles[id]) continue;
    const tmp = document.createElement('div'); tmp.innerHTML = tiles[id];
    // the Classification box always sits directly under Basics, in its column
    const target = id === 'cls' && tiles.company ? cols.find((x) => x.querySelector('.tile.company')) : cols.reduce((a, x) => (x.offsetHeight < a.offsetHeight ? x : a));
    target.appendChild(tmp.firstElementChild);
  }
  cols.forEach((x, i) => { if (!x.children.length) x.remove(); else [...x.children].forEach((t) => { t.dataset.c = i; }); });
  field.querySelectorAll('.tile').forEach((t) => t.addEventListener('click', (e) => { if (e.target.closest('a') || !t.dataset.id) return; setOpen(t.dataset.id); }));

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

addEventListener('resize', () => { sizeBand(); drawStars(); });
addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) setOpen(open); });
setupSwitcher();
document.body.classList.add('instant');
fetch(MG.companyUrl(ticker)).then(async (r) => {
  const j = await r.json();
  if (!r.ok) { applyTheme({ sky: 'default' }); document.body.insertAdjacentHTML('beforeend', `<div class="err">${esc(j.error || 'Not found')}</div>`); return; }
  render(j);
  loadQuote();
  setInterval(loadQuote, 30000);
  requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.remove('instant')));
}).catch((e) => { document.body.insertAdjacentHTML('beforeend', `<div class="err">Could not load: ${esc(e.message)}</div>`); });
})();
