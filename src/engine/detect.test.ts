import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium, type Browser } from "playwright";
import { getDetectionScript } from "./detect.js";

let browser: Browser;

before(async () => {
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
});

async function runDetect(html: string, viewport: { width: number; height: number }): Promise<any[]> {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  await page.setContent(html, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(200);
  const findings: any[] = await page.evaluate(getDetectionScript() as any);
  await ctx.close();
  return findings;
}

describe("overflow detection", () => {
  it("flags horizontal overflow when document exceeds viewport", async () => {
    const html = `<!doctype html><style>body{margin:0}.wide{width:600px;height:40px;background:#7c5cff}</style><div class="wide">wide</div>`;
    const findings = await runDetect(html, { width: 390, height: 844 });
    const o = findings.find((f) => f.type === "horizontal-overflow");
    assert.ok(o, "should detect overflow");
    assert.equal(o.severity, "error");
    assert.ok(o.details.scrollWidth > o.details.viewportWidth);
    assert.ok(o.details.offenders.some((x: any) => x.selector.includes("div.wide")));
  });

  it("does not flag overflow when content fits", async () => {
    const html = `<!doctype html><style>body{margin:0}.narrow{width:200px;height:40px}</style><div class="narrow">ok</div>`;
    const findings = await runDetect(html, { width: 390, height: 844 });
    assert.equal(findings.find((f) => f.type === "horizontal-overflow"), undefined);
  });
});

describe("overlap detection", () => {
  it("flags significantly overlapping elements", async () => {
    const html = `<!doctype html><style>
      .card{position:relative;width:300px;height:200px;border:1px solid #ccc}
      .a{position:absolute;top:10px;left:10px;width:80px;height:40px;background:#111;color:#fff}
      .b{position:absolute;top:12px;left:30px;width:80px;height:40px;background:#ff4d6a;color:#fff}
    </style><div class="card"><div class="a">A</div><div class="b">B</div></div>`;
    const findings = await runDetect(html, { width: 390, height: 844 });
    const ov = findings.find((f) => f.type === "overlapping-elements");
    assert.ok(ov, "should detect overlap");
    assert.ok(ov.details.pairs.length >= 1);
    const p = ov.details.pairs[0];
    assert.ok(p.overlap.w > 8 && p.overlap.h > 8);
    assert.ok(p.overlap.ratio > 0.2 || p.overlap.area > 2500);
    assert.ok(p.a && p.b);
  });

  it("ignores ancestor/descendant overlap", async () => {
    const html = `<!doctype html><style>.outer{width:300px;height:200px;background:#eee}.inner{width:200px;height:100px;background:#ddd;margin:10px}</style><div class="outer"><div class="inner">child</div></div>`;
    const findings = await runDetect(html, { width: 390, height: 844 });
    // ancestor pair should not be flagged; other false positives possible but outer/inner specifically should not create a pair
    const ov = findings.find((f) => f.type === "overlapping-elements");
    if (ov) {
      for (const p of ov.details.pairs) {
        assert.ok(!p.a.includes("outer") || !p.b.includes("inner"), "should not flag parent-child");
      }
    }
  });
});

describe("broken image detection", () => {
  it("flags broken images with rect", async () => {
    const html = `<!doctype html><img src="/nonexistent-broken-xyz.png" alt="broken" style="width:120px;height:80px"><img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10'%3E%3Crect width='10' height='10' fill='red'/%3E%3C/svg%3E" alt="ok" style="width:10px;height:10px">`;
    const findings = await runDetect(html, { width: 390, height: 844 });
    const br = findings.find((f) => f.type === "broken-image");
    assert.ok(br, "should detect broken image");
    assert.equal(br.severity, "error");
    assert.equal(br.details.images.length, 1);
    assert.equal(br.details.images[0].src, "/nonexistent-broken-xyz.png");
    assert.ok(br.details.images[0].rect, "should include rect for annotation");
  });

  it("does not flag valid data-uri image", async () => {
    const html = `<!doctype html><img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10'%3E%3Crect width='10' height='10' fill='green'/%3E%3C/svg%3E" alt="ok">`;
    const findings = await runDetect(html, { width: 390, height: 844 });
    assert.equal(findings.find((f) => f.type === "broken-image"), undefined);
  });
});

describe("outside-viewport detection", () => {
  it("flags elements extending beyond viewport", async () => {
    const html = `<!doctype html><style>.off{position:absolute;left:1450px;top:20px;width:200px;height:50px;background:#fef08a}</style><div class="off">offscreen</div>`;
    const findings = await runDetect(html, { width: 390, height: 844 });
    const out = findings.find((f) => f.type === "outside-viewport");
    assert.ok(out);
    assert.ok(out.details.elements.some((e: any) => e.selector.includes("off")));
  });
});
