import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { validateRoutesManifest, loadRoutesManifest, resolveRouteUrl } from "./routes.js";
import { validateScenario, loadScenario } from "./scenario.js";
import { validateConfig, loadConfig } from "./config.js";
import { compareReports } from "./compare.js";
import { redactSecrets } from "./security.js";

describe("security bounds - url resolution", () => {
  it("blocks protocol-relative // routes", () => {
    assert.throws(() => resolveRouteUrl("http://localhost:3000/base/", "//evil.com/steal"), /protocol-relative/);
    assert.throws(() => validateRoutesManifest({ routes: [{ name: "a", path: "//evil.com/x" }] }, "test"), /protocol-relative/);
    // deterministic message
    const a = (() => { try { resolveRouteUrl("http://localhost:3000/", "//evil.com"); } catch (e:any){ return e.message; } return ""; })();
    const b = (() => { try { resolveRouteUrl("http://localhost:3000/", "//evil.com"); } catch (e:any){ return e.message; } return ""; })();
    assert.equal(a, b);
  });
  it("returns raw URL for navigation (caller redacts), not pre-redacted", () => {
    const raw = resolveRouteUrl("http://user:pass@localhost:3000/", "/a?token=secret");
    // raw should still contain credentials and token — caller will redact for artifacts
    assert.ok(raw.includes("user:pass"));
    assert.ok(raw.includes("token=secret"));
  });
  it("blocks backslash and supports only http/https", () => {
    assert.throws(() => validateRoutesManifest({ routes: [{ name: "a", path: "/a\\b" }] }, "test"), /invalid characters/);
    assert.throws(() => validateRoutesManifest({ routes: [{ name: "a", path: "ftp://evil.com" }] }, "test"), /unsupported protocol/);
  });
});

describe("security bounds - selector and value limits", () => {
  it("caps selector length at 500 for all actions", () => {
    const long = "a".repeat(501);
    assert.throws(() => validateScenario({ steps: [{ action: "click", selector: long }] }, "test"), /must be <=500/);
    assert.throws(() => validateScenario({ steps: [{ action: "fill", selector: long, value: "x" }] }, "test"), /must be <=500/);
    assert.throws(() => validateScenario({ steps: [{ action: "hover", selector: long }] }, "test"), /must be <=500/);
    assert.throws(() => validateScenario({ steps: [{ action: "press", selector: long, key: "Enter" }] }, "test"), /must be <=500/);
    // exactly 500 allowed
    const ok = validateScenario({ steps: [{ action: "click", selector: "a".repeat(500) }] }, "test");
    assert.equal(ok.steps.length, 1);
  });
  it("caps fill value at 1000 chars", () => {
    assert.throws(() => validateScenario({ steps: [{ action: "fill", selector: "#a", value: "x".repeat(1001) }] }, "test"), /must be <=1000/);
    const ok = validateScenario({ steps: [{ action: "fill", selector: "#a", value: "x".repeat(1000) }] }, "test");
    assert.equal(ok.steps[0].value?.length, 1000);
  });
  it("preserves declarative/no-eval - unknown keys rejected", () => {
    assert.throws(() => validateScenario({ steps: [{ action: "click", selector: "#a", script: "alert(1)" } as any] }, "test"), /unknown key/);
    assert.throws(() => validateRoutesManifest({ routes: [{ name: "a", path: "/", evil: 1 } as any] }, "test"), /unknown key/);
  });
});

describe("security bounds - filesystem traversal", () => {
  it("rejects scenario .. traversal in routes manifest", () => {
    assert.throws(() => validateRoutesManifest({ routes: [{ name: "a", path: "/", scenario: "../../evil.json" }] }, "test"), /\.\./);
    assert.throws(() => validateRoutesManifest({ routes: [{ name: "a", path: "/", scenario: "a/../b.json" }] }, "test"), /\.\./);
    // single dot allowed? but .. not
    const ok = validateRoutesManifest({ routes: [{ name: "a", path: "/", scenario: "./scenarios/a.json" }] }, "test");
    assert.equal(ok[0].scenario, "./scenarios/a.json");
  });
  it("rejects path traversal via unsafe name", () => {
    assert.throws(() => validateRoutesManifest({ routes: [{ name: "../evil", path: "/" }] }, "test"), /must match/);
    assert.throws(() => validateRoutesManifest({ routes: [{ name: "a/b", path: "/" }] }, "test"), /must match/);
  });
});

describe("security bounds - huge JSON payload handling", () => {
  it("rejects routes manifest exceeding 256KB", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fc-bounds-"));
    const p = path.join(tmp, "routes.json");
    fs.writeFileSync(p, "x".repeat(300 * 1024));
    assert.throws(() => loadRoutesManifest(p), /exceeds.*file too large/);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  it("rejects scenario file exceeding 256KB", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fc-bounds-"));
    const p = path.join(tmp, "sc.json");
    fs.writeFileSync(p, "x".repeat(300 * 1024));
    assert.throws(() => loadScenario(p), /exceeds.*file too large/);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  it("rejects config exceeding 256KB", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fc-bounds-"));
    const p = path.join(tmp, "cfg.json");
    fs.writeFileSync(p, "x".repeat(300 * 1024));
    assert.throws(() => loadConfig({ explicitPath: p }), /exceeds.*file too large/);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  it("rejects compare findings file exceeding 5MB", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fc-bounds-"));
    const a = path.join(tmp, "a.json");
    const b = path.join(tmp, "b.json");
    fs.writeFileSync(a, JSON.stringify({ findings: [] }));
    fs.writeFileSync(b, "x".repeat(6 * 1024 * 1024));
    assert.throws(() => compareReports(a, b), /exceeds.*file too large/);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe("security bounds - config limits", () => {
  it("caps ignore selectors count and length deterministically", () => {
    const many = Array.from({ length: 101 }, () => "#a");
    assert.throws(() => validateConfig({ ignore: { selectors: many } }, "test"), /cannot exceed 100/);
    assert.throws(() => validateConfig({ ignore: { selectors: ["a".repeat(501)] } }, "test"), /must be <=500/);
    // error messages deterministic
    const a = (() => { try { validateConfig({ ignore: { selectors: many } }, "test"); } catch (e:any){ return e.message; } return ""; })();
    const b = (() => { try { validateConfig({ ignore: { selectors: many } }, "test"); } catch (e:any){ return e.message; } return ""; })();
    assert.equal(a, b);
  });
});

describe("security bounds - secret redaction", () => {
  it("redacts token query and user:pass in arbitrary text", () => {
    const t = redactSecrets("Visit https://example.com/?token=supersecret&foo=bar and http://user:pass@example.com/");
    assert.ok(!t.includes("supersecret"));
    assert.ok(t.includes("***"));
    assert.ok(!t.includes("user:pass"));
  });
  it("redacts consistently - deterministic", () => {
    const inp = "https://example.com/?token=abc123";
    const a = redactSecrets(inp);
    const b = redactSecrets(inp);
    assert.equal(a, b);
  });
});

describe("security bounds - determinism", () => {
  it("resolveRouteUrl is deterministic for same inputs", () => {
    const a = resolveRouteUrl("http://localhost:3000/base/", "/about");
    const b = resolveRouteUrl("http://localhost:3000/base/", "/about");
    assert.equal(a, b);
  });
  it("selector ordering for config is stable - error messages deterministic", () => {
    const err1 = (() => { try { validateRoutesManifest({ routes: [{ name: "a", path: "/" }, { name: "a", path: "/b" }] }, "test"); } catch(e:any){return e.message;} return "";})();
    const err2 = (() => { try { validateRoutesManifest({ routes: [{ name: "a", path: "/" }, { name: "a", path: "/b" }] }, "test"); } catch(e:any){return e.message;} return "";})();
    assert.equal(err1, err2);
  });
});
