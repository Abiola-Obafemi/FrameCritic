import path from "node:path";
import { scanUrl } from "./engine/scanner.js";

const url = process.argv[2];
if (!url) {
  console.error("Usage: npm run scan -- <url>");
  console.error("  e.g. npm run scan -- http://localhost:3001");
  process.exit(1);
}

const outDir = process.argv[3] ?? path.join(process.cwd(), "framecritic-out", `scan-${Date.now()}`);

console.log(`[FrameCritic] Scanning ${url}`);
console.log(`[FrameCritic] Output → ${outDir}`);

const report = await scanUrl({ url, outDir });

console.log(`\n[FrameCritic] Done — ${report.summary.total} findings (${report.summary.errors} errors, ${report.summary.warnings} warnings)`);
console.log(`  findings.json → ${path.join(outDir, "findings.json")}`);
console.log(`  report.html   → ${path.join(outDir, "report.html")}`);
for (const r of report.results) {
  console.log(`  ${r.viewport.label} ${r.viewport.width}x${r.viewport.height} → ${r.screenshot} (${r.findings.length} findings)`);
}
