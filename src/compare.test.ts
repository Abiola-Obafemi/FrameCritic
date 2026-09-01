import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fingerprintFinding, compareReports, generateComparisonHtml } from "./compare.js";
import type { Finding } from "./types.js";

function makeFinding(over: Partial<Finding> & { type: Finding["type"]; viewport: string; message: string; details?: any }): Finding {
  return { severity: "error", ...over } as Finding;
}

describe("fingerprint", () => {
  it("stable across ordering differences", () => {
    const a = makeFinding({ type: "horizontal-overflow", viewport: "mobile", message: "ov", details: { offenders: [{ selector: "b" }, { selector: "a" }] } });
    const b = makeFinding({ type: "horizontal-overflow", viewport: "mobile", message: "ov", details: { offenders: [{ selector: "a" }, { selector: "b" }] } });
    assert.equal(fingerprintFinding(a), fingerprintFinding(b));
  });
  it("selector normalization", () => {
    const a = makeFinding({ type: "broken-image", viewport: "mobile", message: "broken", details: { images: [{ selector: "BODY  >  div.foo" }] } });
    const b = makeFinding({ type: "broken-image", viewport: "mobile", message: "broken", details: { images: [{ selector: "body > div.foo" }] } });
    assert.equal(fingerprintFinding(a), fingerprintFinding(b));
  });
  it("viewport change changes fingerprint", () => {
    const a = makeFinding({ type: "broken-image", viewport: "mobile", message: "broken", details: { images: [{ selector: "img.a" }] } });
    const b = makeFinding({ type: "broken-image", viewport: "desktop", message: "broken", details: { images: [{ selector: "img.a" }] } });
    assert.notEqual(fingerprintFinding(a), fingerprintFinding(b));
  });
  it("ignores volatile fields like timestamp", () => {
    const a = makeFinding({ type: "overlapping-elements", viewport: "mobile", message: "overlap", details: { pairs: [{ a: "x", b: "y" }] } });
    const b = makeFinding({ type: "overlapping-elements", viewport: "mobile", message: "different message but same selectors", details: { pairs: [{ a: "x", b: "y" }] } });
    // same selectors => same fp even if message differs for structural types
    assert.equal(fingerprintFinding(a), fingerprintFinding(b));
  });
});

describe("compareReports", () => {
  function writeReport(findings: Finding[], file: string) {
    const report = { url: "http://test", timestamp: new Date().toISOString(), viewports: [], results: [], findings, summary: { total: findings.length, errors: 0, warnings: 0, infos: 0 } };
    fs.writeFileSync(file, JSON.stringify(report), "utf-8");
  }

  it("identical scans => all persisting", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fc-cmp-"));
    const f = makeFinding({ type: "broken-image", viewport: "mobile", message: "broken", details: { images: [{ selector: "img.a" }] } });
    const p1 = path.join(tmp, "b.json");
    const p2 = path.join(tmp, "c.json");
    writeReport([f], p1);
    writeReport([f], p2);
    const res = compareReports(p1, p2);
    assert.equal(res.summary.persisting, 1);
    assert.equal(res.summary.new, 0);
    assert.equal(res.summary.resolved, 0);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("new issue", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fc-cmp-"));
    const f1 = makeFinding({ type: "broken-image", viewport: "mobile", message: "broken", details: { images: [{ selector: "img.a" }] } });
    const f2 = makeFinding({ type: "horizontal-overflow", viewport: "mobile", message: "ov", details: { offenders: [{ selector: "div.wide" }] } });
    writeReport([f1], path.join(tmp, "b.json"));
    writeReport([f1, f2], path.join(tmp, "c.json"));
    const res = compareReports(path.join(tmp, "b.json"), path.join(tmp, "c.json"));
    assert.equal(res.summary.new, 1);
    assert.equal(res.new[0].type, "horizontal-overflow");
    assert.equal(res.summary.persisting, 1);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("resolved issue", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fc-cmp-"));
    const f1 = makeFinding({ type: "broken-image", viewport: "mobile", message: "broken", details: { images: [{ selector: "img.a" }] } });
    const f2 = makeFinding({ type: "horizontal-overflow", viewport: "mobile", message: "ov", details: { offenders: [{ selector: "div.wide" }] } });
    writeReport([f1, f2], path.join(tmp, "b.json"));
    writeReport([f1], path.join(tmp, "c.json"));
    const res = compareReports(path.join(tmp, "b.json"), path.join(tmp, "c.json"));
    assert.equal(res.summary.resolved, 1);
    assert.equal(res.resolved[0].type, "horizontal-overflow");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("persisting issue", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fc-cmp-"));
    const f = makeFinding({ type: "outside-viewport", viewport: "mobile", message: "out", details: { elements: [{ selector: "div.off" }] } });
    writeReport([f], path.join(tmp, "b.json"));
    writeReport([f], path.join(tmp, "c.json"));
    const res = compareReports(path.join(tmp, "b.json"), path.join(tmp, "c.json"));
    assert.equal(res.summary.persisting, 1);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("empty baseline => all new", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fc-cmp-"));
    const f = makeFinding({ type: "broken-image", viewport: "mobile", message: "broken", details: { images: [{ selector: "img.a" }] } });
    writeReport([], path.join(tmp, "b.json"));
    writeReport([f], path.join(tmp, "c.json"));
    const res = compareReports(path.join(tmp, "b.json"), path.join(tmp, "c.json"));
    assert.equal(res.summary.new, 1);
    assert.equal(res.summary.resolved, 0);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("ordering differences do not affect compare", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fc-cmp-"));
    const f1 = makeFinding({ type: "broken-image", viewport: "mobile", message: "b1", details: { images: [{ selector: "img.a" }] } });
    const f2 = makeFinding({ type: "outside-viewport", viewport: "mobile", message: "out", details: { elements: [{ selector: "div.off" }] } });
    writeReport([f1, f2], path.join(tmp, "b.json"));
    writeReport([f2, f1], path.join(tmp, "c.json"));
    const res = compareReports(path.join(tmp, "b.json"), path.join(tmp, "c.json"));
    assert.equal(res.summary.persisting, 2);
    assert.equal(res.summary.new, 0);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("generates comparison html with sections", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fc-cmp-"));
    const f = makeFinding({ type: "broken-image", viewport: "mobile", message: "broken", details: { images: [{ selector: "img.a" }] } });
    writeReport([f], path.join(tmp, "b.json"));
    writeReport([], path.join(tmp, "c.json"));
    const res = compareReports(path.join(tmp, "b.json"), path.join(tmp, "c.json"));
    const html = generateComparisonHtml(res);
    assert.match(html, /RESOLVED/);
    assert.match(html, /NEW/);
    assert.match(html, /fingerprints/);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("CLI compare baseline/current args parsing", async () => {
    const { parseArgs } = await import("./cli-args.js");
    const p = parseArgs(["compare", "a.json", "b.json", "--output", "out", "--fail-on-new"]);
    assert.equal(p.command, "compare");
    assert.equal(p.compareBaseline, "a.json");
    assert.equal(p.compareCurrent, "b.json");
    assert.equal(p.output, "out");
    assert.equal(p.failOnNew, true);
  });

  it("fingerprint does not include timestamps/screenshot paths", () => {
    const f1 = makeFinding({ type: "broken-image", viewport: "mobile", message: "broken", details: { images: [{ selector: "img.a", rect: { x: 0, y: 0, w: 10, h: 10 } }], timestamp: "2020" } as any });
    const f2 = makeFinding({ type: "broken-image", viewport: "mobile", message: "broken", details: { images: [{ selector: "img.a", rect: { x: 0, y: 0, w: 10, h: 10 } }] } });
    // both should have same fingerprint despite extra volatile field
    assert.equal(fingerprintFinding(f1), fingerprintFinding(f2));
  });
});
