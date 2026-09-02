import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { parseArgs, parseSweep, SWEEP_HEIGHT, SWEEP_MAX_WIDTHS } from "./cli-args.js";
import { scanUrl } from "./engine/scanner.js";

describe("sweep parsing and validation", () => {
  it("parses valid sweep 320:800:160", () => {
    const vps = parseSweep("320:800:160");
    assert.equal(vps.length, 4);
    assert.deepEqual(vps.map((v) => v.width), [320, 480, 640, 800]);
    for (const vp of vps) {
      assert.equal(vp.height, SWEEP_HEIGHT);
      assert.ok(vp.label.startsWith("sweep-"));
    }
  });

  it("handles inclusive max edge", () => {
    const vps = parseSweep("500:700:100");
    assert.deepEqual(vps.map((v) => v.width), [500, 600, 700]);
  });

  it("single width when min==max", () => {
    const vps = parseSweep("600:600:50");
    assert.equal(vps.length, 1);
    assert.equal(vps[0].width, 600);
  });

  it("rejects min > max", () => {
    assert.throws(() => parseSweep("800:320:100"), /min must be <= max/);
  });

  it("rejects non-integers", () => {
    assert.throws(() => parseSweep("320.5:800:100"), /positive integers/);
    assert.throws(() => parseSweep("a:b:c"), /positive integers/);
  });

  it("rejects malformed format", () => {
    assert.throws(() => parseSweep("320:800"), /requires format/);
    assert.throws(() => parseSweep("320"), /requires format/);
    assert.throws(() => parseSweep("320:800:100:50"), /requires format/);
  });

  it("enforces bounded dimensions 200-4000", () => {
    assert.throws(() => parseSweep("100:800:100"), /between 200 and 4000/);
    assert.throws(() => parseSweep("320:5000:100"), /between 200 and 4000/);
    assert.throws(() => parseSweep("320:800:0"), /step must be between/);
  });

  it("enforces hard cap at 12 widths", () => {
    // 200:1400:100 => 13 widths -> should fail
    assert.throws(() => parseSweep("200:1400:100"), /hard cap is 12/);
    // 320:1200:80 => 12? (320,400,...,1200) = 12 exactly? Let's compute: (1200-320)/80=11 => 12 widths -> allowed
    const ok = parseSweep("320:1200:80");
    assert.equal(ok.length, 12);
    // 320:1200:70 => more than 12 -> fail
    assert.throws(() => parseSweep("320:1200:70"), /hard cap/);
    assert.equal(SWEEP_MAX_WIDTHS, 12);
  });

  it("CLI --sweep parsing via parseArgs", () => {
    const p = parseArgs(["scan", "http://a", "--sweep", "320:800:160"]);
    assert.equal(p.sweep, "320:800:160");
    assert.equal(p.viewports?.length, 4);
    assert.deepEqual(p.viewports?.map((v) => v.width), [320, 480, 640, 800]);
    const p2 = parseArgs(["scan", "http://a", "--sweep=500:700:100"]);
    assert.equal(p2.viewports?.length, 3);
  });

  it("rejects combining --sweep and --viewport", () => {
    assert.throws(() => parseArgs(["scan", "http://a", "--viewport", "mobile", "--sweep", "320:800:100"]), /Cannot combine/);
    assert.throws(() => parseArgs(["scan", "http://a", "--sweep", "320:800:100", "--viewport=mobile"]), /Cannot combine/);
  });

  it("labels are deterministic", () => {
    const a = parseSweep("400:600:100");
    const b = parseSweep("400:600:100");
    assert.deepEqual(a, b);
    assert.equal(a[0].label, "sweep-400");
  });
});

describe("sweep integration - breakpoint detection", () => {
  let server: http.Server;
  let url: string;
  let tmpOut: string;
  before(async () => {
    const html = fs.readFileSync(path.join(process.cwd(), "fixtures/sweep-breakpoint/index.html"), "utf-8");
    server = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(html);
    });
    await new Promise<void>((r) => server.listen(0, () => r()));
    const addr: any = server.address();
    url = `http://localhost:${addr.port}`;
    tmpOut = fs.mkdtempSync(path.join(os.tmpdir(), "fc-sweep-"));
  });
  after(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    fs.rmSync(tmpOut, { recursive: true, force: true });
  });

  it("sweep catches breakpoint-specific overflow across generated widths", async () => {
    const out = path.join(tmpOut, `sweep-${Date.now()}`);
    const vps = parseSweep("400:900:100"); // 400,500,600,700,800,900 => 6 widths
    const report = await scanUrl({ url, outDir: out, viewports: vps as any });
    assert.equal(report.viewports.length, 6);
    assert.equal(report.results.length, 6);
    // widths <700 should have horizontal-overflow, widths >=700 should not (banner becomes responsive)
    const byWidth = new Map(report.results.map((r) => [r.viewport.width, r.findings]));
    // At 400,500,600 overflow expected
    for (const w of [400, 500, 600]) {
      const findings = byWidth.get(w) ?? [];
      assert.ok(findings.some((f) => f.type === "horizontal-overflow"), `expected overflow at ${w}, got ${findings.map((f) => f.type).join(",")}`);
    }
    // At 700,800,900 should be clean (no overflow)
    for (const w of [700, 800, 900]) {
      const findings = byWidth.get(w) ?? [];
      const hasOverflow = findings.some((f) => f.type === "horizontal-overflow");
      assert.equal(hasOverflow, false, `should not have overflow at ${w}`);
    }
    // verify artifacts across multiple widths
    const json = JSON.parse(fs.readFileSync(path.join(out, "findings.json"), "utf-8"));
    assert.equal(json.viewports.length, 6);
    assert.ok(json.results.every((r: any) => typeof r.screenshot === "string"));
    const html = fs.readFileSync(path.join(out, "report.html"), "utf-8");
    // report should list each sweep viewport and be navigable
    for (const w of [400, 500, 700]) {
      assert.ok(html.includes(`sweep-${w}`) || html.includes(`${w}×${SWEEP_HEIGHT}`), `report missing sweep-${w}`);
    }
    // fingerprint stability: findings viewport label should match sweep-*
    assert.ok(report.findings.some((f) => f.viewport.startsWith("sweep-")));
  });

  it("existing preset/custom viewport behavior remains compatible after sweep feature", async () => {
    // preset scan should still work
    const out = path.join(tmpOut, `preset-${Date.now()}`);
    const report = await scanUrl({ url, outDir: out });
    assert.equal(report.viewports.length, 3);
    assert.ok(report.viewports.some((v) => v.label === "mobile"));

    // custom viewport should still work
    const out2 = path.join(tmpOut, `custom-${Date.now()}`);
    const report2 = await scanUrl({ url, outDir: out2, viewports: [{ label: "500x800", width: 500, height: 800 }] as any });
    assert.equal(report2.viewports[0].width, 500);
    assert.equal(report2.viewports[0].label, "500x800");
  });

  it("sweep via CLI-generated viewports produces isolated screenshots per width", async () => {
    const vps = parseSweep("320:560:120"); // 320,440,560
    const out = path.join(tmpOut, `iso-${Date.now()}`);
    const report = await scanUrl({ url, outDir: out, viewports: vps as any });
    for (const r of report.results) {
      const p = path.join(out, r.screenshot);
      assert.ok(fs.existsSync(p), `screenshot missing ${r.screenshot}`);
      if (r.annotatedScreenshot) assert.ok(fs.existsSync(path.join(out, r.annotatedScreenshot)));
    }
  });

  it("bounded sweep remains deterministic and fingerprint compatible", async () => {
    const vps1 = parseSweep("300:600:100");
    const vps2 = parseSweep("300:600:100");
    assert.deepEqual(vps1, vps2);
    // ensure sweep findings have viewport field matching label
    const out = path.join(tmpOut, `det-${Date.now()}`);
    const report = await scanUrl({ url, outDir: out, viewports: vps1 as any });
    for (const f of report.findings) assert.ok(f.viewport.startsWith("sweep-"));
  });
});
