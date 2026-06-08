import { createHash } from "crypto";

export interface SkillFingerprintInput {
  moment: string;
  phase: string;
  query?: string;
  architecture?: string;
  taskTitles?: string[];
  failures?: string[];
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

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

function normalizeFailure(failure: string): string {
  return normalizeText(
    failure
      .replace(/\b(line|col|column)\s*\d+\b/gi, "")
      .replace(/\/[^\s]+\/[^\s]+/g, "<path>"),
  );
}

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
