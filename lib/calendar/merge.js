// Merge parsed calendar sources into one structure per day for the Calendar page (PROJECT.md Part 4 "Calendar build", step 2).
// Pure. Inputs are the outputs of nasdaq.js and econ.js plus reference data and fetch status passed in as arguments. The page
// (step 7) owns the overflow cut ("Expand to see N more"); nothing is cut here.
import { fail, isCalendarDate, isWeekend, addDays, laneForEtMinutes, marketClosures } from './times.js';
import { TIERS, tierFor, checkTierConfig } from './tiers.js';
import { nasdaqEmptyDayKind } from './nasdaq.js';
import { filterEvents, APPEARANCE_RULE, validateReportTimeEntries } from './config.js';
import { applyReportTimes } from './lanes.js';

const SRC = 'calendar merge';
const SOURCE_STATES = ['ok', 'empty', 'failed', 'not-covered'];
const ECON_SOURCES = ['forexfactory', 'fed', 'treasury'];
const ECON_WORST_FIRST = ['failed', 'not-covered', 'ok'];
const TIME_SOURCES = ['announced', 'usual'];
const MAX_WINDOW_DAYS = 400;
// D23: the Fed's own FOMC entries and the Forex Factory titles that describe the same event. "Federal Funds Rate" stays its own.
const FOMC_TWIN = { meeting: 'FOMC Statement', 'press-conference': 'FOMC Press Conference', minutes: 'FOMC Meeting Minutes' };
// Forex Factory's title for a Fed official's appearance ("FOMC Member Daly Speaks" in the fixture; "Fed Chair Powell Testifies");
// the word before Speaks or Testifies is the surname. Testimony pairs only with Testifies, any other appearance only with Speaks.
const FF_APPEARANCE = /\b(Fed|FOMC)\b.*\s(\S+) (Speaks|Testifies)$/;
// The lead's threshold (2026-10-27): an appearance and a Forex Factory row more than 60 minutes apart are different events.
const APPEARANCE_MAX_GAP_MINUTES = 60;
const BEIGE = /^Beige Book\b/i;
// Forex Factory's title for a coupon auction, "10-y Bond Auction" style. Still unverified for USD: the first live capture
// (tests/fixtures/calendar/live-2026-10-27) had no USD auction rows, though Treasury listed a 7-year note that week; its only
// auction titles were EUR ("German 10-y Bond Auction").
const FF_AUCTION = /^(\d{1,2})-y (Bond|Note) Auction$/;
const TWIN_KINDS = ['fomc', 'appearance', 'beigeBook', 'auction'];

const TIER_RANK = Object.fromEntries([...TIERS, 'unknown', 'below-floor'].map((t, i) => [t, i]));
const byTierValueTicker = (a, b) => (TIER_RANK[a.tier] - TIER_RANK[b.tier])
  || ((b.marketValue ?? -1) - (a.marketValue ?? -1)) || a.ticker.localeCompare(b.ticker);
const IMPACT_RANK = { high: 0, medium: 1, low: 2, holiday: 3, other: 4 };
// All-day notes first, then by time, then events whose time is not yet set.
const econOrder = (a, b) => ((b.allDay - a.allDay) || ((a.minutesEt ?? 1e9) - (b.minutesEt ?? 1e9))
  || ((IMPACT_RANK[a.impact] ?? 9) - (IMPACT_RANK[b.impact] ?? 9)) || a.title.localeCompare(b.title));
const own = (o, k) => (Object.hasOwn(o, k) ? o[k] : undefined);
const isPlainObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Map) && !(v instanceof Set);

// D61: one entry per company. Rows of one day join when data/reference/cats-index.json style shareClassOf names their parent
// (GOOG -> GOOGL, BRK-B -> BRK), or when Nasdaq's class suffix (BRK.A, TAP.A, now BRK-A, TAP-A) shares a base and the exact
// company name. A suffix row whose name differs stays its own company, marked possibleShareClass so it surfaces.
function groupShareClasses(rows, shareClassOf) {
  const parentOf = (t) => own(shareClassOf, t) ?? t;
  const parents = new Set(Object.values(shareClassOf));
  const groups = new Map();
  for (const r of rows) {
    const mapped = own(shareClassOf, r.ticker) !== undefined || parents.has(r.ticker);
    const dot = /^([A-Z0-9]+)-[A-Z]$/.exec(r.ticker);
    const via = mapped ? 'map' : dot ? 'suffix' : 'self';
    const key = mapped ? parentOf(r.ticker) : dot ? parentOf(dot[1]) : r.ticker;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ r, via });
  }
  const out = [];
  for (const [key, members] of groups) {
    const anchor = (members.find((m) => m.via !== 'suffix') || [...members].sort((a, b) => a.r.ticker.localeCompare(b.r.ticker))[0]).r.name;
    const joined = members.filter((m) => m.via !== 'suffix' || m.r.name === anchor).map((m) => m.r);
    for (const m of members) if (!joined.includes(m.r)) out.push({ key: m.r.ticker, rows: [m.r], possibleShareClass: true });
    out.push({ key, rows: joined, parentKnown: parents.has(key) });
  }
  return out;
}

// One field across a company's class rows: the lead's value, or the first known one; a disagreement is kept, never resolved
// silently (Data rules: conflicts kept).
function pick(rows, field, conflicts) {
  const known = rows.filter((r) => r[field] != null);
  const vals = new Set(known.map((r) => r[field]));
  if (vals.size > 1) conflicts.push({ field, values: known.map((r) => ({ ticker: r.ticker, value: r[field] })) });
  return known.length ? known[0][field] : null;
}

// D23 and R3: an announced time decides the lane (a mid-session report joins the nearer one and keeps its time). A usual time
// sets the lane only when Nasdaq lists none; otherwise Nasdaq's lane stands. A disagreement is kept as a conflict.
function resolveLane(ordered, conflicts) {
  const listedLane = pick(ordered, 'lane', conflicts);
  const listedFrom = listedLane ? ordered.find((r) => r.lane === listedLane).laneSource : null;
  pick(ordered, 'minutesEt', conflicts);
  const timed = ordered.find((r) => r.minutesEt != null && r.timeSource === 'announced') || ordered.find((r) => r.minutesEt != null);
  const minutesEt = timed ? timed.minutesEt : null;
  const timeSource = timed ? timed.timeSource : null;
  const timedLane = laneForEtMinutes(minutesEt);
  const disagree = timedLane && listedLane && timedLane !== listedLane;
  if (disagree) conflicts.push({ field: 'lane', values: [{ from: timeSource, value: timedLane }, { from: listedFrom, value: listedLane }] });
  // Kiplinger's lane (lanes.js applyKiplinger) fills a row Nasdaq gave none; where Nasdaq gave one and Kiplinger differs, Nasdaq's
  // stands and the difference is kept here (Data rules: conflicts kept)
  for (const r of ordered) {
    if (r.laneAlt && r.lane && r.laneAlt.lane !== r.lane) {
      conflicts.push({ field: 'lane', values: [{ from: r.laneSource, ticker: r.ticker, value: r.lane }, { from: r.laneAlt.provider, ticker: r.ticker, value: r.laneAlt.lane }] });
    }
  }
  // The company's own words about the lane (lanes.js applyReportTimes: a stated lane, or a call before 09:30 ET) beat Nasdaq's and
  // Kiplinger's lane and yield only to an announced clock time; a disagreement is kept as a conflict.
  const company = ordered.find((r) => r.companyLane)?.companyLane ?? null;
  if (company) {
    const against = timeSource === 'announced' ? { from: 'announced', value: timedLane } : listedLane ? { from: listedFrom, value: listedLane } : null;
    if (against && against.value !== company.lane) conflicts.push({ field: 'lane', values: [{ from: 'company', value: company.lane }, against] });
  }
  if (timeSource === 'announced') {
    return { minutesEt, timeSource, lane: timedLane, laneSource: timeSource, ...(timed.timeDetail && { timeDetail: timed.timeDetail }) };
  }
  if (company) return { minutesEt, timeSource, lane: company.lane, laneSource: 'company', laneFrom: company };
  if (timeSource === 'usual' && !listedLane) return { minutesEt, timeSource, lane: timedLane, laneSource: timeSource };
  const listed = ordered.find((r) => r.lane === listedLane && r.laneFrom);
  return { minutesEt, timeSource, lane: listedLane, laneSource: listedFrom, ...(listedFrom === 'kiplinger' && listed && { laneFrom: listed.laneFrom }) };
}

// D61: the company's entry. The lead ticker is Mowgli's parent key when known (GOOGL, BRK), else the base ticker if it is one of
// the rows (TAP over TAP-A), else the first class ticker. Nasdaq prints the whole company's market value on every class row, so
// the one combined figure is that value, never a sum.
function companyEntry({ key, rows, parentKnown, possibleShareClass }) {
  const tickers = rows.map((r) => r.ticker).sort();
  const lead = parentKnown || tickers.includes(key) ? key : tickers[0];
  const ordered = [...rows].sort((a, b) => (b.ticker === lead) - (a.ticker === lead) || a.ticker.localeCompare(b.ticker));
  const conflicts = [];
  const entry = {
    ticker: lead,
    classTickers: tickers.length > 1 || lead !== tickers[0] ? tickers : null,
    name: pick(ordered, 'name', conflicts),
    marketValue: pick(ordered, 'marketValue', conflicts),
    ...resolveLane(ordered, conflicts),
    fiscalQuarterEnd: pick(ordered, 'fiscalQuarterEnd', conflicts),
    date: ordered[0].date,
    dateStatus: ordered.every((r) => r.dateStatus === 'confirmed') ? 'confirmed' : 'estimated',
    source: ordered[0].source,
  };
  // a source (Kiplinger, a company page) dates this report on another day than Nasdaq's row; the row stays where Nasdaq has it
  for (const r of ordered) {
    for (const a of r.dateAlt ?? []) {
      conflicts.push({ field: 'date', values: [{ from: r.source.provider, ticker: r.ticker, value: r.date, source: r.source }, { from: a.from, ticker: r.ticker, value: a.date, source: a.source }] });
    }
  }
  if (rows.length > 1) entry.classSources = ordered.map((r) => r.source);
  if (possibleShareClass) entry.possibleShareClass = true;
  if (conflicts.length) entry.conflicts = conflicts;
  return entry;
}

// D98: the days to build. dates: exactly those. from/to: every weekday, plus any weekend date an input falls on.
function windowDays(window, inputDates) {
  if (!isPlainObject(window)) fail(SRC, 'window');
  const hasRange = 'from' in window || 'to' in window;
  if (Array.isArray(window.dates) === hasRange) fail(SRC, 'window', 'needs either from and to, or a dates list');
  if (Array.isArray(window.dates)) {
    if (!window.dates.length || !window.dates.every(isCalendarDate)) fail(SRC, 'window.dates', 'is not a list of YYYY-MM-DD dates');
    return [...new Set(window.dates)].sort();
  }
  const { from, to } = window;
  if (!isCalendarDate(from)) fail(SRC, 'window.from', from === undefined ? undefined : 'is not a YYYY-MM-DD date');
  if (!isCalendarDate(to)) fail(SRC, 'window.to', to === undefined ? undefined : 'is not a YYYY-MM-DD date');
  if (from > to) fail(SRC, 'window', `runs backwards (${from} to ${to})`);
  const days = [];
  for (let d = from, n = 1; d <= to; d = addDays(d, 1), n += 1) {
    if (n > MAX_WINDOW_DAYS) fail(SRC, 'window', `is longer than ${MAX_WINDOW_DAYS} days`);
    if (!isWeekend(d) || inputDates.has(d)) days.push(d);
  }
  return days;
}

function checkSourceStatus(st, where, needCovers) {
  if (!isPlainObject(st)) fail(where, 'status');
  if (!SOURCE_STATES.includes(st.state)) fail(where, 'state', st.state === undefined ? undefined : `is ${JSON.stringify(st.state)}`);
  if (typeof st.stale !== 'boolean') fail(where, 'stale', st.stale === undefined ? undefined : 'is not true or false');
  if (st.fetchedAt != null && typeof st.fetchedAt !== 'string') fail(where, 'fetchedAt', 'is not a string');
  if (st.fetchFailed !== undefined && typeof st.fetchFailed !== 'boolean') fail(where, 'fetchFailed', 'is not true or false');
  const good = st.state === 'ok' || st.state === 'empty';
  if (good && !st.fetchedAt) fail(where, 'fetchedAt');
  if (needCovers && (good || st.covers != null)) {
    const c = st.covers;
    if (!c || !isCalendarDate(c.from) || !isCalendarDate(c.to) || c.from > c.to) fail(where, 'covers', c == null ? undefined : 'is not { from, to } dates');
  }
}

function checkInputs({ earnings, econ, eventsConfig, marketCalendar, tiers, researched, cats, shareClassOf, status }) {
  if (!Array.isArray(earnings)) fail(SRC, 'earnings');
  if (!Array.isArray(econ)) fail(SRC, 'econ');
  // D23: the events allow-list is required; its contents are checked by config.js validateEvents
  if (eventsConfig == null) fail(SRC, 'eventsConfig');
  if (!marketCalendar) fail(SRC, 'marketCalendar');
  checkTierConfig(tiers);
  if (!(researched instanceof Set)) fail(SRC, 'researched', researched === undefined ? undefined : 'is not a Set of tickers');
  // cats is data/reference/cats-index.json "companies": ticker -> { cat, sub, provisional, shareClassOf }
  if (!isPlainObject(cats)) fail(SRC, 'cats', cats === undefined ? undefined : 'is not a ticker-to-entry object');
  for (const [t, v] of Object.entries(cats)) {
    if (!isPlainObject(v) || !('cat' in v) || !('sub' in v)) fail(`${SRC} cats ${t}`, 'cat and sub');
    if ((v.cat !== null && typeof v.cat !== 'string') || (v.sub !== null && typeof v.sub !== 'string')) fail(`${SRC} cats ${t}`, 'cat and sub', 'are not text or null');
  }
  if (!isPlainObject(shareClassOf)) fail(SRC, 'shareClassOf');
  if (!isPlainObject(status)) fail(SRC, 'status');
  if (!isPlainObject(status.nasdaq)) fail(`${SRC} status`, 'nasdaq');
  for (const [d, st] of Object.entries(status.nasdaq)) {
    if (!isCalendarDate(d)) fail(`${SRC} status nasdaq`, d, 'is not a YYYY-MM-DD date');
    checkSourceStatus(st, `${SRC} status nasdaq ${d}`, false);
  }
  for (const s of ECON_SOURCES) checkSourceStatus(status[s], `${SRC} status ${s}`, true);
  earnings.forEach((r, i) => {
    const where = `${SRC} earnings row ${i}`;
    if (!r?.ticker) fail(where, 'ticker');
    if (!isCalendarDate(r.date)) fail(where, 'date');
    if (!own(status.nasdaq, r.date)) fail(where, `status for ${r.date}`);
    if (r.lane != null && r.lane !== 'before' && r.lane !== 'after') fail(where, 'lane', `is ${JSON.stringify(r.lane)}`);
    // every time keeps its source: a time with no timeSource (or a timeSource with no time) fails
    if ((r.minutesEt != null) !== TIME_SOURCES.includes(r.timeSource)) fail(where, 'minutesEt and timeSource', 'must be set together (timeSource "announced" or "usual")');
  });
  econ.forEach((e, i) => {
    if (!e?.title) fail(`${SRC} econ event ${i}`, 'title');
    if (!isCalendarDate(e.dateEt)) fail(`${SRC} econ event ${i}`, 'dateEt');
  });
}

// D98: how much to trust a day's earnings list.
function earningsStatusFor(st, date, rowCount, marketCalendar) {
  if (!st) return { state: 'not-covered', fetchedAt: null, stale: false };
  const base = { fetchedAt: st.fetchedAt ?? null, stale: st.stale };
  if (st.state === 'failed' || st.state === 'not-covered') return { state: st.state, ...base };
  if (st.state === 'empty' && rowCount) fail(`${SRC} status nasdaq ${date}`, 'state', `is "empty" but ${rowCount} rows were given`);
  return { state: rowCount ? 'ok' : nasdaqEmptyDayKind(date, marketCalendar), ...base };
}

// D98: an econ source only speaks for the days it covers (Forex Factory: the current week); later days are "not-covered", never
// an empty list that reads as quiet. A source shown from an earlier copy because this run's fetch failed (fetchFailed) speaks
// only for that copy's days; any other day is "failed", since "not-covered" would read as nothing listed yet.
function econStatusFor(status, date) {
  const bySource = {};
  for (const s of ECON_SOURCES) {
    const st = status[s];
    const covered = st.covers && date >= st.covers.from && date <= st.covers.to;
    const state = st.state === 'failed' || st.state === 'not-covered' ? st.state : covered ? 'ok' : st.fetchFailed ? 'failed' : 'not-covered';
    bySource[s] = { state, fetchedAt: st.fetchedAt ?? null, stale: st.stale };
  }
  const state = ECON_WORST_FIRST.find((w) => Object.values(bySource).some((b) => b.state === w));
  return { state, bySource };
}

// A fixed-rate auction's first term in years; null when it has none. A month part means a reopening's remaining term, one year
// short of the issue it reopens ("9-Year 10-Month" is a 10-year), so it counts one year up.
function auctionYears(e) {
  if (e.auctionType !== 'Note' && e.auctionType !== 'Bond') return null;
  const m = /^(\d{1,2})-Year( \d{1,2}-Month)?$/.exec(e.originalSecurityTerm || e.securityTerm || '');
  return m ? Number(m[1]) + (m[2] ? 1 : 0) : null;
}

// Minutes between two times: 0 when both are unset, Infinity when only one is.
const timeGap = (a, b) => (a == null && b == null ? 0 : a == null || b == null ? Infinity : Math.abs(a - b));

// Which twin kind an official (Fed or Treasury) event and a same-day Forex Factory event are, or null.
function twinKind(official, ff) {
  if (official.kind === 'fed') {
    if (official.fomcEvent && ff.title === FOMC_TWIN[official.fomcEvent]) return 'fomc';
    if (BEIGE.test(official.title) && BEIGE.test(ff.title)) return 'beigeBook';
    const m = official.allowRule === APPEARANCE_RULE && FF_APPEARANCE.exec(ff.title);
    if (!m) return null;
    const testimony = official.fedType === 'Testimony' || /^Testimony\b/i.test(official.title);
    if (m[3] !== (testimony ? 'Testifies' : 'Speaks')) return null;
    // a missing time cannot contradict the other side (lead, 2026-10-27), so only two known times can rule a pair out
    const bothKnown = official.minutesEt != null && ff.minutesEt != null;
    if (bothKnown && timeGap(official.minutesEt, ff.minutesEt) > APPEARANCE_MAX_GAP_MINUTES) return null;
    if (official.title.toLowerCase().split(/[^a-z'-]+/).includes(m[2].toLowerCase())) return 'appearance';
    return null;
  }
  if (official.kind === 'auction') {
    const m = FF_AUCTION.exec(ff.title);
    const years = m && auctionYears(official);
    return years && years === Number(m[1]) ? 'auction' : null;
  }
  return null;
}

// D23: one event when the Fed or Treasury and Forex Factory list the same thing on a day (FOMC items, a Board member's
// appearance, the Beige Book, a coupon auction): the official date and time win, Forex Factory gives the impact, both sources are
// kept, and a time mismatch is kept as a conflict.
function mergeTwins(dayEvents) {
  const taken = new Set();
  const merged = new Map();
  const counts = Object.fromEntries(TWIN_KINDS.map((k) => [k, 0]));
  for (const off of dayEvents) {
    if (off.kind !== 'fed' && off.kind !== 'auction') continue;
    // among the matching Forex Factory rows, the nearest in time (the first on a tie)
    let kind = null;
    let ff = null;
    for (const x of dayEvents) {
      if (x.kind !== 'econ' || taken.has(x)) continue;
      const k = twinKind(off, x);
      if (k && (!ff || timeGap(off.minutesEt, x.minutesEt) < timeGap(off.minutesEt, ff.minutesEt))) { kind = k; ff = x; }
    }
    if (!ff) continue;
    taken.add(ff);
    counts[kind] += 1;
    const e = { ...off, impact: ff.impact, sources: [off.source, ff.source] };
    if (kind === 'appearance' && (off.minutesEt == null || ff.minutesEt == null)) {
      // one side has no time: the known time is used and its source recorded, never a conflict
      const timed = off.minutesEt != null ? off : ff.minutesEt != null ? ff : null;
      e.minutesEt = timed ? timed.minutesEt : null;
      e.timeTentative = timed ? false : off.timeTentative;
      e.timeFrom = timed ? timed.source.provider : null;
    } else if (off.minutesEt !== ff.minutesEt) e.conflicts = [{ field: 'minutesEt', values: [{ from: off.source.provider, value: off.minutesEt }, { from: ff.source.provider, value: ff.minutesEt }] }];
    merged.set(off, e);
  }
  return { events: dayEvents.filter((x) => !taken.has(x)).map((x) => merged.get(x) || x), mergedTwins: counts };
}

// One day's earnings: merged per company, tiered, R3 floor applied, split into lanes and sorted.
function buildEarnings(rows, ctx) {
  const lanes = { before: [], after: [], noTime: [] };
  const unknownValue = [];
  let droppedBelowFloor = 0;
  const droppedPinned = [];
  const pinned = (t) => Object.hasOwn(ctx.tiers.overrides, t) || (ctx.tiers.adamList || []).includes(t);
  const groups = groupShareClasses(rows, ctx.shareClassOf);
  for (const g of groups) {
    const e = companyEntry(g);
    const all = [e.ticker, ...(e.classTickers || []).filter((t) => t !== e.ticker)];
    e.tier = tierFor({ ticker: e.ticker, tickers: all, marketValue: e.marketValue }, ctx.tiers);
    e.researched = all.some((t) => ctx.researched.has(t));
    const c = all.map((t) => own(ctx.cats, t)).find((v) => v != null);
    e.cat = c?.cat ?? null;
    e.sub = c?.sub ?? null;
    // D99: a missing market value is never read as zero; with no override or megacap to tier it, it waits in its own list.
    if (e.tier === 'unknown') { unknownValue.push(e); continue; }
    // R3: a known value under $1B is left out of the day, but counted; an override or adamList company is also named, since
    // its pin cannot lift it over the floor.
    if (e.marketValue != null && e.marketValue < ctx.tiers.thresholds.minor) {
      droppedBelowFloor += 1;
      if (all.some(pinned)) droppedPinned.push(e.ticker);
      continue;
    }
    lanes[e.lane === 'before' || e.lane === 'after' ? e.lane : 'noTime'].push(e);
  }
  for (const l of Object.values(lanes)) l.sort(byTierValueTicker);
  unknownValue.sort(byTierValueTicker);
  return { lanes, unknownValue, droppedBelowFloor, droppedPinned: droppedPinned.sort(), mergedShareClasses: rows.length - groups.length };
}

// The calendar for a required window ({ from, to } or { dates }):
// { window, outOfWindow: { earnings, econ, droppedByAllowList }, days: [{ date, closure, earningsStatus, econStatus, earnings: { before, after,
// noTime }, unknownValue, econ, counts }] }. status: { nasdaq: { date: { state, fetchedAt, stale } }, forexfactory, fed,
// treasury: { state, fetchedAt, stale, covers: { from, to }, fetchFailed (optional) } }; state is ok, empty, failed or not-covered.
// eventsConfig (required; data/reference/calendar-events.json): only the events it allows are used (config.js filterEvents), each
// with its emphasis; counts.droppedByAllowList gives each day's dropped events per feed, outOfWindow.droppedByAllowList the rest.
// reportTimes (optional; the entries of data/reference/calendar-report-times.json, config.js validateReportTimes): the company-announced
// times, placed on the Nasdaq rows with the same date and ticker as an announced time (lanes.js applyReportTimes); the answer then
// carries reportTimes { applied, noRow }. Absent, nothing changes.
export function buildCalendar(input) {
  checkInputs(input);
  const { marketCalendar, tiers, researched, cats, shareClassOf, status } = input;
  let earnings = input.earnings;
  let reportTimes = null;
  if (input.reportTimes != null) {
    const placed = applyReportTimes(earnings, validateReportTimeEntries(input.reportTimes));
    earnings = placed.rows;
    reportTimes = placed.counts;
  }
  const { kept: econ, dropped } = filterEvents(input.econ, input.eventsConfig);
  // one pass (the relay has a 10 ms CPU budget): date -> dropped count per feed
  const droppedByDate = new Map();
  for (const d of dropped) {
    if (!droppedByDate.has(d.dateEt)) droppedByDate.set(d.dateEt, Object.fromEntries(ECON_SOURCES.map((s) => [s, 0])));
    droppedByDate.get(d.dateEt)[d.feed] += 1;
  }
  const closures = marketClosures(marketCalendar);
  const ctx = { tiers, researched, cats, shareClassOf };
  const days = windowDays(input.window, new Set([...earnings.map((r) => r.date), ...econ.map((e) => e.dateEt), ...droppedByDate.keys()]));
  const inWindow = new Set(days);
  let droppedOutOfWindow = 0;
  for (const [date, c] of droppedByDate) if (!inWindow.has(date)) droppedOutOfWindow += ECON_SOURCES.reduce((n, s) => n + c[s], 0);
  const dayRows = new Map(days.map((d) => [d, []]));
  const dayEcon = new Map(days.map((d) => [d, []]));
  for (const r of earnings) if (inWindow.has(r.date)) dayRows.get(r.date).push(r);
  for (const e of econ) if (inWindow.has(e.dateEt)) dayEcon.get(e.dateEt).push(e);
  return {
    window: Array.isArray(input.window.dates) ? { dates: days } : { from: input.window.from, to: input.window.to },
    ...(reportTimes && { reportTimes }),
    outOfWindow: {
      earnings: earnings.filter((r) => !inWindow.has(r.date)).length, econ: econ.filter((e) => !inWindow.has(e.dateEt)).length,
      droppedByAllowList: droppedOutOfWindow,
    },
    days: days.map((date) => {
      const raw = dayRows.get(date);
      const { lanes, unknownValue, droppedBelowFloor, droppedPinned, mergedShareClasses } = buildEarnings(raw, ctx);
      const { events, mergedTwins } = mergeTwins(dayEcon.get(date));
      events.sort(econOrder);
      const shown = [...lanes.before, ...lanes.after, ...lanes.noTime];
      return {
        date,
        closure: closures.get(date) ?? null,
        earningsStatus: earningsStatusFor(own(status.nasdaq, date), date, raw.length, marketCalendar),
        econStatus: econStatusFor(status, date),
        earnings: lanes,
        unknownValue,
        econ: events,
        counts: {
          sourceRows: raw.length, mergedShareClasses, droppedBelowFloor, droppedPinned, unknownValue: unknownValue.length,
          before: lanes.before.length, after: lanes.after.length, noTime: lanes.noTime.length,
          byTier: Object.fromEntries(TIERS.map((t) => [t, shown.filter((e) => e.tier === t).length])),
          econ: events.length, econHigh: events.filter((e) => e.impact === 'high').length, mergedTwins,
          droppedByAllowList: droppedByDate.get(date) ?? Object.fromEntries(ECON_SOURCES.map((s) => [s, 0])),
        },
      };
    }),
  };
}
