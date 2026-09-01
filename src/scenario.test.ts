import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { validateScenario, loadScenario } from "./scenario.js";
import { scanUrl } from "./engine/scanner.js";
import { parseArgs } from "./cli-args.js";

describe("scenario validation", () => {
  it("accepts valid scenario", () => {
    const s = validateScenario({ name: "open nav", steps: [{ action: "click", selector: "#menu" }, { action: "wait", ms: 300 }] }, "test");
    assert.equal(s.name, "open nav");
    assert.equal(s.steps.length, 2);
  });
  it("rejects unknown action", () => {
    assert.throws(() => validateScenario({ steps: [{ action: "eval", selector: "#a" } as any] }, "test"), /must be one of/);
  });
  it("rejects missing selector for click", () => {
    assert.throws(() => validateScenario({ steps: [{ action: "click" } as any] }, "test"), /requires.*"selector"/);
  });
  it("rejects missing value for fill", () => {
    assert.throws(() => validateScenario({ steps: [{ action: "fill", selector: "#a" } as any] }, "test"), /requires "value"/);
  });
  it("rejects missing ms for wait", () => {
    assert.throws(() => validateScenario({ steps: [{ action: "wait" } as any] }, "test"), /requires "ms"/);
  });
  it("rejects extra keys (no eval)", () => {
    assert.throws(() => validateScenario({ steps: [{ action: "click", selector: "#a", script: "alert(1)" } as any] }, "test"), /unknown key/);
  });
  it("rejects empty steps", () => {
    assert.throws(() => validateScenario({ steps: [] }, "test"), /must not be empty/);
  });
  it("parses --scenario CLI arg", () => {
    const p = parseArgs(["scan", "http://a", "--scenario", "s.json"]);
    assert.equal(p.scenario, "s.json");
    assert.equal(parseArgs(["scan", "http://a", "--scenario=s2.json"]).scenario, "s2.json");
    assert.throws(() => parseArgs(["scan", "http://a", "--scenario"]), /requires a file path/);
  });
  it("throws on nonexistent scenario file", () => {
    assert.throws(() => loadScenario("nope-scenario.json"), /not found/);
  });
  it("throws on malformed JSON", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fc-sc-"));
    const p = path.join(tmp, "bad.json");
    fs.writeFileSync(p, "{ not json");
    assert.throws(() => loadScenario(p), /Invalid JSON/);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe("scenario execution integration", () => {
  let server: http.Server;
  let urlMenu: string;
  let urlModal: string;
  let tmpOut: string;
  let tmpSc: string;
  before(async () => {
    const menuHtml = fs.readFileSync(path.join(process.cwd(), "fixtures/scenario-menu/index.html"), "utf-8");
    const modalHtml = fs.readFileSync(path.join(process.cwd(), "fixtures/scenario-modal/index.html"), "utf-8");
    server = http.createServer((req, res) => {
      const u = (req.url ?? "").split("?")[0];
      if (u === "/menu") { res.writeHead(200, { "Content-Type": "text/html" }); res.end(menuHtml); return; }
      if (u === "/modal") { res.writeHead(200, { "Content-Type": "text/html" }); res.end(modalHtml); return; }
      res.writeHead(404); res.end("not found");
    });
    await new Promise<void>(r => server.listen(0, () => r()));
    const addr: any = server.address();
    urlMenu = `http://localhost:${addr.port}/menu`;
    urlModal = `http://localhost:${addr.port}/modal`;
    tmpOut = fs.mkdtempSync(path.join(os.tmpdir(), "fc-sc-out-"));
    tmpSc = fs.mkdtempSync(path.join(os.tmpdir(), "fc-sc-tmp-"));
  });
  after(async () => {
    await new Promise<void>(r => server.close(() => r()));
    fs.rmSync(tmpOut, { recursive: true, force: true });
    fs.rmSync(tmpSc, { recursive: true, force: true });
  });

  it("executes click scenario and reports scenario name in findings", async () => {
    const scPath = path.join(tmpSc, "menu.json");
    fs.writeFileSync(scPath, JSON.stringify({ name: "open navigation", steps: [{ action: "click", selector: "#menuBtn" }, { action: "wait", ms: 200 }] }));
    const out = path.join(tmpOut, `sc-${Date.now()}`);
    const report = await scanUrl({ url: urlMenu, outDir: out, scenarioPath: scPath });
    assert.ok(report.scenario?.name === "open navigation");
    assert.ok(report.findings.some(f => (f as any).scenario === "open navigation"));
    // screenshots should exist
    assert.ok(report.results[0].screenshot);
  });

  it("scenario failure becomes explicit error finding, not silent", async () => {
    const scPath = path.join(tmpSc, "badclick.json");
    fs.writeFileSync(scPath, JSON.stringify({ name: "bad", steps: [{ action: "click", selector: "#does-not-exist-xyz" }] }));
    const out = path.join(tmpOut, `bad-${Date.now()}`);
    const report = await scanUrl({ url: urlMenu, outDir: out, scenarioPath: scPath });
    const scenarioFailures = report.findings.filter(f => f.message.includes('Scenario "bad"'));
    assert.ok(scenarioFailures.length > 0, "should have scenario failure finding");
    assert.equal(scenarioFailures[0].severity, "error");
  });

  it("supports fill, hover, press, wait actions", async () => {
    const html = `<!doctype html><html><body><input id="in"/><button id="btn">hover</button><div id="out"></div><script>document.getElementById('btn').addEventListener('mouseenter',()=>document.getElementById('out').textContent='hovered'); document.addEventListener('keydown',e=>{if(e.key==='Enter') document.getElementById('out').textContent='pressed'});</script></body></html>`;
    const srv = http.createServer((req, res) => { res.writeHead(200, { "Content-Type": "text/html" }); res.end(html); });
    await new Promise<void>(r => srv.listen(0, () => r()));
    const addr: any = srv.address();
    const u = `http://localhost:${addr.port}`;
    const scPath = path.join(tmpSc, `all-${Date.now()}.json`);
    fs.writeFileSync(scPath, JSON.stringify({
      name: "all actions",
      steps: [
        { action: "fill", selector: "#in", value: "hello" },
        { action: "hover", selector: "#btn" },
        { action: "press", key: "Enter" },
        { action: "wait", ms: 100 }
      ]
    }));
    const out = path.join(tmpOut, `all-${Date.now()}`);
    const report = await scanUrl({ url: u, outDir: out, scenarioPath: scPath });
    assert.equal(report.scenario?.name, "all actions");
    // should not have scenario failure
    assert.ok(!report.findings.some(f => f.message.includes('Scenario "all actions" step')));
    await new Promise<void>(r => srv.close(() => r()));
  });

  it("executes scenario independently at each viewport", async () => {
    const scPath = path.join(tmpSc, `vp-${Date.now()}.json`);
    fs.writeFileSync(scPath, JSON.stringify({ name: "open modal", steps: [{ action: "click", selector: "#openModal" }, { action: "wait", ms: 200 }] }));
    const out = path.join(tmpOut, `vp-${Date.now()}`);
    const report = await scanUrl({ url: urlModal, outDir: out, scenarioPath: scPath });
    // each viewport should have been through scenario, findings should be present per viewport
    assert.equal(report.results.length, 3);
    // all findings should have scenario tag
    for (const f of report.findings) assert.equal((f as any).scenario, "open modal");
  });

  it("findings.json records scenario and steps", async () => {
    const scPath = path.join(tmpSc, `rec-${Date.now()}.json`);
    fs.writeFileSync(scPath, JSON.stringify({ name: "hover dropdown", steps: [{ action: "hover", selector: "#hoverBtn" }, { action: "wait", ms: 200 }] }));
    const hoverHtml = fs.readFileSync(path.join(process.cwd(), "fixtures/scenario-hover/index.html"), "utf-8");
    const srv2 = http.createServer((req, res) => { res.writeHead(200, { "Content-Type": "text/html" }); res.end(hoverHtml); });
    await new Promise<void>(r => srv2.listen(0, () => r()));
    const addr2: any = srv2.address();
    const out = path.join(tmpOut, `rec-${Date.now()}`);
    const report = await scanUrl({ url: `http://localhost:${addr2.port}`, outDir: out, scenarioPath: scPath });
    const json = JSON.parse(fs.readFileSync(path.join(out, "findings.json"), "utf-8"));
    assert.equal(json.scenario.name, "hover dropdown");
    assert.equal(json.scenario.steps.length, 2);
    await new Promise<void>(r => srv2.close(() => r()));
  });
});
