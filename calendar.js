/* The Calendar page (PROJECT.md Part 4 "Calendar build", step 7). Built from the approved design design/calendar/calendar-mosaic.html.
   Data (option B, the free plan): the price relay's GET /calendar gives each source's stored answer; this page runs the shared pure
   compose code (server/lib/calendar/, copied to lib/calendar/ on the site) on it in the browser. If the relay is down or has no data yet,
   the calendar baked at publish (data/calendar.json) is shown with a stale marker; with neither, a plain "not available yet" line.
   The first half of this file is pure and exported (tests/calendar-page.test.mjs); the page itself starts at "the page". The layout math
   (treemap, tile fitting, lane sizing, fitting the window height) is public/calendar_layout.js. */
import { ZN, capBoxes, fitRows, fitAll, layoutAll, sizeAll, fitHeight, laneBand, sweepEmpty, earnWeight, foldFailed, settleAgain } from './calendar_layout.js';

/* ===================================== data (pure) ===================================== */
const SOURCE_NAMES = { forexfactory: 'Forex Factory', fed: 'Fed', treasury: 'Treasury', tradingview: 'TradingView' };
const TIER_LVL = { headliner: 1, notable: 2, standard: 3, minor: 4, unknown: 4 };
const IMPACT_KEY = { high: 'h', medium: 'm', low: 'l' };
const DAY_MS = 86_400_000;
const addD = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const mondayOf = (date) => addD(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7));
const hhmm = (min) => (min == null ? '' : `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`);
const clock12 = (min) => `${Math.floor(min / 60) % 12 || 12}:${String(min % 60).padStart(2, '0')} ${min < 720 ? 'AM' : 'PM'}`;
const NAME_TAIL = /(,?\s+(Inc\.?|Incorporated|Corporation|Corp\.?|Company|Co\.?|Limited|Ltd\.?|plc|PLC|LLC|L\.P\.|LP|S\.A\.|N\.V\.|AG|SE|Holdings?|Group))+\.?\s*$/;
const cleanName = (n) => {
  const s = String(n ?? '').replace(/\s+/g, ' ').trim();
  const c = s.replace(NAME_TAIL, '').replace(/,$/, '').trim();
  return c || s || null;
};
const etClock = (iso) => (iso ? `${new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })} ET` : 'an unknown time');

const todayNy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());

// The relay's answer to a calendar composed from it. lib: { assembleSources, econInputs, buildCalendar } from server/lib/calendar/.
// A source's copy is used whenever there is one; its `stale` is carried into the status the calendar is composed with (compose.js
// stamps stale:false on everything it parses, which is wrong for a stored copy; D98). A source with no copy is failed, so its days
// say so and never read as quiet. Throws when the answer is not a usable calendar-sources answer or no source has any data.
export function composeFromRelay(answer, lib) {
  if (answer?.kind !== 'calendar-sources' || !answer.window?.dates?.length) throw new Error('the relay answer is not a calendar-sources answer');
  if (!answer.base) throw new Error(`the relay has no calendar base (${answer.baseError || 'no reason given'})`);
  const entries = { ...answer.nasdaq, forexfactory: answer.forexfactory, fed: answer.fed, treasury: answer.treasury, tradingview: answer.tradingview };
  if (!Object.values(entries).some((e) => e?.copy)) throw Object.assign(new Error('the relay has no stored calendar data yet'), { noData: true });
  // calendar_route.js: state 'unknown' with this exact error means nothing is stored yet (not-covered, "not loaded"), or for a
  // ?week= answer nothing saved in the archive; an unknown from an unreadable store or a malformed copy carries another error and
  // stays failed
  const NOTHING_STORED = 'nothing stored yet for this source';
  const NOT_ARCHIVED = 'nothing saved in the calendar archive for this source';
  const res = (e) => (e?.copy
    ? { state: 'ok', payload: e.copy.payload, fetchedAt: e.copy.fetchedAt, error: null }
    : e && e.state === 'unknown' && (e.error === NOTHING_STORED || e.error === NOT_ARCHIVED) && !e.failure
      ? { state: 'not-covered', payload: null, fetchedAt: null, error: null }
      : { state: 'failed', payload: null, fetchedAt: null, error: e?.error || `no copy stored (${e?.state ?? 'no entry'})` });
  const fetched = { window: answer.window, nasdaq: {}, forexfactory: res(answer.forexfactory), fed: res(answer.fed), treasury: res(answer.treasury) };
  /* an answer with no entry at all for a later source (an older relay: Kiplinger, TradingView, Earnings Whispers) leaves it absent, which compose reads as not covered; an entry with no copy is failed */
  for (const s of ['tradingview', 'kiplinger', 'earningswhispers']) if (answer[s] !== undefined) fetched[s] = res(answer[s]);
  for (const d of answer.window.dates) fetched.nasdaq[d] = res(answer.nasdaq?.[d]);
  const a = lib.assembleSources(fetched, { shareClassOf: answer.base.shareClassOf });
  for (const [d, st] of Object.entries(a.status.nasdaq)) if (st.state === 'ok') st.stale = !!answer.nasdaq?.[d]?.stale;
  // a copy served although the latest fetch failed (or is suspect) is marked fetchFailed, so a day outside it reads failed, not "not yet listed" (compose.js econInputs)
  for (const s of ['forexfactory', 'fed', 'treasury', 'tradingview']) {
    if (a.status[s].state === 'ok') { a.status[s].stale = !!answer[s]?.stale; if (answer[s]?.state !== 'ok') a.status[s].fetchFailed = true; }
  }
  for (const s of ['kiplinger', 'earningswhispers']) if (a.status[s]?.state === 'ok') a.status[s].stale = !!answer[s]?.stale; // a stored copy's stale mark (D98)
  const { econ, status } = lib.econInputs(a, null);
  const b = answer.base;
  const cal = lib.buildCalendar({
    window: { dates: answer.window.dates }, earnings: a.earnings, econ, eventsConfig: b.eventsConfig, marketCalendar: b.marketCalendar,
    tiers: b.tiers, reportTimes: b.reportTimes, releaseTimes: b.releaseTimes, researched: new Set(b.researched), cats: b.cats, shareClassOf: b.shareClassOf, status: { nasdaq: a.status.nasdaq, ...status },
  });
  return { ...cal, v: 1, asOf: answer.asOf, errors: a.errors };
}

// The status chips under a day heading: a failed or not-yet-listed source is always said (D98); no stale chip, since scheduled dates rarely change (Adam, 2026-10-27).
// A day already past: a source with nothing for it reads "not stored" (it only lists upcoming days, or the archive holds no copy),
// never "not yet listed".
function dayFlags(day, today = null) {
  const out = [];
  const past = today != null && day.date < today;
  const es = day.earningsStatus;
  if (es.state === 'failed') out.push({ text: 'Earnings failed', title: 'The earnings list for this day could not be loaded.' });
  else if (es.state === 'not-covered') out.push(past ? { text: 'Earnings not stored', title: 'No copy of the earnings list for this day was saved.' } : { text: 'Earnings not loaded', title: 'The earnings list for this day was not requested.' });
  else if (es.state === 'suspect') out.push({ text: 'Earnings unconfirmed', title: 'The source listed no reports on an ordinary trading day, so the empty list is not trusted.' });
  const by = day.econStatus?.bySource || {};
  // Treasury lists only upcoming auctions, so a past day with no Treasury copy is expected, not a gap: no chip (Adam, 2026-10-28)
  const group = (pred, word, why) => {
    const names = Object.keys(by).filter((s) => pred(by[s]) && !(past && s === 'treasury' && by[s].state === 'not-covered')).map((s) => SOURCE_NAMES[s]);
    if (names.length) out.push({ text: `${names.join(', ')} ${word}`, title: why });
  };
  group((x) => x.state === 'failed', 'failed', 'This source could not be loaded, so its events for this day are unknown.');
  group((x) => x.state === 'not-covered', past ? 'not stored' : 'not yet listed', past ? 'This source has nothing saved for this day, which is already past; it is not a quiet day.' : 'This source does not list this day yet; it is not a quiet day.');
  if (day.closure) {
    out.push(day.closure.kind === 'closed'
      ? { text: 'Market closed', title: day.closure.name, cl: true }
      : { text: `Early close ${day.closure.closeEt != null ? clock12(day.closure.closeEt) : ''}`.trim(), title: day.closure.name, cl: true });
  }
  return out;
}

// The short badge on an economic tile: the title's leading capitals (CPI, GDP); the FOMC events read "Fed" (Adam, 2026-10-28)
export const eventCode = (title) => {
  const first = /^[A-Z][A-Z0-9&]{1,5}(?=\s|$)/.exec(title);
  return first ? (first[0] === 'FOMC' ? 'Fed' : first[0]) : '';
};

// The calendar to the rows the page draws. R: one per company per day (a missing market value stays null); XV: one per economic
// event; weeks: up to two Monday-to-Friday groups of the window's days; flags: status chips per date.
export function pageModel(cal, { names = {}, logos = {}, today = null } = {}) {
  const dates = cal.days.map((d) => d.date);
  const mondays = [...new Set(dates.map(mondayOf))].sort().slice(0, 2);
  const weeks = mondays.map((m) => ({ monday: m, dates: dates.filter((d) => mondayOf(d) === m) }));
  const R = [];
  const XV = [];
  const flags = {};
  for (const day of cal.days) {
    const w = mondays.indexOf(mondayOf(day.date));
    if (w < 0) continue;
    flags[day.date] = dayFlags(day, today);
    const rows = [...day.earnings.before, ...day.earnings.after, ...day.earnings.noTime, ...day.unknownValue];
    for (const e of rows) {
      R.push({
        k: R.length, t: e.ticker, n: cleanName(e.name) ?? '', c: e.marketValue == null ? null : e.marketValue / 1e9,
        tm: hhmm(e.minutesEt), e: e.dateStatus !== 'confirmed', d: day.date, w,
        ses: e.lane === 'before' ? 'AM' : e.lane === 'after' ? 'PM' : 'NT',
        mid: e.minutesEt != null && e.minutesEt >= 570 && e.minutesEt < 960, cat: e.cat, sub: e.sub,
        lvl: TIER_LVL[e.tier] ?? 4, why: '', mine: 0, researched: !!e.researched,
      });
    }
    for (const x of day.econ) {
      XV.push({
        k: XV.length, d: day.date, w, tm: hhmm(x.minutesEt), n: x.title, i: IMPACT_KEY[x.impact] || 'n', s: '', code: eventCode(x.title),
        fed: x.kind === 'fed' || /^(Fed|FOMC)\b/.test(x.title),
      });
    }
  }
  const cats = Object.fromEntries(Object.entries(names.cats || {}).map(([id, v]) => [id, v.name]));
  return { weeks, R, XV, CATS: cats, flags, logos };
}

/* ===================================== the page ===================================== */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOWS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dowOf = (d) => DOWS[new Date(`${d}T00:00:00Z`).getUTCDay()];
const weekLabel = (ds) => {
  const [a, b] = [ds[0], ds[ds.length - 1]].map((d) => ({ y: +d.slice(0, 4), m: +d.slice(5, 7) - 1, d: +d.slice(8) }));
  return a.m === b.m ? `${MONTHS[a.m]} ${a.d}${b.d > a.d ? ` – ${b.d}` : ''}, ${b.y}` : `${MONTHS[a.m]} ${a.d} – ${MONTHS[b.m]} ${b.d}, ${b.y}`;
};
const $ = (id) => document.getElementById(id);
const dnum = (d) => +d.slice(8);
const sizeOf = (c) => (c == null ? 'unk' : c >= 200 ? 'mega' : c >= 50 ? 'large' : c >= 10 ? 'mid' : 'small');
const fm = (t) => { if (!t) return ''; let [h, m] = t.split(':').map(Number); const a = h < 12 ? 'AM' : 'PM'; h = h % 12 || 12; return h + ':' + String(m).padStart(2, '0') + ' ' + a; };
/* market value: $3.9T, $380B, $45B, $8.2B (one decimal under $10B); a missing value is shown as missing, never zero */
const fv = (c) => (c == null ? 'n/a' : c >= 1000 ? '$' + (c / 1000).toFixed(1) + 'T' : c >= 10 ? '$' + Math.round(c) + 'B' : '$' + c.toFixed(1) + 'B');
const ph = (t) => (!t ? 'mk' : t < '09:30' ? 'am' : t < '16:00' ? 'mk' : 'pm');
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const F0 = () => ({ show: 'both', imp: { h: 1, m: 1, l: 1 }, tier: { 1: 1, 2: 1, 3: 1, 4: 1 }, ses: { AM: 1, PM: 1, NT: 1 }, cat: '', size: '', date: '', mine: 0, q: '' });
const BL = { am: ['sun', 'Before the open', 'AM'], mk: ['clk', 'Market hours', ''], pm: ['moon', 'After the close', 'PM'], nt: ['clk', 'Time not given', 'NT'] };
/* a tile's area follows market value (earnWeight in calendar_layout.js; a missing value takes its tier's floor weight, never 0) */
const wE = earnWeight, wX =(x) => ({ h: 19, m: 8, l: 4.4, n: 4.4 })[x.i];
const REM = () => parseFloat(getComputedStyle(document.documentElement).fontSize);
const estOf = () => ''; // no announced time shows nothing; the lane already says before open or after close (Adam, 2026-10-27)
const fx = (x) => (x.tm ? fm(x.tm) : 'time n/a');
const tmx = (r) => (r.tm ? fm(r.tm) : estOf(r));
const tmh = (r) => (r.tm ? fm(r.tm) : `<span class="est">${estOf(r)}</span>`);
const FEDP = (x) => (x.fed ? '<span class="fed">FED</span>' : '');
const plural = (n, w) => n + ' ' + w + (n == 1 ? '' : 's');
const tmSort = (a, b) => (a.tm || '99').localeCompare(b.tm || '99');

/* The page's state, set once by startPage. P: what is on show (R, XV, weeks, flags: swapped when an earlier saved week is opened and back for
   this week and next), the filters F, the opened lanes EXP. L: the layout state the layout module reads and writes (see calendar_layout.js). */
const P = { R: [], XV: [], weeks: [], flags: {}, CATS: {}, logos: {}, LIVE: null, HV: null, ARCH: null, BUSY: false, nav: null, F: null, todayEt: '', EL: null, grid: false, stripOpen: true, EXP: new Set(), vpW: 0, vpH: 0, rsF: 0, rsT: 0 };
/* HV: an earlier saved week on show { monday, none, error }; ARCH: how far back the archive reaches, known after the first earlier week is asked for;
   L.TMD: tile map id to its day; L.FOLD: boxes folded into rows because they cannot show their text at the minimum size (kept for one render);
   L.HFOLD: boxes folded to fit the window height (reset each fit); L.XB: day to the extra room its red tiles got because one did not fit */
const L = { TM: {}, TMD: {}, uid: 0, Z: 1, VW: 0, VH: 0, RF: 1, RP: 16, LIM: {}, LIMD: new Set(), TFD: {}, FITTING: false, FOLD: new Set(), HFOLD: new Set(), XB: {} };
const days = () => P.weeks[P.F.range == 'next' && P.weeks[1] ? 1 : 0].dates;
const fday = () => (days().includes(P.F.day) ? P.F.day : days()[0]);
const wkin = () => P.EL.firstElementChild;
const LAP = () => (P.vpH || innerHeight) < 900;
function active() { const o = (x) => JSON.stringify(Object.assign({}, x, { range: 0, day: 0 })); return o(P.F) != o(F0()); }
/* the single-day layout (week strip plus one wide day) is on show for the Day view, and on the laptop for an unfiltered week */
const isFocus = () => P.F.range == 'day' || (LAP() && !active() && !P.grid);

function dataset(FF) {
  const F = P.F; FF = FF || F;
  const wk = F.range == 'next' && P.weeks[1] ? 1 : 0;
  const base = P.R.filter((r) => r.w == wk), bx = P.XV.filter((x) => x.w == wk);
  const er = base.filter((r) => {
    if (FF.show == 'econ' || !FF.tier[r.lvl] || (r.ses != 'NT' && !FF.ses[r.ses]) || (FF.cat && r.cat != FF.cat) || (FF.size && sizeOf(r.c) != FF.size) || (FF.date == 'conf' && r.e) || (FF.date == 'est' && !r.e) || (FF.mine && !r.mine)) return false;
    return !FF.q || (r.t + ' ' + r.n).toLowerCase().includes(FF.q);
  });
  const xe = bx.filter((x) => {
    if (FF.show == 'earn' || (x.i != 'n' && !FF.imp[x.i]) || FF.mine) return false;
    return !FF.q || x.n.toLowerCase().includes(FF.q);
  });
  return { er, xe, nr: base.length, nx: bx.length };
}
/* capture aid: ?vp=WxH lays the page out for exactly that viewport */
function applyCaptureViewport() {
  const q = location.search.match(/vp=(\d+)x(\d+)/); P.vpW = q ? +q[1] : 0; P.vpH = q ? +q[2] : 0;
  if (!P.vpW) return;
  const de = document.documentElement, bd = document.body, W = P.vpW, H = P.vpH;
  de.style.width = W + 'px'; de.style.height = H + 'px'; bd.style.width = W + 'px'; bd.style.height = H + 'px';
  de.style.fontSize = (H <= 900 ? 12.5 : Math.max(11, Math.min(18, Math.min(.007 * W, .0138 * H)))) + 'px'; bd.style.paddingLeft = bd.style.paddingRight = Math.max(20, Math.min(66, .026 * W)) + 'px';
}
/* the view toggle lights the view actually on show: the single-day layout is the Day view, whatever the Week button was pressed for */
const shownView = () => (isFocus() && P.F.range != 'next' ? 'day' : P.F.range);
function sync() {
  const F = P.F, HV = P.HV, shown = shownView();
  document.querySelectorAll('[data-a]').forEach((b) => {
    const [a, v] = b.dataset.a.split(':'); let on = null;
    if (a == 'show') on = F.show == v; else if (a == 'imp') on = !!F.imp[v]; else if (a == 'tier') on = !!F.tier[v]; else if (a == 'ses') on = !!F.ses[v]; else if (a == 'mine') on = !!F.mine; else if (a == 'range' && b.closest('#rng')) on = v == 'day' ? shown == 'day' : !HV && shown == v;
    if (on !== null) b.classList.toggle('on', on);
  });
  $('prv').disabled = !navTarget(-1); $('nxt').disabled = !navTarget(1);
  ['cat', 'size', 'date'].forEach((k) => { const s = $(k); s.value = F[k]; s.classList.toggle('chg', !!F[k]); });
  $('sbox').classList.toggle('chg', !!F.q);
  $('fb').classList.toggle('act', active());
  $('fb').classList.toggle('se', F.show == 'econ'); $('fb').classList.toggle('sn', F.show == 'earn');
  $('wklbl').textContent = weekLabel(days());
}
function onClick(e) {
  const b = e.target.closest('[data-a]'); if (!b || b.disabled) return; const [a, v] = b.dataset.a.split(':'), F = P.F;
  if (a == 'nav') { const t = navTarget(+v); if (t) gotoWeek(t); return; }
  if (a == 'strip') { toggleOutline(); go(); return; }
  if (a == 'range' && P.HV && v != 'day') { P.grid = v == 'week'; gotoWeek(P.LIVE.weeks[v == 'next' && P.LIVE.weeks[1] ? 1 : 0].monday); return; }
  if (a == 'show') F.show = v; else if (a == 'imp') F.imp[v] = F.imp[v] ? 0 : 1; else if (a == 'tier') F.tier[v] = F.tier[v] ? 0 : 1; else if (a == 'ses') F.ses[v] = F.ses[v] ? 0 : 1; else if (a == 'mine') F.mine = F.mine ? 0 : 1;
  else if (a == 'more') { if (P.EXP.has(v)) P.EXP.delete(v); else P.EXP.add(v); }
  else if (a == 'range') { F.range = v; P.grid = v == 'week'; } /* Week pressed: the five-day grid, also on the laptop, where the unfiltered default stays the single-day layout */
  else if (a == 'day') { P.grid = false; F.day = v; F.range = F.range == 'next' ? 'next' : 'day'; } else if (a == 'clear') { const r = F.range, d = F.day; P.F = Object.assign(F0(), { range: r, day: d }); $('q').value = ''; }
  go();
}
function initUI() {
  $('cat').innerHTML = '<option value="">All Categories</option>' + Object.entries(P.CATS).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join('');
  $('size').innerHTML = '<option value="">Any size</option><option value="mega">Over $200B</option><option value="large">$50B-$200B</option><option value="mid">$10B-$50B</option><option value="small">Under $10B</option>';
  $('date').innerHTML = '<option value="">Any date status</option><option value="conf">Confirmed only</option><option value="est">Estimated only</option>';
  document.addEventListener('click', onClick);
  document.addEventListener('keydown', (e) => { const m = e.target.closest?.('.sr.more'); if (m && (e.key == 'Enter' || e.key == ' ')) { e.preventDefault(); m.click(); } });
  ['cat', 'size', 'date'].forEach((k) => $(k).addEventListener('change', (e) => { P.F[k] = e.target.value; go(); }));
  $('q').addEventListener('input', (e) => { P.F.q = e.target.value.trim().toLowerCase(); go(); });
}
function go() { sync(); render(); }
/* week arrows: the week shown, and the week an arrow leads to (null when there is none). Forward stops at next week; back goes through
   this week's own days, then as far as the archive reaches (unknown until the first earlier week has been asked for) */
const viewMonday = () => (P.HV ? P.HV.monday : P.weeks[P.F.range == 'next' && P.weeks[1] ? 1 : 0].monday);
function navTarget(dir) {
  const t = addD(viewMonday(), 7 * dir);
  if (P.LIVE.weeks.some((w) => w.monday === t)) return t;
  if (dir > 0) return P.HV && P.nav && t < P.LIVE.weeks[0].monday ? t : null; /* forward from an earlier week steps back toward this week */
  if (!P.nav) return null;
  return P.ARCH && (P.ARCH.error || !P.ARCH.earliestWeek || t < P.ARCH.earliestWeek) ? null : t;
}
/* open a week: this week or next from the page's own data, any earlier one from the relay's archive (one request, only when asked for) */
async function gotoWeek(mon) {
  if (P.BUSY) return;
  P.BUSY = true;
  try {
    const li = P.LIVE.weeks.findIndex((w) => w.monday === mon), F = P.F;
    if (li >= 0) {
      P.HV = null; Object.assign(P, { R: P.LIVE.R, XV: P.LIVE.XV, weeks: P.LIVE.weeks, flags: P.LIVE.flags });
      F.range = li ? 'next' : F.range == 'day' ? 'day' : 'week'; F.day = P.weeks[li].dates.includes(P.todayEt) ? P.todayEt : P.weeks[li].dates[0];
    } else {
      const got = await P.nav.loadWeek(mon);
      if (got.archive) P.ARCH = got.archive;
      P.HV = { monday: mon, none: !!got.none, error: got.error || null };
      if (got.model) { await Promise.race([Promise.all(loadLogos(got.model.R)), new Promise((ok) => setTimeout(ok, 4000))]); Object.assign(P, { R: got.model.R, XV: got.model.XV, weeks: got.model.weeks, flags: got.model.flags }); }
      else Object.assign(P, { R: [], XV: [], flags: {}, weeks: [{ monday: mon, dates: [0, 1, 2, 3, 4].map((n) => addD(mon, n)) }] });
      F.range = F.range == 'day' ? 'day' : 'week'; F.day = P.weeks[0].dates[0];
    }
    P.EXP.clear(); go();
  } finally { P.BUSY = false; }
}

/* ===== logos: real files, preloaded and painted onto canvases (a plain img can stay blank in a screenshot); a company with no logo file draws its ticker ===== */
const IMG = {}, PROC = {};
const loadLogos = (rows) => [...new Set(rows.map((r) => r.t))].filter((t) => !(t in IMG)).map((t) => {
  const file = P.logos[t] || P.logos[t.replace(/\./g, '-')];
  if (!file) { IMG[t] = null; return Promise.resolve(); }
  const i = new Image(); IMG[t] = i; i.onload = () => paintLogos(); i.src = window.MG.logoBase + file;
  return i.decode().catch((e) => { console.warn(`calendar: logo ${t} could not be decoded (${e.message})`); });
});
const arOf = (t) => { const i = IMG[t]; return i && i.naturalWidth ? i.naturalWidth / i.naturalHeight : 1; };
/* a company has a real logo only when its file loaded; without one there is no logo slot anywhere (the ticker is never shown twice) */
const hasLogo = (t) => !!(IMG[t] && IMG[t].naturalWidth);
const boxW = (t, h, maxW) => { const ar = arOf(t); return ar > 1.9 ? Math.min(maxW, h * Math.min(ar, maxW / h)) : h; };
/* a logo that would draw under about 10px tall is replaced by a ticker monogram */
const monoFor = (t, h, maxW) => { const ar = arOf(t), w = boxW(t, h, maxW); return Math.min(h * .9, w * .9 / ar) * L.RP * L.Z < 5; };
const logoA = (t, h, maxW) => `<span class="lgo" data-t="${esc(t)}"${monoFor(t, h, maxW) ? ' data-m="1"' : ''} style="--s:${h.toFixed(2)}rem;--w:${boxW(t, h, maxW).toFixed(2)}rem"><canvas></canvas></span>`;
/* slim rows: one fixed logo slot in every row; a wordmark scales to fit it, and one that would draw under ~10px tall becomes a plain neutral empty slot */
function rowLogo(t) {
  if (!hasLogo(t)) return ''; /* no real logo: an empty fixed slot, never the ticker drawn a second time */
  const wide = arOf(t) > 1.9, mono = wide && (4.6 * .9 / arOf(t)) * L.RF * L.RP * L.Z < 5;
  return mono ? '<span class="lgo n"></span>' : `<span class="lgo${wide ? ' w' : ''}" data-t="${esc(t)}"><canvas></canvas></span>`;
}
/* Logos are drawn straight onto the dark tile, with no plate: the near-white background that touches the image edge is made transparent
   (flood fill from opaque near-white edge pixels, so white inside the mark stays), and a mark whose visible pixels are mostly dark is
   recolored light (#e6edef) keeping its alpha. Done once per logo at up to 256px, then reused for every tile. */
const NEAR_WHITE = 232, DARK_MARK = .35, LIGHT_INSIDE = .04;
function keyOutBackground(p, w, h) {
  const white = (i) => p[i + 3] >= 128 && p[i] >= NEAR_WHITE && p[i + 1] >= NEAR_WHITE && p[i + 2] >= NEAR_WHITE;
  const seen = new Uint8Array(w * h), stack = [];
  const push = (x, y) => { const k = y * w + x; if (!seen[k] && white(k * 4)) { seen[k] = 1; stack.push(k); } };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (stack.length) {
    const k = stack.pop(), x = k % w, y = (k - x) / w;
    p[k * 4 + 3] = 0;
    if (x > 0) push(x - 1, y); if (x < w - 1) push(x + 1, y); if (y > 0) push(x, y - 1); if (y < h - 1) push(x, y + 1);
  }
}
function lightenIfDark(p) {
  let sum = 0, wt = 0, light = 0;
  for (let i = 0; i < p.length; i += 4) {
    const a = p[i + 3]; if (!a) continue;
    const l = (.2126 * p[i] + .7152 * p[i + 1] + .0722 * p[i + 2]) / 255;
    sum += a * l; wt += a; if (l >= .9) light += a;
  }
  /* a dark mark with real light areas inside it (white letters on a navy badge) is a badge with its own colors: left as it is */
  if (!wt || sum / wt >= DARK_MARK || light / wt >= LIGHT_INSIDE) return;
  for (let i = 0; i < p.length; i += 4) { p[i] = 230; p[i + 1] = 237; p[i + 2] = 239; }
}
function processed(t, im) {
  if (PROC[t]) return PROC[t];
  const big = Math.max(im.naturalWidth, im.naturalHeight), svg = /\.svg$/i.test(im.src), k = svg ? 256 / big : Math.min(1, 256 / big);
  const w = Math.max(1, Math.round(im.naturalWidth * k)), h = Math.max(1, Math.round(im.naturalHeight * k));
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0, w, h);
  try { const d = g.getImageData(0, 0, w, h); keyOutBackground(d.data, w, h); lightenIfDark(d.data); g.putImageData(d, 0, 0); }
  catch (e) { console.warn(`calendar: logo ${t} could not be cleaned (${e.message}); drawn as is`); }
  return (PROC[t] = c);
}
function paintLogos() {
  const dprD = Math.max(1, devicePixelRatio || 1);
  document.querySelectorAll('.lgo[data-t]').forEach((el) => {
    const t = el.dataset.t, im = IMG[t], c = el.firstChild, w = el.clientWidth, h = el.clientHeight; if (!w || !h || !c) return;
    const cw = Math.round(w * .9 * dprD * L.Z), ch = Math.round(h * .9 * dprD * L.Z); c.width = cw; c.height = ch; const g = c.getContext('2d');
    const ar = im && im.naturalWidth ? im.naturalWidth / im.naturalHeight : 0, dh = ar ? Math.min(ch, cw / ar) : 0;
    if (!ar || el.dataset.m === '1' || dh / dprD < 5) {
      const tx = t; let fs = ch * .74; g.fillStyle = '#e6edef'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `800 ${fs}px Manrope,"Segoe UI",sans-serif`;
      while (g.measureText(tx).width > cw * .96 && fs > 5) { fs -= 1; g.font = `800 ${fs}px Manrope,"Segoe UI",sans-serif`; } g.fillText(tx, cw / 2, ch / 2 + fs * .04); return;
    }
    const dw = ar >= cw / ch ? cw : ch * ar, dh2 = dw / ar; g.drawImage(processed(t, im), (cw - dw) / 2, (ch - dh2) / 2, dw, dh2);
  });
}

/* ===== MOSAIC render: squarified treemap of headliners, notable names and red reports per lane; slim Ladder rows for the rest ===== */
function itemsOf(d, b, D) {
  const ee = b == 'mk' ? [] : D.er.filter((r) => r.d == d && r.ses == BL[b][2]), ex = D.xe.filter((x) => x.d == d && ph(x.tm) == b);
  return [...ee.map((r) => ({ k: 'e', r, v: wE(r) })), ...ex.map((x) => ({ k: 'x', x, v: wX(x) }))].sort((a, b) => b.v - a.v);
}
/* tiles = headliners, notable names (unless folded into rows) and red high-impact reports; everything else is a slim row.
   R3 "Expand to see N more": a lane shows as many earnings rows as fit the window height (L.LIM, set by fitHeight), biggest value first;
   the rest sit behind one "+N more" row that opens them in place (P.EXP) and folds them back. Economic rows never collapse. */
function splitZ(d, b, X) {
  const it = itemsOf(d, b, X), isTile = (o) => (o.k == 'e' ? o.r.lvl == 1 || (o.r.c >= 500 && !L.HFOLD.has(o.r.k)) || (o.r.lvl == 2 && !L.FOLD.has(o.r.k) && !L.HFOLD.has(o.r.k)) : o.x.i == 'h'); /* a headliner, and a company of $500B or more, is always a box (R3) */
  const key = d + '|' + b, all = it.filter((o) => o.k == 'e' && !isTile(o)).map((o) => o.r);/* itemsOf orders by value, biggest first */
  const open = !L.FITTING && P.EXP.has(key) && L.LIMD.has(key), lim = open ? undefined : L.LIM[key], shown = lim == null ? all : all.slice(0, lim), hidden = all.length - shown.length;
  return { b, key, it, tiles: capBoxes(it.filter(isTile)), rx: it.filter((o) => o.k == 'x' && o.x.i != 'h').map((o) => o.x).sort(tmSort), re: [...shown].sort(tmSort), hidden, open, extra: hidden > 0 || open ? 1 : 0 };
}
function rowsHTML(s) {
  const rx = s.rx.map((x) => `<div class="sr i${x.i}" title="${esc(x.n)}"><b class="nm">${esc(x.n)}</b>${FEDP(x)}<span class="tm">${fx(x)}</span></div>`);
  const re = s.re.map((r) => `<div class="sr${r.lvl >= 4 ? ' mn' : ''}" title="${esc(r.n)}"><span class="ls">${rowLogo(r.t)}</span><b class="tk2">${esc(r.t)}</b><span class="nm">${esc(r.n)}</span><span class="vl">${fv(r.c)}</span><span class="tm">${r.mid ? '<span class="mdt">MIDDAY</span>' : ''}${tmh(r)}</span></div>`);
  const more = s.hidden > 0 ? `<div class="sr more" role="button" tabindex="0" data-a="more:${s.key}" title="Show the ${s.hidden} smaller reports">+${s.hidden} more</div>` : s.open ? `<div class="sr more" role="button" tabindex="0" data-a="more:${s.key}" title="Fold the smaller reports back">Show fewer</div>` : '';
  // an opened list also gets a "Show fewer" at its top that sticks while scrolling, so it folds from either end (Adam, 2026-10-28)
  const top = s.open ? `<div class="sr more top" role="button" tabindex="0" data-a="more:${s.key}" title="Fold the smaller reports back">Show fewer</div>` : '';
  return rx.length + re.length + (more ? 1 : 0) ? `<div class="rows${s.re.some((r) => r.mid) ? ' hasmid' : ''}${s.re.length && s.re.every((r) => !r.tm) ? ' nt0' : ''}">${rx.join('')}${top}${re.join('')}${more}</div>` : '';
}
function zoneHead(s) {
  const ne = s.it.filter((o) => o.k == 'e').length, nx = s.it.length - ne;
  return `<div class="zh"><svg class="ico"><use href="#${BL[s.b][0]}"/></svg>${BL[s.b][1]}<em>${ne ? plural(ne, 'report') : ''}${ne && nx ? ' + ' : ''}${nx ? plural(nx, 'event') : ''}</em></div>`;
}
function zoneHTML(s) {
  if (!s.it.length) return '';
  let tm = ''; if (s.tiles.length) { const id = 'z' + (L.uid++); L.TM[id] = s.tiles; L.TMD[id] = s.key.split('|')[0]; tm = `<div class="tmap" data-id="${id}"></div>`; }
  return `<section class="zn ${s.b == 'mk' ? 'mk2' : s.b}" data-b="${s.b}">${zoneHead(s)}${tm}${rowsHTML(s)}</section>`;
}
/* the day view's market-hours band: one wrapping row of chips in time order, a red chip (code badge, title, time, HIGH and FED tags) for each high-impact event and
   the usual slim row for the others, so the band is only as tall as its content and has no empty region */
function bandZoneHTML(s) {
  const chip = (x) => (x.i == 'h'
    ? `<div class="chip x" title="${esc(x.n)}, ${fx(x)}">${x.code ? `<span class="cd">${esc(x.code)}</span>` : ''}<b>${esc(x.n)}</b><span class="ct">${fx(x)}</span><span class="hg">HIGH</span>${x.fed ? '<span class="fed">FED</span>' : ''}</div>`
    : `<div class="sr i${x.i}" title="${esc(x.n)}"><b class="nm">${esc(x.n)}</b>${FEDP(x)}<span class="tm">${fx(x)}</span></div>`);
  return `<section class="zn mk2" data-b="mk">${zoneHead(s)}<div class="bandrow">${s.it.filter((o) => o.k == 'x').map((o) => o.x).sort(tmSort).map(chip).join('')}</div></section>`;
}
function counts(er, xe) { const a = [], F = P.F; if (F.show != 'econ') a.push(`<b>${er.length}</b> ${er.length == 1 ? 'report' : 'reports'}`); if (F.show != 'earn') a.push(`<b>${xe.length}</b> ${xe.length == 1 ? 'event' : 'events'}`); return a.join(' &middot; '); }
const flagsHTML = (d) => ((P.flags[d] || []).length ? `<div class="fl">${P.flags[d].map((f) => `<span class="flg${f.cl ? ' cl' : ''}" title="${esc(f.title)}">${esc(f.text)}</span>`).join('')}</div>` : '');
/* the day view's short lanes take no columns (laneBand): market hours with red boxes is a compact band across the top, "Time not given" with rows only a compact
   strip along the bottom, and Before open and After close have the prime space */
function lanesHTML(lanes, wide) {
  const { band, foot, cols } = wide ? laneBand(lanes) : { band: [], foot: [], cols: lanes.map((s) => [s]) };
  return (band.length ? `<div class="lband">${band.map(bandZoneHTML).join('')}</div>` : '') + `<div class="zones">${cols.map((c) => zoneHTML(c[0])).join('')}</div>` + (foot.length ? `<div class="lfoot">${foot.map(zoneHTML).join('')}</div>` : '');
}
function dayHTML(d, D, wide) {
  const er = D.er.filter((r) => r.d == d), xe = D.xe.filter((x) => x.d == d), hi = xe.filter((x) => x.i == 'h').length;
  const zs = ZN.map((b) => splitZ(d, b, D)), today = d == P.todayEt;
  return `<article class="day pad${wide ? ' wide' : ''}${today ? ' today' : ''}" data-d="${d}"><div class="dh"><button class="dn" data-a="day:${d}"><b>${dowOf(d)}</b><span>${dnum(d)}</span></button>${today ? '<span class="tdy">Today</span>' : ''}${hi ? `<span class="hp">${hi} high-impact</span>` : ''}<span class="cnt">${counts(er, xe)}</span></div>${flagsHTML(d)}${lanesHTML(zs.filter((s) => s.it.length), wide)}</article>`;
}
function miniHTML(d, D) {
  const er = D.er.filter((r) => r.d == d), xe = D.xe.filter((x) => x.d == d), hi = xe.filter((x) => x.i == 'h').length, F = P.F, today = d == P.todayEt;
  const it = ZN.flatMap((b) => itemsOf(d, b, D)).sort((a, b) => b.v - a.v), id = 'z' + (L.uid++); if (it[0]) it[0].top = true; L.TM[id] = it;
  const cn = []; if (F.show != 'econ') cn.push(`<b>${er.length}</b>`); if (F.show != 'earn') cn.push(`${xe.length}`);
  return `<div class="mini pad${d == fday() ? ' on' : ''}${today ? ' today' : ''}" data-a="day:${d}"><div class="dh"><button class="dn"><b>${dowOf(d)}</b><span>${dnum(d)}</span></button>${today ? '<span class="tdy">Today</span>' : ''}${hi ? `<span class="hp">${hi} high</span>` : ''}<span class="cnt">${cn.join(' &middot; ')}</span></div><div class="tmap" data-id="${id}" data-mini="1"></div></div>`;
}
/* the week outline's bar: a round chevron button that collapses or opens the strip of day mosaics; collapsed, the bar keeps a pill per day so the day can still be picked.
   Remembered in localStorage (STRIP_KEY). */
const STRIP_KEY = 'mowgli.calendar.outlineOpen';
const outlineBar = () => `<div class="sbar"><button class="sbtn" data-a="strip" aria-expanded="${P.stripOpen}" title="${P.stripOpen ? 'Collapse the week outline' : 'Open the week outline'}"><svg viewBox="0 0 16 16"><path d="M3.5 6l4.5 4.5L12.5 6"/></svg></button>${P.stripOpen ? '<span class="sbl">Week outline</span>' : `<div class="seg sdays">${days().map((d) => `<button data-a="day:${d}"${d == fday() ? ' class="on"' : ''}>${dowOf(d)} ${dnum(d)}</button>`).join('')}</div>`}</div>`;
function toggleOutline() {
  P.stripOpen = !P.stripOpen;
  try { localStorage.setItem(STRIP_KEY, P.stripOpen ? '1' : '0'); } catch (e) { console.warn(`calendar: the outline state could not be saved (${e.message})`); }
}
function build(D, focus) {
  L.TM = {}; L.TMD = {}; L.uid = 0; L.VW = P.EL.clientWidth / L.Z; L.VH = P.EL.clientHeight / L.Z;
  const inner = focus ? `${outlineBar()}${P.stripOpen ? `<div class="strip">${days().map((d) => miniHTML(d, D)).join('')}</div>` : ''}${dayHTML(fday(), D, true)}` : days().map((d) => dayHTML(d, D, false)).join('');
  const dmin = active() ? (L.RF > 1 ? '17rem' : '19rem') : D.er.length ? '21rem' : '19rem';
  P.EL.innerHTML = `<div class="wkin${focus ? ' focus' : ''}" style="--dmin:${dmin};width:${L.VW}px;height:${L.VH}px;transform:scale(${L.Z})">${inner}</div>`;
}
/* what the layout module reads of the page */
const H = {
  L, get R() { return P.R; }, get XV() { return P.XV; }, root: wkin, days, fday, build, splitZ, itemsOf, arOf, hasLogo, logoA, fv, fx, tmh, tmx, esc,
};
let laidFor = '';
/* filtered week: scale the whole week by one uniform factor (up to 2x) so the tallest day fills the height; relative sizes stay comparable. Returns the factor used. */
function zoomWeek(pass) {
  const avail = P.EL.clientHeight, ht = () => Math.max(...[...wkin().querySelectorAll('.day')].map((d) => d.offsetHeight)) * L.Z;
  const rowsOk = () => [...wkin().querySelectorAll('.sr')].every((r) => r.scrollWidth <= r.clientWidth + 1) && [...wkin().querySelectorAll('.sr span.nm')].every((n) => n.textContent !== '') && [...wkin().querySelectorAll('.sr b.nm')].every((n) => n.scrollWidth <= n.clientWidth + 1);
  const fits = () => ht() <= avail * .985 && wkin().scrollWidth <= wkin().clientWidth + 1 && rowsOk();
  if (ht() >= avail * .82) return 1;
  let lo = 1, hi = 2; for (let i = 0; i < 7; i++) { const m = (lo + hi) / 2; pass(m); if (fits()) lo = m; else hi = m; } pass(lo); return lo;
}
/* fill every tile from the richest variant that fits; a box that cannot show its text at the minimum size folds into its lane's rows (the
   rows then follow the "+N more" rule), and a red tile that still does not fit gets more room, until all fit (a few rounds at most) */
function settleRound(rem) {
  const bad = fitAll(H, rem), failed = new Set(bad.e); let added = 0, xb = false;
  /* a failing box folds with every smaller foldable box of its lane (R3: a bigger company never folds while a smaller one keeps its box) */
  wkin().querySelectorAll('.tmap:not([data-mini])').forEach((el) => foldFailed(L.TM[el.dataset.id] || [], failed).forEach((k) => { if (!L.FOLD.has(k)) { L.FOLD.add(k); added++; } }));
  bad.x.forEach((k) => { const d = P.XV[k].d, was = L.XB[d] ?? 1, now = Math.min(1.6, was * 1.4); if (now != was) { L.XB[d] = now; xb = true; } }); /* more room only on the day whose red box did not fit; capped so earnings boxes keep their floor */
  return { added, xb };
}
function settleTiles(pass, zUsed, rem) {
  let r = settleRound(rem);
  for (let i = 1; settleAgain(r.added, r.xb, i); i++) { pass(zUsed); r = settleRound(rem); }
  if (r.added || r.xb) { pass(zUsed); fitAll(H, rem); } /* the round limit was hit with folds pending: fold them and lay out once more */
  sweepEmpty(wkin()); /* only a guard: it says so if it ever removes a box */
}
function render() {
  const EL = P.EL;
  if (P.HV?.none) { /* an earlier week with nothing saved, or whose archive could not be read: one plain line, never an empty week */
    EL.innerHTML = `<div class="none">${P.HV.error ? `The saved calendar for this week could not be loaded (${esc(P.HV.error)})` : 'No saved calendar for this week'}</div>`;
    $('stt').textContent = ''; laidFor = ''; return;
  }
  const D = dataset(), U = dataset(F0()), rem = REM(), focus = isFocus();
  L.RF = LAP() ? 1.25 : 1; L.RP = rem; L.FOLD.clear(); L.XB = {};
  const pass = (zv) => { L.Z = zv; build(D, focus); sizeAll(H, D, U, focus, rem); fitHeight(H, D, U, focus, rem); layoutAll(H, rem); fitRows(wkin(), rem); };
  pass(1);
  settleTiles(pass, focus ? 1 : zoomWeek(pass), rem);
  fitRows(wkin(), rem);
  $('stt').innerHTML = `Showing <b>${D.er.length}</b> of ${D.nr} reports &middot; <b>${D.xe.length}</b> of ${D.nx} events`;
  paintLogos();
  laidFor = innerWidth + 'x' + innerHeight + '/' + EL.clientWidth + 'x' + EL.clientHeight;
}
/* the layout is computed for one viewport size; if the window has a different size when it is next looked at, it is laid out again */
const sizeNow = () => innerWidth + 'x' + innerHeight + '/' + P.EL.clientWidth + 'x' + P.EL.clientHeight;
const recheck = () => { if (laidFor && sizeNow() != laidFor) render(); };
const watch = () => { new ResizeObserver(() => { if (P.rsF) return; P.rsF = requestAnimationFrame(() => { P.rsF = 0; recheck(); }); }).observe(P.EL); addEventListener('resize', () => { clearTimeout(P.rsT); P.rsT = setTimeout(recheck, 60); }); [600, 1500, 3000].forEach((ms) => setTimeout(recheck, ms)); };

/* nav (only when the relay answered): { loadWeek(monday) } gives { model, archive } for a saved earlier week, or { none, error?, archive? }. */
function startPage(M, nav = null) {
  Object.assign(P, { R: M.R, XV: M.XV, weeks: M.weeks, flags: M.flags, CATS: M.CATS, logos: M.logos, nav, LIVE: { R: M.R, XV: M.XV, weeks: M.weeks, flags: M.flags }, todayEt: todayNy(), EL: $('wk') });
  P.F = Object.assign(F0(), { range: 'week', day: P.weeks[0].dates.includes(P.todayEt) ? P.todayEt : P.weeks[0].dates[0] });
  applyCaptureViewport();
  try { P.stripOpen = localStorage.getItem(STRIP_KEY) !== '0'; } catch (e) { P.stripOpen = true; console.warn(`calendar: the outline state could not be read (${e.message})`); }
  const logosReady = loadLogos(P.R);
  initUI(); sync();
  /* first layout waits until the logos are decoded and the window has its final size (tile areas are computed from it) */
  return Promise.race([Promise.all(logosReady), new Promise((ok) => setTimeout(ok, 4000))]).then(() => new Promise((done) => setTimeout(() => { sync(); render(); watch(); done(); }, 300)));
}

/* ===================================== loading ===================================== */
const getJson = async (url, ms = 15000) => {
  const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

// The relay first (composed here); else the calendar baked at publish, marked stale; else null with the reasons.
async function loadCalendar(lib) {
  const MG = window.MG;
  const relay = String((window.MOWGLI_CONFIG || {}).quoteWorker || '').replace(/\/+$/, '');
  const why = [];
  if (relay) {
    try {
      const answer = await getJson(`${relay}/calendar`);
      const cal = composeFromRelay(answer, lib);
      const notes = [`Updated ${etClock(answer.asOf)}`];
      if (answer.relay?.state === 'down') notes.push(`Feed not refreshed since ${answer.relay.lastRunAt ? etClock(answer.relay.lastRunAt) : 'it started'}: saved copies shown`);
      if (answer.baseError) notes.push(`Reference data: ${answer.baseError}`);
      const fell = lib.econFallbackNote(cal); // this week's releases from TradingView, Forex Factory's copy being from an earlier week
      if (fell) notes.push(fell);
      // an earlier week is asked for only when its arrow is pressed (GET /calendar?week=); the start loads this week alone
      const loadWeek = async (monday) => {
        let a;
        try { a = await getJson(`${relay}/calendar?week=${monday}`); } catch (e) { return { none: true, error: e.message }; }
        const archive = a.archive || null;
        try { return { model: pageModel(composeFromRelay(a, lib), { names: a.base?.names, logos: a.base?.logos, today: todayNy() }), archive }; }
        catch (e) { return e.noData ? { none: true, archive } : { none: true, error: e.message, archive }; }
      };
      return { cal, names: answer.base.names, logos: answer.base.logos, note: notes.join(' · '), nav: { loadWeek } };
    } catch (e) { why.push(`relay: ${e.message}`); }
  } else why.push('relay: no relay address configured');
  if (!MG.isStatic) {
    // the local server composes the calendar itself (GET /api/calendar) and marks it stale when it had to fall back, so it is used as it comes
    try {
      const cal = await getJson('/api/calendar');
      const logos = await getJson(MG.logosUrl()).catch((e) => { console.warn(`calendar: the logo list could not be loaded (${e.message}); tickers are shown instead`); });
      const fell = lib.econFallbackNote(cal);
      return { cal, names: undefined, logos, note: `Updated ${etClock(cal.asOf)} (local server; the relay is not available: ${why.join('; ')})${fell ? ` · ${fell}` : ''}` };
    } catch (e) { why.push(`local server: ${e.message}`); }
  }
  try {
    const baked = await getJson(`${MG.base}data/calendar.json`);
    const base = await getJson(`${MG.base}data/calendar-base.json`).catch((e) => { console.warn(`calendar: the saved reference data could not be loaded (${e.message})`); return null; });
    return { cal: lib.staleCopy(baked), names: base?.names, logos: base?.logos, note: `As of ${etClock(baked.asOf)}` };
  } catch (e) { why.push(`saved copy: ${e.message}`); }
  return { cal: null, note: why.join('; ') };
}

async function main() {
  const wk = document.getElementById('wk'), note = document.getElementById('note');
  const none = (text) => { wk.innerHTML = `<div class="none">${text}</div>`; };
  let lib;
  try {
    const [c, m] = await Promise.all([import(`${window.MG.base}lib/calendar/compose.js`), import(`${window.MG.base}lib/calendar/merge.js`)]);
    lib = { ...c, ...m };
  } catch (e) { none('Calendar data not available yet.'); note.textContent = `The calendar code could not be loaded (${e.message})`; return; }
  const got = await loadCalendar(lib);
  note.textContent = got.note; note.title = got.note;
  if (!got.cal) { none('Calendar data not available yet.'); return; }
  let model;
  try { model = pageModel(got.cal, { names: got.names, logos: got.logos, today: todayNy() }); } catch (e) { none('Calendar data not available yet.'); note.textContent = `The calendar could not be read (${e.message})`; return; }
  if (!model.weeks.length) { none('Calendar data not available yet.'); return; }
  await startPage(model, got.nav);
}

if (typeof document !== 'undefined' && document.getElementById('wk')) main();
