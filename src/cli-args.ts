import { VIEWPORTS, type Viewport } from "./types.js";

export function parseViewportList(raw: string | undefined): Viewport[] | null {
  if (!raw) return null;
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  const out: Viewport[] = [];
  for (const p of parts) {
    const lower = p.toLowerCase();
    const builtin = VIEWPORTS.find((v) => v.label === lower);
    if (builtin) {
      out.push(builtin);
      continue;
    }
    const m = lower.match(/^(\d+)\s*x\s*(\d+)$/);
    if (m) {
      const w = Number(m[1]);
      const h = Number(m[2]);
      if (w >= 200 && w <= 4000 && h >= 200 && h <= 3000) {
        out.push({ label: `${w}x${h}`, width: w, height: h });
        continue;
      }
    }
    // For tests, don't exit but throw — caller decides.
    // When used via CLI main, this function is called and errors exit.
    throw new Error(`Unknown viewport "${p}". Known: ${VIEWPORTS.map((v) => v.label).join(", ")} or WxH like 390x844`);
  }
  const seen = new Set<string>();
  return out.filter((v) => (seen.has(v.label) ? false : (seen.add(v.label), true)));
}

export const SWEEP_HEIGHT = 900;
export const SWEEP_MAX_WIDTHS = 12;

export function parseSweep(raw: string): Viewport[] {
  if (!raw || typeof raw !== "string") throw new Error(`--sweep requires a value <min>:<max>:<step> (e.g. 320:1200:160)`);
  const s = raw.trim();
  const parts = s.split(":").map((p) => p.trim());
  if (parts.length !== 3) throw new Error(`--sweep requires format <min>:<max>:<step> (e.g. 320:1200:160) got "${raw}"`);
  const [minS, maxS, stepS] = parts;
  const min = Number(minS);
  const max = Number(maxS);
  const step = Number(stepS);
  if (!Number.isInteger(min) || !Number.isInteger(max) || !Number.isInteger(step)) {
    throw new Error(`--sweep values must be positive integers (got "${raw}")`);
  }
  if (min < 200 || min > 4000 || max < 200 || max > 4000) {
    throw new Error(`--sweep min/max must be between 200 and 4000 (got "${raw}")`);
  }
  if (step < 1 || step > 4000) {
    throw new Error(`--sweep step must be between 1 and 4000 (got "${raw}")`);
  }
  if (min > max) {
    throw new Error(`--sweep min must be <= max (got "${raw}")`);
  }
  const widths: number[] = [];
  for (let w = min; w <= max; w += step) {
    widths.push(w);
    if (widths.length > SWEEP_MAX_WIDTHS) break;
  }
  if (widths.length > SWEEP_MAX_WIDTHS) {
    throw new Error(`--sweep would generate ${widths.length} widths — hard cap is ${SWEEP_MAX_WIDTHS} (got "${raw}"). Increase step or reduce range.`);
  }
  if (widths.length === 0) throw new Error(`--sweep produced no widths (got "${raw}")`);
  // Defensive: if loop stopped early due to cap, also error with count?
  // Already handled >12 case. For exactly 12 it's allowed, but we already checked.
  // Re-check total that would have been generated without cap to give precise error.
  const totalWouldBe = Math.floor((max - min) / step) + 1;
  if (totalWouldBe > SWEEP_MAX_WIDTHS) {
    throw new Error(`--sweep would generate ${totalWouldBe} widths — hard cap is ${SWEEP_MAX_WIDTHS} (got "${raw}"). Increase step or reduce range.`);
  }
  return widths.map((w) => ({ label: `sweep-${w}`, width: w, height: SWEEP_HEIGHT }));
}

export type ParsedArgs = {
  command: "scan" | "compare" | "help" | "version";
  url?: string;
  output?: string;
  open: boolean;
  viewports?: Viewport[];
  sweep?: string;
  help: boolean;
  config?: string;
  failOn?: "error" | "warning" | "never";
  maxWarnings?: number;
  jsonSummary?: boolean;
  scenario?: string;
  trace?: boolean;
  a11y?: boolean;
  routes?: string;
  // compare specific
  compareBaseline?: string;
  compareCurrent?: string;
  failOnNew?: boolean;
};

/** Parse argv (without node+script) — exported for tests. Throws on invalid input. */
export function parseArgs(argv: string[]): ParsedArgs {
  if (argv.includes("--help") || argv.includes("-h")) {
    return { command: "help", open: false, help: true };
  }
  if (argv.includes("--version") || argv.includes("-v")) {
    return { command: "version", open: false, help: false };
  }

  let command: ParsedArgs["command"] = "scan";
  let url: string | undefined;
  let output: string | undefined;
  let open = false;
  let viewports: Viewport[] | undefined;
  let config: string | undefined;
  let failOn: ParsedArgs["failOn"] | undefined;
  let maxWarnings: number | undefined;
  let jsonSummary = false;
  let scenario: string | undefined;
  let trace = false;
  let a11y = false;
  let sweep: string | undefined;
  let routes: string | undefined;
  let failOnNew = false;
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "scan") {
      command = "scan";
      continue;
    }
    if (a === "--output" || a === "-o") {
      output = argv[i + 1];
      if (!output || output.startsWith("-")) {
        throw new Error(`--output requires a directory path`);
      }
      i++;
      continue;
    }
    if (a.startsWith("--output=")) {
      output = a.slice("--output=".length);
      continue;
    }
    if (a === "--viewport") {
      const raw = argv[i + 1];
      if (!raw || raw.startsWith("-")) {
        throw new Error(`--viewport requires a value (e.g. mobile,tablet or 390x844)`);
      }
      viewports = parseViewportList(raw) ?? undefined;
      i++;
      continue;
    }
    if (a.startsWith("--viewport=")) {
      viewports = parseViewportList(a.slice("--viewport=".length)) ?? undefined;
      continue;
    }
    if (a === "--open") {
      open = true;
      continue;
    }
    if (a === "--config") {
      const raw = argv[i + 1];
      if (!raw || raw.startsWith("-")) {
        throw new Error(`--config requires a file path`);
      }
      config = raw;
      i++;
      continue;
    }
    if (a.startsWith("--config=")) {
      config = a.slice("--config=".length);
      if (!config) throw new Error(`--config requires a file path`);
      continue;
    }
    if (a === "--fail-on") {
      const raw = argv[i + 1];
      if (!raw || raw.startsWith("-")) throw new Error(`--fail-on requires a value (error|warning|never)`);
      const v = raw.toLowerCase();
      if (!["error", "warning", "never"].includes(v)) throw new Error(`--fail-on must be one of: error, warning, never (got "${raw}")`);
      failOn = v as any;
      i++;
      continue;
    }
    if (a.startsWith("--fail-on=")) {
      const raw = a.slice("--fail-on=".length);
      const v = raw.toLowerCase();
      if (!["error", "warning", "never"].includes(v)) throw new Error(`--fail-on must be one of: error, warning, never (got "${raw}")`);
      failOn = v as any;
      continue;
    }
    if (a === "--max-warnings") {
      const raw = argv[i + 1];
      if (!raw || raw.startsWith("-")) throw new Error(`--max-warnings requires a number`);
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0) throw new Error(`--max-warnings must be a non-negative integer (got "${raw}")`);
      maxWarnings = n;
      i++;
      continue;
    }
    if (a.startsWith("--max-warnings=")) {
      const raw = a.slice("--max-warnings=".length);
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0) throw new Error(`--max-warnings must be a non-negative integer (got "${raw}")`);
      maxWarnings = n;
      continue;
    }
    if (a === "--json-summary") {
      jsonSummary = true;
      continue;
    }
    if (a === "--trace") {
      trace = true;
      continue;
    }
    if (a === "--a11y") {
      a11y = true;
      continue;
    }
    if (a === "--sweep") {
      const raw = argv[i + 1];
      if (!raw || raw.startsWith("-")) throw new Error(`--sweep requires a value <min>:<max>:<step> (e.g. 320:1200:160)`);
      sweep = raw;
      i++;
      continue;
    }
    if (a.startsWith("--sweep=")) {
      const raw = a.slice("--sweep=".length);
      if (!raw) throw new Error(`--sweep requires a value <min>:<max>:<step>`);
      sweep = raw;
      continue;
    }
    if (a === "--routes") {
      const raw = argv[i + 1];
      if (!raw || raw.startsWith("-")) throw new Error(`--routes requires a file path to routes JSON`);
      routes = raw;
      i++;
      continue;
    }
    if (a.startsWith("--routes=")) {
      const raw = a.slice("--routes=".length);
      if (!raw) throw new Error(`--routes requires a file path to routes JSON`);
      routes = raw;
      continue;
    }
    if (a === "--scenario") {
      const raw = argv[i + 1];
      if (!raw || raw.startsWith("-")) throw new Error(`--scenario requires a file path`);
      scenario = raw;
      i++;
      continue;
    }
    if (a.startsWith("--scenario=")) {
      const raw = a.slice("--scenario=".length);
      if (!raw) throw new Error(`--scenario requires a file path`);
      scenario = raw;
      continue;
    }
    if (a === "compare") {
      command = "compare";
      continue;
    }
    if (a === "--fail-on-new") {
      failOnNew = true;
      continue;
    }
    if (a.startsWith("-")) {
      throw new Error(`Unknown option "${a}". See --help.`);
    }
    positional.push(a);
  }

  // handle sweep vs viewport conflict and generation
  if (sweep && viewports) {
    throw new Error(`Cannot combine --sweep and --viewport; use one or the other`);
  }
  if (sweep) {
    viewports = parseSweep(sweep);
  }
  if (routes && scenario) {
    throw new Error(`Cannot combine --routes and --scenario; specify scenario per-route in the routes manifest instead`);
  }

  // handle compare positional args
  if (command === "compare") {
    if (positional.length < 2) {
      throw new Error(`compare requires two arguments: <baseline-findings.json> <current-findings.json>`);
    }
    return {
      command,
      output,
      open,
      viewports,
      sweep,
      help: false,
      config,
      failOn,
      maxWarnings,
      jsonSummary,
      scenario,
      trace,
      a11y,
      routes,
      compareBaseline: positional[0],
      compareCurrent: positional[1],
      failOnNew,
    };
  }

  if (positional.length > 0) url = positional[0];
  if (positional.length > 1 && !output) output = positional[1];

  return { command, url, output, open, viewports, sweep, routes, help: false, config, failOn, maxWarnings, jsonSummary, scenario, trace, a11y, failOnNew };
}
