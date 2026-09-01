import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { parseArgs } from "./cli-args.js";
import { scanUrl } from "./engine/scanner.js";

describe("trace option", () => {
  it("parses --trace flag", () => {
    assert.equal(parseArgs(["scan", "http://a", "--trace"]).trace, true);
    assert.equal(parseArgs(["scan", "http://a"]).trace, false);
  });
});

describe("trace integration", () => {
  it("creates trace files when enabled, none when disabled", async () => {
    const html = `<!doctype html><html><body><h1>hello</h1></body></html>`;
    const server = http.createServer((req, res) => { res.writeHead(200, { "Content-Type": "text/html" }); res.end(html); });
    await new Promise<void>(r => server.listen(0, () => r()));
    const addr: any = server.address();
    const url = `http://localhost:${addr.port}`;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fc-trace-"));
    try {
      // without trace
      const out1 = path.join(tmp, "no-trace");
      const rep1 = await scanUrl({ url, outDir: out1 });
      assert.equal(rep1.trace, null);
      assert.ok(!fs.existsSync(path.join(out1, "traces")));
      assert.ok(fs.existsSync(path.join(out1, "findings.json")));
      assert.ok(fs.existsSync(path.join(out1, "report.html")));

      // with trace
      const out2 = path.join(tmp, "with-trace");
      const rep2 = await scanUrl({ url, outDir: out2, trace: true });
      assert.ok(rep2.trace?.enabled);
      assert.equal(rep2.trace?.files.length, 3); // 3 viewports
      for (const rel of rep2.trace!.files) {
        const abs = path.join(out2, rel);
        assert.ok(fs.existsSync(abs), `trace file missing ${rel}`);
        const stat = fs.statSync(abs);
        assert.ok(stat.size > 100, `trace file too small ${stat.size}`);
      }
      // check report html mentions trace
      const htmlReport = fs.readFileSync(path.join(out2, "report.html"), "utf-8");
      assert.match(htmlReport, /Trace:/);
      // findings.json includes trace
      const j = JSON.parse(fs.readFileSync(path.join(out2, "findings.json"), "utf-8"));
      assert.ok(j.trace?.enabled);
      assert.equal(j.trace.files.length, 3);
    } finally {
      await new Promise<void>(r => server.close(() => r()));
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("trace does not break normal scans (disabled by default)", async () => {
    const html = `<!doctype html><html><body><div style="width:600px;background:red;height:20px"></div></body></html>`;
    const server = http.createServer((req, res) => { res.writeHead(200, { "Content-Type": "text/html" }); res.end(html); });
    await new Promise<void>(r => server.listen(0, () => r()));
    const addr: any = server.address();
    const url = `http://localhost:${addr.port}`;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fc-trace2-"));
    try {
      const out = path.join(tmp, "out");
      const rep = await scanUrl({ url, outDir: out });
      // should have findings even without trace
      assert.ok(rep.findings.length >= 1);
    } finally {
      await new Promise<void>(r => server.close(() => r()));
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
