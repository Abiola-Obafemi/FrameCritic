import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import type { Page } from "playwright";
import type { Finding } from "../types.js";
import { redactUrl } from "../security.js";

function impactToSeverity(impact: string | undefined | null): "error" | "warning" | "info" {
  const v = (impact ?? "").toLowerCase();
  if (v === "critical" || v === "serious") return "error";
  if (v === "moderate" || v === "minor") return "warning";
  return "warning";
}

function safeString(v: unknown, max = 500): string {
  if (typeof v !== "string") return String(v ?? "").slice(0, max);
  return v.slice(0, max);
}

function getAxePathSync(): string {
  // 1. Node module resolution (handles pnpm, hoisting, nested installs)
  try {
    const require = createRequire(import.meta.url);
    const resolved = require.resolve("axe-core/axe.min.js");
    if (fs.existsSync(resolved)) return resolved;
  } catch {}
  // 2. Direct filesystem candidates
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    // sibling when installed: node_modules/framecritic/dist/engine -> node_modules/axe-core
    path.resolve(thisDir, "../../../axe-core/axe.min.js"),
    // cwd-based (common when running from project root)
    path.resolve(process.cwd(), "node_modules/axe-core/axe.min.js"),
    // legacy dev fallback
    path.resolve(thisDir, "../../node_modules/axe-core/axe.min.js"),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  // 3. Search upwards from both this file and cwd (covers global installs, custom layouts)
  for (const base of [thisDir, process.cwd()]) {
    let cur = base;
    for (let i = 0; i < 8; i++) {
      const p = path.join(cur, "node_modules/axe-core/axe.min.js");
      if (fs.existsSync(p)) return p;
      const parent = path.dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
  }
  throw new Error("axe-core axe.min.js not found");
}

export async function collectA11yFindings(page: Page, viewportLabel: string): Promise<Finding[]> {
  const axePath = getAxePathSync();
  // Inject axe-core
  await page.addScriptTag({ path: axePath });

  // Run axe and enrich nodes with rects
  let violations: any[] = [];
  try {
    violations = await page.evaluate(async () => {
      const axe: any = (window as any).axe;
      if (!axe) throw new Error("axe not loaded");
      // axe.run with no config scans whole document; limit to violations
      const result = await axe.run(document, { resultTypes: ["violations"] } as any);
      const vs = (result as any).violations as any[];
      // Enrich nodes with selector string and rect
      const enriched = vs.map((v) => {
        const nodes = (v.nodes ?? []).map((n: any) => {
          let selector = "";
          try {
            if (Array.isArray(n.target)) {
              // n.target is like [["#id"], [".cls"]] or ["#id"]
              // flatten first entry
              const first = n.target[0];
              if (Array.isArray(first)) selector = first[0] ?? "";
              else if (typeof first === "string") selector = first;
              else selector = String(first ?? "");
              // fallback join
              if (!selector && n.target.length) selector = n.target.map((t: any) => (Array.isArray(t) ? t.join(" ") : String(t))).join(" | ");
            } else if (typeof n.target === "string") selector = n.target;
          } catch { selector = ""; }
          selector = typeof selector === "string" ? selector.slice(0, 300) : "";
          let rect: { x: number; y: number; w: number; h: number } | null = null;
          try {
            if (selector) {
              const el = document.querySelector(selector) as Element | null;
              if (el) {
                const r = el.getBoundingClientRect();
                // consider rect even if collapsed to still annotate small
                if (Number.isFinite(r.x) && Number.isFinite(r.y)) {
                  rect = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
                  // if both w/h 0, keep but mark as small so annotation can fallback
                  if (rect.w === 0 && rect.h === 0) {
                    // still keep rect for annotation fallback sizing
                  }
                }
              }
            }
          } catch {}
          // html snippet limited, target kept but truncated
          const html = typeof n.html === "string" ? n.html.slice(0, 500) : "";
          const failureSummary = typeof n.failureSummary === "string" ? n.failureSummary.slice(0, 800) : "";
          // impact per node
          const impact = typeof n.impact === "string" ? n.impact : undefined;
          return { target: Array.isArray(n.target) ? n.target.slice(0, 5) : n.target, html, failureSummary, impact, selector, rect };
        });
        return { ...v, nodes };
      });
      return enriched;
    });
  } catch (e: any) {
    // If axe fails, return a diagnostic finding instead of throwing
    return [{
      type: "accessibility",
      severity: "warning",
      viewport: viewportLabel,
      message: `[a11y] Automated accessibility scan failed: ${safeString(e?.message ?? String(e), 300)}`,
      details: {
        error: safeString(e?.message ?? String(e), 1000),
        disclaimer: "Automated accessibility check — not WCAG certification. Scan error; results incomplete.",
      } as any,
    }];
  }

  const findings: Finding[] = [];
  for (const v of violations) {
    const ruleId = safeString(v.id ?? "unknown", 100);
    const impact = typeof v.impact === "string" ? v.impact : undefined;
    const severity = impactToSeverity(impact);
    const description = safeString(v.description ?? v.help ?? "", 500);
    const help = safeString(v.help ?? "", 500);
    const helpUrl = safeString(v.helpUrl ?? "", 500);
    // Redact helpUrl? Not sensitive but ensure no credentials leaked if url contains token
    const safeHelpUrl = helpUrl ? redactUrl(helpUrl) : helpUrl;
    const tags: string[] = Array.isArray(v.tags) ? v.tags.slice(0, 20).map((t: any) => safeString(t, 80)) : [];
    // nodes limited to 12 per violation to bound output
    const nodesRaw = Array.isArray(v.nodes) ? v.nodes.slice(0, 12) : [];
    const nodes = nodesRaw.map((n: any) => {
      // sanitize each node safely
      const sel = typeof n.selector === "string" ? n.selector.slice(0, 300) : "";
      const html = typeof n.html === "string" ? n.html.slice(0, 500) : "";
      const failureSummary = typeof n.failureSummary === "string" ? n.failureSummary.slice(0, 800) : "";
      let rect: any = null;
      if (n.rect && typeof n.rect.x === "number" && typeof n.rect.y === "number" && typeof n.rect.w === "number" && typeof n.rect.h === "number") {
        // clamp rect values to reasonable bounds to avoid extreme overlays
        rect = { x: Math.max(-10000, Math.min(10000, Math.round(n.rect.x))), y: Math.max(-10000, Math.min(10000, Math.round(n.rect.y))), w: Math.max(0, Math.min(5000, Math.round(n.rect.w))), h: Math.max(0, Math.min(5000, Math.round(n.rect.h))) };
      }
      const target = Array.isArray(n.target) ? n.target.slice(0, 3) : n.target;
      const impactNode = typeof n.impact === "string" ? n.impact : undefined;
      return { target, selector: sel, html, failureSummary, impact: impactNode, rect };
    });

    const affectedSelectors = nodes.map((n: any) => n.selector).filter(Boolean).slice(0, 6);
    const message = `[a11y] ${ruleId}${impact ? ` (${impact})` : ""}: ${help || description}`.slice(0, 600);

    findings.push({
      type: "accessibility",
      severity,
      viewport: viewportLabel,
      message,
      details: {
        rule: ruleId,
        impact: impact ?? null,
        description,
        help,
        helpUrl: safeHelpUrl,
        tags,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        nodes: nodes as any,
        affectedSelectors,
        disclaimer: "Automated accessibility check — NOT WCAG compliance certification. Manual review required.",
      } as any,
    });
  }
  return findings;
}
