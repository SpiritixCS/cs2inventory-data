#!/usr/bin/env node
/* =========================================================================
   fetch-csfloat.mjs
   Reads the existing skinport-cs2.json for the item list, queries CSFloat's
   public listings API for each item above €1.00, converts USD cents → EUR
   using the Frankfurter exchange rate API, and writes csfloat-cs2.json.

   Exits non-zero on any failure so the workflow turns red.
   ========================================================================= */

import { readFileSync, writeFileSync } from 'node:fs';

const OUTPUT       = 'csfloat-cs2.json';
const BATCH_SIZE   = 20;
const BATCH_DELAY  = 600;   // ms between batches
const MIN_PRICE    = 1.00;  // skip items cheaper than €1 (stickers, keys, etc.)
const MIN_ITEMS    = 100;   // abort if fewer than this many items priced (signals outage)

// ── 1. Exchange rate ───────────────────────────────────────────────────────
console.log('Fetching EUR/USD exchange rate…');
const rateRes = await fetch('https://api.frankfurter.app/latest?from=USD&to=EUR');
if (!rateRes.ok) {
  console.error(`✗ Exchange rate fetch failed: HTTP ${rateRes.status}`);
  process.exit(1);
}
const rateData = await rateRes.json();
if (!rateData.rates?.EUR) {
  console.error('✗ Unexpected exchange rate response:', JSON.stringify(rateData));
  process.exit(1);
}
const exchangeRate = rateData.rates.EUR;
console.log(`  1 USD = ${exchangeRate} EUR`);

// ── 2. Item list from Skinport snapshot ───────────────────────────────────
console.log('Loading Skinport item list…');
const skinportRaw = readFileSync('skinport-cs2.json', 'utf8');
const skinportData = JSON.parse(skinportRaw);
const names = skinportData.items
  .filter(it => (it.min_price ?? 0) > MIN_PRICE)
  .map(it => it.market_hash_name);
console.log(`  ${names.length} items above €${MIN_PRICE}`);

// ── 3. Query CSFloat per item ─────────────────────────────────────────────
let _debugCount = 0;
async function fetchLowestAsk(marketHashName) {
  const encoded = encodeURIComponent(marketHashName);
  const url = `https://csfloat.com/api/v1/listings?market_hash_name=${encoded}&sort_by=lowest_price&type=buy_now&limit=1`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const bodyText = await res.text();
    if (_debugCount < 3) {
      _debugCount++;
      console.log(`[DEBUG #${_debugCount}] ${marketHashName}`);
      console.log(`  status: ${res.status}`);
      console.log(`  body: ${bodyText.slice(0, 500)}`);
    }
    if (!res.ok) return null;
    let body;
    try { body = JSON.parse(bodyText); } catch { return null; }
    const arr = Array.isArray(body.data) ? body.data : (Array.isArray(body) ? body : []);
    if (!arr.length) return null;
    return arr[0].price; // USD cents
  } catch (e) {
    if (_debugCount < 3) {
      _debugCount++;
      console.log(`[DEBUG #${_debugCount}] ${marketHashName} — EXCEPTION: ${e.message}`);
    }
    return null;
  }
}

async function processBatch(batch) {
  return (await Promise.all(
    batch.map(async (name) => {
      const cents = await fetchLowestAsk(name);
      if (cents == null) return null;
      return {
        market_hash_name: name,
        price_eur: Math.round((cents / 100) * exchangeRate * 100) / 100,
      };
    })
  )).filter(Boolean);
}

console.log(`Querying CSFloat for ${names.length} items (batches of ${BATCH_SIZE})…`);
const items = [];
for (let i = 0; i < names.length; i += BATCH_SIZE) {
  const batch = names.slice(i, i + BATCH_SIZE);
  const results = await processBatch(batch);
  items.push(...results);
  const done = Math.min(i + BATCH_SIZE, names.length);
  if (done % (BATCH_SIZE * 10) === 0 || done === names.length) {
    console.log(`  ${done}/${names.length} queried — ${items.length} priced`);
  }
  if (i + BATCH_SIZE < names.length) {
    await new Promise(r => setTimeout(r, BATCH_DELAY));
  }
}

// ── 4. Abort guard ────────────────────────────────────────────────────────
if (items.length < MIN_ITEMS) {
  console.error(`✗ Only ${items.length} items priced — aborting (CSFloat likely down or rate-limited)`);
  process.exit(1);
}

// ── 5. Write snapshot ─────────────────────────────────────────────────────
const output = {
  fetched_at:    new Date().toISOString(),
  exchange_rate: exchangeRate,
  count:         items.length,
  items,
};
writeFileSync(OUTPUT, JSON.stringify(output));
console.log(`✓ Wrote ${items.length} items to ${OUTPUT}`);
