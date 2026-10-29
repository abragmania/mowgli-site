// Calendar dates and times (PROJECT.md Part 4 "Calendar build", step 2). Pure: standard JavaScript and Intl only, so the same
// code runs in the local server and the Cloudflare relay. This file owns every time-zone conversion for the calendar, the NYSE
// closures index, and the small boundary checks the calendar modules share.

export const ET_ZONE = 'America/New_York';
// R3: a report up to 12:45 PM ET joins Before the open; later joins After the close.
export const LANE_CUTOFF_ET = 12 * 60 + 45;

const ET_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: ET_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

// A missing column fails the run: throws naming the source and the field. err.code is CALENDAR_MISSING_FIELD when the field is
// absent and CALENDAR_BAD_VALUE when it is present but unusable.
export function fail(source, field, detail) {
  const err = new Error(`${source}: ${field}${detail ? ' ' + detail : ' is missing'}`);
  err.source = source;
  err.field = field;
  err.code = detail && detail !== 'is missing' ? 'CALENDAR_BAD_VALUE' : 'CALENDAR_MISSING_FIELD';
  throw err;
}

// Throws unless obj carries the field (its value may still be empty; an empty value becomes null in the parser).
export function need(obj, field, source) {
  if (obj == null || typeof obj !== 'object' || !(field in obj)) fail(source, field);
  return obj[field];
}

const utcOf = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

// True for a real calendar date written YYYY-MM-DD.
export function isCalendarDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = utcOf(s);
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

// A calendar date's weekday is the same everywhere, so UTC arithmetic on the date alone is exact.
export function isWeekend(date) {
  const wd = utcOf(date).getUTCDay();
  return wd === 0 || wd === 6;
}

export function addDays(date, n) {
  const t = utcOf(date);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

// The Monday of the Monday-to-Sunday week a calendar date falls in (a Sunday belongs to the week before it). The one copy: the
// fetch layer (calendar_fetch.js) re-exports it and kiplinger.js uses it.
export function mondayOf(date) {
  return addDays(date, -((utcOf(date).getUTCDay() + 6) % 7));
}

// An instant (UTC ISO such as SEC's 2026-07-30T20:30:28.000Z, or an offset time such as Forex Factory's
// 2026-10-28T14:00:00-04:00) as New York wall-clock date and minutes after midnight. DST comes from Intl's zone data.
export function toEt(instant) {
  if (typeof instant !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(instant)) {
    fail('toEt', 'timestamp', `is not a timestamp with a zone: ${JSON.stringify(instant)}`);
  }
  const t = Date.parse(instant);
  if (Number.isNaN(t)) fail('toEt', 'timestamp', `is unparseable: ${instant}`);
  const p = Object.fromEntries(ET_PARTS.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return { dateEt: `${p.year}-${p.month}-${p.day}`, minutesEt: Number(p.hour) * 60 + Number(p.minute) };
}

// R3: the lane for a known ET time; null when no time is known.
export function laneForEtMinutes(minutes) {
  if (minutes == null) return null;
  if (!Number.isInteger(minutes) || minutes < 0 || minutes >= 24 * 60) throw new RangeError(`laneForEtMinutes: ${minutes} is not 0..1439`);
  return minutes <= LANE_CUTOFF_ET ? 'before' : 'after';
}

// A wall-clock time already in ET as the source prints it ("2:00 p.m.", "11:30 AM", "01:00 PM") to minutes after midnight.
// An empty value is null (no time given); any other unrecognised text throws, so a format change fails the run.
export function parseClockEt(text, source) {
  const s = String(text ?? '').trim();
  if (!s) return null;
  const m = /^(\d{1,2}):(\d{2})\s*([ap])\.?\s*m\.?$/i.exec(s);
  if (!m) fail(source, 'time', `has an unrecognised format: ${JSON.stringify(text)}`);
  const h = Number(m[1]), min = Number(m[2]);
  if (h < 1 || h > 12 || min > 59) fail(source, 'time', `is out of range: ${JSON.stringify(text)}`);
  return (h % 12 + (m[3].toLowerCase() === 'p' ? 12 : 0)) * 60 + min;
}

// NYSE closures and early closes (data/reference/market-calendar.json) to date -> { kind, closeEt, name, source }; closeEt is
// the early close in minutes after midnight ET, null on a closed day.
export function marketClosures(marketCalendar) {
  const SRC = 'market-calendar';
  if (!Array.isArray(marketCalendar?.days)) fail(SRC, 'days');
  const tz = marketCalendar.closeTimeZone;
  if (tz !== ET_ZONE) fail(SRC, 'closeTimeZone', `is ${JSON.stringify(tz)}, expected ${ET_ZONE}`);
  const source = { provider: 'nyse', url: marketCalendar.source?.url ?? null, readOn: marketCalendar.source?.readOn ?? null };
  const idx = new Map();
  marketCalendar.days.forEach((d, i) => {
    const where = `${SRC} day ${i}`;
    if (!isCalendarDate(d?.date)) fail(where, 'date');
    if (d.kind !== 'closed' && d.kind !== 'early') fail(where, 'kind', `is ${JSON.stringify(d.kind)}`);
    if (!d.name) fail(where, 'name');
    let closeEt = null;
    if (d.kind === 'early') {
      const m = /^(\d{2}):(\d{2})$/.exec(d.closeTime ?? '');
      if (!m) fail(where, 'closeTime');
      closeEt = Number(m[1]) * 60 + Number(m[2]);
    }
    idx.set(d.date, { kind: d.kind, closeEt, name: d.name, source });
  });
  return idx;
}
