export type SkillMode = "off" | "auto";

export type SkillInstallTarget = "forge" | "agents" | "claude";

export interface SkillConfig {
  mode: SkillMode;
  maxSkills: number;
  promptCharBudget: number;
  minInstallCount: number;
  trustedSources: string[];
  installTargets: SkillInstallTarget[];
}

export interface SkillCandidate {
  packageRef: string;
  skillName: string;
  title?: string;
  description?: string;
  url?: string;
  installCount?: number;
  score?: number;
  raw?: unknown;
}

export type SkillAuditVerdict = "pass" | "warn" | "fail";

export interface SkillAuditResult {
  verdict: SkillAuditVerdict;
  reasons: string[];
}

export type SkillSelectionStatus = "selected" | "skipped" | "installed" | "failed";

export interface SkillSelection {
  candidateId: string;
  status: SkillSelectionStatus;
  phase: string;
  attempt: number;
  taskId?: string;
  rationale: string;
}

export interface SkillInstallRecord {
  selectionId: string;
  attempt: number;
  target: SkillInstallTarget;
  installPath: string;
  status: "installed" | "failed";
  error?: string;
}

export interface SkillInjectionRecord {
  selectionId: string;
  attempt: number;
  agentName: string;
  taskId?: string;
  contextKind: "compact" | "full";
  charCount: number;
}
