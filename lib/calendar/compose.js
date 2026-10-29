// The Calendar's compose layer (PROJECT.md Part 4 "Calendar build", step 4): fetched payloads to the calendar the page reads, the
// last-good fallbacks (D98) and calendar-base.json. Pure, like the rest of server/lib/calendar/: no fs, network, env or node:
// imports, so the local server (server/publish/calendar_data.js) and the relay (step 5) run the same code.
import { parseNasdaqDay } from './nasdaq.js';
import { parseForexFactory, parseFedCalendar, parseTreasuryUpcoming, parseTradingView } from './econ.js';
import { addDays, toEt } from './times.js';
import { buildCalendar } from './merge.js';
import { resolveTiersConfig, validateEvents, validateReportTimes, validateReleaseTimes } from './config.js';
import { applyKiplinger, applyEarningsWhispers, kiplingerWeeks } from './lanes.js';

// TradingView previews the weeks Forex Factory and Treasury do not cover yet (Adam, 2026-10-29; authority.js decides each week).
export const ECON_SOURCES = ['forexfactory', 'fed', 'treasury', 'tradingview'];
// Sources that place lanes on Nasdaq's rows instead of adding events (lanes.js): stored and served like the econ feeds, one entry each.
export const LANE_SOURCES = ['kiplinger', 'earningswhispers'];
const GOOD_EARNINGS = ['ok', 'none-listed'];
// The earnings half of a day's counts (merge.js buildCalendar); the rest belongs to the econ half.
const EARNINGS_COUNTS = ['sourceRows', 'mergedShareClasses', 'droppedBelowFloor', 'droppedPinned', 'unknownValue', 'before', 'after', 'noTime', 'byTier'];

const lastDayOfMonth = (ym) => addDays(`${addDays(`${ym}-28`, 4).slice(0, 7)}-01`, -1);

// D98: the days each econ feed speaks for, from the feed itself. Forex Factory: the first to the last New York date of any of its
// rows (every country; the feed is one week). The Fed: the first day of its earliest month to the last day of its latest. Treasury:
// the fetch day to the last announced auction (a later day has no announcement yet, so it is not covered). TradingView: the first to
// the last New York date of its rows.
// Forex Factory rows whose date cannot be read are left out of the span and counted in skipped.badDate (a USD row with a bad date
// has already failed the parser, so these are foreign rows); skipped is { badDate } for Forex Factory, null for the others.
function coversOf(source, payload, events, fetchedAt) {
  if (source === 'forexfactory') {
    const ds = [];
    let badDate = 0;
    for (const e of payload) {
      let d = null;
      try { d = toEt(e?.date).dateEt; } catch (err) {
        if (!err?.code) throw err; // only toEt's own refusal (a structured calendar error) counts as a bad date
        badDate += 1;
      }
      if (d) ds.push(d);
    }
    ds.sort();
    return { covers: ds.length ? { from: ds[0], to: ds[ds.length - 1] } : null, skipped: { badDate } };
  }
  if (source === 'tradingview') {
    // the first to the last New York date of its US rows (the request asks for the whole window, so its rows span it)
    const ds = events.map((e) => e.dateEt).sort();
    return { covers: ds.length ? { from: ds[0], to: ds[ds.length - 1] } : null, skipped: null };
  }
  if (source === 'fed') {
    const months = [...new Set(events.map((e) => e.dateEt.slice(0, 7)))].sort();
    return { covers: months.length ? { from: `${months[0]}-01`, to: lastDayOfMonth(months[months.length - 1]) } : null, skipped: null };
  }
  const day = toEt(new Date(Date.parse(fetchedAt)).toISOString()).dateEt;
  const last = events.map((e) => e.dateEt).sort().pop();
  return { covers: { from: day, to: last && last > day ? last : day }, skipped: null };
}

const PARSERS = { forexfactory: parseForexFactory, fed: parseFedCalendar, treasury: parseTreasuryUpcoming, tradingview: parseTradingView };

// Fetched payloads (server/lib/calendar_fetch.js fetchCalendarSources) to buildCalendar's earnings, econ and status, plus
// econBySource (each feed's events, for the fallback), errors (source to reason) and skipped (source to the rows its parser
// skipped by rule). A payload that does not parse makes that source (or that Nasdaq day) failed with the parser's reason; nothing
// else is touched. shareClassOf (merge.js's): which class rows Kiplinger moves together (lanes.js applyKiplinger).
export function assembleSources(fetched, { shareClassOf = {} } = {}) {
  const earnings = [];
  const status = { nasdaq: {} };
  const errors = {};
  // the Nasdaq days Kiplinger may move a report onto: fetched and parsed, and listing reports (lanes.js applyKiplinger)
  const okDays = new Set();
  for (const [d, r] of Object.entries(fetched.nasdaq)) {
    if (r.state !== 'ok') { status.nasdaq[d] = { state: r.state, fetchedAt: null, stale: false }; if (r.error) errors[`nasdaq ${d}`] = r.error; continue; }
    try {
      const rows = parseNasdaqDay(r.payload, d, r.fetchedAt);
      earnings.push(...rows);
      if (rows.length) okDays.add(d);
      status.nasdaq[d] = { state: 'ok', fetchedAt: r.fetchedAt, stale: false };
    } catch (e) {
      status.nasdaq[d] = { state: 'failed', fetchedAt: null, stale: false };
      errors[`nasdaq ${d}`] = `does not parse: ${e.message}`;
    }
  }
  const econBySource = {};
  // rows skipped by rule, counted (econ.js parseFedCalendar: skipped { empty, noMonth }; coversOf for Forex Factory: { badDate })
  const skipped = {};
  for (const s of ECON_SOURCES) {
    const r = fetched[s] ?? NOT_COVERED; // a caller that predates a source (TradingView) did not ask for it
    econBySource[s] = [];
    if (r.state !== 'ok') { status[s] = { state: r.state, fetchedAt: null, stale: false }; if (r.error) errors[s] = r.error; continue; }
    try {
      const events = PARSERS[s](r.payload, r.fetchedAt);
      const span = coversOf(s, r.payload, events, r.fetchedAt);
      const { covers } = span;
      if (!covers) throw new Error('lists no dates, so the days it covers are unknown');
      econBySource[s] = events;
      if (events.skipped || span.skipped) skipped[s] = { ...events.skipped, ...span.skipped };
      status[s] = { state: 'ok', fetchedAt: r.fetchedAt, stale: false, covers };
    } catch (e) {
      status[s] = { state: 'failed', fetchedAt: null, stale: false };
      errors[s] = `does not parse: ${e.message}`;
    }
  }
  // Kiplinger's lanes (Adam, 2026-10-28; lanes.js applyKiplinger), then Earnings Whispers' outside Kiplinger's weeks (Adam, 2026-10-29;
  // applyEarningsWhispers): a source that is absent, not asked for or failed places nothing and never fails the build, so the page only
  // loses those lanes. Both are optional in fetched (an older caller, or a relay answer without them, is not-covered); Kiplinger's
  // payload is a stored parse (kiplinger.js parseKiplinger plus the cron's carried days), Earnings Whispers' its days.
  const kip = laneSource(fetched.kiplinger, earnings, (rows, k) => applyKiplinger(rows, k.payload, k.fetchedAt, { okDays, shareClassOf }), (p) => Object.keys(p.days));
  const weeks = kip.applied ? kiplingerWeeks(fetched.kiplinger.payload) : new Set();
  const ew = laneSource(fetched.earningswhispers, kip.rows, (rows, x) => applyEarningsWhispers(rows, x.payload, x.fetchedAt, weeks), (p) => Object.keys(p));
  for (const [name, x] of [['kiplinger', kip], ['earningswhispers', ew]]) {
    status[name] = x.status;
    if (x.error) errors[name] = x.error;
  }
  return { earnings: ew.rows, econBySource, status, errors, skipped, kiplinger: kip.counts, earningswhispers: ew.counts };
}

const NOT_COVERED = { state: 'not-covered', payload: null, fetchedAt: null, error: null };

// One lane source onto the rows: { rows, counts, status, error, applied }. apply(rows, r) gives { rows, counts }; daysOf(payload) its
// days, for covers. stale: the caller's mark on the copy (the relay's stale flag, or the last-good fallback of keptLaneSource), D98;
// error on an ok copy says why it is not this run's own fetch.
function laneSource(r = NOT_COVERED, rows, apply, daysOf) {
  if (r.state !== 'ok') return { rows, counts: null, status: { state: r.state, fetchedAt: null, stale: false }, error: r.error ?? null, applied: false };
  try {
    const placed = apply(rows, r);
    const ds = daysOf(r.payload).sort();
    return { rows: placed.rows, counts: placed.counts, status: { state: 'ok', fetchedAt: r.fetchedAt, stale: !!r.stale, covers: { from: ds[0], to: ds[ds.length - 1] } }, error: r.error ?? null, applied: true };
  } catch (e) {
    return { rows, counts: null, status: { state: 'failed', fetchedAt: null, stale: false }, error: `does not parse: ${e.message}`, applied: false };
  }
}

// Market values for validateTiers's floor check, for the override and adamList tickers only: the Nasdaq rows of the fetched
// window first (the tiers file's own unit, "as Nasdaq lists it on the earnings calendar"), then the last published Monitor
// (Yahoo market value, stocks and extra). A ticker in neither stays out, so validateTiers lists it as unchecked.
export function tierMarketValues(tiersFile, earnings, monitorJson) {
  const tickers = [...Object.keys(tiersFile?.overrides?.entries || {}), ...(tiersFile?.adamList?.entries || []).map((e) => e.ticker)];
  const values = new Map();
  const from = {};
  const caps = new Map([...(monitorJson?.stocks || []), ...(monitorJson?.extra || [])].filter((s) => s?.s && typeof s.cap === 'number').map((s) => [s.s, s.cap]));
  for (const t of tickers) {
    const row = earnings.find((r) => r.ticker === t && r.marketValue != null);
    if (row) { values.set(t, row.marketValue); from[t] = `nasdaq ${row.date}`; continue; }
    if (caps.has(t)) { values.set(t, caps.get(t)); from[t] = `monitor ${monitorJson.asOf ?? 'undated'}`; }
  }
  return { values, from };
}

const clipCovers = (c, w) => {
  if (!c) return null;
  const from = c.from > w.from ? c.from : w.from;
  const to = c.to < w.to ? c.to : w.to;
  return from <= to ? { from, to } : null;
};

// D98 for the econ feeds: a feed that did not answer (or did not parse) is replaced by the previous copy's events for it, with
// stale: true and the time they were fetched; with no previous copy it stays failed and its days say so. A copy kept because this
// run's fetch failed is marked fetchFailed, so a window day outside the copy's dates reads failed, never "not-covered"
// (merge.js econStatusFor). A feed this run did not ask for (the relay fetches a few sources per run) keeps the previous copy as
// it was, mark included, and a feed whose last fetch failed with no copy to show stays failed: only a successful fetch of that
// source clears either.
export function econInputs(a, previous) {
  const econ = [];
  const status = {};
  const sources = {};
  const kept = {};
  for (const s of ECON_SOURCES) {
    const fresh = a.status[s];
    const prev = previous?.inputs?.econ?.[s];
    const notAsked = fresh.state === 'not-covered';
    let events = a.econBySource[s];
    let st = fresh;
    if (fresh.state !== 'ok' && prev?.status?.state === 'ok' && prev.status.covers && Array.isArray(prev.events)) {
      events = prev.events;
      const { fetchFailed, ...prevStatus } = prev.status;
      st = { ...prevStatus, stale: true, ...((fresh.state === 'failed' || (notAsked && fetchFailed)) && { fetchFailed: true }) };
    } else if (notAsked && prev?.status?.state === 'failed') {
      st = { ...prev.status };
    }
    econ.push(...events);
    status[s] = st;
    kept[s] = { status: st, events };
    sources[s] = { fetch: fresh.state, error: a.errors[s] ?? null, fetchedAt: st.fetchedAt ?? null, stale: st.stale, covers: st.covers ?? null };
    if (a.skipped[s]) sources[s].skipped = a.skipped[s];
  }
  return { econ, status, sources, kept };
}

// D98 for earnings: a day whose Nasdaq fetch failed, or came back empty on an ordinary trading day ("suspect"), keeps the previous
// copy's earnings for that date when that copy was good, marked stale with its own fetch time. Changes days in place.
export function keepEarnings(days, previous) {
  const prevDays = new Map((previous?.days || []).map((d) => [d.date, d]));
  for (const day of days) {
    if (GOOD_EARNINGS.includes(day.earningsStatus.state)) continue;
    const p = prevDays.get(day.date);
    if (!p || !GOOD_EARNINGS.includes(p.earningsStatus?.state)) continue;
    const latestFetch = day.earningsStatus.state;
    day.earnings = p.earnings;
    day.unknownValue = p.unknownValue;
    for (const k of EARNINGS_COUNTS) day.counts[k] = p.counts[k];
    day.earningsStatus = { ...p.earningsStatus, stale: true, latestFetch };
  }
}

// The calendar the page reads: buildCalendar's { window, outOfWindow, days } plus
//   v, asOf (this build), sources (per source: fetch = this run's outcome ok, failed or not-covered, error, fetchedAt = when the
//   data shown was fetched, stale = true when it came from an earlier fetch), tiersCheck (validateTiers's warnings and unchecked
//   list, with where each market value came from), and inputs.econ (each econ feed's events in the window), inputs.kiplinger
//   (the Kiplinger parse applied) and inputs.earningswhispers (the Earnings Whispers days applied), kept for the next build's fallback.
export function composeCalendar({ fetched: fresh, refs, monitorJson = null, previous = null, now = Date.now, log = console }) {
  const w = fresh.window;
  const fetched = keptLaneSource(keptKiplinger(fresh, previous), previous, 'earningswhispers');
  const a = assembleSources(fetched, { shareClassOf: refs.shareClassOf });
  const { econ, status, sources, kept } = econInputs(a, previous);
  const mv = tierMarketValues(refs.tiersFile, a.earnings, monitorJson);
  const tiers = resolveTiersConfig(refs.tiersFile, refs.overlays, mv.values);
  const { warnings, unchecked, floorChecked } = tiers.check;
  for (const x of warnings) log.warn?.(`calendar tiers: ${x.code}: ${x.message}`);
  if (unchecked.length) log.warn?.(`calendar tiers: floor check incomplete; no market value for ${unchecked.join(', ')}`);
  const cal = buildCalendar({
    window: { from: w.from, to: w.to }, earnings: a.earnings, econ, eventsConfig: refs.eventsConfig, marketCalendar: refs.marketCalendar,
    tiers, researched: refs.researched, cats: refs.cats, shareClassOf: refs.shareClassOf, status: { nasdaq: a.status.nasdaq, ...status },
    reportTimes: validateReportTimes(refs.reportTimes), // a missing or bad file fails the build (the bake keeps the last publish)
    releaseTimes: validateReleaseTimes(refs.releaseTimes), // the same for the official release times over TradingView's clock
  });
  keepEarnings(cal.days, previous);
  const nasdaqDays = {};
  for (const [d, st] of Object.entries(a.status.nasdaq)) {
    const day = cal.days.find((x) => x.date === d);
    const shown = day?.earningsStatus || st;
    nasdaqDays[d] = { fetch: st.state, error: a.errors[`nasdaq ${d}`] ?? null, fetchedAt: shown.fetchedAt ?? null, stale: !!shown.stale, shown: shown.state };
  }
  const inWindow = (e) => e.dateEt >= w.from && e.dateEt <= w.to;
  return {
    v: 1,
    asOf: new Date(now()).toISOString(),
    sources: {
      nasdaq: { stale: Object.values(nasdaqDays).some((d) => d.stale), days: nasdaqDays }, ...sources,
      ...Object.fromEntries(LANE_SOURCES.map((s) => [s, {
        fetch: fresh[s]?.state ?? 'not-covered', error: a.errors[s] ?? null, fetchedAt: a.status[s].fetchedAt, stale: a.status[s].stale, covers: a.status[s].covers ?? null, placed: a[s],
      }])),
    },
    tiersCheck: { warnings, unchecked, floorChecked, marketValueFrom: mv.from },
    ...cal,
    inputs: {
      econ: Object.fromEntries(ECON_SOURCES.map((s) => [s, {
        status: { ...kept[s].status, covers: clipCovers(kept[s].status.covers, w) }, events: kept[s].events.filter(inWindow),
      }])),
      // each lane source's copy that was applied (this run's, or the kept one), for the next build's fallback
      ...Object.fromEntries(LANE_SOURCES.map((s) => [s, a.status[s].state === 'ok' ? { fetchedAt: fetched[s].fetchedAt, payload: fetched[s].payload } : null])),
    },
  };
}

// D98 for Kiplinger's lanes: when this run's Kiplinger fetch did not give a copy (failed, or not asked for), the previous calendar's
// parse (inputs.kiplinger) is used again, marked stale: true with its own fetch time, and the failure's reason stays in error. With no
// previous parse the source stays as it was. Returns fetched itself when nothing changes, else a copy.
export function keptKiplinger(fetched, previous) {
  return keptLaneSource(fetched, previous, 'kiplinger');
}

// The same for any lane source (LANE_SOURCES): Earnings Whispers' days are kept from inputs.earningswhispers the same way.
export function keptLaneSource(fetched, previous, source) {
  const k = fetched[source];
  const prev = previous?.inputs?.[source];
  if (k?.state === 'ok' || !prev?.payload || typeof prev.fetchedAt !== 'string') return fetched;
  return { ...fetched, [source]: { state: 'ok', payload: prev.payload, fetchedAt: prev.fetchedAt, stale: true, error: k?.error ?? null } };
}

// Each source failure of a composed calendar, one line each ("nasdaq 2026-10-28 failed: <reason>"), for the failure log
// (server/publish/calendar_data.js writes them to data/cache/logs/calendar.log).
export function sourceFailures(cal) {
  const out = [];
  for (const [d, x] of Object.entries(cal?.sources?.nasdaq?.days || {})) if (x.fetch === 'failed') out.push(`nasdaq ${d} failed: ${x.error ?? 'no reason given'}`);
  for (const s of ECON_SOURCES) {
    const x = cal?.sources?.[s];
    if (x?.fetch === 'failed') out.push(`${s} failed: ${x.error ?? 'no reason given'}`);
  }
  for (const s of LANE_SOURCES) if (cal?.sources?.[s]?.fetch === 'failed') out.push(`${s} failed: ${cal.sources[s].error ?? 'no reason given'}`);
  return out;
}

// The page's one line when this week's economic releases or Treasury auctions come from TradingView, for whatever reason (Adam,
// 2026-10-29: the page says which source it fell back to; review 2026-10-29: failed and no copy included, Treasury's auctions too),
// since the source that gave way no longer has a chip of its own on those days (merge.js econStatusFor). It goes in the note that
// already says a source's state, never a new layout. Next week is TradingView's by design until its sources cover it, so only this
// week is said. cal: a built calendar (buildCalendar's econAuthority); the first of its weeks is this week. null when there is
// nothing to say.
const GAVE_WAY = {
  forexfactory: { 'earlier-week': 'Forex Factory\'s copy is older', failed: 'Forex Factory failed', 'no-copy': 'Forex Factory has no copy', 'not-covered': 'Forex Factory does not cover it' },
  treasury: { stale: 'Treasury\'s copy is stale', 'not-fresh': 'Treasury\'s copy is older', failed: 'Treasury failed', 'no-copy': 'Treasury has no copy', 'not-covered': 'Treasury does not cover it' },
};
export function econFallbackNote(cal) {
  const weeks = cal?.econAuthority?.weeks;
  const first = weeks && Object.keys(weeks).sort()[0];
  if (!first) return null;
  const w = weeks[first];
  const parts = [];
  const why = [];
  if (w.releases === 'tradingview') { parts.push('releases'); why.push(GAVE_WAY.forexfactory[w.releasesWhy] ?? `Forex Factory: ${w.releasesWhy}`); }
  if (w.auctions === 'tradingview') { parts.push('auctions'); why.push(GAVE_WAY.treasury[w.auctionsWhy] ?? `Treasury: ${w.auctionsWhy}`); }
  return parts.length ? `This week's ${parts.join(' and ')} from TradingView: ${why.join('; ')}` : null;
}

// A whole previous calendar kept because this build failed: every source and day marked stale, so the page says so.
export function staleCopy(cal) {
  const c = structuredClone(cal);
  c.keptWhole = true;
  if (c.sources) {
    for (const s of Object.values(c.sources)) s.stale = true;
    for (const d of Object.values(c.sources.nasdaq?.days || {})) d.stale = true;
  }
  for (const d of c.days || []) {
    if (d.earningsStatus) d.earningsStatus.stale = true;
    for (const b of Object.values(d.econStatus?.bySource || {})) b.stale = true;
  }
  return c;
}

// calendar-base.json for the relay (step 5). Small: no per-day data.
export function calendarBase(refs, { now = Date.now } = {}) {
  const { megacaps, overrides, thresholds, adamList } = resolveTiersConfig(refs.tiersFile, refs.overlays);
  const cats = {};
  const subs = {};
  for (const f of refs.families) {
    cats[f.id] = { name: f.name, short: f.shortName || null };
    for (const s of f.subCategories || []) subs[`${f.id}/${s.id}`] = { name: s.name, short: s.shortName || null };
  }
  return {
    v: 1, builtAt: new Date(now()).toISOString(),
    tiers: { megacaps, overrides, thresholds, adamList }, eventsConfig: validateEvents(refs.eventsConfig),
    names: { cats, subs }, cats: refs.cats, shareClassOf: refs.shareClassOf, researched: [...refs.researched].sort(),
    logos: refs.logos, marketCalendar: refs.marketCalendar,
    reportTimes: validateReportTimes(refs.reportTimes),
    releaseTimes: validateReleaseTimes(refs.releaseTimes),
    sources: {
      tiers: 'data/reference/calendar-tiers.json with the Megacaps group of data/reference/business-models.json',
      eventsConfig: 'data/reference/calendar-events.json', names: 'data/reference/business-models.json families',
      cats: 'data/reference/cats-index.json', researched: 'data/companies folders and their class tickers',
      logos: 'data/logos', marketCalendar: 'data/reference/market-calendar.json (NYSE)',
      reportTimes: 'data/reference/calendar-report-times.json (times companies announced on their own sites)',
      releaseTimes: 'data/reference/calendar-release-times.json (official release times over TradingView\'s clock)',
    },
  };
}
