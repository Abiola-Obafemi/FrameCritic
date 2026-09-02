import fs from "node:fs";
import path from "node:path";
import type { Finding } from "./types.js";

export type FramecriticConfig = {
  ignore?: {
    selectors?: string[];
    types?: string[];
    viewports?: {
      mobile?: string[];
      tablet?: string[];
      desktop?: string[];
    };
  };
};

const KNOWN_TYPES: Finding["type"][] = [
  "horizontal-overflow",
  "outside-viewport",
  "overlapping-elements",
  "broken-image",
  "console-error",
  "page-error",
  "accessibility",
];

const VIEWPORT_KEYS = ["mobile", "tablet", "desktop"] as const;

export type ConfigLoadResult = {
  config: FramecriticConfig;
  path: string | null;
  raw?: unknown;
};

export function validateConfig(raw: unknown, sourcePath: string): FramecriticConfig {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Invalid config ${sourcePath}: root must be a JSON object`);
  }
  const obj = raw as Record<string, unknown>;
  const allowedRootKeys = new Set(["ignore"]);
  for (const k of Object.keys(obj)) {
    if (!allowedRootKeys.has(k)) {
      throw new Error(`Invalid config ${sourcePath}: unknown root key "${k}" (allowed: ignore)`);
    }
  }
  let ignore: FramecriticConfig["ignore"] | undefined;
  if (obj.ignore !== undefined) {
    if (obj.ignore === null || typeof obj.ignore !== "object" || Array.isArray(obj.ignore)) {
      throw new Error(`Invalid config ${sourcePath}: "ignore" must be an object`);
    }
    const ign = obj.ignore as Record<string, unknown>;
    const allowedIgnoreKeys = new Set(["selectors", "types", "viewports"]);
    for (const k of Object.keys(ign)) {
      if (!allowedIgnoreKeys.has(k)) {
        throw new Error(`Invalid config ${sourcePath}: unknown ignore key "${k}" (allowed: selectors, types, viewports)`);
      }
    }
    const selectors = ign.selectors;
    const types = ign.types;
    const viewports = ign.viewports;
    let outSelectors: string[] | undefined;
    let outTypes: string[] | undefined;
    let outViewports: Record<string, string[]> | undefined;

    if (selectors !== undefined) {
      if (!Array.isArray(selectors)) throw new Error(`Invalid config ${sourcePath}: ignore.selectors must be an array of strings`);
      outSelectors = [];
      for (let i = 0; i < selectors.length; i++) {
        const s = selectors[i];
        if (typeof s !== "string" || !s.trim()) throw new Error(`Invalid config ${sourcePath}: ignore.selectors[${i}] must be a non-empty string`);
        outSelectors.push(s.trim());
      }
    }
    if (types !== undefined) {
      if (!Array.isArray(types)) throw new Error(`Invalid config ${sourcePath}: ignore.types must be an array of strings`);
      outTypes = [];
      for (let i = 0; i < types.length; i++) {
        const t = types[i];
        if (typeof t !== "string" || !t.trim()) throw new Error(`Invalid config ${sourcePath}: ignore.types[${i}] must be a non-empty string`);
        const trimmed = t.trim();
        if (!KNOWN_TYPES.includes(trimmed as any)) {
          throw new Error(`Invalid config ${sourcePath}: ignore.types[${i}] unknown type "${trimmed}" (allowed: ${KNOWN_TYPES.join(", ")})`);
        }
        outTypes.push(trimmed);
      }
    }
    if (viewports !== undefined) {
      if (viewports === null || typeof viewports !== "object" || Array.isArray(viewports)) {
        throw new Error(`Invalid config ${sourcePath}: ignore.viewports must be an object`);
      }
      const vpObj = viewports as Record<string, unknown>;
      outViewports = {};
      for (const k of Object.keys(vpObj)) {
        if (!(VIEWPORT_KEYS as readonly string[]).includes(k)) {
          throw new Error(`Invalid config ${sourcePath}: ignore.viewports has unknown viewport "${k}" (allowed: ${VIEWPORT_KEYS.join(", ")})`);
        }
        const arr = vpObj[k];
        if (!Array.isArray(arr)) throw new Error(`Invalid config ${sourcePath}: ignore.viewports.${k} must be an array of strings`);
        const list: string[] = [];
        for (let i = 0; i < arr.length; i++) {
          const s = arr[i];
          if (typeof s !== "string" || !s.trim()) throw new Error(`Invalid config ${sourcePath}: ignore.viewports.${k}[${i}] must be a non-empty string`);
          list.push(s.trim());
        }
        outViewports[k] = list;
      }
    }
    ignore = {};
    if (outSelectors) ignore.selectors = outSelectors;
    if (outTypes) ignore.types = outTypes;
    if (outViewports && Object.keys(outViewports).length) ignore.viewports = outViewports as any;
  }
  if (ignore && Object.keys(ignore).length === 0) return {};
  return ignore ? { ignore } : {};
}

export function loadConfig(opts: { explicitPath?: string; cwd?: string }): ConfigLoadResult {
  const cwd = opts.cwd ?? process.cwd();
  if (opts.explicitPath) {
    const p = path.resolve(cwd, opts.explicitPath);
    if (!fs.existsSync(p)) {
      throw new Error(`Config file not found: ${p} (specified via --config)`);
    }
    let rawText: string;
    try {
      rawText = fs.readFileSync(p, "utf-8");
    } catch (e: any) {
      throw new Error(`Failed to read config ${p}: ${e.message}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch (e: any) {
      throw new Error(`Invalid JSON in config ${p}: ${e.message}`);
    }
    const config = validateConfig(parsed, p);
    return { config, path: p, raw: parsed };
  }
  // auto-discover .framecritic.json in cwd
  const autoPath = path.join(cwd, ".framecritic.json");
  if (!fs.existsSync(autoPath)) {
    return { config: {}, path: null };
  }
  let rawText: string;
  try {
    rawText = fs.readFileSync(autoPath, "utf-8");
  } catch (e: any) {
    throw new Error(`Failed to read config ${autoPath}: ${e.message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (e: any) {
    throw new Error(`Invalid JSON in config ${autoPath}: ${e.message}`);
  }
  const config = validateConfig(parsed, autoPath);
  return { config, path: autoPath, raw: parsed };
}

function getFindingSelectors(f: Finding): string[] {
  const d: any = f.details ?? {};
  switch (f.type) {
    case "horizontal-overflow":
      return (d.offenders ?? []).map((o: any) => o.selector).filter((s: any) => typeof s === "string");
    case "outside-viewport":
      return (d.elements ?? []).map((e: any) => e.selector).filter((s: any) => typeof s === "string");
    case "overlapping-elements":
      return (d.pairs ?? []).flatMap((p: any) => [p.a, p.b]).filter((s: any) => typeof s === "string");
    case "broken-image":
      return (d.images ?? []).map((i: any) => i.selector).filter((s: any) => typeof s === "string");
    case "accessibility":
      return ((d.nodes ?? []).map((n: any) => n.selector).filter((s: any) => typeof s === "string").length ? (d.nodes ?? []).map((n: any) => n.selector).filter((s: any) => typeof s === "string") : (d.affectedSelectors ?? []).filter((s: any) => typeof s === "string"));
    default:
      return [];
  }
}

function selectorMatches(ignored: string, findingSelectors: string[]): boolean {
  const needle = ignored.trim();
  if (!needle) return false;
  for (const sel of findingSelectors) {
    if (sel === needle) return true;
    if (sel.includes(needle)) return true;
    // also allow needle containing selector? For leniency
    if (needle.includes(sel) && sel.length > 3) return true;
  }
  return false;
}

export type SuppressionResult = {
  kept: Finding[];
  suppressed: Array<{ finding: Finding; reason: string }>;
};

export function applyIgnoreRules(findings: Finding[], config: FramecriticConfig): SuppressionResult {
  const selectors = config.ignore?.selectors ?? [];
  const types = new Set(config.ignore?.types ?? []);
  const vpMap: Record<string, string[]> = (config.ignore?.viewports as any) ?? {};
  const kept: Finding[] = [];
  const suppressed: Array<{ finding: Finding; reason: string }> = [];
  for (const f of findings) {
    // type ignore
    if (types.has(f.type)) {
      suppressed.push({ finding: f, reason: `type:${f.type}` });
      continue;
    }
    const selectorsInFinding = getFindingSelectors(f);
    // global selectors
    let matchedGlobal: string | null = null;
    for (const ign of selectors) {
      if (selectorMatches(ign, selectorsInFinding)) {
        matchedGlobal = ign;
        break;
      }
    }
    if (matchedGlobal) {
      suppressed.push({ finding: f, reason: `selector:${matchedGlobal}` });
      continue;
    }
    // viewport-specific
    const vpSelectors = vpMap[f.viewport] ?? [];
    let matchedVp: string | null = null;
    for (const ign of vpSelectors) {
      if (selectorMatches(ign, selectorsInFinding)) {
        matchedVp = ign;
        break;
      }
    }
    if (matchedVp) {
      suppressed.push({ finding: f, reason: `viewport:${f.viewport}:selector:${matchedVp}` });
      continue;
    }
    kept.push(f);
  }
  return { kept, suppressed };
}
