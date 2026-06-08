import type { SkillAuditResult, SkillAuditVerdict, SkillCandidate, SkillConfig } from "./types.js";
import type { SkillBundle } from "./bundle.js";
import { extractCodeBlocks, loadSkillBundle } from "./bundle.js";
import type { SkillAuditFinding, SkillAuditSeverity, SkillAuditCategory } from "./auditRules.js";
import { ALL_AUDIT_RULES, runAuditRules } from "./auditRules.js";

export type { SkillAuditSeverity, SkillAuditCategory, SkillAuditFinding };

export interface DetailedSkillAuditResult extends SkillAuditResult {
  candidateKey: string;
  findings: SkillAuditFinding[];
  summary: string;
}

export interface SkillAuditInput {
  candidate: SkillCandidate;
  bundle: SkillBundle;
  config: SkillConfig;
  phase: string;
}

export interface SkillUseClient {
  use(source: string, skillName: string, workspace: string): Promise<{
    source: string;
    skillName: string;
    prompt: string;
    skillMarkdown?: string;
    supportDir?: string;
    rawOutput: string;
  }>;
}

export interface SkillAuditDb {
  logSkillAudit(
    sessionId: string,
    candidateId: string,
    audit: Pick<SkillAuditResult, "verdict" | "reasons">,
  ): string;
  selectSkill(sessionId: string, selection: {
    candidateId: string;
    status: "selected" | "skipped";
    attempt: number;
    phase: string;
    taskId?: string;
    rationale: string;
  }): string;
}

export interface AuditSelectedSkillInput {
  sessionId: string;
  workspace: string;
  phase: string;
  attempt: number;
  config: SkillConfig;
  selected: Array<{
    candidateId: string;
    candidate: SkillCandidate;
  }>;
}

export interface AuditSelectedSkillResult {
  passed: DetailedSkillAuditResult[];
  warned: DetailedSkillAuditResult[];
  failed: DetailedSkillAuditResult[];
}

function computeAuditVerdict(findings: SkillAuditFinding[]): SkillAuditVerdict {
  if (findings.some((f) => f.severity === "block")) return "fail";
  if (findings.some((f) => f.severity === "warn")) return "warn";
  return "pass";
}

function auditReasons(findings: SkillAuditFinding[]): string[] {
  return findings.map((f) => {
    const suffix = f.snippet ? ` (${f.location}: ${f.snippet})` : ` (${f.location})`;
    return `[${f.severity}] ${f.id}: ${f.message}${suffix}`;
  });
}

function summarizeAudit(verdict: SkillAuditVerdict, findings: SkillAuditFinding[]): string {
  const blocks = findings.filter((f) => f.severity === "block").length;
  const warns = findings.filter((f) => f.severity === "warn").length;
  if (verdict === "pass") return "No security issues found.";
  if (verdict === "fail") return `${blocks} blocking finding${blocks !== 1 ? "s" : ""}.`;
  return `${warns} warning${warns !== 1 ? "s" : ""} requiring review.`;
}

function sourceIsTrusted(candidate: SkillCandidate, config: SkillConfig): boolean {
  const owner = (candidate.packageRef.split("/")[0] ?? "").toLowerCase();
  const packageRef = candidate.packageRef.toLowerCase();
  return config.trustedSources.some((source) => {
    const normalized = source.toLowerCase();
    return owner === normalized || packageRef.startsWith(`${normalized}/`);
  });
}

function expectedDeploymentSkill(candidate: SkillCandidate): boolean {
  const text = `${candidate.packageRef} ${candidate.skillName} ${candidate.title} ${candidate.description}`.toLowerCase();
  return /\b(deploy|deployment|vercel|railway|fly)\b/.test(text);
}

function adjustFindingSeverity(
  finding: SkillAuditFinding,
  candidate: SkillCandidate,
  config: SkillConfig,
  fullText: string,
): SkillAuditFinding {
  if (finding.severity === "block") return finding;
  if (!sourceIsTrusted(candidate, config)) return finding;

  if (
    expectedDeploymentSkill(candidate) &&
    (finding.id === "network.post-upload" || finding.id === "git.push-or-release")
  ) {
    const hasApprovalBoundary = /ask (the )?user|explicit approval|never push without/i.test(fullText);
    const excludesEnv = /--exclude=['"]?\.env|exclude.*\.env/i.test(fullText);
    if (hasApprovalBoundary || excludesEnv) {
      return {
        ...finding,
        severity: "info",
        message: `${finding.message} Trusted deployment skill contains an explicit safety boundary.`,
      };
    }
  }

  if (finding.id === "dependency.global-install" && expectedDeploymentSkill(candidate)) {
    return {
      ...finding,
      severity: "info",
      message: `${finding.message} Trusted deployment skill uses a known deployment CLI.`,
    };
  }

  return finding;
}

function auditBundleStructure(bundle: SkillBundle): SkillAuditFinding[] {
  const findings: SkillAuditFinding[] = [];

  if (!bundle.frontmatter.description) {
    findings.push({
      id: "metadata.missing-description",
      category: "metadata",
      severity: "warn",
      message: "Skill is missing a description in frontmatter.",
      location: "SKILL.md:frontmatter",
    });
  }

  if (!bundle.frontmatter.name) {
    findings.push({
      id: "metadata.missing-name",
      category: "metadata",
      severity: "warn",
      message: "Skill is missing a name in frontmatter.",
      location: "SKILL.md:frontmatter",
    });
  }

  for (const file of bundle.supportFiles) {
    if (file.content === "SYMLINK_OR_PATH_ESCAPE") {
      findings.push({
        id: "support_file.path-escape",
        category: "support_file",
        severity: "block",
        message: "Support file is a symlink or path escape.",
        location: file.relativePath,
      });
    } else if (file.kind === "binary") {
      findings.push({
        id: "support_file.binary",
        category: "support_file",
        severity: "warn",
        message: "Support file is binary.",
        location: file.relativePath,
      });
    }
  }

  return findings;
}

export function auditSkillBundle(input: SkillAuditInput): DetailedSkillAuditResult {
  const targets: Array<{ location: string; text: string; appliesTo: "markdown" | "code" | "support" }> = [
    { location: "SKILL.md", text: input.bundle.skillMarkdown, appliesTo: "markdown" },
    ...extractCodeBlocks(input.bundle.skillMarkdown).map((block) => ({
      location: `SKILL.md:${block.startLine}:${block.language || "code"}`,
      text: block.content,
      appliesTo: "code" as const,
    })),
    ...input.bundle.supportFiles
      .filter((f) => f.content && f.content !== "SYMLINK_OR_PATH_ESCAPE")
      .map((f) => ({
        location: f.relativePath,
        text: f.content!,
        appliesTo: "support" as const,
      })),
  ];

  const rawFindings = targets.flatMap((target) =>
    runAuditRules(ALL_AUDIT_RULES, target.location, target.text, target.appliesTo),
  );

  const structuralFindings = auditBundleStructure(input.bundle);
  const fullText = targets.map((t) => t.text).join("\n\n");

  const findings = [...rawFindings, ...structuralFindings].map((f) =>
    adjustFindingSeverity(f, input.candidate, input.config, fullText),
  );

  const verdict = computeAuditVerdict(findings);

  return {
    verdict,
    reasons: auditReasons(findings),
    candidateKey: `${input.candidate.packageRef}@${input.candidate.skillName}`,
    findings,
    summary: summarizeAudit(verdict, findings),
  };
}

function extractSkillMarkdown(rawOutput: string): string {
  const match = rawOutput.match(/<SKILL\.md>([\s\S]*?)<\/SKILL\.md>/);
  return match ? match[1]!.trim() : rawOutput;
}

export async function auditSelectedSkills(
  input: AuditSelectedSkillInput,
  client: SkillUseClient,
  db: SkillAuditDb,
): Promise<AuditSelectedSkillResult> {
  const passed: DetailedSkillAuditResult[] = [];
  const warned: DetailedSkillAuditResult[] = [];
  const failed: DetailedSkillAuditResult[] = [];

  for (const item of input.selected) {
    let audit: DetailedSkillAuditResult;
    try {
      const useResult = await client.use(
        item.candidate.packageRef,
        item.candidate.skillName,
        input.workspace,
      );

      const skillMarkdown = useResult.skillMarkdown ?? extractSkillMarkdown(useResult.rawOutput);
      const bundle = loadSkillBundle({
        source: item.candidate.packageRef,
        skillName: item.candidate.skillName,
        skillMarkdown,
        supportDir: useResult.supportDir,
      });

      audit = auditSkillBundle({
        candidate: item.candidate,
        bundle,
        config: input.config,
        phase: input.phase,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      audit = {
        verdict: "fail",
        reasons: [`[block] fetch.error: Failed to fetch or parse skill bundle (${msg})`],
        candidateKey: `${item.candidate.packageRef}@${item.candidate.skillName}`,
        findings: [{
          id: "fetch.error",
          category: "network",
          severity: "block",
          message: `Failed to fetch or parse skill bundle: ${msg}`,
          location: "orchestrator",
        }],
        summary: "Skill bundle fetch failed.",
      };
    }

    db.logSkillAudit(input.sessionId, item.candidateId, {
      verdict: audit.verdict,
      reasons: audit.reasons,
    });

    if (audit.verdict === "pass") {
      passed.push(audit);
      continue;
    }

    db.selectSkill(input.sessionId, {
      candidateId: item.candidateId,
      status: "skipped",
      attempt: input.attempt,
      phase: input.phase,
      rationale: `audit ${audit.verdict}: ${audit.summary}`,
    });

    if (audit.verdict === "warn") warned.push(audit);
    else failed.push(audit);
  }

  return { passed, warned, failed };
}
