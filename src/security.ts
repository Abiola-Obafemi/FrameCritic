export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.username || u.password) {
      u.username = "***";
      u.password = "***";
    }
    // redact common credential query params
    const redactKeys = ["token", "key", "secret", "password", "auth", "access_token", "api_key"];
    for (const k of redactKeys) {
      if (u.searchParams.has(k)) u.searchParams.set(k, "***");
    }
    return u.toString();
  } catch {
    // fallback: simple regex for user:pass@
    return url.replace(/\/\/[^@\/]+:[^@\/]+@/, "//***:***@").replace(/([?&](token|key|secret|password|auth|access_token|api_key)=)[^&]*/gi, "$1***");
  }
}

export function safeOutputPath(base: string, rel: string): string {
  // Prevent path traversal
  const normalized = rel.replace(/\\/g, "/");
  if (normalized.includes("..") || normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) {
    throw new Error(`Unsafe output path: ${rel}`);
  }
  return normalized;
}

export function isSensitiveHeader(name: string): boolean {
  const lower = name.toLowerCase();
  return ["authorization", "cookie", "set-cookie", "x-api-key", "x-auth-token"].includes(lower);
}

export function redactSecrets(text: string): string {
  // Redact credentials embedded anywhere in text, not just isolated URLs
  // Handles user:pass@ and sensitive query params inside longer strings
  return text
    .replace(/\/\/[^@\/\s]+:[^@\/\s]+@/g, "//***:***@")
    .replace(/([?&](token|key|secret|password|auth|access_token|api_key)=)[^&\s"'`]+/gi, "$1***");
}
