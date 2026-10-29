// Where a Nasdaq earnings row gets its lane or time when Nasdaq gives none (Adam, 2026-10-28: "just use kiplinger ... if it's not on
// Kiplinger, go to the company's website and see what time the call is scheduled for"). Pure, like the rest of server/lib/calendar/.
// Neither source adds a report: both only place a row Nasdaq already lists for that day and ticker (no invented reports), and
// neither sets a "usual" lane.
//   applyKiplinger    Kiplinger's before / after lists (kiplinger.js) onto rows with no lane
//   applyReportTimes  what companies announced on their own sites (data/reference/calendar-report-times.json, config.js
//                     validateReportTimes): a release time as an announced minutesEt, which merge.js resolveLane turns into the
//                     lane; a stated lane ("before the market opens") or a call before 09:30 ET as a company lane
import { kiplingerShapeProblem } from './kiplinger.js';
import { fail } from './times.js';

export const KIPLINGER_URL = 'https://www.kiplinger.com/investing/stocks/17494/next-week-earnings-calendar-stocks';

// Rows (parseNasdaqDay's) with Kiplinger's lane: a row with no Nasdaq lane takes Kiplinger's, laneSource "kiplinger" and laneFrom
// naming the page; a row whose Nasdaq lane differs keeps Nasdaq's and carries Kiplinger's as laneAlt, which merge.js resolveLane
// records as a conflict (Data rules: conflicts kept). A ticker Kiplinger lists in both lanes on one day is ambiguous and places
// nothing. payload: a parse (kiplinger.js parseKiplinger) as stored, plus carried (date -> the fetchedAt of the copy that supplied a
// day the newest page no longer lists); fetchedAt: when payload was fetched. Returns { rows, counts } and does not change rows.
export function applyKiplinger(rows, payload, fetchedAt) {
  const bad = kiplingerShapeProblem(payload);
  if (bad) fail('kiplinger', 'payload', bad);
  const lane = new Map(); // "date|ticker" -> 'before' | 'after' | null (ambiguous)
  const listed = { before: 0, after: 0 };
  for (const [date, day] of Object.entries(payload.days)) {
    for (const l of ['before', 'after']) {
      for (const t of day[l]) {
        listed[l] += 1;
        const k = `${date}|${t}`;
        lane.set(k, lane.has(k) && lane.get(k) !== l ? null : l);
      }
    }
  }
  const counts = { filled: 0, agreed: 0, conflicted: 0, ambiguous: 0, noRow: 0, listed: listed.before + listed.after };
  const seen = new Set();
  const out = rows.map((r) => {
    const k = `${r.date}|${r.ticker}`;
    if (!lane.has(k)) return r;
    seen.add(k);
    const l = lane.get(k);
    if (l == null) { counts.ambiguous += 1; return r; }
    const from = { provider: 'kiplinger', url: KIPLINGER_URL, date: r.date, week: payload.week, updatedAt: payload.updatedAt ?? null, fetchedAt: payload.carried?.[r.date] ?? fetchedAt };
    if (r.lane == null) { counts.filled += 1; return { ...r, lane: l, laneSource: 'kiplinger', laneFrom: from }; }
    if (r.lane === l) { counts.agreed += 1; return r; }
    counts.conflicted += 1;
    return { ...r, laneAlt: { ...from, lane: l } };
  });
  counts.noRow = lane.size - seen.size;
  const claims = [...lane.keys()].filter((k) => !seen.has(k)).map((k) => {
    const [date, ticker] = k.split('|');
    return { ticker, alt: { from: 'kiplinger', date, source: KIPLINGER_URL, lane: lane.get(k) } };
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
