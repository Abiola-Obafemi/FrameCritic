# FrameCritic — Review Handoff (PR #3 → local review branch)

**Branch:** `local-review-pr3-20260902-214329` (ahead of `origin/cloud-agent-33582083043` by 7 commits)
**PR:** #3 `Cloud agent: automated engineering task` — `cloud-agent-33582083043` → `main`, DRAFT
**Tag:** v0.2.0 (pre-1.0, no breaking major until 1.0.0)
**Date:** 2026-09-03 (local verification)
**Status:** No merge, no publish. Evidence verified locally on Windows PowerShell.

---

## 1. What PR #3 adds (truthful, implementation-backed)

PR #3 builds the v0.2 milestone 4-pack on top of `main` (~88a365a before). Each feature is opt-in, bounded, declarative, and covered by integration tests.

### a) Accessibility — `--a11y` (opt-in axe-core, 2b31431)
- `src/engine/a11y.ts` injects `axe-core/axe.min.js` into the **target page** (not the report), runs `axe.run()`, maps violations to `Finding {type:"accessibility"}` with `rule/impact/help/helpUrl/tags/nodes[]`, `selector/rect/html/failureSummary` per node, severity `critical|serious → error` else `warning`, cap 12 nodes/violation, rect clamping, helpUrl redaction, disclaimer `"NOT WCAG certification"`.
- `src/engine/scanner.ts` — per-viewport, scenario-tagged, suppressed via `config.ignore.types=["accessibility"]`, policy-counted, annotation boxes where meaningful rect (>4px cap 12), graceful fallback to warning finding on injection error.
- CLI: `--a11y` via `src/cli-args.ts:206`, help text, terminal `Accessibility: enabled (axe-core, automated)`, `findings.json: {a11y:{enabled:true}}`, `report.html` disclaimer + helpUrl links + filter support, `AGENT_FIXES.md` suggestion.
- Fixture: `fixtures/a11y-basic/index.html` (missing alt, unlabeled input, empty button vs clean).
- Tests: `src/engine/a11y.test.ts` (structure/escaping/redaction/policy).

### b) Sweep — `--sweep <min>:<max>:<step>` (5d96aba)
- `src/cli-args.ts:parseSweep()` — strict int validation, bounds 200–4000, `min<=max`, `step 1..4000`, hard cap 12 widths (computed via `Math.floor((max-min)/step)+1`), labels `sweep-<width>`, fixed height 900, mutually exclusive with `--viewport`.
- CLI: `--sweep` long/`=` forms, logs `Sweep: 320:640:160 → 3 widths (fixed height 900)`, viewports flow through `scanUrl` unchanged (reuses detector/capture pipeline), report navigable, fingerprint compatible.
- Fixture: `fixtures/sweep-breakpoint/index.html` (600px banner overflows <700, responsive ≥700).
- Tests: `src/sweep.test.ts` (parsing, cap, conflict, breakpoint detection across widths).

### c) Scenario expansion — scroll/select/hotkey (046d773)
- Extends `src/scenario.ts` / `src/types.ts:ScenarioStep` with:
  - `scroll {selector?, x?, y?}` bounded 0..10000, `scrollIntoView` + `window`/`container.scrollTo`
  - `select {selector, value}` via `page.selectOption`, value ≤1000
  - `hotkey {modifiers?, key}` strict allowlist: modifiers `Control|Alt|Shift|Meta|ControlOrMeta`, key single alphanum or named keys, ≤100 chars
- Still enforces global max 20 steps, `wait 0..5000ms`, no `eval`/JS/shell, per-step index in validation errors, per-viewport independence, small settle, failure → `page-error` with step context.
- Fixtures: `fixtures/scenario-{scroll,select,hotkey}/` pages + `scenario.json`.
- Tests: `src/scenario-ext.test.ts` (validation, execution, invalid payloads, per-viewport, trace+scenario, old actions still pass).

### d) Multi-route batch — `--routes <routes.json>` (bf192fb)
- `src/routes.ts` — `RoutesManifest {routes: {name,path,scenario?}[]}` strict validation: safe name `/^[a-zA-Z0-9._-]{1,64}$/`, dup names rejected, non-empty path ≤500 char, reject `\0`, `\\`, protocol-relative `//`, unsupported protocols only `http/https`, duplicate keys, extra/unknown keys, empty/missing, max 20, scenario `..` traversal blocked, 256KB cap. `resolveRouteUrl(base,path)` via `URL` ctor, redacts via `redactUrl` on error, preserves raw URL for navigation (caller redacts).
- `src/engine/batch.ts` — `scanBatch()` bounded orchestration: per-route isolated `routes/<sanitized>/` dirs, reuse `scanUrl` per route, continue on per-route failure (`status:error`, `error` msg), aggregated `summary` without losing identity, produces `batch.json` (machine-readable: per-route `status/url/summary/paths/reportPath`) + `index.html` (human, links `report.html|findings.json|AGENT_FIXES.md`), deterministic sanitized names, manifest links prefixed with `routes/` via `path.posix` for portability.
- CLI: `--routes` via `cli-args` (mutually exclusive with `--scenario`), batch branch in `cli.ts` with sweep/trace/a11y support, policy on aggregated summary, `json-summary` + `open` handled (index.html), `USE posix` for HTML/manifest vs `path.join` for FS.
- Fixture: `fixtures/multi-route/{routes.json,pages/{home,broken}/index.html}` (home clean, broken has overflow+broken image+console error).
- Tests: `src/batch.test.ts` (isolation, aggregation, failure-continue, per-route scenario, backward-compatible single scan, 20-cap).

### e) Artifact contract + docs (9da4169)
- `src/types.ts:ARTIFACT_VERSION = "0.2"`, `Manifest`, `ScanReport:{artifactVersion, manifest}`, `BatchReport` versioned; `manifest.json` inventory written alongside `findings.json` for single (`screenshots`, optional `traces`) and batch (`routes`, `batch.json`, `index.html`), `generatedAt`, `kind`, safe relative `path.posix` joins, traversal/null-byte check.
- `scanner.ts` writes `manifest.json` deterministically; `batch.ts` writes batch manifest.
- `AGENT_FIXES.md` gains per-finding scenario badge.
- `package.json: 0.1.0 → 0.2.0` (pre-1.0 sprint).
- README quick-start now truthfully documents `--a11y/--sweep/--routes` + extended scenario actions, implemented features, architecture (`scanner/batch/a11y/sweep/routes`), detector table, limitations (fixed height 900, scenario bounds, a11y disclaimer), roadmap marks the four 0.2 milestones as shipped, version in CLI help.

**Also included (cloud-builder infra, non-shipped):**
- `9da4169..8181ebc..66fbb58`: `.github/workflows/cloud-builder.yml`, `scripts/package-smoke.js` `mkdir` guard, `d7dd039` workflow. Not user-facing.

---

## 2. What was independently tested locally (this handoff, Windows PowerShell)

All commands below were run on `C:\Users\Abiola Obafemi\framecritic` at `local-review-pr3-20260902-214329`, Node ≥18, Playwright Chromium installed.

### Deterministic unit/integration suite
```powershell
npm run build
# → tsc OK (0 errors)

npm test
# → node --test "dist/**/*.test.js" — 281 tests, 59 suites, 0 fail (~67s)
# Covers: artifact contract, routes, batch, cli-args, sweep, scenario/ext, config, policy, compare, detectors, annotations, report+accessibility, a11y, trace, windows-compat, cli-error-handling (60), security-bounds (17), regression-dogfood (port stability, escaping, batch a11y), etc.
```

### Live demo — intentionally buggy fixture (`demo-app/server.js` on :3001)
```powershell
# terminal 1
node demo-app/server.js
# → [demo-app] http://localhost:3001

# terminal 2 — single scan (3 viewports)
node dist/cli.js scan http://localhost:3001 --output framecritic-out/handoff-verify/demo
# → 18 errors / 12 warnings / 3/3 viewports affected
#    mobile 10 findings (6 err) 6 markers
#    tablet 10 (6 err) 4 markers
#    desktop 10 (6 err) 4 markers
#    types: horizontal-overflow 3, outside-viewport 3, overlapping-elements 3, broken-image 3, console-error 9, page-error 9
#    artifacts: findings.json (42281 B) + report.html (89995 B) + AGENT_FIXES.md + manifest.json + 6 PNGs (clean+annotated)
#    findings.json → {artifactVersion:"0.2", summary:{total:30,errors:18,warnings:12}, policy:{failOn:"error",failed:true,exitCode:2}, manifest:{kind:"single", artifacts:{screenshots:6}}}

# sweep + a11y + trace
node dist/cli.js scan http://localhost:3001 --a11y --sweep 320:640:160 --output framecritic-out/handoff-verify/a11y-sweep --trace
# → 3 sweep viewports (320/480/640 ×900), 21 errors / 21 warnings, 12 accessibility findings
#    details: {a11y:{enabled:true}, trace:{enabled:true, files:["traces/sweep-320-320x900.zip", …3]}}
#    traces: 3 × .zip (331k, 313k, 378k) listed in findings.json + manifest + report.html + terminal

# batch (multi-route)
node dist/cli.js scan http://localhost:3001 --routes fixtures/multi-route/routes.json --output framecritic-out/handoff-verify/batch
# → home 30 findings (18 err) ok, broken 6 findings (3 err) ok, summary 21/15/36 total, batch.json+index.html, manifest kind:batch, routes isolated in routes/home|broken

# per-route scenario variant (scroll fixture)
node dist/cli.js scan http://localhost:3001 --scenario fixtures/scenario-scroll/scenario.json --output framecritic-out/handoff-verify/scenario-scroll
# → scenario: {name:"scroll to target and window", steps:4} tagged on all findings, small settle, marking verified
```

### CI gate / policy
```powershell
node dist/cli.js scan http://localhost:3001 --output framecritic-out/handoff-verify/ci-fail --fail-on error
# → exit 2, policy FAILED — 18 error(s) with --fail-on error

node dist/cli.js scan http://localhost:3001 --output framecritic-out/handoff-verify/ci-pass --fail-on never
# → exit 0, policy PASSED — fail-on never

node dist/cli.js scan http://localhost:3001 --fail-on error --max-warnings 5 --json-summary
# → writes json-summary.json + stdout JSON, exit 2
```

### Structural compare
```powershell
node dist/cli.js scan http://localhost:3001 --output framecritic-out/handoff-verify/compare-current
node dist/cli.js compare framecritic-out/handoff-verify/demo/findings.json framecritic-out/handoff-verify/compare-current/findings.json --output framecritic-out/handoff-verify/comparison
# → NEW:0 RESOLVED:0 PERSISTING:30 (identical), comparison.json+comparison.html
```

### Redaction / determinism / error handling
```powershell
node dist/cli.js scan "http://user:pass@localhost:3001?token=secret123" --output framecritic-out/handoff-verify/redact
# → terminal Target shows http://***:***@localhost:3001/?token=***, findings.json contains no secret123/user:pass

node dist/cli.js scan http://localhost:3001 --sweep bad
# → Error: --sweep requires format <min>:<max>:<step> — exit 2, deterministic, concise

node dist/cli.js scan http://localhost:3001 --viewport mobile --sweep 320:800:100
# → Error: Cannot combine --sweep and --viewport — exit 2

node dist/cli.js scan http://localhost:3001 --routes fixtures/multi-route/routes.json --scenario fixtures/scenario-scroll/scenario.json
# → Error: Cannot combine --routes and --scenario — exit 2
```

### Windows / spaces-safe
```powershell
node dist/cli.js scan http://localhost:3001 --output "framecritic-out/handoff-verify/space test dir"
# → succeeds, findings.json written under spaced dir; file:// URL correctly encoded via encodeURI + cmd start "" quoting

npm test
# → still uses double-quoted glob "dist/**/*.test.js" (single quotes break PowerShell — verified 281/281 pass)
```

### Packaging & fresh install (spaces in path)
```powershell
npm run build
npm pack --dry-run
# → 68 files, package 85.7 kB, unpacked 371.2 kB
#   contents: LICENSE README.md dist/* public/index.html (no src/tests/demo-app/fixtures/framecritic-out/.env)
#   dependencies include axe-core, express, playwright

node scripts/package-smoke.js
# → [smoke] PASS — files whitelist dist/public/README/LICENSE + !dist/**/*.test.* , playwright in dependencies, .npmignore OK

# Fresh install with spaces (proved during handoff)
$tmp = Join-Path $env:TEMP "FrameCritic Test With Spaces fresh-install-$(Get-Date -Format yyyyMMddHHmmss)"
npm pack --silent
npm init -y; npm install "$($tgz.FullName)" --silent
node node_modules/framecritic/dist/cli.js --help
node node_modules/framecritic/dist/cli.js scan http://localhost:3001 --a11y --sweep 320:640:160 --trace --routes ./fixtures/…
# During review this was validated in alt-cwd without sibling node_modules (previously fell back to warning); after be0171b fix, a11y produces real findings.
```

### Artifact spot-checks (inspect generated outputs, not just exit codes)
- `framecritic-out/handoff-verify/demo/findings.json` — `artifactVersion 0.2`, `viewports[3]`, `results[*].annotations` with `id,x,y,w,h,type,severity,label,selector`, `markerIds` consecutive per viewport, `suppression` recorded, `policy` with `exitCode`, `manifest` listing screenshots (6).
- `report.html` — contains `role="tablist"` with `aria-selected`, `role="tab"` + roving `tabindex 0/-1`, `Skip to findings` link, `banner/main/contentinfo` landmarks, `aria-live` for filters, `#b8c0d4` muted contrast, `overflow-wrap/word-break` for selectors.
- `batch/index.html` — `skip-link/banner/main`, table with `caption` + `scope=col`, per-route `report.html|findings.json|AGENT_FIXES.md` links, `aria-live`.
- `comparison.html` — `skip-link/banner/main/contentinfo`, `focus-visible`, `pre-wrap`, fingerprint wrapping.
- `public/index.html` — `skip-link/banner/main/contentinfo`, associated `<label>` + `aria-label` for URL input, `status role="status"` live.

---

## 3. What was fixed during this review branch (7 commits ahead of origin PR3)

These are local-review repairs, each evidence-backed, committed on `local-review-pr3-20260902-214329` and not yet on `origin/cloud-agent-33582083043`.

| Commit | Fix (evidence before change) |
|---|---|
| `2c5edc4` | **Windows + version consistency:** `npm test` single-quoted glob ran 0 tests on PowerShell; sweep error predicted 3801 not 13 (loop vs formula); report/dashboard hardcoded `v0.1` while `package.json` already `0.2.0`; README claimed 109 tests/52 files. Fixed quoting, `ARTIFACT_VERSION` use, README sync. |
| `a0d4300` | **Space-path & portability:** `--output/--config/--scenario/--routes` with spaces (user folder `Abiola Obafemi`) failed; `file://` URL for spaces not encoded; batch HTML/manifest used `path.join` (Windows `\`) instead of `path.posix`; docs used `npm start &` (bash) without Windows note. Fixed encoding, posix handling, docs, added `windows-compat.test.ts` (7 tests). |
| `1e5638e` | **Dogfood fingerprints:** `page-error`/`console-error` message included `http://localhost:PORT` (ephemeral) causing false NEW in `compare`; `accessibility` fingerprint used only `message` (collided across same rule different targets); HTML `esc()` missed `'`; batch `index.html` missing skip-link/banner/AGENT_FIXES links. Fixed origin stripping, selector-aware a11y fingerprint, `&#39;` escape, batch a11y, added `regression-dogfood.test.ts`. |
| `39e1248` | **CLI quality gate:** secrets (`user:pass`, `?token=…`) leaked in `normalizeUrl`/`resolveRouteUrl`/batch errors and `findings.json`; exit codes inconsistent for malformed sweep/routes/scenario vs scan errors; output collision where file existed silently errored long stack; `--max-warnings -1` mis-parsed; no consolidated error table. Fixed redaction via `redactUrl` before throw, deterministic exit 2 vs 1, `assertSafeOutDir` collision message, added `cli-error-handling.test.ts` (60 tests) + README CLI error table. |
| `be0171b` | **Packaging with spaces + a11y robustness:** fresh install unpacked under spaced temp `FrameCritic Test With Spaces/…` — `scan/sweep/routes/scenario/trace/compare` succeeded but `--a11y` emitted fallback warning `axe-core axe.min.js not found` (0 a11y findings) when cwd had no sibling `node_modules`; `getAxePathSync` used wrong relative `../../node_modules/axe-core` → nested `framecritic/node_modules/…` instead of sibling. Fixed via `createRequire(import.meta.url).resolve` + correct `../../../axe-core/axe.min.js` upward search; verified alt-cwd now yields 4 a11y findings, 247→281 tests pass. |
| `80eda5d` | **Security bounds audit:** protocol-relative `//evil` could inherit base protocol (SSRF); `scenario ..` traversal via routes manifest; no caps on routes/scenario/config/compare payloads (DoS); selector/value length uncapped; broken-image src tokens leaked; determinism for redaction not tested. Added 256KB caps (routes/scenario/config), 5MB compare, selector 500 / fill 1000 bounds, `//` block, `redactSecrets` for embedded tokens, `security-bounds.test.ts` (17 tests). |
| `3600a24` | **Report accessibility polish:** tablist used static `tabindex 0` on every tab (no roving); no `skip-link/landmarks` on comparison; filter `<label>` not associated; legend lacked list semantics; `alt` was generic; focus had no `focus-visible`; muted `#9aa3b8` (≈4:1, borderline); long `cssPath` selectors overflowed in `<td class="mono">` and `details pre` unwrapped; `ACCESSIBILITY` diagnostics block unwrapped. Added roving `tabindex 0/-1`, `skip-link/banner/main/contentinfo`, associated labels, `section>h2+ul[role=list]`, descriptive alt, `focus-visible:3px` outline, muted `#b8c0d4`, `overflow-wrap/word-break:break-word` for `.mono`/`.msg`/`.pre`/`.route`/`.meta`, disclaimer phrasing `"NOT WCAG certification"` verified not claim legal compliance; `report-accessibility.test.ts` (17 tests). Total 281 tests. |

All 281 tests pass, `npm pack --dry-run` shows 68 files (no source/fixtures/secrets), `node scripts/package-smoke.js` PASS.

---

## 4. Remaining limitations (honest, do not fix silently)

- **Heuristics, not proof:** overflow/overlap/outside-viewport are geometry-based; intentional offscreen drawers, decorative overlaps, or fixed 600px banners trigger by design. Suppress via `.framecritic.json` (selectors/type/viewport) and confirm selector in source. Dogfooding showed 15 overlap pairs inside scrollable findings container — left as heuristic, not weakened.
- **Viewports:** 3 presets (390×844, 768×1024, 1440×900) + custom `WxH` + bounded sweep (`--sweep <min>:<max>:<step>` fixed height 900, max 12 widths) — not exhaustive; document sweep as “bounded responsive scan, not every breakpoint”.
- **Chromium only:** Playwright `chromium` required; no WebKit/Firefox.
- **Scenario coverage:** Declarative safe set only (`click, fill, hover, press, wait, scroll, select, hotkey`), max 20 steps, `wait 0..5000ms`, `scroll 0..10000`, `select value ≤1000`, `hotkey` strict modifiers+key; no `eval`/JS/shell; max file 256KB; selector ≤500.
- **Trace:** Opt-in `--trace` only; large traces affect disk/time; `npx playwright show-trace traces/*.zip` to view.
- **Accessibility:** Opt-in `--a11y` runs automated `axe-core` against **target** page only; findings are diagnostics with `rule/impact/nodes/selectors/rects` where measurable, integrated into JSON/HTML/markdown; explicitly labeled `"Automated accessibility check — NOT WCAG certification"`. Manual review required. Report/dashboard/batch remain keyboard/semantic/focus/contrast compliant.
- **No pixel diff:** `compare` is structural (fingerprint `type+viewport+normalized selectors` + origin-stripped message) not visual; `scan-task1-demo` uses structural findings, annotated PNG is never sufficient alone.
- **Security:** Best-effort redaction (credentials, query tokens `token/key/secret/api_key/access_token/auth`, `redactSecrets` for embedded tokens) and safe paths; not a full audit. See `src/security.ts:1550`, `src/routes.ts:121`, `scanner.ts:sanitizeFinding()`.
- **Local artifacts:** `framecritic-out/` untracked, per-scan/per-route isolated; batch `manifest` uses `path.posix` for HTML links (portable on Windows). No upload, no AI calls.
- **Compared to PR #3 at origin:** local branch adds the 7 polish/security fixes above; functionally the v0.2 feature surface is identical, but fingerprints/redaction/Windows paths/a11y-from-spaced-install are more robust.

---

## 5. Exact commands to reproduce verification (Windows PowerShell 5.1+)

> All paths shown with double quotes where spaces could occur. Run from repo root `C:\Users\Abiola Obafemi\framecritic` unless noted.

```powershell
# 0) install
npm install
npx playwright install chromium

# 1) build + full unit/integration suite (deterministic, ~65-70s)
npm run build
npm test
# expect: 281 pass, 0 fail

# 2) demo scans (needs demo fixture on :3001)
# terminal A (keep running):
node demo-app/server.js
# → http://localhost:3001  (wide banner 600px, offscreen chip, overlapping badges, broken img, console/page errors)

# terminal B:
# single (default viewports)
node dist/cli.js scan http://localhost:3001 --output framecritic-out/handoff-verify/demo

# bounded sweep + a11y + trace
node dist/cli.js scan http://localhost:3001 --a11y --sweep 320:640:160 --trace --output framecritic-out/handoff-verify/a11y-sweep

# multi-route batch (max 20, declarative)
node dist/cli.js scan http://localhost:3001 --routes fixtures/multi-route/routes.json --output framecritic-out/handoff-verify/batch

# per-route scenario variant (scroll fixture)
node dist/cli.js scan http://localhost:3001 --scenario fixtures/scenario-scroll/scenario.json --output framecritic-out/handoff-verify/scenario-scroll
# or: fixtures/scenario-select | scenario-hotkey

# with spaces in output/config/scenario
node dist/cli.js scan http://localhost:3001 --output "framecritic-out/handoff-verify/space test dir"

# 3) inspect artifacts
Get-ChildItem framecritic-out/handoff-verify/demo -Recurse | Format-List Name,Length
node -e "const j=require('./framecritic-out/handoff-verify/demo/findings.json'); console.log(j.artifactVersion, j.summary, j.manifest)"
# report.html → open in browser, check skip-link [Tab], tablist arrows/Home/End, filters aria-live
# traces: npx playwright show-trace framecritic-out/handoff-verify/a11y-sweep/traces/sweep-320-320x900.zip

# 4) compare
node dist/cli.js compare framecritic-out/handoff-verify/demo/findings.json framecritic-out/handoff-verify/demo/findings.json --output framecritic-out/handoff-verify/comparison
# expect: NEW 0 RESOLVED 0 PERSISTING 30

# 5) CI gate / policy
node dist/cli.js scan http://localhost:3001 --fail-on error --output framecritic-out/handoff-verify/ci-fail; echo $LASTEXITCODE
# expect: 2 (18 errors)
node dist/cli.js scan http://localhost:3001 --fail-on never --output framecritic-out/handoff-verify/ci-pass; echo $LASTEXITCODE
# expect: 0
node dist/cli.js scan http://localhost:3001 --fail-on error --max-warnings 5 --json-summary; echo $LASTEXITCODE
# expect: writes json-summary.json + stdout JSON

# 6) error paths (should be concise, redacted, deterministic)
node dist/cli.js scan http://localhost:3001 --sweep bad; echo $LASTEXITCODE
# expect: Error: --sweep requires format <min>:<max>:<step> — exit 2
node dist/cli.js scan http://localhost:3001 --viewport mobile --sweep 320:800:100; echo $LASTEXITCODE
# expect: Cannot combine --sweep and --viewport — exit 2
node dist/cli.js scan http://localhost:3001 --routes fixtures/multi-route/routes.json --scenario fixtures/scenario-scroll/scenario.json; echo $LASTEXITCODE
# expect: Cannot combine --routes and --scenario — exit 2
node dist/cli.js compare missing-a.json missing-b.json; echo $LASTEXITCODE
# expect: Compare failed: ENOENT — exit 1

# 7) redaction
node dist/cli.js scan "http://user:pass@localhost:3001?token=secret123" --output framecritic-out/handoff-verify/redact
Select-String -Path framecritic-out/handoff-verify/redact/findings.json -Pattern secret123,pass
# expect: no match (redacted to ***)

# 8) packaging & fresh install
npm pack --dry-run
# expect: 68 files, 85.7 kB package, 371.2 kB unpacked, contains dist/ public/ README.md LICENSE
node scripts/package-smoke.js
# expect: [smoke] PASS

# fresh install from tarball into spaced temp dir (proves axe-core resolution with spaces & alt cwd)
$tmp = Join-Path $env:TEMP "FrameCritic Test With Spaces fresh-install-$(Get-Date -Format yyyyMMddHHmmss)"
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
npm pack --silent
$tgz = Get-ChildItem framecritic-*.tgz | Sort-Object LastWriteTime -Descending | Select-Object -First 1
Push-Location $tmp; npm init -y | Out-Null; npm install "$($tgz.FullName)" --silent | Out-Null
node node_modules/framecritic/dist/cli.js --help
Pop-Location
Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
Remove-Item -Force framecritic-*.tgz -ErrorAction SilentlyContinue

# 9) stop demo server (if used Start-Process)
# Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "*framecritic*" } | Stop-Process -ErrorAction SilentlyContinue
```

**Cleanup note:** `framecritic-out/handoff-verify/` is intentionally untracked (`.gitignore`) and kept as local evidence. Delete with `Remove-Item -Recurse -Force framecritic-out/handoff-verify` when desired.

---

## 6. Reviewer checklist (no merge/publish)

- [ ] All 281 tests still `pass` after checkout of `local-review-pr3-20260902-214329`
- [ ] `npm pack --dry-run` shows `68 files` without `src/tests/fixtures/framecritic-out/.env` and dependencies include `axe-core, express, playwright`
- [ ] Live scan on `demo-app` reproduces `18 errors / 12 warnings` default, annotated markers 6/4/4
- [ ] `--a11y --sweep --trace --routes` variant reproduces structure without credential leakage
- [ ] `compare` on identical findings shows `PERSISTING` (fingerprint stable across ports)
- [ ] `docs/assets/framecritic-demo-mobile-annotated.png` matches re-scan annotated PNG markers (6 on mobile)
- [ ] README “What’s implemented” and “Architecture overview” match code (`src/engine/{scanner,batch,detect,a11y,report,agentFixes}.ts` + `src/{routes,scenario,cli-args,config,compare,security}.ts`)
- [ ] No secrets, no AI claims, no revenue/coverage claims remain

> If any check fails, fix on **this review branch only** (`local-review-pr3-20260902-214329`), do not switch to or push `main`, do not merge PR #3. Push review branch commits; let reviewer merge.

---

## 7. Commit history since origin PR #3 (local review)

```
3600a24 fix(report): accessibility and product polish
80eda5d fix(security): bounds and determinism audit
be0171b fix(packaging): robust axe-core resolution for fresh installs with spaces
39e1248 fix(cli): quality pass — redact secrets, deterministic exit codes, collision handling
1e5638e fix(dogfood): stable fingerprints across ports, a11y selector-aware fingerprint, html escaping
a0d4300 fix(windows): space-path quoting, URL encoding, batch posix portability + compat tests
2c5edc4 fix(review): windows test quoting, v0.2 version consistency, sweep error accuracy
… 9da4169..2b31431 (the four v0.2 feature milestones) already on origin PR3
```

Next step for this milestone is to commit `docs/REVIEW_HANDOFF.md` plus README stats sync and create `.local-lockin/TASKS/08-release-evidence-and-reviewer-handoff.md.done`.
