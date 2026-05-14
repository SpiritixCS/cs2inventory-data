#!/usr/bin/env node
/* =========================================================================
   fetch-skinport.mjs
   Fetches Skinport's full CS2 price list (EUR) and writes it to
   skinport-cs2.json at the repo root.

   Designed for GitHub Actions on Node 20+ where the built-in fetch
   auto-decompresses Brotli (which Skinport's API requires).

   Exits non-zero on any failure so the workflow turns red.
   ========================================================================= */

import { writeFileSync } from 'node:fs';

const URL = 'https://api.skinport.com/v1/items?app_id=730&currency=EUR';
const OUTPUT = 'skinport-cs2.json';

console.log(`Fetching ${URL}`);

const res = await fetch(URL, {
  headers: {
    // Skinport requires Brotli — sending br in Accept-Encoding signals support.
    // Node 20+ fetch (undici) auto-decompresses, so the response body is plain JSON.
    'Accept-Encoding': 'gzip, deflate, br',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  },
});

if (!res.ok) {
  console.error(`✗ Skinport returned HTTP ${res.status}`);
  console.error(await res.text());
  process.exit(1);
}

const data = await res.json();

// Skinport returns an array on success; anything else is an error envelope
// (e.g. { errors: [{ id: 'rate_limit_exceeded', ... }] })
if (!Array.isArray(data)) {
  console.error('✗ Unexpected response shape (not an array):');
  console.error(JSON.stringify(data, null, 2));
  process.exit(1);
}

const output = {
  fetched_at: new Date().toISOString(),
  app_id: 730,
  currency: 'EUR',
  count: data.length,
  items: data,
};

writeFileSync(OUTPUT, JSON.stringify(output));
console.log(`✓ Wrote ${data.length} items to ${OUTPUT}`);

