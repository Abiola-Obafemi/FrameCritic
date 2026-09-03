import fs from "node:fs";
import path from "node:path";
import type { Finding, ScanReport } from "./types.js";

export type FingerprintedFinding = Finding & { fingerprint: string };

function normalizeSelector(sel: string): string {
  return sel.trim().replace(/\s*>\s*/g, " > ").replace(/\s+/g, " ").toLowerCase();
}

function getSelectors(f: Finding): string[] {
  const d: any = f.details ?? {};
  let sels: string[] = [];
  switch (f.type) {
    case "horizontal-overflow":
      sels = (d.offenders ?? []).map((o: any) => o.selector).filter(Boolean);
      break;
    case "outside-viewport":
      sels = (d.elements ?? []).map((e: any) => e.selector).filter(Boolean);
      break;
    case "overlapping-elements":
      sels = (d.pairs ?? []).flatMap((p: any) => [p.a, p.b]).filter(Boolean);
      break;
    case "broken-image":
      sels = (d.images ?? []).map((i: any) => i.selector).filter(Boolean);
      break;
    case "accessibility":
      // axe findings have rule + nodes selectors + affectedSelectors
      sels = [
        ...(d.nodes ?? []).map((n: any) => n.selector).filter(Boolean),
        ...(d.affectedSelectors ?? []).filter(Boolean),
      ];
      // Include rule id to distinguish same selector with different rules
      if (d.rule) sels.push(`rule:${d.rule}`);
      break;
    default:
      sels = [];
  }
  return sels.map(normalizeSelector).sort();
}

function normalizeMessage(msg: string): string {
  return msg.trim().replace(/\s+/g, " ").slice(0, 300);
}

function stripOriginForStability(s: string): string {
  // Remove http(s) origins (including ports) for fingerprint stability across ephemeral ports.
  // e.g. http://localhost:1234/path -> /path
  return s.replace(/https?:\/\/[^/\s"']+/gi, "");
}

export function fingerprintFinding(f: Finding): string {
  const selectors = getSelectors(f);
  if (selectors.length) {
    const joined = selectors.join("|");
    return `${f.type}|${f.viewport}|${joined}`;
  }
  // For console/page errors without selectors, use message fingerprint
  // Strip origins to avoid ephemeral port instability, then normalize
  const msg = stripOriginForStability(normalizeMessage(f.message));
  // include type and viewport and message prefix
  // Also include details text if available for more stable but ignore volatile fields like stack line numbers?
  // Use message only for now
  return `${f.type}|${f.viewport}|${msg.toLowerCase()}`;
}

export type CompareSummary = {
  totalBaseline: number;
  totalCurrent: number;
  new: number;
  resolved: number;
  persisting: number;
};

export type CompareResult = {
  baselinePath: string;
  currentPath: string;
  timestamp: string;
  summary: CompareSummary;
  new: FingerprintedFinding[];
  resolved: FingerprintedFinding[];
  persisting: Array<{ fingerprint: string; baseline: FingerprintedFinding; current: FingerprintedFinding }>;
};

const MAX_COMPARE_BYTES = 5 * 1024 * 1024;

function loadReport(filePath: string): ScanReport {
  try {
    const st = fs.statSync(filePath);
    if (st.size > MAX_COMPARE_BYTES) throw new Error(`Findings file ${filePath} exceeds ${MAX_COMPARE_BYTES} bytes (got ${st.size}) — file too large`);
  } catch (e: any) {
    if (e.message.includes("exceeds")) throw e;
  }
  const raw = fs.readFileSync(filePath, "utf-8");
  if (raw.length > MAX_COMPARE_BYTES) throw new Error(`Findings file ${filePath} exceeds ${MAX_COMPARE_BYTES} bytes (got ${raw.length}) — file too large`);
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch (e: any) {
    throw new Error(`Invalid JSON in ${filePath}: ${e.message}`);
  }
  // Accept either ScanReport or { findings: [...] } or plain array
  if (Array.isArray(parsed)) {
    return { url: "", timestamp: "", viewports: [], results: [], findings: parsed, summary: { total: parsed.length, errors: 0, warnings: 0, infos: 0 } } as any;
  }
  if (parsed.findings && Array.isArray(parsed.findings)) {
    return parsed as ScanReport;
  }
  throw new Error(`Invalid findings file ${filePath}: expected ScanReport with findings array`);
}

export function compareReports(baselinePath: string, currentPath: string): CompareResult {
  const baseline = loadReport(baselinePath);
  const current = loadReport(currentPath);

  const baselineFps = new Map<string, FingerprintedFinding[]>();
  const currentFps = new Map<string, FingerprintedFinding[]>();

  function addToMap(map: Map<string, FingerprintedFinding[]>, f: Finding) {
    const fp = fingerprintFinding(f);
    const withFp = { ...f, fingerprint: fp } as FingerprintedFinding;
    const arr = map.get(fp) ?? [];
    arr.push(withFp);
    map.set(fp, arr);
  }

  for (const f of baseline.findings ?? []) addToMap(baselineFps, f);
  for (const f of current.findings ?? []) addToMap(currentFps, f);

  const allFps = new Set<string>([...baselineFps.keys(), ...currentFps.keys()]);

  const newFindings: FingerprintedFinding[] = [];
  const resolved: FingerprintedFinding[] = [];
  const persisting: CompareResult["persisting"] = [];

  for (const fp of allFps) {
    const bArr = baselineFps.get(fp) ?? [];
    const cArr = currentFps.get(fp) ?? [];
    if (bArr.length && cArr.length) {
      // For simplicity, pair first occurrence; if multiple with same fingerprint, treat as persisting for min count
      const min = Math.min(bArr.length, cArr.length);
      for (let i = 0; i < min; i++) {
        persisting.push({ fingerprint: fp, baseline: bArr[i], current: cArr[i] });
      }
      if (bArr.length > min) resolved.push(...bArr.slice(min));
      if (cArr.length > min) newFindings.push(...cArr.slice(min));
    } else if (bArr.length) {
      resolved.push(...bArr);
    } else {
      newFindings.push(...cArr);
    }
  }

  // Sort for deterministic output: by type, viewport, fingerprint
  const sortFn = (a: FingerprintedFinding, b: FingerprintedFinding) =>
    a.fingerprint.localeCompare(b.fingerprint) || a.type.localeCompare(b.type);
  newFindings.sort(sortFn);
  resolved.sort(sortFn);
  persisting.sort((a, b) => a.fingerprint.localeCompare(b.fingerprint));

  return {
    baselinePath,
    currentPath,
    timestamp: new Date().toISOString(),
    summary: {
      totalBaseline: baseline.findings.length,
      totalCurrent: current.findings.length,
      new: newFindings.length,
      resolved: resolved.length,
      persisting: persisting.length,
    },
    new: newFindings,
    resolved,
    persisting,
  };
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function renderFinding(f: Finding): string {
  const details = f.details ? `<pre>${esc(JSON.stringify(f.details, null, 2).slice(0, 800))}</pre>` : "";
  const badge = f.severity === "error" ? `<span class="badge err">ERROR</span>` : f.severity === "warning" ? `<span class="badge warn">WARN</span>` : `<span class="badge info">INFO</span>`;
  return `<div class="finding"><div class="fh">${badge} <strong>${esc(f.type)}</strong> <span class="vp">${esc(f.viewport)}</span> <span class="fp mono">${esc((f as any).fingerprint ?? "")}</span></div><div class="msg">${esc(f.message)}</div>${details}</div>`;
}

export function generateComparisonHtml(result: CompareResult): string {
  const { summary, new: news, resolved, persisting, baselinePath, currentPath, timestamp } = result;
  function section(title: string, count: number, color: string, items: string) {
    return `<section class="sec"><h2 style="border-left:4px solid ${color};padding-left:10px">${esc(title)} <span class="count">${count}</span></h2><div class="list">${items || `<div class="empty">None</div>`}</div></section>`;
  }
  const newHtml = news.map(renderFinding).join("\n");
  const resolvedHtml = resolved.map(renderFinding).join("\n");
  const persistingHtml = persisting.map(p => `<div class="persist-pair"><div class="pair-label mono">${esc(p.fingerprint)}</div><div class="pair-grid"><div><h4>Baseline</h4>${renderFinding(p.baseline)}</div><div><h4>Current</h4>${renderFinding(p.current)}</div></div></div>`).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>FrameCritic Comparison — ${esc(timestamp)}</title>
<style>
:root{--bg:#0b0e14;--card:#151a25;--border:#232c43;--text:#e6e8ee;--muted:#b8c0d4;--err:#ff4d6a;--warn:#ffb020;--ok:#2ecc71;--info:#4da3ff}
*{box-sizing:border-box}body{margin:0;font-family:ui-sans-system,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--text);line-height:1.5}
header{max-width:1100px;margin:0 auto;padding:28px 20px 10px}
h1{margin:6px 0 4px;font-size:24px}
.meta{color:var(--muted);font-size:13px;word-break:break-all}
.summary{display:flex;gap:12px;flex-wrap:wrap;margin-top:16px}
.stat{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px 16px;min-width:140px;flex:1}
.stat .k{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.stat .v{font-size:22px;font-weight:700}
main{max-width:1100px;margin:0 auto;padding:18px 20px 40px}
.sec{margin-top:28px;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px}
.count{font-size:12px;background:#0f1422;border:1px solid var(--border);padding:2px 8px;border-radius:999px;color:var(--muted)}
.list{display:flex;flex-direction:column;gap:10px;margin-top:12px}
.finding{background:#0f1422;border:1px solid var(--border);border-radius:10px;padding:10px 12px}
.fh{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.badge{font-size:10px;font-weight:700;padding:2px 6px;border-radius:999px;border:1px solid transparent}
.badge.err{background:#3a1320;color:var(--err);border-color:#5a1e2e}
.badge.warn{background:#3a2d10;color:var(--warn);border-color:#6a4a10}
.badge.info{background:#132a44;color:var(--info);border-color:#1e3a5a}
.vp{font-size:11px;color:var(--muted);border:1px solid var(--border);padding:2px 7px;border-radius:999px;background:#0b0e14}
.fp{font-size:10px;color:var(--muted);max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.msg{margin-top:6px;font-size:13px;color:#d0d6e6}
pre{margin:8px 0 0;background:#080a12;border:1px solid var(--border);border-radius:8px;padding:10px;font-size:11px;overflow:auto;max-height:220px;color:#cbd5e1}
.empty{color:var(--muted);font-size:13px;padding:8px}
.persist-pair{border:1px solid var(--border);border-radius:10px;padding:10px;background:#0f1422}
.pair-label{font-size:11px;color:var(--muted);margin-bottom:8px}
.pair-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media(max-width:700px){.pair-grid{grid-template-columns:1fr}}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
footer{max-width:1100px;margin:0 auto;padding:10px 20px 30px;color:var(--muted);font-size:12px;border-top:1px solid var(--border)}
</style>
</head>
<body>
<header>
<div style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:700">◐ FrameCritic — Comparison</div>
<h1>Structural Comparison</h1>
<div class="meta">Baseline: <span class="mono">${esc(baselinePath)}</span><br>Current: <span class="mono">${esc(currentPath)}</span><br>Generated: <span class="mono">${esc(timestamp)}</span></div>
<div class="summary">
<div class="stat"><div class="k">Baseline total</div><div class="v">${summary.totalBaseline}</div></div>
<div class="stat"><div class="k" style="color:var(--err)">New</div><div class="v" style="color:var(--err)">${summary.new}</div></div>
<div class="stat"><div class="k" style="color:var(--ok)">Resolved</div><div class="v" style="color:var(--ok)">${summary.resolved}</div></div>
<div class="stat"><div class="k">Persisting</div><div class="v">${summary.persisting}</div></div>
<div class="stat"><div class="k">Current total</div><div class="v">${summary.totalCurrent}</div></div>
</div>
</header>
<main>
${section("NEW — regressions", summary.new, "var(--err)", newHtml)}
${section("RESOLVED — fixed", summary.resolved, "var(--ok)", resolvedHtml)}
${section("PERSISTING — still present", summary.persisting, "var(--muted)", persistingHtml)}
</main>
<footer>Generated locally by FrameCritic — fingerprints use type, viewport, normalized selectors (ignoring timestamps, screenshots, paths).</footer>
</body>
</html>`;
}

export function writeComparison(result: CompareResult, outDir: string): { jsonPath: string; htmlPath: string } {
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, "comparison.json");
  const htmlPath = path.join(outDir, "comparison.html");
  fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2), "utf-8");
  fs.writeFileSync(htmlPath, generateComparisonHtml(result), "utf-8");
  return { jsonPath, htmlPath };
}
