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

export type ParsedArgs = {
  command: "scan" | "help" | "version";
  url?: string;
  output?: string;
  open: boolean;
  viewports?: Viewport[];
  help: boolean;
  config?: string;
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
    if (a.startsWith("-")) {
      throw new Error(`Unknown option "${a}". See --help.`);
    }
    positional.push(a);
  }

  if (positional.length > 0) url = positional[0];
  if (positional.length > 1 && !output) output = positional[1];

  return { command, url, output, open, viewports, help: false, config };
}
