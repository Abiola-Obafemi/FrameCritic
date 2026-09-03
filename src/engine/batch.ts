import fs from "node:fs";
import path from "node:path";
import { scanUrl } from "./scanner.js";
import { loadRoutesManifest, resolveRouteUrl, sanitizeRouteName } from "../routes.js";
import { redactUrl } from "../security.js";
import { ARTIFACT_VERSION, type Manifest } from "../types.js";
import type { Viewport } from "../types.js";
import type { PolicyOptions } from "../types.js";

export type BatchRouteStatus = "ok" | "error";

export type BatchRouteResult = {
  name: string;
  path: string;
  url: string; // redacted resolved url
  status: BatchRouteStatus;
  error?: string;
  outDir: string; // relative to batch outDir
  summary?: { total: number; errors: number; warnings: number; infos: number };
  findingsCount?: number;
  reportPath?: string; // relative
  findingsPath?: string;
};

export type BatchSummary = {
  total: number;
  errors: number;
  warnings: number;
  infos: number;
};

export type BatchReport = {
  artifactVersion?: string;
  baseUrl: string;
  timestamp: string;
  routes: BatchRouteResult[];
  summary: BatchSummary;
  viewports?: Viewport[];
  policy?: any;
  trace?: any;
  a11y?: any;
  manifest?: Manifest;
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function generateBatchHtml(batch: BatchReport, outDir: string): string {
  const title = `FrameCritic Batch Report — ${esc(batch.baseUrl)}`;
  const rows = batch.routes
    .map(
      (r) => `
    <tr class="${r.status === "error" ? "row-error" : ""}">
      <td><strong>${esc(r.name)}</strong><br><span class="mono">${esc(r.path)}</span><br><span class="mono">${esc(r.url)}</span></td>
      <td>${r.status === "ok" ? `<span class="badge ok">OK</span>` : `<span class="badge err">ERROR</span><br><span class="errmsg">${esc(r.error ?? "")}</span>`}</td>
      <td>${r.summary ? `${r.summary.errors} err, ${r.summary.warnings} warn, ${r.summary.total} total` : "—"}</td>
      <td>${r.reportPath ? `<a href="${esc(r.reportPath)}" target="_blank" rel="noopener">report.html ↗</a><br><a href="${esc(r.findingsPath ?? "")}" target="_blank">findings.json</a><br><a href="${esc(r.reportPath.replace("report.html", "AGENT_FIXES.md"))}" target="_blank">AGENT_FIXES.md</a>` : "—"}</td>
    </tr>`
    )
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title}</title>
<style>
:root{--bg:#0b0e14;--card:#151a25;--border:#232c43;--text:#e6e8ee;--muted:#b8c0d4;--err:#ff4d6a;--ok:#2ecc71;--focus:#7c5cff}
*{box-sizing:border-box}
*:focus-visible{outline:2px solid var(--focus);outline-offset:2px;border-radius:2px}
*:focus:not(:focus-visible){outline:none}
.skip-link{position:absolute;left:-9999px;top:auto;width:1px;height:1px;overflow:hidden}
.skip-link:focus{left:12px;top:12px;width:auto;height:auto;background:var(--card);color:var(--text);padding:8px 12px;border-radius:8px;border:1px solid var(--border);z-index:9999}
body{margin:0;font-family:ui-sans-system,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--text);line-height:1.5}
header{max-width:1200px;margin:0 auto;padding:28px 20px 10px}
h1{margin:6px 0 4px;font-size:26px}
.meta{color:var(--muted);font-size:13px}
.summary{display:flex;gap:12px;flex-wrap:wrap;margin-top:16px}
.stat{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px 16px;min-width:140px;flex:1}
.stat .k{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.stat .v{font-size:22px;font-weight:700;margin-top:2px}
table{width:100%;border-collapse:collapse;margin-top:18px;background:var(--card);border:1px solid var(--border);border-radius:12px;overflow:hidden}
th,td{padding:12px 14px;border-bottom:1px solid var(--border);text-align:left;vertical-align:top;font-size:13px}
th{background:#1a2133;color:var(--muted);font-size:11px;letter-spacing:.06em;text-transform:uppercase}
.badge{font-size:11px;font-weight:700;padding:3px 7px;border-radius:999px;border:1px solid transparent}
.badge.ok{background:#0f2a1a;color:var(--ok);border-color:#1a4a2e}
.badge.err{background:#3a1320;color:var(--err);border-color:#5a1e2e}
.errmsg{color:var(--err);font-size:11px;word-break:break-all}
.mono{font-family:ui-monospace,monospace}
footer{max-width:1200px;margin:0 auto;padding:10px 20px 30px;color:var(--muted);font-size:12px;border-top:1px solid var(--border);margin-top:10px}
</style>
</head>
<body>
<a class="skip-link" href="#main-content">Skip to main content</a>
<header role="banner">
<div style="color:var(--muted);font-size:12px;letter-spacing:.04em;text-transform:uppercase" aria-label="FrameCritic batch report">◐ FrameCritic — Batch Scan</div>
<h1>Batch Report</h1>
<div class="meta">Base: <a href="${esc(batch.baseUrl)}" style="color:#4da3ff">${esc(batch.baseUrl)}</a> · <span class="mono">${esc(batch.timestamp)}</span> · ${batch.routes.length} route(s)</div>
<div class="summary" role="status" aria-live="polite">
  <div class="stat"><div class="k">Total Findings</div><div class="v">${batch.summary.total}</div></div>
  <div class="stat"><div class="k">Errors</div><div class="v" style="color:var(--err)">${batch.summary.errors}</div></div>
  <div class="stat"><div class="k">Warnings</div><div class="v" style="color:#ffb020">${batch.summary.warnings}</div></div>
  <div class="stat"><div class="k">Infos</div><div class="v" style="color:#4da3ff">${batch.summary.infos}</div></div>
</div>
</header>
<main id="main-content" style="max-width:1200px;margin:0 auto;padding:0 20px 10px">
<table aria-label="Routes and per-route artifacts">
<caption style="text-align:left;padding:8px 0;color:var(--muted);font-size:12px">${batch.routes.length} route(s) — each links to per-route <span class="mono">report.html</span>, <span class="mono">findings.json</span>, <span class="mono">AGENT_FIXES.md</span></caption>
<thead><tr><th scope="col">Route</th><th scope="col">Status</th><th scope="col">Findings</th><th scope="col">Artifacts</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</main>
<footer role="contentinfo">Generated locally by FrameCritic — no cloud. Per-route artifacts in <span class="mono">routes/&lt;name&gt;/</span> — each has <span class="mono">report.html</span>, <span class="mono">findings.json</span>, <span class="mono">AGENT_FIXES.md</span>, <span class="mono">screenshots/*.png</span></footer>
</body>
</html>`;
}

export async function scanBatch(opts: {
  baseUrl: string;
  routesManifestPath: string;
  outDir: string;
  viewports?: Viewport[];
  configPath?: string;
  policy?: PolicyOptions;
  trace?: boolean;
  a11y?: boolean;
}): Promise<BatchReport> {
  const baseUrlRedacted = redactUrl(opts.baseUrl);
  const timestamp = new Date().toISOString();
  const routes = loadRoutesManifest(opts.routesManifestPath);
  // validate baseUrl
  try {
    const u = new URL(opts.baseUrl);
    if (!["http:", "https:"].includes(u.protocol)) throw new Error(`Unsupported protocol ${u.protocol}`);
  } catch (e: any) {
    throw new Error(`Invalid base URL "${opts.baseUrl}": ${e.message}`);
  }

  await fs.promises.mkdir(opts.outDir, { recursive: true });
  await fs.promises.mkdir(path.join(opts.outDir, "routes"), { recursive: true });

  const results: BatchRouteResult[] = [];
  let aggErrors = 0;
  let aggWarnings = 0;
  let aggInfos = 0;
  let aggTotal = 0;

  for (const route of routes) {
    const routeUrl = resolveRouteUrl(opts.baseUrl, route.path);
    const sanitized = sanitizeRouteName(route.name);
    // Use posix for manifest/HTML relative links (portable forward slashes),
    // and path.join for filesystem (handles Windows backslashes and spaces).
    const routeOutRel = path.posix.join("routes", sanitized);
    const routeOutAbs = path.join(opts.outDir, routeOutRel);
    await fs.promises.mkdir(routeOutAbs, { recursive: true });

    // Resolve scenario path: try manifest-dir relative first, then cwd relative, then absolute
    let scenarioPath: string | undefined;
    if (route.scenario) {
      const manifestDir = path.dirname(path.resolve(opts.routesManifestPath));
      const candidate1 = path.isAbsolute(route.scenario) ? route.scenario : path.resolve(manifestDir, route.scenario);
      const candidate2 = path.isAbsolute(route.scenario) ? route.scenario : path.resolve(route.scenario);
      if (fs.existsSync(candidate1)) scenarioPath = candidate1;
      else if (fs.existsSync(candidate2)) scenarioPath = candidate2;
      else scenarioPath = candidate1; // will fail at scan time with clear per-route error
    }

    try {
      const report = await scanUrl({
        url: routeUrl,
        outDir: routeOutAbs,
        viewports: opts.viewports as any,
        configPath: opts.configPath,
        policy: opts.policy,
        scenarioPath,
        trace: opts.trace,
        a11y: opts.a11y,
      });
      const summary = report.summary;
      aggErrors += summary.errors;
      aggWarnings += summary.warnings;
      aggInfos += summary.infos;
      aggTotal += summary.total;
      results.push({
        name: route.name,
        path: route.path,
        url: routeUrl,
        status: "ok",
        outDir: routeOutRel,
        summary: { ...summary },
        findingsCount: summary.total,
        reportPath: path.posix.join(routeOutRel, "report.html"),
        findingsPath: path.posix.join(routeOutRel, "findings.json"),
      });
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      // Continue to next route instead of aborting batch
      results.push({
        name: route.name,
        path: route.path,
        url: routeUrl,
        status: "error",
        error: msg.slice(0, 1000),
        outDir: routeOutRel,
      });
      // Also write an error marker file for debugging
      try {
        await fs.promises.writeFile(path.join(routeOutAbs, "error.txt"), `Route "${route.name}" failed: ${msg}\n`, "utf-8");
      } catch {}
    }
  }

  const manifest: Manifest = {
    artifactVersion: ARTIFACT_VERSION,
    generatedAt: timestamp,
    kind: "batch",
    artifacts: {
      findings: "batch.json",
      report: "index.html",
      agentFixes: "batch.json", // batch summary serves as agent entry; per-route fixes in routes/<name>/AGENT_FIXES.md
      manifest: "manifest.json",
      screenshots: results.filter((r) => r.status === "ok").flatMap((r) => [`${r.outDir}/screenshots`]),
      batch: "batch.json",
      index: "index.html",
      routes: results.map((r) => r.outDir),
    },
  };

  const batchReport: BatchReport = {
    artifactVersion: ARTIFACT_VERSION,
    baseUrl: baseUrlRedacted,
    timestamp,
    routes: results,
    summary: { total: aggTotal, errors: aggErrors, warnings: aggWarnings, infos: aggInfos },
    manifest,
  };

  // Write batch.json
  await fs.promises.writeFile(path.join(opts.outDir, "batch.json"), JSON.stringify(batchReport, null, 2), "utf-8");
  // Write index.html
  const html = generateBatchHtml(batchReport, opts.outDir);
  await fs.promises.writeFile(path.join(opts.outDir, "index.html"), html, "utf-8");
  // Write manifest.json
  await fs.promises.writeFile(path.join(opts.outDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");

  return batchReport;
}
