// Where a Nasdaq earnings row gets its lane or time (Adam, 2026-10-28: "just use kiplinger ... if it's not on Kiplinger, go to the
// company's website and see what time the call is scheduled for"; 2026-10-29: "the week of, use Kiplinger as the authoritative
// source ... so that we don't have competing info"). Pure, like the rest of server/lib/calendar/. No source adds a report: each only
// places (or, for Kiplinger, moves) a row Nasdaq already lists in the window (no invented reports), and none sets a "usual" lane.
//   applyKiplinger         Kiplinger's before / after lists (kiplinger.js) decide the lane and the day of every ticker it lists, in
//                          the weeks its page covers
//   applyEarningsWhispers  Earnings Whispers' lists (earningswhispers.js) fill rows with no lane, outside Kiplinger's weeks
//   applyReportTimes       what companies announced on their own sites (data/reference/calendar-report-times.json, config.js
//                          validateReportTimes): a release time as an announced minutesEt, which merge.js resolveLane turns into the
//                          lane; a stated lane ("before the market opens") or a call before 09:30 ET as a company lane
import { kiplingerShapeProblem } from './kiplinger.js';
import { earningsWhispersShapeProblem, earningsWhispersUrl } from './earningswhispers.js';
import { fail, mondayOf } from './times.js';
import { companyKeyOf } from './nasdaq.js';

export const KIPLINGER_URL = 'https://www.kiplinger.com/investing/stocks/17494/next-week-earnings-calendar-stocks';

// The Mondays of the weeks a Kiplinger parse covers: its page's week, and the week of any day carried from an earlier page.
export function kiplingerWeeks(payload) {
  return new Set(Object.keys(payload?.days ?? {}).map(mondayOf));
}

// "date|ticker" -> 'before' | 'after' | null (listed in both lanes that day: ambiguous), and the count of listings, for a source's
// days { date: { before, after } }; skip(date) leaves a day out.
function laneMap(days, skip = () => false) {
  const lane = new Map();
  let listed = 0;
  for (const [date, day] of Object.entries(days)) {
    if (skip(date)) continue;
    for (const l of ['before', 'after']) {
      for (const t of day[l]) {
        listed += 1;
        const k = `${date}|${t}`;
        lane.set(k, lane.has(k) && lane.get(k) !== l ? null : l);
      }
    }
  }
  return { lane, listed };
}

// Rows (parseNasdaqDay's) under Kiplinger's word (Adam, 2026-10-29: Kiplinger decides its own week). For a company Kiplinger lists on
// exactly one day D with one lane (a company: nasdaq.js companyKeyOf, so a company's class rows, GOOGL and GOOG, move together), when
// D can take a row (okDays: Nasdaq's day D was fetched and lists reports, so a moved row is never lost to an empty or failed day's
// kept copy, compose.js keepEarnings, nor sent to a day outside the window):
//   its rows all end on D with Kiplinger's lane, marked laneAuthority "kiplinger" (merge.js resolveLane then lets Kiplinger's lane
//     beat Nasdaq's, the company's stated lane and any clock time outside it); a row with no lane or another lane gets laneSource
//     "kiplinger" and laneFrom naming the page, the lane it had kept in laneAlt (a conflict, Data rules: conflicts kept)
//   a row on another day moves to D (dateFrom "kiplinger", dateSource Kiplinger's page for D), Nasdaq's day kept in dateAlt (merge.js
//     companyEntry keeps it as a "date" conflict); one row per ticker stays (the one already on D, else the earliest), and each other
//     row of that ticker (a stale day copy listing it again) folds into the kept row's dateAlt, counted in folded: one report, one day
// Otherwise (several days, an ambiguous lane, or D unable to take a row): a row on a listed day takes that day's lane as above, and
// a listed day with no row of that ticker is a date conflict on the ticker's rows elsewhere (markDateConflicts), nothing moved. No
// row anywhere in the window: nothing is added. A ticker listed in both lanes on one day is ambiguous and places nothing.
// payload: a parse (kiplinger.js parseKiplinger) as stored, plus carried (date -> the fetchedAt of the copy that supplied a day the
// newest page no longer lists); fetchedAt: when payload was fetched; okDays (a Set of dates; default: the days the rows are on);
// shareClassOf: as merge.js takes it. Returns { rows, counts } and does not change rows.
export function applyKiplinger(rows, payload, fetchedAt, { okDays = new Set(rows.map((r) => r.date)), shareClassOf = {} } = {}) {
  const bad = kiplingerShapeProblem(payload);
  if (bad) fail('kiplinger', 'payload', bad);
  const { lane, listed } = laneMap(payload.days);
  const counts = { filled: 0, agreed: 0, conflicted: 0, ambiguous: 0, moved: 0, folded: 0, noRow: 0, listed };
  const fromOf = (date) => ({ provider: 'kiplinger', url: KIPLINGER_URL, date, week: payload.week, updatedAt: payload.updatedAt ?? null, fetchedAt: payload.carried?.[date] ?? fetchedAt });
  // the row with Kiplinger's lane l for date
  const place = (r, l, date) => {
    if (r.lane === l) { counts.agreed += 1; return { ...r, laneAuthority: 'kiplinger' }; }
    counts[r.lane == null ? 'filled' : 'conflicted'] += 1;
    return {
      ...r, lane: l, laneSource: 'kiplinger', laneFrom: fromOf(date), laneAuthority: 'kiplinger',
      ...(r.lane != null && { laneAlt: { provider: r.laneSource ?? 'nasdaq', lane: r.lane, source: r.source } }),
    };
  };
  const co = (t) => companyKeyOf(t, shareClassOf).key;
  // company -> Map(date -> lane, or null when Kiplinger gives it both lanes that day)
  const kipDays = new Map();
  for (const [k, l] of lane) {
    const [date, ticker] = k.split('|');
    const m = kipDays.get(co(ticker)) ?? new Map();
    m.set(date, m.has(date) && m.get(date) !== l ? null : l);
    kipDays.set(co(ticker), m);
  }
  // company -> { date, lane } where every row of the company ends
  const target = new Map();
  for (const [c, m] of kipDays) {
    if (m.size !== 1) continue;
    const [[d, l]] = m;
    if (l != null && okDays.has(d)) target.set(c, { date: d, lane: l });
  }
  const alt = (r) => ({ from: r.source?.provider ?? 'nasdaq', date: r.date, source: r.source });
  const replaced = new Map(); // a targeted company's row -> its row on D, or null when folded into another
  const byTicker = new Map();
  for (const r of rows) if (target.has(co(r.ticker))) byTicker.set(r.ticker, [...(byTicker.get(r.ticker) ?? []), r]);
  for (const [t, trs] of byTicker) {
    const { date: d, lane: l } = target.get(co(t));
    const keep = trs.find((r) => r.date === d) ?? [...trs].sort((a, b) => (a.date < b.date ? -1 : 1))[0];
    const k = keep.date === d ? place(keep, l, d) : { ...place(keep, l, d), date: d, dateAlt: [...(keep.dateAlt ?? []), alt(keep)] };
    if (keep.date !== d) counts.moved += 1;
    for (const other of trs) {
      if (other === keep) continue;
      k.dateAlt = [...(k.dateAlt ?? []), alt(other)];
      counts.folded += 1;
      replaced.set(other, null);
    }
    // Kiplinger's day, with its source and as-of, whether the lanes agreed or not (merge.js companyEntry reads dateSource)
    if (k.dateAlt?.length !== keep.dateAlt?.length) Object.assign(k, { dateFrom: 'kiplinger', dateSource: fromOf(d) });
    replaced.set(keep, k);
  }
  const out = [];
  for (const r of rows) {
    if (replaced.has(r)) { if (replaced.get(r)) out.push(replaced.get(r)); continue; }
    const k = `${r.date}|${r.ticker}`;
    if (!lane.has(k)) { out.push(r); continue; }
    const l = lane.get(k);
    if (l == null) { counts.ambiguous += 1; out.push(r); continue; }
    out.push(place(r, l, r.date));
  }
  // a listed day with no row of that ticker on it: a date conflict on the ticker's rows elsewhere
  const outKeys = new Set(out.map((r) => `${r.date}|${r.ticker}`));
  const claims = [...lane].filter(([k, l]) => l != null && !outKeys.has(k)).map(([k, l]) => {
    const [date, ticker] = k.split('|');
    return { ticker, alt: { from: 'kiplinger', date, source: KIPLINGER_URL, lane: l } };
  });
  counts.noRow = claims.length;
  const dated = markDateConflicts(out, claims);
  counts.dateConflicts = dated.count;
  return { rows: dated.rows, counts };
}

// Rows with Earnings Whispers' lanes, only where Kiplinger has not decided (Adam, 2026-10-29): a day in one of skipWeeks (Mondays;
// Kiplinger's weeks, kiplingerWeeks) is not read; a row with no lane takes Earnings Whispers', laneSource "earningswhispers" and
// laneFrom naming the day's answer; a row with a lane keeps it, and Earnings Whispers' differing lane is kept as laneAlt (a conflict).
// A day Earnings Whispers lists a ticker that Nasdaq lists on another day of the window is a date conflict on that row, nothing moved.
// payload: the stored copy { date: { before, after } } (earningswhispers.js); fetchedAt: when it was fetched. Returns { rows, counts }.
export function applyEarningsWhispers(rows, payload, fetchedAt, skipWeeks = new Set()) {
  const bad = earningsWhispersShapeProblem(payload);
  if (bad) fail('earningswhispers', 'payload', bad);
  const { lane, listed } = laneMap(payload, (d) => skipWeeks.has(mondayOf(d)));
  const counts = { filled: 0, agreed: 0, conflicted: 0, ambiguous: 0, noRow: 0, listed };
  const seen = new Set();
  const out = rows.map((r) => {
    const k = `${r.date}|${r.ticker}`;
    if (!lane.has(k)) return r;
    seen.add(k);
    const l = lane.get(k);
    if (l == null) { counts.ambiguous += 1; return r; }
    const from = { provider: 'earningswhispers', url: earningsWhispersUrl(r.date), date: r.date, fetchedAt: payload[r.date].fetchedAt ?? fetchedAt };
    if (r.lane == null) { counts.filled += 1; return { ...r, lane: l, laneSource: 'earningswhispers', laneFrom: from }; }
    if (r.lane === l) { counts.agreed += 1; return r; }
    counts.conflicted += 1;
    return { ...r, laneAlt: { ...from, lane: l } };
  });
  counts.noRow = lane.size - seen.size;
  const claims = [...lane.keys()].filter((k) => !seen.has(k)).map((k) => {
    const [date, ticker] = k.split('|');
    return { ticker, alt: { from: 'earningswhispers', date, source: earningsWhispersUrl(date), lane: lane.get(k) } };
  });
  const dated = markDateConflicts(out, claims);
  counts.dateConflicts = dated.count;
  return { rows: dated.rows, counts };
}

// A source dates a report on a day Nasdaq lists no row for that ticker, yet Nasdaq does list that ticker on another day of the window:
// the two disagree about the date. Nothing is moved and nothing is added: the Nasdaq row on the other day carries the source's date
// in dateAlt, and merge.js companyEntry keeps it as a "date" conflict (Data rules: conflicts kept). A ticker Nasdaq lists nowhere in
// the window adds nothing. claims: [{ ticker, alt: { from, date, source, ... } }]. Returns { rows, count } and does not change rows.
function markDateConflicts(rows, claims) {
  if (!claims.length) return { rows, count: 0 };
  const byTicker = new Map();
  for (const c of claims) {
    if (!byTicker.has(c.ticker)) byTicker.set(c.ticker, []);
    byTicker.get(c.ticker).push(c.alt);
  }
  let count = 0;
  const out = rows.map((r) => {
    const alts = (byTicker.get(r.ticker) ?? []).filter((a) => a.date !== r.date);
    if (!alts.length) return r;
    count += alts.length;
    return { ...r, dateAlt: [...(r.dateAlt ?? []), ...alts] };
  });
  return { rows: out, count };
}

const minutesOf = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

// A call at or after this time (09:30 ET, the open) says nothing about the lane: the release always comes before its call, so only a
// call before the open puts the release before the open too (Adam, 2026-10-28: a time that cannot be worked out goes to "Time not given").
export const CALL_LANE_BEFORE_MIN = 9 * 60 + 30;

// Rows with what the companies announced. entries: validateReportTimes's list. For one ticker and date, in order:
//   a release time   minutesEt and timeSource "announced" with timeDetail (merge.js resolveLane then decides the lane from the time);
//                    a call time given for the same report is kept in timeDetail.other, never used
//   a stated lane    companyLane { kind "stated", lane, stated: the company's words, source, checked }
//   a call time      companyLane { kind "call", lane "before", timeEt, source, checked } only when the call is before 09:30 ET; a later
//                    call places nothing (callNoLane counts them), and the time is not shown as the report's
// A stated lane or an early call also rides along with a release time, so resolveLane can keep a disagreement as a conflict. An
// entry whose ticker Nasdaq does not list that day adds nothing. Returns { rows, counts: { applied, noRow, callNoLane } }; rows
// are not changed.
export function applyReportTimes(rows, entries) {
  const by = new Map();
  for (const e of entries) {
    const k = `${e.date}|${e.ticker}`;
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(e);
  }
  const detail = (e) => ({ what: e.what ?? null, timeEt: e.timeEt, source: e.source, checked: e.checked });
  const plan = new Map();
  let callNoLane = 0;
  for (const [k, list] of by) {
    const release = list.find((e) => e.what === 'release' && e.timeEt);
    const call = list.find((e) => e.what === 'call' && e.timeEt);
    const stated = list.find((e) => e.lane);
    const p = {};
    if (release) {
      const o = call ?? null;
      p.time = { minutesEt: minutesOf(release.timeEt), timeDetail: { ...detail(release), other: o && detail(o) } };
    }
    if (stated) p.company = { kind: 'stated', lane: stated.lane, stated: stated.stated, source: stated.source, checked: stated.checked, provider: 'company' };
    else if (call && !release) {
      if (minutesOf(call.timeEt) < CALL_LANE_BEFORE_MIN) p.company = { kind: 'call', lane: 'before', timeEt: call.timeEt, stated: call.stated ?? null, source: call.source, checked: call.checked, provider: 'company' };
      else callNoLane += 1;
    }
    if (p.time || p.company) plan.set(k, p);
  }
  const seen = new Set();
  const out = rows.map((r) => {
    const k = `${r.date}|${r.ticker}`;
    const p = plan.get(k);
    if (!p) return r;
    seen.add(k);
    return { ...r, ...(p.time && { minutesEt: p.time.minutesEt, timeSource: 'announced', timeDetail: p.time.timeDetail }), ...(p.company && { companyLane: p.company }) };
  });
  // a planned entry with no Nasdaq row that day: a date conflict on that ticker's row on another day, if Nasdaq has one
  const claims = [...plan.keys()].filter((k) => !seen.has(k)).flatMap((k) => by.get(k).map((e) => ({
    ticker: e.ticker, alt: { from: 'company', date: e.date, source: e.source, checked: e.checked },
  })));
  const dated = markDateConflicts(out, claims);
  return { rows: dated.rows, counts: { applied: seen.size, noRow: plan.size - seen.size, callNoLane, dateConflicts: dated.count } };
}
