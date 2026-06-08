import { createHash } from "crypto";

export interface SkillFingerprintInput {
  moment: string;
  phase: string;
  query?: string;
  architecture?: string;
  taskTitles?: string[];
  failures?: string[];
}

/**
 * Normalize whitespace and case of a string for stable comparison.
 *
 * @param text - The input string to normalize
 * @returns The input converted to lowercase, consecutive whitespace collapsed to a single space, and trimmed of leading/trailing whitespace
 */
function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Normalize an architecture description into a concise canonical string.
 *
 * If `arch` is valid JSON, returns a JSON string containing only the
 * `stack`, `test_framework`, and `deploy_platforms` properties (in that object).
 * If `arch` is missing, returns an empty string. If `arch` is not valid JSON,
 * returns the input truncated to the first 500 characters and normalized
 * (lowercased, collapsed whitespace, trimmed).
 *
 * @param arch - Optional architecture description; may be a JSON string or free-form text
 * @returns A canonical representation of the architecture as described above
 */
function normalizeArchitecture(arch?: string): string {
  if (!arch) return "";
  try {
    const parsed = JSON.parse(arch) as Record<string, unknown>;
    const { stack, test_framework, deploy_platforms } = parsed;
    return JSON.stringify({ stack, test_framework, deploy_platforms });
  } catch {
    return normalizeText(arch.slice(0, 500));
  }
}

/**
 * Normalize an error or stack-trace message by removing variable details.
 *
 * Strips occurrences of `line <number>`, `col <number>`, or `column <number>`, replaces path-like segments with `"<path>"`, collapses consecutive whitespace, trims surrounding whitespace, and converts the result to lowercase.
 *
 * @param failure - The failure text to normalize
 * @returns The normalized failure string
 */
function normalizeFailure(failure: string): string {
  return normalizeText(
    failure
      .replace(/\b(line|col|column)\s*\d+\b/gi, "")
      .replace(/\/[^\s]+\/[^\s]+/g, "<path>"),
  );
}

/**
 * Produce a deterministic fingerprint for a skill input.
 *
 * @param input - Object containing the data to fingerprint (moment, phase, optional query, optional architecture, optional taskTitles, optional failures); each textual field is normalized before hashing.
 * @returns A 16-character hexadecimal string that identifies the normalized canonical representation of the input
 */
export function skillFingerprint(input: SkillFingerprintInput): string {
  const normalized = JSON.stringify({
    moment: input.moment,
    phase: input.phase,
    query: normalizeText(input.query ?? ""),
    architecture: normalizeArchitecture(input.architecture),
    taskTitles: (input.taskTitles ?? []).map(normalizeText).sort(),
    failures: (input.failures ?? []).map(normalizeFailure).sort(),
  });
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

/**
 * Produces a deterministic fingerprint for planning inputs by normalizing and hashing the combined idea/spec, architecture, task titles, and failures.
 *
 * @param input - Object containing planning input fields.
 * @param input.phase - The phase label for the fingerprint.
 * @param input.moment - The moment label for the fingerprint.
 * @param input.idea - Optional freeform idea text included in the fingerprint query.
 * @param input.spec - Optional spec that will be included in the query; if an object, it is serialized with `JSON.stringify`.
 * @param input.architecture - Optional architecture information; if an object, it is serialized with `JSON.stringify`.
 * @param input.tasks - Optional array of task objects; each task's `title` is used.
 * @param input.failures - Optional array of failure strings to include in the fingerprint.
 * @returns A 16-character hexadecimal fingerprint derived from the normalized planning input.
 */
export function fingerprintPlanningInput(input: {
  phase: string;
  moment: string;
  idea?: string;
  spec?: string | Record<string, unknown>;
  architecture?: string | Record<string, unknown>;
  tasks?: Array<{ title: string }>;
  failures?: string[];
}): string {
  return skillFingerprint({
    moment: input.moment,
    phase: input.phase,
    query: [
      input.idea ?? "",
      typeof input.spec === "string" ? input.spec : JSON.stringify(input.spec ?? ""),
    ]
      .join(" ")
      .slice(0, 500),
    architecture:
      typeof input.architecture === "string"
        ? input.architecture
        : JSON.stringify(input.architecture ?? ""),
    taskTitles: (input.tasks ?? []).map((t) => t.title),
    failures: input.failures ?? [],
  });
}

/**
 * Produce a deterministic fingerprint for post-verification failures.
 *
 * Normalizes the provided failure messages (and optional architecture) and computes a 16-character hexadecimal fingerprint that identifies this post-verification failure set.
 *
 * @param input.architecture - Optional architecture information included in the fingerprint
 * @param input.failures - Array of failure messages to include in the fingerprint
 * @returns A 16-hex-character string that uniquely represents the normalized failures (and optional architecture)
 */
export function fingerprintFailures(input: {
  architecture?: string;
  failures: string[];
}): string {
  return skillFingerprint({
    moment: "post-verification-failure",
    phase: "VERIFICATION",
    architecture: input.architecture,
    failures: input.failures,
  });
}
