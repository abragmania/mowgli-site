// Earnings Whispers' calendar as a source of report lanes for the weeks Kiplinger does not cover yet (Adam, 2026-10-29: Kiplinger
// decides its own week; before it covers one, Earnings Whispers fills only rows that still have no lane, never overriding). Pure: one
// day's JSON answer in, that day's before-the-open and after-the-close tickers out; no fs, network or env, so the relay's cron and the
// local server run the same code (calendar_fetch.js fetches and reduces each day, as it does Kiplinger's page).
//
// Shape learned from tests/fixtures/calendar/earningswhispers-2026-11-02.json to -11-06.json: a list of rows { ticker, company,
// nextEPSDate "YYYY-MM-DDT00:00:00", releaseTime, ... }. releaseTime 1 is before the open and 3 after the close (in the fixtures
// every row is 1 or 3); anything else gives no lane and the row places nothing. D24: the estimates, whisper and results figures are
// never carried. Envelope (a failed fetch, never an empty day): an answer that is not a list, a row with no ticker, releaseTime or
// nextEPSDate, or a row dated another day than the one asked for throws with the reason.
import { fail, need, isCalendarDate } from './times.js';
import { mowgliTicker } from './nasdaq.js';

const SRC = 'earningswhispers';
export const earningsWhispersUrl = (date) => `https://www.earningswhispers.com/api/caldata/${date.replace(/-/g, '')}`;
const LANE_OF = new Map([[1, 'before'], [3, 'after']]);

// One day's answer to { before: [tickers], after: [tickers] } in Mowgli's ticker form (GEF.B as GEF-B), each once per lane, in the
// answer's order, plus noLane: how many rows gave no lane. date: the day asked for.
export function reduceEarningsWhispersDay(json, date) {
  if (!isCalendarDate(date)) fail(SRC, 'date argument', `is not a YYYY-MM-DD date: ${JSON.stringify(date)}`);
  if (!Array.isArray(json)) fail(`${SRC} ${date}`, 'answer', json == null ? undefined : 'is not a list');
  const day = { before: [], after: [] };
  let noLane = 0;
  json.forEach((r, i) => {
    const where = `${SRC} ${date} row ${i}`;
    const t = String(need(r, 'ticker', where) ?? '').trim().toUpperCase();
    if (!t) fail(where, 'ticker', 'is empty');
    const when = String(need(r, 'nextEPSDate', where) ?? '');
    if (when.slice(0, 10) !== date) fail(where, 'nextEPSDate', `(${JSON.stringify(when)}) is not the requested day ${date}`);
    const lane = LANE_OF.get(need(r, 'releaseTime', where));
    if (!lane) { noLane += 1; return; }
    const ticker = mowgliTicker(t);
    if (!day[lane].includes(ticker)) day[lane].push(ticker);
  });
  return { day, noLane };
}

// A stored copy's envelope ({ 'YYYY-MM-DD': { before, after, fetchedAt? } }, one entry per day fetched, fetchedAt that day's own fetch
// time): null when it holds, else the reason. Run by the relay's cron before a copy is replaced and by compose.js before lanes are
// applied.
export function earningsWhispersShapeProblem(p) {
  if (p == null || typeof p !== 'object' || Array.isArray(p)) return 'is not an object';
  const dates = Object.keys(p);
  if (!dates.length) return 'has no day';
  for (const d of dates) {
    const x = p[d];
    if (!isCalendarDate(d)) return `has a day that is not a date: ${JSON.stringify(d)}`;
    if (!Array.isArray(x?.before) || !Array.isArray(x?.after)) return `day ${d} has no before and after lists`;
    if (![...x.before, ...x.after].every((t) => typeof t === 'string' && t)) return `day ${d} lists a ticker that is not text`;
    if ('fetchedAt' in x && !Number.isFinite(Date.parse(x.fetchedAt))) return `day ${d} has a fetchedAt that is not a time`;
  }
  return null;
}
