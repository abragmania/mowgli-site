// Headline metrics for the company page: pure functions over one company's compact financials.json
// (format in server/lib/financials/output.js) plus, for the price-dependent figures, a live price.
// Rules (spec, ACCOUNTING.md A3, A4, A9, A16; data/reference/financials.json periodRules and
// negativeBaseRules): a missing input makes the figure missing (null), never zero; TTM is the sum of the
// last four contiguous quarters, else the latest fiscal year labelled FY, never a mix of the two.

const DAY = 86400000;
const qKey = (fy, fq) => `FY${fy} Q${fq}`;

// ---------- periods and sources ----------

export function periodKey(v, instant = false) {
  return (instant ? 'end of ' : '') + `FY${v.fy}` + (v.fq != null ? ` Q${v.fq}` : v.fh != null ? ` H${v.fh}` : '');
}

// Real start and end dates of a value: its own when it carries them, else the file's periods table.
export function periodOf(fin, lineId, v) {
  const inst = fin.lines?.[lineId]?.kind === 'instant';
  const d = fin.periods?.[periodKey(v, inst)] || {};
  return { start: v.start || d.start || null, end: v.end || d.end || null };
}

// Human period label: calendar-year filers say "Q2 2026" / "FY2025"; others say "Q2 FY2027".
export function periodLabel(fin, v) {
  const cal = String(fin.meta?.fiscalYearEnd || '') === '1231';
  if (v.fq != null) return cal ? `Q${v.fq} ${v.fy}` : `Q${v.fq} FY${v.fy}`;
  if (v.fh != null) return cal ? `H${v.fh} ${v.fy}` : `H${v.fh} FY${v.fy}`;
  return `FY${v.fy}`;
}

// Where one stored value came from: form, filing date, accession, tag, period.
export function sourceOf(fin, lineId, v) {
  const line = fin.lines?.[lineId];
  const filing = fin.filings?.[v.f] || {};
  const p = periodOf(fin, lineId, v);
  const src = {
    form: filing.form || null, filed: filing.filed || null, accn: filing.accn || null,
    tag: line?.tags?.[v.tag || 0] || null, period: periodLabel(fin, v), start: p.start, end: p.end,
  };
  if (v.derived) src.derivedFrom = (v.derivedFrom || []).map((i) => fin.filings?.[i]).filter(Boolean).map((x) => ({ form: x.form, filed: x.filed, accn: x.accn }));
  if (v.splitFactor != null && v.splitFactor !== 1) { src.splitFactor = v.splitFactor; src.asFiled = v.asFiled ?? null; }
  if (v.combined) src.combined = v.combined;
  return src;
}

export function sourceText(s) {
  if (!s) return '';
  const when = s.start && s.end ? ` (${s.start} to ${s.end})` : s.end ? ` (at ${s.end})` : '';
  let t = `${s.period}${when} · ${s.form || 'form ?'} filed ${s.filed || '?'} · accession ${s.accn || '?'}${s.tag ? ' · ' + s.tag : ''}`;
  if (s.derivedFrom?.length) t += ` · derived by subtracting year-to-date figures (${s.derivedFrom.map((x) => `${x.form} ${x.filed}`).join(', ')})`;
  if (s.splitFactor) t += ` · split-adjusted; filed as ${s.asFiled}`;
  if (s.combined) t += ` · ${s.combined}`;
  return t;
}

// ---------- series ----------

const hasValue = (v) => v && typeof v.value === 'number' && Number.isFinite(v.value);

export function annualMap(fin, id) {
  const m = new Map();
  for (const v of fin.lines?.[id]?.annual || []) if (hasValue(v)) m.set(v.fy, v);
  return m;
}

export function quarterMap(fin, id) {
  const m = new Map();
  for (const v of fin.lines?.[id]?.quarterly || []) if (hasValue(v)) m.set(qKey(v.fy, v.fq), v);
  return m;
}

const nextQ = ({ fy, fq }) => (fq === 4 ? { fy: fy + 1, fq: 1 } : { fy, fq: fq + 1 });
const prevQ = ({ fy, fq }) => (fq === 1 ? { fy: fy - 1, fq: 4 } : { fy, fq: fq - 1 });

// The company's latest quarter and latest fiscal year over its income and cash-flow lines.
export function reference(fin) {
  let q = null, fy = null;
  for (const l of Object.values(fin.lines || {})) {
    if (l.kind !== 'duration') continue;
    for (const v of l.quarterly || []) if (hasValue(v) && (!q || v.fy > q.fy || (v.fy === q.fy && v.fq > q.fq))) q = { fy: v.fy, fq: v.fq };
    for (const v of l.annual || []) if (hasValue(v) && (fy == null || v.fy > fy)) fy = v.fy;
  }
  return { q, fy };
}

// The four quarters ending at `ref` for one line, if all present and contiguous in time.
export function lastFourQuarters(fin, id, ref) {
  if (!ref) return null;
  const qm = quarterMap(fin, id);
  const out = [];
  let k = ref;
  for (let i = 0; i < 4; i++) { const v = qm.get(qKey(k.fy, k.fq)); if (!v) return null; out.unshift(v); k = prevQ(k); }
  for (let i = 1; i < 4; i++) {
    const a = periodOf(fin, id, out[i - 1]).end, b = periodOf(fin, id, out[i]).start;
    if (!a || !b) return null;
    const gap = (Date.parse(b) - Date.parse(a)) / DAY;
    if (!(gap >= 0 && gap <= 4)) return null;
  }
  return out;
}

// Same-basis values for several lines: TTM (all at the company's latest quarter) or else the latest
// fiscal year (all present), or null. Never mixes a TTM value with a fiscal-year one.
export function sameBasis(fin, ids, ref = reference(fin)) {
  const quarterly = fin.meta?.cadence !== 'halves';
  if (quarterly && ref.q) {
    const parts = {};
    let ok = true;
    for (const id of ids) { const four = lastFourQuarters(fin, id, ref.q); if (!four) { ok = false; break; } parts[id] = four; }
    // a TTM that ends before the latest fiscal year would be stale
    if (ok && ref.fy != null) {
      const endQ = periodOf(fin, ids[0], parts[ids[0]][3]).end;
      const fyV = annualMap(fin, ids[0]).get(ref.fy);
      const endFy = fyV ? periodOf(fin, ids[0], fyV).end : null;
      if (endFy && endQ && endQ < endFy) ok = false;
    }
    if (ok) {
      const values = {}, sources = {};
      for (const id of ids) {
        values[id] = parts[id].reduce((s, v) => s + v.value, 0);
        sources[id] = parts[id].map((v) => sourceOf(fin, id, v));
      }
      const last = parts[ids[0]][3];
      return { basis: 'TTM', label: `TTM to ${periodLabel(fin, last)}`, end: periodOf(fin, ids[0], last).end, values, sources };
    }
  }
  if (ref.fy == null) return null;
  const values = {}, sources = {};
  for (const id of ids) {
    const v = annualMap(fin, id).get(ref.fy);
    if (!v) return null;
    values[id] = v.value; sources[id] = [sourceOf(fin, id, v)];
  }
  const any = annualMap(fin, ids[0]).get(ref.fy);
  return { basis: 'FY', label: periodLabel(fin, any), end: periodOf(fin, ids[0], any).end, values, sources };
}

// ---------- arithmetic with the negative-base rules ----------

// Growth from prev to cur. Positive base: a percentage. Zero or negative base, or a profit turning
// into a loss: words plus the absolute change (negativeBaseRules.growth). Missing input: null.
export function growth(cur, prev) {
  if (typeof cur !== 'number' || typeof prev !== 'number' || !Number.isFinite(cur) || !Number.isFinite(prev)) return null;
  const change = cur - prev;
  if (prev > 0 && cur >= 0) return { pct: (change / prev) * 100, change };
  let words;
  if (prev > 0 && cur < 0) words = 'profit to loss';
  else if (prev < 0 && cur > 0) words = 'loss to profit';
  else if (prev < 0 && cur === 0) words = 'loss to break-even';
  else if (prev < 0 && cur < 0) words = cur > prev ? 'loss narrowed' : cur < prev ? 'loss widened' : 'loss unchanged';
  else words = cur > 0 ? 'up from zero' : cur < 0 ? 'zero to loss' : 'unchanged at zero';
  return { words, change };
}

// Compound annual growth; needs positive values at both ends (negativeBaseRules.cagr).
export function cagr(first, last, years) {
  if (typeof first !== 'number' || typeof last !== 'number' || !(years > 0)) return null;
  if (!(first > 0) || !(last > 0)) return { nm: true, reason: 'needs positive values at both ends' };
  return { pct: (Math.pow(last / first, 1 / years) - 1) * 100 };
}

// num ÷ den as a percentage; a zero or negative denominator is n.m. (negativeBaseRules.general).
export function margin(num, den) {
  if (typeof num !== 'number' || typeof den !== 'number') return null;
  if (!(den > 0)) return { nm: true, reason: 'revenue is zero or negative' };
  return { pct: (num / den) * 100 };
}

// A4: operating cash flow − capex − stock-based compensation; any input missing → null.
export function cashEarnings(ocf, capex, sbc) {
  if ([ocf, capex, sbc].some((x) => typeof x !== 'number' || !Number.isFinite(x))) return null;
  return ocf - Math.abs(capex) - Math.abs(sbc);
}

// A3: gross profit as reported, or revenue − cost of revenue when both are reported (labelled computed).
export function grossProfitFor(reported, revenue, cost) {
  if (typeof reported === 'number') return { value: reported, computed: false };
  if (typeof revenue === 'number' && typeof cost === 'number') return { value: revenue - cost, computed: true };
  return null;
}

// ---------- shares and price-dependent figures ----------

// Latest combined share count: the later of the cover-page and balance-sheet counts (D61, A16).
export function latestShares(fin) {
  let best = null;
  for (const id of ['sharesOutstandingCover', 'sharesOutstandingBalance']) {
    const l = fin.lines?.[id];
    if (!l) continue;
    for (const v of [...(l.annual || []), ...(l.quarterly || [])]) {
      if (!hasValue(v) || !(v.value > 0)) continue;
      const date = periodOf(fin, id, v).end;
      if (!date) continue;
      if (!best || date > best.date) best = { value: v.value, date, line: id, source: sourceOf(fin, id, v), classes: v.classes || null, combined: v.combined || null };
    }
  }
  return best;
}

// Price per ordinary share: an ADS price divided by the shares each ADS represents.
export function pricePerShare(price, sharesPerADS) {
  if (typeof price !== 'number' || !(price > 0)) return null;
  return sharesPerADS > 0 ? price / sharesPerADS : price;
}

export function marketValue(price, shares, sharesPerADS = null) {
  const pps = pricePerShare(price, sharesPerADS);
  if (pps == null || !(shares > 0)) return null;
  return pps * shares;
}

// Dividend yield. A declared per-share rate in the profile wins (annualised only from the stated rate);
// otherwise dividends paid over the same basis as TTM ÷ market value. Currencies must match.
export function dividendYield({ declared = null, paid = null, marketValue: mv = null, pricePerShare: pps = null, sameCurrency = true }) {
  if (!sameCurrency) return null;
  if (declared && declared.annual > 0 && pps > 0) return { pct: (declared.annual / pps) * 100, basis: 'declared', annual: declared.annual };
  if (paid && typeof paid.value === 'number' && paid.value > 0 && mv > 0) return { pct: (paid.value / mv) * 100, basis: paid.basis };
  return null;
}

// Declared annual dividend per share from a profile's capitalReturn.dividend: only numeric stated rates.
export function declaredDividend(div) {
  if (!div || typeof div !== 'object') return null;
  if (typeof div.annualized === 'number' && div.annualized > 0) return { annual: div.annualized, from: 'annualized', quarterly: typeof div.quarterly === 'number' ? div.quarterly : null };
  if (typeof div.quarterly === 'number' && div.quarterly > 0) return { annual: div.quarterly * 4, from: 'quarterly × 4', quarterly: div.quarterly };
  return null;
}

export function buybackYieldPrev(buybacks, mv, sameCurrency = true) {
  if (!sameCurrency || !buybacks || typeof buybacks.value !== 'number' || !(mv > 0)) return null;
  return { pct: (Math.abs(buybacks.value) / mv) * 100, basis: buybacks.basis };
}

const MONTH = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?';
const DATE = `(${MONTH} \\d{1,2},? \\d{4}|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}/\\d{1,2}/\\d{4})`;

export function parseDate(s) {
  if (!s) return null;
  const t = Date.parse(s.replace(/\./g, '').replace(/^Sept/, 'Sep'));
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
}

function parseAmount(num, unit) {
  const n = Number(num.replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  const u = unit.toLowerCase();
  return n * (u.startsWith('b') ? 1e9 : u.startsWith('m') ? 1e6 : 1);
}

// A remaining buyback authorisation stated in a profile's text: the amount at the latest "at <date>" and
// an expiry ("expires/expiring/ends <date>"). Without an expiry the authorisation is undated → null.
export function parseAuthorisation(text) {
  if (typeof text !== 'string' || !text) return null;
  const amtRe = new RegExp(`\\$\\s?([\\d,]+(?:\\.\\d+)?)\\s?(billion|million|B|M)\\b[^;$]*?\\b(?:at|as of)\\s+${DATE}`, 'gi');
  let best = null;
  for (const m of text.matchAll(amtRe)) {
    const asOf = parseDate(m[3]);
    const amount = parseAmount(m[1], m[2]);
    if (amount && asOf && (!best || asOf > best.asOf)) best = { amount, asOf };
  }
  const exp = text.match(new RegExp(`\\b(?:expir\\w*|ends?|through)\\s+(?:on\\s+)?${DATE}`, 'i'));
  const expiry = exp ? parseDate(exp[1]) : null;
  if (!best || !expiry) return null;
  return { ...best, expiry };
}

// ---------- valuation box (D86) ----------

// One measure of data/reference/financials.json valuationBox.measures from its inputs. inputs[name] is a number
// or {missing: reason}. Returns {v} (multiple), {pct} (yield), {nm: true, reason} or {missing: true, reason}.
export function boxMeasure(m, inputs) {
  if (m.forcedNm) return { nm: true, reason: m.forcedNm };
  const num = inputs[m.numerator], den = inputs[m.denominator];
  for (const [x, k] of [[num, m.numerator], [den, m.denominator]]) {
    if (typeof x !== 'number' || !Number.isFinite(x)) return { missing: true, reason: (x && x.missing) || `${k} is not available` };
  }
  const rules = m.nm || [];
  if (rules.includes('denominatorNotPositive') && !(den > 0)) return { nm: true, reason: m.nmReason?.denominatorNotPositive || 'the denominator is zero or negative' };
  if (rules.includes('numeratorNotPositive') && !(num > 0)) return { nm: true, reason: m.nmReason?.numeratorNotPositive || 'the numerator is zero or negative' };
  if (den === 0) return { nm: true, reason: 'divides by zero' };
  return m.kind === 'yield' ? { pct: (num / den) * 100 } : { v: num / den };
}

// Today's figures of a valuation box (server/lib/valuation_box.js buildValuationBox) at a live price per share
// and market value: {status, basis, measures: [{id, v|pct|nm|missing, reason?}]}.
export function valuationBoxNow(box, pps, mv) {
  if (!box) return null;
  if (box.status !== 'ok') return { status: box.status, reason: box.reason || null };
  const ev = box.ev?.missing ? { missing: box.ev.missing } : typeof mv === 'number' ? mv + box.ev.net : { missing: 'no market value' };
  const inputs = { ...box.flows, price: typeof pps === 'number' ? pps : { missing: 'no price' }, marketValue: typeof mv === 'number' ? mv : { missing: 'no market value' }, ev };
  return { status: 'ok', basis: box.basis, evValue: typeof ev === 'number' ? ev : null, measures: box.measures.map((m) => ({ id: m.id, ...boxMeasure(m, inputs) })) };
}

// "Next 12" buyback yield (D53): a dated authorisation ÷ market value. Expiring within 12 months of
// `today`: a percentage. Window longer than 12 months: the amount with its window, no percentage.
export function buybackYieldNext(auth, mv, today) {
  if (!auth || !(mv > 0) || !today) return null;
  if (auth.expiry < today) return null;
  const limit = new Date(Date.parse(today) + 366 * DAY).toISOString().slice(0, 10);
  if (auth.expiry <= limit) return { pct: (auth.amount / mv) * 100, amount: auth.amount, asOf: auth.asOf, expiry: auth.expiry };
  return { pct: null, amount: auth.amount, asOf: auth.asOf, expiry: auth.expiry, longWindow: true };
}

// ---- valuation(), copied from server/lib/company.js by server/publish/build.js ----
const M = { pricePerShare, marketValue, sourceText, valuationBoxNow, dividendYield, buybackYieldPrev, buybackYieldNext };
export function valuation(inputs, price, today = new Date().toISOString().slice(0, 10)) {
  if (!inputs || typeof price !== 'number') return null;
  const sameCurrency = inputs.statementsCurrency === inputs.priceCurrency;
  const pps = M.pricePerShare(price, inputs.sharesPerADS);
  const mv = inputs.shares ? M.marketValue(price, inputs.shares.value, inputs.sharesPerADS) : null;
  const out = { marketValue: null, dividendYield: null, buybackPrev: null, buybackNext: null };
  if (mv != null) {
    out.marketValue = {
      v: mv, currency: inputs.priceCurrency,
      src: `Price ${inputs.sharesPerADS ? `per ADS ÷ ${inputs.sharesPerADS} shares per ADS ` : ''}× ${inputs.shares.value.toLocaleString('en-US')} shares at ${inputs.shares.date}` +
        `${inputs.shares.combined ? ` (${inputs.shares.combined})` : ''}\n${M.sourceText(inputs.shares.source)}`,
      sharesDate: inputs.shares.date,
    };
  }
  // D86: today's multiples and yields (the box itself says when the statements' currency blocks them)
  if (inputs.box) out.valuationBox = M.valuationBoxNow(inputs.box, pps, mv);
  if (!sameCurrency) {
    const why = `Statements are in ${inputs.statementsCurrency}, the price in ${inputs.priceCurrency}; no currency conversion yet, so this is not computed.`;
    out.dividendYield = { na: true, src: why };
    out.buybackPrev = { na: true, src: why };
    return out;
  }
  const dy = M.dividendYield({ declared: inputs.declaredDividend, paid: inputs.dividendsPaid, marketValue: mv, pricePerShare: pps, sameCurrency });
  if (dy) {
    out.dividendYield = dy.basis === 'declared'
      ? { pct: dy.pct, src: `Declared $${inputs.declaredDividend.annual.toFixed(2)} a year per share (${inputs.declaredDividend.from}; ${inputs.declaredDividend.source}) ÷ today's price` }
      : { pct: dy.pct, src: `Dividends paid, ${inputs.dividendsPaid.label}, ÷ market value\n${inputs.dividendsPaid.src}` };
  }
  const bp = M.buybackYieldPrev(inputs.buybacks, mv, sameCurrency);
  if (bp) out.buybackPrev = { pct: bp.pct, src: `Buybacks, ${inputs.buybacks.label}, ÷ market value\n${inputs.buybacks.src}` };
  const bn = M.buybackYieldNext(inputs.authorisation, mv, today);
  if (bn) out.buybackNext = { ...bn, src: `Remaining authorisation $${(bn.amount / 1e6).toLocaleString('en-US', { maximumFractionDigits: 0 })}M at ${bn.asOf}, expires ${bn.expiry}${bn.longWindow ? ' (window longer than 12 months, so no yield is shown)' : ''} ÷ market value. Profile: ${inputs.authorisationText}` };
  else if (inputs.authorisationText) out.buybackNextNote = `No dated authorisation stated. Profile: ${inputs.authorisationText}`;
  return out;
}
