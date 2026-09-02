import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { parseArgs } from "../cli-args.js";
import { scanUrl } from "./scanner.js";

describe("a11y CLI parsing", () => {
  it("parses --a11y flag", () => {
    const p = parseArgs(["scan", "http://a", "--a11y"]);
    assert.equal(p.a11y, true);
    assert.equal(parseArgs(["scan", "http://a"]).a11y, false);
  });
});

describe("a11y deterministic diagnostics", () => {
  let server: http.Server;
  let url: string;
  let tmpOut: string;

  before(async () => {
    const html = fs.readFileSync(path.join(process.cwd(), "fixtures/a11y-basic/index.html"), "utf-8");
    server = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(html);
    });
    await new Promise<void>((r) => server.listen(0, () => r()));
    const addr: any = server.address();
    url = `http://localhost:${addr.port}`;
    tmpOut = fs.mkdtempSync(path.join(os.tmpdir(), "fc-a11y-"));
  });

  after(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    fs.rmSync(tmpOut, { recursive: true, force: true });
  });

  it("opt-in: without --a11y no accessibility findings", async () => {
    const out = path.join(tmpOut, `no-${Date.now()}`);
    const report = await scanUrl({ url, outDir: out });
    assert.equal(report.a11y, null);
    assert.equal(report.findings.filter((f) => f.type === "accessibility").length, 0);
  });

  it("with --a11y produces structured findings with stable fields and selectors", async () => {
    const out = path.join(tmpOut, `yes-${Date.now()}`);
    const report = await scanUrl({ url, outDir: out, a11y: true });
    assert.equal(report.a11y?.enabled, true);
    const a11y = report.findings.filter((f) => f.type === "accessibility");
    assert.ok(a11y.length >= 2, `expected at least 2 a11y findings, got ${a11y.length}`);
    // must include image-alt and label
    const rules = a11y.map((f) => (f.details as any).rule);
    assert.ok(rules.includes("image-alt"), `missing image-alt, got ${rules.join(",")}`);
    assert.ok(rules.includes("label") || rules.includes("button-name"), `missing label/button-name, got ${rules.join(",")}`);
    for (const f of a11y) {
      assert.equal(f.type, "accessibility");
      assert.ok(["error", "warning", "info"].includes(f.severity));
      assert.ok(typeof f.message === "string" && f.message.startsWith("[a11y]"));
      const d: any = f.details;
      assert.ok(typeof d.rule === "string");
      assert.ok(Array.isArray(d.nodes));
      assert.ok(typeof d.disclaimer === "string" && d.disclaimer.includes("NOT WCAG"));
      // affectedSelectors should be present
      assert.ok(Array.isArray(d.affectedSelectors));
      // each node should have selector or html safely truncated
      for (const n of d.nodes) {
        if (n.html) assert.ok(n.html.length <= 500);
        if (n.selector) assert.ok(n.selector.length <= 300);
        if (n.rect) {
          assert.ok(typeof n.rect.x === "number" && typeof n.rect.y === "number");
        }
      }
    }
    // summary counts must include a11y
    const totalA11y = a11y.length;
    assert.equal(report.summary.total, report.findings.length);
    assert.ok(report.summary.errors + report.summary.warnings + report.summary.infos >= totalA11y);

    // findings.json contains a11y
    const json = JSON.parse(fs.readFileSync(path.join(out, "findings.json"), "utf-8"));
    assert.ok(json.findings.some((f: any) => f.type === "accessibility"));
    assert.ok(json.a11y?.enabled === true);

    // report.html contains disclaimer and not compliance certification
    const htmlReport = fs.readFileSync(path.join(out, "report.html"), "utf-8");
    assert.match(htmlReport, /Automated accessibility/);
    assert.match(htmlReport, /NOT WCAG/);
    // ensure accessibility filter type present
    assert.match(htmlReport, /accessibility/);

    // AGENT_FIXES.md contains accessibility suggestions
    const md = fs.readFileSync(path.join(out, "AGENT_FIXES.md"), "utf-8");
    assert.match(md, /accessibility/i);
    assert.match(md, /Automated accessibility/);

    // annotated evidence only where meaningful rect can be measured
    for (const r of report.results) {
      for (const ann of r.annotations ?? []) {
        if (ann.type === "accessibility") {
          assert.ok(ann.w > 0 && ann.h > 0, "meaningful rect");
          assert.ok(typeof ann.selector === "string");
        }
      }
      // at least one a11y marker per viewport
      if (a11y.length) {
        const count = (r.annotations ?? []).filter((a) => a.type === "accessibility").length;
        assert.ok(count > 0, "should have at least one a11y annotation");
      }
    }
  });

  it("handles malformed/incomplete node evidence safely and escapes rendered text", async () => {
    const maliciousHtml = `<!doctype html><html><body><main><img src="x"><input type="text" id="bad" value="<script>alert(1)</script>"><div>&lt;test&gt;</div></main></body></html>`;
    const srv = http.createServer((req, res) => { res.writeHead(200, { "Content-Type": "text/html" }); res.end(maliciousHtml); });
    await new Promise<void>((r) => srv.listen(0, () => r()));
    const addr: any = srv.address();
    const u = `http://localhost:${addr.port}`;
    const out = path.join(tmpOut, `xss-${Date.now()}`);
    const report = await scanUrl({ url: u, outDir: out, a11y: true });
    const htmlReport = fs.readFileSync(path.join(out, "report.html"), "utf-8");
    // Ensure raw unescaped suspicious strings are not present as raw HTML tags in report
    // The report's <pre> should contain escaped versions
    assert.ok(htmlReport.includes("&lt;img") || htmlReport.includes("&lt;input") || htmlReport.includes("&lt;"), "should contain escaped html");
    // Must not contain raw unescaped <img src="x"> inside the details pre that would be interpreted as HTML
    // Check that the JSON details are escaped: details pre should not contain raw "<script>" outside of escaped context
    // At minimum, report should not have an unescaped script tag from the scanned page
    const hasRawScriptTagInPre = htmlReport.includes("<script>alert(1)");
    assert.equal(hasRawScriptTagInPre, false, "script tag should be escaped");
    await new Promise<void>((r) => srv.close(() => r()));
  });

  it("does not leak credentials from target URLs in a11y artifacts", async () => {
    const html = `<!doctype html><html><body><main><img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E"><button>hi</button></main></body></html>`;
    const srv = http.createServer((req, res) => { res.writeHead(200, { "Content-Type": "text/html" }); res.end(html); });
    await new Promise<void>((r) => srv.listen(0, () => r()));
    const addr: any = srv.address();
    const credUrl = `http://user:secret@localhost:${addr.port}/?token=supersecret&api_key=key123`;
    const out = path.join(tmpOut, `cred-${Date.now()}`);
    const report = await scanUrl({ url: credUrl, outDir: out, a11y: true });
    const raw = fs.readFileSync(path.join(out, "findings.json"), "utf-8");
    assert.ok(!raw.includes("secret"));
    assert.ok(!raw.includes("supersecret"));
    assert.ok(!raw.includes("key123"));
    assert.match(raw, /\*\*\*/);
    await new Promise<void>((r) => srv.close(() => r()));
  });

  it("integrates with policy counts where appropriate", async () => {
    const out = path.join(tmpOut, `policy-${Date.now()}`);
    const report = await scanUrl({ url, outDir: out, a11y: true, policy: { failOn: "error" } });
    // image-alt and label are critical -> error, so policy should reflect errors
    assert.ok(report.policy);
    assert.ok(report.summary.errors >= 2);
  });
});
