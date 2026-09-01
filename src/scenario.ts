import fs from "node:fs";
import path from "node:path";
import type { Page } from "playwright";
import type { Finding } from "./types.js";

export type ScenarioStep = {
  action: "click" | "fill" | "hover" | "press" | "wait";
  selector?: string;
  value?: string;
  key?: string;
  ms?: number;
};

export type Scenario = {
  name: string;
  steps: ScenarioStep[];
};

const VALID_ACTIONS = new Set(["click", "fill", "hover", "press", "wait"]);

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
    const allowedKeys = new Set(["action", "selector", "value", "key", "ms"]);
    for (const k of Object.keys(step)) {
      if (!allowedKeys.has(k)) {
        throw new Error(`Invalid scenario ${sourcePath}: steps[${i}] has unknown key "${k}"`);
      }
    }
    if (action === "click") {
      if (typeof step.selector !== "string" || !step.selector.trim()) throw new Error(`Invalid scenario ${sourcePath}: steps[${i}] click requires non-empty "selector"`);
      validated.push({ action: "click", selector: String(step.selector).trim() });
    } else if (action === "fill") {
      if (typeof step.selector !== "string" || !step.selector.trim()) throw new Error(`Invalid scenario ${sourcePath}: steps[${i}] fill requires "selector"`);
      if (typeof step.value !== "string") throw new Error(`Invalid scenario ${sourcePath}: steps[${i}] fill requires "value" string`);
      validated.push({ action: "fill", selector: String(step.selector).trim(), value: String(step.value) });
    } else if (action === "hover") {
      if (typeof step.selector !== "string" || !step.selector.trim()) throw new Error(`Invalid scenario ${sourcePath}: steps[${i}] hover requires "selector"`);
      validated.push({ action: "hover", selector: String(step.selector).trim() });
    } else if (action === "press") {
      if (typeof step.key !== "string" || !step.key.trim()) throw new Error(`Invalid scenario ${sourcePath}: steps[${i}] press requires "key" (e.g. Enter, Escape, ArrowDown)`);
      const sel = typeof step.selector === "string" && step.selector.trim() ? String(step.selector).trim() : undefined;
      validated.push({ action: "press", selector: sel, key: String(step.key).trim() });
    } else if (action === "wait") {
      if (step.ms === undefined || typeof step.ms !== "number" || !Number.isFinite(step.ms) || step.ms < 0 || step.ms > 5000) {
        throw new Error(`Invalid scenario ${sourcePath}: steps[${i}] wait requires "ms" number 0..5000`);
      }
      validated.push({ action: "wait", ms: Number(step.ms) });
    }
  }
  return { name: (typeof name === "string" && name.trim() ? name.trim() : path.basename(sourcePath, path.extname(sourcePath))), steps: validated };
}

export function loadScenario(filePath: string): Scenario {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) throw new Error(`Scenario file not found: ${abs}`);
  let rawText: string;
  try {
    rawText = fs.readFileSync(abs, "utf-8");
  } catch (e: any) {
    throw new Error(`Failed to read scenario ${abs}: ${e.message}`);
  }
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
