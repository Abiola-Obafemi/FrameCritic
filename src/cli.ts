#!/usr/bin/env node
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { scanUrl } from "./engine/scanner.js";
import { parseArgs } from "./cli-args.js";

function getVersion(): string {
  try {
    const pkgPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    const raw = fs.readFileSync(pkgPath, "utf-8");
    return JSON.parse(raw).version ?? "0.1.0";
  } catch {
    return "0.1.0";
  }
}

function printHelp(): void {
  const v = getVersion();
  console.log(`FrameCritic v${v} — local-first visual QA for AI-built web apps
No cloud, no AI, no accounts.

Usage:
  framecritic scan <url> [options]
  framecritic scan <base-url> --routes <routes.json> [options]   (multi-route)
  framecritic compare <baseline.json> <current.json> [options]
  framecritic <url> [options]          (shorthand)

Options (scan):
  --output <dir>            Output directory (default: framecritic-out/scan-<timestamp>)
  --viewport <list>          Viewports to scan (comma-separated)
                             Built-ins: mobile (390×844), tablet (768×1024), desktop (1440×900)
                             Custom:    390x844,768x1024  or  mobile,desktop
  --sweep <min>:<max>:<step> Responsive width sweep (e.g. 320:1200:160)
                             Generates widths from min to max inclusive, step step,
                             fixed height 900 (stable, not every responsive state), max 12 widths
  --routes <file>            Declarative routes manifest JSON (max 20 routes, each {name, path, scenario?})
                             Resolves relative paths against base URL, per-route isolated artifacts in routes/<name>/
  --config <path>            Path to .framecritic.json (default: ./.framecritic.json if present)
  --fail-on <mode>           CI gate: error|warning|never (default: error)
  --max-warnings <n>         Max warnings allowed before failing (default: no limit; 0 = no warnings)
  --json-summary             Emit machine-readable JSON summary to stdout and file
  --scenario <file>          Declarative scenario JSON (click/fill/hover/press/wait/scroll/select/hotkey, no eval)
  --trace                    Capture Playwright trace (stored in traces/*.zip)
  --a11y                     Run automated accessibility scan on target page (axe-core, opt-in)
  --open                     Open report.html in default browser after scan
  Note: --sweep and --viewport are mutually exclusive; --routes and --scenario are mutually exclusive

Options (compare):
  --output <dir>            Output directory for comparison (default: framecritic-out/comparison-<timestamp>)
  --fail-on-new             Exit 2 if any NEW findings (regression)

General:
  -h, --help                 Show this help
  -v, --version              Show version

Examples:
  framecritic scan http://localhost:3001
  framecritic scan http://localhost:3001 --output ./out --viewport mobile,desktop
  framecritic scan http://localhost:3001 --open
  framecritic scan https://example.com --viewport 390x844,1440x900
  framecritic scan http://localhost:3001 --config ./my-config.json
  framecritic scan http://localhost:3001 --fail-on warning --max-warnings 5 --json-summary
  framecritic compare ./baseline/findings.json ./current/findings.json
  framecritic compare ./baseline/findings.json ./current/findings.json --fail-on-new

Detectors:
  horizontal-overflow · outside-viewport · overlapping-elements · broken-image · console/page errors · accessibility (with --a11y)

Config (.framecritic.json):
  { "ignore": { "selectors": [], "types": [], "viewports": { "mobile": [], "tablet": [], "desktop": [] } } }

Exit codes:
  0  pass (policy satisfied or no new regressions)
  1  scan or config error
  2  policy failure or new regressions with --fail-on-new

Policy:
  --fail-on error   fail if any error
  --fail-on warning fail if any error or warning (or warnings > max-warnings)
  --fail-on never   never fail (exit 0)
  --max-warnings N  fail if warnings > N (checked after fail-on)
`);
}

function openInBrowser(filePath: string): void {
  const abs = path.resolve(filePath);
  // Encode file URL correctly for spaces and special chars; keep forward slashes for Windows.
  const posixAbs = abs.replace(/\\/g, "/");
  const fileUrl = abs.startsWith("/") ? `file://${encodeURI(abs)}` : `file:///${encodeURI(posixAbs)}`;
  const platform = process.platform;
  let cmd: string;
  let args: string[];
  if (platform === "win32") {
    // Use cmd /c start "" <path> — spawn will auto-quote abs if it contains spaces,
    // producing correct `start "" "C:\path with spaces\file.html"`.
    cmd = "cmd";
    args = ["/c", "start", "", abs];
  } else if (platform === "darwin") {
    cmd = "open";
    args = [abs];
  } else {
    cmd = "xdg-open";
    args = [abs];
  }
  const child = spawn(cmd, args, { stdio: "ignore", detached: true });
  child.on("error", () => {
    console.log(`Open manually: ${fileUrl}`);
  });
  child.unref();
}

function formatSummaryLine(label: string, value: string, color?: string): string {
  const useColor = process.stdout.isTTY;
  if (!useColor || !color) return `  ${label.padEnd(18)} ${value}`;
  const codes: Record<string, string> = { red: "\x1b[31m", yellow: "\x1b[33m", green: "\x1b[32m", cyan: "\x1b[36m", dim: "\x1b[2m" };
  const reset = "\x1b[0m";
  return `  ${label.padEnd(18)} ${codes[color] ?? ""}${value}${reset}`;
}

function printSummary(report: Awaited<ReturnType<typeof scanUrl>>, outDir: string): void {
  const { summary, results, url } = report;
  const affected = results.filter((r) => r.findings.length > 0).length;
  const hasErrors = summary.errors > 0;
  const status = hasErrors ? "ISSUES FOUND" : summary.warnings > 0 ? "WARNINGS" : "PASS";
  const statusColor = hasErrors ? "red" : summary.warnings > 0 ? "yellow" : "green";

  console.log("");
  console.log(formatSummaryLine("Target:", url, "cyan"));
  console.log(formatSummaryLine("Viewports:", results.map((r) => `${r.viewport.label} ${r.viewport.width}×${r.viewport.height}`).join("  ·  ")));
  console.log(formatSummaryLine("Output:", path.relative(process.cwd(), outDir) || outDir, "dim"));
  if (report.suppression?.configPath) {
    console.log(formatSummaryLine("Config:", report.suppression.configPath, "dim"));
  }
  if (report.scenario) {
    console.log(formatSummaryLine("Scenario:", `${report.scenario.name} (${report.scenario.steps.length} steps)`, "dim"));
  }
  if (report.trace?.enabled) {
    console.log(formatSummaryLine("Trace:", `${report.trace.files.length} file(s) → ${path.join(outDir, "traces")}`, "dim"));
  }
  if (report.a11y?.enabled) {
    console.log(formatSummaryLine("Accessibility:", "enabled (axe-core, automated)", "dim"));
  }
  if (report.policy) {
    const pol = report.policy.failOn + (report.policy.maxWarnings !== undefined ? `, max-warnings=${report.policy.maxWarnings}` : "");
    console.log(formatSummaryLine("Policy:", `${pol} → ${report.policy.failed ? "FAIL" : "PASS"} (${report.policy.reason})`, report.policy.failed ? "red" : "green"));
  }
  console.log("");
  console.log(`  ${statusColor === "red" ? "\x1b[31m✕\x1b[0m" : statusColor === "yellow" ? "\x1b[33m▲\x1b[0m" : "\x1b[32m✓\x1b[0m"} ${status} — ${summary.errors} error${summary.errors === 1 ? "" : "s"}, ${summary.warnings} warning${summary.warnings === 1 ? "" : "s"} · ${affected}/${results.length} viewports affected`);
  if (report.suppression && report.suppression.totalSuppressed > 0) {
    console.log(`  suppressed ${report.suppression.totalSuppressed} finding(s) via config`);
  }
  if (report.policy) {
    console.log(`  policy ${report.policy.failed ? "FAILED" : "PASSED"} — ${report.policy.reason} (exit ${report.policy.exitCode})`);
  }
  console.log("");

  const header = `  ${"Viewport".padEnd(22)} ${"Findings".padEnd(12)} ${"Markers".padEnd(10)} Screenshot`;
  console.log(header);
  console.log(`  ${"─".repeat(22)} ${"─".repeat(12)} ${"─".repeat(10)} ${"─".repeat(24)}`);
  for (const r of results) {
    const label = `${r.viewport.label} ${r.viewport.width}×${r.viewport.height}`;
    const findings = `${r.findings.length}  (${r.findings.filter((f) => f.severity === "error").length} err)`;
    const markers = String(r.annotations?.length ?? 0);
    const shot = path.relative(process.cwd(), path.join(outDir, r.screenshot)) || r.screenshot;
    console.log(`  ${label.padEnd(22)} ${findings.padEnd(12)} ${markers.padEnd(10)} ${shot}`);
    if (r.annotatedScreenshot) {
      const ann = path.relative(process.cwd(), path.join(outDir, r.annotatedScreenshot)) || r.annotatedScreenshot;
      console.log(`  ${"".padEnd(22)} ${"".padEnd(12)} ${"".padEnd(10)} ${ann}  (annotated)`);
    }
  }
  console.log("");
  if (report.findings.length) {
    console.log(`  Findings (grouped):`);
    const byType = new Map<string, number>();
    for (const f of report.findings) byType.set(f.type, (byType.get(f.type) ?? 0) + 1);
    for (const [t, c] of byType.entries()) {
      console.log(`    · ${t.padEnd(24)} ${c}`);
    }
    console.log("");
  }
  if (report.suppression && report.suppression.totalSuppressed > 0) {
    console.log(`  Suppressed: ${report.suppression.totalSuppressed} finding(s)`);
    const byReason = new Map<string, number>();
    for (const s of report.suppression.suppressed) byReason.set(s.reason, (byReason.get(s.reason) ?? 0) + 1);
    for (const [r, c] of byReason.entries()) console.log(`    · ${r.padEnd(24)} ${c}`);
    console.log("");
  }
  console.log(`  findings.json  → ${path.join(outDir, "findings.json")}`);
  console.log(`  report.html    → ${path.join(outDir, "report.html")}`);
  console.log(`  AGENT_FIXES.md → ${path.join(outDir, "AGENT_FIXES.md")}`);
  if (report.trace?.enabled) {
    for (const f of report.trace.files) console.log(`  trace        → ${path.join(outDir, f)}`);
  }
  if (report.policy) {
    console.log(`  policy: fail-on=${report.policy.failOn}${report.policy.maxWarnings !== undefined ? ` max-warnings=${report.policy.maxWarnings}` : ""} → ${report.policy.failed ? "FAIL" : "PASS"}`);
  }
  console.log("");
  if (report.policy?.failed) {
    console.log(`  CI gate FAILED — exit ${report.policy.exitCode}`);
    console.log("");
  } else if (hasErrors) {
    console.log(`  Next: open report.html in a browser (or re-run with --open) to see annotated regions.`);
    console.log("");
  }
}

// Only run main when invoked directly (not when imported for tests)
const isMain = (() => {
  const entry = process.argv[1] ?? "";
  return entry.endsWith("cli.js") || entry.endsWith("cli.ts") || entry.endsWith("cli");
})();

if (isMain) {
  const rawArgv = process.argv.slice(2);
  let parsed;
  try {
    parsed = parseArgs(rawArgv);
  } catch (e: any) {
    console.error(`Error: ${e.message}`);
    process.exit(2);
  }

  if (parsed.command === "help" || parsed.help) {
    printHelp();
    process.exit(0);
  }
  if (parsed.command === "version") {
    console.log(getVersion());
    process.exit(0);
  }

  if (parsed.command === "compare") {
    const baseline = parsed.compareBaseline!;
    const current = parsed.compareCurrent!;
    const outDir = parsed.output ?? path.join(process.cwd(), "framecritic-out", `comparison-${Date.now()}`);
    try {
      const { compareReports, writeComparison } = await import("./compare.js");
      const result = compareReports(baseline, current);
      const { jsonPath, htmlPath } = writeComparison(result, outDir);
      console.log(`[FrameCritic] Comparison → ${outDir}`);
      console.log(`  Baseline: ${baseline} (${result.summary.totalBaseline} findings)`);
      console.log(`  Current:  ${current} (${result.summary.totalCurrent} findings)`);
      console.log(`  NEW: ${result.summary.new}  RESOLVED: ${result.summary.resolved}  PERSISTING: ${result.summary.persisting}`);
      console.log(`  comparison.json → ${jsonPath}`);
      console.log(`  comparison.html → ${htmlPath}`);
      if (parsed.failOnNew && result.summary.new > 0) {
        console.log(`  --fail-on-new: ${result.summary.new} new finding(s) → exit 2`);
        process.exit(2);
      }
      process.exit(0);
    } catch (e: any) {
      console.error(`[FrameCritic] Compare failed: ${e?.message ?? String(e)}`);
      process.exit(1);
    }
  }

  let url = parsed.url;
  if (!url) {
    console.error(`Error: missing <url>.\n`);
    printHelp();
    process.exit(1);
  }

  if (!url.includes("://")) url = "http://" + url;

  const outDir = parsed.output ?? path.join(process.cwd(), "framecritic-out", `scan-${Date.now()}`);

  const policyOpts = {
    failOn: parsed.failOn ?? "error" as const,
    maxWarnings: parsed.maxWarnings,
  };

  // Multi-route batch mode
  if (parsed.routes) {
    console.log(`[FrameCritic] Batch scanning ${url} with routes ${parsed.routes}`);
    if (parsed.sweep) console.log(`[FrameCritic] Sweep: ${parsed.sweep} → ${parsed.viewports?.length ?? 0} widths (fixed height 900)`);
    if (parsed.viewports) console.log(`[FrameCritic] Viewports: ${parsed.viewports.map((v) => `${v.label} ${v.width}×${v.height}`).join(", ")}`);
    if (parsed.trace) console.log(`[FrameCritic] Trace: enabled`);
    if (parsed.a11y) console.log(`[FrameCritic] Accessibility: enabled (axe-core)`);
    console.log(`[FrameCritic] Output → ${outDir}`);
    try {
      const { scanBatch } = await import("./engine/batch.js");
      const { evaluatePolicy } = await import("./policy.js");
      const batch = await scanBatch({
        baseUrl: url,
        routesManifestPath: parsed.routes,
        outDir,
        viewports: parsed.viewports as any,
        configPath: parsed.config,
        policy: policyOpts,
        trace: parsed.trace,
        a11y: parsed.a11y,
      });
      console.log(`\n[FrameCritic] Batch complete: ${batch.routes.length} routes`);
      for (const r of batch.routes) {
        const status = r.status === "ok" ? `${r.summary?.errors ?? 0} err, ${r.summary?.warnings ?? 0} warn` : `ERROR: ${r.error?.slice(0,120)}`;
        console.log(`  ${r.name.padEnd(16)} ${r.path.padEnd(20)} ${r.url} → ${status} — ${r.reportPath ?? "no report"}`);
      }
      console.log(`  summary: ${batch.summary.errors} errors, ${batch.summary.warnings} warnings, ${batch.summary.total} total`);
      console.log(`  batch.json → ${path.join(outDir, "batch.json")}`);
      console.log(`  index.html → ${path.join(outDir, "index.html")}`);
      // policy evaluation on aggregated summary
      const pol = evaluatePolicy(batch.summary, policyOpts);
      console.log(`  policy: fail-on=${pol.failOn}${pol.maxWarnings !== undefined ? ` max-warnings=${pol.maxWarnings}` : ""} → ${pol.failed ? "FAIL" : "PASS"} — ${pol.reason} (exit ${pol.exitCode})`);
      if (parsed.jsonSummary) {
        const obj = { url: batch.baseUrl, timestamp: batch.timestamp, outDir, summary: batch.summary, policy: pol, routes: batch.routes };
        try { fs.writeFileSync(path.join(outDir, "json-summary.json"), JSON.stringify(obj, null, 2), "utf-8"); } catch {}
        console.log("  --json-summary");
        console.log(JSON.stringify(obj));
      }
      if (parsed.open) {
        const htmlPath = path.join(outDir, "index.html");
        console.log(`[FrameCritic] Opening ${htmlPath}`);
        openInBrowser(htmlPath);
      }
      process.exit(pol.exitCode);
    } catch (e: any) {
      console.error(`\n[FrameCritic] Batch scan failed: ${e?.message ?? String(e)}`);
      process.exit(1);
    }
  }

  console.log(`[FrameCritic] Scanning ${url}`);
  if (parsed.sweep) {
    console.log(`[FrameCritic] Sweep: ${parsed.sweep} → ${parsed.viewports?.length ?? 0} widths (fixed height 900)`);
  }
  if (parsed.viewports) {
    console.log(`[FrameCritic] Viewports: ${parsed.viewports.map((v) => `${v.label} ${v.width}×${v.height}`).join(", ")}`);
  }
  if (parsed.scenario) {
    console.log(`[FrameCritic] Scenario: ${parsed.scenario}`);
  }
  if (parsed.trace) {
    console.log(`[FrameCritic] Trace: enabled`);
  }
  if (parsed.a11y) {
    console.log(`[FrameCritic] Accessibility: enabled (axe-core)`);
  }
  console.log(`[FrameCritic] Output → ${outDir}`);

  let report: Awaited<ReturnType<typeof scanUrl>>;
  try {
    report = await scanUrl({ url, outDir, viewports: parsed.viewports as any, configPath: parsed.config, policy: policyOpts, scenarioPath: parsed.scenario, trace: parsed.trace, a11y: parsed.a11y });
  } catch (e: any) {
    console.error(`\n[FrameCritic] Scan failed: ${e?.message ?? String(e)}`);
    process.exit(1);
  }

  // write json-summary file if requested and also ensure policy already in findings.json
  let jsonSummaryObj: Record<string, unknown> | null = null;
  if (parsed.jsonSummary) {
    jsonSummaryObj = {
      url: report.url,
      timestamp: report.timestamp,
      outDir,
      summary: report.summary,
      policy: report.policy,
      suppression: report.suppression ?? null,
      exitCode: report.policy?.exitCode ?? 0,
    };
    try {
      fs.writeFileSync(path.join(outDir, "json-summary.json"), JSON.stringify(jsonSummaryObj, null, 2), "utf-8");
    } catch {}
  }

  printSummary(report, outDir);

  if (parsed.jsonSummary && jsonSummaryObj) {
    console.log("  --json-summary");
    console.log(JSON.stringify(jsonSummaryObj));
  }

  if (parsed.open) {
    const htmlPath = path.join(outDir, "report.html");
    console.log(`[FrameCritic] Opening ${htmlPath}`);
    openInBrowser(htmlPath);
  }

  const exitCode = report.policy?.exitCode ?? (report.summary.errors > 0 ? 2 : 0);
  process.exit(exitCode);
}
