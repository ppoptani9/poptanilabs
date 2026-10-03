# Poptani Labs

**Live:** [poptanilabs.com](https://poptanilabs.com)

A tiny workshop for free personal-finance web tools, starting with the Indian mutual fund market.
Everything runs in the browser — no sign-up, no accounts, no tracking. Free forever.

## Tools

| Tool | URL | What it does |
|------|-----|--------------|
| SWP Simulator | [/swp/](https://poptanilabs.com/swp/) | Backtest systematic withdrawal plans on real NAV history — monthly payouts, XIRR, year-by-year schedule, CSV export |
| SIP Calculator | [/sip/](https://poptanilabs.com/sip/) | Backtest SIPs with annual step-up on real NAV history — invested vs. current value, XIRR, schedule, CSV export |
| Fund Overlap X-Ray | [/xray/](https://poptanilabs.com/xray/) | Compare 2–4 funds' stock holdings side by side — common stocks, unique bets, overlap % |

Plus a [blog](https://poptanilabs.com/blog/) with twice-weekly mutual fund news roundups.

## Tech stack

- **Vanilla HTML / CSS / JavaScript** — no framework, no build step
- **Chart.js** (CDN) for growth charts
- **Google Fonts** — Fraunces for display, Inter for UI
- **Data:** live NAV from [mfapi.in](https://www.mfapi.in) (free, no key); fund holdings from public portfolio disclosures (see `data/`)

## Getting started

No dependencies. Serve the folder and open it:

```bash
cd poptanilabs
python3 -m http.server 8080
# open http://localhost:8080
```

## Project structure

```
├── index.html            # homepage
├── styles.css            # shared stylesheet (light + dark themes)
├── app.js                # SWP simulator logic
├── sip.js                # SIP calculator logic
├── xray.js               # fund overlap logic
├── swp/  sip/  xray/     # tool pages
├── blog/                 # news roundups
├── data/
│   ├── funds.json        # fund list for the X-Ray picker
│   └── holdings.json     # cleaned equity holdings (181 funds, from public disclosures)
├── about.html  privacy.html  contact.html
├── favicon.svg               # vector source — PNG/ICO favicons are generated, see scripts/
├── scripts/
│   └── generate_favicons.py  # rebuild raster favicons from favicon.svg
├── robots.txt  sitemap.xml  ads.txt
└── docs/DEPLOY.md        # how this gets to production
```

## Deployment

Production is a **Cloudflare Pages** project (`poptanilabs`) fed by **manual zip upload** —
there is no CI. See [docs/DEPLOY.md](docs/DEPLOY.md) for the release checklist
(cache-busting version strings included).

## Data sources & attribution

- Mutual fund NAV history: [mfapi.in](https://www.mfapi.in) (free public API)
- Fund portfolio holdings: compiled from AMCs' public monthly disclosures
- Nothing on this site is investment advice. See the disclaimer on every tool page.

## License

MIT — see [LICENSE](LICENSE).
