import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { scanUrl } from "./engine/scanner.js";
import { scanBatch } from "./engine/batch.js";

/**
 * Windows compatibility: paths with spaces (common on Windows due to "Abiola Obafemi"
 * style user folders), posix vs win32 separators, and temp-dir handling.
 * Uses os.tmpdir() which itself contains a space on this Windows host,
 * plus explicit space-containing segments to ensure quoting and path.join are correct.
 */

describe("windows compat — spaces in user paths", () => {
  let server: http.Server;
  let baseUrl: string;
  let tmpRoot: string;

  before(async () => {
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>t</title><style>body{margin:0}.wide{width:600px;background:red;height:20px}</style></head><body><div class="wide">wide</div></body></html>`;
    server = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(html);
    });
    await new Promise<void>((r) => server.listen(0, () => r()));
    const addr: any = server.address();
    baseUrl = `http://localhost:${addr.port}`;
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fc-wincompat-"));
  });

  after(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("scan handles outDir containing spaces", async () => {
    const out = path.join(tmpRoot, `my scan with spaces ${Date.now()}`, "sub dir");
    const report = await scanUrl({ url: baseUrl, outDir: out });
    assert.ok(fs.existsSync(path.join(out, "findings.json")));
    assert.ok(fs.existsSync(path.join(out, "report.html")));
    // screenshots use forward slashes in manifest but exist on disk via path.join
    assert.ok(fs.existsSync(path.join(out, "screenshots", "mobile-390x844.png")));
    // manifest must not contain backslashes (portable posix)
    const manifest = JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf-8"));
    for (const p of manifest.artifacts.screenshots) {
      assert.ok(!p.includes("\\"), `manifest screenshot should be posix, got ${p}`);
      assert.ok(!p.includes(".."));
    }
  });

  it("scan handles --config path with spaces", async () => {
    const cfgDir = path.join(tmpRoot, `config space ${Date.now()}`);
    fs.mkdirSync(cfgDir, { recursive: true });
    const cfgPath = path.join(cfgDir, "my config.json");
    fs.writeFileSync(cfgPath, JSON.stringify({ ignore: { types: ["broken-image"] } }));
    const out = path.join(tmpRoot, `out-cfg-space-${Date.now()}`);
    const report = await scanUrl({ url: baseUrl, outDir: out, configPath: cfgPath });
    // should load without error and record config path
    assert.ok(report.suppression?.configPath === cfgPath || report.suppression?.configPath?.endsWith("my config.json"));
  });

  it("scan handles --scenario path with spaces", async () => {
    const scDir = path.join(tmpRoot, `scenario space ${Date.now()}`);
    fs.mkdirSync(scDir, { recursive: true });
    const scPath = path.join(scDir, "my scenario.json");
    fs.writeFileSync(scPath, JSON.stringify({ name: "space-sc", steps: [{ action: "wait", ms: 50 }] }));
    const out = path.join(tmpRoot, `out-sc-space-${Date.now()}`);
    const report = await scanUrl({ url: baseUrl, outDir: out, scenarioPath: scPath });
    assert.equal(report.scenario?.name, "space-sc");
  });

  it("batch handles routes manifest path with spaces and spaces in outDir", async () => {
    const routesDir = path.join(tmpRoot, `routes space ${Date.now()}`);
    fs.mkdirSync(routesDir, { recursive: true });
    const routesPath = path.join(routesDir, "my routes.json");
    fs.writeFileSync(routesPath, JSON.stringify({ routes: [{ name: "home", path: "/" }, { name: "about", path: "/" }] }));
    const out = path.join(tmpRoot, `batch out with spaces ${Date.now()}`);
    const batch = await scanBatch({ baseUrl, routesManifestPath: routesPath, outDir: out });
    assert.equal(batch.routes.length, 2);
    // reportPath is stored posix-style, but file exists via path.join
    for (const r of batch.routes) {
      assert.ok(!r.outDir.includes("\\"), `route outDir should be posix, got ${r.outDir}`);
      assert.ok(r.reportPath?.startsWith("routes/"));
      assert.ok(fs.existsSync(path.join(out, r.reportPath!)), `report missing for ${r.name}`);
    }
    // manifest routes are posix
    const manifest = JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf-8"));
    for (const p of manifest.artifacts.routes ?? []) {
      assert.ok(!p.includes("\\"));
    }
  });

  it("file URL encoding for spaces (openInBrowser helper logic)", () => {
    // Reproduce the encoding used in src/cli.ts openInBrowser
    const winAbs = "C:\\Users\\Abiola Obafemi\\framecritic\\framecritic-out\\scan with spaces\\report.html";
    const posixAbs = winAbs.replace(/\\/g, "/");
    const url = `file:///${encodeURI(posixAbs)}`;
    assert.ok(url.includes("%20"), "URL should encode spaces");
    assert.equal(url, "file:///C:/Users/Abiola%20Obafemi/framecritic/framecritic-out/scan%20with%20spaces/report.html");
    // Unix path
    const unixAbs = "/tmp/my scan/report.html";
    const unixUrl = `file://${encodeURI(unixAbs)}`;
    assert.ok(unixUrl.includes("%20"));
  });

  it("os.tmpdir handling (temp dir itself contains space on this host)", () => {
    const t = os.tmpdir();
    // This Windows host user folder contains a space; ensure mkdtempSync preserves it
    const probe = fs.mkdtempSync(path.join(t, "fc-probe-"));
    try {
      assert.ok(fs.existsSync(probe));
      // probe path should be creatable and contain the tmpdir prefix
      assert.ok(probe.startsWith(t));
    } finally {
      fs.rmSync(probe, { recursive: true, force: true });
    }
  });

  it("path.posix vs path.join: batch posix paths remain portable on win32", () => {
    // Demonstrate that path.posix.join is intentional for web links, while path.join is for filesystem
    const sanitized = "my-route";
    const posixRel = path.posix.join("routes", sanitized);
    assert.equal(posixRel, "routes/my-route");
    const fsPath = path.join("/tmp/out", posixRel);
    // On win32, path.join will normalize to backslashes but still resolve correctly
    // Ensure the file-system path can be constructed from posix relative
    assert.ok(fsPath.includes("routes"));
    // The manifest stores posixRel, not the win32 fsPath
    const reportPath = path.posix.join(posixRel, "report.html");
    assert.equal(reportPath, "routes/my-route/report.html");
    assert.ok(!reportPath.includes("\\"));
  });
});
