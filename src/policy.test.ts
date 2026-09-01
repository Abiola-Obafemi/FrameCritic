import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluatePolicy } from "./policy.js";
import { parseArgs } from "./cli-args.js";

describe("policy evaluatePolicy", () => {
  it("fail-on error fails on errors", () => {
    const p = evaluatePolicy({ errors: 1, warnings: 0, total: 1, infos: 0 }, { failOn: "error" });
    assert.equal(p.failed, true);
    assert.equal(p.exitCode, 2);
  });
  it("fail-on error passes without errors even with warnings", () => {
    const p = evaluatePolicy({ errors: 0, warnings: 5, total: 5, infos: 0 }, { failOn: "error" });
    assert.equal(p.failed, false);
    assert.equal(p.exitCode, 0);
  });
  it("fail-on warning fails on warnings", () => {
    const p = evaluatePolicy({ errors: 0, warnings: 1, total: 1, infos: 0 }, { failOn: "warning" });
    assert.equal(p.failed, true);
  });
  it("fail-on warning passes with no issues", () => {
    const p = evaluatePolicy({ errors: 0, warnings: 0, total: 0, infos: 0 }, { failOn: "warning" });
    assert.equal(p.failed, false);
  });
  it("fail-on never never fails", () => {
    const p = evaluatePolicy({ errors: 10, warnings: 10, total: 20, infos: 0 }, { failOn: "never" });
    assert.equal(p.failed, false);
    assert.equal(p.exitCode, 0);
  });
  it("max-warnings allows within limit", () => {
    const p = evaluatePolicy({ errors: 0, warnings: 3, total: 3, infos: 0 }, { failOn: "error", maxWarnings: 5 });
    assert.equal(p.failed, false);
  });
  it("max-warnings fails when exceeded", () => {
    const p = evaluatePolicy({ errors: 0, warnings: 6, total: 6, infos: 0 }, { failOn: "error", maxWarnings: 5 });
    assert.equal(p.failed, true);
    assert.match(p.reason, /exceeds/);
  });
  it("max-warnings with fail-on warning allows within limit", () => {
    const p = evaluatePolicy({ errors: 0, warnings: 2, total: 2, infos: 0 }, { failOn: "warning", maxWarnings: 5 });
    assert.equal(p.failed, false);
  });
  it("max-warnings with fail-on warning fails when exceeded", () => {
    const p = evaluatePolicy({ errors: 0, warnings: 6, total: 6, infos: 0 }, { failOn: "warning", maxWarnings: 5 });
    assert.equal(p.failed, true);
  });
  it("errors still fail even if warnings within maxWarnings", () => {
    const p = evaluatePolicy({ errors: 1, warnings: 2, total: 3, infos: 0 }, { failOn: "error", maxWarnings: 5 });
    assert.equal(p.failed, true);
    assert.match(p.reason, /error/);
  });
});

describe("CLI parsing for policy", () => {
  it("parses --fail-on", () => {
    assert.equal(parseArgs(["scan", "http://a", "--fail-on", "warning"]).failOn, "warning");
    assert.equal(parseArgs(["scan", "http://a", "--fail-on=never"]).failOn, "never");
    assert.equal(parseArgs(["scan", "http://a", "--fail-on", "error"]).failOn, "error");
  });
  it("throws on invalid --fail-on", () => {
    assert.throws(() => parseArgs(["scan", "http://a", "--fail-on", "bad"]), /must be one of/);
  });
  it("parses --max-warnings", () => {
    assert.equal(parseArgs(["scan", "http://a", "--max-warnings", "5"]).maxWarnings, 5);
    assert.equal(parseArgs(["scan", "http://a", "--max-warnings=0"]).maxWarnings, 0);
  });
  it("throws on invalid --max-warnings", () => {
    assert.throws(() => parseArgs(["scan", "http://a", "--max-warnings", "-1"]), /requires a number|non-negative integer/);
    assert.throws(() => parseArgs(["scan", "http://a", "--max-warnings", "abc"]), /non-negative integer/);
    assert.throws(() => parseArgs(["scan", "http://a", "--max-warnings"]), /requires a number/);
  });
  it("parses --json-summary", () => {
    assert.equal(parseArgs(["scan", "http://a", "--json-summary"]).jsonSummary, true);
    assert.equal(parseArgs(["scan", "http://a"]).jsonSummary, false);
  });
});
