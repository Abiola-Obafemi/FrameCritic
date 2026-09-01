import { chromium, type Page } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { VIEWPORTS, type ScanReport, type Finding, type ViewportResult } from "../types.js";
import { collectPageFindings } from "./detect.js";
import { generateHtmlReport } from "./report.js";

export type ScanOptions = {
  url: string;
  outDir: string;
  viewports?: typeof VIEWPORTS;
};

function normalizeUrl(input: string): string {
  let u = input.trim();
  if (!/^https?:\/\//i.test(u)) u = "http://" + u;
  return u;
}

export async function scanUrl(opts: ScanOptions): Promise<ScanReport> {
  const url = normalizeUrl(opts.url);
  const viewports = opts.viewports ?? VIEWPORTS;
  const outDir = opts.outDir;
  const timestamp = new Date().toISOString();

  await mkdir(outDir, { recursive: true });
  await mkdir(path.join(outDir, "screenshots"), { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const results: ViewportResult[] = [];
  const allFindings: Finding[] = [];

  try {
    for (const vp of viewports) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();

      const consoleErrors: Finding[] = [];
      const pageErrors: Finding[] = [];

      page.on("console", (msg) => {
        if (msg.type() === "error") {
          const text = msg.text();
          // Filter severe errors — ignore noisy warnings that are console.error but trivial
          // We keep all console.error entries as findings (spec says severe console/page errors)
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

      // Also capture failed requests (4xx/5xx) as severe errors
      page.on("response", (res) => {
        const status = res.status();
        const reqUrl = res.url();
        // Ignore non-document third-party noise? Keep all 4xx/5xx on page's own resources
        if (status >= 400) {
          // ignore favicon 404 spam unless it's the main page
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
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
        // Wait briefly for network to settle without hard-failing on pending third-party requests
        await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
      } catch (e: any) {
        // Record navigation failure and still try to continue
        pageErrors.push({
          type: "page-error",
          severity: "error",
          viewport: vp.label,
          message: `Navigation failed: ${e?.message?.slice(0, 500) ?? String(e)}`,
          details: { error: String(e) },
        });
      }

      // Give images a moment to load/fail
      await page.waitForTimeout(1000);

      const findings = await collectPageFindings(page, vp.label, consoleErrors, pageErrors);

      // Deduplicate console/page errors that may have duplicated across event handlers — keep as-is for now (they're already per-page)
      // But deduplicate failed-request duplicates
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

      const screenshotRel = `screenshots/${vp.label}-${vp.width}x${vp.height}.png`;
      const screenshotAbs = path.join(outDir, screenshotRel);
      await page.screenshot({ path: screenshotAbs, fullPage: true });

      const vr: ViewportResult = {
        viewport: vp,
        screenshot: screenshotRel,
        findings: deduped,
      };
      results.push(vr);
      allFindings.push(...deduped);

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

  const report: ScanReport = {
    url,
    timestamp,
    viewports,
    results,
    findings: allFindings,
    summary,
  };

  // Write findings.json
  await writeFile(path.join(outDir, "findings.json"), JSON.stringify(report, null, 2), "utf-8");

  // Write HTML report
  const html = generateHtmlReport(report);
  await writeFile(path.join(outDir, "report.html"), html, "utf-8");

  return report;
}
