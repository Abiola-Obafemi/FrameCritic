#!/usr/bin/env node
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { scanUrl } from "./engine/scanner.js";
import { VIEWPORTS, type Viewport } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  framecritic <url> [options]          (shorthand)

Options:
  --output <dir>            Output directory (default: framecritic-out/scan-<timestamp>)
  --viewport <list>          Viewports to scan (comma-separated)
                             Built-ins: mobile (390×844), tablet (768×1024), desktop (1440×900)
                             Custom:    390x844,768x1024  or  mobile,desktop
  --open                     Open report.html in default browser after scan
  -h, --help                 Show this help
  -v, --version              Show version

Examples:
  framecritic scan http://localhost:3001
  framecritic scan http://localhost:3001 --output ./out --viewport mobile,desktop
  framecritic scan http://localhost:3001 --open
  framecritic scan https://example.com --viewport 390x844,1440x900

Detectors:
  horizontal-overflow · outside-viewport · overlapping-elements · broken-image · console/page errors
`);
}

function parseViewportList(raw: string | undefined): Viewport[] | null {
  if (!raw) return null;
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  const out: Viewport[] = [];
  for (const p of parts) {
    const lower = p.toLowerCase();
    const builtin = VIEWPORTS.find((v) => v.label === lower);
    if (builtin) {
      out.push(builtin);
      continue;
    }
    // custom WxH e.g. 390x844
    const m = lower.match(/^(\d+)\s*x\s*(\d+)$/);
    if (m) {
      const w = Number(m[1]);
      const h = Number(m[2]);
      if (w >= 200 && w <= 4000 && h >= 200 && h <= 3000) {
        out.push({ label: `${w}x${h}`, width: w, height: h });
        continue;
      }
    }
    console.error(`Unknown viewport "${p}". Known: ${VIEWPORTS.map((v) => v.label).join(", ")} or WxH like 390x844`);
    process.exit(2);
  }
  // dedupe by label
  const seen = new Set<string>();
  return out.filter((v) => (seen.has(v.label) ? false : (seen.add(v.label), true)));
}

export type ParsedArgs = {
  command: "scan" | "help" | "version";
  url?: string;
  output?: string;
  open: boolean;
  viewports?: Viewport[];
  help: boolean;
};

/** Parse argv (without node+script) — exported for tests. */
export function parseArgs(argv: string[]): ParsedArgs {
  // handle --help / --version anywhere
  if (argv.includes("--help") || argv.includes("-h")) {
    return { command: "help", open: false, help: true };
  }
  if (argv.includes("--version") || argv.includes("-v")) {
    return { command: "version", open: false, help: false };
  }

  // Strip flags to find positional args, but keep --output/--viewport values.
  // We parse sequentially.
  let command: ParsedArgs["command"] = "scan";
  let url: string | undefined;
  let output: string | undefined;
  let open = false;
  let viewports: Viewport[] | undefined;
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "scan") {
      command = "scan";
      continue;
    }
    if (a === "--output" || a === "-o") {
      output = argv[i + 1];
      if (!output || output.startsWith("-")) {
        console.error(`--output requires a directory path`);
        process.exit(2);
      }
      i++;
      continue;
    }
    if (a.startsWith("--output=")) {
      output = a.slice("--output=".length);
      continue;
    }
    if (a === "--viewport") {
      const raw = argv[i + 1];
      if (!raw || raw.startsWith("-")) {
        console.error(`--viewport requires a value (e.g. mobile,tablet or 390x844)`);
        process.exit(2);
      }
      viewports = parseViewportList(raw) ?? undefined;
      i++;
      continue;
    }
    if (a.startsWith("--viewport=")) {
      viewports = parseViewportList(a.slice("--viewport=".length)) ?? undefined;
      continue;
    }
    if (a === "--open") {
      open = true;
      continue;
    }
    if (a.startsWith("-")) {
      console.error(`Unknown option "${a}". See --help.`);
      process.exit(2);
    }
    positional.push(a);
  }

  if (positional.length > 0) url = positional[0];
  if (positional.length > 1) {
    // legacy: second positional as output dir
    if (!output) output = positional[1];
  }

  return { command, url, output, open, viewports, help: false };
}

function openInBrowser(filePath: string): void {
  const abs = path.resolve(filePath);
  const url = abs.startsWith("/") ? `file://${abs}` : `file:///${abs.replace(/\\/g, "/")}`;
  // Use OS open command; fallback to printing path
  const platform = process.platform;
  let cmd: string;
  let args: string[];
  if (platform === "win32") {
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
    console.log(`Open manually: ${url}`);
  });
  child.unref();
}

function formatSummaryLine(label: string, value: string, color?: string): string {
  // Simple ANSI if TTY
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
  console.log("");
  console.log(`  ${statusColor === "red" ? "\x1b[31m✕\x1b[0m" : statusColor === "yellow" ? "\x1b[33m▲\x1b[0m" : "\x1b[32m✓\x1b[0m"} ${status} — ${summary.errors} error${summary.errors === 1 ? "" : "s"}, ${summary.warnings} warning${summary.warnings === 1 ? "" : "s"} · ${affected}/${results.length} viewports affected`);
  console.log("");

  // Per-viewport table
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
  // Top findings
  if (report.findings.length) {
    console.log(`  Findings (grouped):`);
    const byType = new Map<string, number>();
    for (const f of report.findings) byType.set(f.type, (byType.get(f.type) ?? 0) + 1);
    for (const [t, c] of byType.entries()) {
      console.log(`    · ${t.padEnd(24)} ${c}`);
    }
    console.log("");
  }
  console.log(`  findings.json → ${path.join(outDir, "findings.json")}`);
  console.log(`  report.html   → ${path.join(outDir, "report.html")}`);
  if (results.some((r) => r.annotatedScreenshot)) {
    console.log(`  AGENT_FIXES.md → ${path.join(outDir, "AGENT_FIXES.md")}  (if generated)`);
  }
  console.log("");
  if (hasErrors) {
    console.log(`  Next: open report.html in a browser (or re-run with --open) to see annotated regions.`);
    console.log("");
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const rawArgv = process.argv.slice(2);
const parsed = parseArgs(rawArgv);

if (parsed.command === "help" || parsed.help) {
  printHelp();
  process.exit(0);
}
if (parsed.command === "version") {
  console.log(getVersion());
  process.exit(0);
}

let url = parsed.url;
if (!url) {
  console.error(`Error: missing <url>.\n`);
  printHelp();
  process.exit(1);
}

// Normalize URL (allow localhost without scheme)
if (!/^https?:\/\//i.test(url)) url = "http://" + url;

const outDir = parsed.output ?? path.join(process.cwd(), "framecritic-out", `scan-${Date.now()}`);

console.log(`[FrameCritic] Scanning ${url}`);
if (parsed.viewports) {
  console.log(`[FrameCritic] Viewports: ${parsed.viewports.map((v) => `${v.label} ${v.width}×${v.height}`).join(", ")}`);
}
console.log(`[FrameCritic] Output → ${outDir}`);

let report: Awaited<ReturnType<typeof scanUrl>>;
try {
  report = await scanUrl({ url, outDir, viewports: parsed.viewports as any });
} catch (e: any) {
  console.error(`\n[FrameCritic] Scan failed: ${e?.message ?? String(e)}`);
  process.exit(1);
}

printSummary(report, outDir);

if (parsed.open) {
  const htmlPath = path.join(outDir, "report.html");
  console.log(`[FrameCritic] Opening ${htmlPath}`);
  openInBrowser(htmlPath);
}

// Exit code signals quality gate
if (report.summary.errors > 0) process.exit(2);
else if (report.summary.warnings > 0) process.exit(0);
else process.exit(0);
