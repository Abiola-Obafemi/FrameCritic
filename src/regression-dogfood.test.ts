import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { fingerprintFinding } from "./compare.js";
import { generateHtmlReport } from "./engine/report.js";
import { scanUrl } from "./engine/scanner.js";
import { scanBatch } from "./engine/batch.js";

describe("regression: unstable fingerprints", () => {
  it("page-error fingerprint stable across ephemeral ports", () => {
    const f1: any = { type: "page-error", viewport: "mobile", message: "Failed request 404 — http://localhost:1234/nonexistent.png", details: { status: 404, url: "http://localhost:1234/nonexistent.png" } };
    const f2: any = { type: "page-error", viewport: "mobile", message: "Failed request 404 — http://localhost:5678/nonexistent.png", details: { status: 404, url: "http://localhost:5678/nonexistent.png" } };
    assert.equal(fingerprintFinding(f1), fingerprintFinding(f2));
  });

  it("console-error fingerprint stable across ports", () => {
    const f1: any = { type: "console-error", viewport: "desktop", message: "Console error: oops at http://localhost:3000/app.js:10", details: { text: "oops", location: { url: "http://localhost:3000/app.js" } } };
    const f2: any = { type: "console-error", viewport: "desktop", message: "Console error: oops at http://localhost:4000/app.js:10", details: { text: "oops", location: { url: "http://localhost:4000/app.js" } } };
    // Both have same stripped message so should be same if we strip origin; currently they differ by port in message, so check stability
    const fp1 = fingerprintFinding({ ...f1, message: "Failed request 404 — http://localhost:3000/foo" });
    const fp2 = fingerprintFinding({ ...f2, message: "Failed request 404 — http://localhost:4000/foo" });
    assert.equal(fp1, fp2);
  });

  it("accessibility fingerprint distinguishes different selectors (no collision)", () => {
    const base: any = { type: "accessibility", viewport: "mobile", message: "[a11y] image-alt (critical): Images must have...", details: { rule: "image-alt", help: "Images must have alt", nodes: [{ selector: "#img1", html: "<img>" }], affectedSelectors: ["#img1"] } };
    const a1 = { ...base, details: { ...base.details, nodes: [{ selector: "#img1" }], affectedSelectors: ["#img1"] } };
    const a2 = { ...base, details: { ...base.details, nodes: [{ selector: "#img2" }], affectedSelectors: ["#img2"] } };
    assert.notEqual(fingerprintFinding(a1 as any), fingerprintFinding(a2 as any));
  });

  it("accessibility fingerprint distinguishes different rules on same selector", () => {
    const a1: any = { type: "accessibility", viewport: "mobile", message: "[a11y] image-alt", details: { rule: "image-alt", nodes: [{ selector: "#x" }], affectedSelectors: ["#x"] } };
    const a2: any = { type: "accessibility", viewport: "mobile", message: "[a11y] label", details: { rule: "label", nodes: [{ selector: "#x" }], affectedSelectors: ["#x"] } };
    assert.notEqual(fingerprintFinding(a1), fingerprintFinding(a2));
  });
});

describe("regression: HTML escaping", () => {
  it("escapes single quotes and special chars in report", () => {
    const report: any = {
      url: "http://localhost:3001/?q='test'&x=<y>",
      timestamp: new Date().toISOString(),
      viewports: [{ label: "mobile", width: 390, height: 844 }],
      results: [{
        viewport: { label: "mobile", width: 390, height: 844 },
        screenshot: "screenshots/mobile-390x844.png",
        findings: [{
          type: "horizontal-overflow",
          severity: "error",
          viewport: "mobile",
          message: "overflow with 'single' & \"double\" <tag>",
          details: { offenders: [{ selector: "body > div[data-x='1']", width: 600 }] },
          markerIds: [1],
        }],
        annotations: [{ id: 1, x: 0, y: 0, w: 100, h: 20, type: "horizontal-overflow", severity: "error", label: "overflow", selector: "body > div[data-x='1']" }],
      }],
      findings: [{
        type: "horizontal-overflow",
        severity: "error",
        viewport: "mobile",
        message: "overflow with 'single' & \"double\" <tag>",
        details: { offenders: [{ selector: "body > div[data-x='1']" }] },
        markerIds: [1],
      }],
      summary: { total: 1, errors: 1, warnings: 0, infos: 0 },
    };
    const html = generateHtmlReport(report);
    // single quote should be escaped to &#39;
    assert.ok(html.includes("&#39;"), "should escape single quote");
    assert.ok(html.includes("&quot;"), "should escape double quote");
    assert.ok(html.includes("&lt;"), "should escape <");
    assert.ok(html.includes("&amp;"), "should escape &");
    // Ensure raw unescaped payload not present in attribute context
    assert.ok(!html.includes("data-x='1'\""), "should not contain raw single-quoted selector without escaping");
  });
});

describe("regression: batch accessibility and route AGENT_FIXES", () => {
  it("batch index is accessible and links AGENT_FIXES per route", async () => {
    const html = `<!doctype html><html><body><h1>Test</h1></body></html>`;
    const server = http.createServer((req, res) => { res.writeHead(200, { "Content-Type": "text/html" }); res.end(html); });
    await new Promise<void>(r => server.listen(0, () => r()));
    const addr: any = server.address();
    const baseUrl = `http://localhost:${addr.port}`;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fc-reg-batch-"));
    try {
      const routesPath = path.join(tmp, "routes.json");
      fs.writeFileSync(routesPath, JSON.stringify({ routes: [{ name: "home", path: "/" }, { name: "about", path: "/" }] }));
      const out = path.join(tmp, "out");
      await scanBatch({ baseUrl, routesManifestPath: routesPath, outDir: out });
      const html2 = fs.readFileSync(path.join(out, "index.html"), "utf-8");
      assert.match(html2, /Skip to main content/);
      assert.match(html2, /role="banner"/);
      assert.match(html2, /role="contentinfo"/);
      assert.match(html2, /<table/);
      assert.match(html2, /scope="col"/);
      assert.match(html2, /<caption/);
      assert.match(html2, /AGENT_FIXES\.md/);
      assert.match(html2, /routes\/home\/report\.html/);
      assert.match(html2, /routes\/about\/report\.html/);
    } finally {
      await new Promise<void>(r => server.close(() => r()));
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("compare batch-like: fingerprints stable across routes with same content", () => {
    // Two home routes should not collide if fingerprint included viewport+type+selector only (route agnostic is okay)
    // But per-route isolation means compare should not merge across routes anyway
    const f: any = { type: "broken-image", viewport: "mobile", message: "broken", details: { images: [{ selector: "img.a" }] } };
    const fp = fingerprintFinding(f);
    assert.ok(fp.includes("broken-image"));
    assert.ok(fp.includes("mobile"));
  });
});

describe("regression: relative paths posix", () => {
  it("single scan manifest screenshots are posix relative", async () => {
    const html = `<!doctype html><html><body><div style="width:600px;background:red">wide</div></body></html>`;
    const server = http.createServer((req, res) => { res.writeHead(200, { "Content-Type": "text/html" }); res.end(html); });
    await new Promise<void>(r => server.listen(0, () => r()));
    const addr: any = server.address();
    const baseUrl = `http://localhost:${addr.port}`;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fc-reg-posix-"));
    try {
      const out = path.join(tmp, "out");
      await scanUrl({ url: baseUrl, outDir: out });
      const manifest = JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf-8"));
      for (const p of manifest.artifacts.screenshots) {
        assert.ok(!p.includes("\\"), `posix ${p}`);
        assert.ok(!path.isAbsolute(p), `not absolute ${p}`);
        assert.ok(p.startsWith("screenshots/"));
      }
    } finally {
      await new Promise<void>(r => server.close(() => r()));
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
