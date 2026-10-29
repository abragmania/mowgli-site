/* The Calendar page's layout math, split out of calendar.js (file ceiling) and used by it as an ES module (the site copies every public file;
   RULES.md R3 and PROJECT.md Part 4 "Calendar build" give the rules). The pure parts (squarify, capBoxes, tileMapH, rowsRem, the fold and
   minimum-size rules, laneBand) take plain values. The parts that draw or measure take H, the page's host object:
     H.L      layout state { TM, TMD, LIM, LIMD, TFD, FOLD, HFOLD, FITTING, RF, RP, Z, VW, VH, XB }
     H.R, H.XV  the rows and economic events on show
     H.root() the week element; H.days(), H.fday(); H.build(D, focus); H.splitZ(d, b, X); H.itemsOf(d, b, X)
     H.arOf, H.hasLogo, H.logoA, H.fv, H.fx, H.tmh, H.tmx, H.esc   the page's small view helpers
   Nothing here reads the page's closure. */

export const ZN = ['am', 'mk', 'pm', 'nt'];
/* A day's boxes never scale below this share of the design's floors: below it a box cannot hold its ticker and value at the minimum text size,
   so the smallest boxes fold into the lane's rows instead of shrinking (Adam, 2026-10-28, visual-qa finding 1) */
export const MINTF = .5;
/* the last resort when only headliners and $500B+ boxes are left in a day that is still too tall */
export const MINTF_HARD = .36;
/* Minimum readable text on the page (rem, before the laptop factor RF): the row text size for words and numbers, the row tag size for tags and badges */
export const MIN_TEXT_REM = .68, MIN_TAG_REM = .58; /* tags: about 9px on the laptop, 10px on the desktop */
export const minText = (RF) => MIN_TEXT_REM * RF;
export const minTag = (RF) => MIN_TAG_REM * RF;
export const TILE_FLOOR_REM2 = { x: 30, 1: 66, 2: 17 };
/* a red economic tile follows the day's box scale only down to this share of its floor: at its minimum text size it still shows title, time and tag in full */
export const X_MIN_TF = .45;
/* the biggest box: no earnings box takes more than this many times the area of a typical Notable box in its lane (Adam, 2026-10-28), so a $3.9T company
   stops growing past it and the space goes to more boxes and rows; order by importance is unchanged (a bigger company is never smaller) */
export const TILE_CAP = 4;
/* the narrowest an earnings box may be (rem) before it counts as a sliver and folds into the rows */
export const MIN_BOX_SIDE = 3.4;
/* a lane with this many earnings rows or fewer is never cut into a "+N more" button (a cut keeps MIN_KEEP rows and its button must hide at least three) */
export const MIN_CUT_LANE = 3;
/* A guard, not the way boxes fold: the settle loop (calendar.js settleTiles) folds every box that fits no variant into its lane's rows, so none is ever empty. If one
   still is, it is removed so no blank box shows, and said in the console (its company would have no box and no row); returns how many. */
export function sweepEmpty(root, warn = (m) => console.warn(m)) {
  let n = 0;
  root.querySelectorAll('.tmap:not([data-mini]) .tl[data-rk]').forEach((el) => { if (!el.innerHTML.trim()) { warn(`calendar: box ${el.dataset.rk} had no content and was removed (${el.title})`); el.remove(); n++; } });
  return n;
}

/* ---------- pure rules ---------- */
/* An earnings box's weight (area share). A Notable or headliner has weight from its market value: the square root of the value in $B, headliners 1.6 times that.
   A missing value (an override, Megacaps or Adam's list can make a company a box without one) takes its tier's floor value, so it still gets a real box (shown as n/a),
   never weight 0. Rows (tiers 3 and 4) keep the old weights, which only order them. */
export const NULL_VALUE_FLOOR = { 1: 200, 2: 50 };
const ROW_WEIGHT = { 1: 17, 2: 9.5, 3: 5.2, 4: 3.6 };
const capf = (c) => (c == null ? .8 : .8 + .4 * Math.max(0, Math.min(1, (Math.log10(c) - .5) / 3.1)));
export const earnWeight = (r) => (r.lvl <= 2 ? Math.sqrt(r.c ?? NULL_VALUE_FLOOR[r.lvl]) * (r.lvl == 1 ? 1.6 : 1) : ROW_WEIGHT[r.lvl] * capf(r.c));
/* a company of this value (in $B) or more is never folded to fit the height unless the page would otherwise scroll (R3) */
export const BIG_VALUE = 500;
/* a box too narrow to show its text at a readable size (a headliner and a $500B+ company are exempt: they never fold for this) */
export const isSliver = (r, wR, hR) => r.lvl > 1 && !(r.c >= BIG_VALUE) && Math.min(wR, hR) < MIN_BOX_SIDE;
/* boxes that may fold into the lane's rows, and their order from least to most important: capped weight, then true market value (a tie on the cap never
   folds the bigger company first; R3) */
export const foldableTile = (t, last = false) => t.k == 'e' && t.r.lvl > 1 && (last || !(t.r.c >= BIG_VALUE));
export const byImportance = (a, b) => a.v - b.v || (a.r.c ?? 0) - (b.r.c ?? 0);
/* what a settle round folds: the failing boxes of a lane fold together with every smaller foldable box of that lane, so a bigger company is never folded while a
   smaller one keeps its box; returns the row keys (pure) */
export function foldFailed(tiles, failed) {
  const f = tiles.filter((t) => foldableTile(t)).sort(byImportance); let top = -1;
  f.forEach((o, i) => { if (failed.has(o.r.k)) top = i; });
  return top < 0 ? [] : f.slice(0, top + 1).map((o) => o.r.k);
}
/* the settle loop goes round again only while the last round folded a new box or changed a red-tile room, and not past `max` rounds */
export const settleAgain = (added, xbChanged, round, max = 12) => (added > 0 || xbChanged) && round < max;
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0; };
/* weights of a lane's boxes: first the size cap (TILE_CAP times the median Notable box, when the lane has one), then no box takes more than about 30%
   of its lane's box area: a giant's weight is capped (only in a lane of four or more boxes, where 30% is possible) */
export function capBoxes(tiles) {
  const typical = median(tiles.filter((o) => o.k == 'e' && o.r.lvl == 2).map((o) => o.v)), max = typical * TILE_CAP;
  let t = typical ? tiles.map((o) => (o.k == 'e' && o.v > max ? { ...o, v: max } : o)) : tiles;
  for (let i = 0; i < 6 && t.length >= 4; i++) {
    const cap = .3 * t.reduce((s, o) => s + o.v, 0);
    if (t.every((o) => o.v <= cap * 1.001)) break;
    t = t.map((o) => (o.v > cap ? { ...o, v: cap } : o));
  }
  return t;
}

/* R3 "+N more": rows the button saves. All n rows laid out in `cols` columns versus `shown` rows plus the button's own row. */
export const savedRows = (n, shown, cols = 1) => Math.ceil(n / cols) - Math.ceil(shown / cols) - 1;
/* a button that saves at most one row is not worth its row: show everything (Adam, 2026-10-28, visual-qa finding 5b) */
export const showAll = (n, shown, cols = 1) => shown >= n || savedRows(n, shown, cols) <= 1;
/* a cut that must happen is made deeper until its button saves at least two rows (or nothing is left to cut) */
export function cutDeeper(n, shown, cols = 1) {
  let ns = shown;
  while (ns > MIN_KEEP && savedRows(n, ns, cols) < 2) ns = Math.max(MIN_KEEP, ns - cols);
  return ns;
}
/* a cut lane always keeps this many rows: a button that replaces every row of a lane is never acceptable (Adam, 2026-10-28) */
export const MIN_KEEP = 1;
/* the sizes the smallest box variants try, largest first, never below the minimum text size */
export const minimalSizes = (RF) => [...new Set([1.1, .95, .82, .7, .6, .5, .42].map((k) => Math.max(k, minText(RF))))];
/* the day view's short lanes take no columns: the market-hours lane (its events, red ones as chips) is a compact band across the top, and the "Time not given" lane
   (rows only) a compact strip along the bottom, the least prominent spot (Adam, 2026-10-28); Before open and After close keep the prime space */
export function laneBand(lanes) {
  const mk = lanes.find((s) => s.b === 'mk'), nt = lanes.find((s) => s.b === 'nt' && !s.tiles.length), band = [mk].filter(Boolean), foot = [nt].filter(Boolean);
  return { band, foot, cols: lanes.filter((s) => !band.includes(s) && !foot.includes(s)).map((s) => [s]) };
}

export function wr(row, s) { const sum = row.reduce((a, b) => a + b.a, 0), mx = Math.max(...row.map((r) => r.a)), mn = Math.min(...row.map((r) => r.a)); return Math.max(s * s * mx / (sum * sum), sum * sum / (s * s * mn)); }
/* rowFirst: the first strip runs across the full width (the biggest boxes side by side, tall) even when the map is wider than tall */
export function squarify(items, x, y, w, h, rowFirst = false) {
  /* a weight of 0 or below (or missing) never gives NaN or a zero-area box: it takes a tiny share, and a lane of only such weights shares equally */
  const pos = items.reduce((a, b) => a + (b.v > 0 ? b.v : 0), 0), wt = (i) => (pos > 0 ? (i.v > 0 ? i.v : pos * 1e-4) : 1);
  const tot = items.reduce((a, b) => a + wt(b), 0), out = []; items.forEach((i) => { i.a = wt(i) * w * h / tot; });
  let rest = items.slice(), first = rowFirst;
  while (rest.length) {
    const across = first; first = false;
    const s = across ? w : Math.min(w, h); let row = [rest[0]], worst = wr(row, s);
    for (let i = 1; i < rest.length; i++) { const t = row.concat(rest[i]), wt = wr(t, s); if (wt <= worst) { row = t; worst = wt; } else break; }
    rest = rest.slice(row.length); const rs = row.reduce((a, b) => a + b.a, 0);
    if (!across && w >= h) { const cw = rs / h; let yy = y; row.forEach((i) => { const hh = i.a / cw; out.push({ i, x, y: yy, w: cw, h: hh }); yy += hh; }); x += cw; w -= cw; }
    else { const rh = rs / w; let xx = x; row.forEach((i) => { const ww = i.a / rh; out.push({ i, x: xx, y, w: ww, h: rh }); xx += ww; }); y += rh; h -= rh; }
  }
  return out;
}

/* rows a lane's list takes (rem): n rows in `cols` columns plus the "+N more" row when there is one */
export const rowsRem = (s, cols, RF) => { const n = s.rx.length + s.re.length; return n || s.extra ? (Math.ceil(n / (cols || 1)) + s.extra) * 1.21 * RF + .3 : 0; };

/* A lane's tile map height (px) from its tiles alone: area per unit of weight is set so the smallest tile is at least the design's small
   tile (about 5rem x 3.4rem) and a headliner at least the design's big tile (about 11rem x 6rem), with a margin for the treemap's
   uneven shapes; an economic red tile is at least 6rem x 5rem. Relative sizes inside the lane stay proportional to value (capped, see capBoxes).
   tf scales the earnings boxes only: an economic tile keeps its full floor whatever the day's scale (it must show title, time and tag in full),
   and xBoost grows that floor when a red tile still did not fit. RF is 1.25 on the laptop, where the type floor is larger. */
export function tileMapH(items, width, rem, tf = 1, RF = 1, xBoost = 1) {
  const it = items.filter((o) => o.v > 0), tot = it.reduce((s, o) => s + o.v, 0); /* a weight of 0 or below never divides: it is left out of the maths */
  if (!tot || !width) return 3.6 * rem;
  const floor = (o) => (o.k == 'x' ? TILE_FLOOR_REM2.x : TILE_FLOOR_REM2[o.r.lvl] || TILE_FLOOR_REM2[2]);
  const need = (list) => (list.length ? Math.max(...list.map((o) => floor(o) * tot / o.v)) : 0);
  const ex = it.filter((o) => o.k == 'x'), en = it.filter((o) => o.k != 'x');
  const area = 1.7 * RF * RF * Math.max(tf * need(en), Math.max(tf, X_MIN_TF) * xBoost * need(ex)) * rem * rem;
  const tall = ex.length > 0 || it.some((o) => o.k == 'e' && o.r.lvl == 1);
  /* Headliners keep the live proportions even though their weight is capped: two or more of them sit side by side in the lane's first strip, and that strip is
     about 1.3 times as tall as one headliner is wide, so a wordmark logo goes across the top with room left for ticker and value. Narrow week columns only; a
     wide day lane already lays them out big. The day's scale lowers this only down to .8. */
  const hl = it.filter((o) => o.k == 'e' && o.r.lvl == 1), hlShare = hl.reduce((s, o) => s + o.v, 0) / tot;
  const hlH = hl.length >= 2 && width <= 26 * rem ? 1.3 * Math.max(tf, .8) * (width / hl.length) / hlShare : 0;
  return Math.max((tall ? 6.2 : 3.6) * rem, area / width, hlH);
}

/* ---------- measuring ---------- */
export function fitRows(root, rem) {
  root.querySelectorAll('.sr .nm').forEach((el) => {
    const over = () => el.scrollWidth > el.clientWidth;
    if (!over()) return; const s = el.dataset.s; if (s && s !== el.textContent) { el.textContent = s; if (!over()) return; }
    /* a company name that still does not fit is cut with an ellipsis (the row's tooltip has it whole); only a name with under about 3 characters of room is left out */
    if (el.tagName == 'SPAN' && el.clientWidth < 3.2 * rem) el.textContent = ''; else el.style.textOverflow = 'ellipsis';
  });
}
export const tileFits = (el) => {
  const cs = getComputedStyle(el), pb = parseFloat(cs.paddingBottom), pr = parseFloat(cs.paddingRight), H = el.clientHeight - pb + 1, Wd = el.clientWidth - pr + 1;
  return el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1 && [...el.querySelectorAll('*')].every((n) => n.tagName == 'CANVAS' || (n.offsetTop + n.offsetHeight <= H && n.offsetLeft + n.offsetWidth <= Wd)) && [...el.querySelectorAll('.tk,.tt,.hd,.lf')].every((n) => n.scrollWidth <= n.clientWidth + 1) && [...el.querySelectorAll('.nmx')].every((n) => n.scrollWidth <= n.clientWidth);
};

/* ---------- earnings tile: logo (only when the company has a real one), ticker, name, then value; name goes first, time never ---------- */
export function earnTile(r, H) {
  const t = `title="${H.esc(r.n)} (${H.esc(r.t)}), ${H.fv(r.c)}, ${H.tmx(r)}"`;
  return { c: `tl l${r.lvl}${r.e ? ' e' : ''}`, t, h: '', attr: ` data-rk="${r.k}"` };
}
/* the time and the value of a box: "8:00 AM · $56B", or the value alone when no time is announced (never a date-status mark) */
const timeValue = (r, H) => (r.tm ? `${H.tmh(r)} <span class="v">&middot; ${H.fv(r.c)}</span>` : `<span class="v">${H.fv(r.c)}</span>`);
/* The anatomy of a box big enough for more than ticker and value: logo (if real) at a set share of the box, then ticker, company name, then value,
   one group with fixed gaps, centered vertically and left-aligned; s is the ticker size (rem) and scales the whole group. null when the logo
   would draw too small to read. A box with no real logo has no logo slot, so the ticker is never shown twice. */
export function anatomyHTML(r, wR, hR, s, withName, H, row = false, ls = 1) {
  const { RF, RP, Z } = H.L, mt = minText(RF), pad = .34, iw = wR - 2 * pad - .06, ih = hR - 2 * pad - .06, ar = H.arOf(r.t), wl = ar > 1.9;
  let logo = '';
  if (H.hasLogo(r.t)) {
    /* the logo box hugs the drawn mark (height follows width for a wordmark), so there is no empty band inside it; in a wide short box (row) the logo sits
       beside the text and is sized from the box's width and height */
    const lh = row ? Math.min(.8 * ih, wl ? iw * .5 / ar : iw * .5) : ls * Math.min(2.7 * s, .38 * ih, wl ? iw / ar : iw), w = wl ? Math.min(lh * ar, row ? iw * .5 : iw) : lh;
    /* a logo that would draw under about 5px tall (a very thin wordmark in a narrow box) is left out, and the box is laid out as one with no logo */
    if (Math.min(lh * .9, w * .9 / ar) * RP * Z >= 5) logo = `<div class="hd">${H.logoA(r.t, lh, w)}</div>`;
  }
  const nf = Math.max(mt, .5 * s), vf = Math.max(mt, .68 * s), same = r.n && r.n.toUpperCase() === r.t.toUpperCase();
  /* a wordmark logo is the company's name already, so the name is not repeated under it, and a wordmark that spells the ticker drops the ticker line too */
  const tk = logo && wl && same ? '' : `<div class="tk" style="font-size:${s.toFixed(2)}rem">${H.esc(r.t)}</div>`;
  const text = tk + (withName && r.n && !(logo && wl) && !same ? `<div class="nmx" style="font-size:${nf.toFixed(2)}rem">${H.esc(r.n)}</div>` : '') + `<div class="tt" style="font-size:${vf.toFixed(2)}rem">${timeValue(r, H)}</div>`;
  return row ? logo + `<div class="col">${text}</div>` : logo + text;
}
/* a box qualifies for the anatomy when it holds more than ticker and value: a roomy box, or a wide short one (logo beside the text) */
export const isBigBox = (wR, hR) => (wR * hR >= 28 && Math.min(wR, hR) >= 4.4) || (wR * hR >= 36 && Math.min(wR, hR) >= 3.6) || (wR >= 2 * hR && hR >= 3 && wR * hR >= 30);
/* the sizes the anatomy tries, largest first, down to the smallest at which every line is still at the minimum text size; a box with no logo has more
   height for the ticker, which then shows large */
export function anatomySizes(hR, RF, withName, logo = true, row = false) {
  const lo = minText(RF) / (withName ? .5 : .68), hi = Math.max(lo, Math.min(4.4, (hR - .8) * (row ? .3 : logo ? .2 : .27))), out = [];
  for (let s = hi; s >= lo * .999; s *= .94) out.push(s);
  if (!out.length || out[out.length - 1] > lo * 1.001) out.push(lo);
  return out;
}
/* every size in a variant is at least the minimum text size (the row text size) */
export function variantHTML(r, wR, hR, v, H) {
  const { RF, RP, Z } = H.L, mt = minText(RF);
  const pad = .34, iw = wR - 2 * pad - .06, ih = hR - 2 * pad - .06, base = Math.sqrt(wR * hR), L = r.t.length, k = v.k, big = base > 12;
  const ar = H.arOf(r.t), wl = ar > 1.9, has = H.hasLogo(r.t), sc = Math.max(1, Math.min(big ? 1.7 : 1.3, base / 6.8)), f2 = Math.max(mt, .72 * sc * k);/* time and value never go below the row text size */
  const lg = Math.max(.75, Math.max(1, Math.min(big ? 5 : 3.2, base * .27)) * k), fk = Math.max(mt, Math.max(.82, Math.min(big ? 3.2 : 1.9, base * .15)) * k);
  const vt = H.fv(r.c), F2 = f2.toFixed(2), physPx = RP * Z, tm = r.tm ? H.tmh(r) : '';
  const tline = () => (v.vp == 'in' || !tm ? `<div class="tt" style="font-size:${F2}rem">${tm ? `${tm} <span class="v">&middot; ${vt}</span>` : `<span class="v">${vt}</span>`}</div>` : `<div class="tt" style="font-size:${F2}rem">${tm}</div><div class="tt" style="font-size:${F2}rem"><span class="v">${vt}</span></div>`);
  const nameH = (has && wl) || r.n.toUpperCase() === r.t.toUpperCase() ? '' : `<div class="nmx" style="font-size:${F2}rem">${H.esc(r.n)}</div>`; /* a wordmark logo already says the name */
  /* no real logo: no logo slot (the ticker is shown once); a logo too small to read drops the variant */
  const logoBox = (h, maxW) => { if (!has) return ''; const w = wl ? Math.min(h * ar, Math.max(h, maxW)) : h, hd = Math.min(h * .9, w * .9 / ar) * physPx; if (hd < 5) return null; return H.logoA(r.t, h, w); };
  /* a wordmark that spells the ticker (AON) is shown once: the ticker line is dropped */
  const tkH = has && wl && r.n.toUpperCase() === r.t.toUpperCase() ? '' : `<div class="tk" style="font-size:${fk.toFixed(2)}rem">${H.esc(r.t)}</div>`;
  if (v.lay == 'top') {
    const lh = Math.min(lg, ih * .42), lgh = logoBox(lh, iw); if (lgh == null) return null;
    return (lgh ? `<div class="hd">${lgh}</div>` : '') + `<div class="trow">${tkH}${tline()}</div>` + (v.c >= 4 ? nameH : '');
  }
  if (v.lay == 'wd') {
    const lfW = Math.min(iw * .5, Math.max(10, L * fk * .9 + 4)), lh = Math.min(lg, ih * .5), lgh = logoBox(lh, lfW - .4 - L * fk * .8); if (lgh == null) return null;
    return `<div class="lf" style="width:${lfW.toFixed(2)}rem"><div class="hd">${lgh}${tkH}</div>${tline()}</div><div class="rt"><div class="nmx" style="font-size:${(f2 * 1.1).toFixed(2)}rem;color:#fff">${H.esc(r.n)}</div></div>`;
  }
  if (v.lay == 'side') {
    const maxW = iw - .45 - L * fk * .78, lgh = logoBox(lg, maxW); if (lgh == null) return null;
    return `<div class="hd">${lgh}<div>${tkH}${v.c >= 4 ? nameH : ''}</div></div>` + tline();
  }
  const lgh = logoBox(lg, iw); if (lgh == null) return null;
  return `<div class="hd st">${lgh}${tkH}</div>` + (v.c >= 4 ? nameH : '') + tline();
}
/* the variants a box tries, richest first: type size is the outer loop (largest first, with a floor); content level (name) is the inner loop, so the name is dropped before type gets small */
export function variantSequence(wR, hR, wl) {
  const seq = [], wide = wR >= 7.4 && hR <= wR * .7 && hR >= 3.1, tall = hR > 4.5, base = Math.sqrt(wR * hR);
  const ks = base > 4.2 ? [1.5, 1.3, 1.15, 1, .88, .76, .66, .56, .48] : [1, .88, .76, .66, .56, .48];
  const lays = (wl ? ['top'] : []).concat(tall ? ['stack', 'side'] : ['side', 'stack']);
  ks.forEach((k) => { [5, 4, 3].forEach((c) => { if (wide && c >= 4 && k <= 1.3) seq.push({ c, lay: 'wd', vp: 'in', k }); lays.forEach((lay) => ['in', 'ln'].forEach((vp) => seq.push({ c, lay, vp, k }))); }); });
  /* a wide logo goes on top, at full size, before the beside-the-ticker layouts shrink it (down to .76 of the type size; Adam wants logos as big as they were live) */
  if (wl) { const top = seq.filter((v) => v.lay == 'top' && v.k >= .76); return top.concat(seq.filter((v) => !top.includes(v))); }
  return seq;
}
/* a lane with two or more headliner boxes lays them out side by side in the first full-width strip, so they come out tall, not short and wide */
export const headlinerRow = (it, W, Hh) => it.filter((o) => o.k == 'e' && o.r.lvl == 1).length >= 2 && W < Hh * 1.3;
/* the shares of its full size a stacked box lets the logo shrink to before the text gives way: a wordmark may go to 64%, a mark (a dot, a chevron) only to 82%, so it
   never shrinks to a speck beside its ticker; the name is dropped before a mark gets smaller */
export const logoScales = (ar) => (ar > 2.5 ? [1, .8, .64] : [1, .82]);
/* Whether a box tries the logo-beside-text layout before the stacked one. Only a wide short box does. A wordmark (aspect over about 2.5) stays stacked, logo
   across the top, whenever the stacked logo can draw at 60% of the box's width or more, or draws bigger than it would beside the text; the beside layout is
   for the box where it draws the logo bigger (pure; ar is 0 for a box with no logo). */
export function rowFirst(wR, hR, ar) {
  if (!(wR > 1.6 * hR)) return false;
  if (ar > 2.5) {
    const iw = wR - .74, ih = hR - .74, stacked = Math.min(.38 * ih * ar, iw), beside = Math.min(.8 * ih * ar, .5 * iw);
    if (stacked >= .6 * iw || stacked >= beside) return false;
  }
  return true;
}
/* the anatomy first, for a box big enough for it: largest type that fits, with the name, then without it; false when none fits */
function fitAnatomy(el, r, wR, hR, H) {
  /* a wide short box puts the logo beside the text (row) first; any box then tries the stacked group (but see rowFirst for wordmarks) */
  for (const row of rowFirst(wR, hR, H.hasLogo(r.t) ? H.arOf(r.t) : 0) ? [true, false] : [false]) {
    for (const withName of [true, false]) {
      for (const s of anatomySizes(hR, H.L.RF, withName, H.hasLogo(r.t), row)) {
        /* a stacked box tries the full logo first, then a smaller one, before the text gives way */
        for (const ls of row ? [1] : logoScales(H.arOf(r.t))) {
          const h = anatomyHTML(r, wR, hR, s, withName, H, row, ls); if (h == null) break;
          el.classList.add('an'); el.classList.toggle('row', row); el.style.gap = Math.max(.22, .3 * s).toFixed(2) + 'rem'; el.style.justifyContent = ''; el.innerHTML = h;
          if (tileFits(el)) {
            el.dataset.v = `an ${row ? 'row' : 'col'} ${withName ? 1 : 0} ${s.toFixed(2)}`;
            /* a tall narrow box whose group is still short of its height spreads the group evenly down it, so there is no dead band */
            const used = row ? 0 : [...el.children].reduce((a, c) => a + c.offsetHeight, 0);
            if (!row && used < .72 * el.clientHeight) el.style.justifyContent = 'space-evenly';
            return true;
          }
        }
      }
    }
  }
  el.classList.remove('an', 'row'); el.style.gap = ''; el.style.justifyContent = '';
  return false;
}
/* true when the box shows its content in full at the minimum text size or above; false means it cannot, and the caller folds it into the lane's rows */
export function fitTile(el, r, wR, hR, H) {
  const wl = H.arOf(r.t) > 1.9, mt = minText(H.L.RF);
  if (isSliver(r, wR, hR)) return false; /* a sliver cannot show its text at a readable size: it folds into the lane's rows (a headliner never does) */
  el.classList.remove('an', 'row', 'wd'); el.style.gap = ''; el.style.padding = ''; el.style.justifyContent = '';
  if (isBigBox(wR, hR) && fitAnatomy(el, r, wR, hR, H)) return true;
  for (const v of variantSequence(wR, hR, wl)) {
    const h = variantHTML(r, wR, hR, v, H); if (h == null) continue;
    el.classList.toggle('wd', v.lay == 'wd'); el.innerHTML = h;
    if (tileFits(el)) { el.dataset.v = [v.c, v.lay, v.vp, v.k].join(' '); return true; }
  }
  /* a very small box: the logo goes first, then the time, then the name was already gone; ticker and value never go and never drop below the minimum text size */
  const T = H.esc(r.t), vt = H.fv(r.c);
  el.classList.remove('wd'); el.style.padding = '.18rem';
  for (const withTime of [true, false]) {
    for (const k of minimalSizes(H.L.RF)) {
      el.innerHTML = `<div class="tk" style="font-size:${k.toFixed(2)}rem">${T}</div><div class="tt" style="font-size:${Math.max(mt, k * .85).toFixed(2)}rem">${withTime && r.tm ? `${H.tmh(r)} ` : ''}<span class="v">${vt}</span></div>`;
      if (tileFits(el)) { el.dataset.v = `min ${withTime ? 'time' : 'tv'} ${k}`; return true; }
    }
  }
  return false;
}

/* ---------- red high-impact tile: name, time, HIGH and FED badges ---------- */
export function econTile(x, H) { return { c: 'tl x ih', t: `title="${H.esc(x.n)}, ${H.fx(x)}"`, h: '', attr: ` data-xk="${x.k}"` }; }
export function econHTML(x, u, st, H) {
  const RF = H.L.RF, mt = minText(RF), lg = Math.min(4.4, 1.7 * u), fn = Math.max(mt, Math.min(2.6, .98 * u)), f2 = Math.max(mt, .74 * u), fb = Math.max(minTag(RF), .52 * u), cf = Math.max(minTag(RF), lg * .4); /* the badge letters are about 40% of the chip's height */
  const badge = x.code ? `<span class="cd" style="--s:${lg.toFixed(2)}rem;font-size:${cf.toFixed(2)}rem">${H.esc(x.code)}</span>` : '';
  /* the time and the tags each get their own line, with clear room between them (Adam, 2026-10-28) */
  return `<div class="hd${st ? ' st' : ''}">${badge}<div class="tk" style="font-size:${fn.toFixed(2)}rem">${H.esc(x.n)}</div></div><div class="tt" style="font-size:${f2.toFixed(2)}rem">${H.fx(x)}</div><div class="etg" style="font-size:${fb.toFixed(2)}rem"><span class="hg">HIGH</span>${x.fed ? '<span class="fed">FED</span>' : ''}</div>`;
}
/* true when title, time and tag show in full at the minimum text size or above; false asks for more room (xBoost) */
export function fitEcon(el, x, wR, hR, H) {
  const RF = H.L.RF, base = Math.sqrt(wR * hR), k0 = Math.max(1, Math.min(2.4, base / 4.6)), uf = minText(RF) / .98; /* at uf the title is at the minimum text size */
  const tryU = (u) => { for (const st of [0, 1]) { el.innerHTML = econHTML(x, u, st, H); if (tileFits(el)) return true; } return false; };
  for (let u = k0; u >= uf * .999; u *= .93) if (tryU(u)) return true;
  return tryU(uf);
}
/* every box on the page that fits no variant, as { e: earnings row keys, x: economic event keys }; a failed box keeps the smallest variant tried until the caller re-lays the page */
export function fitAll(H, rem) {
  const root = H.root(), bad = { e: [], x: [] };
  root.querySelectorAll('.tmap:not([data-mini]) .tl[data-rk]').forEach((el) => { const r = H.R[+el.dataset.rk]; if (!fitTile(el, r, el.clientWidth / rem, el.clientHeight / rem, H)) bad.e.push(r.k); });
  root.querySelectorAll('.tmap:not([data-mini]) .tl[data-xk]').forEach((el) => { const x = H.XV[+el.dataset.xk]; if (!fitEcon(el, x, el.clientWidth / rem, el.clientHeight / rem, H)) bad.x.push(x.k); });
  return bad;
}

/* ---------- week strip tiles and the treemap layout ---------- */
export function miniTile(it, wR, hR, H) {
  const m = Math.min(wR, hR);
  if (it.k == 'e') {
    const r = it.r, t = `title="${H.esc(r.n)} (${H.esc(r.t)}), ${H.fv(r.c)}, ${H.tmx(r)}"`, c = `tl l${r.lvl} zs${r.e ? ' e' : ''}`;
    const lh = Math.max(.9, Math.min(2.4, m * .62));
    return { c, t, h: H.hasLogo(r.t) && (it.top || (m >= 2.3 && r.lvl <= 2)) ? H.logoA(r.t, lh, Math.max(lh, Math.min(lh * 3, wR - .25))) : '' };
  }
  const x = it.x, t = `title="${H.esc(x.n)}, ${H.fx(x)}"`, s = m * .6, tag = minTag(H.L.RF);
  /* the badge shows only when its letters fit at the minimum tag size; otherwise the red tile stands without it */
  const badge = x.i == 'h' && x.code && m >= 2.3 && s >= (x.code.length * .62 + .5) * tag;
  return { c: `tl x i${x.i} zs`, t, h: badge ? `<span class="cd" style="--s:${s.toFixed(2)}rem;font-size:${tag.toFixed(2)}rem">${H.esc(x.code)}</span>` : '' };
}
const tileHTML = (it, wR, hR, mini, H) => (mini ? miniTile(it, wR, hR, H) : it.k == 'e' ? earnTile(it.r, H) : econTile(it.x, H));
export function layoutAll(H, rem) {
  H.root().querySelectorAll('.tmap').forEach((el) => {
    const it = H.L.TM[el.dataset.id], mini = el.dataset.mini == '1'; if (!it || !it.length) { el.innerHTML = ''; return; }
    const W = el.clientWidth, Hh = el.clientHeight; if (!W || !Hh) return;
    const rects = squarify(it.map((o) => Object.assign({}, o)), 0, 0, W, Hh, !mini && headlinerRow(it, W, Hh));
    el.innerHTML = rects.map((r) => { const o = tileHTML(r.i, r.w / rem, r.h / rem, mini, H); return `<div class="${o.c}" ${o.t}${o.attr || ''} style="left:${(r.x + 1).toFixed(1)}px;top:${(r.y + 1).toFixed(1)}px;width:${Math.max(0, r.w - 2).toFixed(1)}px;height:${Math.max(0, r.h - 2).toFixed(1)}px">${o.h}</div>`; }).join('');
  });
}

/* ---------- sizing: the week strip, the day view's lane columns, and the week's lanes ---------- */
const weightOf = (H, d, b, X) => H.itemsOf(d, b, X).reduce((s, o) => s + o.v, 0);
/* Scale rule (day view): one area-per-weight constant K, fixed by the busiest UNFILTERED day, so a tile keeps its importance size under any filter and a filtered day block shrinks to its content. */
function sizeStrip(H, D, U, rem) {
  const minis = [...H.root().querySelectorAll('.mini .tmap')]; if (!minis.length) return;
  const days = H.days(), maxFull = Math.max(1, ...days.map((d) => ZN.reduce((a, b) => a + weightOf(H, d, b, U), 0)));
  /* week strip: each day's map keeps one shared scale; the strip is only as tall as its tallest map */
  const mw = minis[0].clientWidth, Hm = 5.2 * rem, K = mw * Hm / maxFull;
  minis.forEach((el, i) => { const sum = ZN.reduce((a, b) => a + weightOf(H, days[i], b, D), 0); el.style.height = Math.max(1.4 * rem, Math.min(Hm, sum * K / mw)) + 'px'; });
}
/* the width maths of the day view: a lane needs at least minOf, and a tile lane the width its tiles need at K */
function laneGeometry(g) {
  const { rem, RF } = g, tw = (s) => s.tiles.reduce((a, o) => a + o.v, 0);
  const minOf = (s, c) => (s.re.length ? (c > 1 ? c * 24 : 26) * RF : s.rx.length ? 14 * RF : 12) * rem;
  const Hof = (s, c) => Math.max(4 * rem, g.ZH - g.zcv - rowsRem(s, c, RF) * rem);
  const laneW = (s, K, c) => Math.max(minOf(s, c), s.tiles.length ? K * tw(s) / Hof(s, c) : 0) + g.zcw;
  const need = (lanes, K, cm) => lanes.reduce((a, s) => a + laneW(s, K, cm[s.b] || 1), 0) + (lanes.length - 1) * g.gap;
  const solve = (lanes, cm) => { let lo = 0, hi = 1e7; for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (need(lanes, m, cm) > g.lim) hi = m; else lo = m; } return lo * .99; };
  return { minOf, laneW, need, solve };
}
/* row columns a lane of the given inner width holds */
export const colsFor = (inner, RF, rem) => Math.max(1, Math.floor(inner / (24 * RF * rem)), Math.ceil(inner / (40 * rem)));
/* K comes from the unfiltered day so tiles keep their size. Row columns per lane are settled first, then K is solved with those columns held fixed. */
function solveColumns(g, geo, lanes) {
  let cols = {};
  for (let pass = 0; pass < 4; pass++) {
    const K = geo.solve(lanes, cols), nc = {};
    lanes.forEach((s) => { nc[s.b] = colsFor(geo.laneW(s, K, cols[s.b] || 1) - g.zcw, g.RF, g.rem); });
    if (lanes.every((s) => nc[s.b] == (cols[s.b] || 1))) break; cols = pass == 3 ? cols : nc;
  }
  /* feasibility: the lanes' minimum widths (with their row columns) must fit the panel; otherwise drop a row column from the widest lane */
  const mins = () => lanes.reduce((a, s) => a + geo.minOf(s, cols[s.b] || 1) + g.zcw, 0) + (lanes.length - 1) * g.gap;
  for (let n = 0; n < 6 && mins() > g.lim; n++) {
    const w = lanes.filter((s) => (cols[s.b] || 1) > 1).sort((a, b) => (cols[b.b] || 1) - (cols[a.b] || 1))[0]; if (!w) break; cols[w.b] = (cols[w.b] || 1) - 1;
  }
  return { K: geo.solve(lanes, cols), cols };
}
/* the band across the top of the day (laneBand): the market-hours lane is one wrapping row of chips (the red events and the other events, each showing title, time
   and tag in full), so it takes only the height its content needs; the page's HTML draws it, so only its width is set here */
function sizeBand(day, g) {
  const zn = day.querySelector('.lband .zn'); if (zn) zn.style.width = g.lim + 'px';
}
/* the strip along the bottom of the day (laneBand): the "Time not given" rows across the full width, sized to their content */
function sizeFoot(day, g) {
  const zn = day.querySelector('.lfoot .zn'); if (!zn) return;
  zn.style.width = g.lim + 'px'; const rw = zn.querySelector('.rows'); if (rw) rw.style.gridTemplateColumns = `repeat(${colsFor(g.lim - g.zcw, g.RF, g.rem)},minmax(0,1fr))`;
}
function sizeFocusDay(H, D, U, rem) {
  const { L } = H, day = H.root().querySelector('.day.wide'); if (!day) return;
  const d0 = H.fday(), zones = day.querySelector('.zones'), zl = [...zones.querySelectorAll('.zn')];
  const g = { rem, RF: L.RF, zcw: .6 * rem + 2, gap: .5 * rem, lim: L.VW - 1.2 * rem - 4, tf: L.TFD[d0] ?? 1, xBoost: L.XB[d0] ?? 1 };
  sizeBand(day, g); sizeFoot(day, g);
  if (zl.length) {
    g.ZH = zones.clientHeight; g.zcv = zl[0].querySelector('.zh').offsetHeight + .6 * rem + 5;
    const geo = laneGeometry(g), su = laneBand(ZN.map((b) => H.splitZ(d0, b, U)).filter((s) => s.it.length)).cols.flat(); /* the unfiltered day sets K */
    const { K, cols } = solveColumns(g, geo, su);
    const sd = zl.map((zn) => H.splitZ(d0, zn.dataset.b, D)), wd = sd.map((s) => geo.laneW(s, K, cols[s.b] || 1));
    const extra = Math.max(0, g.lim - wd.reduce((a, b) => a + b, 0) - (sd.length - 1) * g.gap);
    /* spare width goes to the lanes that list rows; with none, to all */
    const wants = sd.map((s) => s.re.length > 0), nw = wants.filter(Boolean).length;
    sd.forEach((s, i) => {
      const zn = zl[i], w = wd[i] + (nw ? (wants[i] ? extra / nw : 0) : extra / sd.length);
      const c = s.re.length ? Math.max(cols[s.b] || 1, colsFor(w - g.zcw, L.RF, rem)) : cols[s.b] || 1;
      zn.style.width = w + 'px'; const rw = zn.querySelector('.rows'); if (rw) rw.style.gridTemplateColumns = `repeat(${c},minmax(0,1fr))`;
      const tm = zn.querySelector('.tmap');
      if (tm) { tm.style.flex = 'none'; tm.style.height = tileMapH(s.tiles, w - g.zcw, rem, g.tf, L.RF, g.xBoost) + 'px'; }
    });
  }
  /* the day panel shrinks to its content once the lanes are sized */
  day.style.flex = '0 0 auto'; zones.style.flex = 'none';
}
/* each lane's tile map is sized from its own tiles, never from the busiest day's rows: the lane grows as tall as its tiles need
   (the page scrolls), so no box is scaled below what it needs to show its text */
function sizeWeek(H, rem) {
  const { L } = H;
  H.root().querySelectorAll('.zn .tmap').forEach((el) => { el.style.flex = 'none'; el.style.height = tileMapH(L.TM[el.dataset.id] || [], el.clientWidth, rem, L.TFD[L.TMD[el.dataset.id]] ?? 1, L.RF, L.XB[L.TMD[el.dataset.id]] ?? 1) + 'px'; });
}
export function sizeAll(H, D, U, focus, rem) {
  if (focus) { sizeStrip(H, D, U, rem); sizeFocusDay(H, D, U, rem); } else sizeWeek(H, rem);
}

/* ---------- fitting the window height ---------- */
const laneState = (H, D, d, b) => { const s = H.splitZ(d, b, D), n = s.re.length + s.hidden; return { key: s.key, shown: s.re.length, n, s }; };
/* cut k display rows from a lane's list into its "+N more" row (the cut is deepened until the button saves at least two rows); returns the display rows saved, 0 when nothing can be cut */
export function cutLane(L, lane, k, cols) {
  if (lane.n <= MIN_CUT_LANE) return 0; /* a lane of two or three reports always shows its rows: a button that replaces every row is never acceptable */
  const display = Math.ceil(lane.shown / cols) + (lane.n > lane.shown ? 1 : 0), target = display - k;
  let ns = Math.max(MIN_KEEP, (target - 1) * cols);
  if (ns >= lane.shown) return 0;
  ns = cutDeeper(lane.n, ns, cols);
  const saved = display - (Math.ceil(ns / cols) + 1);
  /* nothing is written unless the cut gives a row back and its button saves at least two rows of the whole list (the showAll rule) */
  if (ns >= lane.shown || saved < 1 || savedRows(lane.n, ns, cols) < 2) return 0;
  lane.shown = ns; L.LIM[lane.key] = ns; L.LIMD.add(lane.key);
  return saved;
}
/* When rows are cut and the day is still too tall: its boxes scale down (this day only) until MINTF; below that the day's smallest earnings boxes fold
   into the lane's rows (and from there into "+N more") by the height they must give back, never shrunk below readable text. */
/* the boxes of a lane to fold, smallest first, until its map is at most targetPx tall (pure). A headliner is never folded to fit the height (R3); a company of
   $500B or more only as the very last resort (`last`, when the page would otherwise scroll). Returns the row keys. */
export function foldPlan(tiles, { width, rem, tf, RF, xBoost, targetPx, last = false }) {
  const out = []; let keep = tiles.slice();
  for (const o of tiles.filter((t) => foldableTile(t, last)).sort(byImportance)) {
    keep = keep.filter((t) => t !== o); out.push(o.r.k);
    if (tileMapH(keep, width, rem, tf, RF, xBoost) <= targetPx) break;
  }
  return out;
}
function foldTiles(H, maps, overPx, rem, last = false) {
  const { L } = H;
  const best = maps.filter((el) => (L.TM[el.dataset.id] || []).some((t) => foldableTile(t, last))).sort((a, b) => b.offsetHeight - a.offsetHeight)[0]; if (!best) return false;
  const d = L.TMD[best.dataset.id], keys = foldPlan(L.TM[best.dataset.id], { width: best.clientWidth, rem, tf: L.TFD[d] ?? 1, RF: L.RF, xBoost: L.XB[d] ?? 1, targetPx: best.offsetHeight - overPx, last });
  keys.forEach((k) => L.HFOLD.add(k));
  return keys.length > 0;
}
function shrinkOrFold(H, day, overPx, rem, agg) {
  const { L } = H, d = day.dataset.d, maps = [...day.querySelectorAll('.tmap:not([data-mini])')], hs = maps.map((t) => t.offsetHeight);
  const boxesPx = agg == 'max' ? Math.max(0, ...hs) : hs.reduce((s, t) => s + t, 0), t = L.TFD[d] ?? 1;
  if (t > MINTF && boxesPx) { L.TFD[d] = Math.max(MINTF, t * Math.max(.6, 1 - (overPx + 2) / boxesPx)); return true; }
  if (foldTiles(H, maps, overPx, rem)) return true;
  /* nothing left to fold (only headliners and $500B+ boxes remain): they scale down a little further rather than the page scrolling */
  if (t > MINTF_HARD && boxesPx) { L.TFD[d] = Math.max(MINTF_HARD, t * Math.max(.8, 1 - (overPx + 2) / boxesPx)); return true; }
  return foldTiles(H, maps, overPx, rem, true); /* the page never scrolls: the smallest $500B+ box folds into the rows */
}
/* week view: lanes stack, so the day's cut is shared across its lanes */
function trimWeek(H, D, rem) {
  const { L } = H, rowPx = 1.21 * L.RF * rem; let over = 0, moved = false;
  for (const day of H.root().querySelectorAll('.day')) {
    const o = day.offsetHeight - L.VH + 2; if (o <= 0) continue; over += o;
    const d = day.dataset.d, lanes = ['am', 'pm', 'nt'].map((b) => laneState(H, D, d, b)).filter((x) => x.n > 0);
    let need = Math.ceil(o / rowPx);
    for (let g = 0; need > 0 && g < 400; g++) {
      const lane = lanes.filter((x) => x.shown > 0).sort((a, b) => b.shown - a.shown)[0]; if (!lane) break;
      const saved = cutLane(L, lane, 1, 1);
      if (!saved) { lane.shown = 0; continue; } // this lane cannot give a row back; skip it for this day
      moved = true; need -= saved;
    }
    /* every row that can go is cut and the day is still too tall */
    if (need > 0 && shrinkOrFold(H, day, need * rowPx, rem, 'sum')) moved = true;
  }
  return { over, moved };
}
/* px the day view stands over the window: its children (the outline bar, the week strip when open, the day) plus the .7rem gaps between them */
export const focusOver = (H, rem) => {
  const kids = [...H.root().children]; if (!H.root().querySelector('.day.wide')) return 0;
  return kids.reduce((a, k) => a + k.offsetHeight, 0) + (kids.length - 1) * .7 * rem - H.L.VH + 2;
};
const gridCols = (zn) => { const rows = zn.querySelector('.rows'); return rows ? getComputedStyle(rows).gridTemplateColumns.split(' ').length : 1; };
/* day view: the bottom strip's "Time not given" rows give rows back first (down to two display rows), then each tall lane column is cut on its own */
function trimFocus(H, D, rem) {
  const { L } = H, rowPx = 1.21 * L.RF * rem, day = H.root().querySelector('.day.wide'); if (!day) return { over: 0, moved: false };
  const over = focusOver(H, rem); if (over <= 0) return { over: 0, moved: false };
  let o = over, moved = false;
  const bandNt = day.querySelector('.lfoot .zn[data-b="nt"]');
  if (bandNt && bandNt.querySelector('.rows')) {
    const lane = { ...laneState(H, D, H.fday(), 'nt'), cols: gridCols(bandNt) }, spare = Math.ceil(lane.shown / lane.cols) - 2;
    const saved = spare > 0 ? cutLane(L, lane, Math.min(spare, Math.ceil(o / rowPx)), lane.cols) : 0;
    if (saved) { moved = true; o -= saved * rowPx; }
  }
  if (o <= 0) return { over, moved };
  const columns = [...day.querySelectorAll('.zones > *')], target = Math.max(...columns.map((z) => z.offsetHeight)) - o;
  for (const col of columns) {
    if (col.offsetHeight <= target) continue;
    const lanes = [col].map((zn) => ({ ...laneState(H, D, H.fday(), zn.dataset.b), cols: gridCols(zn) })).filter((x) => x.n > 0);
    let need = Math.ceil((col.offsetHeight - target) / rowPx);
    for (let g = 0; need > 0 && g < 400; g++) {
      const lane = lanes.filter((x) => x.shown > 0).sort((a, b) => b.shown - a.shown)[0]; if (!lane) break;
      const saved = cutLane(L, lane, need, lane.cols);
      if (!saved) { lane.shown = 0; continue; }
      moved = true; need -= saved;
    }
  }
  const maxMap = Math.max(...columns.flatMap((c) => [...c.querySelectorAll('.tmap')]).map((t) => t.offsetHeight), 0);
  if (!moved && maxMap && shrinkOrFold(H, day, o, rem, 'max')) moved = true; // no row left to cut: the boxes scale down, then fold
  return { over, moved };
}
/* rows were cut while the day was still taller than the window; once settled, give back every row that fits: each cut lane grows to the most
   rows the window holds (everything, when it all fits), and a cut that remains never leaves a button saving under two rows */
function regrow(H, D, again, rem) {
  const { L } = H, fits = () => focusOver(H, rem) <= 0;
  for (const key of [...L.LIMD]) {
    const [d, b] = key.split('|'), s0 = H.splitZ(d, b, D), n = s0.re.length + s0.hidden;
    const set = (v) => { if (v >= n) { delete L.LIM[key]; L.LIMD.delete(key); } else { L.LIM[key] = v; L.LIMD.add(key); } again(); };
    let lo = L.LIM[key] ?? 0, hi = n;
    set(hi); if (fits()) continue;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; set(m); if (fits()) lo = m; else hi = m; }
    set(lo);
    const zn = H.root().querySelector(`.day.wide .zn[data-b="${b}"]`), deeper = cutDeeper(n, lo, zn ? gridCols(zn) : 1);
    if (deeper !== lo) set(deeper);
  }
}
/* week view, after the cuts: a day with room left gives rows back to its biggest cut lane, and a lane whose button would save at most one row shows everything
   when it fits (each try is rebuilt and measured, and undone when the day no longer fits) */
function fillWeek(H, D, again, rem) {
  const { L } = H, rowPx = 1.21 * L.RF * rem, el = (d) => H.root().querySelector(`.day[data-d="${d}"]`), fits = (d) => el(d).offsetHeight - L.VH + 2 <= 0;
  const setLim = (key, v, n) => { if (v >= n) { delete L.LIM[key]; L.LIMD.delete(key); } else { L.LIM[key] = v; L.LIMD.add(key); } };
  const attempt = (d, key, v, n) => { const was = L.LIM[key]; setLim(key, v, n); again(); if (fits(d)) return true; setLim(key, was ?? 0, n); again(); return false; };
  for (const d of H.days()) {
    if (!el(d)) continue;
    const cut = () => ['am', 'pm', 'nt'].map((b) => laneState(H, D, d, b)).filter((x) => x.n > x.shown);
    const room = Math.floor((L.VH - 2 - el(d).offsetHeight) / rowPx), big = cut().sort((a, b) => (b.n - b.shown) - (a.n - a.shown))[0];
    if (big && room >= 1) attempt(d, big.key, big.shown + Math.min(room, big.n - big.shown), big.n);
    for (const lane of cut()) {
      if (!showAll(lane.n, lane.shown, 1) || attempt(d, lane.key, lane.n, lane.n)) continue;
      /* the day is one row too tall to show them: take that row from the day's biggest other cut lane (which keeps a button saving two rows) */
      const donor = cut().filter((x) => x.key !== lane.key && x.shown > 0).sort((a, b) => b.shown - a.shown)[0]; if (!donor) continue;
      const was = L.LIM[donor.key]; setLim(donor.key, cutDeeper(donor.n, donor.shown - 1, 1), donor.n);
      if (!attempt(d, lane.key, lane.n, lane.n)) { setLim(donor.key, was, donor.n); again(); }
    }
  }
}
/* Fit the window height without page scrolling: cut earnings rows (smallest value first) into each lane's "+N more" row until every day
   fits (week view: lanes stack, so the day's cut is shared across its lanes; day view: lanes sit side by side, so each tall column is cut
   on its own). If the boxes alone are too tall, that day's boxes scale down uniformly (TFD, never below MINTF), then its smallest boxes fold into
   rows. Expanded lanes (EXP) are laid out after this, so a click grows the page instead of cutting other lanes. */
export function fitHeight(H, D, U, focus, rem) {
  const { L } = H;
  L.FITTING = true; L.LIM = {}; L.LIMD.clear(); L.TFD = {}; L.HFOLD.clear();
  const again = () => { H.build(D, focus); sizeAll(H, D, U, focus, rem); };
  again(); /* start from every row shown (the pass's own build used the previous limits) */
  let r = { over: 0, moved: false };
  for (let it = 0; it < 30; it++) {
    r = focus ? trimFocus(H, D, rem) : trimWeek(H, D, rem);
    if (!r.over || !r.moved) break;
    again();
  }
  if (L.LIMD.size && !r.over) { if (focus) regrow(H, D, again, rem); else fillWeek(H, D, again, rem); }
  L.FITTING = false;
  again();
}
