import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { parseSweep } from "./cli-args.js";
import { scanUrl } from "./engine/scanner.js";
import { scanBatch } from "./engine/batch.js";

/**
 * Dogfood: end-to-end covering a11y, sweep, extended scenario (select), and trace together,
 * plus a separate multi-route batch. Inspects actual JSON/HTML/markdown output, not just exit codes.
 */

describe("dogfood end-to-end", () => {
  let server: http.Server;
  let baseUrl: string;
  let tmpOut: string;
  let tmpManifest: string;

  before(async () => {
    // Create a comprehensive page that triggers multiple detectors and supports scenario + a11y
    const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Dogfood Page</title>
<style>
*{box-sizing:border-box}body{margin:0;font-family:system-ui;padding:0}
header{background:#111;color:#fff;padding:16px}
.wide{width:600px;background:#ff4d6a;color:#fff;padding:16px;margin:20px;border-radius:8px}
@media(min-width:700px){ .wide{width:auto;background:#2ecc71} }
select{margin:20px;padding:8px}
#out{margin:20px;padding:12px;background:#eef;border-radius:8px}
</style>
</head>
<body>
<header>Dogfood Demo</header>
<div class="wide">600px banner — overflow when narrow</div>
<img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='80'%3E%3Crect width='200' height='80' fill='%23ff4d6a'/%3E%3C/svg%3E">
<!-- missing alt -->
<label for="choice">Pick</label>
<select id="choice"><option value="">--select--</option><option value="alpha">Alpha</option><option value="beta">Beta</option></select>
<div id="out">not selected</div>
<script>document.getElementById('choice').addEventListener('change', e=>{ document.getElementById('out').textContent='selected:'+e.target.value; });</script>
</body>
</html>`;
    server = http.createServer((req, res) => {
      const u = (req.url ?? "").split("?")[0];
      if (u === "/" || u === "/home") { res.writeHead(200, { "Content-Type": "text/html" }); res.end(html); return; }
      if (u === "/broken") {
        const broken = `<html><body><div style="width:800px;background:#ff4d6a;padding:16px">wide</div><img src="/nope.png"><script>console.error('broken')</script></body></html>`;
        res.writeHead(200, { "Content-Type": "text/html" }); res.end(broken); return;
      }
      res.writeHead(200, { "Content-Type": "text/html" }); res.end(html);
    });
    await new Promise<void>((r) => server.listen(0, () => r()));
    const addr: any = server.address();
    baseUrl = `http://localhost:${addr.port}`;
    tmpOut = fs.mkdtempSync(path.join(os.tmpdir(), "fc-dogfood-"));
    tmpManifest = fs.mkdtempSync(path.join(os.tmpdir(), "fc-dogfood-manifest-"));
  });

  after(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    fs.rmSync(tmpOut, { recursive: true, force: true });
    fs.rmSync(tmpManifest, { recursive: true, force: true });
  });

  it("dogfood single: a11y + sweep + scenario (select/scroll/hotkey) + trace produces comprehensive evidence", async () => {
    const scenario = {
      name: "dogfood scenario",
      steps: [
        { action: "select", selector: "#choice", value: "beta" },
        { action: "wait", ms: 200 },
        { action: "scroll", x: 0, y: 150 },
        { action: "hotkey", key: "Escape" },
      ],
    };
    const tmpSc = path.join(tmpManifest, `sc-${Date.now()}.json`);
    fs.writeFileSync(tmpSc, JSON.stringify(scenario));
    const sweep = parseSweep("400:700:150"); // 400,550,700 -> 3 widths, height 900
    const out = path.join(tmpOut, `dogfood-single-${Date.now()}`);
    const report = await scanUrl({
      url: baseUrl,
      outDir: out,
      viewports: sweep as any,
      scenarioPath: tmpSc,
      trace: true,
      a11y: true,
    });

    // Inspect actual JSON
    const findingsJson = JSON.parse(fs.readFileSync(path.join(out, "findings.json"), "utf-8"));
    assert.equal(findingsJson.artifactVersion, "0.2");
    assert.equal(findingsJson.a11y?.enabled, true);
    assert.equal(findingsJson.trace?.enabled, true);
    assert.equal(findingsJson.scenario?.name, "dogfood scenario");
    assert.equal(findingsJson.viewports.length, 3);
    assert.ok(findingsJson.viewports.every((v: any) => v.label.startsWith("sweep-")));
    assert.ok(findingsJson.results.length === 3);
    // a11y findings present
    assert.ok(findingsJson.findings.some((f: any) => f.type === "accessibility"), "should have a11y findings");
    // image-alt should be among them
    assert.ok(findingsJson.findings.some((f: any) => f.details?.rule === "image-alt"));
    // sweep-specific findings: overflow only on narrow widths
    const byWidth: any = {};
    for (const r of findingsJson.results) byWidth[r.viewport.width] = r.findings;
    // narrow widths should have overflow
    assert.ok(byWidth["400"]?.some((f: any) => f.type === "horizontal-overflow"), "400 should have overflow");
    assert.ok(byWidth["700"]?.every((f: any) => f.type !== "horizontal-overflow") || byWidth["700"].length === 0 || !byWidth["700"].some((f: any) => f.type === "horizontal-overflow"), "700 should be clean-ish for overflow");
    // scenario should not have failed
    assert.ok(!findingsJson.findings.some((f: any) => f.message.includes("Scenario \"dogfood scenario\" step")));

    // Inspect actual HTML
    const reportHtml = fs.readFileSync(path.join(out, "report.html"), "utf-8");
    assert.match(reportHtml, /Automated accessibility/);
    assert.match(reportHtml, /sweep-400/);
    assert.match(reportHtml, /NOT WCAG/);
    // Accessibility of report: check for skip link, tablist, aria, keyboard handlers
    assert.match(reportHtml, /Skip to main content/);
    assert.match(reportHtml, /role="tablist"/);
    assert.match(reportHtml, /role="tab"/);
    assert.match(reportHtml, /aria-selected/);
    assert.match(reportHtml, /filter-viewport/);

    // Inspect AGENT_FIXES markdown
    const md = fs.readFileSync(path.join(out, "AGENT_FIXES.md"), "utf-8");
    assert.match(md, /dogfood scenario/);
    assert.match(md, /accessibility/i);
    assert.match(md, /Markers/);

    // Inspect manifest and trace files
    const manifest = JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf-8"));
    assert.equal(manifest.artifactVersion, "0.2");
    assert.equal(manifest.kind, "single");
    assert.ok(manifest.artifacts.screenshots.length >= 3);
    assert.ok(manifest.artifacts.traces?.length === 3);
    for (const t of manifest.artifacts.traces) assert.ok(fs.existsSync(path.join(out, t)), `trace missing ${t}`);

    // Verify screenshots exist
    for (const r of report.results) {
      assert.ok(fs.existsSync(path.join(out, r.screenshot)));
      if (r.annotatedScreenshot) assert.ok(fs.existsSync(path.join(out, r.annotatedScreenshot)));
    }
  });

  it("dogfood batch: multi-route with clean + broken + scenario route", async () => {
    const scPath = path.join(tmpManifest, `batch-sc-${Date.now()}.json`);
    fs.writeFileSync(scPath, JSON.stringify({ name: "batch select", steps: [{ action: "select", selector: "#choice", value: "alpha" }] }));
    const manifestPath = path.join(tmpManifest, `batch-manifest-${Date.now()}.json`);
    fs.writeFileSync(manifestPath, JSON.stringify({
      routes: [
        { name: "clean", path: "/" },
        { name: "broken", path: "/broken" },
        { name: "withScenario", path: "/", scenario: scPath }
      ]
    }));
    const out = path.join(tmpOut, `dogfood-batch-${Date.now()}`);
    const batch = await scanBatch({ baseUrl, routesManifestPath: manifestPath, outDir: out, a11y: true });

    // Inspect batch.json
    const batchJson = JSON.parse(fs.readFileSync(path.join(out, "batch.json"), "utf-8"));
    assert.equal(batchJson.artifactVersion, "0.2");
    assert.equal(batchJson.routes.length, 3);
    const clean = batchJson.routes.find((r: any) => r.name === "clean");
    const broken = batchJson.routes.find((r: any) => r.name === "broken");
    assert.ok(clean && clean.status === "ok", "clean should be ok");
    assert.ok(broken && broken.summary.total > (clean?.summary.total ?? 0), "broken should have more findings than clean");
    const withSc = batchJson.routes.find((r: any) => r.name === "withScenario");
    assert.equal(withSc.status, "ok");
    // check per-route findings
    const cleanReport = JSON.parse(fs.readFileSync(path.join(out, withSc.outDir, "findings.json"), "utf-8"));
    assert.equal(cleanReport.scenario?.name, "batch select");

    // Inspect index.html
    const indexHtml = fs.readFileSync(path.join(out, "index.html"), "utf-8");
    assert.match(indexHtml, /Batch Report/);
    assert.match(indexHtml, /clean/);
    assert.match(indexHtml, /broken/);
    assert.match(indexHtml, /withScenario/);
    assert.match(indexHtml, /report\.html/);

    // Inspect manifest
    const manifest = JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf-8"));
    assert.equal(manifest.artifactVersion, "0.2");
    assert.equal(manifest.kind, "batch");
    assert.ok(manifest.artifacts.routes.length === 3);

    // Ensure isolated artifacts
    for (const r of batch.routes) {
      const dir = path.join(out, r.outDir);
      assert.ok(fs.existsSync(path.join(dir, "findings.json")));
      assert.ok(fs.existsSync(path.join(dir, "report.html")));
    }
  });
});
