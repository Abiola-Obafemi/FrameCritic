import fs from "node:fs";
import path from "node:path";
import { redactUrl } from "./security.js";

export type RouteEntry = {
  name: string;
  path: string;
  scenario?: string;
};

export type RoutesManifest = {
  routes: RouteEntry[];
};

const MAX_ROUTES = 20;

function isSafeName(name: string): boolean {
  // alphanumeric, dash, underscore, dot allowed, no traversal
  return /^[a-zA-Z0-9._-]{1,64}$/.test(name);
}

export function validateRoutesManifest(raw: unknown, sourcePath: string): RouteEntry[] {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Invalid routes manifest ${sourcePath}: root must be an object with "routes" array`);
  }
  const obj = raw as Record<string, unknown>;
  const routes = obj.routes;
  if (!Array.isArray(routes)) {
    throw new Error(`Invalid routes manifest ${sourcePath}: "routes" must be an array`);
  }
  if (routes.length === 0) throw new Error(`Invalid routes manifest ${sourcePath}: "routes" must not be empty`);
  if (routes.length > MAX_ROUTES) throw new Error(`Invalid routes manifest ${sourcePath}: "routes" cannot exceed ${MAX_ROUTES} (got ${routes.length})`);
  const validated: RouteEntry[] = [];
  const seenNames = new Set<string>();
  for (let i = 0; i < routes.length; i++) {
    const r = routes[i];
    if (r === null || typeof r !== "object" || Array.isArray(r)) {
      throw new Error(`Invalid routes manifest ${sourcePath}: routes[${i}] must be an object`);
    }
    const entry = r as Record<string, unknown>;
    const allowedKeys = new Set(["name", "path", "scenario"]);
    for (const k of Object.keys(entry)) {
      if (!allowedKeys.has(k)) throw new Error(`Invalid routes manifest ${sourcePath}: routes[${i}] has unknown key "${k}" (allowed: name, path, scenario)`);
    }
    const name = entry.name;
    const p = entry.path;
    const scenario = entry.scenario;
    if (typeof name !== "string" || !name.trim()) throw new Error(`Invalid routes manifest ${sourcePath}: routes[${i}].name must be a non-empty string`);
    const trimmedName = name.trim();
    if (!isSafeName(trimmedName)) throw new Error(`Invalid routes manifest ${sourcePath}: routes[${i}].name "${trimmedName}" must match [a-zA-Z0-9._-] 1..64 and not contain path separators`);
    if (seenNames.has(trimmedName)) throw new Error(`Invalid routes manifest ${sourcePath}: duplicate route name "${trimmedName}"`);
    seenNames.add(trimmedName);
    if (typeof p !== "string" || !p.trim()) throw new Error(`Invalid routes manifest ${sourcePath}: routes[${i}].path must be a non-empty string`);
    const trimmedPath = p.trim();
    if (trimmedPath.length > 500) throw new Error(`Invalid routes manifest ${sourcePath}: routes[${i}].path must be <=500 chars`);
    if (trimmedPath.includes("\0") || trimmedPath.includes("\\")) throw new Error(`Invalid routes manifest ${sourcePath}: routes[${i}].path contains invalid characters`);
    // Check unsupported protocol if it looks like absolute URL
    if (trimmedPath.includes("://")) {
      try {
        const u = new URL(trimmedPath);
        if (!["http:", "https:"].includes(u.protocol)) throw new Error(`unsupported`);
      } catch (e: any) {
        if (e.message === "unsupported") throw new Error(`Invalid routes manifest ${sourcePath}: routes[${i}].path has unsupported protocol "${trimmedPath}" (only http/https allowed)`);
        throw new Error(`Invalid routes manifest ${sourcePath}: routes[${i}].path is malformed URL "${trimmedPath}": ${e.message}`);
      }
    }
    if (scenario !== undefined) {
      if (typeof scenario !== "string" || !scenario.trim()) throw new Error(`Invalid routes manifest ${sourcePath}: routes[${i}].scenario must be a non-empty string if present`);
      if (scenario.trim().length > 500) throw new Error(`Invalid routes manifest ${sourcePath}: routes[${i}].scenario must be <=500 chars`);
      if (scenario.trim().includes("\0")) throw new Error(`Invalid routes manifest ${sourcePath}: routes[${i}].scenario contains null byte`);
      // scenario existence will be validated at scan time via loadScenario, but we can check file existence here optionally
      // we don't throw here for missing file to allow batch scan to report per-route error instead of manifest validation failure
    }
    const out: RouteEntry = { name: trimmedName, path: trimmedPath };
    if (typeof scenario === "string" && scenario.trim()) out.scenario = scenario.trim();
    validated.push(out);
  }
  return validated;
}

export function loadRoutesManifest(filePath: string): RouteEntry[] {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) throw new Error(`Routes manifest not found: ${abs}`);
  let rawText: string;
  try { rawText = fs.readFileSync(abs, "utf-8"); } catch (e: any) { throw new Error(`Failed to read routes manifest ${abs}: ${e.message}`); }
  let parsed: unknown;
  try { parsed = JSON.parse(rawText); } catch (e: any) { throw new Error(`Invalid JSON in routes manifest ${abs}: ${e.message}`); }
  return validateRoutesManifest(parsed, abs);
}

export function resolveRouteUrl(baseUrl: string, routePath: string): string {
  const redactedBase = redactUrl(baseUrl);
  const redactedPath = redactUrl(routePath);
  // baseUrl must be already normalized valid http(s)
  try {
    const base = new URL(baseUrl);
    if (!["http:", "https:"].includes(base.protocol)) throw new Error(`Unsupported protocol ${base.protocol}`);
  } catch (e: any) {
    throw new Error(`Invalid base URL "${redactedBase}": ${e.message}`);
  }
  // If routePath is absolute URL with protocol, validate protocol and return redacted? But we return full URL
  if (routePath.includes("://")) {
    try {
      const u = new URL(routePath);
      if (!["http:", "https:"].includes(u.protocol)) throw new Error(`Unsupported protocol ${u.protocol}`);
      return redactUrl(u.toString());
    } catch (e: any) {
      throw new Error(`Invalid route path URL "${redactedPath}": ${e.message}`);
    }
  }
  // Relative path: resolve against base
  try {
    const resolved = new URL(routePath, baseUrl).toString();
    // redact after resolve? but we keep full for scanning but redact for artifacts
    return redactUrl(resolved);
  } catch (e: any) {
    throw new Error(`Failed to resolve route path "${redactedPath}" against base "${redactedBase}": ${e.message}`);
  }
}

export function sanitizeRouteName(name: string): string {
  // already validated isSafeName, but sanitize for filesystem
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}
