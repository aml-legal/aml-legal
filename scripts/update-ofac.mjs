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
// OFAC_CRYPTO_ADDRESSES_EXT / OFAC_PULL_DATE live in app.js (extracted out of
// index.html's inline <script> during a performance pass — see commit
// history). This script was written against the old inline location and
// updated to point here instead; the two freshness strings inside index.html
// itself (prose + JSON-LD, matched below) are unaffected by that move.
const APP_JS_PATH = path.join(__dirname, "..", "app.js");
const APP_MIN_JS_PATH = path.join(__dirname, "..", "app.min.js");
const INDEX_PATH = path.join(__dirname, "..", "index.html");

// Mirror repo publishes one file PER CHAIN (sanctioned_addresses_<TICKER>.txt)
// on its `lists` branch, not one combined file. The dataset this project
// ships covers BTC/LTC/BCH/ETC/ZEC/ETH/TRX (documented on /about.html;
// Solana isn't covered because the mirror doesn't parse it out of OFAC's XML
// yet) — so this script has to fetch each of those chain files separately
// and concatenate them. Fetching only XBT (Bitcoin), as an earlier version of
// this script did, silently drops every ETH and TRX address — a serious
// regression for a tool whose main selling point is USDT screening, since
// USDT mostly lives on those two chains.
const ASSET_TICKERS = ["XBT", "LTC", "BCH", "ETC", "ZEC", "ETH", "TRX"];
const listUrl = (ticker) =>
  `https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/sanctioned_addresses_${ticker}.txt`;

const NAMED_SNAPSHOT_NOTE =
  "// Named snapshot (OFAC_SNAPSHOT) is curated by hand from OFAC recent-actions\n" +
  "// press releases and is NOT touched by this script — only the unnamed\n" +
  "// extended list below is machine-refreshed.";

async function fetchAddressList() {
  const all = [];
  for (const ticker of ASSET_TICKERS) {
    const url = listUrl(ticker);
    try {
      const res = await fetch(url);
      if (!res.ok) {
        if (res.status === 404) {
          // Some chains currently have zero OFAC-designated addresses, and
          // the mirror may not publish an (empty) file for them at all.
          // That's a legitimate state, not a fetch failure.
          console.warn(`  ${ticker}: no file (404) — treating as 0 addresses.`);
          continue;
        }
        throw new Error(`Fetch failed for ${ticker} (${url}): ${res.status} ${res.statusText}`);
      }
      const text = await res.text();
      const addrs = text.split("\n").map((line) => line.trim()).filter(Boolean);
      console.log(`  ${ticker}: ${addrs.length} addresses`);
      all.push(...addrs);
    } catch (err) {
      // Bitcoin is the one chain guaranteed to have hundreds of entries —
      // treat a failure fetching it as fatal. A hiccup on a smaller chain's
      // file shouldn't abort the whole refresh.
      if (ticker === "XBT") throw err;
      console.warn(`  ${ticker}: skipped due to fetch error — ${err.message}`);
    }
  }
  // Dedupe defensively (Set matching downstream is case-insensitive anyway).
  return [...new Set(all)];
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
  console.log(`Fetching current OFAC crypto-address list (${ASSET_TICKERS.join("/")})...`);
  const addresses = await fetchAddressList();

  if (addresses.length < 500) {
    // Sanity check — the combined multi-chain list is normally in the high
    // hundreds (758 at the time this script was fixed). If the mirror
    // returns something tiny, it's more likely a broken fetch (redirect,
    // rate limit, HTML error page, or an asset ticker 404-ing unexpectedly)
    // than a genuine mass-delisting. Fail loud rather than silently shipping
    // a gutted sanctions list.
    throw new Error(
      `Only got ${addresses.length} addresses across ${ASSET_TICKERS.join("/")} — expected 500+. ` +
        `Aborting to avoid overwriting good data with a bad fetch.`
    );
  }

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD, UTC
  const total = addresses.length + 22; // + the 22 hand-curated named entries

  // --- app.js: the actual data + the constant every freshness badge reads ---
  let appJs = await readFile(APP_JS_PATH, "utf8");

  const arrayRegex = /const OFAC_CRYPTO_ADDRESSES_EXT = \[[\s\S]*?\];/;
  if (!arrayRegex.test(appJs)) {
    throw new Error("Could not find OFAC_CRYPTO_ADDRESSES_EXT array in app.js — aborting.");
  }
  const newArray =
    `const OFAC_CRYPTO_ADDRESSES_EXT = [\n` +
    chunkIntoJsArrayLiteral(addresses) +
    `\n];`;
  appJs = appJs.replace(arrayRegex, newArray);

  const dateRegex = /const OFAC_PULL_DATE = "\d{4}-\d{2}-\d{2}";/;
  if (!dateRegex.test(appJs)) {
    throw new Error("Could not find OFAC_PULL_DATE constant in app.js — aborting.");
  }
  appJs = appJs.replace(dateRegex, `const OFAC_PULL_DATE = "${today}";`);

  appJs = appJs.replace(
    /Pulled: \d{4}-\d{2}-\d{2}\. Not covered: Solana/,
    `Pulled: ${today}. Not covered: Solana`
  );

  await writeFile(APP_JS_PATH, appJs, "utf8");

  // app.min.js is what index.html actually loads in production. This script
  // has no build-tool dependency of its own, so it patches the same two
  // values into the minified file with the same regexes minus whitespace —
  // the paired GitHub Actions workflow re-minifies properly with terser
  // right after this script runs, so this is just a safety net in case that
  // step is ever skipped or run standalone.
  try {
    let appMinJs = await readFile(APP_MIN_JS_PATH, "utf8");
    appMinJs = appMinJs.replace(
      /const OFAC_CRYPTO_ADDRESSES_EXT=\[[\s\S]*?\];/,
      `const OFAC_CRYPTO_ADDRESSES_EXT=[${addresses.map((a) => JSON.stringify(a)).join(",")}];`
    );
    appMinJs = appMinJs.replace(
      /const OFAC_PULL_DATE="\d{4}-\d{2}-\d{2}";/,
      `const OFAC_PULL_DATE="${today}";`
    );
    await writeFile(APP_MIN_JS_PATH, appMinJs, "utf8");
  } catch (err) {
    console.warn("Could not patch app.min.js directly (non-fatal — the workflow's terser step covers this):", err.message);
  }

  // --- index.html: only the prose/schema mentions of the total count, plus
  //     bumping the cache-busting query string so browsers actually fetch
  //     the new app.min.js instead of serving a stale cached copy forever. ---
  let html = await readFile(INDEX_PATH, "utf8");

  html = html.replace(/\b780\b(?=[^<]*(?:REAL OFAC|OFAC[- ]sanctioned|crypto addresses))/g, String(total));

  // The "This build, in numbers" stat card has the figure and its label in
  // separate sibling <div>s (live-num / live-cap), so the lookahead above
  // — which only looks within the same tag's text — never reaches across
  // that tag boundary to see "crypto addresses". Handled explicitly here.
  html = html.replace(/(<div class="live-num">)780(<\/div>)/, `$1${total}$2`);
  const prettyDate = new Date(today + "T00:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }); // e.g. "Aug 27, 2026" — same format the page's own JS badges use
  html = html.replace(/pulled [A-Z][a-z]{2} \d{1,2}, \d{4}(?= — see)/, `pulled ${prettyDate}`);

  html = html.replace(/app\.min\.js\?v=\d{4}-\d{2}-\d{2}/, `app.min.js?v=${today}`);

  await writeFile(INDEX_PATH, html, "utf8");

  console.log(
    `Done. ${addresses.length} extended addresses + 22 named = ${total} total. ` +
      `OFAC_PULL_DATE set to ${today} in app.js (and app.min.js, and index.html's cache-busting query string).`
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
