import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { redactUrl, safeOutputPath } from "./security.js";
import { scanUrl } from "./engine/scanner.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";

describe("url redaction", () => {
  it("redacts user:pass", () => {
    assert.equal(redactUrl("http://user:pass@example.com/"), "http://***:***@example.com/");
  });
  it("redacts token query", () => {
    const r = redactUrl("https://example.com/?token=abc123&foo=bar");
    assert.match(r, /\*\*\*/);
    assert.ok(!r.includes("abc123"));
  });
  it("leaves normal url intact", () => {
    assert.equal(redactUrl("https://example.com/path"), "https://example.com/path");
  });
});

describe("safe output path", () => {
  it("rejects traversal", () => {
    assert.throws(() => safeOutputPath("/base", "../evil"), /Unsafe/);
    assert.throws(() => safeOutputPath("/base", "/etc/passwd"), /Unsafe/);
  });
  it("allows normal relative", () => {
    assert.equal(safeOutputPath("/base", "screenshots/a.png"), "screenshots/a.png");
  });
});

describe("invalid URL handling", () => {
  it("throws useful error for invalid URL", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fc-sec-"));
    await assert.rejects(() => scanUrl({ url: "ht!tp://bad", outDir: path.join(tmp, "out") }), /Invalid URL/);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  it("does not leak credentials in findings.json", async () => {
    const html = `<!doctype html><html><body>hi</body></html>`;
    const server = http.createServer((req,res)=>{res.writeHead(200,{"Content-Type":"text/html"}); res.end(html);});
    await new Promise<void>(r=>server.listen(0,()=>r()));
    const addr:any = server.address();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fc-sec2-"));
    const credUrl = `http://user:secret@localhost:${addr.port}/?token=supersecret`;
    const out = path.join(tmp,"out");
    const report = await scanUrl({ url: credUrl, outDir: out });
    const raw = fs.readFileSync(path.join(out,"findings.json"),"utf-8");
    assert.ok(!raw.includes("secret"));
    assert.ok(!raw.includes("supersecret"));
    assert.match(raw, /\*\*\*/);
    await new Promise<void>(r=>server.close(()=>r()));
    fs.rmSync(tmp,{recursive:true,force:true});
  });
});
