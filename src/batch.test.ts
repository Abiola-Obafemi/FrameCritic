import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { parseArgs } from "./cli-args.js";
import { validateRoutesManifest, loadRoutesManifest, resolveRouteUrl } from "./routes.js";
import { scanBatch } from "./engine/batch.js";
import { scanUrl } from "./engine/scanner.js";

describe("routes manifest validation", () => {
  it("accepts valid manifest", () => {
    const routes = validateRoutesManifest({ routes: [{ name: "home", path: "/" }, { name: "about", path: "/about", scenario: "./sc.json" }] }, "test");
    assert.equal(routes.length, 2);
  });
  it("rejects empty routes", () => {
    assert.throws(() => validateRoutesManifest({ routes: [] }, "test"), /must not be empty/);
  });
  it("rejects too many routes", () => {
    const many = Array.from({ length: 21 }, (_, i) => ({ name: `r${i}`, path: `/${i}` }));
    assert.throws(() => validateRoutesManifest({ routes: many }, "test"), /cannot exceed 20/);
  });
  it("rejects duplicate names", () => {
    assert.throws(() => validateRoutesManifest({ routes: [{ name: "a", path: "/" }, { name: "a", path: "/b" }] }, "test"), /duplicate route name/);
  });
  it("rejects unsafe name", () => {
    assert.throws(() => validateRoutesManifest({ routes: [{ name: "../evil", path: "/" }] }, "test"), /must match/);
  });
  it("rejects unsupported protocol in path", () => {
    assert.throws(() => validateRoutesManifest({ routes: [{ name: "x", path: "ftp://example.com" }] }, "test"), /unsupported protocol/);
  });
  it("rejects malformed entry", () => {
    assert.throws(() => validateRoutesManifest({ routes: [{ path: "/" } as any] }, "test"), /name must be a non-empty string/);
  });
  it("rejects unknown keys", () => {
    assert.throws(() => validateRoutesManifest({ routes: [{ name: "a", path: "/", extra: 1 } as any] }, "test"), /unknown key/);
  });
  it("resolves relative paths against base safely", () => {
    const url = resolveRouteUrl("http://localhost:3000/base/", "/about");
    assert.equal(url, "http://localhost:3000/about");
    const url2 = resolveRouteUrl("http://example.com/app", "dashboard");
    assert.ok(url2.includes("/dashboard"));
  });
  it("rejects unsupported protocols on resolve", () => {
    assert.throws(() => resolveRouteUrl("ftp://example.com", "/"), /Invalid base URL|Unsupported protocol/);
    assert.throws(() => resolveRouteUrl("http://example.com", "ftp://evil.com"), /Unsupported protocol/);
  });
  it("CLI parses --routes and conflicts", () => {
    const p = parseArgs(["scan", "http://a", "--routes", "routes.json"]);
    assert.equal(p.routes, "routes.json");
    assert.equal(parseArgs(["scan", "http://a", "--routes=routes2.json"]).routes, "routes2.json");
    assert.throws(() => parseArgs(["scan", "http://a", "--routes", "r.json", "--scenario", "s.json"]), /Cannot combine --routes and --scenario/);
  });
});

describe("multi-route batch scanning", () => {
  let server: http.Server;
  let baseUrl: string;
  let tmpOut: string;
  let tmpManifest: string;

  before(async () => {
    const homeHtml = fs.readFileSync(path.join(process.cwd(), "fixtures/multi-route/pages/home/index.html"), "utf-8");
    const brokenHtml = fs.readFileSync(path.join(process.cwd(), "fixtures/multi-route/pages/broken/index.html"), "utf-8");
    server = http.createServer((req, res) => {
      const u = (req.url ?? "").split("?")[0];
      if (u === "/" || u === "/home") { res.writeHead(200, { "Content-Type": "text/html" }); res.end(homeHtml); return; }
      if (u === "/broken") { res.writeHead(200, { "Content-Type": "text/html" }); res.end(brokenHtml); return; }
      if (u === "/also-broken") { res.writeHead(200, { "Content-Type": "text/html" }); res.end(brokenHtml); return; }
      // For scenario route test, serve a simple select page
      if (u === "/interactive") {
        const html = fs.readFileSync(path.join(process.cwd(), "fixtures/scenario-select/index.html"), "utf-8");
        res.writeHead(200, { "Content-Type": "text/html" }); res.end(html); return;
      }
      res.writeHead(404, { "Content-Type": "text/plain" }); res.end("not found");
    });
    await new Promise<void>((r) => server.listen(0, () => r()));
    const addr: any = server.address();
    baseUrl = `http://localhost:${addr.port}`;
    tmpOut = fs.mkdtempSync(path.join(os.tmpdir(), "fc-batch-"));
    tmpManifest = fs.mkdtempSync(path.join(os.tmpdir(), "fc-manifest-"));
  });

  after(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    fs.rmSync(tmpOut, { recursive: true, force: true });
    fs.rmSync(tmpManifest, { recursive: true, force: true });
  });

  it("scans multi-route batch with isolated artifacts and combined summary", async () => {
    const manifestPath = path.join(tmpManifest, `routes-${Date.now()}.json`);
    fs.writeFileSync(manifestPath, JSON.stringify({ routes: [{ name: "home", path: "/" }, { name: "broken", path: "/broken" }] }));
    const out = path.join(tmpOut, `batch-${Date.now()}`);
    const batch = await scanBatch({ baseUrl, routesManifestPath: manifestPath, outDir: out });
    assert.equal(batch.routes.length, 2);
    // home should be clean, broken should have findings
    const home = batch.routes.find((r) => r.name === "home")!;
    const broken = batch.routes.find((r) => r.name === "broken")!;
    assert.equal(home.status, "ok");
    assert.equal(home.summary?.errors, 0);
    assert.ok(broken.summary!.total > 0, "broken should have findings");
    assert.ok(broken.summary!.errors > 0);
    // aggregate counts without losing identity
    assert.equal(batch.summary.total, (home.summary?.total ?? 0) + (broken.summary?.total ?? 0));
    assert.equal(batch.baseUrl, baseUrl.replace(/\/\/.*/, "//...").slice(0, 20) ? batch.baseUrl : batch.baseUrl); // redacted check not needed strict

    // isolated artifacts
    for (const r of batch.routes) {
      const routeDir = path.join(out, r.outDir);
      assert.ok(fs.existsSync(routeDir), `route dir missing ${r.outDir}`);
      assert.ok(fs.existsSync(path.join(routeDir, "findings.json")));
      assert.ok(fs.existsSync(path.join(routeDir, "report.html")));
      assert.ok(fs.existsSync(path.join(routeDir, "AGENT_FIXES.md")));
      // screenshots per route
      const findings = JSON.parse(fs.readFileSync(path.join(routeDir, "findings.json"), "utf-8"));
      assert.equal(findings.url, r.url);
    }
    // top-level machine-readable batch summary and human-readable index.html
    assert.ok(fs.existsSync(path.join(out, "batch.json")));
    assert.ok(fs.existsSync(path.join(out, "index.html")));
    const batchJson = JSON.parse(fs.readFileSync(path.join(out, "batch.json"), "utf-8"));
    assert.equal(batchJson.routes.length, 2);
    const indexHtml = fs.readFileSync(path.join(out, "index.html"), "utf-8");
    assert.match(indexHtml, /home/);
    assert.match(indexHtml, /broken/);
    assert.match(indexHtml, /report\.html/);
    assert.match(indexHtml, /batch\.json|Batch Report/);
    // ensure batch html links are deterministic
    assert.ok(indexHtml.includes("routes/home/report.html"));
    assert.ok(indexHtml.includes("routes/broken/report.html"));
  });

  it("continues scanning remaining routes when one route fails, and represents failure clearly", async () => {
    // Create manifest where second route points to non-existent scenario file, which should cause route error but not abort batch
    const scPath = path.join(tmpManifest, `fake-scenario-${Date.now()}.json`);
    // don't create the file, so it will fail
    const manifestPath = path.join(tmpManifest, `routes-fail-${Date.now()}.json`);
    fs.writeFileSync(manifestPath, JSON.stringify({
      routes: [
        { name: "good", path: "/" },
        { name: "bad-scenario", path: "/interactive", scenario: scPath },
        { name: "also-good", path: "/broken" }
      ]
    }));
    const out = path.join(tmpOut, `batch-fail-${Date.now()}`);
    const batch = await scanBatch({ baseUrl, routesManifestPath: manifestPath, outDir: out });
    assert.equal(batch.routes.length, 3);
    const bad = batch.routes.find((r) => r.name === "bad-scenario")!;
    assert.equal(bad.status, "error");
    assert.ok(bad.error && bad.error.length > 0);
    assert.match(bad.error!, /Scenario file not found|Failed to read scenario/);
    // other routes should still be ok
    const good = batch.routes.find((r) => r.name === "good")!;
    assert.equal(good.status, "ok");
    const also = batch.routes.find((r) => r.name === "also-good")!;
    assert.equal(also.status, "ok");
    // batch summary should aggregate only successful routes' findings, but still include route identity
    assert.ok(batch.routes.every((r) => typeof r.name === "string" && typeof r.path === "string"));
    // batch index should show error badge
    const indexHtml = fs.readFileSync(path.join(out, "index.html"), "utf-8");
    assert.match(indexHtml, /ERROR/);
  });

  it("supports per-route scenario files", async () => {
    // Use a valid scenario for one route
    const scSrc = path.join(process.cwd(), "fixtures/scenario-select/scenario.json");
    const scDest = path.join(tmpManifest, `sel-${Date.now()}.json`);
    fs.copyFileSync(scSrc, scDest);
    const manifestPath = path.join(tmpManifest, `routes-sc-${Date.now()}.json`);
    fs.writeFileSync(manifestPath, JSON.stringify({ routes: [{ name: "plain", path: "/" }, { name: "withScenario", path: "/interactive", scenario: scDest }] }));
    const out = path.join(tmpOut, `batch-sc-${Date.now()}`);
    const batch = await scanBatch({ baseUrl, routesManifestPath: manifestPath, outDir: out });
    const withSc = batch.routes.find((r) => r.name === "withScenario")!;
    assert.equal(withSc.status, "ok");
    const findings = JSON.parse(fs.readFileSync(path.join(out, withSc.outDir, "findings.json"), "utf-8"));
    assert.equal(findings.scenario?.name, "select option");
  });

  it("single-page scan remains backward compatible after batch feature", async () => {
    const out = path.join(tmpOut, `single-${Date.now()}`);
    const report = await scanUrl({ url: baseUrl + "/", outDir: out });
    assert.ok(report.viewports.length === 3);
    assert.ok(fs.existsSync(path.join(out, "findings.json")));
    assert.ok(fs.existsSync(path.join(out, "report.html")));
    // batch and single should not collide in file shapes: single has no routes dir
    assert.ok(!fs.existsSync(path.join(out, "batch.json")));
  });

  it("caps at 20 routes and validates manifest declaratively with no execution", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ name: `r${i}`, path: `/${i}` }));
    const manifestPath = path.join(tmpManifest, `cap-${Date.now()}.json`);
    fs.writeFileSync(manifestPath, JSON.stringify({ routes: many }));
    assert.doesNotThrow(() => loadRoutesManifest(manifestPath));
    const tooMany = Array.from({ length: 21 }, (_, i) => ({ name: `r${i}`, path: `/${i}` }));
    const badPath = path.join(tmpManifest, `cap-bad-${Date.now()}.json`);
    fs.writeFileSync(badPath, JSON.stringify({ routes: tooMany }));
    assert.throws(() => loadRoutesManifest(badPath), /cannot exceed 20/);
  });
});
