import type { PolicyOptions, PolicyDecision } from "./types.js";

export function evaluatePolicy(
  summary: { errors: number; warnings: number; total: number; infos: number },
  opts: PolicyOptions
): PolicyDecision {
  const failOn = opts.failOn ?? "error";
  const maxWarnings = opts.maxWarnings;
  let failed = false;
  let reason = "";

  if (failOn === "never") {
    // never fails, ignore max-warnings as well per spec --fail-on never means never fail
    failed = false;
    reason = "fail-on never — policy never fails";
  } else {
    // errors always trigger failure if failOn is error or warning
    if (summary.errors > 0) {
      failed = true;
      reason = `${summary.errors} error(s) with --fail-on ${failOn}`;
    } else if (maxWarnings !== undefined) {
      if (summary.warnings > maxWarnings) {
        failed = true;
        reason = `${summary.warnings} warning(s) exceeds --max-warnings ${maxWarnings}`;
      } else {
        // within maxWarnings
        if (failOn === "warning" && summary.warnings > 0) {
          // warnings within limit => pass when maxWarnings set
          failed = false;
          reason = `${summary.warnings} warning(s) within --max-warnings ${maxWarnings}`;
        } else {
          failed = false;
          reason = failOn === "error" ? "no errors and warnings within limit" : `${summary.warnings} warning(s) within limit, no errors`;
        }
      }
    } else {
      // no maxWarnings
      if (failOn === "warning" && summary.warnings > 0) {
        failed = true;
        reason = `${summary.warnings} warning(s) with --fail-on warning`;
      } else {
        failed = false;
        reason = failOn === "error" ? "no errors" : "no errors or warnings";
      }
    }
  }

  const exitCode = failed ? 2 : 0;
  return { failOn, maxWarnings, failed, reason, exitCode };
}
