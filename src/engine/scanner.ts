import { chromium, type Page } from "playwright";
import fsSync from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { VIEWPORTS, type ScanReport, type Finding, type ViewportResult, type AnnotationBox, type PolicyOptions, ARTIFACT_VERSION, type Manifest } from "../types.js";
import { collectPageFindings } from "./detect.js";
import { generateHtmlReport } from "./report.js";
import { generateAgentFixesMarkdown } from "./agentFixes.js";
import { loadConfig, applyIgnoreRules } from "../config.js";
import { evaluatePolicy } from "../policy.js";
import { loadScenario, executeScenario } from "../scenario.js";
import { redactUrl, redactSecrets } from "../security.js";
import { collectA11yFindings } from "./a11y.js";

export type ScanOptions = {
  url: string;
  outDir: string;
  viewports?: typeof VIEWPORTS;
  configPath?: string;
  policy?: PolicyOptions;
  scenarioPath?: string;
  trace?: boolean;
  a11y?: boolean;
};

function normalizeUrl(input: string): string {
  let u = input.trim();
  const redactedInput = redactUrl(input);
  if (!u) throw new Error(`Invalid URL "${redactedInput}": empty URL`);
  // If input contains "://" but not http(s), treat as invalid
  if (u.includes("://") && !/^https?:\/\//i.test(u)) {
    throw new Error(`Invalid URL "${redactedInput}": unsupported protocol`);
  }
  if (!/^https?:\/\//i.test(u)) u = "http://" + u;
  // Validate URL
  try {
    const parsed = new URL(u);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error(`Unsupported protocol ${parsed.protocol}`);
  } catch (e: any) {
    throw new Error(`Invalid URL "${redactedInput}": ${e.message}`);
  }
  return u;
}

// Validate output path is safe — deterministic, non-secret-leaking
function assertSafeOutDir(outDir: string): void {
  if (outDir.includes("\0")) throw new Error(`Invalid output path`);
  // Output collision: outDir exists as a file (not directory) → concise deterministic error
  try {
    if (fsSync.existsSync(outDir) && !fsSync.statSync(outDir).isDirectory()) {
      throw new Error(`Output directory collision: "${outDir}" exists and is not a directory`);
    }
  } catch (e: any) {
    if (e.message.startsWith("Output directory collision")) throw e;
    // ignore stat errors (e.g., permission) — mkdir will surface them deterministically
  }
  // Existing directory is reused deterministically (artifacts overwritten, not merged ambiguously).
  // This is documented behavior: re-running with same --output overwrites findings.json/report.html.
}

function sanitizeFinding(f: Finding): Finding {
  // Redact secrets from message and details shallowly — preserves determinism, prevents credential leakage
  const msg = typeof f.message === "string" ? redactSecrets(redactUrl(f.message)) : f.message;
  let details: Record<string, unknown> | undefined = f.details as any;
  if (details) {
    const copy: Record<string, unknown> = { ...details };
    // redact common url-like string fields
    for (const k of ["url", "src", "text", "location", "stack", "error", "message"]) {
      const v = (copy as any)[k];
      if (typeof v === "string") (copy as any)[k] = redactSecrets(redactUrl(v));
      else if (v && typeof v === "object") {
        // for location objects, redact url field
        const loc: any = v;
        if (typeof loc.url === "string") loc.url = redactSecrets(redactUrl(loc.url));
        if (typeof loc.stack === "string") loc.stack = redactSecrets(loc.stack);
      }
    }
    // For broken-image images array, redact src
    if (Array.isArray((copy as any).images)) {
      (copy as any).images = (copy as any).images.map((img: any) => {
        if (img && typeof img.src === "string") return { ...img, src: redactSecrets(redactUrl(img.src)) };
        return img;
      });
    }
    details = copy;
  }
  return { ...f, message: msg, details };
}

function buildAnnotationBoxes(findings: Finding[]): { boxes: AnnotationBox[] } {
  const boxes: AnnotationBox[] = [];
  let nextId = 1;
  for (const f of findings) {
    const ids: number[] = [];
    const d: any = f.details ?? {};
    if (f.type === "horizontal-overflow") {
      for (const o of d.offenders ?? []) {
        if (o?.rect) {
          boxes.push({
            id: nextId,
            x: o.rect.x,
            y: o.rect.y,
            w: o.rect.w,
            h: o.rect.h,
            type: f.type,
            severity: f.severity,
            label: "overflow",
            selector: o.selector,
          });
          ids.push(nextId++);
        }
      }
    } else if (f.type === "outside-viewport") {
      for (const e of d.elements ?? []) {
        if (e?.rect) {
          boxes.push({
            id: nextId,
            x: e.rect.x,
            y: e.rect.y,
            w: e.rect.w,
            h: e.rect.h,
            type: f.type,
            severity: f.severity,
            label: "offscreen",
            selector: e.selector,
          });
          ids.push(nextId++);
        }
      }
    } else if (f.type === "overlapping-elements") {
      for (const p of d.pairs ?? []) {
        const ov = p.overlap;
        // ov now has x,y,w,h for the overlap region
        if (ov && typeof ov.w === "number" && typeof ov.h === "number" && ov.w > 0 && ov.h > 0) {
          const x = typeof ov.x === "number" ? ov.x : 0;
          const y = typeof ov.y === "number" ? ov.y : 0;
          boxes.push({
            id: nextId,
            x,
            y,
            w: ov.w,
            h: ov.h,
            type: f.type,
            severity: f.severity,
            label: "overlap",
            selector: `${p.a} ↔ ${p.b}`,
          });
          ids.push(nextId++);
        }
      }
    } else if (f.type === "broken-image") {
      for (const img of d.images ?? []) {
        if (img?.rect && img.rect.w > 0 && img.rect.h > 0) {
          boxes.push({
            id: nextId,
            x: img.rect.x,
            y: img.rect.y,
            w: img.rect.w,
            h: img.rect.h,
            type: f.type,
            severity: f.severity,
            label: "broken-img",
            selector: img.selector,
          });
          ids.push(nextId++);
        } else if (img?.rect) {
          // Fallback: small box at rect position even if collapsed
          boxes.push({
            id: nextId,
            x: img.rect.x,
            y: img.rect.y,
            w: Math.max(img.rect.w, 40),
            h: Math.max(img.rect.h, 32),
            type: f.type,
            severity: f.severity,
            label: "broken-img",
            selector: img.selector,
          });
          ids.push(nextId++);
        }
      }
    } else if (f.type === "accessibility") {
      for (const n of d.nodes ?? []) {
        if (!n?.rect) continue;
        // only annotate if meaningful rect: at least 4px in one dimension or explicit hotspot
        const w = typeof n.rect.w === "number" ? n.rect.w : 0;
        const h = typeof n.rect.h === "number" ? n.rect.h : 0;
        const meaningful = (w > 4 && h > 4) || (w > 0 && h > 0);
        if (!meaningful) continue;
        const x = typeof n.rect.x === "number" ? n.rect.x : 0;
        const y = typeof n.rect.y === "number" ? n.rect.y : 0;
        boxes.push({
          id: nextId,
          x,
          y,
          w: Math.max(w, 12),
          h: Math.max(h, 12),
          type: f.type,
          severity: f.severity,
          label: `a11y:${d.rule ?? "violation"}`,
          selector: n.selector ?? n.target?.join?.(" ") ?? "",
        });
        ids.push(nextId++);
        if (ids.length >= 12) break; // cap per finding
      }
    }
    if (ids.length) f.markerIds = ids;
  }
  return { boxes };
}

async function injectAnnotations(page: Page, boxes: AnnotationBox[]): Promise<void> {
  if (!boxes.length) return;
  await page.evaluate((boxes: AnnotationBox[]) => {
    const existing = document.getElementById("__fc_overlay");
    if (existing) existing.remove();
    const overlay = document.createElement("div");
    overlay.id = "__fc_overlay";
    overlay.style.position = "absolute";
    overlay.style.left = "0";
    overlay.style.top = "0";
    overlay.style.width = Math.max(document.documentElement.scrollWidth, window.innerWidth) + "px";
    overlay.style.height = Math.max(document.documentElement.scrollHeight, window.innerHeight) + "px";
    overlay.style.pointerEvents = "none";
    overlay.style.zIndex = "2147483647";
    overlay.style.overflow = "visible";

    for (const b of boxes as any[]) {
      const box = document.createElement("div");
      const isErr = b.severity === "error";
      const color = isErr ? "#ff4d6a" : "#ffb020";
      const bg = isErr ? "rgba(255,77,106,0.14)" : "rgba(255,176,32,0.16)";
      box.style.position = "absolute";
      box.style.left = b.x + "px";
      box.style.top = b.y + "px";
      box.style.width = Math.max(b.w, 12) + "px";
      box.style.height = Math.max(b.h, 12) + "px";
      box.style.border = `3px solid ${color}`;
      box.style.background = bg;
      box.style.borderRadius = "8px";
      box.style.boxShadow = `0 0 0 3px ${isErr ? "rgba(255,77,106,0.28)" : "rgba(255,176,32,0.28)"}, 0 4px 16px rgba(0,0,0,0.25)`;
      box.style.boxSizing = "border-box";

      const badge = document.createElement("div");
      badge.textContent = String(b.id);
      badge.style.position = "absolute";
      badge.style.left = "-12px";
      badge.style.top = "-14px";
      badge.style.width = "28px";
      badge.style.height = "28px";
      badge.style.borderRadius = "50%";
      badge.style.background = color;
      badge.style.color = isErr ? "#fff" : "#111";
      badge.style.fontFamily = "ui-sans-system, -apple-system, Segoe UI, Roboto, sans-serif";
      badge.style.fontWeight = "800";
      badge.style.fontSize = "14px";
      badge.style.lineHeight = "28px";
      badge.style.textAlign = "center";
      badge.style.boxShadow = "0 2px 10px rgba(0,0,0,0.35)";
      badge.style.border = "2px solid #fff";
      badge.dataset.fcId = String(b.id);

      const label = document.createElement("div");
      label.textContent = `${b.id} · ${b.label}`;
      label.style.position = "absolute";
      label.style.left = "20px";
      label.style.top = "-10px";
      label.style.background = "#0b0e14";
      label.style.color = "#fff";
      label.style.fontFamily = "ui-monospace, monospace";
      label.style.fontSize = "10px";
      label.style.fontWeight = "700";
      label.style.padding = "2px 6px";
      label.style.borderRadius = "6px";
      label.style.border = `1px solid ${color}`;
      label.style.whiteSpace = "nowrap";
      label.style.lineHeight = "14px";

      box.appendChild(badge);
      box.appendChild(label);
      overlay.appendChild(box);
    }
    document.body.appendChild(overlay);
  }, boxes as any);
}

async function removeAnnotations(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.getElementById("__fc_overlay")?.remove();
  });
}

export async function scanUrl(opts: ScanOptions): Promise<ScanReport> {
  const urlRaw = normalizeUrl(opts.url);
  const url = redactUrl(urlRaw); // redacted for artifacts
  const urlForNavigation = urlRaw; // raw for actual fetch, preserves credentials/tokens needed to fetch
  const viewports = opts.viewports ?? VIEWPORTS;
  const outDir = opts.outDir;
  assertSafeOutDir(outDir);
  const timestamp = new Date().toISOString();

  // Load config (throws on malformed / missing explicit)
  const { config, path: configPath } = loadConfig({ explicitPath: opts.configPath });

  // Load scenario if provided (throws on malformed)
  const scenario = opts.scenarioPath ? loadScenario(opts.scenarioPath) : null;

  await mkdir(outDir, { recursive: true });
  await mkdir(path.join(outDir, "screenshots"), { recursive: true });
  if (opts.trace) await mkdir(path.join(outDir, "traces"), { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const results: ViewportResult[] = [];
  const allFindings: Finding[] = [];
  const allSuppressed: Array<{ finding: Finding; reason: string }> = [];
  const traceFiles: string[] = [];

  try {
    for (const vp of viewports) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: 1,
      });
      if (opts.trace) {
        await context.tracing.start({ screenshots: true, snapshots: true });
      }
      const page = await context.newPage();

      const consoleErrors: Finding[] = [];
      const pageErrors: Finding[] = [];

      page.on("console", (msg) => {
        if (msg.type() === "error") {
          const text = msg.text();
          consoleErrors.push({
            type: "console-error",
            severity: "error",
            viewport: vp.label,
            message: `Console error: ${text.slice(0, 400)}`,
            details: { text, location: msg.location() },
          });
        }
      });

      page.on("pageerror", (err) => {
        pageErrors.push({
          type: "page-error",
          severity: "error",
          viewport: vp.label,
          message: `Page error: ${err.message.slice(0, 500)}`,
          details: { stack: err.stack?.slice(0, 1500), message: err.message },
        });
      });

      page.on("response", (res) => {
        const status = res.status();
        const reqUrl = redactUrl(res.url());
        if (status >= 400) {
          if (reqUrl.endsWith("favicon.ico") && status === 404) return;
          pageErrors.push({
            type: "page-error",
            severity: status >= 500 ? "error" : "warning",
            viewport: vp.label,
            message: `Failed request ${status} — ${reqUrl.slice(0, 300)}`,
            details: { status, url: reqUrl },
          });
        }
      });

      try {
        await page.goto(urlForNavigation, { waitUntil: "domcontentloaded", timeout: 15000 });
        await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
      } catch (e: any) {
        pageErrors.push({
          type: "page-error",
          severity: "error",
          viewport: vp.label,
          message: `Navigation failed: ${e?.message?.slice(0, 500) ?? String(e)}`,
          details: { error: String(e) },
        });
      }

      await page.waitForTimeout(1000);

      // Execute scenario if present, independently per viewport
      let scenarioFindings: Finding[] = [];
      if (scenario) {
        const exec = await executeScenario(page, scenario);
        // tag viewport and scenario name
        for (const f of exec.findings) {
          f.viewport = vp.label;
          f.scenario = scenario.name;
        }
        scenarioFindings = exec.findings;
        // allow a settle after scenario before detection
        await page.waitForTimeout(300);
      }

      const rawFindings = await collectPageFindings(page, vp.label, consoleErrors, pageErrors);
      let a11yFindings: Finding[] = [];
      if (opts.a11y) {
        try {
          a11yFindings = await collectA11yFindings(page, vp.label);
          // tag scenario if active for consistency
          if (scenario) for (const f of a11yFindings) if (!f.scenario) f.scenario = scenario.name;
        } catch (e: any) {
          a11yFindings = [{
            type: "accessibility",
            severity: "warning",
            viewport: vp.label,
            message: `[a11y] Accessibility scan error: ${String(e?.message ?? e).slice(0,300)}`,
            details: { error: String(e?.message ?? e).slice(0,1000), disclaimer: "Automated accessibility check — NOT WCAG compliance certification." },
          }];
        }
      }
      // merge scenario failure findings + detection findings + a11y
      const rawMerged = [...scenarioFindings.map(f => ({ ...f })), ...rawFindings, ...a11yFindings];
      // tag scenario name on all findings when scenario active
      if (scenario) {
        for (const f of rawMerged) {
          if (!f.scenario) f.scenario = scenario.name;
        }
      }
      // Redact secrets from messages and details before persistence — deterministic, no leakage
      const findings = rawMerged.map(sanitizeFinding);

      const seen = new Set<string>();
      const deduped: Finding[] = [];
      for (const f of findings) {
        const key = `${f.type}:${f.message}`;
        if (f.type === "page-error" || f.type === "console-error") {
          if (seen.has(key)) continue;
          seen.add(key);
        }
        deduped.push(f);
      }

      // Apply ignore rules
      const { kept, suppressed } = applyIgnoreRules(deduped, config);
      allSuppressed.push(...suppressed);

      // Build annotation boxes and attach markerIds to kept findings only
      const { boxes } = buildAnnotationBoxes(kept);

      const screenshotRel = `screenshots/${vp.label}-${vp.width}x${vp.height}.png`;
      const annotatedRel = boxes.length ? `screenshots/${vp.label}-${vp.width}x${vp.height}-annotated.png` : undefined;
      const screenshotAbs = path.join(outDir, screenshotRel);
      const annotatedAbs = annotatedRel ? path.join(outDir, annotatedRel) : null;

      // Clean screenshot first
      await page.screenshot({ path: screenshotAbs, fullPage: true });

      // Annotated screenshot (if there are boxes)
      if (boxes.length && annotatedAbs) {
        await injectAnnotations(page, boxes);
        await page.waitForTimeout(250);
        await page.screenshot({ path: annotatedAbs, fullPage: true });
        await removeAnnotations(page);
      }

      const vr: ViewportResult = {
        viewport: vp,
        screenshot: screenshotRel,
        annotatedScreenshot: annotatedRel,
        annotations: boxes,
        findings: kept,
      };
      results.push(vr);
      allFindings.push(...kept);

      if (opts.trace) {
        const traceRel = `traces/${vp.label}-${vp.width}x${vp.height}.zip`;
        const traceAbs = path.join(outDir, traceRel);
        await context.tracing.stop({ path: traceAbs });
        traceFiles.push(traceRel);
      }

      await context.close();
    }
  } finally {
    await browser.close();
  }

  const summary = {
    total: allFindings.length,
    errors: allFindings.filter((f) => f.severity === "error").length,
    warnings: allFindings.filter((f) => f.severity === "warning").length,
    infos: allFindings.filter((f) => f.severity === "info").length,
  };

  const suppression = allSuppressed.length || configPath
    ? {
        totalSuppressed: allSuppressed.length,
        suppressed: allSuppressed,
        configPath: configPath ?? null,
      }
    : undefined;

  let policyDecision: ScanReport["policy"] | undefined;
  if (opts.policy) {
    policyDecision = evaluatePolicy(summary, opts.policy);
  } else {
    // default policy for backwards compat: fail on error
    policyDecision = evaluatePolicy(summary, { failOn: "error" });
  }

  const screenshots = results.flatMap((r) => {
    const arr = [r.screenshot];
    if (r.annotatedScreenshot) arr.push(r.annotatedScreenshot);
    return arr;
  });
  const manifest: Manifest = {
    artifactVersion: ARTIFACT_VERSION,
    generatedAt: timestamp,
    kind: "single",
    artifacts: {
      findings: "findings.json",
      report: "report.html",
      agentFixes: "AGENT_FIXES.md",
      manifest: "manifest.json",
      screenshots,
      traces: traceFiles.length ? [...traceFiles] : undefined,
    },
  };

  const report: ScanReport = {
    artifactVersion: ARTIFACT_VERSION,
    url,
    timestamp,
    viewports,
    results,
    findings: allFindings,
    summary,
    suppression,
    policy: policyDecision,
    scenario: scenario ? { name: scenario.name, steps: scenario.steps, file: opts.scenarioPath ?? null } as any : null,
    trace: opts.trace ? { enabled: true, files: traceFiles } : null,
    a11y: opts.a11y ? { enabled: true } : null,
    manifest,
  };

  await writeFile(path.join(outDir, "findings.json"), JSON.stringify(report, null, 2), "utf-8");
  const html = generateHtmlReport(report);
  await writeFile(path.join(outDir, "report.html"), html, "utf-8");
  const fixesMd = generateAgentFixesMarkdown(report);
  await writeFile(path.join(outDir, "AGENT_FIXES.md"), fixesMd, "utf-8");
  await writeFile(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");

  return report;
}
