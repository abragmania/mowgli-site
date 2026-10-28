/* The Calendar page (PROJECT.md Part 4 "Calendar build", step 7). Built from the approved design design/calendar/calendar-mosaic.html.
   Data (option B, the free plan): the price relay's GET /calendar gives each source's stored answer; this page runs the shared pure
   compose code (server/lib/calendar/, copied to lib/calendar/ on the site) on it in the browser. If the relay is down or has no data yet,
   the calendar baked at publish (data/calendar.json) is shown with a stale marker; with neither, a plain "not available yet" line.
   The first half of this file is pure and exported (tests/calendar-page.test.mjs); the page itself starts at the bottom. */

/* ===================================== data (pure) ===================================== */
const SOURCE_NAMES = { forexfactory: 'Forex Factory', fed: 'Fed', treasury: 'Treasury' };
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
  const entries = { ...answer.nasdaq, forexfactory: answer.forexfactory, fed: answer.fed, treasury: answer.treasury };
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
  for (const d of answer.window.dates) fetched.nasdaq[d] = res(answer.nasdaq?.[d]);
  const a = lib.assembleSources(fetched);
  for (const [d, st] of Object.entries(a.status.nasdaq)) if (st.state === 'ok') st.stale = !!answer.nasdaq?.[d]?.stale;
  // a copy served although the latest fetch failed (or is suspect) is marked fetchFailed, so a day outside it reads failed, not "not yet listed" (compose.js econInputs)
  for (const s of ['forexfactory', 'fed', 'treasury']) {
    if (a.status[s].state === 'ok') { a.status[s].stale = !!answer[s]?.stale; if (answer[s]?.state !== 'ok') a.status[s].fetchFailed = true; }
  }
  const { econ, status } = lib.econInputs(a, null);
  const b = answer.base;
  const cal = lib.buildCalendar({
    window: { dates: answer.window.dates }, earnings: a.earnings, econ, eventsConfig: b.eventsConfig, marketCalendar: b.marketCalendar,
    tiers: b.tiers, researched: new Set(b.researched), cats: b.cats, shareClassOf: b.shareClassOf, status: { nasdaq: a.status.nasdaq, ...status },
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
      const first = /^[A-Z][A-Z0-9&]{1,5}(?=\s|$)/.exec(x.title);
      XV.push({
        k: XV.length, d: day.date, w, tm: hhmm(x.minutesEt), n: x.title, i: IMPACT_KEY[x.impact] || 'n', s: '', code: first ? first[0] : '',
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

/* nav (only when the relay answered): { loadWeek(monday) } gives { model, archive } for a saved earlier week, or { none, error?, archive? }.
   The model on show is swapped when an earlier week is opened (R, XV, weeks, flags) and swapped back for this week and next week. */
function startPage(M, nav = null) {
  let { R, XV, weeks, flags } = M;
  const { CATS, logos } = M;
  const LIVE = { R, XV, weeks, flags };
  let HV = null, ARCH = null, BUSY = false; /* HV: an earlier saved week on show { monday, none, error }; ARCH: how far back the archive reaches, known after the first earlier week is asked for */
  const $ = (id) => document.getElementById(id);
  const ZN = ['am', 'mk', 'pm', 'nt'];
  const todayEt = todayNy();
  const days = () => weeks[F.range == 'next' && weeks[1] ? 1 : 0].dates;
  const fday = () => (days().includes(F.day) ? F.day : days()[0]);
  const dnum = (d) => +d.slice(8);
  const sizeOf = (c) => (c == null ? 'unk' : c >= 200 ? 'mega' : c >= 50 ? 'large' : c >= 10 ? 'mid' : 'small');
  const fm = (t) => { if (!t) return ''; let [h, m] = t.split(':').map(Number); const a = h < 12 ? 'AM' : 'PM'; h = h % 12 || 12; return h + ':' + String(m).padStart(2, '0') + ' ' + a; };
  /* market value: $3.9T, $380B, $45B, $8.2B (one decimal under $10B); a missing value is shown as missing, never zero */
  const fv = (c) => (c == null ? 'n/a' : c >= 1000 ? '$' + (c / 1000).toFixed(1) + 'T' : c >= 10 ? '$' + Math.round(c) + 'B' : '$' + c.toFixed(1) + 'B');
  const ph = (t) => (!t ? 'mk' : t < '09:30' ? 'am' : t < '16:00' ? 'mk' : 'pm');
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const F0 = () => ({ show: 'both', imp: { h: 1, m: 1, l: 1 }, tier: { 1: 1, 2: 1, 3: 1, 4: 1 }, ses: { AM: 1, PM: 1, NT: 1 }, cat: '', size: '', date: '', mine: 0, q: '' });
  const def = weeks[0].dates.includes(todayEt) ? todayEt : weeks[0].dates[0];
  let F = Object.assign(F0(), { range: 'week', day: def });
  function dataset(FF) {
    FF = FF || F;
    const wk = F.range == 'next' && weeks[1] ? 1 : 0;
    const base = R.filter((r) => r.w == wk), bx = XV.filter((x) => x.w == wk);
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
  const tmSort = (a, b) => (a.tm || '99').localeCompare(b.tm || '99');
  /* capture aid: ?vp=WxH lays the page out for exactly that viewport */
  const VPQ = location.search.match(/vp=(\d+)x(\d+)/), VPW = VPQ ? +VPQ[1] : 0, VPH = VPQ ? +VPQ[2] : 0;
  if (VPW) { const de = document.documentElement, bd = document.body; de.style.width = VPW + 'px'; de.style.height = VPH + 'px'; bd.style.width = VPW + 'px'; bd.style.height = VPH + 'px'; de.style.fontSize = (VPH <= 900 ? 12.5 : Math.max(11, Math.min(18, Math.min(.007 * VPW, .0138 * VPH)))) + 'px'; bd.style.paddingLeft = bd.style.paddingRight = Math.max(20, Math.min(66, .026 * VPW)) + 'px'; }
  const LAP = () => (VPH || innerHeight) < 900;
  function active() { const o = (x) => JSON.stringify(Object.assign({}, x, { range: 0, day: 0 })); return o(F) != o(F0()); }
  function sync() {
    document.querySelectorAll('[data-a]').forEach((b) => {
      const [a, v] = b.dataset.a.split(':'); let on = null;
      if (a == 'show') on = F.show == v; else if (a == 'imp') on = !!F.imp[v]; else if (a == 'tier') on = !!F.tier[v]; else if (a == 'ses') on = !!F.ses[v]; else if (a == 'mine') on = !!F.mine; else if (a == 'range' && b.closest('#rng')) on = v == 'day' ? F.range == 'day' : !HV && F.range == v;
      if (on !== null) b.classList.toggle('on', on);
    });
    $('prv').disabled = !navTarget(-1); $('nxt').disabled = !navTarget(1);
    ['cat', 'size', 'date'].forEach((k) => { const s = $(k); s.value = F[k]; s.classList.toggle('chg', !!F[k]); });
    $('sbox').classList.toggle('chg', !!F.q);
    $('fb').classList.toggle('act', active());
    $('fb').classList.toggle('se', F.show == 'econ'); $('fb').classList.toggle('sn', F.show == 'earn');
    $('wklbl').textContent = weekLabel(days());
  }
  function initUI() {
    $('cat').innerHTML = '<option value="">All Categories</option>' + Object.entries(CATS).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join('');
    $('size').innerHTML = '<option value="">Any size</option><option value="mega">Over $200B</option><option value="large">$50B-$200B</option><option value="mid">$10B-$50B</option><option value="small">Under $10B</option>';
    $('date').innerHTML = '<option value="">Any date status</option><option value="conf">Confirmed only</option><option value="est">Estimated only</option>';
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]'); if (!b || b.disabled) return; const [a, v] = b.dataset.a.split(':');
      if (a == 'nav') { const t = navTarget(+v); if (t) gotoWeek(t); return; }
      if (a == 'range' && HV && v != 'day') { gotoWeek(LIVE.weeks[v == 'next' && LIVE.weeks[1] ? 1 : 0].monday); return; }
      if (a == 'show') F.show = v; else if (a == 'imp') F.imp[v] = F.imp[v] ? 0 : 1; else if (a == 'tier') F.tier[v] = F.tier[v] ? 0 : 1; else if (a == 'ses') F.ses[v] = F.ses[v] ? 0 : 1; else if (a == 'mine') F.mine = F.mine ? 0 : 1;
      else if (a == 'more') { if (EXP.has(v)) EXP.delete(v); else EXP.add(v); }
      else if (a == 'range') F.range = v; else if (a == 'day') { F.day = v; F.range = F.range == 'next' ? 'next' : 'day'; } else if (a == 'clear') { const r = F.range, d = F.day; F = Object.assign(F0(), { range: r, day: d }); $('q').value = ''; }
      go();
    });
    document.addEventListener('keydown', (e) => { const m = e.target.closest?.('.sr.more'); if (m && (e.key == 'Enter' || e.key == ' ')) { e.preventDefault(); m.click(); } });
    ['cat', 'size', 'date'].forEach((k) => $(k).addEventListener('change', (e) => { F[k] = e.target.value; go(); }));
    $('q').addEventListener('input', (e) => { F.q = e.target.value.trim().toLowerCase(); go(); });
  }
  function go() { sync(); render(); }
  /* week arrows: the week shown, and the week an arrow leads to (null when there is none). Forward stops at next week; back goes through
     this week's own days, then as far as the archive reaches (unknown until the first earlier week has been asked for) */
  const viewMonday = () => (HV ? HV.monday : weeks[F.range == 'next' && weeks[1] ? 1 : 0].monday);
  function navTarget(dir) {
    const t = addD(viewMonday(), 7 * dir);
    if (LIVE.weeks.some((w) => w.monday === t)) return t;
    if (dir > 0) return HV && nav && t < LIVE.weeks[0].monday ? t : null; /* forward from an earlier week steps back toward this week */
    if (!nav) return null;
    return ARCH && (ARCH.error || !ARCH.earliestWeek || t < ARCH.earliestWeek) ? null : t;
  }
  /* open a week: this week or next from the page's own data, any earlier one from the relay's archive (one request, only when asked for) */
  async function gotoWeek(mon) {
    if (BUSY) return;
    BUSY = true;
    try {
      const li = LIVE.weeks.findIndex((w) => w.monday === mon);
      if (li >= 0) {
        HV = null; ({ R, XV, weeks, flags } = LIVE);
        F.range = li ? 'next' : F.range == 'day' ? 'day' : 'week'; F.day = weeks[li].dates.includes(todayEt) ? todayEt : weeks[li].dates[0];
      } else {
        const got = await nav.loadWeek(mon);
        if (got.archive) ARCH = got.archive;
        HV = { monday: mon, none: !!got.none, error: got.error || null };
        if (got.model) { await Promise.race([Promise.all(loadLogos(got.model.R)), new Promise((ok) => setTimeout(ok, 4000))]); ({ R, XV, weeks, flags } = got.model); }
        else { R = []; XV = []; flags = {}; weeks = [{ monday: mon, dates: [0, 1, 2, 3, 4].map((n) => addD(mon, n)) }]; }
        F.range = F.range == 'day' ? 'day' : 'week'; F.day = weeks[0].dates[0];
      }
      EXP.clear(); go();
    } finally { BUSY = false; }
  }

  /* ===== MOSAIC render: squarified treemap of headliners, notable names and red reports per lane; slim Ladder rows for the rest ===== */
  const EL = $('wk'), wkin = () => EL.firstElementChild;
  const BL = { am: ['sun', 'Before the open', 'AM'], mk: ['clk', 'Market hours', ''], pm: ['moon', 'After the close', 'PM'], nt: ['clk', 'Time not given', 'NT'] };
  const WL = { 1: 17, 2: 9.5, 3: 5.2, 4: 3.6 };
  const capf = (c) => (c == null ? .8 : .8 + .4 * Math.max(0, Math.min(1, (Math.log10(c) - .5) / 3.1)));
  /* a tile's area follows market value: weight = square root of the value in $B (a missing value counts as 0), headliners 1.6 times that;
     rows (tiers 3 and 4) keep the old weights, which only order them */
  const wE = (r) => (r.lvl <= 2 ? Math.sqrt(r.c ?? 0) * (r.lvl == 1 ? 1.6 : 1) : WL[r.lvl] * capf(r.c)), wX = (x) => ({ h: 19, m: 8, l: 4.4, n: 4.4 })[x.i];
  const REM = () => parseFloat(getComputedStyle(document.documentElement).fontSize);
  const estOf = () => ''; // no announced time shows nothing; the lane already says before open or after close (Adam, 2026-10-27)
  const fx = (x) => (x.tm ? fm(x.tm) : 'time n/a');
  const tmx = (r) => (r.tm ? fm(r.tm) : estOf(r));
  const tmh = (r) => (r.tm ? fm(r.tm) : `<span class="est">${estOf(r)}</span>`);
  const mkd = (r) => `<span class="mk${r.e ? ' e' : ''}"></span>`;
  const FEDP = (x) => (x.fed ? '<span class="fed">FED</span>' : '');
  const plural = (n, w) => n + ' ' + w + (n == 1 ? '' : 's');
  function fitRows() {
    wkin().querySelectorAll('.sr .nm').forEach((el) => {
      const over = () => el.scrollWidth > el.clientWidth;
      if (!over()) return; const s = el.dataset.s; if (s && s !== el.textContent) { el.textContent = s; if (!over()) return; }
      /* a company name that still does not fit is cut with an ellipsis (the row's tooltip has it whole); only a name with under about 3 characters of room is left out */
      if (el.tagName == 'SPAN' && el.clientWidth < 3.2 * REM()) el.textContent = ''; else el.style.textOverflow = 'ellipsis';
    });
  }
  let TM = {}, TMD = {}, uid = 0, Z = 1, Kfix = 0, VW = 0, VH = 0; /* TMD: tile map id to its day */
  /* real logo files, preloaded and painted onto canvases (a plain img can stay blank in a screenshot); a company with no logo file draws its ticker */
  const IMG = {};
  const loadLogos = (rows) => [...new Set(rows.map((r) => r.t))].filter((t) => !(t in IMG)).map((t) => {
    const file = logos[t] || logos[t.replace(/\./g, '-')];
    if (!file) { IMG[t] = null; return Promise.resolve(); }
    const i = new Image(); IMG[t] = i; i.onload = () => paintLogos(); i.src = window.MG.logoBase + file;
    return i.decode().catch(() => 0);
  });
  const LOGOS = loadLogos(R);
  const arOf = (t) => { const i = IMG[t]; return i && i.naturalWidth ? i.naturalWidth / i.naturalHeight : 1; };
  let RP = 16;
  const boxW = (t, h, maxW) => { const ar = arOf(t); return ar > 1.9 ? Math.min(maxW, h * Math.min(ar, maxW / h)) : h; };
  /* a logo that would draw under about 10px tall is replaced by a ticker monogram */
  const monoFor = (t, h, maxW) => { const ar = arOf(t), w = boxW(t, h, maxW); return Math.min(h * .9, w * .9 / ar) * RP * Z < 5; };
  const logoA = (t, h, maxW) => `<span class="lgo" data-t="${esc(t)}"${monoFor(t, h, maxW) ? ' data-m="1"' : ''} style="--s:${h.toFixed(2)}rem;--w:${boxW(t, h, maxW).toFixed(2)}rem"><canvas></canvas></span>`;
  /* slim rows: one fixed logo slot in every row; a wordmark scales to fit it, and one that would draw under ~10px tall becomes a plain neutral empty slot */
  let RF = 1;
  function rowLogo(t) {
    const wide = arOf(t) > 1.9, mono = wide && (4.6 * .9 / arOf(t)) * RF * RP * Z < 5;
    return mono ? '<span class="lgo n"></span>' : `<span class="lgo${wide ? ' w' : ''}" data-t="${esc(t)}"><canvas></canvas></span>`;
  }
  /* Logos are drawn straight onto the dark tile, with no plate: the near-white background that touches the image edge is made transparent
     (flood fill from opaque near-white edge pixels, so white inside the mark stays), and a mark whose visible pixels are mostly dark is
     recolored light (#e6edef) keeping its alpha. Done once per logo at up to 256px, then reused for every tile. */
  const PROC = {};
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
      const cw = Math.round(w * .9 * dprD * Z), ch = Math.round(h * .9 * dprD * Z); c.width = cw; c.height = ch; const g = c.getContext('2d');
      const ar = im && im.naturalWidth ? im.naturalWidth / im.naturalHeight : 0, dh = ar ? Math.min(ch, cw / ar) : 0;
      if (!ar || el.dataset.m === '1' || dh / dprD < 5) {
        const tx = t; let fs = ch * .74; g.fillStyle = '#e6edef'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `800 ${fs}px Manrope,"Segoe UI",sans-serif`;
        while (g.measureText(tx).width > cw * .96 && fs > 5) { fs -= 1; g.font = `800 ${fs}px Manrope,"Segoe UI",sans-serif`; } g.fillText(tx, cw / 2, ch / 2 + fs * .04); return;
      }
      const dw = ar >= cw / ch ? cw : ch * ar, dh2 = dw / ar; g.drawImage(processed(t, im), (cw - dw) / 2, (ch - dh2) / 2, dw, dh2);
    });
  }
  function itemsOf(d, b, D) {
    const ee = b == 'mk' ? [] : D.er.filter((r) => r.d == d && r.ses == BL[b][2]), ex = D.xe.filter((x) => x.d == d && ph(x.tm) == b);
    return [...ee.map((r) => ({ k: 'e', r, v: wE(r) })), ...ex.map((x) => ({ k: 'x', x, v: wX(x) }))].sort((a, b) => b.v - a.v);
  }
  /* tiles = headliners, notable names (unless demoted for being too small) and red high-impact reports; everything else is a slim row */
  /* R3 "Expand to see N more": a lane shows as many earnings rows as fit the window height (LIM, set by fitHeight), biggest value first;
     the rest sit behind one "+N more" row that opens them in place (EXP) and folds them back. Economic rows never collapse. */
  /* TFD: each day's box scale (1 = the design's floors), lowered only for a day that is still taller than the window once every lane's rows are cut */
  let LIM = {}, TFD = {}, FITTING = false; const EXP = new Set(), LIMD = new Set(), MINTF = .1;
  /* no one box takes more than about 30% of its lane's box area: a giant's weight is capped (only in a lane of four or more boxes, where 30% is possible) */
  function capBoxes(tiles) {
    let t = tiles;
    for (let i = 0; i < 6 && t.length >= 4; i++) {
      const cap = .3 * t.reduce((s, o) => s + o.v, 0);
      if (t.every((o) => o.v <= cap * 1.001)) break;
      t = t.map((o) => (o.v > cap ? { ...o, v: cap } : o));
    }
    return t;
  }
  function splitZ(d, b, X) {
    const it = itemsOf(d, b, X), isTile = (o) => (o.k == 'e' ? o.r.lvl <= 2 : o.x.i == 'h');
    const key = d + '|' + b, all = it.filter((o) => o.k == 'e' && !isTile(o)).map((o) => o.r);/* itemsOf orders by value, biggest first */
    const open = !FITTING && EXP.has(key) && LIMD.has(key), lim = open ? undefined : LIM[key], shown = lim == null ? all : all.slice(0, lim), hidden = all.length - shown.length;
    return { b, key, it, tiles: capBoxes(it.filter(isTile)), rx: it.filter((o) => o.k == 'x' && o.x.i != 'h').map((o) => o.x).sort(tmSort), re: [...shown].sort(tmSort), hidden, open, extra: hidden > 0 || open ? 1 : 0 };
  }
  const rowsRem = (s, cols) => { const n = s.rx.length + s.re.length; return n || s.extra ? (Math.ceil(n / (cols || 1)) + s.extra) * 1.21 * RF + .3 : 0; };
  function rowsHTML(s) {
    const rx = s.rx.map((x) => `<div class="sr i${x.i}" title="${esc(x.n)}"><b class="nm">${esc(x.n)}</b>${FEDP(x)}<span class="tm">${fx(x)}</span></div>`);
    const re = s.re.map((r) => `<div class="sr${r.lvl >= 4 ? ' mn' : ''}" title="${esc(r.n)}"><span class="ls">${rowLogo(r.t)}</span><b class="tk2">${esc(r.t)}</b><span class="nm">${esc(r.n)}</span><span class="vl">${fv(r.c)}</span><span class="tm">${r.mid ? '<span class="mdt">MIDDAY</span>' : ''}${tmh(r)}</span></div>`);
    const more = s.hidden > 0 ? `<div class="sr more" role="button" tabindex="0" data-a="more:${s.key}" title="Show the ${s.hidden} smaller reports">+${s.hidden} more</div>` : s.open ? `<div class="sr more" role="button" tabindex="0" data-a="more:${s.key}" title="Fold the smaller reports back">Show fewer</div>` : '';
    // an opened list also gets a "Show fewer" at its top that sticks while scrolling, so it folds from either end (Adam, 2026-10-28)
    const top = s.open ? `<div class="sr more top" role="button" tabindex="0" data-a="more:${s.key}" title="Fold the smaller reports back">Show fewer</div>` : '';
    return rx.length + re.length + (more ? 1 : 0) ? `<div class="rows${s.re.some((r) => r.mid) ? ' hasmid' : ''}">${rx.join('')}${top}${re.join('')}${more}</div>` : '';
  }
  function wr(row, s) { const sum = row.reduce((a, b) => a + b.a, 0), mx = Math.max(...row.map((r) => r.a)), mn = Math.min(...row.map((r) => r.a)); return Math.max(s * s * mx / (sum * sum), sum * sum / (s * s * mn)); }
  function squarify(items, x, y, w, h) {
    const tot = items.reduce((a, b) => a + b.v, 0), out = []; items.forEach((i) => { i.a = i.v * w * h / tot; });
    let rest = items.slice();
    while (rest.length) {
      const s = Math.min(w, h); let row = [rest[0]], worst = wr(row, s);
      for (let i = 1; i < rest.length; i++) { const t = row.concat(rest[i]), wt = wr(t, s); if (wt <= worst) { row = t; worst = wt; } else break; }
      rest = rest.slice(row.length); const rs = row.reduce((a, b) => a + b.a, 0);
      if (w >= h) { const cw = rs / h; let yy = y; row.forEach((i) => { const hh = i.a / cw; out.push({ i, x, y: yy, w: cw, h: hh }); yy += hh; }); x += cw; w -= cw; }
      else { const rh = rs / w; let xx = x; row.forEach((i) => { const ww = i.a / rh; out.push({ i, x: xx, y, w: ww, h: rh }); xx += ww; }); y += rh; h -= rh; }
    }
    return out;
  }
  /* ---------- earnings tile: priority ticker, time, value, name (name is dropped first, time never) ---------- */
  function earnTile(r) {
    const t = `title="${esc(r.n)} (${esc(r.t)}), ${fv(r.c)}, ${tmx(r)}"`;
    return { c: `tl l${r.lvl}${r.e ? ' e' : ''}`, t, h: '', attr: ` data-rk="${r.k}"` };
  }
  function variantHTML(r, wR, hR, v) {
    const pad = .34, iw = wR - 2 * pad - .06, ih = hR - 2 * pad - .06, base = Math.sqrt(wR * hR), L = r.t.length, k = v.k, big = base > 12;
    const ar = arOf(r.t), wl = ar > 1.9, sc = Math.max(1, Math.min(big ? 1.7 : 1.3, base / 6.8)), f2 = Math.max(.68 * RF, .72 * sc * k);/* time and value never go below about the row text size */
    const lg = Math.max(.75, Math.max(1, Math.min(big ? 5 : 3.2, base * .27)) * k), fk = Math.max(.68, Math.max(.82, Math.min(big ? 3.2 : 1.9, base * .15)) * k);
    const vt = fv(r.c), F2 = f2.toFixed(2), physPx = RP * Z;
    const tline = () => `<div class="tt" style="font-size:${F2}rem">${mkd(r)} ${tmh(r)}${v.vp == 'in' ? ` <span class="v">&middot; ${vt}</span>` : ''}</div>` + (v.vp == 'ln' ? `<div class="tt" style="font-size:${F2}rem"><span class="v">${vt}</span></div>` : '');
    const nameH = `<div class="nmx" style="font-size:${F2}rem">${esc(r.n)}</div>`;
    const logoBox = (h, maxW) => { const w = wl ? Math.min(h * ar, Math.max(h, maxW)) : h, hd = Math.min(h * .9, w * .9 / ar) * physPx; if (hd < 5) return null; return logoA(r.t, h, w); };
    const T = esc(r.t);
    if (v.lay == 'top') {
      const lh = Math.min(lg, ih * .42), lgh = logoBox(lh, iw); if (!lgh) return null;
      return `<div class="hd">${lgh}</div><div class="trow"><div class="tk" style="font-size:${fk.toFixed(2)}rem">${T}</div>${tline()}</div>` + (v.c >= 4 ? nameH : '');
    }
    if (v.lay == 'wd') {
      const lfW = Math.min(iw * .5, Math.max(10, L * fk * .9 + 4)), lh = Math.min(lg, ih * .5), lgh = logoBox(lh, lfW - .4 - L * fk * .8); if (!lgh) return null;
      return `<div class="lf" style="width:${lfW.toFixed(2)}rem"><div class="hd">${lgh}<div class="tk" style="font-size:${fk.toFixed(2)}rem">${T}</div></div>${tline()}</div><div class="rt"><div class="nmx" style="font-size:${(f2 * 1.1).toFixed(2)}rem;color:#fff">${esc(r.n)}</div></div>`;
    }
    if (v.lay == 'side') {
      const maxW = iw - .45 - L * fk * .78, lgh = logoBox(lg, maxW); if (!lgh) return null;
      return `<div class="hd">${lgh}<div><div class="tk" style="font-size:${fk.toFixed(2)}rem">${T}</div>${v.c >= 4 ? nameH : ''}</div></div>` + tline();
    }
    const lgh = logoBox(lg, iw); if (!lgh) return null;
    return `<div class="hd st">${lgh}<div class="tk" style="font-size:${fk.toFixed(2)}rem">${T}</div></div>` + (v.c >= 4 ? nameH : '') + tline();
  }
  const tileFits = (el) => {
    const cs = getComputedStyle(el), pb = parseFloat(cs.paddingBottom), pr = parseFloat(cs.paddingRight), H = el.clientHeight - pb + 1, Wd = el.clientWidth - pr + 1;
    return el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1 && [...el.querySelectorAll('*')].every((n) => n.tagName == 'CANVAS' || (n.offsetTop + n.offsetHeight <= H && n.offsetLeft + n.offsetWidth <= Wd)) && [...el.querySelectorAll('.tk,.tt,.hd,.lf')].every((n) => n.scrollWidth <= n.clientWidth + 1) && [...el.querySelectorAll('.nmx')].every((n) => n.scrollWidth <= n.clientWidth);
  };
  function fitTile(el, r, wR, hR) {
    const seq = [], wide = wR >= 7.4 && hR <= wR * .7 && hR >= 3.1, wl = arOf(r.t) > 1.9, tall = hR > 4.5, base = Math.sqrt(wR * hR);
    /* type size is the outer loop (largest first, with a floor); content level (name) is the inner loop, so the name is dropped before type gets small */
    const ks = base > 4.2 ? [1.5, 1.3, 1.15, 1, .88, .76, .66, .56, .48] : [1, .88, .76, .66, .56, .48];
    const lays = (wl ? ['top'] : []).concat(tall ? ['stack', 'side'] : ['side', 'stack']);
    ks.forEach((k) => { [5, 4, 3].forEach((c) => { if (wide && c >= 4 && k <= 1.3) seq.push({ c, lay: 'wd', vp: 'in', k }); lays.forEach((lay) => ['in', 'ln'].forEach((vp) => seq.push({ c, lay, vp, k }))); }); });
    for (const v of seq) {
      const h = variantHTML(r, wR, hR, v); if (h == null) continue;
      el.classList.toggle('wd', v.lay == 'wd'); el.innerHTML = h;
      if (tileFits(el)) { el.dataset.v = [v.c, v.lay, v.vp, v.k].join(' '); return true; }
    }
    /* a very small box (a crowded day scaled down to fit the window): the logo goes first, then the time, then the name was already gone;
       ticker and value never go, their type shrinking until they fit */
    const T = esc(r.t), vt = fv(r.c);
    el.classList.remove('wd'); el.style.padding = '.18rem';
    for (const withTime of [true, false]) {
      for (const k of [1.1, .95, .82, .7, .6, .5, .42]) {
        el.innerHTML = `<div class="tk" style="font-size:${k.toFixed(2)}rem">${T}</div><div class="tt" style="font-size:${(k * .85).toFixed(2)}rem">${withTime && r.tm ? `${mkd(r)} ${tmh(r)} ` : ''}<span class="v">${vt}</span></div>`;
        if (tileFits(el)) { el.dataset.v = `min ${withTime ? 'time' : 'tv'} ${k}`; return true; }
      }
    }
    return false;
  }
  function fitAll() {
    const rem = REM();
    /* a tile that fits no variant keeps the smallest one tried: a box is never turned into a row */
    wkin().querySelectorAll('.tmap:not([data-mini]) .tl[data-rk]').forEach((el) => fitTile(el, R[+el.dataset.rk], el.clientWidth / rem, el.clientHeight / rem));
    wkin().querySelectorAll('.tmap:not([data-mini]) .tl[data-xk]').forEach((el) => fitEcon(el, XV[+el.dataset.xk], el.clientWidth / rem, el.clientHeight / rem));
  }
  /* ---------- red high-impact tile: name, time, HIGH and FED badges ---------- */
  function econTile(x) { return { c: 'tl x ih', t: `title="${esc(x.n)}, ${fx(x)}"`, h: '', attr: ` data-xk="${x.k}"` }; }
  function econHTML(x, u, subL, st) {
    const lg = Math.min(4.4, 1.7 * u), fn = Math.min(2.6, .98 * u), f2 = .74 * u, fb = Math.max(.5, .52 * u);
    const badge = x.code ? `<span class="cd" style="--s:${lg.toFixed(2)}rem;font-size:${(lg * .27).toFixed(2)}rem">${esc(x.code)}</span>` : '';
    return `<div class="hd${st ? ' st' : ''}">${badge}<div class="tk" style="font-size:${fn.toFixed(2)}rem">${esc(x.n)}</div></div><div class="tt" style="font-size:${f2.toFixed(2)}rem;white-space:normal"><span style="white-space:nowrap">${fx(x)}</span> <span style="white-space:nowrap"><span class="hg" style="font-size:${fb.toFixed(2)}rem;margin-left:0">HIGH</span>${x.fed ? ` <span class="fed" style="margin-left:.15rem;font-size:${fb.toFixed(2)}rem">FED</span>` : ''}</span></div>`;
  }
  function fitEcon(el, x, wR, hR) {
    /* type size outer (largest first, floor = row text) */
    const base = Math.sqrt(wR * hR), k0 = Math.max(1, Math.min(2.4, base / 4.6)), uf = .68 * RF / .74;
    for (let u = k0; u >= uf * .999; u *= .93) for (const st of [0, 1]) { el.innerHTML = econHTML(x, u, 0, st); if (tileFits(el)) return true; }
    for (let u = uf * .93; u >= .72; u *= .93) for (const st of [0, 1]) { el.innerHTML = econHTML(x, u, 0, st); if (tileFits(el)) return true; }
    el.innerHTML = econHTML(x, .72, 0, 1); return true;
  }
  function miniTile(it, wR, hR) {
    const m = Math.min(wR, hR);
    if (it.k == 'e') {
      const r = it.r, t = `title="${esc(r.n)} (${esc(r.t)}), ${fv(r.c)}, ${tmx(r)}"`, c = `tl l${r.lvl} zs${r.e ? ' e' : ''}`;
      const lh = Math.max(.9, Math.min(2.4, m * .62));
      return { c, t, h: (it.top || (m >= 2.3 && r.lvl <= 2)) ? logoA(r.t, lh, Math.max(lh, Math.min(lh * 3, wR - .25))) : '' };
    }
    const x = it.x, t = `title="${esc(x.n)}, ${fx(x)}"`;
    return { c: `tl x i${x.i} zs`, t, h: x.i == 'h' && x.code && m >= 2.3 ? `<span class="cd" style="--s:${(m * .6).toFixed(2)}rem">${esc(x.code)}</span>` : '' };
  }
  function tileHTML(it, wR, hR, mini) { return mini ? miniTile(it, wR, hR) : it.k == 'e' ? earnTile(it.r) : econTile(it.x); }
  function layoutAll() {
    const rem = REM();
    wkin().querySelectorAll('.tmap').forEach((el) => {
      const it = TM[el.dataset.id], mini = el.dataset.mini == '1'; if (!it || !it.length) { el.innerHTML = ''; return; }
      const W = el.clientWidth, H = el.clientHeight; if (!W || !H) return;
      const rects = squarify(it.map((o) => Object.assign({}, o)), 0, 0, W, H);
      el.innerHTML = rects.map((r) => { const o = tileHTML(r.i, r.w / rem, r.h / rem, mini); return `<div class="${o.c}" ${o.t}${o.attr || ''} style="left:${(r.x + 1).toFixed(1)}px;top:${(r.y + 1).toFixed(1)}px;width:${Math.max(0, r.w - 2).toFixed(1)}px;height:${Math.max(0, r.h - 2).toFixed(1)}px">${o.h}</div>`; }).join('');
    });
  }
  function zoneHTML(s) {
    if (!s.it.length) return '';
    let tm = ''; if (s.tiles.length) { const id = 'z' + (uid++); TM[id] = s.tiles; TMD[id] = s.key.split('|')[0]; tm = `<div class="tmap" data-id="${id}"></div>`; }
    const ne = s.it.filter((o) => o.k == 'e').length, nx = s.it.length - ne;
    return `<section class="zn ${s.b == 'mk' ? 'mk2' : s.b}" data-b="${s.b}"><div class="zh"><svg class="ico"><use href="#${BL[s.b][0]}"/></svg>${BL[s.b][1]}<em>${ne ? plural(ne, 'report') : ''}${ne && nx ? ' + ' : ''}${nx ? plural(nx, 'event') : ''}</em></div>${tm}${rowsHTML(s)}</section>`;
  }
  function counts(er, xe) { const a = []; if (F.show != 'econ') a.push(`<b>${er.length}</b> ${er.length == 1 ? 'report' : 'reports'}`); if (F.show != 'earn') a.push(`<b>${xe.length}</b> ${xe.length == 1 ? 'event' : 'events'}`); return a.join(' &middot; '); }
  const flagsHTML = (d) => ((flags[d] || []).length ? `<div class="fl">${flags[d].map((f) => `<span class="flg${f.cl ? ' cl' : ''}" title="${esc(f.title)}">${esc(f.text)}</span>`).join('')}</div>` : '');
  function dayHTML(d, D, wide) {
    const er = D.er.filter((r) => r.d == d), xe = D.xe.filter((x) => x.d == d), hi = xe.filter((x) => x.i == 'h').length;
    const zs = ZN.map((b) => splitZ(d, b, D)), band = wide ? zs.find((s) => s.b == 'mk' && s.it.length && !s.tiles.length) : null;
    return `<article class="day pad${wide ? ' wide' : ''}${d == todayEt ? ' today' : ''}" data-d="${d}"><div class="dh"><button class="dn" data-a="day:${d}"><b>${dowOf(d)}</b><span>${dnum(d)}</span></button>${d == todayEt ? '<span class="tdy">Today</span>' : ''}${hi ? `<span class="hp">${hi} high-impact</span>` : ''}<span class="cnt">${counts(er, xe)}</span></div>${flagsHTML(d)}${band ? `<div class="mkband"><span class="mbh"><svg class="ico"><use href="#clk"/></svg>Market hours</span>${rowsHTML(band)}</div>` : ''}<div class="zones">${zs.filter((s) => s !== band).map(zoneHTML).join('')}</div></article>`;
  }
  function miniHTML(d, D) {
    const er = D.er.filter((r) => r.d == d), xe = D.xe.filter((x) => x.d == d), hi = xe.filter((x) => x.i == 'h').length;
    const it = ZN.flatMap((b) => itemsOf(d, b, D)).sort((a, b) => b.v - a.v), id = 'z' + (uid++); if (it[0]) it[0].top = true; TM[id] = it;
    const cn = []; if (F.show != 'econ') cn.push(`<b>${er.length}</b>`); if (F.show != 'earn') cn.push(`${xe.length}`);
    return `<div class="mini pad${d == fday() ? ' on' : ''}" data-a="day:${d}"><div class="dh"><button class="dn"><b>${dowOf(d)}</b><span>${dnum(d)}</span></button>${hi ? `<span class="hp">${hi} high</span>` : ''}<span class="cnt">${cn.join(' &middot; ')}</span></div><div class="tmap" data-id="${id}" data-mini="1"></div></div>`;
  }
  /* A lane's tile map height (px) from its tiles alone: area per unit of weight is set so the smallest tile is at least the design's small
     tile (about 5rem x 3.4rem) and a headliner at least the design's big tile (about 11rem x 6rem), with a margin for the treemap's
     uneven shapes; an economic red tile is at least 6rem x 5rem. Relative sizes inside the lane stay proportional to value. */
  const TILE_FLOOR_REM2 = { x: 30, 1: 66, 2: 17 };
  function tileMapH(it, width, rem, tf = 1) {
    const tot = it.reduce((s, o) => s + o.v, 0);
    if (!tot || !width) return 3.6 * rem;
    const floor = (o) => (o.k == 'x' ? TILE_FLOOR_REM2.x : TILE_FLOOR_REM2[o.r.lvl] || TILE_FLOOR_REM2[2]);
    /* RF is 1.25 on the laptop, where the type floor is larger, so the floors grow with it (a tile must still fit logo, ticker, time and value) */
    const area = tf * 1.7 * RF * RF * Math.max(...it.map((o) => floor(o) * tot / o.v)) * rem * rem;
    const tall = it.some((o) => o.k == 'x' || o.r.lvl == 1);
    return Math.max((tall ? 6.2 : 3.6) * rem, area / width);
  }
  /* Scale rule (laptop day view only): one area-per-weight constant K, fixed by the busiest UNFILTERED day, so a tile keeps its importance size under any filter and a filtered day block shrinks to its content. */
  function sizeAll(D, U, focus, rem) {
    const tw = (s) => s.tiles.reduce((a, o) => a + o.v, 0), fw = (d, b, X) => itemsOf(d, b, X).reduce((s, o) => s + o.v, 0);
    const SU = (d, wide) => ZN.map((b) => splitZ(d, b, U)).filter((s) => s.it.length && !(wide && s.b == 'mk' && !s.tiles.length));
    const maxFull = Math.max(1, ...days().map((d) => ZN.reduce((a, b) => a + fw(d, b, U), 0)));
    const W = wkin();
    if (focus) {
      /* week strip: each day's map keeps one shared scale; the strip is only as tall as its tallest map */
      const minis = [...W.querySelectorAll('.mini .tmap')];
      if (minis.length) {
        const mw = minis[0].clientWidth, Hm = 5.2 * rem, K = mw * Hm / maxFull;
        minis.forEach((el, i) => { const sum = ZN.reduce((a, b) => a + fw(days()[i], b, D), 0); el.style.height = Math.max(1.4 * rem, Math.min(Hm, sum * K / mw)) + 'px'; });
      }
      const day = W.querySelector('.day.wide'); if (!day) return;
      const zl = [...day.querySelectorAll('.zn')]; if (!zl.length) return;
      const ZH = day.querySelector('.zones').clientHeight, zcw = .6 * rem + 2, zcv = zl[0].querySelector('.zh').offsetHeight + .6 * rem + 5, gap = .5 * rem;
      const minOf = (s, c) => (s.re.length ? (c > 1 ? c * 24 : 26) * RF : s.rx.length ? 14 * RF : 12) * rem, lim = VW - 1.2 * rem - 4;
      /* K comes from the unfiltered day so tiles keep their size. Row columns per lane are settled first, then K is solved with those columns held fixed. */
      const colsOf = (inner) => Math.max(1, Math.floor(inner / (24 * RF * rem)), Math.ceil(inner / (40 * rem)));
      const Hof = (s, c) => ZH - zcv - rowsRem(s, c) * rem, laneK = (s, K, c) => Math.max(minOf(s, c), s.tiles.length ? K * tw(s) / Hof(s, c) : 0) + zcw;
      const su = SU(fday(), true); let K = 0, cols = {};
      const solve = (cm) => { const need = (k) => su.reduce((a, s) => a + laneK(s, k, cm[s.b] || 1), 0) + (su.length - 1) * gap; let lo = 0, hi = 1e7; for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (need(m) > lim) hi = m; else lo = m; } return lo * .99; };
      for (let pass = 0; pass < 4; pass++) {
        K = solve(cols); const nc = {}; su.forEach((s) => { nc[s.b] = colsOf(laneK(s, K, cols[s.b] || 1) - zcw); });
        if (su.every((s) => nc[s.b] == (cols[s.b] || 1))) break; cols = pass == 3 ? cols : nc;
      }
      /* feasibility: the lanes' minimum widths (with their row columns) must fit the panel; otherwise drop a row column from the widest lane */
      for (let g = 0; g < 6; g++) {
        const mins = su.reduce((a, s) => a + minOf(s, cols[s.b] || 1) + zcw, 0) + (su.length - 1) * gap; if (mins <= lim) break;
        const w = su.filter((s) => (cols[s.b] || 1) > 1).sort((a, b) => (cols[b.b] || 1) - (cols[a.b] || 1))[0]; if (!w) break; cols[w.b] = (cols[w.b] || 1) - 1;
      }
      K = solve(cols);
      const sd = zl.map((zn) => splitZ(fday(), zn.dataset.b, D)), wd = sd.map((s) => laneK(s, K, cols[s.b] || 1)), extra = Math.max(0, lim - wd.reduce((a, b) => a + b, 0) - (sd.length - 1) * gap);
      zl.forEach((zn, i) => {
        const w = wd[i] + extra / zl.length, s = sd[i], c = cols[s.b] || 1; zn.style.width = w + 'px'; const rw = zn.querySelector('.rows'); if (rw) rw.style.gridTemplateColumns = `repeat(${c},minmax(0,1fr))`;
        const tm = zn.querySelector('.tmap');
        if (tm) { const inner = w - zcw, Hh = Hof(s, c); tm.style.flex = 'none'; tm.style.height = tileMapH(s.tiles, inner, rem, TFD[fday()] ?? 1) + 'px'; }
      });
      /* the day panel shrinks to its content once the lanes are sized */
      day.style.flex = '0 0 auto'; day.querySelector('.zones').style.flex = 'none';
    } else {
      /* each lane's tile map is sized from its own tiles, never from the busiest day's rows: the lane grows as tall as its tiles need
         (the page scrolls), so every $50B+ company stays a box */
      W.querySelectorAll('.zn .tmap').forEach((el) => { el.style.flex = 'none'; el.style.height = tileMapH(TM[el.dataset.id] || [], el.clientWidth, rem, TFD[TMD[el.dataset.id]] ?? 1) + 'px'; });
    }
  }
  function build(D, focus) {
    TM = {}; TMD = {}; uid = 0; VW = EL.clientWidth / Z; VH = EL.clientHeight / Z;
    const inner = focus ? `<div class="strip">${days().map((d) => miniHTML(d, D)).join('')}</div>${dayHTML(fday(), D, true)}` : days().map((d) => dayHTML(d, D, false)).join('');
    const dmin = active() ? (RF > 1 ? '17rem' : '19rem') : D.er.length ? '21rem' : '19rem';
    EL.innerHTML = `<div class="wkin${focus ? ' focus' : ''}" style="--dmin:${dmin};width:${VW}px;height:${VH}px;transform:scale(${Z})">${inner}</div>`;
  }
  /* Fit the window height without page scrolling: cut earnings rows (smallest value first) into each lane's "+N more" row until every day
     fits (week view: lanes stack, so the day's cut is shared across its lanes; day view: lanes sit side by side, so each tall lane is cut
     on its own). If the boxes alone are too tall, that day's boxes scale down uniformly (TFD, never below MINTF). Expanded lanes (EXP) are laid out
     after this, so a click grows the page instead of cutting other lanes. */
  function fitHeight(D, U, focus, rem) {
    const rowPx = 1.21 * RF * rem;
    FITTING = true; LIM = {}; LIMD.clear(); TFD = {};
    build(D, focus); sizeAll(D, U, focus, rem); // start from every row shown (the pass's own build used the previous limits)
    const laneState = (d, b) => { const s = splitZ(d, b, D), n = s.re.length + s.hidden; return { key: s.key, shown: s.re.length, n, s }; };
    const cut = (L, k, cols) => { // cols rows per display row; the "+N more" row takes one display row once the lane is cut
      const display = Math.ceil(L.shown / cols) + (L.n > L.shown ? 1 : 0), target = display - k, ns = Math.max(0, (target - 1) * cols);
      if (ns >= L.shown) return false;
      L.shown = ns; LIM[L.key] = ns; LIMD.add(L.key); return true;
    };
    /* the day's boxes shrink by the share of their height that is still over the window (the heights follow the scale), never below MINTF */
    const shrink = (d, boxesPx, overPx) => {
      const t = TFD[d] ?? 1; if (t <= MINTF || !boxesPx) return false;
      TFD[d] = Math.max(MINTF, t * Math.max(.6, 1 - (overPx + 2) / boxesPx)); return true;
    };
    for (let it = 0; it < 14; it++) {
      let over = 0, moved = false;
      if (!focus) {
        for (const day of wkin().querySelectorAll('.day')) {
          const o = day.offsetHeight - VH + 2; if (o <= 0) continue; over += o;
          const d = day.dataset.d, lanes = ['am', 'pm', 'nt'].map((b) => laneState(d, b)).filter((L) => L.n > 0);
          let need = Math.ceil(o / rowPx);
          for (let g = 0; need > 0 && g < 400; g++) {
            const L = lanes.filter((x) => x.shown > 0).sort((a, b) => b.shown - a.shown)[0]; if (!L) break;
            const before = L.shown + (L.n > L.shown ? 1 : 0);
            if (!cut(L, 1, 1)) { L.shown = 0; continue; } // this lane cannot give a row back; skip it for this day
            moved = true; need -= before - (L.shown + 1);
          }
          /* every row that can go is cut and the day is still too tall: its boxes scale down (this day only) */
          if (need > 0 && shrink(d, [...day.querySelectorAll('.tmap')].reduce((s, t) => s + t.offsetHeight, 0), need * rowPx)) moved = true;
        }
      } else {
        const strip = wkin().querySelector('.strip'), day = wkin().querySelector('.day.wide'); if (!day) break;
        const o = (strip ? strip.offsetHeight : 0) + .7 * rem + day.offsetHeight - VH + 2;
        if (o > 0) {
          over = o;
          const zl = [...day.querySelectorAll('.zn')], target = Math.max(...zl.map((z) => z.offsetHeight)) - o;
          for (const z of zl) {
            if (z.offsetHeight <= target) continue;
            const L = laneState(fday(), z.dataset.b), rows = z.querySelector('.rows'), cols = rows ? getComputedStyle(rows).gridTemplateColumns.split(' ').length : 1;
            if (L.n > 0 && cut(L, Math.ceil((z.offsetHeight - target) / rowPx), cols)) moved = true;
          }
          if (!moved && shrink(fday(), Math.max(...zl.map((z) => z.querySelector('.tmap')?.offsetHeight ?? 0)), o)) moved = true; // no row left to cut: the boxes scale down
        }
      }
      if (!over || !moved) break; /* a $50B+ company is never demoted to a row: boxes only scale down, to MINTF */
      build(D, focus); sizeAll(D, U, focus, rem);
    }
    FITTING = false;
    build(D, focus); sizeAll(D, U, focus, rem);
  }
  let laidFor = '';
  function render() {
    if (HV?.none) { /* an earlier week with nothing saved, or whose archive could not be read: one plain line, never an empty week */
      EL.innerHTML = `<div class="none">${HV.error ? `The saved calendar for this week could not be loaded (${esc(HV.error)})` : 'No saved calendar for this week'}</div>`;
      $('stt').textContent = ''; laidFor = ''; return;
    }
    const D = dataset(), U = dataset(F0()), rem = REM(), focus = F.range == 'day' || (LAP() && !active());
    RF = LAP() ? 1.25 : 1;
    const pass = (zv) => { Z = zv; build(D, focus); sizeAll(D, U, focus, rem); fitHeight(D, U, focus, rem); layoutAll(); fitRows(); };
    RP = rem; Kfix = 0; pass(1);
    /* filtered week: scale the whole week by one uniform factor (up to 2x) so the tallest day fills the height; relative sizes stay comparable */
    let zUsed = 1;
    if (!focus) {
      const avail = EL.clientHeight, ht = () => Math.max(...[...wkin().querySelectorAll('.day')].map((d) => d.offsetHeight)) * Z;
      const rowsOk = () => [...wkin().querySelectorAll('.sr')].every((r) => r.scrollWidth <= r.clientWidth + 1) && [...wkin().querySelectorAll('.sr span.nm')].every((n) => n.textContent !== '') && [...wkin().querySelectorAll('.sr b.nm')].every((n) => n.scrollWidth <= n.clientWidth + 1);
      const fits = () => ht() <= avail * .985 && wkin().scrollWidth <= wkin().clientWidth + 1 && rowsOk();
      if (ht() < avail * .82) { let lo = 1, hi = 2; for (let i = 0; i < 7; i++) { const m = (lo + hi) / 2; pass(m); if (fits()) lo = m; else hi = m; } pass(lo); zUsed = lo; }
    }
    /* fill every tile from the richest variant that fits */
    fitAll();
    fitRows();
    $('stt').innerHTML = `Showing <b>${D.er.length}</b> of ${D.nr} reports &middot; <b>${D.xe.length}</b> of ${D.nx} events`;
    paintLogos();
    laidFor = innerWidth + 'x' + innerHeight + '/' + EL.clientWidth + 'x' + EL.clientHeight;
  }
  /* the layout is computed for one viewport size; if the window has a different size when it is next looked at, it is laid out again */
  let rsF = 0, rsT = 0;
  const sizeNow = () => innerWidth + 'x' + innerHeight + '/' + EL.clientWidth + 'x' + EL.clientHeight;
  const recheck = () => { if (laidFor && sizeNow() != laidFor) render(); };
  const watch = () => { new ResizeObserver(() => { if (rsF) return; rsF = requestAnimationFrame(() => { rsF = 0; recheck(); }); }).observe(EL); addEventListener('resize', () => { clearTimeout(rsT); rsT = setTimeout(recheck, 60); }); [600, 1500, 3000].forEach((ms) => setTimeout(recheck, ms)); };
  initUI(); sync();
  /* first layout waits until the logos are decoded and the window has its final size (tile areas are computed from it) */
  return Promise.race([Promise.all(LOGOS), new Promise((ok) => setTimeout(ok, 4000))]).then(() => new Promise((done) => setTimeout(() => { sync(); render(); watch(); done(); }, 300)));
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
      const logos = await getJson(MG.logosUrl()).catch(() => undefined);
      return { cal, names: undefined, logos, note: `Updated ${etClock(cal.asOf)} (local server; the relay is not available: ${why.join('; ')})` };
    } catch (e) { why.push(`local server: ${e.message}`); }
  }
  try {
    const baked = await getJson(`${MG.base}data/calendar.json`);
    const base = await getJson(`${MG.base}data/calendar-base.json`).catch(() => null);
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
