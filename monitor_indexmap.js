/* The Monitor's SPY and QQQ view: each fund's holdings drawn as Mowgli Cat > Sub > stock (Adam, 2026-10-29: the draft in
   design/drafts/index-map goes live). Box size = the fund's OFFICIAL weight from the State Street / Invesco file (D56); colour =
   today's move; Cats and Subs come from the same groupings (GR) the Cats mode uses (R2: one home per company, an unplaced one
   sits under "Not yet placed"). A missing move is grey and shows a dash, never zero. Uses the globals of monitor.js
   (S, P, D, GR, squarify, heat, fp, cls, box, G, R, co, esc, ysym, legend, $). Called by drawEtf() in monitor.js. */
(function () {
  const NP = 'unplaced', NP_TXT = 'Not yet placed', OTHER_SUB = 'Other (not yet placed)';
  const unesc = (s) => String(s).replace(/&amp;/g, '&');
  const titleCase = (s) => (s === s.toUpperCase() ? s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : s);
  const nonStock = (h) => h.t === 'USD' || /\bcash\b|\bfuture\b/i.test(h.n || '');   // cash and index futures are not stocks of the index
  const pc = (x) => (x >= 10 ? x.toFixed(1) : x.toFixed(2)) + '%';
  const pcg = (x) => x.toFixed(x >= 1 ? 1 : 2) + '%';
  const wavgD = (list) => { let s = 0, w = 0; list.forEach((b) => { if (b.d != null && b.w > 0) { s += b.d * b.w; w += b.w; } }); return w ? s / w : null; };
  let NODES = [];
  const reg = (o) => NODES.push(o) - 1;
  const mctx = document.createElement('canvas').getContext('2d');
  const tw = (s, fs, wt = 800) => { mctx.font = `${wt} ${fs}px ${getComputedStyle(document.body).fontFamily}`; return mctx.measureText(s).width; };   // measured width: labels are dropped or shrunk, never cut

  /* ---- data: the fund's holdings as Cat > Sub > stock; share classes of one company are one box ---- */
  function build(E) {
    const cats = new Map(GR.cats.map((c) => [c.id, c])), subs = new Map(GR.cats.flatMap((c) => c.subs.map((s) => [s.id, s])));
    const nice = new Map(D.grp.map((s) => [ysym(s.s), s.n])), groups = new Map(), m = { other: 0, noWeight: 0, tree: [] };
    E.h.forEach((h) => {
      if (nonStock(h)) { m.other += h.w ?? 0; return; }
      if (!(h.w > 0)) { m.noWeight++; return; }   // a missing, zero or negative weight cannot size a box
      const sym = ysym(h.t), ent = GR.co?.[sym] || GR.picks?.[sym], parent = ysym(ent?.[4] || sym);
      if (!groups.has(parent)) groups.set(parent, []);
      groups.get(parent).push({ ...h, sym, ent });
    });
    const byCat = new Map();
    groups.forEach((ms, parent) => {
      ms.sort((a, b) => b.w - a.w);
      const w = ms.reduce((a, x) => a + x.w, 0), lead = ms.find((x) => x.sym === parent) || ms[0], ent = lead.ent || ms.find((x) => x.ent)?.ent;
      const cid = ent && cats.has(ent[0]) ? ent[0] : NP, sid = cid === NP ? NP + '/none' : (ent[1] && subs.has(ent[1]) ? ent[1] : cid + '/other');
      const b = { t: lead.sym, n: nice.get(lead.sym) || titleCase(unesc(lead.n)), w, d: wavgD(ms) ?? (ms.length === 1 ? ms[0].d : (ms.find((x) => x.d != null)?.d ?? null)), members: ms };
      if (!byCat.has(cid)) { const c = cats.get(cid); byCat.set(cid, { id: cid, name: c ? c.name : NP_TXT, short: c ? (c.short || c.name) : NP_TXT, subs: new Map(), stocks: [] }); }
      const c = byCat.get(cid); c.stocks.push(b);
      if (!c.subs.has(sid)) { const s = subs.get(sid); c.subs.set(sid, { id: sid, name: s ? s.name : (cid === NP ? NP_TXT : OTHER_SUB), short: s ? (s.short || s.name) : (cid === NP ? NP_TXT : OTHER_SUB), stocks: [] }); }
      c.subs.get(sid).stocks.push(b);
    });
    m.tree = [...byCat.values()].map((c) => {
      const sb = [...c.subs.values()].map((s) => ({ ...s, w: s.stocks.reduce((a, b) => a + b.w, 0), d: wavgD(s.stocks) })).sort((a, b) => b.w - a.w);
      return { id: c.id, name: c.name, short: c.short, subs: sb, stocks: c.stocks, w: c.stocks.reduce((a, b) => a + b.w, 0), d: wavgD(c.stocks) };
    }).sort((a, b) => (a.id === NP) - (b.id === NP) || b.w - a.w);
    return m;
  }

  /* ---- boxes ---- */
  // A header carries the short name, its share of the fund and the move. What does not fit is dropped in this order: the move, then the
  // share figure (the tooltip has it), then the font shrinks (to 9px); if the name still does not fit, a Cat header keeps an
  // ellipsis name (must) and a Sub header is left out (null).
  function head(r, hh, fs, name, pct, mv, bg, must) {
    const avail = r.w - G - fs * 1.5, gap = fs * .4, mvTxt = fp(mv, 1);
    const wid = (f, withPct) => tw(name, f) + (withPct ? f * .4 + tw(pct, f) : 0);
    let f = fs, withPct = wid(fs, true) <= avail;
    if (!withPct) { f = fs; if (wid(fs, false) > avail) f = Math.max(9, fs * avail / wid(fs, false)); }
    if (!withPct && wid(f, false) > avail + .5 && !must) return null;
    const showMv = withPct && wid(f, true) + gap * 2 + tw(mvTxt, f) <= avail;
    return `<div class="im-gh" style="height:${hh}px;font-size:${f.toFixed(1)}px;background:${bg}"><span class="im-gn">${esc(name)}</span>${withPct ? `<b class="im-gp">${pct}</b>` : ''}${showMv ? `<em class="im-gm">${mvTxt}</em>` : ''}</div>`;
  }
  function stockCell(b, r, cat, sub, link) {
    const w = Math.max(0, r.w - G), h = Math.max(0, r.h - G), k = reg({ kind: 'stock', b, cat, sub });
    if (!w || !h) return `<div class="im-cell" data-k="${k}" style="${box(r, `background:${heat(b.d)}`)}"></div>`;   // no room: an empty box
    const label = b.members.length > 1 ? b.members.map((x) => x.sym).join('+') : b.t;   // share classes: every ticker when it fits
    let fs = Math.max(9, Math.min(R() * 1.7, Math.sqrt(w * h) / 6)), pad = Math.max(2, fs * .35), aw = w - 2 * pad, inner = '', ctr = false;
    const name = tw(label, fs) <= aw ? label : b.t;
    const tkw = tw(name, fs); if (tkw > aw) { fs = fs * aw / tkw * .98; pad = Math.max(2, fs * .35); aw = w - 2 * pad; }
    if (fs >= 8 && h >= fs * 1.18 + 2 * pad - 1) {
      const avail = Math.floor((h - 2 * pad) / (fs * 1.18)), wt = pc(b.w), mv = fp(b.d, 2), fs2 = fs * .9, fitW = (s, f) => tw(s, f, 800) <= aw;
      inner = `<div class="im-nm" style="font-size:${fs}px">${esc(name)}</div>`;
      if (avail >= 3 && fitW(wt, fs2) && fitW(mv, fs2)) { inner += `<div class="im-wt" style="font-size:${fs2}px">${wt}</div><div class="im-mv" style="font-size:${fs2}px">${mv}</div>`; ctr = w > 70; }
      else if (avail >= 2 && fitW(wt + ' · ' + mv, fs2)) inner += `<div class="im-wt" style="font-size:${fs2}px">${wt} · ${mv}</div>`;
      else if (avail >= 2 && fitW(mv, fs2)) inner += `<div class="im-mv" style="font-size:${fs2}px">${mv}</div>`;   // two lines: the move; the box size already shows the weight
    }
    return `<div class="im-cell${ctr ? ' ctr' : ''}"${link ? co(b.t) : ''} data-k="${k}" style="${box(r, `background:${heat(b.d)};padding:${pad}px;font-size:${fs}px`)}">${inner}</div>`;
  }
  const stocksIn = (list, W, H, y, cat, sub, link) => squarify(list.map((b) => ({ b, v: b.w })), 0, y, W, H).map((q) => stockCell(q.b, q, cat, sub, link)).join('');
  function subGroup(s, cat, r, link, zk) {
    const fs = Math.max(9.5, R() * .85), hh = Math.round(fs * 1.7);
    let hd = s.stocks.length > 1 && r.w >= 60 && r.h >= hh * 2.4 && cat.id !== NP ? hh : 0, hs = '';
    if (hd) { hs = head(r, hd, fs, s.short, pcg(s.w), s.d, 'rgba(0,0,0,.12)', false) || ''; if (!hs) hd = 0; }
    const k = reg({ kind: 'sub', s, cat });
    return `<div class="im-grp sub" data-k="${k}"${zk ? ` data-z="${esc(zk)}"` : ''} style="${box(r, 'background:rgba(0,0,0,.18)')}">${hs}${stocksIn(s.stocks, r.w - G, r.h - G - hd, hd, cat, s, link)}</div>`;
  }
  function catGroup(c, r) {   // the whole-fund view: a click anywhere in a Cat zooms into it, so its boxes carry no company link here
    const fs = Math.max(10.5, R() * .98), hh = Math.round(fs * 1.75), hd = r.w >= 64 && r.h >= hh * 2.2 ? hh : 0, k = reg({ kind: 'cat', c });
    const W = r.w - G, H = r.h - G - hd;
    let h = `<div class="im-grp" data-k="${k}" data-z="${esc(c.id)}" style="${box(r, 'background:rgba(0,0,0,.24)')}">`;
    if (hd) h += head(r, hd, fs, c.short, pcg(c.w), c.d, 'rgba(0,0,0,.2)', true);
    if (c.id === NP) h += stocksIn(c.stocks, W, H, hd, c, null, false);
    else squarify(c.subs.map((s) => ({ s, v: s.w })), 0, hd, W, H).forEach((q) => { h += subGroup(q.s, c, q, false, c.id); });
    return h + '</div>';
  }

  /* ---- crumb and legend ---- */
  function chrome(o, m, zc) {
    const F = o.fund, name = F === 'SPY' ? 'SPY · S&amp;P 500 fund' : 'QQQ · Nasdaq 100 fund', src = F === 'SPY' ? 'State Street' : 'Invesco', n = m.tree.reduce((a, c) => a + c.stocks.length, 0);
    const nt = 'margin-left:.5rem;font-weight:600';
    $('crumb').innerHTML = zc
      ? `<a data-z="">${name}</a><span class="sep">›</span><span class="cur">${esc(zc.name)}</span><span class="note" style="${nt}">${pcg(zc.w)} of the ${F} · ${zc.stocks.length} ${zc.stocks.length === 1 ? 'stock' : 'stocks'} · weights as of ${o.asOf}, ${src}</span>`
      :`<span class="cur">${name}</span><span class="note" style="${nt}">${n} companies · official weights as of ${o.asOf}, ${src}</span>`;
    const np = m.tree.find((c) => c.id === NP), bits = [`Box size = official weight in the ${F}; colour = today's move (<i class="na"></i> not available)`];
    if (np) bits.push(`${np.stocks.length} ${np.stocks.length === 1 ? 'holding' : 'holdings'} not yet placed in a Cat (${np.w.toFixed(2)}%)`);
    if (m.other > 0) bits.push(`excludes cash and index futures (${m.other.toFixed(2)}%)`);
    if (m.noWeight) bits.push(`${m.noWeight} without a weight left out`);
    bits.push(zc ? 'click a company to open it (where Mowgli has one)' : 'click a Cat to zoom in');
    legend(bits.join(' · '));
    const nn = $('legend').querySelector('.note'); if (nn) nn.title = nn.textContent;
  }

  /* ---- tooltip ---- */
  const tip = Object.assign(document.createElement('div'), { id: 'imtip' });
  document.body.appendChild(tip);
  function tipHtml(n) {
    const F = S.mode;
    if (n.kind === 'stock') {
      const b = n.b, mem = b.members.length > 1 ? `<div class="t2">Move is blended by weight across share classes: ${b.members.map((x) => `${esc(x.sym)} ${pc(x.w)} (${fp(x.d)})`).join(' + ')}</div>` : '';
      return `<b>${esc(b.n)}</b> (${esc(b.members.map((x) => x.sym).join(' + '))})<div class="t2">${esc(n.cat.name)}${n.sub ? ' › ' + esc(n.sub.name) : ''}</div><div class="t3">${pc(b.w)} of the ${F} · today <span class="${cls(b.d)}">${fp(b.d)}</span></div>${mem}`;
    }
    if (n.kind === 'sub') return `<b>${esc(n.s.name)}</b><div class="t2">${esc(n.cat.name)} · ${n.s.stocks.length} ${n.s.stocks.length === 1 ? 'stock' : 'stocks'}</div><div class="t3">${pc(n.s.w)} of the ${F} · weighted move <span class="${cls(n.s.d)}">${fp(n.s.d)}</span></div>`;
    return `<b>${esc(n.c.name)}</b><div class="t2">${n.c.stocks.length} stocks in ${n.c.subs.length} ${n.c.subs.length === 1 ? 'Sub' : 'Subs'}</div><div class="t3">${pc(n.c.w)} of the ${F} · weighted move <span class="${cls(n.c.d)}">${fp(n.c.d)}</span></div>`;
  }
  const mapEl = document.getElementById('map');   // loads before monitor.js, so its $ helper does not exist yet
  mapEl.addEventListener('mousemove', (e) => {
    const t = e.target.closest('[data-k]'), n = t && NODES[+t.dataset.k]; if (!n) { tip.style.display = 'none'; return; }
    tip.innerHTML = tipHtml(n); tip.style.display = 'block';
    tip.style.left = Math.min(e.clientX + 16, innerWidth - tip.offsetWidth - 8) + 'px'; tip.style.top = Math.min(e.clientY + 16, innerHeight - tip.offsetHeight - 8) + 'px';
  });
  mapEl.addEventListener('mouseleave', () => { tip.style.display = 'none'; });

  /* ---- the map: o = { E: the fund's holdings, fund: 'SPY' | 'QQQ', asOf: text }; returns { has(holding), label } for the list beside it ---- */
  window.drawIndexMap = function (el, o) {
    tip.style.display = 'none';
    if (!GR?.cats) { el.innerHTML = '<div class="msg">The Cat and Sub lists did not come with the data, so this view is not available yet.</div>'; $('crumb').innerHTML = `<span class="cur">${o.fund}</span>`; legend(''); return { has: (h) => !nonStock(h) && h.w > 0, label: '' }; }
    const m = build(o.E), W = el.clientWidth, H = el.clientHeight, zc = S.zoom && m.tree.find((c) => c.id === S.zoom);
    NODES = []; let h = '';
    if (!zc) squarify(m.tree.map((c) => ({ c, v: c.w })), 0, 0, W, H).forEach((r) => { h += catGroup(r.c, r); });
    else if (zc.id === NP) h = stocksIn(zc.stocks, W, H, 0, zc, null, true);
    else squarify(zc.subs.map((s) => ({ s, v: s.w })), 0, 0, W, H).forEach((q) => { h += subGroup(q.s, zc, q, true, ''); });
    el.innerHTML = h; chrome(o, m, zc);
    // for the smaller-holdings list: the map's own rule for which holdings count (no cash or futures; inside the zoomed Cat when zoomed)
    const inCat = zc ? new Set(zc.stocks.flatMap((b) => b.members.map((x) => x.sym))) : null;
    return { has: (h) => !nonStock(h) && h.w > 0 && (!inCat || inCat.has(ysym(h.t))), label: zc ? zc.short : '' };
  };
})();
