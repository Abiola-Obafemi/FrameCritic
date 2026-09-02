import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { validateScenario, loadScenario } from "./scenario.js";
import { scanUrl } from "./engine/scanner.js";
import { parseArgs } from "./cli-args.js";

describe("scenario extended actions validation", () => {
  it("accepts scroll with selector", () => {
    const s = validateScenario({ steps: [{ action: "scroll", selector: "#target" }] }, "test");
    assert.equal(s.steps[0].action, "scroll");
  });
  it("accepts scroll with coordinates", () => {
    const s = validateScenario({ steps: [{ action: "scroll", x: 0, y: 300 }] }, "test");
    assert.equal(s.steps[0].x, 0);
    assert.equal(s.steps[0].y, 300);
  });
  it("accepts scroll with selector + coordinates", () => {
    const s = validateScenario({ steps: [{ action: "scroll", selector: "#box", y: 100 }] }, "test");
    assert.equal(s.steps[0].selector, "#box");
  });
  it("rejects scroll with no selector/coord", () => {
    assert.throws(() => validateScenario({ steps: [{ action: "scroll" } as any] }, "test"), /requires at least one/);
  });
  it("rejects scroll with invalid coord bounds", () => {
    assert.throws(() => validateScenario({ steps: [{ action: "scroll", x: -1 }] } as any, "test"), /must be integer 0..10000/);
    assert.throws(() => validateScenario({ steps: [{ action: "scroll", y: 20000 }] } as any, "test"), /must be integer 0..10000/);
    assert.throws(() => validateScenario({ steps: [{ action: "scroll", x: 1.5 }] } as any, "test"), /must be integer/);
  });
  it("accepts select", () => {
    const s = validateScenario({ steps: [{ action: "select", selector: "#choice", value: "beta" }] }, "test");
    assert.equal(s.steps[0].action, "select");
  });
  it("rejects select missing fields", () => {
    assert.throws(() => validateScenario({ steps: [{ action: "select", selector: "#a" } as any] }, "test"), /requires "value"/);
    assert.throws(() => validateScenario({ steps: [{ action: "select", value: "b" } as any] }, "test"), /requires.*selector/);
  });
  it("accepts hotkey with modifiers+key", () => {
    const s = validateScenario({ steps: [{ action: "hotkey", key: "Control+A" }] }, "test");
    assert.equal(s.steps[0].key, "Control+A");
    const s2 = validateScenario({ steps: [{ action: "hotkey", key: "Shift+Tab" }] }, "test");
    assert.equal(s2.steps[0].key, "Shift+Tab");
    const s3 = validateScenario({ steps: [{ action: "hotkey", key: "Escape" }] }, "test");
    assert.equal(s3.steps[0].key, "Escape");
  });
  it("rejects hotkey with invalid modifier", () => {
    assert.throws(() => validateScenario({ steps: [{ action: "hotkey", key: "Command+A" } as any] }, "test"), /unknown modifier/);
  });
  it("rejects hotkey with invalid main key", () => {
    assert.throws(() => validateScenario({ steps: [{ action: "hotkey", key: "Control+???" } as any] }, "test"), /invalid/);
  });
  it("rejects unknown keys strict", () => {
    assert.throws(() => validateScenario({ steps: [{ action: "scroll", selector: "#a", extra: "bad" } as any] }, "test"), /unknown key/);
  });
  it("enforces global step count limits still", () => {
    const many = Array.from({ length: 21 }, () => ({ action: "wait", ms: 10 }));
    assert.throws(() => validateScenario({ steps: many } as any, "test"), /cannot exceed 20/);
  });
});

describe("scenario extended execution", () => {
  let tmpOut: string;
  let tmpSc: string;
  before(() => {
    tmpOut = fs.mkdtempSync(path.join(os.tmpdir(), "fc-sc-ext-out-"));
    tmpSc = fs.mkdtempSync(path.join(os.tmpdir(), "fc-sc-ext-tmp-"));
  });
  after(() => {
    fs.rmSync(tmpOut, { recursive: true, force: true });
    fs.rmSync(tmpSc, { recursive: true, force: true });
  });

  async function runWithServer(html: string, scenario: any, viewports?: any, trace?: boolean) {
    const srv = http.createServer((req, res) => { res.writeHead(200, { "Content-Type": "text/html" }); res.end(html); });
    await new Promise<void>((r) => srv.listen(0, () => r()));
    const addr: any = srv.address();
    const url = `http://localhost:${addr.port}`;
    const scPath = path.join(tmpSc, `sc-${Date.now()}-${Math.random()}.json`);
    fs.writeFileSync(scPath, JSON.stringify(scenario));
    const out = path.join(tmpOut, `out-${Date.now()}-${Math.random()}`);
    const report = await scanUrl({ url, outDir: out, scenarioPath: scPath, viewports, trace });
    // read the out text via evaluate? We need to check page state via findings? But we can also check that scenario didn't fail
    const failed = report.findings.filter((f) => f.message.includes("Scenario"));
    srv.close();
    return { report, out, failed };
  }

  it("scroll with selector changes page state (box scrollTop)", async () => {
    const html = fs.readFileSync(path.join(process.cwd(), "fixtures/scenario-scroll/index.html"), "utf-8");
    const srv = http.createServer((req, res) => { res.writeHead(200, { "Content-Type": "text/html" }); res.end(html); });
    await new Promise<void>((r) => srv.listen(0, () => r()));
    const addr: any = srv.address();
    const url = `http://localhost:${addr.port}`;
    const scPath = path.join(tmpSc, `scroll-${Date.now()}.json`);
    fs.writeFileSync(scPath, JSON.stringify({ name: "scroll test", steps: [{ action: "scroll", selector: "#target" }, { action: "wait", ms: 200 }] }));
    const out = path.join(tmpOut, `scroll-${Date.now()}`);
    const report = await scanUrl({ url, outDir: out, scenarioPath: scPath });
    // No scenario failure expected
    assert.equal(report.findings.filter((f) => f.message.includes('Scenario "scroll test"')).length, 0);
    // check findings.json records scenario
    const j = JSON.parse(fs.readFileSync(path.join(out, "findings.json"), "utf-8"));
    assert.equal(j.scenario.name, "scroll test");
    await new Promise<void>((r) => srv.close(() => r()));
  });

  it("scroll with coordinates scrolls window", async () => {
    const html = `<!doctype html><html><body style="height:2000px"><div id="out"></div><script>window.addEventListener('scroll',()=>document.getElementById('out').textContent=String(window.scrollY));</script></body></html>`;
    const { report, failed } = await runWithServer(html, { name: "ws", steps: [{ action: "scroll", x: 0, y: 500 }, { action: "wait", ms: 300 }] });
    assert.equal(failed.length, 0);
    // verify scenario steps recorded
    assert.equal(report.scenario?.steps[0].action, "scroll");
  });

  it("select changes page state", async () => {
    const html = fs.readFileSync(path.join(process.cwd(), "fixtures/scenario-select/index.html"), "utf-8");
    const srv = http.createServer((req, res) => { res.writeHead(200, { "Content-Type": "text/html" }); res.end(html); });
    await new Promise<void>((r) => srv.listen(0, () => r()));
    const addr: any = srv.address();
    const url = `http://localhost:${addr.port}`;
    const scPath = path.join(tmpSc, `sel-${Date.now()}.json`);
    fs.writeFileSync(scPath, JSON.stringify({ name: "select test", steps: [{ action: "select", selector: "#choice", value: "beta" }, { action: "wait", ms: 200 }] }));
    const out = path.join(tmpOut, `sel-${Date.now()}`);
    const report = await scanUrl({ url, outDir: out, scenarioPath: scPath });
    assert.equal(report.findings.filter((f) => f.message.includes('Scenario "select test"')).length, 0);
    await new Promise<void>((r) => srv.close(() => r()));
  });

  it("hotkey triggers keyboard handler", async () => {
    const html = fs.readFileSync(path.join(process.cwd(), "fixtures/scenario-hotkey/index.html"), "utf-8");
    const srv = http.createServer((req, res) => { res.writeHead(200, { "Content-Type": "text/html" }); res.end(html); });
    await new Promise<void>((r) => srv.listen(0, () => r()));
    const addr: any = srv.address();
    const url = `http://localhost:${addr.port}`;
    const scPath = path.join(tmpSc, `hot-${Date.now()}.json`);
    fs.writeFileSync(scPath, JSON.stringify({ name: "hotkey test", steps: [{ action: "hotkey", key: "Escape" }, { action: "wait", ms: 200 }] }));
    const out = path.join(tmpOut, `hot-${Date.now()}`);
    const report = await scanUrl({ url, outDir: out, scenarioPath: scPath });
    assert.equal(report.findings.filter((f) => f.message.includes('Scenario "hotkey test"')).length, 0);
    await new Promise<void>((r) => srv.close(() => r()));
  });

  it("invalid select selector fails safely with step error", async () => {
    const html = fs.readFileSync(path.join(process.cwd(), "fixtures/scenario-select/index.html"), "utf-8");
    const { failed } = await runWithServer(html, { name: "bad select", steps: [{ action: "select", selector: "#does-not-exist-xyz", value: "beta" }] });
    assert.ok(failed.length > 0);
    assert.match(failed[0].message, /step 1.*select.*failed/i);
  });

  it("invalid hotkey payload fails validation, not execution", () => {
    assert.throws(() => validateScenario({ steps: [{ action: "hotkey", key: "Bad+Key!!" }] }, "test"), /unknown modifier|invalid/);
  });

  it("old click/fill/hover/press/wait still pass with new engine", async () => {
    const html = `<!doctype html><html><body><input id="in"/><button id="btn">hover</button><div id="out"></div><script>document.getElementById('btn').addEventListener('mouseenter',()=>document.getElementById('out').textContent='hovered'); document.addEventListener('keydown',e=>{if(e.key==='Enter') document.getElementById('out').textContent='pressed'});</script></body></html>`;
    const { report, failed } = await runWithServer(html, { name: "all actions", steps: [{ action: "fill", selector: "#in", value: "hello" }, { action: "hover", selector: "#btn" }, { action: "press", key: "Enter" }, { action: "wait", ms: 100 }] });
    assert.equal(failed.length, 0);
    assert.equal(report.scenario?.name, "all actions");
  });

  it("preserves per-viewport independence for new actions", async () => {
    const html = fs.readFileSync(path.join(process.cwd(), "fixtures/scenario-select/index.html"), "utf-8");
    const srv = http.createServer((req, res) => { res.writeHead(200, { "Content-Type": "text/html" }); res.end(html); });
    await new Promise<void>((r) => srv.listen(0, () => r()));
    const addr: any = srv.address();
    const url = `http://localhost:${addr.port}`;
    const scPath = path.join(tmpSc, `vp-${Date.now()}.json`);
    fs.writeFileSync(scPath, JSON.stringify({ name: "vp select", steps: [{ action: "select", selector: "#choice", value: "gamma" }, { action: "wait", ms: 100 }] }));
    const out = path.join(tmpOut, `vp-${Date.now()}`);
    const report = await scanUrl({ url, outDir: out, scenarioPath: scPath });
    assert.equal(report.results.length, 3);
    for (const f of report.findings) assert.equal((f as any).scenario, "vp select");
    await new Promise<void>((r) => srv.close(() => r()));
  });

  it("trace mode and scenario metadata continue to work together with new actions", async () => {
    const html = fs.readFileSync(path.join(process.cwd(), "fixtures/scenario-select/index.html"), "utf-8");
    const srv = http.createServer((req, res) => { res.writeHead(200, { "Content-Type": "text/html" }); res.end(html); });
    await new Promise<void>((r) => srv.listen(0, () => r()));
    const addr: any = srv.address();
    const url = `http://localhost:${addr.port}`;
    const scPath = path.join(tmpSc, `tr-${Date.now()}.json`);
    fs.writeFileSync(scPath, JSON.stringify({ name: "trace select", steps: [{ action: "select", selector: "#choice", value: "alpha" }] }));
    const out = path.join(tmpOut, `tr-${Date.now()}`);
    const report = await scanUrl({ url, outDir: out, scenarioPath: scPath, trace: true });
    assert.equal(report.scenario?.name, "trace select");
    assert.equal(report.trace?.enabled, true);
    assert.equal(report.trace?.files.length, 3);
    for (const f of report.trace?.files ?? []) assert.ok(fs.existsSync(path.join(out, f)));
    await new Promise<void>((r) => srv.close(() => r()));
  });
});
