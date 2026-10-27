// Importance tier for one earnings report (R3: importance sets size). Pure. The config comes in as an argument, built from
// data/reference/calendar-tiers.json by config.js resolveTiersConfig. Config: { megacaps: [tickers], overrides: { TICKER: tier },
// thresholds: { notable, standard, minor } in dollars, adamList: [tickers] (optional) }.
import { fail } from './times.js';

// Display order, most important first; only these may be set by an override.
export const TIERS = ['headliner', 'notable', 'standard', 'minor'];

export function checkTierConfig(config) {
  const where = 'calendar tiers config';
  if (!config || typeof config !== 'object') fail(where, 'config');
  if (!Array.isArray(config.megacaps)) fail(where, 'megacaps', 'is not an array');
  if (!config.overrides || typeof config.overrides !== 'object' || Array.isArray(config.overrides)) fail(where, 'overrides', 'is not an object');
  for (const [t, tier] of Object.entries(config.overrides)) {
    if (!TIERS.includes(tier)) fail(where, `override for ${t}`, `is ${JSON.stringify(tier)}, not one of ${TIERS.join(', ')}`);
  }
  const th = config.thresholds || {};
  for (const k of ['notable', 'standard', 'minor']) {
    if (typeof th[k] !== 'number' || !Number.isFinite(th[k]) || th[k] <= 0) fail(where, `thresholds.${k}`, 'is not a positive number');
  }
  if (!(th.notable > th.standard && th.standard > th.minor)) fail(where, 'thresholds', 'must fall notable > standard > minor');
  if (config.adamList !== undefined && !(Array.isArray(config.adamList) && config.adamList.every((t) => typeof t === 'string'))) {
    fail(where, 'adamList', 'is not an array of tickers');
  }
  return config;
}

function valueTier(marketValue, th) {
  if (marketValue == null) return 'unknown';
  if (marketValue >= th.notable) return 'notable';
  if (marketValue >= th.standard) return 'standard';
  if (marketValue >= th.minor) return 'minor';
  return 'below-floor';
}

// R3: override first, then the Megacaps group as Headliner, then market value. Below the minor line is "below-floor"; a missing
// market value is "unknown", never read as zero (D99). tickers lists every class ticker of a merged company (D61), lead first.
// Adam's list (calendar-tiers.json adamList) lifts a company to at least Notable; an override or the Megacaps group still decides.
// R3: a known value under the floor stays "below-floor" even on Adam's list, since the floor keeps it off the page.
export function tierFor({ ticker, tickers, marketValue }, config) {
  checkTierConfig(config);
  const all = tickers && tickers.length ? tickers : [ticker];
  for (const t of all) if (Object.hasOwn(config.overrides, t)) return config.overrides[t];
  if (all.some((t) => config.megacaps.includes(t))) return 'headliner';
  const tier = valueTier(marketValue, config.thresholds);
  if (tier === 'notable' || tier === 'below-floor') return tier;
  if (config.adamList && all.some((t) => config.adamList.includes(t))) return 'notable';
  return tier;
}
