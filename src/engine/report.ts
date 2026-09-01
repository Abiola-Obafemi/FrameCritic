import type { ScanReport, Finding } from "../types.js";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function badge(sev: string): string {
  if (sev === "error") return `<span class="badge err">ERROR</span>`;
  if (sev === "warning") return `<span class="badge warn">WARN</span>`;
  return `<span class="badge info">INFO</span>`;
}

function typeLabel(t: Finding["type"]): string {
  const map: Record<string, string> = {
    "horizontal-overflow": "Horizontal Overflow",
    "outside-viewport": "Outside Viewport",
    "overlapping-elements": "Overlapping Elements",
    "broken-image": "Broken Image",
    "console-error": "Console Error",
    "page-error": "Page / Network Error",
  };
  return map[t] ?? t;
}

function renderFinding(f: Finding): string {
  const detailsJson = f.details ? JSON.stringify(f.details, null, 2) : "";
  return `
  <div class="finding sev-${esc(f.severity)}">
    <div class="finding-head">
      ${badge(f.severity)}
      <span class="ftype">${esc(typeLabel(f.type))}</span>
      <span class="vpill">${esc(f.viewport)}</span>
    </div>
    <div class="msg">${esc(f.message)}</div>
    ${detailsJson ? `<details><summary>Details</summary><pre>${esc(detailsJson)}</pre></details>` : ``}
  </div>`;
}

export function generateHtmlReport(report: ScanReport): string {
  const { url, timestamp, results, findings, summary } = report;

  const hasFindings = findings.length > 0;
  const statusClass = summary.errors > 0 ? "status-fail" : summary.warnings > 0 ? "status-warn" : "status-pass";

  const statusText = summary.errors > 0 ? "Issues Found" : summary.warnings > 0 ? "Warnings" : "No Issues";

  const vpCards = results
    .map(
      (r) => `
    <div class="vp-card">
      <div class="vp-card-head">
        <h3>${esc(r.viewport.label)} — ${r.viewport.width}×${r.viewport.height}</h3>
        <span class="count">${r.findings.length} finding${r.findings.length === 1 ? "" : "s"}</span>
      </div>
      <div class="shot-wrap">
        <a href="${esc(r.screenshot)}" target="_blank" rel="noopener">
          <img src="${esc(r.screenshot)}" alt="Screenshot ${esc(r.viewport.label)}" loading="lazy" />
        </a>
      </div>
      <div class="vp-findings">
        ${r.findings.length ? r.findings.map(renderFinding).join("\n") : `<div class="no-issues">No issues at this viewport.</div>`}
      </div>
    </div>`
    )
    .join("\n");

  const allFindingsHtml = hasFindings
    ? findings.map(renderFinding).join("\n")
    : `<div class="no-issues" style="padding:18px">No issues detected across all viewports.</div>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>FrameCritic Report — ${esc(url)}</title>
<style>
  :root { --bg:#0b0e14; --card:#151a25; --card2:#1a2133; --border:#232c43; --text:#e6e8ee; --muted:#9aa3b8; --err:#ff4d6a; --warn:#ffb020; --ok:#2ecc71; --info:#4da3ff; }
  *{box-sizing:border-box}
  body{margin:0;font-family: ui-sans-system, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;background:var(--bg);color:var(--text);line-height:1.5}
  header{max-width:1200px;margin:0 auto;padding:28px 20px 10px}
  .brand{font-weight:700;letter-spacing:.04em;font-size:13px;color:var(--muted);text-transform:uppercase}
  .brand span{color:var(--text)}
  h1{margin:6px 0 4px;font-size:26px;letter-spacing:-.02em}
  .meta{color:var(--muted);font-size:13px;word-break:break-all}
  .meta a{color:var(--info);text-decoration:none}
  .meta a:hover{text-decoration:underline}
  .summary{display:flex;gap:12px;flex-wrap:wrap;margin-top:16px}
  .stat{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px 16px;min-width:140px;flex:1}
  .stat .k{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
  .stat .v{font-size:22px;font-weight:700;margin-top:2px}
  .status{margin-top:16px;display:inline-flex;align-items:center;gap:8px;padding:8px 14px;border-radius:999px;font-weight:600;font-size:13px;border:1px solid var(--border)}
  .status-fail{background:#2a1320;color:var(--err);border-color:#4a1e2e}
  .status-warn{background:#2a2210;color:var(--warn);border-color:#4a3a10}
  .status-pass{background:#0f2a1a;color:var(--ok);border-color:#1a4a2e}
  .dot{width:8px;height:8px;border-radius:50%;background:currentColor}
  main{max-width:1200px;margin:0 auto;padding:18px 20px 40px}
  h2{font-size:18px;margin:28px 0 12px;letter-spacing:-.01em}
  .grid{display:grid;grid-template-columns:1fr;gap:18px}
  @media(min-width:900px){.grid{grid-template-columns:1fr 1fr}}
  @media(min-width:1220px){.grid{grid-template-columns:1fr 1fr 1fr}}
  .vp-card{background:var(--card);border:1px solid var(--border);border-radius:14px;overflow:hidden;display:flex;flex-direction:column}
  .vp-card-head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid var(--border);background:var(--card2)}
  .vp-card-head h3{margin:0;font-size:13px;letter-spacing:.02em;text-transform:uppercase;color:var(--text)}
  .count{font-size:12px;color:var(--muted);background:#0f1422;padding:4px 8px;border-radius:999px;border:1px solid var(--border)}
  .shot-wrap{background:#0a0e1a;text-align:center;max-height:420px;overflow:auto;border-bottom:1px solid var(--border)}
  .shot-wrap img{max-width:100%;height:auto;display:block}
  .vp-findings{padding:12px;display:flex;flex-direction:column;gap:10px;max-height:360px;overflow:auto}
  .finding{background:#0f1422;border:1px solid var(--border);border-radius:10px;padding:10px 12px}
  .finding.sev-error{border-left:3px solid var(--err)}
  .finding.sev-warning{border-left:3px solid var(--warn)}
  .finding.sev-info{border-left:3px solid var(--info)}
  .finding-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .badge{font-size:10px;font-weight:700;letter-spacing:.06em;padding:3px 7px;border-radius:999px;border:1px solid transparent}
  .badge.err{background:#3a1320;color:var(--err);border-color:#5a1e2e}
  .badge.warn{background:#3a2d10;color:var(--warn);border-color:#6a4a10}
  .badge.info{background:#132a44;color:var(--info);border-color:#1e3a5a}
  .ftype{font-weight:600;font-size:13px}
  .vpill{font-size:11px;color:var(--muted);border:1px solid var(--border);padding:2px 7px;border-radius:999px;background:#0b0e14}
  .msg{margin-top:6px;font-size:13px;color:#d0d6e6}
  details{margin-top:8px}
  details summary{font-size:12px;color:var(--muted);cursor:pointer}
  pre{margin:8px 0 0;background:#080a12;border:1px solid var(--border);border-radius:8px;padding:10px;font-size:11px;overflow:auto;max-height:220px;color:#cbd5e1}
  .no-issues{color:var(--muted);font-size:13px}
  .all-findings{display:flex;flex-direction:column;gap:10px}
  footer{max-width:1200px;margin:0 auto;padding:10px 20px 30px;color:var(--muted);font-size:12px;border-top:1px solid var(--border);margin-top:10px}
  .mono{font-family: ui-monospace, SFMono-Regular, Menlo, monospace}
</style>
</head>
<body>
<header>
  <div class="brand">◐ <span>FrameCritic</span> v0.1 — Visual QA Report</div>
  <h1>${esc(statusText)}</h1>
  <div class="meta">Target: <a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a> · <span class="mono">${esc(timestamp)}</span> · Viewports: ${report.viewports.map((v) => `${esc(v.label)} ${v.width}×${v.height}`).join(" · ")}</div>
  <div class="summary">
    <div class="stat"><div class="k">Total Findings</div><div class="v">${summary.total}</div></div>
    <div class="stat"><div class="k">Errors</div><div class="v" style="color:var(--err)">${summary.errors}</div></div>
    <div class="stat"><div class="k">Warnings</div><div class="v" style="color:var(--warn)">${summary.warnings}</div></div>
    <div class="stat"><div class="k">Infos</div><div class="v" style="color:var(--info)">${summary.infos}</div></div>
  </div>
  <div class="status ${statusClass}"><span class="dot"></span> ${esc(statusText)} — ${summary.errors} error${summary.errors===1?"":"s"}, ${summary.warnings} warning${summary.warnings===1?"":"s"}</div>
</header>
<main>
  <h2>Screenshots &amp; Findings by Viewport</h2>
  <div class="grid">
    ${vpCards}
  </div>

  <h2>All Findings (flat)</h2>
  <div class="all-findings">
    ${allFindingsHtml}
  </div>
</main>
<footer>
  Generated locally by FrameCritic v0.1 — no cloud, no AI. Artifacts: <span class="mono">screenshots/*.png</span>, <span class="mono">findings.json</span>, <span class="mono">report.html</span>
</footer>
</body>
</html>`;
}
