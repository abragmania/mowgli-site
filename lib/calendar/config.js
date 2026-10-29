// Calendar reference files (PROJECT.md Part 4 "Calendar build", step 3): data/reference/calendar-tiers.json and
// calendar-events.json are checked here and turned into what tiers.js and merge.js take. Pure: no fs, network, node: imports or
// env; the caller reads the files and passes them in. The publish bake (step 4) wires the validators in.
import { fail, isCalendarDate } from './times.js';
import { TIERS } from './tiers.js';

const TIERS_SRC = 'calendar-tiers';
const EVENTS_SRC = 'calendar-events';
const OVERLAYS_SRC = 'business-models overlays';
// Mowgli writes tickers in capitals, with a dash before a class letter (BRK-B; nasdaq.js mowgliTicker).
const TICKER = /^[A-Z0-9]{1,6}(-[A-Z0-9]{1,3})?$/;
const THRESHOLD_TIERS = ['notable', 'standard', 'minor'];
// Each feed's status name in merge.js and the event kind its parser in econ.js gives. Forex Factory and TradingView both give "econ"
// (Adam, 2026-10-29: TradingView previews the weeks Forex Factory does not cover), so an event's feed is its source.provider when
// that names a feed of its kind, else the one feed of its kind (the Fed's provider is "federal-reserve").
export const FEED_KINDS = { forexfactory: 'econ', fed: 'fed', treasury: 'auction', tradingview: 'econ' };
const KIND_FEED = new Map();
for (const [feed, kind] of Object.entries(FEED_KINDS)) if (!KIND_FEED.has(kind)) KIND_FEED.set(kind, feed);
export const feedOf = (e) => (FEED_KINDS[e?.source?.provider] === e?.kind ? e.source.provider : KIND_FEED.get(e?.kind));
// The Fed rule that keeps a Board member's appearance; merge.js pairs only events kept by it with Forex Factory's "Speaks" and
// "Testifies" rows, so the events file must keep a rule with this id.
export const APPEARANCE_RULE = 'board-appearances';
const IMPACTS = ['high', 'medium', 'low', 'holiday', 'other'];
// D26: low is an item kept but shown small.
const EMPHASES = ['normal', 'low'];
// Optional rule fields that match a list against one event field, each allowed on one feed only.
const LIST_MATCHES = {
  impacts: { kind: 'econ', feed: 'forexfactory and tradingview', field: 'impact', allowed: IMPACTS },
  fedTypes: { kind: 'fed', feed: 'fed', field: 'fedType' },
  auctionTypes: { kind: 'auction', feed: 'treasury', field: 'auctionType' },
};
// Treasury event fields a rule's exclude may name (econ.js parseTreasuryUpcoming); an event whose field equals the value is out.
const EXCLUDABLE = ['floatingRate', 'inflationProtected'];

const isPlainObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Map) && !(v instanceof Set);

// fail() with a sharper code than CALENDAR_BAD_VALUE, for the failures a caller needs to tell apart.
function failAs(code, source, field, detail) {
  try {
    fail(source, field, detail);
  } catch (err) {
    err.code = code;
    throw err;
  }
}

function needObject(obj, field, where) {
  if (!(field in obj)) fail(where, field);
  if (!isPlainObject(obj[field])) fail(where, field, 'is not an object');
  return obj[field];
}

function needText(obj, field, where) {
  if (!(field in obj)) fail(where, field);
  const v = obj[field];
  if (typeof v !== 'string' || !v.trim()) fail(where, field, 'is not text');
  return v;
}

function needDate(obj, field, where) {
  if (!(field in obj)) fail(where, field);
  if (!isCalendarDate(obj[field])) fail(where, field, `is not a YYYY-MM-DD date: ${JSON.stringify(obj[field])}`);
  return obj[field];
}

function needTicker(t, where, field) {
  if (typeof t !== 'string' || !TICKER.test(t)) {
    failAs('CALENDAR_BAD_TICKER', where, field, `is ${JSON.stringify(t)}, not a ticker written like AAPL or BRK-B`);
  }
  return t;
}

// The member tickers of one data/reference/business-models.json overlays group.
function overlayMembers(overlays, id) {
  if (!isPlainObject(overlays)) fail(OVERLAYS_SRC, 'overlays', overlays == null ? undefined : 'is not an object');
  if (!Array.isArray(overlays.groups)) fail(OVERLAYS_SRC, 'groups', 'groups' in overlays ? 'is not an array' : undefined);
  const group = overlays.groups.find((g) => g?.id === id);
  if (!group) {
    const ids = overlays.groups.map((g) => g?.id).join(', ');
    failAs('CALENDAR_UNKNOWN_OVERLAY', `${TIERS_SRC} megacaps`, 'overlay', `is ${JSON.stringify(id)}, not a group id in business-models.json overlays (${ids})`);
  }
  const where = `${OVERLAYS_SRC} group ${id}`;
  if (!Array.isArray(group.members) || !group.members.length) fail(where, 'members', 'members' in group ? 'is not a non-empty list' : undefined);
  group.members.forEach((t, i) => needTicker(t, where, `members[${i}]`));
  return [...group.members];
}

// A ticker's value from marketValues: undefined when the ticker is absent, null when it is listed with no value.
function marketValueOf(marketValues, t) {
  const has = marketValues instanceof Map ? marketValues.has(t) : Object.hasOwn(marketValues, t);
  if (!has) return undefined;
  const v = marketValues instanceof Map ? marketValues.get(t) : marketValues[t];
  if (v !== null && (typeof v !== 'number' || !Number.isFinite(v))) fail(`${TIERS_SRC} marketValues`, t, 'is not a number or null');
  return v;
}

// Checks data/reference/calendar-tiers.json against the overlays object of data/reference/business-models.json; throws with
// source, field and code on any fault. marketValues (optional; a Map or object of ticker to dollars, null when the source lists
// no value) turns on the floor check: an override or adamList company worth under the minor threshold can never show, since R3's
// $1B floor keeps it off the page, and is returned as a warning. Returns { warnings, floorChecked, unchecked }: unchecked lists
// every override and adamList ticker whose value is not known (absent from marketValues or null, or no marketValues at all), and
// floorChecked is true only when that list is empty.
export function validateTiers(json, overlays, marketValues) {
  if (!isPlainObject(json)) fail(TIERS_SRC, 'file', json == null ? undefined : 'is not a JSON object');

  const th = needObject(json, 'thresholds', TIERS_SRC);
  const values = needObject(th, 'values', `${TIERS_SRC} thresholds`);
  for (const k of Object.keys(values)) {
    if (!THRESHOLD_TIERS.includes(k)) failAs('CALENDAR_UNKNOWN_TIER', `${TIERS_SRC} thresholds.values`, k, `is not a tier with a threshold (${THRESHOLD_TIERS.join(', ')})`);
  }
  for (const k of THRESHOLD_TIERS) {
    if (!(k in values)) fail(`${TIERS_SRC} thresholds.values`, k);
    const v = values[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) fail(`${TIERS_SRC} thresholds.values`, k, 'is not a positive number');
  }
  if (!(values.notable > values.standard && values.standard > values.minor)) {
    failAs('CALENDAR_THRESHOLD_ORDER', `${TIERS_SRC} thresholds`, 'values', 'must fall notable > standard > minor');
  }
  needText(th, 'source', `${TIERS_SRC} thresholds`);
  needDate(th, 'decided', `${TIERS_SRC} thresholds`);

  const mc = needObject(json, 'megacaps', TIERS_SRC);
  overlayMembers(overlays, needText(mc, 'overlay', `${TIERS_SRC} megacaps`));
  needText(mc, 'source', `${TIERS_SRC} megacaps`);
  needDate(mc, 'decided', `${TIERS_SRC} megacaps`);

  const ov = needObject(json, 'overrides', TIERS_SRC);
  needText(ov, 'comment', `${TIERS_SRC} overrides`);
  const overrides = needObject(ov, 'entries', `${TIERS_SRC} overrides`);
  for (const [t, e] of Object.entries(overrides)) {
    needTicker(t, `${TIERS_SRC} overrides.entries`, t);
    const where = `${TIERS_SRC} override ${t}`;
    if (!isPlainObject(e)) fail(where, 'entry', 'is not an object');
    const tier = needText(e, 'tier', where);
    if (!TIERS.includes(tier)) failAs('CALENDAR_UNKNOWN_TIER', where, 'tier', `is ${JSON.stringify(tier)}, not one of ${TIERS.join(', ')}`);
    needText(e, 'source', where);
    needDate(e, 'decided', where);
  }

  const al = needObject(json, 'adamList', TIERS_SRC);
  needText(al, 'comment', `${TIERS_SRC} adamList`);
  if (!('entries' in al)) fail(`${TIERS_SRC} adamList`, 'entries');
  if (!Array.isArray(al.entries)) fail(`${TIERS_SRC} adamList`, 'entries', 'is not an array');
  const adam = [];
  al.entries.forEach((e, i) => {
    const where = `${TIERS_SRC} adamList entry ${i}`;
    if (!isPlainObject(e)) fail(where, 'entry', 'is not an object');
    const t = needTicker(needText(e, 'ticker', where), where, 'ticker');
    if (adam.includes(t)) fail(where, 'ticker', `${t} is listed twice`);
    if (Object.hasOwn(overrides, t)) fail(where, 'ticker', `${t} is also an override; give it one place`);
    needText(e, 'source', where);
    needDate(e, 'decided', where);
    adam.push(t);
  });

  const warnings = [];
  const unchecked = [];
  if (marketValues != null && !(marketValues instanceof Map) && !isPlainObject(marketValues)) {
    fail(`${TIERS_SRC} marketValues`, 'argument', 'is not a Map or object');
  }
  const check = (t, field) => {
    const v = marketValues == null ? undefined : marketValueOf(marketValues, t);
    if (v == null) { unchecked.push(t); return; }
    if (v < values.minor) {
      warnings.push({
        code: 'CALENDAR_OVERRIDE_BELOW_FLOOR', source: TIERS_SRC, field, ticker: t, marketValue: v,
        message: `${t} is worth $${v.toLocaleString('en-US')}, under the $${values.minor.toLocaleString('en-US')} floor (R3), so it never shows`,
      });
    }
  };
  for (const t of Object.keys(overrides)) check(t, `overrides.entries.${t}`);
  for (const t of adam) check(t, `adamList ${t}`);
  return { warnings, floorChecked: !unchecked.length, unchecked };
}

// The config tiers.js takes: { megacaps, overrides: { TICKER: tier }, thresholds: { notable, standard, minor }, adamList }, plus
// check: validateTiers's { warnings, floorChecked, unchecked } for the caller to report (tiers.js ignores it).
export function resolveTiersConfig(json, overlays, marketValues) {
  const check = validateTiers(json, overlays, marketValues);
  const { notable, standard, minor } = json.thresholds.values;
  return {
    megacaps: overlayMembers(overlays, json.megacaps.overlay),
    overrides: Object.fromEntries(Object.entries(json.overrides.entries).map(([t, e]) => [t, e.tier])),
    thresholds: { notable, standard, minor },
    adamList: json.adamList.entries.map((e) => e.ticker),
    check,
  };
}

// Checks data/reference/calendar-report-times.json, the report times companies announced on their own sites (Adam, 2026-10-28:
// where Kiplinger has no lane, the company's website says what time the call is). Shape: { _about, entries: [...] }; an entry is
// either a time { ticker, date, timeEt, what, source, checked, stated? } or a stated lane { ticker, date, lane, stated, source,
// checked, what? }, never both: date the report day, timeEt "HH:MM" 24-hour New York time of the release or call as announced,
// what "release" or "call", lane "before" or "after" with stated the company's own words quoted, source the company page's URL,
// checked the day it was read. A bad entry throws, naming source, field and code; the same ticker and date listed twice with the
// same kind throws (two times for one announcement are a conflict to settle in the file).
// Returns the entries; lanes.js applyReportTimes places them and merge.js resolveLane turns each into a time or lane.
const TIMES_SRC = 'calendar-report-times';
export const REPORT_KINDS = ['release', 'call'];
export function validateReportTimes(json) {
  if (!isPlainObject(json)) fail(TIMES_SRC, 'file', json == null ? undefined : 'is not a JSON object');
  needText(json, '_about', TIMES_SRC);
  if (!('entries' in json)) fail(TIMES_SRC, 'entries');
  return validateReportTimeEntries(json.entries);
}

// The entries list alone (the file's, or the copy calendar-base.json carries to the page), checked the same way.
export function validateReportTimeEntries(entries) {
  if (!Array.isArray(entries)) fail(TIMES_SRC, 'entries', 'is not an array');
  const seen = new Set();
  entries.forEach((e, i) => {
    const where = `${TIMES_SRC} entry ${i}`;
    if (!isPlainObject(e)) fail(where, 'entry', 'is not an object');
    const ticker = needTicker(e.ticker, where, 'ticker');
    const date = needDate(e, 'date', where);
    const hasTime = 'timeEt' in e;
    const hasLane = 'lane' in e;
    if (hasTime === hasLane) failAs('CALENDAR_BAD_ENTRY', where, 'timeEt and lane', hasTime ? 'are both given; give a time or a stated lane' : 'are both missing; give a time or a stated lane');
    let kind;
    if (hasTime) {
      const t = needText(e, 'timeEt', where);
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) failAs('CALENDAR_BAD_TIME', where, 'timeEt', `is ${JSON.stringify(t)}, not a 24-hour HH:MM time`);
      kind = needText(e, 'what', where);
    } else {
      const lane = needText(e, 'lane', where);
      if (lane !== 'before' && lane !== 'after') failAs('CALENDAR_BAD_LANE', where, 'lane', `is ${JSON.stringify(lane)}, not before or after`);
      needText(e, 'stated', where);
      kind = 'lane';
    }
    if ('stated' in e) needText(e, 'stated', where);
    if ('what' in e && !REPORT_KINDS.includes(e.what)) failAs('CALENDAR_UNKNOWN_KIND', where, 'what', `is ${JSON.stringify(e.what)}, not one of ${REPORT_KINDS.join(', ')}`);
    const src = needText(e, 'source', where);
    let url = null;
    try { url = new URL(src); } catch { url = null; } // a source that is not a URL is the failure just below
    if (!url || !/^https?:$/.test(url.protocol)) failAs('CALENDAR_BAD_SOURCE', where, 'source', `is ${JSON.stringify(src)}, not the company page's http(s) URL`);
    needDate(e, 'checked', where);
    const id = `${ticker}|${date}|${kind}`;
    if (seen.has(id)) fail(where, 'entry', `repeats the ${kind} of ${ticker} on ${date}`);
    seen.add(id);
  });
  return entries;
}

// Checks data/reference/calendar-release-times.json, the official release times that win over TradingView's clock (Adam, 2026-10-29;
// econ.js applyReleaseTimes): { _about, entries: [{ title, timeEt, source, decided, weekdays?, note? }] }. title: a pattern (regular
// expression, case-insensitive) over TradingView's titles; timeEt: "HH:MM" 24-hour New York time as the agency publishes it; source:
// the http(s) page that publishes it; decided: the day the entry was set; weekdays (optional): the weekday names it holds on, for a
// release whose official time is given for one weekday with exceptions (EIA's Wednesday 10:30). A one-off date entry (review,
// 2026-10-29; econ.js applyReleaseDates) is { title, onDate, dateEt, timeEt?, source, decided, note? }: onDate the date TradingView
// gives, dateEt the official date, both real dates; it takes no weekdays. A bad entry throws, naming source, field and code. Returns
// the entries.
const RELEASE_SRC = 'calendar-release-times';
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export function validateReleaseTimes(json) {
  if (!isPlainObject(json)) fail(RELEASE_SRC, 'file', json == null ? undefined : 'is not a JSON object');
  needText(json, '_about', RELEASE_SRC);
  if (!('entries' in json)) fail(RELEASE_SRC, 'entries');
  return validateReleaseTimeEntries(json.entries);
}

// The entries list alone (the file's, or the copy calendar-base.json carries to the page), checked the same way.
export function validateReleaseTimeEntries(entries) {
  if (!Array.isArray(entries)) fail(RELEASE_SRC, 'entries', 'is not an array');
  entries.forEach((e, i) => {
    const where = `${RELEASE_SRC} entry ${i}`;
    if (!isPlainObject(e)) fail(where, 'entry', 'is not an object');
    compileTitle(needText(e, 'title', where), where);
    const oneOff = 'onDate' in e;
    if (oneOff) {
      needDate(e, 'onDate', where);
      needDate(e, 'dateEt', where);
      if ('weekdays' in e) fail(where, 'weekdays', 'applies only to a standing time entry, not a one-off date');
    } else if ('dateEt' in e) fail(where, 'onDate', 'is missing, and a one-off date (dateEt) needs it');
    const t = !oneOff || 'timeEt' in e ? needText(e, 'timeEt', where) : null;
    if (t != null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) failAs('CALENDAR_BAD_TIME', where, 'timeEt', `is ${JSON.stringify(t)}, not a 24-hour HH:MM time`);
    const src = needText(e, 'source', where);
    let url = null;
    try { url = new URL(src); } catch { url = null; } // a source that is not a URL is the failure just below
    if (!url || !/^https?:$/.test(url.protocol)) failAs('CALENDAR_BAD_SOURCE', where, 'source', `is ${JSON.stringify(src)}, not the publishing page's http(s) URL`);
    needDate(e, 'decided', where);
    if ('weekdays' in e) {
      const ok = Array.isArray(e.weekdays) && e.weekdays.length && e.weekdays.every((d) => WEEKDAY_NAMES.includes(d));
      if (!ok) fail(where, 'weekdays', `is not a non-empty list drawn from ${WEEKDAY_NAMES.join(', ')}`);
    }
    if ('note' in e) needText(e, 'note', where);
  });
  return entries;
}

function compileTitle(pattern, where) {
  try {
    return new RegExp(pattern, 'i');
  } catch (err) {
    return failAs('CALENDAR_BAD_PATTERN', where, 'title', `is not a valid pattern (${err.message})`);
  }
}

// Checks data/reference/calendar-events.json; throws with source, field and code on any fault, and returns the file.
export function validateEvents(json) {
  if (!isPlainObject(json)) fail(EVENTS_SRC, 'file', json == null ? undefined : 'is not a JSON object');
  needDate(json, 'decided', EVENTS_SRC);
  const feeds = needObject(json, 'feeds', EVENTS_SRC);
  for (const name of Object.keys(feeds)) {
    if (!Object.hasOwn(FEED_KINDS, name)) failAs('CALENDAR_UNKNOWN_FEED', `${EVENTS_SRC} feeds`, name, `is not a calendar feed (${Object.keys(FEED_KINDS).join(', ')})`);
  }
  const ids = new Set();
  for (const [name, kind] of Object.entries(FEED_KINDS)) {
    const where = `${EVENTS_SRC} feed ${name}`;
    const feed = needObject(feeds, name, `${EVENTS_SRC} feeds`);
    const k = needText(feed, 'kind', where);
    if (k !== kind) failAs('CALENDAR_UNKNOWN_KIND', where, 'kind', `is ${JSON.stringify(k)}; the ${name} parser gives "${kind}"`);
    needText(feed, 'comment', where);
    if (!('keep' in feed)) fail(where, 'keep');
    if (!Array.isArray(feed.keep) || !feed.keep.length) fail(where, 'keep', 'is not a non-empty list of rules');
    feed.keep.forEach((r, i) => {
      const rw = `${where} rule ${i}`;
      if (!isPlainObject(r)) fail(rw, 'rule', 'is not an object');
      const id = needText(r, 'id', rw);
      if (ids.has(id)) fail(rw, 'id', `${JSON.stringify(id)} is used twice`);
      ids.add(id);
      needText(r, 'what', rw);
      needText(r, 'basis', rw);
      compileTitle(needText(r, 'title', rw), rw);
      const em = needText(r, 'emphasis', rw);
      if (!EMPHASES.includes(em)) fail(rw, 'emphasis', `is ${JSON.stringify(em)}, not one of ${EMPHASES.join(', ')}`);
      for (const [key, m] of Object.entries(LIST_MATCHES)) {
        if (!(key in r)) continue;
        if (kind !== m.kind) fail(rw, key, `applies only to the ${m.feed} feed${m.feed.includes(' and ') ? 's' : ''}`);
        const list = r[key];
        const ok = Array.isArray(list) && list.length && list.every((x) => typeof x === 'string' && x.trim() && (!m.allowed || m.allowed.includes(x)));
        if (!ok) fail(rw, key, m.allowed ? `is not a list drawn from ${m.allowed.join(', ')}` : 'is not a non-empty list of text');
      }
      if ('exclude' in r) {
        if (kind !== 'auction') fail(rw, 'exclude', 'applies only to the treasury feed');
        if (!isPlainObject(r.exclude) || !Object.keys(r.exclude).length) fail(rw, 'exclude', 'is not a non-empty object');
        for (const [f, v] of Object.entries(r.exclude)) {
          if (!EXCLUDABLE.includes(f)) fail(rw, `exclude.${f}`, `is not one of ${EXCLUDABLE.join(', ')}`);
          if (typeof v !== 'string' || !v.trim()) fail(rw, `exclude.${f}`, 'is not text');
        }
      }
    });
  }
  if (!feeds.fed.keep.some((r) => r.id === APPEARANCE_RULE)) {
    fail(`${EVENTS_SRC} feed fed`, `rule ${APPEARANCE_RULE}`, undefined);
  }
  return json;
}

// One rule as a test on one event: the title pattern, every listed match, and no exclude hit.
function ruleTest(r) {
  const re = compileTitle(r.title, r.id);
  const lists = Object.entries(LIST_MATCHES).filter(([key]) => key in r).map(([key, m]) => [m.field, r[key]]);
  const excludes = Object.entries(r.exclude || {});
  return (e) => re.test(e.title) && lists.every(([f, list]) => list.includes(e[f])) && !excludes.some(([f, v]) => e[f] === v);
}

// D23 and D95: keeps the events one rule of their feed allows, each carrying that rule's emphasis; the rest come back in dropped
// as { feed, dateEt, title } so merge.js can count them per feed and day (D98: nothing leaves silently). An event of a kind no feed
// gives throws.
export function filterEvents(events, eventsConfig) {
  validateEvents(eventsConfig);
  if (!Array.isArray(events)) fail('calendar filter', 'events', events === undefined ? undefined : 'is not an array');
  const byFeed = new Map(Object.keys(FEED_KINDS).map((feed) => [feed, {
    feed, rules: eventsConfig.feeds[feed].keep.map((r) => ({ id: r.id, matches: ruleTest(r), emphasis: r.emphasis })),
  }]));
  const kept = [];
  const dropped = [];
  events.forEach((e, i) => {
    const where = `calendar filter event ${i}`;
    const f = byFeed.get(feedOf(e));
    if (!f) failAs('CALENDAR_UNKNOWN_KIND', where, 'kind', `is ${JSON.stringify(e?.kind)}, not one of ${Object.values(FEED_KINDS).join(', ')}`);
    if (typeof e.title !== 'string') fail(where, 'title', 'title' in e ? 'is not text' : undefined);
    const rule = f.rules.find((r) => r.matches(e));
    if (rule) kept.push({ ...e, emphasis: rule.emphasis, allowRule: rule.id });
    else dropped.push({ feed: f.feed, dateEt: e.dateEt, title: e.title });
  });
  return { kept, dropped };
}
