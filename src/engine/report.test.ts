import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateHtmlReport } from "./report.js";
import type { ScanReport } from "../types.js";

function makeReport(overrides: Partial<ScanReport> = {}): ScanReport {
  const base: ScanReport = {
    url: "http://localhost:3001",
    timestamp: "2026-09-01T00:00:00.000Z",
    viewports: [
      { label: "mobile", width: 390, height: 844 },
      { label: "tablet", width: 768, height: 1024 },
      { label: "desktop", width: 1440, height: 900 },
    ],
    results: [
      {
        viewport: { label: "mobile", width: 390, height: 844 },
        screenshot: "screenshots/mobile-390x844.png",
        annotatedScreenshot: "screenshots/mobile-390x844-annotated.png",
        annotations: [{ id: 1, x: 10, y: 20, w: 100, h: 40, type: "horizontal-overflow", severity: "error", label: "overflow", selector: "body > div" }],
        findings: [
          { type: "horizontal-overflow", severity: "error", viewport: "mobile", message: "overflow", details: { overflow: 100 }, markerIds: [1] },
          { type: "outside-viewport", severity: "warning", viewport: "mobile", message: "offscreen", details: {}, markerIds: [2] },
        ],
      },
      {
        viewport: { label: "desktop", width: 1440, height: 900 },
        screenshot: "screenshots/desktop-1440x900.png",
        findings: [],
      },
    ],
    findings: [
      { type: "horizontal-overflow", severity: "error", viewport: "mobile", message: "overflow", details: { overflow: 100 }, markerIds: [1] },
      { type: "outside-viewport", severity: "warning", viewport: "mobile", message: "offscreen", details: {}, markerIds: [2] },
    ],
    summary: { total: 2, errors: 1, warnings: 1, infos: 0 },
    ...overrides,
  };
  return base;
}

describe("report filtering / data generation", () => {
  it("generates HTML with compact summary", () => {
    const html = generateHtmlReport(makeReport());
    assert.match(html, /1<\/strong> errors/);
    assert.match(html, /1<\/strong> warnings/);
    assert.match(html, /1\/2.*viewports affected/);
  });

  it("includes filter controls for viewport/severity/type", () => {
    const html = generateHtmlReport(makeReport());
    assert.ok(html.includes('id="filter-viewport"'));
    assert.ok(html.includes('id="filter-severity"'));
    assert.ok(html.includes('id="filter-type"'));
    assert.ok(html.includes('id="filter-reset"'));
    // viewport options
    assert.ok(html.includes('value="mobile"'));
    assert.ok(html.includes('value="desktop"'));
    // type options sorted
    assert.ok(html.includes('value="horizontal-overflow"'));
    assert.ok(html.includes('value="outside-viewport"'));
  });

  it("renders findings with data-* attributes for filtering", () => {
    const html = generateHtmlReport(makeReport());
    assert.ok(html.includes('data-viewport="mobile"'));
    assert.ok(html.includes('data-severity="error"'));
    assert.ok(html.includes('data-type="horizontal-overflow"'));
    assert.ok(html.includes('data-severity="warning"'));
  });

  it("renders marker badges and legend mapping", () => {
    const html = generateHtmlReport(makeReport());
    assert.ok(html.includes('marker-badge'));
    assert.ok(html.includes('#1'));
    assert.ok(html.includes('Markers on this viewport'));
    assert.ok(html.includes('screenshots/mobile-390x844-annotated.png'));
  });

  it("renders annotated/clean toggle when annotations exist", () => {
    const html = generateHtmlReport(makeReport());
    assert.ok(html.includes('shot-annotated'));
    assert.ok(html.includes('shot-clean'));
    assert.ok(html.includes('Annotated'));
  });

  it("handles clean report with no findings", () => {
    const html = generateHtmlReport(
      makeReport({
        results: [
          { viewport: { label: "mobile", width: 390, height: 844 }, screenshot: "screenshots/mobile.png", findings: [] },
        ],
        findings: [],
        summary: { total: 0, errors: 0, warnings: 0, infos: 0 },
      })
    );
    assert.ok(html.includes("No issues"));
    assert.ok(html.includes("status-pass"));
  });

  it("includes AGENT_FIXES mention and marker hint", () => {
    const html = generateHtmlReport(makeReport());
    assert.ok(html.includes("AGENT_FIXES"));
    assert.ok(html.includes("Markers 1 on annotated screenshot"));
  });

  it("has filtering JS and hidden class", () => {
    const html = generateHtmlReport(makeReport());
    assert.ok(html.includes("applyFilters"));
    assert.ok(html.includes(".finding.hidden"));
  });
});
