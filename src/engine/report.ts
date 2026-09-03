import type { ScanReport, Finding } from "../types.js";
import { ARTIFACT_VERSION } from "../types.js";

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
    "accessibility": "Accessibility (automated)",
  };
  return map[t] ?? t;
}

function renderFinding(f: Finding, idx: number): string {
  const detailsJson = f.details ? JSON.stringify(f.details, null, 2) : "";
  const markerBadges = (f.markerIds ?? [])
    .map((id) => `<span class="marker-badge ${esc(f.severity)}" aria-label="Marker ${id}" title="Marker ${id}">#${id}</span>`)
    .join(" ");
  const hasMarkers = (f.markerIds?.length ?? 0) > 0;
  const scenarioBadge = (f as any).scenario ? `<span class="vpill" style="border-color:var(--focus);color:var(--focus)">scenario: ${esc((f as any).scenario)}</span>` : ``;
  const isA11y = f.type === "accessibility";
  const a11yNote = isA11y ? `<div class="a11y-note" role="note">Automated accessibility finding — not WCAG compliance certification. Manual review required.</div>` : ``;
  const helpLink = isA11y && (f.details as any)?.helpUrl ? `<div class="a11y-help"><a href="${esc(String((f.details as any).helpUrl))}" target="_blank" rel="noopener">Learn more: ${esc(String((f.details as any).rule ?? f.type))}</a></div>` : ``;
  return `
  <article class="finding sev-${esc(f.severity)}" data-viewport="${esc(f.viewport)}" data-severity="${esc(f.severity)}" data-type="${esc(f.type)}" id="finding-${idx}" aria-labelledby="finding-title-${idx}">
    <div class="finding-head">
      ${badge(f.severity)}
      <span class="ftype" id="finding-title-${idx}">${esc(typeLabel(f.type))}</span>
      <span class="vpill">${esc(f.viewport)}</span>
      ${scenarioBadge}
      ${hasMarkers ? `<span class="markers" aria-label="Markers ${esc(f.markerIds!.join(", "))}">${markerBadges}</span>` : ``}
    </div>
    <div class="msg">${esc(f.message)}</div>
    ${a11yNote}
    ${helpLink}
    ${hasMarkers ? `<div class="marker-hint">Markers ${esc(f.markerIds!.join(", "))} on annotated screenshot</div>` : ``}
    ${detailsJson ? `<details><summary>Details</summary><pre>${esc(detailsJson)}</pre></details>` : ``}
  </article>`;
}

export function generateHtmlReport(report: ScanReport): string {
  const { url, timestamp, results, findings, summary } = report;

  const hasFindings = findings.length > 0;
  const statusClass = summary.errors > 0 ? "status-fail" : summary.warnings > 0 ? "status-warn" : "status-pass";
  const statusText = summary.errors > 0 ? "Issues Found" : summary.warnings > 0 ? "Warnings" : "No Issues";

  const affectedViewports = results.filter((r) => r.findings.length > 0).length;
  const affectedByErrors = results.filter((r) => r.findings.some((f) => f.severity === "error")).length;
  const totalViewports = results.length;
  const suppressedCount = report.suppression?.totalSuppressed ?? 0;

  const uniqueTypes = Array.from(new Set(findings.map((f) => f.type))).sort();
  const viewports = report.viewports;

  const vpCards = results
    .map((r) => {
      const annotated = r.annotatedScreenshot;
      const clean = r.screenshot;
      const annCount = r.annotations?.length ?? 0;
      const typesInVp = Array.from(new Set(r.findings.map((f) => typeLabel(f.type)))).join(", ") || "no issues";
      const annAlt = `Annotated screenshot for ${r.viewport.label} ${r.viewport.width}×${r.viewport.height} — ${annCount ? `${annCount} highlighted region(s) marking ${typesInVp}` : "no regions"} — see legend below for marker mapping`;
      const cleanAlt = `Clean screenshot for ${r.viewport.label} ${r.viewport.width}×${r.viewport.height} — no highlights — ${r.findings.length ? `${r.findings.length} finding(s)` : "no findings"} at this viewport`;
      const tabIdAnn = `tab-${esc(r.viewport.label)}-annotated`;
      const tabIdClean = `tab-${esc(r.viewport.label)}-clean`;
      const panelIdAnn = `panel-${esc(r.viewport.label)}-annotated`;
      const panelIdClean = `panel-${esc(r.viewport.label)}-clean`;
      const shotHtml = annotated
        ? `<div class="shot-tabs" data-vp="${esc(r.viewport.label)}">
            <div class="tab-bar">
              <div role="tablist" aria-label="Screenshot view for ${esc(r.viewport.label)}">
                <button class="tab active" role="tab" id="${tabIdAnn}" aria-selected="true" aria-controls="${panelIdAnn}" data-tab="annotated">Annotated · ${annCount} marker${annCount === 1 ? "" : "s"}</button>
                <button class="tab" role="tab" id="${tabIdClean}" aria-selected="false" aria-controls="${panelIdClean}" data-tab="clean">Clean</button>
              </div>
              <a class="tab-link" href="${esc(annotated)}" target="_blank" rel="noopener" aria-label="Open annotated screenshot for ${esc(r.viewport.label)} in new tab">open ↗</a>
            </div>
            <div class="shot-wrap">
              <div id="${panelIdAnn}" role="tabpanel" aria-labelledby="${tabIdAnn}">
                <img class="shot-img shot-annotated" src="${esc(annotated)}" alt="${esc(annAlt)}" loading="lazy" />
              </div>
              <div id="${panelIdClean}" role="tabpanel" aria-labelledby="${tabIdClean}" hidden>
                <img class="shot-img shot-clean" src="${esc(clean)}" alt="${esc(cleanAlt)}" loading="lazy" />
              </div>
            </div>
          </div>`
        : `<div class="shot-wrap">
            <a href="${esc(clean)}" target="_blank" rel="noopener" aria-label="Open clean screenshot for ${esc(r.viewport.label)}"><img src="${esc(clean)}" alt="${esc(cleanAlt)}" loading="lazy" /></a>
           </div>`;

      const legend = r.annotations?.length
        ? `<section class="legend" aria-labelledby="legend-title-${esc(r.viewport.label)}">
            <h4 class="legend-title" id="legend-title-${esc(r.viewport.label)}">Markers on this viewport</h4>
            <div class="legend-grid" role="list">
              ${r.annotations
                .map(
                  (a) => `
                <div class="legend-item sev-${esc(a.severity)}" role="listitem">
                  <span class="legend-id ${esc(a.severity)}" aria-label="Marker ${a.id}">#${a.id}</span>
                  <span class="legend-type">${esc(typeLabel(a.type))}</span>
                  <span class="legend-label">${esc(a.label)}</span>
                  ${a.selector ? `<span class="legend-sel mono" title="${esc(a.selector)}">${esc(a.selector.length > 42 ? a.selector.slice(0, 42) + "…" : a.selector)}</span>` : ""}
                </div>`
                )
                .join("")}
            </div>
          </section>`
        : ``;

      const findingsHtml = r.findings.length
        ? r.findings.map((f) => renderFinding(f, findings.indexOf(f))).join("\n")
        : `<div class="no-issues">No issues at this viewport.</div>`;

      return `
    <div class="vp-card" data-viewport="${esc(r.viewport.label)}">
      <div class="vp-card-head">
        <h3>${esc(r.viewport.label)} — ${r.viewport.width}×${r.viewport.height}</h3>
        <span class="count">${r.findings.length} finding${r.findings.length === 1 ? "" : "s"}${annCount ? ` · ${annCount} marker${annCount === 1 ? "" : "s"}` : ""}</span>
      </div>
      ${shotHtml}
      ${legend}
      <div class="vp-findings">
        ${findingsHtml}
      </div>
    </div>`;
    })
    .join("\n");

  const allFindingsHtml = hasFindings
    ? findings.map((f, i) => renderFinding(f, i)).join("\n")
    : `<div class="no-issues" style="padding:18px">No issues detected across all viewports.</div>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>FrameCritic Report — ${esc(url)}</title>
<style>
  :root { --bg:#0b0e14; --card:#151a25; --card2:#1a2133; --border:#232c43; --text:#e6e8ee; --muted:#b8c0d4; --err:#ff4d6a; --warn:#ffb020; --ok:#2ecc71; --info:#4da3ff; --focus:#7c5cff; }
  *{box-sizing:border-box}
  *:focus-visible{outline:2px solid var(--focus);outline-offset:2px;border-radius:2px}
  *:focus:not(:focus-visible){outline:none}
  .skip-link{position:absolute;left:-9999px;top:auto;width:1px;height:1px;overflow:hidden}
  .skip-link:focus{left:12px;top:12px;width:auto;height:auto;background:var(--card);color:var(--text);padding:8px 12px;border-radius:8px;border:1px solid var(--border);z-index:9999}
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
  .stat .sub{font-size:11px;color:var(--muted);margin-top:2px}
  .status{margin-top:16px;display:inline-flex;align-items:center;gap:8px;padding:8px 14px;border-radius:999px;font-weight:600;font-size:13px;border:1px solid var(--border)}
  .status-fail{background:#2a1320;color:var(--err);border-color:#4a1e2e}
  .status-warn{background:#2a2210;color:var(--warn);border-color:#4a3a10}
  .status-pass{background:#0f2a1a;color:var(--ok);border-color:#1a4a2e}
  .dot{width:8px;height:8px;border-radius:50%;background:currentColor}
  /* compact summary */
  .compact{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
  .compact-pill{display:inline-flex;align-items:center;gap:6px;padding:7px 10px;border-radius:999px;border:1px solid var(--border);background:var(--card);font-size:12px;font-weight:600}
  .compact-pill.err{border-color:#4a1e2e;color:var(--err)}
  .compact-pill.warn{border-color:#4a3a10;color:var(--warn)}
  .compact-pill.vp{color:var(--muted)}
  .compact-pill strong{color:inherit}
  /* filters */
  .filters{position:sticky;top:0;z-index:10;background:rgba(11,14,20,0.92);backdrop-filter:blur(8px);border:1px solid var(--border);border-radius:12px;padding:12px;margin-top:18px;display:flex;gap:10px;flex-wrap:wrap;align-items:end}
  .filters label{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);display:flex;flex-direction:column;gap:4px;flex:1;min-width:140px}
  .filters select{appearance:none;background:var(--card);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:8px 10px;font-size:13px}
  .filters button{padding:8px 12px;border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--muted);font-weight:600;cursor:pointer}
  .filters .results-count{font-size:12px;color:var(--muted);align-self:center;margin-left:auto}
  main{max-width:1200px;margin:0 auto;padding:18px 20px 40px}
  h2{font-size:18px;margin:28px 0 12px;letter-spacing:-.01em}
  .grid{display:grid;grid-template-columns:1fr;gap:18px}
  @media(min-width:900px){.grid{grid-template-columns:1fr 1fr}}
  @media(min-width:1220px){.grid{grid-template-columns:1fr 1fr 1fr}}
  .vp-card{background:var(--card);border:1px solid var(--border);border-radius:14px;overflow:hidden;display:flex;flex-direction:column}
  .vp-card-head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid var(--border);background:var(--card2)}
  .vp-card-head h3{margin:0;font-size:13px;letter-spacing:.02em;text-transform:uppercase;color:var(--text)}
  .count{font-size:12px;color:var(--muted);background:#0f1422;padding:4px 8px;border-radius:999px;border:1px solid var(--border)}
  .shot-tabs{border-bottom:1px solid var(--border)}
  .tab-bar{display:flex;gap:6px;align-items:center;padding:8px 10px;background:var(--card2);border-bottom:1px solid var(--border)}
  .tab{appearance:none;border:1px solid var(--border);background:#0f1422;color:var(--muted);padding:6px 10px;border-radius:999px;font-size:11px;font-weight:700;cursor:pointer}
  .tab.active{background:var(--text);color:var(--bg);border-color:var(--text)}
  .tab-link{margin-left:auto;font-size:11px;color:var(--muted);text-decoration:none;border:1px solid var(--border);padding:6px 10px;border-radius:999px;background:#0f1422}
  .tab-link:hover{color:var(--text)}
  .shot-wrap{background:#0a0e1a;text-align:center;max-height:460px;overflow:auto;border-bottom:1px solid var(--border)}
  .shot-wrap img{max-width:100%;height:auto;display:block}
  .shot-img{max-width:100%}
  .legend{padding:10px 12px;background:#0f1422;border-bottom:1px solid var(--border)}
  .legend-title{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:700;margin-bottom:6px}
  .legend-grid{display:flex;flex-direction:column;gap:4px}
  .legend-item{display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:11px;border-left:3px solid transparent;padding:3px 6px;border-radius:6px}
  .legend-item.sev-error{border-left-color:var(--err);background:rgba(255,77,106,0.08)}
  .legend-item.sev-warning{border-left-color:var(--warn);background:rgba(255,176,32,0.08)}
  .legend-id{font-weight:800;padding:1px 6px;border-radius:999px;border:1px solid transparent;font-size:11px}
  .legend-id.error{background:#3a1320;color:var(--err);border-color:#5a1e2e}
  .legend-id.warning{background:#3a2d10;color:var(--warn);border-color:#6a4a10}
  .legend-type{font-weight:600;color:var(--text)}
  .legend-label{color:var(--muted)}
  .legend-sel{font-size:10px;background:#0b0e14;border:1px solid var(--border);padding:1px 5px;border-radius:6px}
  .vp-findings{padding:12px;display:flex;flex-direction:column;gap:10px;max-height:420px;overflow:auto}
  .finding{background:#0f1422;border:1px solid var(--border);border-radius:10px;padding:10px 12px}
  .finding.sev-error{border-left:3px solid var(--err)}
  .finding.sev-warning{border-left:3px solid var(--warn)}
  .finding.sev-info{border-left:3px solid var(--info)}
  .finding.hidden{display:none}
  .finding-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .badge{font-size:10px;font-weight:700;letter-spacing:.06em;padding:3px 7px;border-radius:999px;border:1px solid transparent}
  .badge.err{background:#3a1320;color:var(--err);border-color:#5a1e2e}
  .badge.warn{background:#3a2d10;color:var(--warn);border-color:#6a4a10}
  .badge.info{background:#132a44;color:var(--info);border-color:#1e3a5a}
  .ftype{font-weight:600;font-size:13px}
  .vpill{font-size:11px;color:var(--muted);border:1px solid var(--border);padding:2px 7px;border-radius:999px;background:#0b0e14}
  .markers{display:inline-flex;gap:4px}
  .marker-badge{font-size:11px;font-weight:800;padding:2px 6px;border-radius:999px;border:1px solid #fff;min-width:18px;text-align:center;line-height:16px}
  .marker-badge.error{background:var(--err);color:#fff}
  .marker-badge.warning{background:var(--warn);color:#111}
  .marker-hint{font-size:11px;color:var(--muted);margin-top:4px}
  .msg{margin-top:6px;font-size:13px;color:#d0d6e6}
  details{margin-top:8px}
  details summary{font-size:12px;color:var(--muted);cursor:pointer}
  pre{margin:8px 0 0;background:#080a12;border:1px solid var(--border);border-radius:8px;padding:10px;font-size:11px;overflow:auto;max-height:220px;color:#cbd5e1}
  .no-issues{color:var(--muted);font-size:13px}
  .all-findings{display:flex;flex-direction:column;gap:10px}
  .a11y-note{margin-top:6px;padding:6px 8px;border-radius:8px;background:rgba(124,92,255,0.12);border:1px solid #2a2a4a;color:#b8b8ff;font-size:11px}
  .a11y-help{margin-top:4px;font-size:11px}
  .a11y-help a{color:var(--info);text-decoration:none}
  .a11y-help a:hover{text-decoration:underline}
  footer{max-width:1200px;margin:0 auto;padding:10px 20px 30px;color:var(--muted);font-size:12px;border-top:1px solid var(--border);margin-top:10px}
  .mono{font-family: ui-monospace, SFMono-Regular, Menlo, monospace}
</style>
</head>
<body>
<a class="skip-link" href="#main-content">Skip to main content</a>
<header role="banner">
  <div class="brand" aria-label="FrameCritic version ${esc(ARTIFACT_VERSION)}">◐ <span>FrameCritic</span> v${esc(ARTIFACT_VERSION)} — Visual QA Report</div>
  <h1>${esc(statusText)}</h1>
  <div class="meta">Target: <a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a> · <span class="mono">${esc(timestamp)}</span> · Viewports: ${report.viewports.map((v) => `${esc(v.label)} ${v.width}×${v.height}`).join(" · ")}</div>
  <div class="summary">
    <div class="stat"><div class="k">Total Findings</div><div class="v">${summary.total}</div></div>
    <div class="stat"><div class="k">Errors</div><div class="v" style="color:var(--err)">${summary.errors}</div><div class="sub">${affectedByErrors}/${totalViewports} viewports with errors</div></div>
    <div class="stat"><div class="k">Warnings</div><div class="v" style="color:var(--warn)">${summary.warnings}</div><div class="sub">${affectedViewports}/${totalViewports} viewports affected</div></div>
    <div class="stat"><div class="k">Infos</div><div class="v" style="color:var(--info)">${summary.infos}</div></div>
  </div>
  ${report.scenario ? `<div role="note" aria-label="Scenario" style="margin-top:10px;padding:10px 12px;border-radius:10px;border:1px solid #2a2a4a;background:#151530;color:#b8b8ff;font-size:12px"><strong>Scenario:</strong> <span class="mono">${esc(report.scenario.name)}</span> — ${report.scenario.steps.length} step(s)${report.scenario.file ? ` — <span class="mono">${esc(report.scenario.file)}</span>` : ""}<br><span class="mono">${esc(report.scenario.steps.map(s => s.action + (s.selector ? ` ${s.selector}` : s.ms ? ` wait ${s.ms}ms` : s.key ? ` press ${s.key}` : "")).join(" → "))}</span></div>` : ``}
  ${report.trace?.enabled ? `<div role="note" aria-label="Trace artifacts" style="margin-top:10px;padding:10px 12px;border-radius:10px;border:1px solid #2a4a1e;background:#1a2a0f;color:#b8d4b8;font-size:12px"><strong>Trace:</strong> ${report.trace.files.length} file(s) — ${esc(report.trace.files.join(", "))} — view with <span class="mono">npx playwright show-trace ${esc(report.trace.files[0] ?? "")}</span></div>` : ``}
  ${report.a11y?.enabled ? `<div role="note" aria-label="Accessibility scan" style="margin-top:10px;padding:10px 12px;border-radius:10px;border:1px solid #2a2a4a;background:#151530;color:#b8b8ff;font-size:12px"><strong>Accessibility:</strong> Automated scan enabled (axe-core) — findings labeled <span class="mono">accessibility</span> are automated diagnostics, NOT WCAG compliance certification. Manual review required.</div>` : ``}
  ${report.policy ? `<div role="note" aria-label="Policy decision" style="margin-top:10px;padding:10px 12px;border-radius:10px;border:1px solid ${report.policy.failed ? "#4a1e2e" : "#1a4a2e"};background:${report.policy.failed ? "#2a1320" : "#0f2a1a"};color:${report.policy.failed ? "var(--err)" : "var(--ok)"};font-size:12px;font-weight:600">Policy: fail-on=${esc(report.policy.failOn)}${report.policy.maxWarnings !== undefined ? `, max-warnings=${report.policy.maxWarnings}` : ""} → ${report.policy.failed ? "FAIL" : "PASS"} — ${esc(report.policy.reason)} (exit ${report.policy.exitCode})</div>` : ``}
  <div class="compact">
    <span class="compact-pill err"><strong>${summary.errors}</strong> errors</span>
    <span class="compact-pill warn"><strong>${summary.warnings}</strong> warnings</span>
    <span class="compact-pill vp"><strong>${affectedViewports}/${totalViewports}</strong> viewports affected${affectedByErrors ? ` · ${affectedByErrors} with errors` : ""}</span>
    ${suppressedCount ? `<span class="compact-pill" style="color:#9aa3b8;border-style:dashed"><strong>${suppressedCount}</strong> suppressed</span>` : ``}
    ${report.policy ? `<span class="compact-pill" style="border-color:${report.policy.failed ? "#4a1e2e" : "#1a4a2e"};color:${report.policy.failed ? "var(--err)" : "var(--ok)"}"><strong>policy ${report.policy.failed ? "FAIL" : "PASS"}</strong></span>` : ``}
  </div>
  <div class="status ${statusClass}" role="status" aria-live="polite"><span class="dot" aria-hidden="true"></span> ${esc(statusText)} — ${summary.errors} error${summary.errors===1?"":"s"}, ${summary.warnings} warning${summary.warnings===1?"":"s"} · ${affectedViewports}/${totalViewports} viewports affected${suppressedCount ? ` · ${suppressedCount} suppressed` : ""}${report.policy ? ` · policy ${report.policy.failed ? "FAIL" : "PASS"}` : ""}</div>
  ${suppressedCount ? `<div role="note" aria-label="Suppressed findings" style="margin-top:10px;padding:10px 12px;border-radius:10px;border:1px dashed var(--border);background:rgba(154,163,184,0.08);color:var(--muted);font-size:12px">${suppressedCount} finding(s) suppressed by config ${report.suppression?.configPath ? `(<span class="mono">${esc(report.suppression.configPath)}</span>)` : ""} — see findings.json suppression details.</div>` : ``}
  <nav class="filters" id="filters" aria-label="Filter findings">
    <label for="filter-viewport">Viewport
      <select id="filter-viewport" aria-label="Filter by viewport">
        <option value="all">All viewports</option>
        ${viewports.map((v) => `<option value="${esc(v.label)}">${esc(v.label)} ${v.width}×${v.height}</option>`).join("")}
      </select>
    </label>
    <label for="filter-severity">Severity
      <select id="filter-severity" aria-label="Filter by severity">
        <option value="all">All severities</option>
        <option value="error">error</option>
        <option value="warning">warning</option>
        <option value="info">info</option>
      </select>
    </label>
    <label for="filter-type">Finding type
      <select id="filter-type" aria-label="Filter by finding type">
        <option value="all">All types</option>
        ${uniqueTypes.map((t) => `<option value="${esc(t)}">${esc(typeLabel(t))}</option>`).join("")}
      </select>
    </label>
    <button id="filter-reset" type="button" aria-label="Reset all filters">Reset</button>
    <span class="results-count" id="filter-count" aria-live="polite" aria-atomic="true">${summary.total} findings</span>
  </nav>
</header>
<main id="main-content">
  <h2 id="vp-heading">Screenshots &amp; Findings by Viewport</h2>
  <div class="grid" id="vp-grid" aria-labelledby="vp-heading">
    ${vpCards}
  </div>

  <h2 id="flat-heading">All Findings (flat) — filtered</h2>
  <div class="all-findings" id="flat-findings" aria-labelledby="flat-heading">
    ${allFindingsHtml}
  </div>
</main>
<footer role="contentinfo">
  Generated locally by FrameCritic v${esc(ARTIFACT_VERSION)} — no cloud, no AI. Artifacts: <span class="mono">screenshots/*.png</span> + <span class="mono">*-annotated.png</span>, <span class="mono">findings.json</span>, <span class="mono">report.html</span>, <span class="mono">AGENT_FIXES.md</span> — markers link findings to annotated regions.
</footer>
<script>
(function(){
  const vpSel = document.getElementById('filter-viewport');
  const sevSel = document.getElementById('filter-severity');
  const typeSel = document.getElementById('filter-type');
  const resetBtn = document.getElementById('filter-reset');
  const countEl = document.getElementById('filter-count');

  function applyFilters(){
    const vp = vpSel.value;
    const sev = sevSel.value;
    const type = typeSel.value;
    let visible = 0;
    let total = 0;
    document.querySelectorAll('.finding').forEach(el=>{
      total++;
      const mVp = vp === 'all' || el.dataset.viewport === vp;
      const mSev = sev === 'all' || el.dataset.severity === sev;
      const mType = type === 'all' || el.dataset.type === type;
      const show = mVp && mSev && mType;
      el.classList.toggle('hidden', !show);
      el.setAttribute('aria-hidden', String(!show));
      if(show) visible++;
    });
    document.querySelectorAll('.vp-card').forEach(card=>{
      const vpLabel = card.dataset.viewport;
      const vpMatch = vp === 'all' || vpLabel === vp;
      card.style.display = vpMatch ? '' : 'none';
      card.setAttribute('aria-hidden', String(!vpMatch));
    });
    countEl.textContent = visible + ' / ' + total + ' findings visible';
  }
  vpSel.addEventListener('change', applyFilters);
  sevSel.addEventListener('change', applyFilters);
  typeSel.addEventListener('change', applyFilters);
  resetBtn.addEventListener('click', ()=>{ vpSel.value='all'; sevSel.value='all'; typeSel.value='all'; applyFilters(); vpSel.focus(); });

  // screenshot tab switching — keyboard accessible
  document.querySelectorAll('.shot-tabs').forEach(tabs=>{
    const btns = Array.from(tabs.querySelectorAll('[role="tab"]'));
    const panels = Array.from(tabs.querySelectorAll('[role="tabpanel"]'));
    function activate(idx){
      btns.forEach((b,i)=>{
        const active = i===idx;
        b.classList.toggle('active', active);
        b.setAttribute('aria-selected', String(active));
        b.tabIndex = active ? 0 : -1;
      });
      panels.forEach((p,i)=>{
        const active = i===idx;
        if(active){ p.removeAttribute('hidden'); } else { p.setAttribute('hidden',''); }
      });
    }
    btns.forEach((btn, idx)=>{
      btn.addEventListener('click', ()=> activate(idx));
      btn.addEventListener('keydown', (e)=>{
        const key = e.key;
        let next = -1;
        if(key==='ArrowRight' || key==='ArrowLeft'){
          e.preventDefault();
          const dir = key==='ArrowRight' ? 1 : -1;
          next = (idx + dir + btns.length) % btns.length;
        } else if(key==='Home'){ e.preventDefault(); next=0; }
        else if(key==='End'){ e.preventDefault(); next=btns.length-1; }
        if(next!==-1){ activate(next); btns[next].focus(); }
      });
    });
  });
})();
</script>
</body>
</html>`;
}
