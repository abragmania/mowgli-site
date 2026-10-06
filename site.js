/* Where the pages find their data. Local server: /api/... and /c/<T>. Published site (GitHub Pages under
   /mowgli-site/): the build injects <meta name="mowgli-static" content="/mowgli-site/"> and the same data comes
   from baked files under data/. Loaded before company.js and list.html's script. */
(() => {
  const m = document.querySelector('meta[name="mowgli-static"]');
  const isStatic = !!m;
  const base = isStatic ? (m.content || '/') : '/';
  const cfg = window.MOWGLI_CONFIG || {};
  const enc = encodeURIComponent;
  window.MG = {
    isStatic,
    base,
    quoteWorker: isStatic ? String(cfg.quoteWorker || '').replace(/\/+$/, '') : '',
    companyUrl: (t) => (isStatic ? `${base}data/company/${enc(t)}.json` : `/api/company/${enc(t)}`),
    companiesUrl: () => (isStatic ? `${base}data/companies.json` : '/api/companies'),
    // D90 switchboard (catalog, Adam's switches, rev): the local server answers live; the published site reads the baked copy
    switchboardUrl: () => (isStatic ? `${base}data/switchboard.json` : '/api/switchboard'),
    // Monitor: local server answers /api/monitor; the published site asks the Worker, and falls back to the copy baked at publish
    monitorUrl() { return isStatic ? (this.quoteWorker ? `${this.quoteWorker}/monitor` : '') : '/api/monitor'; },
    logosUrl: () => (isStatic ? `${base}data/logos.json` : '/api/monitor/logos'),
    logoBase: isStatic ? `${base}logos/` : '/logos/',
    monitorBakedUrl: () => (isStatic ? `${base}data/monitor.json` : ''),
    pageUrl: (t) => (isStatic ? `${base}c/${enc(t)}/` : `/c/${enc(t)}`),
    tickerFromPath() {
      const parts = location.pathname.split('/').filter(Boolean);
      const i = parts.indexOf('c');
      return decodeURIComponent(parts[i + 1] || 'MO');
    },
  };
})();
