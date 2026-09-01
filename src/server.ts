import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { scanUrl } from "./engine/scanner.js";
import type { ScanReport } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_ROOT = path.join(ROOT, "framecritic-out");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve generated reports statically
app.use("/reports", express.static(OUT_ROOT));
// Serve dashboard static
app.use(express.static(path.join(ROOT, "public")));

let latestReport: ScanReport | null = null;
let latestOutDir: string | null = null;
let scanInProgress = false;

// API: trigger scan
app.post("/api/scan", async (req, res) => {
  if (scanInProgress) {
    res.status(409).json({ error: "A scan is already in progress" });
    return;
  }
  const url = (req.body?.url ?? "").toString().trim();
  if (!url) {
    res.status(400).json({ error: "Missing 'url' in request body" });
    return;
  }
  scanInProgress = true;
  const outDir = path.join(OUT_ROOT, `scan-${Date.now()}`);
  console.log(`[FrameCritic] Scan requested: ${url} → ${outDir}`);
  try {
    const report = await scanUrl({ url, outDir });
    latestReport = report;
    latestOutDir = outDir;
    // Also write latest symlink dir marker
    try {
      const latestMarker = path.join(OUT_ROOT, "latest.json");
      fs.writeFileSync(latestMarker, JSON.stringify({ outDir, report }, null, 2));
    } catch {}
    res.json({ ok: true, report, outDir: path.relative(ROOT, outDir) });
  } catch (e: any) {
    console.error("[FrameCritic] Scan failed", e);
    res.status(500).json({ error: e?.message ?? String(e) });
  } finally {
    scanInProgress = false;
  }
});

app.get("/api/status", (_req, res) => {
  res.json({ scanInProgress, latestReport, latestOutDir });
});

app.get("/api/reports", (_req, res) => {
  try {
    const entries = fs.readdirSync(OUT_ROOT, { withFileTypes: true });
    const scans = entries
      .filter((e) => e.isDirectory() && e.name.startsWith("scan-"))
      .map((e) => {
        const dir = path.join(OUT_ROOT, e.name);
        let report: ScanReport | null = null;
        try {
          const raw = fs.readFileSync(path.join(dir, "findings.json"), "utf-8");
          report = JSON.parse(raw);
        } catch {}
        return { dir: e.name, report };
      })
      .sort((a, b) => b.dir.localeCompare(a.dir));
    res.json(scans);
  } catch {
    res.json([]);
  }
});

const PORT = Number(process.env.PORT ?? 3030);
app.listen(PORT, () => {
  console.log(`[FrameCritic] Dashboard → http://localhost:${PORT}`);
  console.log(`[FrameCritic] POST /api/scan { url } to trigger a scan`);
});
