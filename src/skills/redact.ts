const SECRET_VALUE_PATTERNS: RegExp[] = [
  /\b[A-Z0-9_]*(API_KEY|TOKEN|SECRET|PASSWORD|PRIVATE_KEY)\s*=\s*["']?[^"'\s]+/gi,
  /sk-[A-Za-z0-9_-]{20,}/g,
  /ghp_[A-Za-z0-9_]{20,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

export function redactSnippet(value: string, maxLength = 180): string {
  let redacted = value;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    redacted = redacted.replace(pattern, "[REDACTED_SECRET]");
  }
  redacted = redacted.replace(/\s+/g, " ").trim();
  return redacted.length > maxLength ? `${redacted.slice(0, maxLength)}...` : redacted;
}
