import * as fs from "node:fs";
import * as path from "node:path";
import type { ForgeDb } from "../db.js";
import type { SkillCandidate, SkillConfig, SkillContextMode } from "./types.js";
import type { CompactSkillContextEntry } from "./types.js";
import { SkillContextProvider } from "./context.js";
import { SkillContextRuntime } from "./toolExecutor.js";
import { discoverSkillCandidates, type SkillSearchClient } from "./discovery.js";
import { auditSelectedSkills, type SkillUseClient } from "./audit.js";
import {
  ensureSkillsInstalledForWorkspace,
  skillInstallKey,
  type AuditedSkillForInstall,
  type SkillInstallClient,
} from "./install.js";
import { readForgeManifest } from "./inventory.js";
import { parseSkillMarkdown } from "./bundle.js";
import { fingerprintPlanningInput, fingerprintFailures } from "./fingerprints.js";
import { selectRelevantSourceKeys } from "./relevance.js";
import type { ExternalAgentId } from "../externalAgents.js";

// --- Moment / preparation types ---

export type SkillPipelineMoment =
  | "pre-architecture"
  | "post-architecture"
  | "pre-task-graph"
  | "pre-coding-phase"
  | "pre-coding-task"
  | "pre-integration"
  | "pre-testing"
  | "pre-verification"
  | "post-verification-failure"
  | "pre-deploy";

export interface SkillAgentPreparation {
  moment: SkillPipelineMoment;
  enabled: boolean;
  reason: string;
  relevantSourceKeys: string[];
  skillContext?: SkillContextRuntime;
}

// --- Gate input types ---

export interface ArchitectureSkillInput {
  spec: string;
}

export interface TaskGraphSkillInput {
  spec: string;
  architecture: string;
}

export interface CodingPhaseSkillInput {
  spec: string;
  architecture: string;
  pendingTasks: Array<{ id: string; title: string; type?: string }>;
  cycle: number;
}

export interface CodingTaskSkillInput {
  spec: string;
  architecture: string;
  task: { id: string; title: string; type?: string };
  workspace: string;
  cycle: number;
  externalAgent: ExternalAgentId | undefined;
}

export interface WorkspaceSkillInput {
  spec?: string;
  architecture: string;
  workspace: string;
  cycle: number;
}

export interface VerificationFailureSkillInput {
  spec: string;
  architecture: string;
  failures: string[];
  errors: string[];
  cycle: number;
}

export interface DeploySkillInput {
  architecture: string;
  workspace: string;
  target: string;
  externalAgent: ExternalAgentId | undefined;
}

// --- Coordinator dependencies ---

export interface SkillPipelineDeps {
  sessionId: string;
  idea: string;
  workspace: string;
  config: SkillConfig;
  db: ForgeDb;
  searchClient: SkillSearchClient;
  useClient: SkillUseClient;
  installClient: SkillInstallClient;
  contextProvider: SkillContextProvider;
  externalAgent?: ExternalAgentId;
  emit?: (message: string) => void;
}

// --- Helpers ---

const disabled = (moment: SkillPipelineMoment, reason = "skills disabled"): SkillAgentPreparation => ({
  moment,
  enabled: false,
  reason,
  relevantSourceKeys: [],
});

// --- No-op coordinator ---

export class NoopSkillPipelineCoordinator {
  async prepareForArchitecture(_input?: ArchitectureSkillInput): Promise<SkillAgentPreparation> {
    return disabled("pre-architecture");
  }

  async prepareForTaskGraph(_input?: TaskGraphSkillInput): Promise<SkillAgentPreparation> {
    return disabled("pre-task-graph");
  }

  async prepareForCodingPhase(_input?: CodingPhaseSkillInput): Promise<void> {}

  async prepareForCodingTask(_input?: CodingTaskSkillInput): Promise<SkillAgentPreparation> {
    return disabled("pre-coding-task");
  }

  async prepareForIntegration(_input?: WorkspaceSkillInput): Promise<SkillAgentPreparation> {
    return disabled("pre-integration");
  }

  async prepareForTesting(_input?: WorkspaceSkillInput): Promise<SkillAgentPreparation> {
    return disabled("pre-testing");
  }

  async prepareForVerification(_input?: WorkspaceSkillInput): Promise<SkillAgentPreparation> {
    return disabled("pre-verification");
  }

  async prepareForVerificationFailure(_input?: VerificationFailureSkillInput): Promise<void> {}

  async prepareForDeploy(_input?: DeploySkillInput): Promise<SkillAgentPreparation> {
    return disabled("pre-deploy");
  }
}

// --- Live coordinator ---

export class SkillPipelineCoordinator {
  private satisfiedFingerprints = new Map<string, AuditedSkillForInstall[]>();
  private installedSourceKeys = new Set<string>();

  constructor(private readonly deps: SkillPipelineDeps) {}

  async prepareForArchitecture(input: ArchitectureSkillInput): Promise<SkillAgentPreparation> {
    if (!this.isEnabled()) return disabled("pre-architecture");

    await this.discoverAuditInstall({
      moment: "pre-architecture",
      phase: "ARCHITECTURE",
      workspace: this.deps.workspace,
      planning: { idea: this.deps.idea, spec: input.spec },
      maxQueries: 2,
      maxSkills: 1,
      attempt: 1,
    });

    const installed = this.readInstalledCompact(this.deps.workspace);
    const relevantSourceKeys = selectRelevantSourceKeys({
      moment: "pre-architecture",
      agentName: "ArchitectureAgent",
      installed,
      text: `${this.deps.idea}\n${input.spec}`,
      limit: 1,
    });

    return this.prepareContext({
      moment: "pre-architecture",
      agentName: "ArchitectureAgent",
      workspace: this.deps.workspace,
      mode: "one-shot",
      relevantSourceKeys,
      promptCharBudget: Math.min(this.deps.config.promptCharBudget, 3_000),
    });
  }

  async prepareForTaskGraph(_input: TaskGraphSkillInput): Promise<SkillAgentPreparation> {
    return disabled("pre-task-graph", "task graph receives no skill context in v1");
  }

  async prepareForCodingPhase(input: CodingPhaseSkillInput): Promise<void> {
    if (!this.isEnabled()) return;
    const attempt = input.cycle + 1;

    await this.discoverAuditInstall({
      moment: "pre-coding-phase",
      phase: "CODING",
      workspace: this.deps.workspace,
      planning: {
        spec: input.spec,
        architecture: input.architecture,
        tasks: input.pendingTasks,
      },
      maxQueries: 4,
      maxSkills: this.remainingSkillSlots(),
      attempt,
    });
  }

  async prepareForCodingTask(input: CodingTaskSkillInput): Promise<SkillAgentPreparation> {
    if (!this.isEnabled()) return disabled("pre-coding-task");

    const installed = this.readInstalledCompact(input.workspace !== this.deps.workspace
      ? this.deps.workspace
      : input.workspace);
    const relevantSourceKeys = selectRelevantSourceKeys({
      moment: "pre-coding-task",
      agentName: "CodingAgent",
      installed,
      taskTitle: input.task.title,
      architecture: input.architecture,
      spec: input.spec,
      limit: 3,
    });

    const relevantSkills = this.auditedSkillsForSourceKeys(relevantSourceKeys);
    if (input.externalAgent && relevantSkills.length) {
      await ensureSkillsInstalledForWorkspace(
        input.workspace,
        relevantSkills,
        this.deps.config,
        input.cycle + 1,
        this.deps.installClient,
        this.deps.db,
        this.deps.sessionId,
      );
    }

    const mode: SkillContextMode =
      input.externalAgent === "codex"
        ? "codex-cli"
        : input.externalAgent === "claude-code"
          ? "claude-code"
          : "native-tool-loop";

    return this.prepareContext({
      moment: "pre-coding-task",
      agentName: "CodingAgent",
      workspace: input.workspace,
      taskId: input.task.id,
      mode,
      relevantSourceKeys,
    });
  }

  async prepareForIntegration(input: WorkspaceSkillInput): Promise<SkillAgentPreparation> {
    if (!this.isEnabled()) return disabled("pre-integration");

    const installed = this.readInstalledCompact(input.workspace);
    const relevantSourceKeys = selectRelevantSourceKeys({
      moment: "pre-integration",
      agentName: "IntegrationAgent",
      installed,
      architecture: input.architecture,
      spec: input.spec,
      limit: 3,
    });

    return this.prepareContext({
      moment: "pre-integration",
      agentName: "IntegrationAgent",
      workspace: input.workspace,
      mode: this.modeForReasoningAgent(),
      relevantSourceKeys,
    });
  }

  async prepareForTesting(input: WorkspaceSkillInput): Promise<SkillAgentPreparation> {
    if (!this.isEnabled()) return disabled("pre-testing");

    const installed = this.readInstalledCompact(input.workspace);
    const relevantSourceKeys = selectRelevantSourceKeys({
      moment: "pre-testing",
      agentName: "TestAgent",
      installed,
      architecture: input.architecture,
      limit: 2,
    });

    return this.prepareContext({
      moment: "pre-testing",
      agentName: "TestAgent",
      workspace: input.workspace,
      mode: this.modeForReasoningAgent(),
      relevantSourceKeys,
    });
  }

  async prepareForVerification(input: WorkspaceSkillInput): Promise<SkillAgentPreparation> {
    if (!this.isEnabled()) return disabled("pre-verification");

    const installed = this.readInstalledCompact(input.workspace);
    const relevantSourceKeys = selectRelevantSourceKeys({
      moment: "pre-verification",
      agentName: "VerificationAgent",
      installed,
      architecture: input.architecture,
      spec: input.spec,
      limit: 2,
    });

    return this.prepareContext({
      moment: "pre-verification",
      agentName: "VerificationAgent",
      workspace: input.workspace,
      mode: this.modeForReasoningAgent(),
      relevantSourceKeys,
    });
  }

  async prepareForVerificationFailure(input: VerificationFailureSkillInput): Promise<void> {
    if (!this.isEnabled()) return;

    const failures = [...input.failures, ...input.errors].filter(Boolean);
    if (!failures.length) return;

    const fingerprint = fingerprintFailures({ architecture: input.architecture, failures });
    if (this.satisfiedFingerprints.has(fingerprint)) {
      this.deps.emit?.("Skills: reused failure-specific skills");
      return;
    }

    await this.discoverAuditInstall({
      moment: "post-verification-failure",
      phase: "VERIFICATION",
      workspace: this.deps.workspace,
      planning: { spec: input.spec, architecture: input.architecture, failures },
      maxQueries: 3,
      maxSkills: this.remainingSkillSlots(),
      attempt: input.cycle + 1,
    });
  }

  async prepareForDeploy(input: DeploySkillInput): Promise<SkillAgentPreparation> {
    if (!this.isEnabled()) return disabled("pre-deploy");

    const installed = this.readInstalledCompact(input.workspace);
    const relevantSourceKeys = selectRelevantSourceKeys({
      moment: "pre-deploy",
      agentName: "DeployAgent",
      installed,
      architecture: input.architecture,
      text: `deploy ${input.target}`,
      limit: 1,
    });

    const mode: SkillContextMode =
      input.externalAgent === "codex"
        ? "codex-cli"
        : input.externalAgent === "claude-code"
          ? "claude-code"
          : "native-tool-loop";

    return this.prepareContext({
      moment: "pre-deploy",
      agentName: "DeployAgent",
      workspace: input.workspace,
      mode,
      relevantSourceKeys,
    });
  }

  // --- Private helpers ---

  private isEnabled(): boolean {
    return this.deps.config.mode === "auto" && this.deps.config.maxSkills > 0;
  }

  private remainingSkillSlots(): number {
    return Math.max(0, this.deps.config.maxSkills - this.installedSourceKeys.size);
  }

  private modeForReasoningAgent(): SkillContextMode {
    if (this.deps.externalAgent === "codex") return "codex-cli";
    if (this.deps.externalAgent === "claude-code") return "claude-code";
    return "native-tool-loop";
  }

  private readInstalledCompact(workspace: string): CompactSkillContextEntry[] {
    const root = path.join(workspace, ".forge", "skills");
    if (!fs.existsSync(root)) return [];
    const result: CompactSkillContextEntry[] = [];
    let entries: string[];
    try {
      entries = fs.readdirSync(root);
    } catch {
      return [];
    }
    for (const dirName of entries) {
      const dir = path.join(root, dirName);
      try {
        if (!fs.statSync(dir).isDirectory()) continue;
      } catch {
        continue;
      }
      const manifest = readForgeManifest(path.join(dir, "forge-skill.json"));
      if (!manifest) continue;
      const skillFile = path.join(dir, "SKILL.md");
      if (!fs.existsSync(skillFile)) continue;
      let parsed: ReturnType<typeof parseSkillMarkdown>;
      try {
        parsed = parseSkillMarkdown(fs.readFileSync(skillFile, "utf8"));
      } catch {
        continue;
      }
      result.push({
        sourceKey: dirName,
        selectionId: manifest.selectionId,
        packageRef: manifest.packageRef,
        skillName: manifest.skillName,
        displayName: parsed.frontmatter.name ?? manifest.skillName,
        description: parsed.frontmatter.description ?? "",
        forgePath: path.relative(workspace, dir),
        agentsPath: manifest.externalPaths["agents"],
        claudePath: manifest.externalPaths["claude"],
      });
    }
    return result;
  }

  private auditedSkillsForSourceKeys(sourceKeys: string[]): AuditedSkillForInstall[] {
    if (!sourceKeys.length) return [];
    const installed = this.readInstalledCompact(this.deps.workspace);
    const result: AuditedSkillForInstall[] = [];
    for (const entry of installed) {
      if (!sourceKeys.includes(entry.sourceKey)) continue;
      result.push({
        selectionId: entry.selectionId,
        candidateId: entry.selectionId,
        candidate: {
          packageRef: entry.packageRef,
          skillName: entry.skillName,
        },
        auditVerdict: "pass" as const,
        auditReasons: [],
      });
    }
    return result;
  }

  private prepareContext(input: {
    moment: SkillPipelineMoment;
    agentName: string;
    workspace: string;
    taskId?: string;
    mode: SkillContextMode;
    relevantSourceKeys: string[];
    promptCharBudget?: number;
  }): SkillAgentPreparation {
    if (!input.relevantSourceKeys.length) {
      return disabled(input.moment, "no relevant installed skills");
    }

    const installed = this.readInstalledCompact(input.workspace);
    const selectionIdsBySourceKey: Record<string, string> = {};
    for (const entry of installed) {
      if (input.relevantSourceKeys.includes(entry.sourceKey)) {
        selectionIdsBySourceKey[entry.sourceKey] = entry.selectionId;
      }
    }

    if (!Object.keys(selectionIdsBySourceKey).length) {
      return disabled(input.moment, "no relevant installed skills");
    }

    const skillContext = new SkillContextRuntime(this.deps.contextProvider, {
      workspace: input.workspace,
      agentName: input.agentName,
      taskId: input.taskId,
      attempt: 1,
      mode: input.mode,
      maxChars: input.promptCharBudget ?? this.deps.config.promptCharBudget,
      selectionIdsBySourceKey,
      relevantSourceKeys: input.relevantSourceKeys,
    });

    this.deps.emit?.(
      `Skills: injecting ${input.relevantSourceKeys.length} into ${input.agentName}`,
    );

    return {
      moment: input.moment,
      enabled: true,
      reason: "relevant installed skills available",
      relevantSourceKeys: input.relevantSourceKeys,
      skillContext,
    };
  }

  private async discoverAuditInstall(input: {
    moment: SkillPipelineMoment;
    phase: string;
    workspace: string;
    planning: {
      idea?: string;
      spec?: string | Record<string, unknown>;
      architecture?: string | Record<string, unknown>;
      tasks?: Array<{ id?: string; title: string; type?: string }>;
      failures?: string[];
    };
    maxQueries: number;
    maxSkills: number;
    attempt: number;
  }): Promise<AuditedSkillForInstall[]> {
    if (!this.isEnabled()) return [];
    if (this.remainingSkillSlots() <= 0) return [];

    const queryFingerprint = fingerprintPlanningInput({
      phase: input.phase,
      moment: input.moment,
      ...input.planning,
    });

    if (this.satisfiedFingerprints.has(queryFingerprint)) {
      this.deps.emit?.(`Skills: reused prior ${input.moment} selection`);
      return this.satisfiedFingerprints.get(queryFingerprint) ?? [];
    }

    const discoveryInput = {
      sessionId: this.deps.sessionId,
      workspace: input.workspace,
      config: {
        ...this.deps.config,
        maxSkills: Math.min(this.deps.config.maxSkills, input.maxSkills),
      },
      phase: input.phase,
      attempt: input.attempt,
      maxQueries: input.maxQueries,
      ...input.planning,
    };

    let discovered: Awaited<ReturnType<typeof discoverSkillCandidates>>;
    try {
      discovered = await discoverSkillCandidates(discoveryInput, this.deps.searchClient, this.deps.db);
    } catch {
      return [];
    }

    this.emitDiscoverySummary(input.moment, discovered.selected, discovered.ranked);

    if (!discovered.selected.length) {
      this.satisfiedFingerprints.set(queryFingerprint, []);
      return [];
    }

    // Build candidateKey -> {candidateId, candidate} map
    const candidateMap = new Map<string, { candidateId: string; candidate: SkillCandidate }>();
    for (const item of discovered.selected) {
      if (item.candidateId) {
        candidateMap.set(skillInstallKey(item.candidate), {
          candidateId: item.candidateId,
          candidate: item.candidate,
        });
      }
    }

    // Get selectionIds from DB (set by discoverSkillCandidates -> db.selectSkill)
    const allSelections = this.deps.db.getSkillSelections(this.deps.sessionId) as Array<
      Record<string, unknown>
    >;
    const selectionMap = new Map<string, string>(); // candidateId -> selectionId
    for (const row of allSelections) {
      if (row["status"] === "selected" && row["candidate_id"] != null) {
        selectionMap.set(String(row["candidate_id"]), String(row["id"]));
      }
    }

    const auditInput = {
      sessionId: this.deps.sessionId,
      workspace: input.workspace,
      phase: input.phase,
      attempt: input.attempt,
      config: this.deps.config,
      selected: discovered.selected
        .filter((item) => item.candidateId)
        .map((item) => ({ candidateId: item.candidateId!, candidate: item.candidate })),
    };

    let audited: Awaited<ReturnType<typeof auditSelectedSkills>>;
    try {
      audited = await auditSelectedSkills(auditInput, this.deps.useClient, this.deps.db);
    } catch {
      this.satisfiedFingerprints.set(queryFingerprint, []);
      return [];
    }

    this.emitAuditSummary(input.moment, audited.passed.length, audited.failed.length);

    const passed: AuditedSkillForInstall[] = audited.passed
      .map((auditResult) => {
        const orig = candidateMap.get(auditResult.candidateKey);
        const selectionId = orig ? (selectionMap.get(orig.candidateId) ?? "") : "";
        return {
          selectionId,
          candidateId: orig?.candidateId ?? "",
          candidate: orig?.candidate ?? ({ packageRef: "", skillName: "" } as SkillCandidate),
          auditVerdict: "pass" as const,
          auditReasons: auditResult.reasons,
        };
      })
      .filter((s) => s.selectionId && s.candidateId);

    if (!passed.length) {
      this.satisfiedFingerprints.set(queryFingerprint, []);
      return [];
    }

    try {
      const installResults = await ensureSkillsInstalledForWorkspace(
        input.workspace,
        passed,
        this.deps.config,
        input.attempt,
        this.deps.installClient,
        this.deps.db,
        this.deps.sessionId,
      );
      const installedKeys = new Set(
        installResults.filter((r) => r.status === "installed").map((r) => r.candidateKey),
      );
      for (const skill of passed) {
        if (installedKeys.has(skillInstallKey(skill.candidate))) {
          this.installedSourceKeys.add(skillInstallKey(skill.candidate));
        }
      }
    } catch {
      // install errors are non-fatal
    }

    this.satisfiedFingerprints.set(queryFingerprint, passed);
    this.emitInstallSummary(input.moment, input.workspace, passed);
    return passed;
  }

  private emitDiscoverySummary(
    moment: SkillPipelineMoment,
    selected: { candidate: SkillCandidate }[],
    ranked: { candidate: SkillCandidate; selected: boolean; skipReason?: string }[],
  ): void {
    const toShow = selected.slice(0, 3);
    for (const item of toShow) {
      this.deps.emit?.(`Skills: selected ${item.candidate.skillName} for ${moment}`);
    }
    if (selected.length > 3) {
      this.deps.emit?.(`Skills: selected ${selected.length - 3} more skill(s) for ${moment}`);
    }
    const skipped = ranked.filter((item) => !item.selected);
    if (skipped.length) {
      const notable = skipped.find((item) => item.skipReason);
      if (notable) {
        this.deps.emit?.(
          `Skills: skipped ${notable.candidate.packageRef}@${notable.candidate.skillName}: ${notable.skipReason}`,
        );
      }
      if (skipped.length > 1) {
        this.deps.emit?.(`Skills: skipped ${skipped.length} candidate(s) for ${moment}`);
      }
    }
  }

  private emitAuditSummary(
    moment: SkillPipelineMoment,
    passedCount: number,
    failedCount: number,
  ): void {
    if (failedCount > 0) {
      this.deps.emit?.(`Skills: ${failedCount} skill(s) failed audit for ${moment}`);
    }
    if (!passedCount) {
      this.deps.emit?.(`Skills: no skills passed audit for ${moment}`);
    }
  }

  private emitInstallSummary(
    moment: SkillPipelineMoment,
    workspace: string,
    skills: AuditedSkillForInstall[],
  ): void {
    if (!skills.length) return;
    const scope =
      workspace === this.deps.workspace ? "workspace" : `task workspace ${path.basename(workspace)}`;
    this.deps.emit?.(`Skills: installed ${skills.length} skill(s) into ${scope}`);
  }
}

// --- Factory ---

export interface SkillPipelineFactorySession {
  id: string;
  idea: string;
  workspace: string;
  config: { skills: SkillConfig };
  db: ForgeDb;
  getReasoningModel(): string;
}

export function createSkillPipelineCoordinator(input: {
  session: SkillPipelineFactorySession;
  emit?: (message: string) => void;
}): SkillPipelineCoordinator | NoopSkillPipelineCoordinator {
  const config = input.session.config.skills;
  if (!config || config.mode !== "auto" || config.maxSkills <= 0) {
    return new NoopSkillPipelineCoordinator();
  }

  // Import lazily to avoid loading CLI when not needed
  /* eslint-disable @typescript-eslint/no-var-requires */
  const { SkillsCli } = require("./cli.js") as { SkillsCli: new () => SkillSearchClient & SkillUseClient & SkillInstallClient };
  const { externalAgentFor: extAgentFor } = require("../externalAgents.js") as { externalAgentFor: (model: string) => ExternalAgentId | undefined };
  /* eslint-enable @typescript-eslint/no-var-requires */
  const skillsCli = new SkillsCli();
  const externalAgent = extAgentFor(input.session.getReasoningModel());

  return new SkillPipelineCoordinator({
    sessionId: input.session.id,
    idea: input.session.idea,
    workspace: input.session.workspace,
    config,
    db: input.session.db,
    searchClient: skillsCli,
    useClient: skillsCli,
    installClient: skillsCli,
    contextProvider: new SkillContextProvider(),
    externalAgent,
    emit: input.emit,
  });
}
