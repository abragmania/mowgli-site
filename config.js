/* One config value for the published site: the URL of the Cloudflare price relay, printed by
   `npx wrangler deploy` in cloudflare/quote-worker/ (for example https://mowgli-quote.<account>.workers.dev).
   Empty means the published pages show the price baked at publish time, marked stale. Ignored by the local server. */
window.MOWGLI_CONFIG = { quoteWorker: 'https://mowgli-quote.abragmania.workers.dev' };
