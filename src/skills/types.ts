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

export type SkillContextKind = "compact" | "full";

export type SkillContextMode =
  | "native-tool-loop"
  | "one-shot"
  | "codex-cli"
  | "claude-code";

export interface SkillContextRequest {
  workspace: string;
  agentName: string;
  taskId?: string;
  attempt: number;
  mode: SkillContextMode;
  maxChars: number;
  selectionIdsBySourceKey: Record<string, string>;
  relevantSourceKeys?: string[];
}

export interface CompactSkillContextEntry {
  sourceKey: string;
  selectionId: string;
  packageRef: string;
  skillName: string;
  displayName: string;
  description: string;
  forgePath: string;
  agentsPath?: string;
  claudePath?: string;
}

export interface SkillReadRequest {
  sourceKey: string;
  file?: string;
  maxChars?: number;
}

export interface SkillReadResult {
  sourceKey: string;
  relativePath: string;
  content: string;
  charCount: number;
  truncated: boolean;
}

export interface RenderedSkillContext {
  kind: SkillContextKind;
  content: string;
  charCount: number;
  sourceKeys: string[];
  truncated: boolean;
}
