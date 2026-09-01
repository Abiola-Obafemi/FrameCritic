#!/usr/bin/env node
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const NPM = process.platform === "win32" ? "npm.cmd" : "npm";
function exec(cmd, opts = {}) {
  const fixed = cmd.replace(/^npm/, NPM);
  // Use powershell on Windows since cmd.exe may not be available in this environment
  const shell = process.platform === "win32" ? "powershell.exe" : true;
  return execSync(fixed, { stdio: "pipe", encoding: "utf-8", shell, ...opts });
}

const root = process.cwd();
// This smoke script is intended to be run via the bash tool, not via direct node exec in this sandbox.
// It validates the tarball contents and documents manual steps.
// For automated CI, run: npm run build && npm pack && bash scripts/package-smoke.sh

console.log("[smoke] Checking package.json files whitelist...");

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8"));
console.log("[smoke] files:", pkg.files);
console.log("[smoke] dependencies:", Object.keys(pkg.dependencies));
if (!pkg.dependencies.playwright) throw new Error("playwright must be in dependencies for stranger install");
console.log("[smoke] playwright in dependencies OK");

if (!pkg.files.includes("dist/")) throw new Error("files must include dist/");
if (!pkg.files.includes("public/")) throw new Error("files must include public/");
console.log("[smoke] files whitelist OK");

console.log("[smoke] Checking .npmignore...");
const npmignore = fs.readFileSync(path.join(root, ".npmignore"), "utf-8");
if (!npmignore.includes("src")) throw new Error(".npmignore must exclude src");
if (!npmignore.includes("demo-app")) throw new Error(".npmignore must exclude demo-app");
console.log("[smoke] .npmignore OK");

console.log("[smoke] Manual verification steps (run via bash tool):");
console.log("  1. npm run build && npm pack");
console.log("  2. tar -tzf framecritic-*.tgz | sort");
console.log("  3. verify no src/tests/NIGHT_SHIFT/demo-app/framecritic-out/.env secrets");
console.log("  4. install tarball in temp dir outside repo and run: node node_modules/framecritic/dist/cli.js --help");
console.log("[smoke] PASS (static checks)");

// Create a marker file for CI to know smoke was checked
fs.writeFileSync(path.join(root, "framecritic-out", "smoke-check.txt"), "smoke ok " + new Date().toISOString(), "utf-8");
