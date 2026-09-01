# FrameCritic v0.1 — local visual QA

Local-first visual inspector for AI-built web apps. No accounts, no cloud, no AI calls.

## What it does

- Accepts a `localhost` or public URL via dashboard or CLI
- Captures screenshots at **390×844** (mobile), **768×1024** (tablet), **1440×900** (desktop) via Playwright
- Detects: horizontal overflow, elements outside viewport, overlapping visible elements, broken images, console/page errors
- Produces `screenshots/`, `findings.json`, and a readable `report.html`

## Run

```bash
npm install
npx playwright install chromium

# Dashboard (recommended)
npm run build
npm start
# → http://localhost:3030

# CLI
npm run scan -- http://localhost:3001
```

## Demo verification

```bash
node demo-app/server.js        # fixture on http://localhost:3001 (intentionally buggy)
npm run scan -- http://localhost:3001
```

Artifacts go to `framecritic-out/scan-<timestamp>/`.
