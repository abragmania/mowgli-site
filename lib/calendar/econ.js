// Economic calendar sources into one event shape (PROJECT.md Part 4 "Calendar build", step 2). Pure; the fetches are step 4.
// Shapes learned from tests/fixtures/calendar/forexfactory-week.json, fed-calendar.json and treasury-upcoming.json.
// Every event: { kind, title, dateEt, minutesEt, allDay, timeTentative, impact, source, ...source-specific fields }.
import { fail, need, isCalendarDate, toEt, parseClockEt } from './times.js';

const IMPACTS = { high: 'high', medium: 'medium', low: 'low', holiday: 'holiday' };
const tidy = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

function needFetchedAt(fetchedAt, source) {
  if (typeof fetchedAt !== 'string' || !fetchedAt) fail(source, 'fetchedAt argument');
}

function needArray(v, source, field) {
  if (!Array.isArray(v)) fail(source, field, v == null ? 'is missing' : 'is not an array');
  return v;
}

function needTitle(e, where) {
  const title = tidy(need(e, 'title', where));
  if (!title) fail(where, 'title', 'is empty');
  return title;
}

// Forex Factory week feed (https://nfs.faireconomy.media/ff_calendar_thisweek.json).
// D24: US (USD) events only; actual, forecast and previous figures are never carried (schedule only).
export function parseForexFactory(json, fetchedAt) {
  const SRC = 'forexfactory';
  needFetchedAt(fetchedAt, SRC);
  const out = [];
  needArray(json, SRC, 'top-level event array').forEach((e, i) => {
    const where = `${SRC} event ${i}`;
    // D24: only USD rows are used, so only they must be complete; a malformed foreign row cannot fail the run.
    if (need(e, 'country', where) !== 'USD') return;
    const title = needTitle(e, where);
    const when = need(e, 'date', where);
    if (!when) fail(where, 'date', 'is empty');
    const rawImpact = tidy(need(e, 'impact', where));
    const impact = IMPACTS[rawImpact.toLowerCase()] || 'other';
    const { dateEt, minutesEt } = toEt(when);
    // D24: a holiday is an all-day note; the feed gives it a clock time that means nothing in New York.
    const allDay = impact === 'holiday';
    out.push({
      kind: 'econ', title, dateEt, minutesEt: allDay ? null : minutesEt, allDay, timeTentative: false, impact,
      source: { provider: SRC, date: when, impact: rawImpact, fetchedAt },
    });
  });
  return out;
}

// FOMC titles to a short event name; null for any other FOMC title (kept, just not named).
function fomcEvent(title) {
  if (/^FOMC Meeting\b/i.test(title)) return 'meeting';
  if (/^FOMC Minutes\b/i.test(title)) return 'minutes';
  if (/^FOMC Press Conference\b/i.test(title)) return 'press-conference';
  return null;
}

// "5, 12, 19, 27" to [5, 12, 19, 27]; any token that is not a day of the month throws.
function splitDays(text, where) {
  const toks = String(text ?? '').split(',').map((t) => t.trim()).filter(Boolean);
  if (!toks.length) fail(where, 'days', 'is empty');
  return toks.map((t) => {
    if (!/^\d{1,2}$/.test(t)) fail(where, 'days', `has an unrecognised token ${JSON.stringify(t)}`);
    return Number(t);
  });
}

// Federal Reserve calendar (https://www.federalreserve.gov/json/calendar.json). The live file starts with a byte-order mark,
// so a string input is accepted and stripped. One source event can list several days; it becomes one event per day.
// Times are ET: cross-checked on 2026-10-28, where the Fed's 2:00 p.m. FOMC meeting and 2:30 p.m. press conference match
// Forex Factory's 14:00-04:00 and 14:30-04:00 (tests/fixtures/calendar).
// D98: exactly two row shapes are skipped, and counted rather than dropped silently: an empty object, and a row whose month is
// the empty string (it names no date). Any other unusable row still throws. The returned array carries the counts as a
// non-enumerable property, skipped: { empty, noMonth }.
export function parseFedCalendar(input, fetchedAt) {
  const SRC = 'federal-reserve';
  needFetchedAt(fetchedAt, SRC);
  let json = input;
  if (typeof input === 'string') {
    try {
      json = JSON.parse(input.replace(/^﻿/, ''));
    } catch (err) {
      fail(SRC, 'response', `is not JSON (${err.message})`);
    }
  }
  const out = [];
  const skipped = { empty: 0, noMonth: 0 };
  needArray(need(json, 'events', SRC), SRC, 'events').forEach((e, i) => {
    const where = `${SRC} event ${i}`;
    if (e != null && typeof e === 'object' && !Array.isArray(e) && !Object.keys(e).length) { skipped.empty += 1; return; }
    if (e?.month === '') { skipped.noMonth += 1; return; }
    const title = needTitle(e, where);
    const month = tidy(need(e, 'month', where));
    if (!/^\d{4}-\d{2}$/.test(month)) fail(where, 'month', `is not YYYY-MM: ${JSON.stringify(month)}`);
    const minutesEt = parseClockEt(need(e, 'time', where), where);
    const type = tidy(need(e, 'type', where)) || null;
    const allDay = minutesEt == null && /^Holiday\b/i.test(title);
    for (const d of splitDays(need(e, 'days', where), where)) {
      const dateEt = `${month}-${String(d).padStart(2, '0')}`;
      if (!isCalendarDate(dateEt)) fail(where, 'days', `gives a day that does not exist: ${dateEt}`);
      out.push({
        kind: 'fed', title, dateEt, minutesEt, allDay, timeTentative: minutesEt == null && !allDay,
        // The Fed's file carries no impact rating; none is invented (D94).
        impact: null,
        fedType: type, fomcEvent: type === 'FOMC' ? fomcEvent(title) : null,
        source: { provider: SRC, month, days: tidy(e.days), fetchedAt },
      });
    }
  });
  Object.defineProperty(out, 'skipped', { value: skipped, enumerable: false });
  return out;
}

// The relay's cut of the Fed file (PROJECT.md Part 4 "Calendar build", step 5): the live file runs back to 2017 (2,602 rows,
// 545 KB on 2026-10-27), and parseFedCalendar over all of it takes about 17 ms, past the relay's 10 ms CPU budget; from the
// current month on it takes under 1 ms. Drops only rows whose month is a YYYY-MM earlier than fromMonth; every other row (the
// empty objects and empty months parseFedCalendar counts, and any malformed row it refuses) is kept, so parsing the cut file
// skips, counts and fails exactly as parsing the whole one would for the months kept. A string input (the live file has a
// byte-order mark) is read as parseFedCalendar reads it. Returns { events, trimmed: { before, rows } }; parseFedCalendar takes
// it as it is. The Fed's covered span then starts at the earliest month kept (compose.js coversOf), which is no earlier than
// fromMonth: a day before it reads "not-covered", never quiet (D98).
export function trimFedCalendar(input, fromMonth) {
  const SRC = 'federal-reserve';
  if (typeof fromMonth !== 'string' || !/^\d{4}-\d{2}$/.test(fromMonth)) fail(SRC, 'fromMonth argument', `is not YYYY-MM: ${JSON.stringify(fromMonth)}`);
  let json = input;
  if (typeof input === 'string') {
    try {
      json = JSON.parse(input.replace(/^﻿/, ''));
    } catch (err) {
      fail(SRC, 'response', `is not JSON (${err.message})`);
    }
  }
  const events = needArray(need(json, 'events', SRC), SRC, 'events');
  const kept = [];
  let rows = 0;
  for (const e of events) {
    const m = e != null && typeof e === 'object' ? tidy(e.month) : '';
    if (/^\d{4}-\d{2}$/.test(m) && m < fromMonth) { rows += 1; continue; }
    kept.push(e);
  }
  return { events: kept, trimmed: { before: fromMonth, rows } };
}

// TreasuryDirect upcoming auctions (https://www.treasurydirect.gov/TA_WS/securities/upcoming?format=json). auctionDate is
// often absent or empty; the competitive bid close (date and time) is the auction's time. Times are ET, cross-checked on the fixture
// (tests/fixtures/calendar): 11:30 AM closes for the bills and the 2-year FRN, 1:00 PM for the 7-year note.
export function parseTreasuryUpcoming(json, fetchedAt) {
  const SRC = 'treasury';
  needFetchedAt(fetchedAt, SRC);
  return needArray(json, SRC, 'top-level auction array').map((a, i) => {
    const where = `${SRC} auction ${i}`;
    const cusip = tidy(need(a, 'cusip', where));
    const securityType = tidy(need(a, 'securityType', where));
    const securityTerm = tidy(need(a, 'securityTerm', where));
    if (!securityType) fail(where, 'securityType', 'is empty');
    if (!securityTerm) fail(where, 'securityTerm', 'is empty');
    const closeDate = tidy(need(a, 'competitiveAuctionCloseDate', where));
    const day = (tidy(a.auctionDate) || closeDate).slice(0, 10);
    if (!isCalendarDate(day)) fail(where, 'auctionDate and competitiveAuctionCloseDate', `give no usable date: ${JSON.stringify(day)}`);
    const minutesEt = parseClockEt(need(a, 'competitiveAuctionCloseTime', where), where);
    const label = tidy(a.securityDescription) || `${securityTerm} ${securityType}`;
    // The calendar-events.json Treasury rule matches on these, not on the title: an FRN or TIPS is securityType "Note" too.
    // TreasuryDirect type is Note, Bond, Bill, CMB, FRN or TIPS; floatingRate and inflationProtected are "Yes", "No" or empty
    // (bills); originalSecurityTerm names a reopening's first term (a "9-Year 10-Month" note is a reopened 10-year).
    const auctionType = tidy(need(a, 'type', where)) || null;
    const floatingRate = tidy(need(a, 'floatingRate', where)) || null;
    const inflationProtected = tidy(need(a, 'inflationProtected', where)) || null;
    const originalSecurityTerm = tidy(need(a, 'originalSecurityTerm', where)) || null;
    return {
      kind: 'auction', title: `${label} Auction`, dateEt: day, minutesEt, allDay: false, timeTentative: minutesEt == null,
      // TreasuryDirect carries no impact rating; none is invented (D94).
      impact: null,
      securityType, securityTerm, auctionType, floatingRate, inflationProtected, originalSecurityTerm,
      source: { provider: SRC, cusip: cusip || null, updated: tidy(a.updatedTimestamp) || null, fetchedAt },
    };
  });
}
