// Nasdaq earnings calendar, one day's response (https://api.nasdaq.com/api/calendar/earnings?date=YYYY-MM-DD), into calendar
// rows. Pure; the fetch is step 4. Shape learned from tests/fixtures/calendar/nasdaq-*.json.
import { fail, need, isCalendarDate, isWeekend, marketClosures } from './times.js';

const SRC = 'nasdaq';
const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
// Nasdaq's time codes. Nasdaq gives a lane only, never an exact time.
const LANES = { 'time-pre-market': 'before', 'time-after-hours': 'after', 'time-not-supplied': null };
const EMPTY = new Set(['', 'N/A', 'n/a', '--']);

// "Thu, Nov 5, 2026" to "2026-11-05"; null when the text is not in that form. Exported for the relay cron's envelope check
// (cloudflare/quote-worker/calendar.js shapeProblem), so both read the day the same way.
export function asOfDate(text) {
  const m = /^[A-Z][a-z]{2}, ([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/.exec(String(text ?? '').trim());
  if (!m || !MONTHS[m[1]]) return null;
  return `${m[3]}-${String(MONTHS[m[1]]).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

// "$181,846,458,000" to 181846458000. D94/D99: a blank or N/A value is null, never zero; any other text throws.
export function parseMarketValue(text, symbol) {
  const s = String(text ?? '').trim();
  if (EMPTY.has(s)) return null;
  if (!/^\$\d{1,3}(,\d{3})*(\.\d+)?$/.test(s)) fail(SRC, `marketCap for ${symbol}`, `has an unrecognised format: ${JSON.stringify(text)}`);
  return Number(s.slice(1).replace(/,/g, ''));
}

// "Sep/2026" to "2026-09": the month Nasdaq says the fiscal quarter ends, as given (the quarter's number is not derived here).
function fiscalQuarterEnd(text, symbol) {
  const s = String(text ?? '').trim();
  if (EMPTY.has(s)) return null;
  const m = /^([A-Z][a-z]{2})\/(\d{4})$/.exec(s);
  if (!m || !MONTHS[m[1]]) fail(SRC, `fiscalQuarterEnding for ${symbol}`, `has an unrecognised format: ${JSON.stringify(text)}`);
  return `${m[2]}-${String(MONTHS[m[1]]).padStart(2, '0')}`;
}

// Mowgli writes class tickers with a dash (BRK-B, as in data/reference/cats-index.json); Nasdaq writes BRK.B.
export function mowgliTicker(symbol) {
  return symbol.replace(/[./]/g, '-');
}

// D61: the company a ticker belongs to, the one copy shared by merge.js groupShareClasses and lanes.js applyKiplinger (which moves a
// company's class rows together): { key, via }. via "map" when shareClassOf (cats-index.json style, class -> parent) names it or
// it is a parent there, key the parent; "suffix" for a class suffix (BRK-A), key the base's parent or the base; else "self".
// groupShareClasses still splits a suffix row whose company name differs.
export function companyKeyOf(ticker, shareClassOf = {}) {
  const parentOf = (t) => (Object.hasOwn(shareClassOf, t) ? shareClassOf[t] : t);
  if (Object.hasOwn(shareClassOf, ticker) || Object.values(shareClassOf).includes(ticker)) return { key: parentOf(ticker), via: 'map' };
  const dot = /^([A-Z0-9]+)-[A-Z]$/.exec(ticker);
  return dot ? { key: parentOf(dot[1]), via: 'suffix' } : { key: ticker, via: 'self' };
}

// One Nasdaq day response to rows. date is the day requested (YYYY-MM-DD); fetchedAt is when it was fetched (ISO).
// D24: schedule only. Consensus EPS, estimate counts, last year's EPS and (on a past day) reported EPS and surprise are
// forecast, previous or result figures, so none of them is carried.
export function parseNasdaqDay(json, date, fetchedAt) {
  if (!isCalendarDate(date)) fail(SRC, 'date argument', `is not a YYYY-MM-DD date: ${JSON.stringify(date)}`);
  if (typeof fetchedAt !== 'string' || !fetchedAt) fail(SRC, 'fetchedAt argument');
  const status = json?.status;
  if (status && status.rCode != null && status.rCode !== 200) fail(SRC, 'status.rCode', `is ${status.rCode}`);
  const data = need(json, 'data', SRC);
  const asOf = need(data, 'asOf', `${SRC} data`);
  if (asOfDate(asOf) !== date) fail(SRC, 'data.asOf', `(${JSON.stringify(asOf)}) is not the requested day ${date}`);
  const rows = need(data, 'rows', `${SRC} data`);
  // D98: a good response for the right day with no rows is an empty day, not an error; nasdaqEmptyDayKind says whether that
  // emptiness is believable.
  if (rows == null) return [];
  if (!Array.isArray(rows)) fail(SRC, 'data.rows', 'is not an array');
  return rows.map((r, i) => {
    const where = `${SRC} ${date} row ${i}`;
    const symbol = String(need(r, 'symbol', where) ?? '').trim();
    if (!symbol) fail(where, 'symbol', 'is empty');
    const time = need(r, 'time', where);
    if (!(time in LANES)) fail(where, 'time', `has an unknown code ${JSON.stringify(time)}`);
    const name = String(need(r, 'name', where) ?? '').trim();
    return {
      ticker: mowgliTicker(symbol),
      name: name || null,
      marketValue: parseMarketValue(need(r, 'marketCap', where), symbol),
      // Nasdaq never gives a clock time; step 6 adds usual times from SEC filings ("usual") and recorded announcements ("announced").
      minutesEt: null,
      timeSource: null,
      lane: LANES[time],
      laneSource: LANES[time] ? 'nasdaq' : null,
      fiscalQuarterEnd: fiscalQuarterEnd(need(r, 'fiscalQuarterEnding', where), symbol),
      date,
      // D23: Nasdaq has no confirmed flag, so every Nasdaq date is estimated until a company announcement is recorded.
      dateStatus: 'estimated',
      source: { provider: SRC, date, symbol, asOf, fetchedAt },
    };
  });
}

// D98: an empty Nasdaq day on a weekend or an NYSE closure is "none-listed" (believable); an empty ordinary trading weekday is
// "suspect", and the fetch layer keeps the last good copy with a stale marker.
export function nasdaqEmptyDayKind(date, marketCalendar) {
  if (!isCalendarDate(date)) fail(SRC, 'date argument', `is not a YYYY-MM-DD date: ${JSON.stringify(date)}`);
  if (isWeekend(date)) return 'none-listed';
  return marketClosures(marketCalendar).get(date)?.kind === 'closed' ? 'none-listed' : 'suspect';
}
