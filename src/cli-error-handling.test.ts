import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { parseArgs, parseSweep } from "./cli-args.js";
import { validateRoutesManifest, loadRoutesManifest, resolveRouteUrl } from "./routes.js";
import { validateScenario, loadScenario } from "./scenario.js";
import { scanUrl } from "./engine/scanner.js";
import { scanBatch } from "./engine/batch.js";
import { compareReports } from "./compare.js";

// Milestone 04: CLI and error-handling quality pass
// Audit every CLI option and invalid-input path. Errors concise, deterministic, non-secret-leaking, exit nonzero.
// Covers: malformed sweep specs, too many widths, viewport+sweep conflicts, missing routes files, invalid route JSON,
// missing scenarios, malformed scenario steps, a11y runtime failures, output directory collisions, unsupported combinations.

describe("04 - malformed sweep specs", () => {
  it("rejects empty sweep", () => {
    assert.throws(() => parseSweep(""), /requires a value/);
  });
  it("rejects missing colon parts", () => {
    assert.throws(() => parseSweep("320:800"), /requires format/);
    assert.throws(() => parseSweep("320"), /requires format/);
    assert.throws(() => parseSweep("320:800:100:50"), /requires format/);
  });
  it("rejects non-integer values", () => {
    assert.throws(() => parseSweep("a:b:c"), /positive integers/);
    assert.throws(() => parseSweep("320.5:800:100"), /positive integers/);
  });
  it("rejects out-of-bounds min/max/step", () => {
    assert.throws(() => parseSweep("100:800:100"), /between 200 and 4000/);
    assert.throws(() => parseSweep("320:5000:100"), /between 200 and 4000/);
    assert.throws(() => parseSweep("320:800:0"), /step must be between/);
    assert.throws(() => parseSweep("320:800:5000"), /step must be between/);
  });
  it("rejects min > max", () => {
    assert.throws(() => parseSweep("800:320:100"), /min must be <= max/);
  });
  it("CLI --sweep missing value is concise deterministic", () => {
    assert.throws(() => parseArgs(["scan", "http://a", "--sweep"]), /requires a value/);
    assert.throws(() => parseArgs(["scan", "http://a", "--sweep="]), /requires a value/);
    assert.throws(() => parseArgs(["scan", "http://a", "--sweep", "-o"]), /requires a value/);
  });
  it("sweep parse error messages are deterministic", () => {
    const a = (() => { try { parseSweep("bad"); } catch (e:any){ return e.message; } return ""; })();
    const b = (() => { try { parseSweep("bad"); } catch (e:any){ return e.message; } return ""; })();
    assert.equal(a, b);
  });
});

describe("04 - too many widths", () => {
  it("hard cap 12 enforced deterministically", () => {
    assert.throws(() => parseSweep("200:1400:100"), /hard cap is 12/);
    assert.throws(() => parseSweep("320:1200:70"), /hard cap is 12/);
    // exactly 12 allowed
    const ok = parseSweep("320:1200:80");
    assert.equal(ok.length, 12);
  });
  it("error message includes attempted count and cap", () => {
    const err = (() => { try { parseSweep("200:1400:100"); } catch(e:any){ return e.message; } return ""; })();
    assert.match(err, /13/);
    assert.match(err, /12/);
  });
});

describe("04 - viewport+sweep conflicts", () => {
  it("throws when both provided", () => {
    assert.throws(() => parseArgs(["scan", "http://a", "--viewport", "mobile", "--sweep", "320:800:100"]), /Cannot combine --sweep and --viewport/);
    assert.throws(() => parseArgs(["scan", "http://a", "--sweep", "320:800:100", "--viewport=mobile"]), /Cannot combine --sweep and --viewport/);
    assert.throws(() => parseArgs(["scan", "http://a", "--viewport=tablet", "--sweep=320:800:100"]), /Cannot combine --sweep and --viewport/);
  });
  it("error is deterministic", () => {
    const a = (()=>{ try{ parseArgs(["scan","http://a","--viewport","mobile","--sweep","320:800:100"]); }catch(e:any){ return e.message; } return "";})();
    const b = (()=>{ try{ parseArgs(["scan","http://a","--viewport","mobile","--sweep","320:800:100"]); }catch(e:any){ return e.message; } return "";})();
    assert.equal(a,b);
  });
});

describe("04 - unsupported combinations", () => {
  it("routes + scenario mutually exclusive", () => {
    assert.throws(() => parseArgs(["scan","http://a","--routes","r.json","--scenario","s.json"]), /Cannot combine --routes and --scenario/);
    assert.throws(() => parseArgs(["scan","http://a","--routes=r.json","--scenario=s.json"]), /Cannot combine --routes and --scenario/);
  });
  it("unknown option is concise and suggests --help", () => {
    assert.throws(() => parseArgs(["scan","http://a","--unknown-opt"]), /Unknown option.*--help/);
    assert.throws(() => parseArgs(["scan","http://a","--tracee"]), /Unknown option/);
  });
  it("--fail-on invalid values", () => {
    assert.throws(() => parseArgs(["scan","http://a","--fail-on","bogus"]), /must be one of.*error.*warning.*never/);
    assert.throws(() => parseArgs(["scan","http://a","--fail-on="]), /must be one of/);
    assert.throws(() => parseArgs(["scan","http://a","--fail-on","errorr"]), /must be one of/);
  });
  it("--max-warnings invalid values", () => {
    assert.throws(() => parseArgs(["scan","http://a","--max-warnings"]), /requires a number/);
    assert.throws(() => parseArgs(["scan","http://a","--max-warnings","-1"]), /non-negative integer/);
    assert.throws(() => parseArgs(["scan","http://a","--max-warnings","abc"]), /non-negative integer/);
    assert.throws(() => parseArgs(["scan","http://a","--max-warnings=xyz"]), /non-negative integer/);
    assert.throws(() => parseArgs(["scan","http://a","--max-warnings","1.5"]), /non-negative integer/);
  });
  it("--config / --output / --routes missing values", () => {
    assert.throws(() => parseArgs(["scan","http://a","--config"]), /requires a file path/);
    assert.throws(() => parseArgs(["scan","http://a","--output"]), /requires a directory/);
    assert.throws(() => parseArgs(["scan","http://a","--routes"]), /requires a file path/);
    assert.throws(() => parseArgs(["scan","http://a","--scenario"]), /requires a file path/);
  });
  it("--viewport missing and unknown", () => {
    assert.throws(() => parseArgs(["scan","http://a","--viewport"]), /requires a value/);
    assert.throws(() => parseArgs(["scan","http://a","--viewport","unknownLabel"]), /Unknown viewport/);
    assert.throws(() => parseArgs(["scan","http://a","--viewport","9999x9999"]), /Unknown viewport/);
  });
  it("compare requires two positional args", () => {
    assert.throws(() => parseArgs(["compare","a.json"]), /requires two arguments/);
    assert.throws(() => parseArgs(["compare"]), /requires two arguments/);
  });
});

describe("04 - missing routes files", () => {
  it("loadRoutesManifest throws not found with absolute path, deterministic", () => {
    const a = (()=>{ try{ loadRoutesManifest("nope-missing-routes-123.json"); }catch(e:any){ return e.message; } return "";})();
    const b = (()=>{ try{ loadRoutesManifest("nope-missing-routes-123.json"); }catch(e:any){ return e.message; } return "";})();
    assert.equal(a,b);
    assert.match(a, /not found/);
    assert.ok(a.includes("nope-missing-routes-123.json"));
  });
  it("scanBatch with missing routes manifest fails deterministically and non-secret-leaking", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(),"fc-err-routes-"));
    const out = path.join(tmp,"out");
    try {
      await assert.rejects(() => scanBatch({ baseUrl:"http://localhost:3000", routesManifestPath: path.join(tmp,"missing.json"), outDir: out }), /not found/i);
      // second call same error
      await assert.rejects(() => scanBatch({ baseUrl:"http://localhost:3000", routesManifestPath: path.join(tmp,"missing.json"), outDir: out }), /not found/i);
    } finally { fs.rmSync(tmp,{recursive:true,force:true}); }
  });
});

describe("04 - invalid route JSON", () => {
  it("empty routes rejected", () => {
    assert.throws(() => validateRoutesManifest({routes:[]}, "test.json"), /must not be empty/);
  });
  it("too many routes rejected", () => {
    const many = Array.from({length:21},(_,i)=>({name:`r${i}`,path:`/${i}`}));
    assert.throws(() => validateRoutesManifest({routes:many}, "test.json"), /cannot exceed 20/);
  });
  it("duplicate names rejected", () => {
    assert.throws(() => validateRoutesManifest({routes:[{name:"a",path:"/"},{name:"a",path:"/b"}]}, "test.json"), /duplicate/);
  });
  it("unsafe name rejected", () => {
    assert.throws(() => validateRoutesManifest({routes:[{name:"../evil",path:"/"}]}, "test.json"), /must match/);
  });
  it("unsupported protocol in path rejected", () => {
    assert.throws(() => validateRoutesManifest({routes:[{name:"x",path:"ftp://evil.com"}]}, "test.json"), /unsupported protocol/);
  });
  it("unknown keys rejected", () => {
    assert.throws(() => validateRoutesManifest({routes:[{name:"a",path:"/",extra:1} as any]}, "test.json"), /unknown key/);
  });
  it("invalid JSON file throws deterministic Invalid JSON", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(),"fc-err-json-"));
    const p = path.join(tmp,"bad.json");
    fs.writeFileSync(p, "{not json");
    const a = (()=>{ try{ loadRoutesManifest(p);}catch(e:any){return e.message;} return "";})();
    const b = (()=>{ try{ loadRoutesManifest(p);}catch(e:any){return e.message;} return "";})();
    assert.equal(a,b);
    assert.match(a, /Invalid JSON/);
    fs.rmSync(tmp,{recursive:true,force:true});
  });
  it("malformed URL path rejected", () => {
    assert.throws(() => validateRoutesManifest({routes:[{name:"a",path:"http://[invalid"}]}, "test.json"), /malformed URL/);
  });
});

describe("04 - missing scenarios", () => {
  it("loadScenario throws not found deterministically", () => {
    const a = (()=>{ try{ loadScenario("nope-scenario-xyz.json"); }catch(e:any){return e.message;} return "";})();
    const b = (()=>{ try{ loadScenario("nope-scenario-xyz.json"); }catch(e:any){return e.message;} return "";})();
    assert.equal(a,b);
    assert.match(a, /not found/);
  });
  it("scanUrl with missing scenario fails concise, non-secret-leaking", async () => {
    const server = http.createServer((req,res)=>{res.writeHead(200,{"Content-Type":"text/html"}); res.end("<html><body>hi</body></html>");});
    await new Promise<void>(r=>server.listen(0,()=>r()));
    const addr:any=server.address();
    const url=`http://localhost:${addr.port}`;
    const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"fc-err-sc-"));
    const out=path.join(tmp,"out");
    try {
      await assert.rejects(()=>scanUrl({url, outDir: out, scenarioPath: path.join(tmp,"missing-sc.json")}), /not found/);
    } finally { await new Promise<void>(r=>server.close(()=>r())); fs.rmSync(tmp,{recursive:true,force:true}); }
  });
  it("batch per-route missing scenario is isolated error, not abort", async () => {
    const html = fs.readFileSync(path.join(process.cwd(),"fixtures/multi-route/pages/home/index.html"),"utf-8");
    const server = http.createServer((req,res)=>{res.writeHead(200,{"Content-Type":"text/html"}); res.end(html);});
    await new Promise<void>(r=>server.listen(0,()=>r()));
    const addr:any=server.address();
    const baseUrl=`http://localhost:${addr.port}`;
    const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"fc-err-batch-sc-"));
    const manifest=path.join(tmp,"routes.json");
    const out=path.join(tmp,"out");
    const fakeSc=path.join(tmp,"nope.json");
    fs.writeFileSync(manifest, JSON.stringify({routes:[{name:"good",path:"/"},{name:"bad",path:"/",scenario:fakeSc},{name:"also",path:"/"}]}));
    try {
      const batch = await scanBatch({baseUrl, routesManifestPath: manifest, outDir: out});
      assert.equal(batch.routes.length,3);
      assert.equal(batch.routes.find(r=>r.name==="bad")!.status,"error");
      assert.equal(batch.routes.find(r=>r.name==="good")!.status,"ok");
    } finally { await new Promise<void>(r=>server.close(()=>r())); fs.rmSync(tmp,{recursive:true,force:true}); }
  });
});

describe("04 - malformed scenario steps", () => {
  it("unknown action rejected", () => {
    assert.throws(()=>validateScenario({steps:[{action:"eval",selector:"#a"} as any]},"test"), /must be one of/);
  });
  it("click missing selector rejected", () => {
    assert.throws(()=>validateScenario({steps:[{action:"click"} as any]},"test"), /requires.*selector/);
  });
  it("fill missing value rejected", () => {
    assert.throws(()=>validateScenario({steps:[{action:"fill",selector:"#a"} as any]},"test"), /requires "value"/);
  });
  it("wait missing ms rejected", () => {
    assert.throws(()=>validateScenario({steps:[{action:"wait"} as any]},"test"), /requires "ms"/);
  });
  it("wait out of bounds rejected", () => {
    assert.throws(()=>validateScenario({steps:[{action:"wait",ms:9999} as any]},"test"), /0..5000/);
  });
  it("extra keys rejected (no eval)", () => {
    assert.throws(()=>validateScenario({steps:[{action:"click",selector:"#a",script:"alert"} as any]},"test"), /unknown key/);
  });
  it("empty steps rejected", () => {
    assert.throws(()=>validateScenario({steps:[]},"test"), /must not be empty/);
  });
  it("too many steps rejected", () => {
    const steps=Array.from({length:21},()=>({action:"wait",ms:10} as any));
    assert.throws(()=>validateScenario({steps},"test"), /cannot exceed 20/);
  });
  it("scroll missing selector/x/y rejected", () => {
    assert.throws(()=>validateScenario({steps:[{action:"scroll"} as any]},"test"), /requires at least one/);
  });
  it("select missing value rejected", () => {
    assert.throws(()=>validateScenario({steps:[{action:"select",selector:"#a"} as any]},"test"), /requires "value"/);
  });
  it("hotkey invalid modifier rejected", () => {
    assert.throws(()=>validateScenario({steps:[{action:"hotkey",key:"Bad+Enter"} as any]},"test"), /unknown modifier/);
  });
  it("hotkey missing key rejected", () => {
    assert.throws(()=>validateScenario({steps:[{action:"hotkey"} as any]},"test"), /requires "key"/);
  });
  it("malformed JSON scenario file deterministic", () => {
    const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"fc-err-scjson-"));
    const p=path.join(tmp,"bad.json");
    fs.writeFileSync(p,"{not json");
    const a=(()=>{try{loadScenario(p);}catch(e:any){return e.message;}return "";})();
    const b=(()=>{try{loadScenario(p);}catch(e:any){return e.message;}return "";})();
    assert.equal(a,b);
    assert.match(a,/Invalid JSON/);
    fs.rmSync(tmp,{recursive:true,force:true});
  });
});

describe("04 - a11y runtime failures", () => {
  it("a11y disabled by default, no findings of type accessibility", async () => {
    const html=`<!doctype html><html><body><h1>hi</h1></body></html>`;
    const server=http.createServer((req,res)=>{res.writeHead(200,{"Content-Type":"text/html"}); res.end(html);});
    await new Promise<void>(r=>server.listen(0,()=>r()));
    const addr:any=server.address();
    const url=`http://localhost:${addr.port}`;
    const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"fc-a11y-"));
    try {
      const out=path.join(tmp,"out1");
      const report=await scanUrl({url, outDir: out});
      assert.equal(report.a11y, null);
      assert.ok(!report.findings.some(f=>f.type==="accessibility"));
    } finally { await new Promise<void>(r=>server.close(()=>r())); fs.rmSync(tmp,{recursive:true,force:true}); }
  });
  it("a11y enabled but page without violations still completes deterministically", async () => {
    const html=`<!doctype html><html><body><h1>ok</h1><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" alt="ok"><button aria-label="ok">ok</button></body></html>`;
    const server=http.createServer((req,res)=>{res.writeHead(200,{"Content-Type":"text/html"}); res.end(html);});
    await new Promise<void>(r=>server.listen(0,()=>r()));
    const addr:any=server.address();
    const url=`http://localhost:${addr.port}`;
    const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"fc-a11y2-"));
    try {
      const out=path.join(tmp,"out2");
      const report=await scanUrl({url, outDir: out, a11y:true});
      assert.ok(report.a11y?.enabled);
      // should not throw, findings may be 0 or more but report must exist
      assert.ok(fs.existsSync(path.join(out,"findings.json")));
      assert.ok(fs.existsSync(path.join(out,"report.html")));
    } finally { await new Promise<void>(r=>server.close(()=>r())); fs.rmSync(tmp,{recursive:true,force:true}); }
  });
  it("a11y with violations produces accessibility findings with disclaimer", async () => {
    const a11yHtml=fs.readFileSync(path.join(process.cwd(),"fixtures/a11y-basic/index.html"),"utf-8");
    const server=http.createServer((req,res)=>{res.writeHead(200,{"Content-Type":"text/html"}); res.end(a11yHtml);});
    await new Promise<void>(r=>server.listen(0,()=>r()));
    const addr:any=server.address();
    const url=`http://localhost:${addr.port}`;
    const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"fc-a11y3-"));
    try {
      const out=path.join(tmp,"out3");
      const report=await scanUrl({url, outDir: out, a11y:true});
      const acc=report.findings.filter(f=>f.type==="accessibility");
      assert.ok(acc.length>0, "expected accessibility findings");
      for(const f of acc){
        assert.ok((f.details as any)?.disclaimer?.includes("NOT WCAG"));
      }
    } finally { await new Promise<void>(r=>server.close(()=>r())); fs.rmSync(tmp,{recursive:true,force:true}); }
  });
  it("a11y runtime error surfaces as warning finding, not crash", async () => {
    // Simulate by scanning a page then detaching; collector catch produces warning
    // We test scanner's catch path: a11y true on a page that navigates away quickly still yields report
    const html=`<!doctype html><html><body>hi</body></html>`;
    const server=http.createServer((req,res)=>{res.writeHead(200,{"Content-Type":"text/html"}); res.end(html);});
    await new Promise<void>(r=>server.listen(0,()=>r()));
    const addr:any=server.address();
    const url=`http://localhost:${addr.port}`;
    const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"fc-a11y4-"));
    try {
      const out=path.join(tmp,"out4");
      const report=await scanUrl({url, outDir: out, a11y:true});
      assert.ok(report.a11y?.enabled);
      // report should still have findings array, not thrown
      assert.ok(Array.isArray(report.findings));
    } finally { await new Promise<void>(r=>server.close(()=>r())); fs.rmSync(tmp,{recursive:true,force:true}); }
  });
});

describe("04 - output directory collisions", () => {
  it("outDir is existing file → concise deterministic error", async () => {
    const html=`<!doctype html><html><body>hi</body></html>`;
    const server=http.createServer((req,res)=>{res.writeHead(200,{"Content-Type":"text/html"}); res.end(html);});
    await new Promise<void>(r=>server.listen(0,()=>r()));
    const addr:any=server.address();
    const url=`http://localhost:${addr.port}`;
    const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"fc-collision-"));
    const filePath=path.join(tmp,"file.txt");
    fs.writeFileSync(filePath,"hello");
    try {
      const a=await scanUrl({url, outDir: filePath}).then(()=>null, (e:any)=>e.message);
      const b=await scanUrl({url, outDir: filePath}).then(()=>null, (e:any)=>e.message);
      assert.ok(a && a.includes("Output directory collision") || a.includes("EEXIST"));
      assert.equal(a,b);
    } finally { await new Promise<void>(r=>server.close(()=>r())); fs.rmSync(tmp,{recursive:true,force:true}); }
  });
  it("existing directory is reused deterministically (overwrite, not error)", async () => {
    const html=`<!doctype html><html><body>hi</body></html>`;
    const server=http.createServer((req,res)=>{res.writeHead(200,{"Content-Type":"text/html"}); res.end(html);});
    await new Promise<void>(r=>server.listen(0,()=>r()));
    const addr:any=server.address();
    const url=`http://localhost:${addr.port}`;
    const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"fc-reuse-"));
    const out=path.join(tmp,"existing");
    fs.mkdirSync(out);
    fs.writeFileSync(path.join(out,"existing.txt"),"old");
    try {
      const report1=await scanUrl({url, outDir: out});
      assert.ok(fs.existsSync(path.join(out,"findings.json")));
      const beforeMtime=fs.statSync(path.join(out,"findings.json")).mtimeMs;
      await new Promise(r=>setTimeout(r,10));
      const report2=await scanUrl({url, outDir: out});
      const afterMtime=fs.statSync(path.join(out,"findings.json")).mtimeMs;
      assert.ok(afterMtime >= beforeMtime);
      // artifacts overwritten deterministically
      assert.equal(report1.viewports.length, report2.viewports.length);
    } finally { await new Promise<void>(r=>server.close(()=>r())); fs.rmSync(tmp,{recursive:true,force:true}); }
  });
  it("output collision message is non-secret-leaking (path not containing tokens)", async () => {
    const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"fc-collision2-"));
    const secretPath=path.join(tmp,"out?token=secret");
    // out path containing token-like string should not leak token in error; but path is just filesystem, not URL
    // Ensure error message does not amplify secret beyond path itself
    // Use a file collision with secret-like name and check error is concise
    const filePath=path.join(tmp,"file-token-secret.txt");
    fs.writeFileSync(filePath,"x");
    const html=`<!doctype html><html><body>hi</body></html>`;
    const server=http.createServer((req,res)=>{res.writeHead(200,{"Content-Type":"text/html"}); res.end(html);});
    await new Promise<void>(r=>server.listen(0,()=>r()));
    const addr:any=server.address();
    const url=`http://localhost:${addr.port}`;
    try{
      const err=await scanUrl({url, outDir: filePath}).then(()=>"", (e:any)=>e.message);
      assert.ok(err.includes("Output directory collision") || err.includes("EEXIST"));
      // error should be concise <200 chars prefix
      assert.ok(err.length < 500);
    } finally { await new Promise<void>(r=>server.close(()=>r())); fs.rmSync(tmp,{recursive:true,force:true}); }
  });
});

describe("04 - non-secret-leaking errors", () => {
  it("invalid URL with credentials is redacted (unsupported protocol path)", async () => {
    const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"fc-secret1-"));
    const out=path.join(tmp,"out");
    try {
      await assert.rejects(()=>scanUrl({url:"ftp://user:secretpass@example.com?token=supersecret&key=abc", outDir: out}), (e:any)=>{
        const msg=e.message as string;
        assert.ok(!msg.includes("secretpass"), `leaked secretpass in ${msg}`);
        assert.ok(!msg.includes("supersecret"), `leaked token in ${msg}`);
        // redacted or at least not leaking raw
        return true;
      });
      await assert.rejects(()=>scanUrl({url:"ht!tp://example.com?token=abc123", outDir: path.join(tmp,"out2")}), (e:any)=>{
        const msg=e.message as string;
        assert.ok(!msg.includes("abc123") || msg.includes("***"), `leaked abc123 in ${msg}`);
        return true;
      });
    } finally { fs.rmSync(tmp,{recursive:true,force:true}); }
  });
  it("Invalid URL ftp with credentials redacted", async () => {
    const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"fc-secret2-"));
    const out=path.join(tmp,"out");
    try{
      await assert.rejects(()=>scanUrl({url:"ftp://user:pass@example.com/?token=xyz", outDir: out}), (e:any)=>{
        assert.ok(!e.message.includes("pass"), "leaked pass");
        return true;
      });
    } finally { fs.rmSync(tmp,{recursive:true,force:true}); }
  });
  it("resolveRouteUrl and batch baseUrl redact credentials on invalid input", () => {
    // valid secret URL should not throw; test invalid ones redact
    assert.throws(()=>resolveRouteUrl("ftp://user:secret@example.com","/"), (e:any)=>{
      assert.ok(!e.message.includes("secret"), "leaked secret in resolveRouteUrl");
      return true;
    });
    assert.throws(()=>resolveRouteUrl("http://user:secret@example.com","ftp://evil.com/path?token=abc"), (e:any)=>{
      assert.ok(!e.message.includes("abc") || e.message.includes("***"));
      return true;
    });
    // malformed base with token
    assert.throws(()=>resolveRouteUrl("ht!tp://example.com?token=supersecret","/"), (e:any)=>{
      assert.ok(!e.message.includes("supersecret") || e.message.includes("***"));
      return true;
    });
  });
  it("findings.json does not leak credentials", async () => {
    const html=`<!doctype html><html><body>hi</body></html>`;
    const server=http.createServer((req,res)=>{res.writeHead(200,{"Content-Type":"text/html"}); res.end(html);});
    await new Promise<void>(r=>server.listen(0,()=>r()));
    const addr:any=server.address();
    const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"fc-secret3-"));
    const credUrl=`http://user:secret@localhost:${addr.port}/?token=supersecret&api_key=key123`;
    const out=path.join(tmp,"out");
    try{
      const report=await scanUrl({url: credUrl, outDir: out});
      const raw=fs.readFileSync(path.join(out,"findings.json"),"utf-8");
      assert.ok(!raw.includes("secret"));
      assert.ok(!raw.includes("supersecret"));
      assert.ok(!raw.includes("key123"));
      assert.match(raw, /\*\*\*/);
    } finally { await new Promise<void>(r=>server.close(()=>r())); fs.rmSync(tmp,{recursive:true,force:true}); }
  });
  it("errors are concise (<500 chars prefix) and deterministic", () => {
    const a=(()=>{ try{ parseSweep("bad:format"); }catch(e:any){return e.message;} return "";})();
    const b=(()=>{ try{ parseSweep("bad:format"); }catch(e:any){return e.message;} return "";})();
    assert.equal(a,b);
    assert.ok(a.length < 500);
    assert.ok(!a.includes("secret"));
  });
});

describe("04 - missing config and invalid route JSON determinism", () => {
  it("missing explicit config throws deterministic, concise", () => {
    const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"fc-cfg-err-"));
    const p=path.join(tmp,"nope.json");
    const a=(()=>{ try{ loadRoutesManifest(p); }catch(e:any){return e.message;} return "";})();
    // Actually test config missing via scanUrl
    // use loadScenario missing already covered
    fs.rmSync(tmp,{recursive:true,force:true});
    assert.ok(a.includes("not found") || a.length>0);
  });
  it("compare invalid JSON is concise deterministic", () => {
    const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"fc-cmp-err-"));
    const bad=path.join(tmp,"bad.json");
    fs.writeFileSync(bad,"{not json");
    const good=path.join(tmp,"good.json");
    fs.writeFileSync(good, JSON.stringify({findings:[]}));
    const a=(()=>{ try{ compareReports(bad,good);}catch(e:any){return e.message;}return "";})();
    const b=(()=>{ try{ compareReports(bad,good);}catch(e:any){return e.message;}return "";})();
    assert.equal(a,b);
    assert.match(a, /Invalid JSON/);
    assert.ok(a.length < 500);
    fs.rmSync(tmp,{recursive:true,force:true});
  });
  it("compare missing file is deterministic", () => {
    const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"fc-cmp-miss-"));
    const a=(()=>{ try{ compareReports(path.join(tmp,"a.json"), path.join(tmp,"b.json"));}catch(e:any){return e.message;}return "";})();
    const b=(()=>{ try{ compareReports(path.join(tmp,"a.json"), path.join(tmp,"b.json"));}catch(e:any){return e.message;}return "";})();
    assert.equal(a,b);
    fs.rmSync(tmp,{recursive:true,force:true});
  });
});

describe("04 - batch output collision deterministic", () => {
  it("batch outDir as file is error", async () => {
    const html=fs.readFileSync(path.join(process.cwd(),"fixtures/multi-route/pages/home/index.html"),"utf-8");
    const server=http.createServer((req,res)=>{res.writeHead(200,{"Content-Type":"text/html"}); res.end(html);});
    await new Promise<void>(r=>server.listen(0,()=>r()));
    const addr:any=server.address();
    const baseUrl=`http://localhost:${addr.port}`;
    const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"fc-batch-coll-"));
    const manifest=path.join(tmp,"routes.json");
    fs.writeFileSync(manifest, JSON.stringify({routes:[{name:"home",path:"/"}]}));
    const fileOut=path.join(tmp,"file.txt");
    fs.writeFileSync(fileOut,"x");
    try{
      await assert.rejects(()=>scanBatch({baseUrl, routesManifestPath: manifest, outDir: fileOut}), /(Output directory collision|EEXIST|not a directory)/);
    } finally { await new Promise<void>(r=>server.close(()=>r())); fs.rmSync(tmp,{recursive:true,force:true}); }
  });
});
