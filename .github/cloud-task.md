# FrameCritic v0.2 Product Quality Sprint

## Mission

Advance FrameCritic as a real local-first visual QA gate for AI-built web applications. This is a finite engineering sprint, not an hours-generation exercise. Work only on capabilities that materially improve the product for real developers and strengthen its open-source quality, usability, technical depth, and truthful storytelling.

Preserve the core product promise:
- local-first
- deterministic runtime; no AI inference at scan time
- no accounts, billing, cloud storage, telemetry, or hosted service
- no fake customers, adoption, revenue, accuracy, compliance, or benchmark claims
- no Hackatime/time-tracking manipulation or claims about time credit
- do not publish an npm package
- do not edit `.github/workflows/cloud-builder.yml`
- do not touch unrelated repositories

Before implementation, inspect the current source, tests, fixtures, README, package metadata, CLI help, artifact shapes, and existing limitations. If a requested capability is already genuinely implemented, verify it and skip duplicate work. Do not weaken existing detectors or tests to make new work pass.

Work in the milestone order below. COMPLETE AND COMMIT EACH MILESTONE before beginning the next. Every milestone must include relevant automated tests and actual output inspection where applicable. Keep commits focused and descriptive.

---

## Milestone 1 — Target-page accessibility diagnostics

Implement an opt-in deterministic target-page accessibility scan, preferably exposed as `--a11y` on `framecritic scan`.

Requirements:
- Use a reputable deterministic engine already compatible with the project (axe-core is currently a dev dependency; if runtime execution requires it in the published package, move/configure dependencies correctly rather than relying on a dev-only package).
- Run against the TARGET page, not merely FrameCritic's generated report.
- Keep it opt-in so existing default scan behavior/performance remains stable.
- Convert automated accessibility violations into structured FrameCritic findings with stable type/severity/evidence fields and useful affected selectors/nodes.
- Integrate results into `findings.json`, `report.html`, `AGENT_FIXES.md`, policy/summary counts where appropriate, and annotated evidence only where a meaningful element rect can be measured.
- Clearly label results as automated accessibility findings, NOT WCAG compliance certification.
- Handle malformed/incomplete node evidence safely; escape rendered text; do not leak credentials from target URLs.
- Add an intentional accessibility fixture covering at least missing image alternative text, unlabeled control/form input, and one clean counterpart.
- Add CLI parsing/validation, unit/integration tests, and verify a real fixture scan artifact.
- Update help/docs/limitations truthfully only after the feature is working.

Acceptance evidence before commit:
- build passes
- relevant tests pass
- a fixture scan with `--a11y` produces real structured findings and report output
- a normal scan without `--a11y` remains functional

---

## Milestone 2 — Bounded responsive width sweep

Add an optional responsive sweep mode that finds layout problems between the three existing presets instead of requiring users to guess breakpoints.

Suggested interface: `--sweep <min>:<max>:<step>` (adjust syntax only if inspection shows a cleaner backward-compatible design).

Requirements:
- Strict validation: sensible positive integers, min <= max, bounded dimensions, bounded total generated widths.
- Hard cap at 12 generated sweep widths so a typo cannot create an unbounded scan.
- Use a stable height policy and document it; do not pretend this is every possible responsive state.
- Make sweep-generated viewport labels deterministic and compatible with findings/report/compare fingerprints.
- Decide and test clear behavior when `--sweep` and `--viewport` are supplied together (reject ambiguity or define explicit composition).
- Reuse the existing detector/capture pipeline rather than create a parallel scanning engine.
- Report which widths are affected and make the HTML/JSON output navigable even when many widths exist.
- Add tests for parsing, boundaries, cap enforcement, normal operation, and a fixture whose issue appears only across a breakpoint range.
- Verify actual scan output across multiple generated widths.

Acceptance evidence before commit:
- build passes
- relevant tests pass
- bounded sweep catches a real breakpoint-specific fixture defect
- existing preset/custom viewport behavior remains compatible

---

## Milestone 3 — Expand safe declarative scenarios

Extend the existing no-eval scenario engine with useful deterministic interaction actions from the documented roadmap.

Implement at least:
- `scroll` (safe bounded target or coordinate semantics)
- `select` for `<select>` controls
- a safe keyboard-combination action (for example modifiers + key) with strict schema validation

Requirements:
- No `eval`, arbitrary JavaScript, shell execution, URL navigation scripts, or executable user code.
- Maintain the existing global step count/wait limits and add action-specific bounds where needed.
- Produce clear validation and runtime errors identifying the failing step.
- Preserve per-viewport independence.
- Add realistic fixtures/tests proving each new action changes page state and that invalid payloads fail safely.
- Ensure trace mode and scenario metadata continue to work together.
- Update CLI help/examples/docs only after verification.

Acceptance evidence before commit:
- build passes
- scenario unit/integration tests pass
- each new action is demonstrated by a real fixture scenario
- old click/fill/hover/press/wait scenarios still pass

---

## Milestone 4 — Multi-route application scan

Add a bounded way to scan a small real web application across multiple routes in one invocation while reusing the existing single-page engine.

Preferred shape after inspecting architecture: something like `framecritic scan <base-url> --routes <routes.json>`.

Requirements:
- Declarative JSON only; no executable configuration.
- Maximum 20 routes per batch.
- Each route needs a stable name/path and may optionally reference a safe existing scenario file if that integrates cleanly.
- Resolve relative route paths against the base URL safely; reject unsupported protocols and malformed entries.
- Isolate route artifacts in deterministic subdirectories so screenshots/traces/findings do not collide.
- Produce a top-level machine-readable batch summary and a human-readable HTML index linking to each route report.
- Aggregate counts without losing route identity.
- A failure on one route should be represented clearly; define whether scanning continues for the remaining routes and test that behavior.
- Existing single-route invocation must remain backward compatible.
- Add a multi-route fixture/app and integration tests with at least one clean route and one intentionally defective route.
- Do not introduce a cloud crawler or arbitrary site spidering. This is an explicit bounded route manifest only.

Acceptance evidence before commit:
- build passes
- relevant tests pass
- a real multi-route fixture run creates isolated route evidence plus combined JSON/HTML summary
- single-page scan still passes

---

## Milestone 5 — Artifact contract, dogfood, packaging, and truthful v0.2 docs

Finish the sprint by making the enlarged output surface dependable for humans, agents, and CI consumers.

Requirements:
- Add an explicit additive artifact/schema version to machine-readable scan output and a small artifact manifest that inventories generated evidence (findings/report/agent fixes/screenshots/traces/batch output when applicable). Avoid unnecessary breaking changes.
- Test schema/artifact stability and path safety.
- Add one end-to-end dogfood path covering the most important newly completed capabilities. Inspect the actual JSON/HTML/markdown output, not only exit codes.
- Review generated HTML accessibility/keyboard behavior after any UI changes and retain existing report accessibility tests.
- Update README quick start, implemented-features list, architecture, detector/accessibility descriptions, examples, limitations, and roadmap so they exactly match what was actually completed.
- Remove roadmap checkboxes only for features that truly shipped; leave unfinished items clearly planned.
- Update CLI help consistently.
- If a report UI changed materially and a new screenshot would improve documentation, generate a real screenshot from a real fixture; never fabricate an image or output.
- Re-run packaging checks and ensure any new runtime dependency required by finished features is actually included in the installable package.
- Do not change version merely for appearance; only change package version if project conventions and completed work justify it. Do not publish.

Final mandatory verification before marking the ENTIRE task complete:
1. `npm ci`
2. `npm run build`
3. install Playwright Chromium if the environment needs it
4. `npm test`
5. `node scripts/package-smoke.js`
6. `npm pack --dry-run`
7. `node dist/cli.js --help`
8. inspect `git status` and the milestone commit history
9. inspect representative generated artifacts from completed capabilities

Only create `.cloud-agent-complete` if all five milestones are genuinely completed and verified. If model/time budget ends first, leave the marker absent; the workflow will preserve only your committed, independently verified milestones in an INCOMPLETE draft PR for human review.
