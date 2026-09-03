import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { generateHtmlReport } from "./report.js";
import { generateComparisonHtml } from "../compare.js";
import type { ScanReport } from "../types.js";

function makeReport(overrides: Partial<ScanReport> = {}): ScanReport {
  const longSelector =
    "body > div.container > ul.list > li.item:nth-child(3) > a.very-long-class-name-that-keeps-going-and-going-0123456789-abcdefghijklmnopqrstuvwxyz > span.icon";
  const base: ScanReport = {
    url: "http://localhost:3001/?token=secret-should-not-appear",
    timestamp: "2026-09-03T00:00:00.000Z",
    viewports: [
      { label: "mobile", width: 390, height: 844 },
      { label: "desktop", width: 1440, height: 900 },
    ],
    results: [
      {
        viewport: { label: "mobile", width: 390, height: 844 },
        screenshot: "screenshots/mobile-390x844.png",
        annotatedScreenshot: "screenshots/mobile-390x844-annotated.png",
        annotations: [
          {
            id: 1,
            x: 10,
            y: 20,
            w: 100,
            h: 40,
            type: "horizontal-overflow",
            severity: "error",
            label: "overflow",
            selector: longSelector,
          },
          {
            id: 2,
            x: 0,
            y: 0,
            w: 12,
            h: 12,
            type: "accessibility",
            severity: "warning",
            label: "a11y:image-alt",
            selector: "img",
          },
        ],
        findings: [
          {
            type: "horizontal-overflow",
            severity: "error",
            viewport: "mobile",
            message: "overflow demo",
            details: { overflow: 100 } as any,
            markerIds: [1],
          },
          {
            type: "accessibility",
            severity: "warning",
            viewport: "mobile",
            message: "[a11y] image-alt (serious): Ensures <img> elements have alternate text or a role of none or presentation",
            details: {
              rule: "image-alt",
              impact: "serious",
              help: "Images must have alternate text",
              helpUrl: "https://dequeuniversity.com/rules/axe/4.8/image-alt",
              disclaimer: "Automated accessibility check — NOT WCAG compliance certification. Manual review required.",
              nodes: [{ selector: "img", html: '<img src="x">', rect: { x: 0, y: 0, w: 10, h: 10 } }],
              affectedSelectors: ["img"],
            } as any,
            markerIds: [2],
          },
        ],
      },
      {
        viewport: { label: "desktop", width: 1440, height: 900 },
        screenshot: "screenshots/desktop-1440x900.png",
        findings: [],
      },
    ],
    findings: [
      {
        type: "horizontal-overflow",
        severity: "error",
        viewport: "mobile",
        message: "overflow demo",
        details: { overflow: 100 } as any,
        markerIds: [1],
      },
      {
        type: "accessibility",
        severity: "warning",
        viewport: "mobile",
        message: "[a11y] image-alt (serious): Ensures <img> elements have alternate text",
        details: {
          rule: "image-alt",
          helpUrl: "https://dequeuniversity.com/rules/axe/4.8/image-alt",
          disclaimer: "Automated accessibility check — NOT WCAG compliance certification. Manual review required.",
        } as any,
        markerIds: [2],
      },
    ],
    summary: { total: 2, errors: 1, warnings: 1, infos: 0 },
    a11y: { enabled: true },
    ...overrides,
  };
  return base;
}

describe("report accessibility – landmarks, labels, focus, navigation", () => {
  it("has skip link targeting main content", () => {
    const html = generateHtmlReport(makeReport());
    assert.ok(html.includes('class="skip-link"'));
    assert.ok(html.includes('href="#main-content"'));
    assert.ok(html.includes('id="main-content"'));
  });

  it("has landmark roles banner / main / contentinfo", () => {
    const html = generateHtmlReport(makeReport());
    assert.ok(html.includes('role="banner"'));
    assert.ok(html.includes('role="contentinfo"'));
    assert.ok(html.includes("<main"));
    assert.ok(html.includes("<header"));
    assert.ok(html.includes("<footer"));
  });

  it("filter controls have associated labels and aria-labels", () => {
    const html = generateHtmlReport(makeReport());
    assert.ok(html.includes('for="filter-viewport"'));
    assert.ok(html.includes('for="filter-severity"'));
    assert.ok(html.includes('for="filter-type"'));
    assert.ok(html.includes('aria-label="Filter by viewport"'));
    assert.ok(html.includes('aria-label="Filter by severity"'));
    assert.ok(html.includes('aria-label="Filter by finding type"'));
    assert.ok(html.includes('aria-label="Reset all filters"'));
    assert.ok(html.includes('aria-live="polite"'));
    assert.ok(html.includes('aria-label="Filter findings"'));
  });

  it("screenshot tabs use correct ARIA tab pattern with roving tabindex", () => {
    const html = generateHtmlReport(makeReport());
    assert.ok(html.includes('role="tablist"'));
    assert.ok(html.includes('role="tab"'));
    assert.ok(html.includes('role="tabpanel"'));
    assert.ok(html.includes('aria-selected="true"'));
    assert.ok(html.includes('aria-selected="false"'));
    assert.ok(html.includes('aria-controls="panel-mobile-annotated"'));
    assert.ok(html.includes('aria-labelledby="tab-mobile-annotated"'));
    // roving tabindex: active tabindex 0, inactive -1
    assert.ok(html.includes('tabindex="0"'));
    assert.ok(html.includes('tabindex="-1"'));
    // hidden attribute for inactive panel
    assert.ok(html.includes('id="panel-mobile-clean"'));
    assert.ok(html.includes("hidden"));
    // keyboard handlers present
    assert.ok(html.includes("ArrowRight"));
    assert.ok(html.includes("Home"));
    assert.ok(html.includes("End"));
  });

  it("legend has section, heading, list roles and marker aria labels", () => {
    const html = generateHtmlReport(makeReport());
    assert.ok(html.includes('<section class="legend"'));
    assert.ok(html.includes('aria-labelledby="legend-title-mobile"'));
    assert.ok(html.includes('class="legend-title"'));
    assert.ok(html.includes('role="list"'));
    assert.ok(html.includes('role="listitem"'));
    assert.ok(html.includes('aria-label="Marker 1"'));
  });

  it("findings use article with aria-labelledby and marker mapping", () => {
    const html = generateHtmlReport(makeReport());
    assert.ok(html.includes('<article class="finding'));
    assert.ok(html.includes('aria-labelledby="finding-title-0"'));
    assert.ok(html.includes('id="finding-title-0"'));
    assert.ok(html.includes('aria-label="Markers 1"'));
    assert.ok(html.includes('marker-badge'));
  });

  it("images have descriptive alt text (not generic)", () => {
    const html = generateHtmlReport(makeReport());
    assert.ok(html.includes("Annotated screenshot for mobile 390×844"));
    assert.ok(html.includes("highlighted region(s) marking"));
    assert.ok(html.includes("Clean screenshot for desktop 1440×900"));
    // alt should mention marker mapping legend
    assert.ok(html.includes("see legend below for marker mapping"));
  });

  it("focus behavior: focus-visible outline and focus:not focus-visible suppression", () => {
    const html = generateHtmlReport(makeReport());
    assert.ok(html.includes("*:focus-visible"));
    assert.ok(html.includes("outline:2px solid var(--focus)"));
    assert.ok(html.includes("*:focus:not(:focus-visible)"));
  });

  it("contrast tokens use accessible muted #b8c0d4 not legacy #9aa3b8", () => {
    const html = generateHtmlReport(makeReport());
    assert.ok(html.includes("--muted:#b8c0d4"));
    assert.ok(!html.includes("--muted:#9aa3b8"));
  });

  it("long selector wrapping: CSS includes overflow-wrap and truncation with title", () => {
    const html = generateHtmlReport(makeReport());
    assert.ok(html.includes("overflow-wrap:anywhere"));
    assert.ok(html.includes("word-break:break-word"));
    assert.ok(html.includes("max-width:100%"));
    // legend shows truncated display with ellipsis char …
    assert.ok(html.includes("…"));
    // full selector preserved in title attribute (escaped)
    assert.ok(html.includes('title="body &gt; div.container'));
    // mono class wraps
    assert.ok(html.includes(".mono{"));
  });

  it("filter reset returns focus to viewport filter (product polish)", () => {
    const html = generateHtmlReport(makeReport());
    assert.ok(html.includes("filter-reset"));
    assert.ok(html.includes("vpSel.focus()"));
  });

  it("filter hides findings with aria-hidden and announces count live", () => {
    const html = generateHtmlReport(makeReport());
    assert.ok(html.includes("aria-hidden"));
    assert.ok(html.includes('aria-live="polite"'));
    assert.ok(html.includes('aria-atomic="true"'));
    assert.ok(html.includes(".finding.hidden"));
  });

  it("accessibility diagnostics are readable and disclaim non-certification", () => {
    const html = generateHtmlReport(makeReport());
    assert.ok(html.includes("Automated accessibility finding"));
    assert.ok(html.includes("NOT WCAG"));
    assert.ok(html.includes("Manual review required"));
    assert.ok(html.includes("a11y-note"));
    assert.ok(html.includes("Learn more:"));
    assert.ok(html.includes("https://dequeuniversity.com/rules/axe"));
    // details JSON must be escaped, not raw <img
    assert.ok(html.includes("&lt;img"));
    assert.ok(!html.includes('<img src="x">'));
  });

  it("never claims WCAG compliance certification without qualification", () => {
    const html = generateHtmlReport(makeReport());
    // Every occurrence of the phrase must be qualified with not/NOT and disclaimer
    const lower = html.toLowerCase();
    const countPhrase = (lower.match(/wcag compliance certification/g) || []).length;
    const countQualified = (html.match(/not wcag compliance certification/gi) || []).length;
    assert.equal(countPhrase, countQualified, "all WCAG compliance mentions must be qualified with NOT");
    assert.ok(html.toLowerCase().includes("not wcag compliance certification"));
    // ensure no claim of being certified
    assert.ok(!lower.includes("wcag certified"));
  });

  it("public landing page has landmarks, label, skip link, status live, and focus styles", () => {
    const html = fs.readFileSync(path.join(process.cwd(), "public/index.html"), "utf-8");
    assert.ok(html.includes('class="skip-link"'));
    assert.ok(html.includes('role="banner"'));
    assert.ok(html.includes('id="main-content"'));
    assert.ok(html.includes('role="contentinfo"'));
    assert.ok(html.includes('for="url"'));
    assert.ok(html.includes('aria-label="URL to scan"'));
    assert.ok(html.includes('visually-hidden'));
    assert.ok(html.includes('role="status"'));
    assert.ok(html.includes('aria-live="polite"'));
    assert.ok(html.includes("*:focus-visible"));
    assert.ok(html.includes('type="button"'));
    assert.ok(html.includes('aria-label="Clear results"'));
    assert.ok(html.includes('aria-labelledby="history-heading"'));
    assert.ok(html.includes("--muted:#b8c0d4"));
    assert.ok(!html.includes("--muted:#9aa3b8"));
  });

  it("batch index has skip link, landmarks, table scope/caption, and aria-live", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/engine/batch.ts"), "utf-8");
    assert.ok(src.includes("skip-link"));
    assert.ok(src.includes('role="banner"'));
    assert.ok(src.includes('id="main-content"'));
    assert.ok(src.includes('role="contentinfo"'));
    assert.ok(src.includes('<caption'));
    assert.ok(src.includes('scope="col"'));
    assert.ok(src.includes('aria-label="Routes and per-route artifacts"'));
    assert.ok(src.includes('aria-live="polite"'));
    assert.ok(src.includes("*:focus-visible"));
    assert.ok(src.includes("overflow-wrap:anywhere"));
  });

  it("comparison report has skip link, landmarks, focus-visible, and wrapping", () => {
    const html = generateComparisonHtml({
      baselinePath: "a.json",
      currentPath: "b.json",
      timestamp: "2026-09-03T00:00:00.000Z",
      summary: { totalBaseline: 1, totalCurrent: 1, new: 1, resolved: 0, persisting: 0 },
      new: [{ type: "horizontal-overflow", severity: "error", viewport: "mobile", message: "overflow " + "x".repeat(200), fingerprint: "fp", details: { selector: "body > div.very-long-selector-".repeat(10) } } as any],
      resolved: [],
      persisting: [],
    });
    assert.ok(html.includes('class="skip-link"'));
    assert.ok(html.includes('role="banner"'));
    assert.ok(html.includes('id="main-content"'));
    assert.ok(html.includes('role="contentinfo"'));
    assert.ok(html.includes("*:focus-visible"));
    assert.ok(html.includes("overflow-wrap:anywhere"));
    assert.ok(html.includes("white-space:pre-wrap"));
  });
});
