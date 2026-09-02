import type { ScanReport, Finding, ViewportResult } from "../types.js";

function findingSelectors(f: Finding): string[] {
  const d: any = f.details ?? {};
  switch (f.type) {
    case "horizontal-overflow":
      return (d.offenders ?? []).map((o: any) => o.selector).filter(Boolean);
    case "outside-viewport":
      return (d.elements ?? []).map((e: any) => e.selector).filter(Boolean);
    case "overlapping-elements":
      return (d.pairs ?? []).flatMap((p: any) => [p.a, p.b]).filter(Boolean);
    case "broken-image":
      return (d.images ?? []).map((i: any) => i.selector).filter(Boolean);
    case "console-error":
      return d.location?.url ? [d.location.url] : [];
    case "page-error":
      return d.url ? [String(d.url)] : d.selector ? [String(d.selector)] : [];
    case "accessibility":
      return (d.nodes ?? []).map((n: any) => n.selector).filter(Boolean).length ? (d.nodes ?? []).map((n: any) => n.selector).filter(Boolean) : (d.affectedSelectors ?? []).filter(Boolean);
    default:
      return [];
  }
}

function suggestionFor(f: Finding): string {
  const d: any = f.details ?? {};
  switch (f.type) {
    case "horizontal-overflow": {
      const ow = d.overflow;
      const off = (d.offenders ?? []).slice(0, 2).map((o: any) => `${o.selector} (${o.width}px wide, right edge ${o.right}px)`).join("; ");
      return `Investigate fixed-width or non-responsive element(s): ${off || "see offenders"}. Check for width/max-width, flex/grid constraints, and box-sizing. If overflow ${ow}px is expected (e.g. offscreen drawer), confirm it is hidden with overflow-x: hidden and aria-hidden.`;
    }
    case "outside-viewport": {
      const els = (d.elements ?? []).slice(0, 2).map((e: any) => `${e.selector} at (${e.rect?.x},${e.rect?.y}) ${e.rect?.w}×${e.rect?.h} clipped ${e.clipped}px`).join("; ");
      return `Element extends outside horizontal viewport: ${els || "see elements"}. Review absolute/fixed positioning, negative margins, or transforms. Verify whether offscreen placement is intentional and properly hidden.`;
    }
    case "overlapping-elements": {
      const p = (d.pairs ?? [])[0];
      if (!p) return "Elements overlap significantly. Review stacking context and layout at the overlapping region; verify expected z-index and positioning.";
      return `Overlap ${p.overlap?.w}×${p.overlap?.h}px (${p.overlap?.ratio * 100}% of smaller element) between ${p.a} and ${p.b}. Inspect display/position/z-index and confirm visual layering matches intent. Exact cause not determinable from geometry alone — check computed layout.`;
    }
    case "broken-image": {
      const img = (d.images ?? [])[0];
      if (!img) return "Broken image detected. Verify that the image source exists and returns 200. Add or correct alt text as needed.";
      return `Image failed to load: src="${img.src}" alt="${img.alt ?? ""}" at ${img.selector}. Verify file exists, path is correct, server returns 200, and network allows the request. Consider placeholder or error handling.`;
    }
    case "console-error": {
      const txt = d.text ?? f.message;
      const loc = d.location ? ` at ${d.location.url}:${d.location.lineNumber ?? d.location.line}:${d.location.columnNumber ?? d.location.column}` : "";
      return `Console error reported${loc}: "${txt}". Open browser DevTools console for stack trace and reproduce. If third-party, confirm whether it affects user experience.`;
    }
    case "page-error": {
      if (d.status) return `Network request failed with ${d.status} for ${d.url}. Verify endpoint, routing, and error handling; check that missing resource does not break rendering.`;
      if (d.stack) return `Uncaught page error: ${f.message}. Review stack trace and reproduce locally; guard against unhandled exceptions.`;
      return `Page/network error: ${f.message}. Investigate failed request or script error; confirm graceful fallback.`;
    }
    case "accessibility": {
      const rule = d.rule ?? "accessibility";
      const nodes = (d.nodes ?? []).slice(0, 2).map((n: any) => `${n.selector || n.target?.join?.(" ") || "(no selector)"}: ${n.failureSummary?.slice(0,120) ?? n.html?.slice(0,80) ?? ""}`).join("; ");
      const help = d.help ? ` Help: ${d.help}` : "";
      const url = d.helpUrl ? ` See ${d.helpUrl}.` : "";
      return `Automated accessibility violation [${rule}]: ${nodes || "see nodes"}. ${help}${url} This is an automated diagnostic, NOT WCAG certification — manually verify with assistive technology and axe documentation before claiming compliance. Add alt text, labels, or ARIA as indicated; confirm selectors in source.`;
    }
    default:
      return "Review the finding details and verify expected behavior in the affected viewport.";
  }
}

function buildFixPacket(report: ScanReport): string {
  const { url, timestamp, results, summary } = report;
  const affected = results.filter((r) => r.findings.length > 0).length;

  const lines: string[] = [];
  lines.push(`# AGENT_FIXES — FrameCritic`);
  lines.push(``);
  lines.push(`> Generated: ${timestamp}`);
  lines.push(`> Target: ${url}`);
  lines.push(`> Summary: ${summary.total} findings — ${summary.errors} error(s), ${summary.warnings} warning(s), ${affected}/${results.length} viewports affected`);
  lines.push(`> Viewports: ${results.map((r) => `${r.viewport.label} ${r.viewport.width}×${r.viewport.height}`).join(", ")}`);
  lines.push(``);
  lines.push(`This file is for an AI coding agent or developer to triage visual QA findings. Each finding lists evidence and a concise investigation prompt. Do not assume the suggested investigation is the definitive fix — verify in code.`);
  lines.push(``);
  lines.push(`Artifacts:`);
  lines.push(`- findings.json — structured data`);
  lines.push(`- report.html — human-readable report with filters`);
  lines.push(`- screenshots/*.png — clean captures`);
  lines.push(`- screenshots/*-annotated.png — annotated with numbered markers`);
  lines.push(``);
  lines.push(`---`);
  lines.push(``);

  let globalIdx = 0;
  for (const vr of results) {
    const vpLabel = vr.viewport.label;
    lines.push(`## Viewport: ${vpLabel} — ${vr.viewport.width}×${vr.viewport.height}`);
    lines.push(``);
    lines.push(`- Screenshot: \`${vr.screenshot}\``);
    if (vr.annotatedScreenshot) lines.push(`- Annotated: \`${vr.annotatedScreenshot}\` (${vr.annotations?.length ?? 0} markers)`);
    lines.push(`- Findings in this viewport: ${vr.findings.length}`);
    lines.push(``);

    if (!vr.findings.length) {
      lines.push(`No findings — no agent action needed for this viewport.`);
      lines.push(``);
      continue;
    }

    // Marker map for this viewport
    if (vr.annotations?.length) {
      lines.push(`**Marker map:**`);
      for (const a of vr.annotations) {
        lines.push(`- #${a.id} — ${a.type} (${a.severity}) at ${a.x},${a.y} ${a.w}×${a.h} — \`${a.selector ?? a.label}\``);
      }
      lines.push(``);
    }

    for (const f of vr.findings) {
      globalIdx++;
      const selectors = findingSelectors(f);
      const primarySelector = selectors[0] ?? "(no selector; see details)";
      const markerRef = f.markerIds?.length ? `Markers ${f.markerIds.join(", ")} on \`${vr.annotatedScreenshot ?? vr.screenshot}\`` : `No marker (non-visual finding); see \`${vr.screenshot}\``;
      const screenshotRef = vr.annotatedScreenshot ?? vr.screenshot;

      lines.push(`### ${globalIdx}. [${f.severity.toUpperCase()}] ${f.type} — ${vpLabel}`);
      lines.push(``);
      lines.push(`- **Severity:** ${f.severity}`);
      lines.push(`- **Viewport:** ${vpLabel} (${vr.viewport.width}×${vr.viewport.height})`);
      lines.push(`- **Selector:** \`${primarySelector}\``);
      if (selectors.length > 1) {
        lines.push(`- **Related selectors:** ${selectors.slice(1, 4).map((s) => "`" + s + "`").join(", ")}${selectors.length > 4 ? ` +${selectors.length - 4} more` : ""}`);
      }
      lines.push(`- **What failed:** ${f.message}`);
      if (f.details) {
        const detailStr = JSON.stringify(f.details);
        const truncated = detailStr.length > 600 ? detailStr.slice(0, 600) + "… (see findings.json)" : detailStr;
        lines.push(`- **Evidence (truncated):** \`${truncated}\``);
      }
      lines.push(`- **Screenshot:** \`${screenshotRef}\` — ${markerRef}`);
      if (f.markerIds?.length) {
        const boxes = vr.annotations?.filter((a) => f.markerIds!.includes(a.id)) ?? [];
        if (boxes.length) {
          lines.push(`- **Marker boxes:** ${boxes.map((b) => `#${b.id} at ${b.x},${b.y} ${b.w}×${b.h}`).join("; ")}`);
        }
      }
      lines.push(`- **Suggested investigation:** ${suggestionFor(f)}`);
      lines.push(``);
    }
  }

  lines.push(`---`);
  lines.push(``);
  lines.push(`**Notes for agent:**`);
  lines.push(`- Do not fabricate a fix — evidence above shows *what* failed, not always *why*. Verify in source before editing.`);
  lines.push(`- Prefer verifying selectors in code before changing layout; a selector may be generic if element has no id/class.`);
  lines.push(`- For non-visual errors (console/page), check DevTools and network tab; geometry may be unavailable.`);
  lines.push(`- Re-run \`framecritic scan ${url}\` after changes and compare findings.`);
  lines.push(``);

  return lines.join("\n");
}

export function generateAgentFixesMarkdown(report: ScanReport): string {
  return buildFixPacket(report);
}
