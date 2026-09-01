import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { scanUrl } from "./scanner.js";

function fixtureHtml(): string {
  return `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{margin:0;font-family:sans-serif}
  .wide{width:600px;height:40px;background:#7c5cff;color:#fff;margin:10px}
  .off{position:absolute;left:1450px;top:200px;width:200px;height:40px;background:#fef08a}
  .a{position:absolute;top:120px;left:10px;width:80px;height:40px;background:#111;color:#fff}
  .b{position:absolute;top:122px;left:30px;width:80px;height:40px;background:#ff4d6a;color:#fff}
  .card{position:relative;width:300px;height:200px}
</style>
<div class="wide">wide banner overflow</div>
<div class="off">offscreen</div>
<div class="card"><div class="a">A</div><div class="b">B</div></div>
<img src="/img-broken.png" alt="broken" style="width:80px;height:30px">
<script>console.error("fixture console error"); fetch("/api/broken").then(r=>{ if(!r.ok) console.error("api 404") }); setTimeout(()=>{ throw new Error("fixture pageerror") }, 50)</script>
`;
}

async function withServer(html: string, fn: (url: string) => Promise<void>): Promise<void> {
  const server = http.createServer((req, res) => {
    const url = (req.url ?? "/").split("?")[0];
    if (url === "/" || url === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(html);
      return;
    }
    if (url === "/api/broken") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr: any = server.address();
  const url = `http://127.0.0.1:${addr.port}`;
  try {
    await fn(url);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("annotation IDs", () => {
  it("assigns sequential marker IDs per viewport and links to findings", async () => {
    await withServer(fixtureHtml(), async (url) => {
      const out = await fs.mkdtemp(path.join(os.tmpdir(), "fc-ann-"));
      const report = await scanUrl({ url, outDir: out });

      for (const vr of report.results) {
        const ids: number[] = [];
        for (const f of vr.findings) if (f.markerIds) ids.push(...f.markerIds);
        // IDs should be unique, sequential starting at 1 within viewport
        const uniq = new Set(ids);
        assert.equal(uniq.size, ids.length, `markerIds must be unique in ${vr.viewport.label}`);
        if (ids.length) {
          const sorted = [...ids].sort((a, b) => a - b);
          assert.deepEqual(sorted, Array.from({ length: ids.length }, (_, i) => i + 1));
          // annotations length must match total marker count in viewport
          assert.equal(vr.annotations?.length ?? 0, ids.length);
          // every markerId must correspond to an annotation
          for (const id of ids) assert.ok(vr.annotations?.some((a) => a.id === id));
        }
        // annotated screenshot exists when there are annotations
        if ((vr.annotations?.length ?? 0) > 0) {
          assert.ok(vr.annotatedScreenshot, "should have annotatedScreenshot");
          const p = path.join(out, vr.annotatedScreenshot!);
          const stat = await fs.stat(p);
          assert.ok(stat.size > 1000, "annotated png should be non-empty");
        }
        // clean screenshot always exists
        const clean = path.join(out, vr.screenshot);
        assert.ok((await fs.stat(clean)).size > 500);
      }

      // global markerIds are per-viewport (reset to 1 per viewport) — ensure that
      const mobile = report.results.find((r) => r.viewport.label === "mobile");
      assert.ok(mobile);
      const globalFlatIds: number[] = [];
      for (const f of report.findings) if (f.markerIds) globalFlatIds.push(...f.markerIds);
      // flat list concatenates viewports, so ids repeat per viewport — that's expected
      // just verify no finding claims a marker outside its viewport's annotations
      for (const f of report.findings) {
        if (!f.markerIds) continue;
        const vr = report.results.find((r) => r.viewport.label === f.viewport);
        assert.ok(vr);
        for (const id of f.markerIds) assert.ok(vr!.annotations?.some((a) => a.id === id));
      }

      await fs.rm(out, { recursive: true, force: true });
    });
  });

  it("does not fabricate markers for non-visual findings", async () => {
    await withServer(fixtureHtml(), async (url) => {
      const out = await fs.mkdtemp(path.join(os.tmpdir(), "fc-ann2-"));
      const report = await scanUrl({ url, outDir: out });
      // console-error and page-error should have no markerIds
      for (const f of report.findings) {
        if (f.type === "console-error" || f.type === "page-error") {
          // some page-error may be 404 for broken image — still non-visual
          // detection ensures these have no rect => no marker
          // we allow no markerIds or empty
          assert.ok(!f.markerIds || f.markerIds.length === 0, `non-visual ${f.type} should not have markers`);
        }
      }
      await fs.rm(out, { recursive: true, force: true });
    });
  });
});

describe("report filtering / AGENT_FIXES data generation", () => {
  it("generates findings.json + report + AGENT_FIXES with consistent data", async () => {
    await withServer(fixtureHtml(), async (url) => {
      const out = await fs.mkdtemp(path.join(os.tmpdir(), "fc-data-"));
      const report = await scanUrl({ url, outDir: out });

      // findings.json exists and matches report object
      const raw = await fs.readFile(path.join(out, "findings.json"), "utf-8");
      const parsed = JSON.parse(raw);
      assert.equal(parsed.url, report.url);
      assert.equal(parsed.summary.total, report.summary.total);
      assert.equal(parsed.results.length, 3);

      // report.html references screenshots and markers
      const html = await fs.readFile(path.join(out, "report.html"), "utf-8");
      assert.ok(html.includes("filter-viewport"));
      assert.ok(html.includes("data-viewport"));
      assert.ok(html.includes("AGENT_FIXES"));

      // AGENT_FIXES.md exists and contains required sections
      const fixes = await fs.readFile(path.join(out, "AGENT_FIXES.md"), "utf-8");
      assert.ok(fixes.includes("# AGENT_FIXES"));
      assert.ok(fixes.includes("Severity:"));
      assert.ok(fixes.includes("Viewport:"));
      assert.ok(fixes.includes("Selector:"));
      assert.ok(fixes.includes("What failed:"));
      assert.ok(fixes.includes("Screenshot:"));
      assert.ok(fixes.includes("Suggested investigation:"));
      // Should contain at least one marker reference
      assert.ok(fixes.includes("Markers") || fixes.includes("Marker map"));

      await fs.rm(out, { recursive: true, force: true });
    });
  });
});
