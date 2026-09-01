import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "./cli-args.js";

describe("CLI argument parsing", () => {
  it("parses scan <url> with defaults", () => {
    const p = parseArgs(["scan", "http://localhost:3001"]);
    assert.equal(p.command, "scan");
    assert.equal(p.url, "http://localhost:3001");
    assert.equal(p.open, false);
    assert.equal(p.output, undefined);
    assert.equal(p.viewports, undefined);
  });

  it("parses shorthand url without scan keyword", () => {
    const p = parseArgs(["http://example.com"]);
    assert.equal(p.url, "http://example.com");
    assert.equal(p.command, "scan");
  });

  it("parses --output long and short forms", () => {
    assert.equal(parseArgs(["scan", "http://a", "--output", "out/dir"]).output, "out/dir");
    assert.equal(parseArgs(["scan", "http://a", "--output=out2"]).output, "out2");
    assert.equal(parseArgs(["scan", "http://a", "-o", "out3"]).output, "out3");
  });

  it("parses --open", () => {
    assert.equal(parseArgs(["scan", "http://a", "--open"]).open, true);
    assert.equal(parseArgs(["scan", "http://a"]).open, false);
  });

  it("parses --viewport built-ins", () => {
    const p = parseArgs(["scan", "http://a", "--viewport", "mobile"]);
    assert.equal(p.viewports?.length, 1);
    assert.equal(p.viewports?.[0].label, "mobile");
    assert.equal(p.viewports?.[0].width, 390);
    const p2 = parseArgs(["scan", "http://a", "--viewport", "mobile,desktop"]);
    assert.equal(p2.viewports?.length, 2);
    assert.deepEqual(p2.viewports?.map((v) => v.label), ["mobile", "desktop"]);
  });

  it("parses --viewport custom WxH and dedupes", () => {
    const p = parseArgs(["scan", "http://a", "--viewport", "390x844,390x844,768x1024"]);
    assert.equal(p.viewports?.length, 2);
    assert.equal(p.viewports?.[0].label, "390x844");
    assert.equal(p.viewports?.[0].width, 390);
  });

  it("parses --viewport with equals", () => {
    const p = parseArgs(["scan", "http://a", "--viewport=tablet"]);
    assert.equal(p.viewports?.[0].label, "tablet");
  });

  it("supports legacy second positional as output dir", () => {
    const p = parseArgs(["scan", "http://a", "custom-out"]);
    assert.equal(p.output, "custom-out");
  });

  it("handles --help and --version", () => {
    assert.equal(parseArgs(["--help"]).command, "help");
    assert.equal(parseArgs(["-h"]).command, "help");
    assert.equal(parseArgs(["--version"]).command, "version");
    assert.equal(parseArgs(["-v"]).command, "version");
    // --help anywhere
    assert.equal(parseArgs(["scan", "http://a", "--help"]).command, "help");
  });

  it("throws on unknown option", () => {
    assert.throws(() => parseArgs(["scan", "http://a", "--unknown"]), /Unknown option/);
  });

  it("throws on unknown viewport", () => {
    assert.throws(() => parseArgs(["scan", "http://a", "--viewport", "unknown"]), /Unknown viewport/);
  });

  it("throws on missing --output value", () => {
    assert.throws(() => parseArgs(["scan", "http://a", "--output"]), /requires a directory/);
  });
});
