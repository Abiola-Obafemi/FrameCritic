import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { scanUrl } from "./engine/scanner.js";
import { scanBatch } from "./engine/batch.js";
import { ARTIFACT_VERSION } from "./types.js";

describe("artifact contract and manifest", () => {
  let server: http.Server;
  let baseUrl: string;
  let tmpOut: string;
  let tmpManifest: string;

  before(async () => {
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Test</title></head><body><h1>Hello</h1><p>clean</p></body></html>`;
    server = http.createServer((req, res) => { res.writeHead(200, { "Content-Type": "text/html" }); res.end(html); });
    await new Promise<void>((r) => server.listen(0, () => r()));
    const addr: any = server.address();
    baseUrl = `http://localhost:${addr.port}`;
    tmpOut = fs.mkdtempSync(path.join(os.tmpdir(), "fc-artifact-"));
    tmpManifest = fs.mkdtempSync(path.join(os.tmpdir(), "fc-art-manifest-"));
  });

  after(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    fs.rmSync(tmpOut, { recursive: true, force: true });
    fs.rmSync(tmpManifest, { recursive: true, force: true });
  });

  it("single scan adds artifactVersion and manifest.json", async () => {
    const out = path.join(tmpOut, `single-${Date.now()}`);
    const report = await scanUrl({ url: baseUrl, outDir: out });
    assert.equal(report.artifactVersion, ARTIFACT_VERSION);
    assert.equal(ARTIFACT_VERSION, "0.2");
    // findings.json has artifactVersion
    const j = JSON.parse(fs.readFileSync(path.join(out, "findings.json"), "utf-8"));
    assert.equal(j.artifactVersion, "0.2");
    assert.ok(j.manifest);
    assert.equal(j.manifest.artifactVersion, "0.2");
    assert.equal(j.manifest.kind, "single");
    // manifest.json exists and inventories artifacts
    const manifest = JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf-8"));
    assert.equal(manifest.artifactVersion, "0.2");
    assert.equal(manifest.kind, "single");
    assert.ok(manifest.artifacts.findings === "findings.json");
    assert.ok(manifest.artifacts.report === "report.html");
    assert.ok(manifest.artifacts.agentFixes === "AGENT_FIXES.md");
    assert.ok(manifest.artifacts.manifest === "manifest.json");
    assert.ok(Array.isArray(manifest.artifacts.screenshots));
    assert.ok(manifest.artifacts.screenshots.length >= 3); // at least one per viewport (clean has no annotated but has clean)
    // screenshots paths are safe relative (no .., no absolute)
    for (const p of manifest.artifacts.screenshots) {
      assert.ok(!p.includes(".."), `screenshot path unsafe ${p}`);
      assert.ok(!path.isAbsolute(p), `screenshot path absolute ${p}`);
      assert.ok(p.startsWith("screenshots/"));
    }
    // manifest generatedAt matches report timestamp roughly
    assert.ok(typeof manifest.generatedAt === "string");
  });

  it("manifest path safety: rejects traversal-like artifact names", async () => {
    // Ensure that manifest paths are safeOutputPath checked
    const out = path.join(tmpOut, `safe-${Date.now()}`);
    await scanUrl({ url: baseUrl, outDir: out });
    const manifest = JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf-8"));
    // No traversal in any artifact path
    const allPaths = [
      manifest.artifacts.findings,
      manifest.artifacts.report,
      manifest.artifacts.agentFixes,
      manifest.artifacts.manifest,
      ...(manifest.artifacts.screenshots ?? []),
      ...(manifest.artifacts.traces ?? []),
    ];
    for (const p of allPaths) {
      assert.ok(!p.includes(".."));
      assert.ok(!p.startsWith("/"));
      assert.ok(!p.includes("\0"));
    }
  });

  it("trace artifacts appear in manifest when enabled", async () => {
    const out = path.join(tmpOut, `trace-${Date.now()}`);
    const report = await scanUrl({ url: baseUrl, outDir: out, trace: true });
    assert.ok(report.trace?.enabled);
    const manifest = JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf-8"));
    assert.ok(Array.isArray(manifest.artifacts.traces));
    assert.equal(manifest.artifacts.traces.length, 3);
    for (const p of manifest.artifacts.traces) assert.ok(p.startsWith("traces/"));
  });

  it("batch scan adds artifactVersion and manifest.json", async () => {
    const manifestPath = path.join(tmpManifest, `routes-${Date.now()}.json`);
    fs.writeFileSync(manifestPath, JSON.stringify({ routes: [{ name: "a", path: "/" }, { name: "b", path: "/" }] }));
    const out = path.join(tmpOut, `batch-${Date.now()}`);
    const batch = await scanBatch({ baseUrl, routesManifestPath: manifestPath, outDir: out });
    assert.equal(batch.artifactVersion, "0.2");
    const batchJson = JSON.parse(fs.readFileSync(path.join(out, "batch.json"), "utf-8"));
    assert.equal(batchJson.artifactVersion, "0.2");
    assert.ok(batchJson.manifest);
    assert.equal(batchJson.manifest.kind, "batch");
    const manifest = JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf-8"));
    assert.equal(manifest.artifactVersion, "0.2");
    assert.equal(manifest.kind, "batch");
    assert.equal(manifest.artifacts.batch, "batch.json");
    assert.equal(manifest.artifacts.index, "index.html");
    assert.ok(Array.isArray(manifest.artifacts.routes));
    assert.equal(manifest.artifacts.routes.length, 2);
    // ensure batch index.html is accessible html
    const indexHtml = fs.readFileSync(path.join(out, "index.html"), "utf-8");
    assert.match(indexHtml, /Batch Report/);
  });

  it("schema stability: old fields still present after adding version", async () => {
    const out = path.join(tmpOut, `stable-${Date.now()}`);
    const report = await scanUrl({ url: baseUrl, outDir: out, trace: false, a11y: false });
    // All v0.1 fields must still exist
    assert.ok(typeof report.url === "string");
    assert.ok(typeof report.timestamp === "string");
    assert.ok(Array.isArray(report.viewports));
    assert.ok(Array.isArray(report.results));
    assert.ok(Array.isArray(report.findings));
    assert.ok(typeof report.summary === "object" && typeof report.summary.total === "number");
    assert.ok(report.policy);
    // new field is additive
    assert.equal(report.artifactVersion, "0.2");
  });
});
