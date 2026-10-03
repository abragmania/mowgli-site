// D90 data switchboard: the pure resolver shared by the server, the tests and the browser (no Node imports).
//
//   resolve(catalog, settings, { type, page = 'company', absent = [], valuationBox })
//     → { page, type, boxes: [{ id, name, pin, expands, locked, groups, main, on, peek, forms }], headline, wanted }
//
// catalog  = data/reference/metric-catalog.json (or the lite copy GET /api/switchboard serves)
// settings = data/reference/switchboard.json (Adam's switches)
// type     = the company's type (catalog meta.vocab.types: ordinary, bank, insurer, reit)
// absent   = catalog ids this company has no data for: absentFrom(catalog, payload) reads them off the company
//            payload by each entry's payload paths; an absent item is not drawn and a substitute may stand in for it
// valuationBox = data/reference/financials.json valuationBox; needed only with the full catalog, whose valuation
//            entries point at valuationBox.measures[].suppressedFor instead of listing their types (the lite copy
//            has the types already derived by liteCatalog)
//
// Rules (catalog meta.rules; PROJECT.md Part 4 "D90 data switchboard: design"):
// - each field (state, form, order, spot, spotOrder) is taken from the catalog default, then settings.metrics[id],
//   then settings.byType[type][id]; the later one wins field by field
// - MAIN = in the box's main view; ON = only when the box is expanded; OFF = nowhere
// - not-built and dropped entries are never shown, whatever the settings ask (`wanted` lists the ones asked for)
// - an entry that does not apply to the type, or is absent for the company, is not shown
// - a substitute (substituteFor X) is hidden only where X is drawn: X MAIN hides it everywhere; X ON hides it from
//   the expanded view only, so a MAIN substitute still shows in the main view
// - locked entries cannot be switched OFF: a settings file that tries is refused
// - peek-only entries are drawn only in their box's peek; the peek walks box.peek in order: a shown item is kept;
//   an OFF item falls to the next MAIN item of kind number or item (peekable) not already in or named by the peek;
//   lead ruling 2026-10-02: an item that does not apply or has no data loses its slot instead of falling through
//   (matches today, e.g. a bank's empty Valuation peek), and so does a substitute hidden because its primary is drawn
// - items are ordered by their resolved order, ties by catalog position (stable)
// - the headline strip lists shown items with spot "hero", by spotOrder (unset last), ties by catalog position
// - bad input (unknown ids, fields, states, forms, types, box ids; a non-number order; settings for a dropped entry;
//   spot "hero" on a section; a pin under a not-built box or a pin cycle) throws SwitchboardError

export class SwitchboardError extends Error {
  constructor(errors) {
    super(`switchboard: ${errors.join('; ')}`);
    this.name = 'SwitchboardError';
    this.errors = errors;
  }
}

export const FIELDS = ['state', 'form', 'order', 'spot', 'spotOrder'];
const SETTINGS_KEYS = ['meta', 'boxes', 'metrics', 'byType', 'chart'];
const BOX_KEYS = ['order', 'pins'];
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const fin = (x) => typeof x === 'number' && Number.isFinite(x);
const SUPPRESSED = /valuationBox\.measures\[id=([\w-]+)\]\.suppressedFor/;

function index(catalog) {
  if (!isObj(catalog) || !Array.isArray(catalog.boxes) || !Array.isArray(catalog.metrics)) throw new SwitchboardError(['the catalog must have boxes and metrics arrays']);
  const boxes = new Map(catalog.boxes.map((b, i) => [b.id, { b, i }]));
  const metrics = new Map(catalog.metrics.map((m, i) => [m.id, { m, i }]));
  const vocab = catalog.meta?.vocab || {};
  return { boxes, metrics, types: vocab.types || [], states: vocab.state || ['MAIN', 'ON', 'OFF'] };
}

function checkEntry(ix, id, e, where, errs) {
  const hit = ix.metrics.get(id);
  if (!hit) { errs.push(`${where}: unknown metric "${id}"`); return; }
  if (!isObj(e)) { errs.push(`${where}.${id}: must be an object`); return; }
  const m = hit.m;
  for (const k of Object.keys(e)) if (!FIELDS.includes(k)) errs.push(`${where}.${id}: unknown field "${k}"`);
  if ('state' in e && !ix.states.includes(e.state)) errs.push(`${where}.${id}: state must be one of ${ix.states.join(', ')}`);
  if (m.status === 'dropped') errs.push(`${where}.${id}: dropped from the catalog, it takes no settings`);
  if (e.spot === 'hero' && m.kind === 'section') errs.push(`${where}.${id}: a section cannot go in the headline strip`);
  if (e.state === 'OFF' && m.locked) errs.push(`${where}.${id}: locked on, it cannot be switched OFF`);
  if ('form' in e && !(m.forms || []).includes(e.form)) errs.push(`${where}.${id}: form "${e.form}" is not one of ${(m.forms || []).join(', ')}`);
  if ('order' in e && !fin(e.order)) errs.push(`${where}.${id}: order must be a number`);
  if ('spot' in e && e.spot !== null && e.spot !== 'hero') errs.push(`${where}.${id}: spot must be "hero" or null`);
  if ('spotOrder' in e && e.spotOrder !== null && !fin(e.spotOrder)) errs.push(`${where}.${id}: spotOrder must be a number or null`);
}

// Every problem with a settings object, as plain lines; [] when it is good.
export function validateSettings(catalog, settings) {
  const ix = index(catalog);
  const errs = [];
  if (!isObj(settings)) return ['settings must be an object'];
  for (const k of Object.keys(settings)) if (!SETTINGS_KEYS.includes(k)) errs.push(`unknown top-level key "${k}"`);
  if ('meta' in settings && !isObj(settings.meta)) errs.push('meta must be an object');
  if ('chart' in settings && settings.chart !== null && !isObj(settings.chart)) errs.push('chart (reserved for phase 2) must be an object or null');
  const bx = settings.boxes;
  if (bx !== undefined) {
    if (!isObj(bx)) errs.push('boxes must be an object');
    else {
      for (const k of Object.keys(bx)) if (!BOX_KEYS.includes(k)) errs.push(`boxes: unknown key "${k}"`);
      if (bx.order !== undefined) {
        if (!Array.isArray(bx.order)) errs.push('boxes.order must be an array');
        else {
          for (const id of bx.order) if (!ix.boxes.has(id)) errs.push(`boxes.order: unknown box "${id}"`);
          if (new Set(bx.order).size !== bx.order.length) errs.push('boxes.order: a box is listed twice');
        }
      }
      if (bx.pins !== undefined) {
        if (!isObj(bx.pins)) errs.push('boxes.pins must be an object');
        else for (const [id, p] of Object.entries(bx.pins)) {
          if (!ix.boxes.has(id)) errs.push(`boxes.pins: unknown box "${id}"`);
          if (!isObj(p) || Object.keys(p).some((k) => k !== 'under') || !ix.boxes.has(p.under) || p.under === id) errs.push(`boxes.pins.${id}: must be {"under": <another box id>}`);
          else if (ix.boxes.get(p.under).b.status !== 'built') errs.push(`boxes.pins.${id}: "${p.under}" is not built`);
        }
        for (const id of Object.keys(bx.pins)) {
          const seen = new Set([id]);
          for (let x = bx.pins[id]?.under; x && bx.pins[x]; x = bx.pins[x]?.under) {
            if (seen.has(x)) { errs.push(`boxes.pins: ${id} is in a pin cycle`); break; }
            seen.add(x);
          }
        }
      }
    }
  }
  if (settings.metrics !== undefined) {
    if (!isObj(settings.metrics)) errs.push('metrics must be an object');
    else for (const [id, e] of Object.entries(settings.metrics)) checkEntry(ix, id, e, 'metrics', errs);
  }
  if (settings.byType !== undefined) {
    if (!isObj(settings.byType)) errs.push('byType must be an object');
    else for (const [t, o] of Object.entries(settings.byType)) {
      if (!ix.types.includes(t)) { errs.push(`byType: unknown company type "${t}"`); continue; }
      if (!isObj(o)) { errs.push(`byType.${t} must be an object`); continue; }
      for (const [id, e] of Object.entries(o)) checkEntry(ix, id, e, `byType.${t}`, errs);
    }
  }
  return errs;
}

// The company types an entry applies to: its own list, else derived from the valuation box's suppressedFor.
export function typesOf(m, types, valuationBox) {
  const a = m.appliesTo || {};
  if (Array.isArray(a.types)) return a.types;
  const vm = SUPPRESSED.exec(a.from || '');
  if (vm) {
    if (!valuationBox) throw new SwitchboardError([`${m.id}: its types come from valuationBox.suppressedFor; pass valuationBox or use the lite catalog`]);
    const meas = (valuationBox.measures || []).find((x) => x.id === vm[1]);
    if (!meas) throw new SwitchboardError([`${m.id}: valuationBox has no measure "${vm[1]}"`]);
    return types.filter((t) => !(meas.suppressedFor || []).includes(t));
  }
  return []; // e.g. an industry block with no mapping to Subs yet: applies nowhere
}

export function resolve(catalog, settings, ctx = {}) {
  const ix = index(catalog);
  const errs = validateSettings(catalog, settings);
  const { type, page = 'company', absent = [], valuationBox = null } = ctx || {};
  if (!ix.types.includes(type)) errs.push(`unknown company type "${type}"`);
  if (!catalog.boxes.some((b) => (b.page || 'company') === page)) errs.push(`no box on page "${page}"`);
  if (!Array.isArray(absent) || absent.some((x) => typeof x !== 'string')) errs.push('absent must be an array of catalog ids');
  if (errs.length) throw new SwitchboardError(errs);

  const gone = new Set(absent);
  const over = settings.byType?.[type] || {};
  const items = new Map();
  for (const [id, { m, i }] of ix.metrics) {
    const bx = ix.boxes.get(m.box)?.b;
    if (!bx || (bx.page || 'company') !== page) continue;
    const d = m.default || {};
    const r = { id, box: m.box, group: m.group, i, state: d.state || 'OFF', form: d.form ?? null, order: d.order ?? null, spot: d.spot ?? null, spotOrder: d.spotOrder ?? null };
    for (const src of [settings.metrics?.[id], over[id]]) if (src) for (const k of FIELDS) if (k in src) r[k] = src[k];
    r.peekOnly = !!m.peekOnly;
    r.peekable = m.kind === 'number' || m.kind === 'item';
    r.built = m.status === 'built' && bx.status === 'built';
    r.live = r.built && typesOf(m, ix.types, valuationBox).includes(type) && !gone.has(id);
    r.shown = r.live && r.state !== 'OFF';
    items.set(id, r);
  }
  // a substitute is hidden where its primary is drawn (primary MAIN: everywhere; primary ON: the expanded view)
  for (const r of items.values()) {
    const p = items.get(ix.metrics.get(r.id).m.substituteFor);
    if (!r.shown || !p?.shown) continue;
    if (p.state === 'MAIN' || r.state === 'ON') { r.shown = false; r.live = false; }
  }
  const byOrder = (a, b) => (fin(a.order) ? a.order : Infinity) - (fin(b.order) ? b.order : Infinity) || a.i - b.i;

  const pins = settings.boxes?.pins || {};
  const listed = (settings.boxes?.order || []).filter((id) => ix.boxes.has(id));
  const rest = [...ix.boxes.values()].filter(({ b }) => !listed.includes(b.id))
    .sort((a, b) => (fin(a.b.order) ? a.b.order : Infinity) - (fin(b.b.order) ? b.b.order : Infinity) || a.i - b.i).map(({ b }) => b.id);
  const boxes = [];
  for (const id of [...listed, ...rest]) {
    const bx = ix.boxes.get(id).b;
    if (bx.status !== 'built' || (bx.page || 'company') !== page) continue;
    const its = [...items.values()].filter((r) => r.box === id && r.shown).sort(byOrder);
    const main = its.filter((r) => r.state === 'MAIN' && !r.peekOnly).map((r) => r.id);
    const on = its.filter((r) => r.state === 'ON' && !r.peekOnly).map((r) => r.id);
    const named = new Set(bx.peek || []);
    const spare = its.filter((r) => r.state === 'MAIN' && !r.peekOnly && r.peekable && !named.has(r.id)).map((r) => r.id);
    const peek = [];
    for (const pid of bx.peek || []) {
      const r = items.get(pid);
      if (!r || !r.live) continue;
      if (r.shown) { if (!peek.includes(pid)) peek.push(pid); continue; }
      const next = spare.find((x) => !peek.includes(x));
      if (next) peek.push(next);
    }
    if (!main.length && !on.length && !peek.length && !bx.locked) continue; // an empty box is absent
    boxes.push({
      id, name: bx.name ?? null, pin: pins[id]?.under ?? null, expands: bx.expands !== false, locked: !!bx.locked,
      groups: (bx.groups || []).filter((g) => its.some((r) => r.group === g.id && !r.peekOnly)).map((g) => ({ id: g.id, name: g.name ?? null })),
      main, on, peek,
      forms: Object.fromEntries(its.map((r) => [r.id, r.form])),
    });
  }
  const headline = [...items.values()].filter((r) => r.shown && r.spot === 'hero')
    .sort((a, b) => (fin(a.spotOrder) ? a.spotOrder : Infinity) - (fin(b.spotOrder) ? b.spotOrder : Infinity) || a.i - b.i).map((r) => r.id);
  const wanted = [...items.values()].filter((r) => !r.built && r.state !== 'OFF').map((r) => r.id);
  return { page, type, boxes, headline, wanted };
}

// The catalog as the browser needs it: no definitions or notes, and every entry's types spelled out (valuation
// measures' types derived from valuationBox.suppressedFor, so the browser never needs financials.json).
export function liteCatalog(catalog, valuationBox) {
  const ix = index(catalog);
  const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
  return {
    meta: { vocab: catalog.meta?.vocab || {}, rules: catalog.meta?.rules || [] },
    providers: catalog.providers || {},
    boxes: catalog.boxes.map((b) => pick(b, ['id', 'name', 'page', 'status', 'locked', 'order', 'peek', 'groups', 'placement', 'expands'])),
    metrics: catalog.metrics.map((m) => ({
      ...pick(m, ['id', 'box', 'group', 'label', 'kind', 'forms', 'series', 'status', 'computed', 'locked', 'peekOnly', 'substituteFor', 'substituteWhen', 'codeId', 'payload', 'default']),
      appliesTo: { types: typesOf(m, ix.types, valuationBox), ...pick(m.appliesTo || {}, ['when', 'except', 'industry', 'unresolved']) },
      source: pick(m.source || {}, ['provider', 'field', 'periods']),
    })),
  };
}

// The catalog ids a company payload has no data for: a built entry whose payload paths (catalog `payload`, e.g.
// "hq", "fin.tile.cells[id=netMargin]", "valuationInputs.box.measures[id=pe]") all lead to nothing (missing, null,
// false, an empty string or an empty list). Entries with no payload path (the live price, the trends chart) are never absent.
export function absentFrom(catalog, payload) {
  index(catalog);
  const step = (o, part) => {
    if (o == null) return undefined;
    const m = /^([\w$]+)(?:\[id=([^\]]+)\])?$/.exec(part);
    if (!m) throw new SwitchboardError([`bad payload path part "${part}"`]);
    const v = o[m[1]];
    return m[2] === undefined ? v : Array.isArray(v) ? v.find((x) => x?.id === m[2]) : undefined;
  };
  const at = (p) => p.split('.').reduce(step, payload);
  const has = (v) => !(v == null || v === false || v === '' || (Array.isArray(v) && !v.length));
  return catalog.metrics.filter((m) => m.status === 'built' && (m.payload || []).length && !m.payload.some((p) => has(at(p)))).map((m) => m.id);
}
