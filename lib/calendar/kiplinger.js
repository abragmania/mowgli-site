// Kiplinger's "next week's earnings" page as a source of report lanes (Adam, 2026-10-28: "just use kiplinger"). Pure: HTML text in,
// the week's before-the-open and after-the-close tickers per day out; no fs, network or env, so the relay's cron and the local
// server run the same code. The page is one stable URL (calendar_fetch.js URLS.kiplinger) that Kiplinger rewrites weekly.
//
// Shape of the page (frozen in tests/fixtures/calendar/kiplinger-week.html): an h3 per day, id "section-<weekday>-<m>-<d>" and
// text like "Monday (10/26)", each followed by tables whose caption is "Noteworthy before-the-open earnings reports", "Noteworthy
// after-the-close earnings reports" or the "Other noteworthy ..." variants. A table row is Company | Symbol | Earnings estimate,
// under a header row of bold Company / Symbol. Prose previews between the tables are ignored. D24: the estimate is a forecast
// figure and is not carried.
//
// Envelope (a failed fetch, never an empty week): no day heading, a day outside one Monday-to-Sunday week, a table whose caption
// matches neither lane or that lacks its header row, a row that is not three cells, or a page that yields no ticker at all throws
// with the reason. A symbol that does not read as a ticker skips that row, counted in skipped (rows skipped by rule, as the Fed
// parser counts its own).
import { fail, isCalendarDate, mondayOf } from './times.js';
import { mowgliTicker } from './nasdaq.js';

const SRC = 'kiplinger';
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
// the two lanes, by the words of a table caption
const CAPTION = /^(?:other )?noteworthy (before-the-open|after-the-close) earnings reports$/i;
const LANE_OF = { 'before-the-open': 'before', 'after-the-close': 'after' };
// the id of a day heading, after "section-"
const DAY_ID = /^(sunday|monday|tuesday|wednesday|thursday|friday|saturday)-(\d{1,2})-(\d{1,2})$/;
// Nasdaq's ticker forms (nasdaq.js mowgliTicker turns the class separator into a dash): AAPL, BRK.B, MOG.A
const SYMBOL = /^(?!N\/A$)[A-Z][A-Z0-9]{0,5}(?:[./-][A-Z0-9]{1,3})?$/;
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

// The text of an HTML fragment: tags dropped, entities decoded, white space collapsed. Plain string scans rather than patterns over
// the page: the relay's cron runs this on a 2.3 MB page inside the free plan's 10 ms of CPU (cloudflare/quote-worker/calendar.js).
function text(html) {
  let s = html;
  if (s.includes('<')) {
    let out = '';
    let i = 0;
    for (;;) {
      const lt = s.indexOf('<', i);
      if (lt < 0) { out += s.slice(i); break; }
      out += s.slice(i, lt);
      const gt = s.indexOf('>', lt);
      if (gt < 0) break;
      i = gt + 1;
    }
    s = out;
  }
  if (s.includes('&')) {
    s = s.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (m, dec, hex, name) => (
      dec ? String.fromCodePoint(Number(dec)) : hex ? String.fromCodePoint(parseInt(hex, 16)) : (ENTITIES[name.toLowerCase()] ?? m)
    ));
  }
  return (/[\s]{2}|[\n\t]/.test(s) ? s.replace(/\s+/g, ' ') : s).trim();
}

const weekdayOf = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();

// A heading's date: the year is the one, within a year either side of the fetch day (the December-January turn), in which that
// month and day fall on the heading's weekday; the nearest to the fetch day wins.
function headingDate(name, month, day, fetchDay) {
  const wd = WEEKDAYS.indexOf(name);
  const year = Number(fetchDay.slice(0, 4));
  const fetchMs = Date.parse(`${fetchDay}T00:00:00Z`);
  let best = null;
  for (const y of [year - 1, year, year + 1]) {
    const d = `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (!isCalendarDate(d) || weekdayOf(d) !== wd) continue;
    if (best == null || Math.abs(Date.parse(`${d}T00:00:00Z`) - fetchMs) < Math.abs(Date.parse(`${best}T00:00:00Z`) - fetchMs)) best = d;
  }
  if (!best) fail(SRC, `day heading ${name} ${month}/${day}`, `is not a ${name} in ${year - 1}, ${year} or ${year + 1}`);
  return best;
}

// One table's rows to { lane, tickers, skipped }.
function parseTable(html, where) {
  const c0 = html.indexOf('<caption');
  const c1 = html.indexOf('</caption>');
  if (c0 < 0 || c1 < 0) fail(where, 'caption');
  const captionText = text(html.slice(html.indexOf('>', c0) + 1, c1));
  const m = CAPTION.exec(captionText);
  if (!m) fail(where, 'caption', `is ${JSON.stringify(captionText)}, neither a before-the-open nor an after-the-close report list`);
  const tickers = [];
  const skipped = [];
  let header = false;
  for (let pos = c1; ;) {
    const r0 = html.indexOf('<tr', pos);
    if (r0 < 0) break;
    const r1 = html.indexOf('</tr>', r0);
    if (r1 < 0) fail(where, 'row', 'is not closed');
    const cells = [];
    for (let p = r0; ;) {
      const t0 = html.indexOf('<td', p);
      if (t0 < 0 || t0 > r1) break;
      const gt = html.indexOf('>', t0);
      const t1 = html.indexOf('</td>', gt);
      if (gt < 0 || t1 < 0 || t1 > r1) fail(where, 'row', 'has a cell that is not closed');
      cells.push(text(html.slice(gt + 1, t1)));
      p = t1;
    }
    pos = r1;
    if (cells.length !== 3) fail(where, 'row', `has ${cells.length} cells, not Company, Symbol and estimate`);
    if (!header) {
      if (cells[0] !== 'Company' || cells[1] !== 'Symbol') fail(where, 'header row', `is ${JSON.stringify(cells.slice(0, 2))}, not Company and Symbol`);
      header = true;
      continue;
    }
    const symbol = cells[1].toUpperCase();
    if (SYMBOL.test(symbol)) tickers.push(mowgliTicker(symbol));
    else skipped.push({ company: cells[0], symbol: cells[1] });
  }
  if (!header) fail(where, 'header row');
  return { lane: LANE_OF[m[1].toLowerCase()], tickers, skipped };
}

// The page's HTML to { week, updatedAt, days: { 'YYYY-MM-DD': { before: [tickers], after: [tickers] } }, unlisted: [dates with a
// heading and no ticker, left out of days], skipped }. fetchedAt: when the
// page was fetched (ISO), which gives the year of the headings. week: the Monday of the page's week. updatedAt: the page's own
// dateModified, or null when it carries none. Tickers are in Mowgli's form (BRK-B), each once per lane, in page order.
export function parseKiplinger(html, fetchedAt) {
  if (typeof html !== 'string' || !html) fail(SRC, 'page', 'is empty');
  if (typeof fetchedAt !== 'string' || Number.isNaN(Date.parse(fetchedAt))) fail(SRC, 'fetchedAt argument');
  // the year only needs the fetch day within a day or so (headingDate takes the year that fits the weekday), so the UTC date serves
  const fetchDay = new Date(Date.parse(fetchedAt)).toISOString().slice(0, 10);
  // every section heading in order: a weekday one starts a day, any other (Related content) ends the last day
  const heads = [];
  for (let i = html.indexOf('<h3'); i >= 0; i = html.indexOf('<h3', i + 3)) {
    const gt = html.indexOf('>', i);
    if (gt < 0) break;
    const tag = html.slice(i, gt + 1);
    const k = tag.indexOf(' id="section-');
    if (k < 0) continue;
    const id = tag.slice(k + 13, tag.indexOf('"', k + 13));
    heads.push({ id, at: i, end: gt + 1, day: DAY_ID.exec(id) });
  }
  const days = {};
  const headed = [];
  const unlisted = [];
  const skipped = [];
  for (const [i, h] of heads.entries()) {
    if (!h.day) continue;
    const date = headingDate(h.day[1], Number(h.day[2]), Number(h.day[3]), fetchDay);
    if (headed.includes(date)) fail(SRC, `day heading ${h.id}`, 'appears twice');
    headed.push(date);
    const day = { before: [], after: [] };
    const part = html.slice(h.end, heads[i + 1]?.at ?? html.length);
    let from = 0;
    for (let n = 1; ; n += 1) {
      const start = part.indexOf('<table', from);
      if (start < 0) break;
      const end = part.indexOf('</table>', start);
      if (end < 0) fail(`${SRC} ${date}`, `table ${n}`, 'is not closed');
      const t = parseTable(part.slice(start, end), `${SRC} ${date} table ${n}`);
      for (const x of new Set(t.tickers)) if (!day[t.lane].includes(x)) day[t.lane].push(x);
      skipped.push(...t.skipped.map((s) => ({ date, ...s })));
      from = end;
    }
    // a heading with no ticker under it (Kiplinger drops a passed day's tables, or has none yet) is left out of days and named in
    // unlisted: an empty day would read as "Kiplinger lists nothing", and would block the relay carrying the earlier copy's day
    if (day.before.length || day.after.length) days[date] = day; else unlisted.push(date);
  }
  const dates = [...headed].sort();
  if (!dates.length) fail(SRC, 'day headings', 'none found, so the page is not the weekly earnings page');
  const week = mondayOf(dates[0]);
  const outside = dates.find((d) => mondayOf(d) !== week);
  if (outside) fail(SRC, 'day headings', `${dates[0]} and ${outside} are not in one week`);
  if (!Object.keys(days).length) fail(SRC, 'tables', 'list no ticker, so the page is not the weekly earnings page');
  const m0 = html.indexOf('"dateModified":"');
  const mod = m0 < 0 ? null : html.slice(m0 + 16, html.indexOf('"', m0 + 16));
  const updatedAt = mod && Number.isFinite(Date.parse(mod)) ? new Date(Date.parse(mod)).toISOString() : null;
  return { week, updatedAt, days, unlisted: unlisted.sort(), skipped };
}

// A stored parse's envelope (what parseKiplinger gives, as the relay saves it and the page reads it): null when it holds, else the
// reason. Run by the relay's cron before a copy is replaced and by assembleSources before lanes are applied.
export function kiplingerShapeProblem(p) {
  if (p == null || typeof p !== 'object' || Array.isArray(p)) return 'is not an object';
  if (!isCalendarDate(p.week)) return 'has no week date';
  if (p.days == null || typeof p.days !== 'object' || Array.isArray(p.days)) return 'has no days';
  const dates = Object.keys(p.days);
  if (!dates.length) return 'has no day';
  for (const d of dates) {
    const x = p.days[d];
    if (!isCalendarDate(d)) return `has a day that is not a date: ${JSON.stringify(d)}`;
    if (!Array.isArray(x?.before) || !Array.isArray(x?.after)) return `day ${d} has no before and after lists`;
    if (![...x.before, ...x.after].every((t) => typeof t === 'string' && t)) return `day ${d} lists a ticker that is not text`;
  }
  return null;
}
