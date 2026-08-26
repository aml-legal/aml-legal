# AML.legal

Free AML screening tool for crypto wallets and transactions — no sign-up,
no wallet connect, nothing stored. Live at [aml.legal](https://aml.legal).

This repo exists so the "verify the client-side code yourself" claim on the
site is actually checkable, not just a line of copy. Everything the checker
does happens in [`app.js`](./app.js) — no backend, no hidden API calls to a
paid data vendor.

## What it actually checks

| Check | Type | Source |
|---|---|---|
| OFAC SDN sanctions match | Static snapshot | [OFAC SDN list](https://ofac.treasury.gov/sanctions-list-search) — see `OFAC_SNAPSHOT` and `OFAC_CRYPTO_ADDRESSES_EXT` in `app.js` |
| Tether freeze registry | **Live**, on-chain | Direct call to the USDT contract's `isBlackListed(address)`, selector `0xe47d6060` |
| Sanctioned-mixer contracts | Static snapshot | Tornado Cash pool contracts (OFAC-designated Aug 2022) |
| FATF jurisdiction risk | Not wired | Disclosed as "not applicable" on the results page, not folded into the score |
| Scam / phishing labels | Not wired | Same — disclosed, not simulated |
| Multi-hop counterparty trace | Not wired | Same — disclosed, not simulated |

The three "not wired" checks are named explicitly in the UI and in the
JSON-LD `HowTo` schema on the homepage. Nothing is silently approximated.

## Data freshness

- `OFAC_SNAPSHOT` (named entities): manually synced from OFAC recent-actions
  press releases.
- `OFAC_CRYPTO_ADDRESSES_EXT` (full digital-currency address list): pulled
  from [`0xB10C/ofac-sanctioned-digital-currency-addresses`](https://github.com/0xB10C/ofac-sanctioned-digital-currency-addresses),
  a community mirror that re-syncs nightly from OFAC's own `sdn_advanced.xml`.
- [`scripts/update-ofac.mjs`](./scripts/update-ofac.mjs) automates the pull
  and rewrites the array in `index.html` directly — no database, the data
  still ships as a static array in the HTML you serve.
- [`.github/workflows/update-ofac.yml`](./.github/workflows/update-ofac.yml)
  runs that script nightly and opens a PR (not an auto-merge) so a human
  skims the diff before a new sanction or delisting goes live.

## Repo layout

```
index.html          Homepage — checker UI, knowledge base, FAQ
about.html           Methodology page — every data source named and linked
privacy.html          Privacy policy
terms.html            Terms of use
app.js / app.min.js   Checker logic + contact form handler (prod uses .min)
styles.css / .min.css Site styles (prod uses .min)
scripts/update-ofac.mjs   OFAC snapshot refresh script
.github/workflows/    Scheduled OFAC refresh automation
icons/, sitemap.xml, robots.txt, llms.txt   Standard site assets
```

## Local development

This is a static site — no build step required to view it.

```bash
git clone https://github.com/<your-username>/aml-legal.git
cd aml-legal
python3 -m http.server 8000
# open http://localhost:8000
```

If you edit `styles.css` or `app.js`, rebuild the minified versions before
deploying:

```bash
npx cleancss -o styles.min.css styles.css
npx terser app.js -o app.min.js --compress --mangle
```

## What this project is not

Not a registered compliance vendor, not a law firm, not a substitute for
paid enterprise screening (Chainalysis, Elliptic, etc.) where regulatory
obligations require one. See [`about.html`](./about.html) and
[`terms.html`](./terms.html) for the full disclosure.

## License

MIT — see [`LICENSE`](./LICENSE). The checker logic and static assets are
free to read, fork, and reuse. The `aml.legal` domain, brand, and hosted
service are not covered by this license.

## Contact

[email protected]
