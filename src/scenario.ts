import fs from "node:fs";
import path from "node:path";
import type { Page } from "playwright";
import type { Finding } from "./types.js";

export type ScenarioStep = {
  action: "click" | "fill" | "hover" | "press" | "wait" | "scroll" | "select" | "hotkey";
  selector?: string;
  value?: string;
  key?: string;
  ms?: number;
  x?: number;
  y?: number;
};

export type Scenario = {
  name: string;
  steps: ScenarioStep[];
};

const VALID_ACTIONS = new Set(["click", "fill", "hover", "press", "wait", "scroll", "select", "hotkey"]);
const MAX_JSON_BYTES = 256 * 1024;
const MAX_SELECTOR_LEN = 500;
const MAX_VALUE_LEN = 1000;

export function validateScenario(raw: unknown, sourcePath: string): Scenario {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Invalid scenario ${sourcePath}: root must be an object`);
  }
  const obj = raw as Record<string, unknown>;
  const name = obj.name;
  const steps = obj.steps;
  if (name !== undefined && (typeof name !== "string" || !name.trim())) {
    throw new Error(`Invalid scenario ${sourcePath}: "name" must be a non-empty string if present`);
  }
  if (!Array.isArray(steps)) {
    throw new Error(`Invalid scenario ${sourcePath}: "steps" must be an array`);
  }
  if (steps.length === 0) throw new Error(`Invalid scenario ${sourcePath}: "steps" must not be empty`);
  if (steps.length > 20) throw new Error(`Invalid scenario ${sourcePath}: "steps" cannot exceed 20`);
  const validated: ScenarioStep[] = [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (s === null || typeof s !== "object" || Array.isArray(s)) {
      throw new Error(`Invalid scenario ${sourcePath}: steps[${i}] must be an object`);
    }
    const step = s as Record<string, unknown>;
    const action = step.action;
    if (typeof action !== "string" || !VALID_ACTIONS.has(action)) {
      throw new Error(`Invalid scenario ${sourcePath}: steps[${i}].action must be one of ${Array.from(VALID_ACTIONS).join(", ")} (got "${String(action)}")`);
    }
    const allowedKeys = new Set(["action", "selector", "value", "key", "ms", "x", "y"]);
    for (const k of Object.keys(step)) {
      if (!allowedKeys.has(k)) {
        throw new Error(`Invalid scenario ${sourcePath}: steps[${i}] has unknown key "${k}"`);
      }
    }
    if (action === "click") {
      if (typeof step.selector !== "string" || !step.selector.trim()) throw new Error(`Invalid scenario ${sourcePath}: steps[${i}] click requires non-empty "selector"`);
      if (String(step.selector).trim().length > MAX_SELECTOR_LEN) throw new Error(`Invalid scenario ${sourcePath}: steps[${i}] click "selector" must be <=${MAX_SELECTOR_LEN} chars`);
      validated.push({ action: "click", selector: String(step.selector).trim() });
    } else if (action === "fill") {
      if (typeof step.selector !== "string" || !step.selector.trim()) throw new Error(`Invalid scenario ${sourcePath}: steps[${i}] fill requires "selector"`);
      if (String(step.selector).trim().length > MAX_SELECTOR_LEN) throw new Error(`Invalid scenario ${sourcePath}: steps[${i}] fill "selector" must be <=${MAX_SELECTOR_LEN} chars`);
      if (typeof step.value !== "string") throw new Error(`Invalid scenario ${sourcePath}: steps[${i}] fill requires "value" string`);
      if (String(step.value).length > MAX_VALUE_LEN) throw new Error(`Invalid scenario ${sourcePath}: steps[${i}] fill "value" must be <=${MAX_VALUE_LEN} chars`);
      validated.push({ action: "fill", selector: String(step.selector).trim(), value: String(step.value) });
    } else if (action === "hover") {
      if (typeof step.selector !== "string" || !step.selector.trim()) throw new Error(`Invalid scenario ${sourcePath}: steps[${i}] hover requires "selector"`);
      if (String(step.selector).trim().length > MAX_SELECTOR_LEN) throw new Error(`Invalid scenario ${sourcePath}: steps[${i}] hover "selector" must be <=${MAX_SELECTOR_LEN} chars`);
      validated.push({ action: "hover", selector: String(step.selector).trim() });
    } else if (action === "press") {
      if (typeof step.key !== "string" || !step.key.trim()) throw new Error(`Invalid scenario ${sourcePath}: steps[${i}] press requires "key" (e.g. Enter, Escape, ArrowDown)`);
      const sel = typeof step.selector === "string" && step.selector.trim() ? String(step.selector).trim() : undefined;
      if (sel && sel.length > MAX_SELECTOR_LEN) throw new Error(`Invalid scenario ${sourcePath}: steps[${i}] press "selector" must be <=${MAX_SELECTOR_LEN} chars`);
      validated.push({ action: "press", selector: sel, key: String(step.key).trim() });
    } else if (action === "wait") {
      if (step.ms === undefined || typeof step.ms !== "number" || !Number.isFinite(step.ms) || step.ms < 0 || step.ms > 5000) {
        throw new Error(`Invalid scenario ${sourcePath}: steps[${i}] wait requires "ms" number 0..5000`);
      }
      validated.push({ action: "wait", ms: Number(step.ms) });
    } else if (action === "scroll") {
      const hasSelector = typeof step.selector === "string" && step.selector.trim().length > 0;
      const hasX = step.x !== undefined;
      const hasY = step.y !== undefined;
      if (!hasSelector && !hasX && !hasY) throw new Error(`Invalid scenario ${sourcePath}: steps[${i}] scroll requires at least one of "selector", "x", "y"`);
      if (hasSelector && (typeof step.selector !== "string" || !String(step.selector).trim() || String(step.selector).length > 500)) {
        throw new Error(`Invalid scenario ${sourcePath}: steps[${i}] scroll "selector" must be a non-empty string <=500 chars`);
      }
      if (hasX) {
        if (typeof step.x !== "number" || !Number.isInteger(step.x) || step.x < 0 || step.x > 10000) throw new Error(`Invalid scenario ${sourcePath}: steps[${i}] scroll "x" must be integer 0..10000`);
      }
      if (hasY) {
        if (typeof step.y !== "number" || !Number.isInteger(step.y) || step.y < 0 || step.y > 10000) throw new Error(`Invalid scenario ${sourcePath}: steps[${i}] scroll "y" must be integer 0..10000`);
      }
      const out: any = { action: "scroll" };
      if (hasSelector) out.selector = String(step.selector).trim();
      if (hasX) out.x = Number(step.x);
      if (hasY) out.y = Number(step.y);
      validated.push(out);
    } else if (action === "select") {
      if (typeof step.selector !== "string" || !step.selector.trim()) throw new Error(`Invalid scenario ${sourcePath}: steps[${i}] select requires non-empty "selector"`);
      if (typeof step.value !== "string") throw new Error(`Invalid scenario ${sourcePath}: steps[${i}] select requires "value" string`);
      if (String(step.value).length > 1000) throw new Error(`Invalid scenario ${sourcePath}: steps[${i}] select "value" must be <=1000 chars`);
      if (String(step.selector).length > 500) throw new Error(`Invalid scenario ${sourcePath}: steps[${i}] select "selector" must be <=500 chars`);
      validated.push({ action: "select", selector: String(step.selector).trim(), value: String(step.value) });
    } else if (action === "hotkey") {
      if (typeof step.key !== "string" || !step.key.trim()) throw new Error(`Invalid scenario ${sourcePath}: steps[${i}] hotkey requires "key" (e.g. Control+A, Shift+Tab, Alt+F4, Enter)`);
      const rawKey = String(step.key).trim();
      if (rawKey.length > 100) throw new Error(`Invalid scenario ${sourcePath}: steps[${i}] hotkey "key" must be <=100 chars`);
      // validate hotkey format: optional modifiers + main key
      const parts = rawKey.split("+");
      const allowedModifiers = new Set(["Control", "Alt", "Shift", "Meta", "ControlOrMeta"]);
      const allowedNamedKeys = new Set(["Enter","Escape","Tab","Backspace","Delete","Space","ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Home","End","PageUp","PageDown","Insert","F1","F2","F3","F4","F5","F6","F7","F8","F9","F10","F11","F12"]);
      if (parts.length === 1) {
        const main = parts[0];
        // single key: either single alphanumeric or named
        if (!allowedNamedKeys.has(main) && !/^[A-Za-z0-9]$/.test(main) && !/^[A-Za-z]$/.test(main)) {
          // allow single letters, but also allow "a" etc - we allow any single alphanumeric
          if (main.length !== 1 || !/^[A-Za-z0-9]$/.test(main)) {
            throw new Error(`Invalid scenario ${sourcePath}: steps[${i}] hotkey "key" has invalid main key "${main}" (allowed: single alphanum or ${Array.from(allowedNamedKeys).join(", ")})`);
          }
        }
      } else {
        const main = parts[parts.length - 1];
        const mods = parts.slice(0, -1);
        for (const mod of mods) {
          if (!allowedModifiers.has(mod)) throw new Error(`Invalid scenario ${sourcePath}: steps[${i}] hotkey has unknown modifier "${mod}" (allowed: ${Array.from(allowedModifiers).join(", ")})`);
        }
        if (!allowedNamedKeys.has(main) && !/^[A-Za-z0-9]$/.test(main)) {
          if (main.length !== 1 || !/^[A-Za-z0-9]$/.test(main)) {
            throw new Error(`Invalid scenario ${sourcePath}: steps[${i}] hotkey main key "${main}" invalid (allowed: single alphanum or ${Array.from(allowedNamedKeys).join(", ")})`);
          }
        }
      }
      const sel = typeof step.selector === "string" && step.selector.trim() ? String(step.selector).trim() : undefined;
      if (sel && sel.length > 500) throw new Error(`Invalid scenario ${sourcePath}: steps[${i}] hotkey "selector" must be <=500 chars`);
      const out: any = { action: "hotkey", key: rawKey };
      if (sel) out.selector = sel;
      validated.push(out);
    }
  }
  return { name: (typeof name === "string" && name.trim() ? name.trim() : path.basename(sourcePath, path.extname(sourcePath))), steps: validated };
}

export function loadScenario(filePath: string): Scenario {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) throw new Error(`Scenario file not found: ${abs}`);
  try {
    const st = fs.statSync(abs);
    if (st.size > MAX_JSON_BYTES) throw new Error(`Scenario file ${abs} exceeds ${MAX_JSON_BYTES} bytes (got ${st.size}) — file too large`);
  } catch (e: any) {
    if (e.message.includes("exceeds")) throw e;
  }
  let rawText: string;
  try {
    rawText = fs.readFileSync(abs, "utf-8");
  } catch (e: any) {
    throw new Error(`Failed to read scenario ${abs}: ${e.message}`);
  }
  if (rawText.length > MAX_JSON_BYTES) throw new Error(`Scenario file ${abs} exceeds ${MAX_JSON_BYTES} bytes (got ${rawText.length}) — file too large`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (e: any) {
    throw new Error(`Invalid JSON in scenario ${abs}: ${e.message}`);
  }
  return validateScenario(parsed, abs);
}

export type ScenarioExecutionResult = {
  scenario: Scenario;
  failedStep?: { index: number; step: ScenarioStep; error: string };
};

export async function executeScenario(page: Page, scenario: Scenario): Promise<ScenarioExecutionResult & { findings: Finding[] }> {
  // This is called per viewport, so viewport will be set by caller after execution
  // We handle errors per step and produce findings for failures
  const findings: Finding[] = [];
  let failedStep: ScenarioExecutionResult["failedStep"] | undefined;
  for (let i = 0; i < scenario.steps.length; i++) {
    const step = scenario.steps[i];
    try {
      if (step.action === "click") {
        await page.click(step.selector!, { timeout: 3000 });
      } else if (step.action === "fill") {
        await page.fill(step.selector!, step.value ?? "", { timeout: 3000 });
      } else if (step.action === "hover") {
        await page.hover(step.selector!, { timeout: 3000 });
      } else if (step.action === "press") {
        if (step.selector) {
          await page.focus(step.selector).catch(() => {});
          // small delay to ensure focus
          await page.waitForTimeout(50);
        }
        await page.keyboard.press(step.key!);
      } else if (step.action === "wait") {
        await page.waitForTimeout(step.ms!);
      } else if (step.action === "scroll") {
        const sel = step.selector;
        if (sel) {
          // bounded scroll: try scrollIntoViewIfNeeded first, fallback to evaluate
          try {
            await page.locator(sel).scrollIntoViewIfNeeded({ timeout: 3000 });
          } catch {
            await page.evaluate((s) => { const el = document.querySelector(s); if (el) el.scrollIntoView({ block: "nearest" }); }, sel);
          }
        }
        if (typeof step.x === "number" || typeof step.y === "number") {
          const x = step.x ?? 0;
          const y = step.y ?? 0;
          // window scroll
          await page.evaluate(({ px, py }) => window.scrollTo(px, py), { px: x, py: y });
          // also scroll container if selector targets scrollable element
          if (sel) {
            await page.evaluate(({ s, px, py }) => {
              const el = document.querySelector(s) as HTMLElement | null;
              if (el) {
                if (typeof px === "number") el.scrollLeft = px;
                if (typeof py === "number") el.scrollTop = py;
              }
            }, { s: sel, px: step.x, py: step.y });
          }
        } else if (sel && step.x === undefined && step.y === undefined) {
          // if only selector and no coordinates, already scrolled into view
        }
      } else if (step.action === "select") {
        await page.selectOption(step.selector!, step.value!, { timeout: 3000 });
      } else if (step.action === "hotkey") {
        if (step.selector) {
          await page.focus(step.selector).catch(() => {});
          await page.waitForTimeout(50);
        }
        await page.keyboard.press(step.key!);
      }
      // small settle after each action
      await page.waitForTimeout(100);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      failedStep = { index: i, step, error: msg.slice(0, 500) };
      findings.push({
        type: "page-error",
        severity: "error",
        viewport: "", // filled by caller
        message: `Scenario "${scenario.name}" step ${i + 1} (${step.action}) failed: ${msg.slice(0, 300)}`,
        details: { scenario: scenario.name, stepIndex: i, step, error: msg.slice(0, 1000) },
      });
      break; // stop on first failure
    }
  }
  return { scenario, failedStep, findings };
}
