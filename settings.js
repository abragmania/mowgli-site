/* D90 switchboard settings page (/settings): every company-page metric by box and group with Adam's switches.
   Rows: label · OFF/ON/MAIN · form · order · headline · source line · status chip (· reset on a type tab).
   Tabs: Global edits settings.metrics; Bank / REIT / Insurer edit settings.byType[type] on top of global.
   Local server: each click saves at once (rapid clicks batched) through PUT /api/switchboard, and open company tabs
   redraw through BroadcastChannel('mowgli-switchboard'). The published copy is read-only: the build cuts everything
   between the local-write markers out of this file (server/publish/build.js readOnlySettingsJs). */
(() => {
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const $ = (id) => document.getElementById(id);
const READONLY = MG.isStatic;
const TABS = [['global', 'Global'], ['bank', 'Bank'], ['reit', 'REIT'], ['insurer', 'Insurer']];
const TYPE_NAME = { ordinary: 'ordinary', bank: 'banks', reit: 'REITs', insurer: 'insurers' };
// plain names for Adam; the technical field and pointer stay in the hover title
const PROVIDER = { secFacts: 'SEC filings', secInstance: 'SEC filings', profile: 'Mowgli research', earnings: 'Mowgli research', quote: 'Live price', fyPrices: 'Yahoo prices', mowgliClass: 'Mowgli Cats', mowgliRules: 'Mowgli', logos: 'Logo files' };
const FORM_NAME = { number: 'Number', chart: 'Chart', both: 'Both', table: 'Table', list: 'List', text: 'Text', map: 'Map', tableAndMap: 'Table + map', image: 'Image', peek: 'Peek' };
const GROUP_RENAME = { history: 'Extra figures (calculated, not shown yet)' };
const GROUP_NAME = { cells: 'Main figures', peek: 'Collapsed peek only', latest: 'Latest', earlier: 'Earlier', measures: 'Measures', lines: 'Lines', regions: 'Regions' };
const FIELDS = ['state', 'form', 'order', 'spot', 'spotOrder'];
// the price fills these on the company page even when the payload has no data (public/company.js ALWAYS)
const ALWAYS = ['marketValue', 'dividendYield', 'buybackYield', 'sharesValue.marketValueLine'];

let LIB = null, SB = null, CAT = null, IDX = null, tab = 'global', onlyOv = false, PV = null, companies = [];

/* ---------- what a row shows ---------- */
const metricsOf = (boxId) => CAT.metrics.filter((m) => m.box === boxId);
function eff(m, t = tab) {
  const r = { ...(m.default || {}) };
  for (const src of [SB.settings.metrics?.[m.id], t !== 'global' ? SB.settings.byType?.[t]?.[m.id] : null]) if (src) for (const k of FIELDS) if (k in src) r[k] = src[k];
  r.state ||= 'OFF';
  return r;
}
const overridden = (m) => tab !== 'global' && !!SB.settings.byType?.[tab]?.[m.id];
const ordNum = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : Infinity);
const sortRows = (ms) => ms.slice().sort((a, b) => ordNum(eff(a).order) - ordNum(eff(b).order) || IDX.get(a.id) - IDX.get(b.id));
const movable = (m) => m.status === 'built';
const heroable = (m) => m.status === 'built' && (m.kind === 'number' || m.kind === 'item');
function typesNote(m) {
  const all = CAT.meta.vocab.types || [], ts = m.appliesTo?.types || [];
  if (ts.length === all.length || !ts.length) return ts.length ? '' : 'no type yet';
  if (ts.length === 1) return `${TYPE_NAME[ts[0]] || ts[0]} only`;
  return `not ${all.filter((t) => !ts.includes(t)).map((t) => TYPE_NAME[t] || t).join(', ')}`;
}
// periods in plain words: "10 years + quarters", "trailing 12 months"
function plainPeriods(p) {
  if (!p) return '';
  const out = [], y = /(\d+) fiscal years/.exec(p);
  if (y) out.push(`${y[1]} years`);
  if (/quarter/i.test(p)) out.push('quarters');
  if (!out.length && /\bTTM\b|trailing/i.test(p)) out.push('trailing 12 months');
  if (!out.length && /latest FY/i.test(p)) out.push('latest year');
  return out.join(' + ');
}
function sourceLine(m) {
  const s = m.source || {};
  const tags = [];
  if (m.substituteFor) tags.push(`<span class="tg" title="${esc(m.substituteWhen || '')}">stands in for ${esc(labelOf(m.substituteFor))}</span>`);
  const tn = typesNote(m);
  if (tn) tags.push(`<span class="tg ty2">${esc(tn)}</span>`);
  const provs = s.provider ? [...new Set(String(s.provider).split(',').map((p) => PROVIDER[p] || p))] : [];
  const prov = provs.length ? provs.join(' + ') : (m.status === 'built' ? 'Mowgli' : 'no source yet');
  const bits = [plainPeriods(s.periods), m.computed === true ? 'calculated' : typeof m.computed === 'string' ? 'sometimes calculated' : ''].filter(Boolean);
  return { html: `${tags.join('')}<span class="pr">${esc(prov)}</span>${bits.length ? ` · ${esc(bits.join(' · '))}` : ''}`, title: [prov, s.field, s.periods, typeof m.computed === 'string' ? `calculated ${m.computed}` : m.computed ? 'calculated by Mowgli' : '', m.substituteWhen ? `stands in: ${m.substituteWhen}` : '', `id: ${m.id}`].filter(Boolean).join('\n') };
}
// one line per row: a long catalog label shows only its lead (before the colon or bracket); the full label is in the hover title
const SHORT = { 'Company "adjusted" earnings with stock pay put back as a cost': 'Adjusted earnings, stock pay as a cost' };
const shortLabel = (l) => SHORT[l] || (l.length > 40 ? l.split(/: | \(/)[0] : l);
const labelOf = (id) => CAT.metrics.find((m) => m.id === id)?.label || id;

/* ---------- preview as a company: its real periods and sources, and where each row lands for it ---------- */
const has = (v) => !(v == null || v === false || v === '' || (Array.isArray(v) && !v.length));
function at(payload, p) {
  return p.split('.').reduce((o, part) => {
    if (o == null) return undefined;
    const x = /^([\w$]+)(?:\[id=([^\]]+)\])?$/.exec(part);
    if (!x) return undefined;
    const v = o[x[1]];
    return x[2] === undefined ? v : Array.isArray(v) ? v.find((y) => y?.id === x[2]) : undefined;
  }, payload);
}
const first = (s) => String(s || '').split('\n').find((l) => l.trim()) || '';
function srcText(s) {
  if (!s) return '';
  if (typeof s === 'string') { const n = s.split('\n').filter((l) => /\S/.test(l) && !/^\s/.test(l)).length; return first(s) + (n > 1 ? ` (+${n - 1} more)` : ''); }
  if (typeof s === 'object') return [s.form && `${s.form}${s.filed ? ` filed ${s.filed}` : ''}`, s.tag, s.period].filter(Boolean).join(' · ');
  return '';
}
function summary(v) {
  if (v == null) return '';
  if (typeof v !== 'object') return typeof v === 'string' ? (v.length > 90 ? v.slice(0, 90) + '…' : v) : String(v);
  if (Array.isArray(v)) {
    const a = v[0], b = v[v.length - 1];
    const lab = (x) => (x && typeof x === 'object' ? x.label || x.period || x.when || x.name || '' : typeof x === 'string' ? x : '');
    const span = lab(a) && lab(b) && lab(a) !== lab(b) ? `${lab(a)} … ${lab(b)}` : lab(a);
    return [`${v.length} item${v.length === 1 ? '' : 's'}`, span, srcText(a?.src || a?.source)].filter(Boolean).join(' · ');
  }
  const o = v.now && typeof v.now === 'object' ? v.now : v;
  const cells = Array.isArray(v.cells) ? v.cells : null;
  const period = cells ? `${cells.length} periods, latest` : o.label || o.period || (o.basis && o.basis !== o.label ? o.basis : '');
  const asOf = o.asOf || o.date || o.end || o.fetched || o.filed || '';
  const src = srcText(o.src || o.source || cells?.[cells.length - 1]?.src) || (o.text ? first(o.text) : '');
  return [period, asOf && !String(period).includes(asOf) ? `as of ${asOf}` : '', src].filter(Boolean).join(' · ');
}
function previewRow(m) {
  if (!PV) return null;
  const { c, res, absent } = PV;
  let where = '';
  for (const b of res.boxes) {
    if (b.main.includes(m.id)) where = 'main';
    else if (b.on.includes(m.id)) where = 'expanded';
    else if (b.peek.includes(m.id)) where = 'peek';
    if (where) break;
  }
  if (!where) {
    if (m.status === 'dropped') where = 'dropped';
    else if (m.status !== 'built' || CAT.boxes.find((b) => b.id === m.box)?.status !== 'built') where = 'not built';
    else if (!(m.appliesTo?.types || []).includes(c.type)) where = `not ${c.type}`;
    else if (absent.has(m.id)) where = 'no data';
    else if (eff(m, typeTab(c.type)).state === 'OFF') where = 'off';
    else where = 'hidden';
  }
  const v = (m.payload || []).map((p) => at(c, p)).find(has);
  return { where, text: v === undefined ? '' : summary(v) };
}
const typeTab = (t) => (TABS.some(([k]) => k === t) ? t : 'global');

/* ---------- drawing ---------- */
const dis = READONLY ? ' disabled' : '';
function seg(cls, act, id, opts, cur, off = []) {
  return `<span class="seg ${cls}">${opts.map((o) => `<button type="button" data-act="${act}" data-id="${esc(id)}" data-v="${esc(o)}" class="${o === cur ? 'on ' : ''}v-${esc(o)}"${READONLY || off.includes(o) ? ' disabled' : ''}>${esc(act === 'form' ? FORM_NAME[o] || o : o)}</button>`).join('')}</span>`;
}
function rowHtml(m, list, i) {
  const e = eff(m), built = m.status === 'built', dropped = m.status === 'dropped';
  const nb = !built && !dropped;
  const cls = ['row', nb ? 'nb' : '', dropped ? 'dr' : '', overridden(m) ? 'ov' : '', tab !== 'global' && !(m.appliesTo?.types || []).includes(tab) ? 'na' : ''].filter(Boolean).join(' ');
  const lock = m.locked ? ['OFF'] : [];
  const sw = dropped ? '' : nb ? seg('st', 'state', m.id, ['OFF', 'ON', 'MAIN'], 'OFF', ['OFF', 'ON', 'MAIN']) : seg('st', 'state', m.id, ['OFF', 'ON', 'MAIN'], e.state, lock);
  const forms = m.forms || [];
  const fm = dropped ? '' : forms.length > 1 && built ? seg('fm', 'form', m.id, forms, e.form) : `<span class="one">${esc(forms.map((f) => FORM_NAME[f] || f).join(' / '))}</span>`;
  const mv = list.filter(movable), k = mv.indexOf(m);
  const arr = movable(m) ? `<span class="arr"><button type="button" data-act="up" data-id="${esc(m.id)}" title="Move up"${READONLY || k <= 0 ? ' disabled' : ''}>▲</button><button type="button" data-act="down" data-id="${esc(m.id)}" title="Move down"${READONLY || k >= mv.length - 1 ? ' disabled' : ''}>▼</button></span>` : '<span></span>';
  const heroOn = e.spot === 'hero';
  const heroNo = heroOn ? heroList().findIndex((x) => x.id === m.id) + 1 : 0;
  const hero = heroable(m) ? `<button type="button" class="hero${heroOn ? ' on' : ''}" data-act="hero" data-id="${esc(m.id)}" title="${heroOn ? 'In the headline strip under the logo; click to take it out' : 'Put it in the headline strip under the logo'}"${dis}>${heroOn ? `Headline ${heroNo}` : 'Headline'}</button>` : '<span></span>';
  let src = sourceLine(m), chip;
  const pv = previewRow(m);
  if (pv) {
    src = { html: pv.text ? `<span class="pr">${esc(PV.c.ticker)}</span> · ${esc(pv.text)}` : `<span class="pr">${esc(PV.c.ticker)}</span> · ${pv.where === 'no data' ? 'no data for this company' : '—'}`, title: `${pv.text}\n\n${src.title}` };
    chip = `<span class="ch c-${pv.where.replace(/\s/g, '')}" title="Where it lands on ${esc(PV.c.ticker)}'s page">${esc(pv.where)}</span>`;
  } else {
    const st = dropped ? 'dropped' : nb ? 'not built' : m.locked ? 'locked' : 'built';
    chip = `<span class="ch c-${st.replace(/\s/g, '')}">${st}</span>`;
  }
  const rs = tab === 'global' ? '' : overridden(m) ? `<button type="button" class="rs" data-act="reset" data-id="${esc(m.id)}" title="Drop the ${esc(tab)} override; follow the global switch"${dis}>Reset</button>` : '<span></span>';
  const extra = m.peekOnly ? '<i>peek</i>' : m.kind === 'section' ? '<i>section</i>' : '';
  return `<div class="${cls}" data-row="${esc(m.id)}"><span class="lb" title="${esc(m.label)} (${esc(m.id)})">${esc(shortLabel(m.label))}${extra}</span>${sw || '<span></span>'}${fm || '<span></span>'}${arr}${hero}<span class="src" title="${esc(src.title)}">${src.html}</span>${chip}${rs}</div>`;
}
const HEAD = () => `<div class="row hd"><span>Item</span><span>Switch</span><span>Form</span><span>Order</span><span>Headline</span><span>${PV ? `${esc(PV.c.ticker)}: period · source` : 'Source · periods'}</span><span>${PV ? 'On its page' : 'Status'}</span>${tab === 'global' ? '' : '<span></span>'}</div>`;
function boxHtml(b) {
  let ms = metricsOf(b.id);
  if (onlyOv && tab !== 'global') ms = ms.filter(overridden);
  if (!ms.length) return '';
  const nbx = b.status !== 'built';
  const counts = { MAIN: 0, ON: 0 }; let notBuilt = 0;
  for (const m of ms) { if (m.status === 'built') { const s = eff(m).state; if (s in counts) counts[s]++; } else if (m.status !== 'dropped') notBuilt++; }
  const sum = nbx ? `${ms.length} items` : [`${counts.MAIN} main`, `${counts.ON} expanded`, notBuilt ? `${notBuilt} not built` : ''].filter(Boolean).join(' · ');
  let body = '';
  for (const g of b.groups || [{ id: null }]) {
    const gm = sortRows(ms.filter((m) => m.group === g.id || (g.id === null && !m.group)));
    if (!gm.length) continue;
    // an unnamed group gets a heading only when its box has more than one group
    const gname = GROUP_RENAME[g.id] || g.name || ((b.groups || []).length > 1 ? GROUP_NAME[g.id] || g.id : '');
    body += `${gname ? `<div class="gh">${esc(gname)}</div>` : ''}${gm.map((m, i) => rowHtml(m, gm, i)).join('')}`;
  }
  const loose = sortRows(ms.filter((m) => !(b.groups || []).some((g) => g.id === m.group)));
  if (loose.length && b.groups) body += `<div class="gh">Other</div>${loose.map((m, i) => rowHtml(m, loose, i)).join('')}`;
  const chip = nbx ? '<span class="ch c-notbuilt">not built</span>' : b.locked ? '<span class="ch c-locked">locked</span>' : '';
  return `<section class="bx pad${nbx ? ' nbx' : ''}" id="b-${esc(b.id)}"><h2>${esc(b.name || b.id)}<em>${esc(sum)}</em>${chip}</h2>${HEAD()}${body}</section>`;
}
function boxOrder() {
  const listed = (SB.settings.boxes?.order || []).filter((id) => CAT.boxes.some((b) => b.id === id));
  const rest = CAT.boxes.filter((b) => (b.page || 'company') === 'company' && !listed.includes(b.id)).sort((a, b) => ordNum(a.order) - ordNum(b.order)).map((b) => b.id);
  return [...listed, ...rest].map((id) => CAT.boxes.find((b) => b.id === id)).filter((b) => (b.page || 'company') === 'company');
}
function heroList() {
  return CAT.metrics.filter((m) => heroable(m) && eff(m).spot === 'hero')
    .sort((a, b) => ordNum(eff(a).spotOrder) - ordNum(eff(b).spotOrder) || IDX.get(a.id) - IDX.get(b.id));
}
function railHtml() {
  const boxes = boxOrder(), pins = SB.settings.boxes?.pins || {};
  const built = boxes.filter((b) => b.status === 'built');
  const movableBoxes = boxes.filter((b) => b.status === 'built');
  const brow = (b) => {
    const nb = b.status !== 'built', k = movableBoxes.indexOf(b);
    const arr = nb ? '<span></span>' : `<span class="arr"><button type="button" data-act="bup" data-id="${esc(b.id)}" title="Earlier on the page"${READONLY || k <= 0 ? ' disabled' : ''}>▲</button><button type="button" data-act="bdown" data-id="${esc(b.id)}" title="Later on the page"${READONLY || k >= movableBoxes.length - 1 ? ' disabled' : ''}>▼</button></span>`;
    const pin = nb ? '<span class="none">not built</span>' : `<select data-act="pin" data-id="${esc(b.id)}" title="Place this box directly under another, in its column"${dis}><option value="">own place</option>${built.filter((x) => x.id !== b.id).map((x) => `<option value="${esc(x.id)}"${pins[b.id]?.under === x.id ? ' selected' : ''}>under ${esc(x.name || x.id)}</option>`).join('')}</select>`;
    return `<div class="br${nb ? ' nb' : ''}">${arr}<a href="#b-${esc(b.id)}">${esc(b.name || b.id)}</a>${pin}</div>`;
  };
  const hs = heroList();
  const hrow = (m, k) => {
    const shown = eff(m).state !== 'OFF';
    return `<div class="br"><span class="arr"><button type="button" data-act="hup" data-id="${esc(m.id)}" title="Earlier in the strip"${READONLY || k <= 0 ? ' disabled' : ''}>▲</button><button type="button" data-act="hdown" data-id="${esc(m.id)}" title="Later in the strip"${READONLY || k >= hs.length - 1 ? ' disabled' : ''}>▼</button></span><a href="#b-${esc(m.box)}" title="${esc(m.label)}">${esc(m.label)}</a>${shown ? '<span></span>' : '<em title="Switched OFF, so it is not drawn">off</em>'}</div>`;
  };
  const tname = TABS.find(([k]) => k === tab)[1];
  return `<h2>Boxes<em>all types</em></h2><div class="rl">${boxes.map(brow).join('')}</div>`
    + `<h2>Headline strip<em>${esc(tname)}</em></h2><div class="rl hl">${hs.length ? hs.map(hrow).join('') : '<div class="none">Nothing picked yet: use Headline on a row.</div>'}</div>`;
}
function draw() {
  const typeOv = (t) => Object.keys(SB.settings.byType?.[t] || {}).length;
  $('tabs').innerHTML = TABS.map(([k, n]) => `<button type="button" role="tab" data-tab="${k}" class="${k === tab ? 'on' : ''}" aria-selected="${k === tab}">${n}${k !== 'global' && typeOv(k) ? `<i>${typeOv(k)}</i>` : ''}</button>`).join('');
  $('only').parentElement.style.visibility = tab === 'global' ? 'hidden' : '';
  $('rail').innerHTML = railHtml();
  const main = $('main');
  main.classList.toggle('ty', tab !== 'global');
  main.innerHTML = boxOrder().map(boxHtml).join('') || '<div class="err">No overrides on this tab.</div>';
}

/* ---------- changes: applied here at once, saved by the local-write block below ---------- */
function applyLocal(ch) {
  const s = SB.settings;
  if (ch.scope === 'boxes') {
    s.boxes = { ...(s.boxes || {}) };
    if ('order' in ch.patch) s.boxes.order = ch.patch.order;
    if ('pins' in ch.patch) { const p = { ...(s.boxes.pins || {}) }; for (const [k, v] of Object.entries(ch.patch.pins)) { if (v === null) delete p[k]; else p[k] = v; } s.boxes.pins = p; }
    return;
  }
  const holder = ch.scope === 'global' ? (s.metrics ||= {}) : ((s.byType ||= {})[ch.scope] ||= {});
  if (ch.patch === null) delete holder[ch.id]; else holder[ch.id] = { ...(holder[ch.id] || {}), ...ch.patch };
}
let save = null; // set by the local-write block; the published copy has none
function change(list) {
  if (READONLY || !save) return;
  for (const ch of list) applyLocal(ch);
  draw();
  save(list);
}
const byId = (id) => CAT.metrics.find((m) => m.id === id);
function onAct(el) {
  const act = el.dataset.act, id = el.dataset.id, scope = tab;
  const m = byId(id);
  if (act === 'state') return change([{ scope, id, patch: { state: el.dataset.v } }]);
  if (act === 'form') return change([{ scope, id, patch: { form: el.dataset.v } }]);
  if (act === 'reset') return change([{ scope, id, patch: null }]);
  if (act === 'up' || act === 'down') {
    const group = sortRows(metricsOf(m.box).filter((x) => x.group === m.group)).filter(movable);
    const k = group.indexOf(m), j = act === 'up' ? k - 1 : k + 1;
    if (k < 0 || j < 0 || j >= group.length) return;
    const n = group[j], a = ordNum(eff(m).order), b = ordNum(eff(n).order);
    const na = a === b ? (act === 'up' ? b - 0.5 : b + 0.5) : b;
    return change([{ scope, id: m.id, patch: { order: na } }, { scope, id: n.id, patch: { order: a } }]);
  }
  if (act === 'hero') {
    if (eff(m).spot === 'hero') return change([{ scope, id, patch: { spot: null, spotOrder: null } }]);
    const top = Math.max(0, ...heroList().map((x) => eff(x).spotOrder).filter((x) => Number.isFinite(x)));
    return change([{ scope, id, patch: { spot: 'hero', spotOrder: top + 1 } }]);
  }
  if (act === 'hup' || act === 'hdown') {
    const hs = heroList(), k = hs.indexOf(m), j = act === 'hup' ? k - 1 : k + 1;
    if (k < 0 || j < 0 || j >= hs.length) return;
    // number the whole strip 1..n in its new order, so unset or equal positions cannot tie
    const order = hs.slice(); [order[k], order[j]] = [order[j], order[k]];
    return change(order.map((x, i) => ({ x, i })).filter(({ x, i }) => eff(x).spotOrder !== i + 1).map(({ x, i }) => ({ scope, id: x.id, patch: { spotOrder: i + 1 } })));
  }
  if (act === 'bup' || act === 'bdown') {
    const ids = boxOrder().map((b) => b.id), mv = boxOrder().filter((b) => b.status === 'built').map((b) => b.id);
    const k = mv.indexOf(id), j = act === 'bup' ? k - 1 : k + 1;
    if (k < 0 || j < 0 || j >= mv.length) return;
    const a = ids.indexOf(mv[k]), b = ids.indexOf(mv[j]);
    [ids[a], ids[b]] = [ids[b], ids[a]];
    return change([{ scope: 'boxes', patch: { order: ids.filter((x) => CAT.boxes.find((bb) => bb.id === x)?.status === 'built') } }]);
  }
}
$('main').addEventListener('click', (e) => { const b = e.target.closest('button[data-act]'); if (b && !b.disabled) onAct(b); });
$('rail').addEventListener('click', (e) => { const b = e.target.closest('button[data-act]'); if (b && !b.disabled) onAct(b); });
$('rail').addEventListener('change', (e) => {
  const s = e.target.closest('select[data-act="pin"]'); if (!s) return;
  change([{ scope: 'boxes', patch: { pins: { [s.dataset.id]: s.value ? { under: s.value } : null } } }]);
});
$('tabs').addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (!b) return; tab = b.dataset.tab; draw(); });
$('only').addEventListener('change', (e) => { onlyOv = e.target.checked; draw(); });

/* ---------- status line ---------- */
let svTimer = null;
function status(text, cls = '', hold = false) {
  const el = $('sv'); el.textContent = text; el.className = `sv ${cls}`;
  clearTimeout(svTimer); if (!hold && text) svTimer = setTimeout(() => { el.textContent = ''; el.className = 'sv'; }, 2500);
}
function message(text, cls = '') { const el = $('msg'); el.textContent = text; el.className = `msg ${cls}`; el.title = text; }

/* ---------- loading ---------- */
async function load() {
  const [lib, r] = await Promise.all([import(MG.base + 'lib/switchboard.mjs'), fetch(MG.switchboardUrl(), { cache: 'no-store' })]);
  const j = await r.json();
  if (!r.ok || !j?.catalogLite || !j?.settings) throw new Error(j?.error?.message || `the switchboard answered ${r.status}`);
  LIB = lib; take(j);
}
function take(j) {
  SB = structuredClone(j); CAT = SB.catalogLite;
  IDX = new Map(CAT.metrics.map((m, i) => [m.id, i]));
  if (PV) setPreview(PV.c);
}

/* ---------- preview as a company ---------- */
function setPreview(c) {
  if (!c) { PV = null; $('pvc').hidden = true; $('pvs').hidden = false; draw(); return; }
  const absent = new Set(LIB.absentFrom(CAT, c).filter((id) => !ALWAYS.includes(id)));
  let res;
  try { res = LIB.resolve(CAT, SB.settings, { type: c.type, absent: [...absent] }); } catch (e) { message(`Preview failed: ${e.message}`, 'bad'); return; }
  PV = { c, res, absent };
  $('pvc').innerHTML = `Preview <b>${esc(c.ticker)}</b> · ${esc(c.type)}<a href="${MG.pageUrl(c.ticker)}" target="_blank" rel="noopener">Open page ↗</a><button type="button" id="pvx" title="Stop previewing">×</button>`;
  $('pvc').hidden = false; $('pvs').hidden = true;
  draw();
}
$('pvc').addEventListener('click', (e) => { if (e.target.id === 'pvx') { $('pq').value = ''; setPreview(null); } });
async function pickPreview(t) {
  try {
    const r = await fetch(MG.companyUrl(t)); const c = await r.json();
    if (!r.ok) throw new Error(c.error?.message || r.status);
    tab = typeTab(c.type);
    setPreview(c);
  } catch (e) { message(`Could not load ${t}: ${e.message}`, 'bad'); }
}

/* ---------- search boxes: the header's goes to a company page (as on every page); the preview's picks a company ---------- */
function attachSearch(q, box, pick) {
  let sel = 0, hits = [];
  const show = () => {
    const s = q.value.trim().toUpperCase();
    if (!s) { box.classList.remove('on'); return; }
    hits = companies.filter((c) => c.ticker.startsWith(s) || c.aliases.some((a) => a.startsWith(s))).concat(companies.filter((c) => !c.ticker.startsWith(s) && !c.aliases.some((a) => a.startsWith(s)) && c.name.toUpperCase().includes(s))).slice(0, 8);
    sel = 0;
    box.innerHTML = hits.map((c, i) => `<a href="${MG.pageUrl(c.ticker)}" data-t="${esc(c.ticker)}" class="${i === sel ? 'sel' : ''}">${c.logo ? `<img src="${esc(c.logo)}" alt="">` : '<span class="nl"></span>'}<b>${esc(c.ticker)}</b><span>${esc(c.name)}</span></a>`).join('') || '<a><span></span><b></b><span>No match among the profiled companies</span></a>';
    box.classList.add('on');
  };
  q.addEventListener('input', show);
  q.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sel = (sel + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % Math.max(1, hits.length); [...box.children].forEach((a, i) => a.classList.toggle('sel', i === sel)); }
    else if (e.key === 'Enter' && hits[sel]) { e.preventDefault(); box.classList.remove('on'); pick(hits[sel].ticker); }
    else if (e.key === 'Escape') { q.value = ''; box.classList.remove('on'); q.blur(); }
  });
  box.addEventListener('mousedown', (e) => { const a = e.target.closest('a[data-t]'); if (!a) return; e.preventDefault(); box.classList.remove('on'); pick(a.dataset.t); });
  q.addEventListener('blur', () => setTimeout(() => box.classList.remove('on'), 150));
}
attachSearch($('q'), $('sugg'), (t) => { location.href = MG.pageUrl(t); });
attachSearch($('pq'), $('psugg'), (t) => { $('pq').value = ''; pickPreview(t); });
addEventListener('keydown', (e) => { if (e.key === '/' && document.activeElement.tagName !== 'INPUT') { e.preventDefault(); $('q').focus(); } });
fetch(MG.companiesUrl()).then((r) => r.json()).then((l) => { companies = l.sort((a, b) => a.name.localeCompare(b.name)); }).catch(() => {});

if (READONLY) {
  $('pub').hidden = true;
  $('msg').insertAdjacentHTML('afterend', '<div class="ro">Switches are changed on the local server. This copy shows them read-only.</div>');
}

/* write code removed from the published copy */

load().then(draw).catch((e) => { $('main').innerHTML = `<div class="err">The switchboard could not be loaded: ${esc(e.message)}</div>`; });
})();
