// Which source decides each week's economic releases and Treasury auctions (Adam, 2026-10-29: "use Kiplinger as the authoritative
// source ... so that we don't have competing info"; each source decides its own week, a second source only previews a week until that
// source covers it, and the page shows one date and time per item). Pure, like the rest of server/lib/calendar/.
//   releases  Forex Factory decides a Monday-to-Friday week whenever its stored copy covers any day of it; otherwise TradingView does.
//   auctions  TreasuryDirect decides a week when its copy is fresh for it: fetched on or after that week's Monday, not stale (the
//             relay's 26-hour rule, calendar_route.js STALE_MS, or an earlier build's copy kept after a failed fetch), and covering a
//             day of it (lead, 2026-10-29); otherwise TradingView's coupon auctions do (calendar-events.json, feed tradingview).
// A TradingView that was not asked for (status not-covered, or no status at all) never takes a week, so a caller without it builds
// exactly what it built before. The losing source's events in a week are dropped and counted, never silently (D98).
import { addDays, mondayOf, toEt } from './times.js';

// Forex Factory's title for a coupon auction, "10-y Bond Auction" style; merge.js pairs it with Treasury's row. Still unverified for
// USD: the first live capture (tests/fixtures/calendar/live-2026-10-27) had no USD auction rows, though Treasury listed a 7-year note
// that week; its only auction titles were EUR ("German 10-y Bond Auction"). Here it marks a Forex Factory row as an auction, which
// gives way when TradingView decides that week's auctions.
export const FF_AUCTION = /^(\d{1,2})-y (Bond|Note) Auction$/;

const overlaps = (c, monday) => !!c && c.from <= addDays(monday, 4) && c.to >= monday;
const asked = (st) => st != null && st.state !== 'not-covered';

// The decision for one week, from the econ statuses merge.js buildCalendar takes ({ state, fetchedAt, stale, covers }). releasesWhy and
// auctionsWhy say why: 'covers', 'fresh', 'earlier-week' (the copy covers only weeks before this one), 'stale', 'not-fresh' (fetched
// before the week's Monday), 'failed' or 'no-copy', and 'no-tradingview' when the fallback was not asked for.
export function weekAuthority(monday, status) {
  const ff = status.forexfactory;
  const tr = status.treasury;
  const tv = status.tradingview;
  const ffOk = ff?.state === 'ok' && overlaps(ff.covers, monday);
  const releasesWhy = ffOk ? 'covers' : !asked(tv) ? 'no-tradingview'
    : ff?.state !== 'ok' ? (ff?.state === 'failed' ? 'failed' : 'no-copy')
      : ff.covers && ff.covers.to < monday ? 'earlier-week' : 'not-covered';
  const trDay = tr?.state === 'ok' && tr.fetchedAt ? toEt(new Date(Date.parse(tr.fetchedAt)).toISOString()).dateEt : null;
  const trOk = trDay != null && !tr.stale && trDay >= monday && overlaps(tr.covers, monday);
  const auctionsWhy = trOk ? 'fresh' : !asked(tv) ? 'no-tradingview'
    : tr?.state !== 'ok' ? (tr?.state === 'failed' ? 'failed' : 'no-copy') : tr.stale ? 'stale' : trDay < monday ? 'not-fresh' : 'not-covered';
  return {
    releases: ffOk || !asked(tv) ? 'forexfactory' : 'tradingview', releasesWhy,
    auctions: trOk || !asked(tv) ? 'treasury' : 'tradingview', auctionsWhy,
  };
}

// The part an event plays: 'releases', 'auctions', or null for the Fed's own events, which no other source replaces.
function roleOf(e) {
  if (e.kind === 'auction') return 'auctions';
  if (e.kind !== 'econ') return null;
  if (e.source?.provider === 'tradingview') return e.auction ? 'auctions' : 'releases';
  return FF_AUCTION.test(e.title) ? 'auctions' : 'releases';
}

// The events each week's deciding source keeps. dates: the window's days (their weeks are decided; an event in any other week is
// decided the same way, by its own Monday). A Forex Factory auction row stays whenever Treasury decides, so merge.js can pair the two.
// Returns { events, weeks: { Monday: weekAuthority(...) } for the window's weeks, dropped: { source: count } }.
export function applyEconAuthority(events, dates, status) {
  const weeks = {};
  const decide = (monday) => (weeks[monday] ??= weekAuthority(monday, status));
  for (const d of dates) decide(mondayOf(d));
  const windowWeeks = new Set(Object.keys(weeks));
  const dropped = { forexfactory: 0, treasury: 0, tradingview: 0 };
  const kept = events.filter((e) => {
    const role = roleOf(e);
    if (!role) return true;
    const by = decide(mondayOf(e.dateEt))[role];
    const tv = e.source?.provider === 'tradingview';
    const keep = by === 'tradingview' ? tv : !tv;
    if (!keep) dropped[tv ? 'tradingview' : e.kind === 'auction' ? 'treasury' : 'forexfactory'] += 1;
    return keep;
  });
  return { events: kept, weeks: Object.fromEntries(Object.entries(weeks).filter(([m]) => windowWeeks.has(m)).sort(([a], [b]) => (a < b ? -1 : 1))), dropped };
}
