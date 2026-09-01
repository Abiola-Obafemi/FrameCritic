import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium, type Browser } from "playwright";
import { generateHtmlReport } from "./report.js";
import type { ScanReport } from "../types.js";
import fs from "node:fs";
import path from "node:path";

let browser: Browser;

before(async () => {
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
});

function makeReport(): ScanReport {
  return {
    url: "http://example.com",
    timestamp: new Date().toISOString(),
    viewports: [
      { label: "mobile", width: 390, height: 844 },
      { label: "desktop", width: 1440, height: 900 },
    ],
    results: [
      {
        viewport: { label: "mobile", width: 390, height: 844 },
        screenshot: "screenshots/mobile.png",
        annotatedScreenshot: "screenshots/mobile-annotated.png",
        annotations: [{ id: 1, x: 0, y: 0, w: 100, h: 30, type: "horizontal-overflow", severity: "error", label: "overflow", selector: "body > div" }],
        findings: [
          { type: "horizontal-overflow", severity: "error", viewport: "mobile", message: "overflow", details: {}, markerIds: [1] },
        ],
      },
      {
        viewport: { label: "desktop", width: 1440, height: 900 },
        screenshot: "screenshots/desktop.png",
        findings: [],
      },
    ],
    findings: [{ type: "horizontal-overflow", severity: "error", viewport: "mobile", message: "overflow", details: {}, markerIds: [1] }],
    summary: { total: 1, errors: 1, warnings: 0, infos: 0 },
  };
}

describe("accessibility — report", () => {
  it("has semantic structure, labels, alt text, and keyboard-usable controls", async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const html = generateHtmlReport(makeReport());
    await page.setContent(html, { waitUntil: "domcontentloaded" });

    // semantic structure
    const hasMain = await page.$("main#main-content");
    assert.ok(hasMain, "main#main-content should exist");
    const hasHeader = await page.$('header[role="banner"]');
    assert.ok(hasHeader, "header banner");
    const hasNav = await page.$('nav[aria-label="Filter findings"]');
    assert.ok(hasNav, "filter nav");
    const hasFooter = await page.$('footer[role="contentinfo"]');
    assert.ok(hasFooter, "footer");

    // labels for filters
    const vpLabel = await page.$('label[for="filter-viewport"]');
    assert.ok(vpLabel, "label for viewport");
    const sevLabel = await page.$('label[for="filter-severity"]');
    assert.ok(sevLabel);
    const typeLabel = await page.$('label[for="filter-type"]');
    assert.ok(typeLabel);

    // selects are keyboard focusable and have aria-label
    for (const id of ["filter-viewport", "filter-severity", "filter-type"]) {
      const el = await page.$(`#${id}`);
      assert.ok(el);
      const aria = await el?.getAttribute("aria-label");
      assert.ok(aria);
      // tabbable
      const tag = await el?.evaluate((e) => e.tagName);
      assert.equal(tag, "SELECT");
    }

    // skip link
    const skip = await page.$("a.skip-link[href='#main-content']");
    assert.ok(skip, "skip link");

    // visible focus style exists (CSS)
    assert.ok(html.includes(":focus-visible"), "focus-visible style");

    // images have non-generic alt text containing viewport and marker info
    const imgs = await page.$$eval("img", (els) => els.map((e) => e.getAttribute("alt") || ""));
    assert.ok(imgs.length >= 2);
    for (const alt of imgs) {
      assert.ok(alt.length > 12, `alt should be descriptive: "${alt}"`);
      assert.ok(!/^Annotated$/i.test(alt), "alt should not be generic");
      assert.ok(!/^Screenshot$/i.test(alt));
    }

    // tabs keyboard roles
    const tablist = await page.$('[role="tablist"]');
    assert.ok(tablist, "tablist");
    const tabs = await page.$$('[role="tab"]');
    assert.ok(tabs.length >= 2);
    for (const t of tabs) {
      const sel = await t.getAttribute("aria-selected");
      assert.ok(sel === "true" || sel === "false");
      const controls = await t.getAttribute("aria-controls");
      assert.ok(controls);
      const panel = await page.$(`#${controls}`);
      assert.ok(panel);
      assert.equal(await panel?.getAttribute("role"), "tabpanel");
    }

    // keyboard: tabs should be focusable and arrow keys work
    await tabs[0].focus();
    await page.keyboard.press("ArrowRight");
    const secondSelected = await tabs[1].getAttribute("aria-selected");
    assert.equal(secondSelected, "true");

    // findings are articles with aria-labelledby
    const findings = await page.$$("article.finding");
    assert.ok(findings.length >= 1);
    for (const f of findings) {
      const aria = await f.getAttribute("aria-labelledby");
      assert.ok(aria);
      const title = await page.$(`#${aria}`);
      assert.ok(title);
    }

    await ctx.close();
  });

  it("passes axe-core automated check (no critical violations)", async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const html = generateHtmlReport(makeReport());
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    // inject axe-core from node_modules
    const axePath = path.resolve("node_modules/axe-core/axe.min.js");
    const axeSrc = fs.readFileSync(axePath, "utf-8");
    await page.evaluate(axeSrc);
    const result: any = await page.evaluate(async () => {
      // @ts-ignore
      return await (window as any).axe.run({ exclude: [[".shot-wrap img"]] });
    });
    // Filter out known false positives for our use-case (color-contrast for large text may be borderline on muted)
    const critical = result.violations.filter((v: any) => v.impact === "critical");
    assert.equal(critical.length, 0, `axe critical violations: ${JSON.stringify(critical, null, 2)}`);
    // Also ensure no serious violations for keyboard/label
    const seriousLabel = result.violations.filter((v: any) => v.id === "label" || v.id === "aria-required-attr");
    assert.equal(seriousLabel.length, 0, `label/aria violations: ${JSON.stringify(seriousLabel, null, 2)}`);
    await ctx.close();
  });
});
