#!/usr/bin/env node
// -----------------------------------------------------------------------------
// update-ofac.mjs
//
// Pulls the current OFAC digital-currency address list (via the community
// mirror at github.com/0xB10C/ofac-sanctioned-digital-currency-addresses,
// whose `lists` branch re-syncs nightly from OFAC's own sdn_advanced.xml) and
// rewrites OFAC_CRYPTO_ADDRESSES_EXT + OFAC_PULL_DATE directly inside
// index.html. Nothing about the site's architecture changes: the data still
// ships as a plain static array in the HTML you serve — this script just
// keeps that array from going stale because someone forgot to update it by
// hand.
//
// Usage:
//   node scripts/update-ofac.mjs
//
// Intended to run on a schedule via the paired GitHub Actions workflow at
// .github/workflows/update-ofac.yml, which commits the diff automatically.
// -----------------------------------------------------------------------------

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = path.join(__dirname, "..", "index.html");

// Mirror repo's raw file list — one plain address per line, grouped by chain.
// Only BTC/LTC/BCH/ETC/ZEC/ETH/TRX addresses are included; the mirror does not
// yet parse Solana out of OFAC's XML (documented as a known limitation on
// /about.html — don't quietly "fix" that by omission if it changes upstream).
const SOURCE_URL =
  "https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/sanctioned_addresses_XBT.txt";

const NAMED_SNAPSHOT_NOTE =
  "// Named snapshot (OFAC_SNAPSHOT) is curated by hand from OFAC recent-actions\n" +
  "// press releases and is NOT touched by this script — only the unnamed\n" +
  "// extended list below is machine-refreshed.";

async function fetchAddressList(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Fetch failed for ${url}: ${res.status} ${res.statusText}`);
  }
  const text = await res.text();
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function chunkIntoJsArrayLiteral(addresses, perLine = 6, indent = "  ") {
  const rows = [];
  for (let i = 0; i < addresses.length; i += perLine) {
    rows.push(
      indent + addresses.slice(i, i + perLine).map((a) => JSON.stringify(a)).join(",")
    );
  }
  return rows.join(",\n");
}

async function main() {
  console.log("Fetching current OFAC crypto-address list...");
  const addresses = await fetchAddressList(SOURCE_URL);

  if (addresses.length < 500) {
    // Sanity check — the real list is in the high hundreds. If the mirror
    // returns something tiny, it's more likely a broken fetch (redirect,
    // rate limit, HTML error page) than a genuine mass-delisting. Fail loud
    // rather than silently shipping a gutted sanctions list.
    throw new Error(
      `Only got ${addresses.length} addresses — expected 500+. Aborting to avoid ` +
        `overwriting good data with a bad fetch.`
    );
  }

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD, UTC

  let html = await readFile(INDEX_PATH, "utf8");

  // 1) Replace the array contents of OFAC_CRYPTO_ADDRESSES_EXT.
  const arrayRegex = /const OFAC_CRYPTO_ADDRESSES_EXT = \[[\s\S]*?\];/;
  if (!arrayRegex.test(html)) {
    throw new Error("Could not find OFAC_CRYPTO_ADDRESSES_EXT array in index.html — aborting.");
  }
  const newArray =
    `const OFAC_CRYPTO_ADDRESSES_EXT = [\n` +
    chunkIntoJsArrayLiteral(addresses) +
    `\n];`;
  html = html.replace(arrayRegex, newArray);

  // 2) Bump the single freshness date constant used by every badge on the page.
  const dateRegex = /const OFAC_PULL_DATE = "\d{4}-\d{2}-\d{2}";/;
  if (!dateRegex.test(html)) {
    throw new Error("Could not find OFAC_PULL_DATE constant in index.html — aborting.");
  }
  html = html.replace(dateRegex, `const OFAC_PULL_DATE = "${today}";`);

  // 3) Update the visible "Pulled: YYYY-MM-DD" comment above the array, and
  //    the total-address count wherever it's hardcoded in prose/schema.
  html = html.replace(
    /Pulled: \d{4}-\d{2}-\d{2}\. Not covered: Solana/,
    `Pulled: ${today}. Not covered: Solana`
  );
  const total = addresses.length + 22; // + the 22 hand-curated named entries
  html = html.replace(/\b780\b(?=[^<]*(?:REAL OFAC|OFAC[- ]sanctioned|crypto addresses))/g, String(total));

  await writeFile(INDEX_PATH, html, "utf8");

  console.log(
    `Done. ${addresses.length} extended addresses + 22 named = ${total} total. ` +
      `OFAC_PULL_DATE set to ${today}.`
  );
  console.log(
    "Also update the same date/count on about.html's stat row and change log by hand " +
      "if this run changes the total meaningfully — that page is a human-readable " +
      "audit trail, not something this script should silently rewrite."
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
