---
title: Phase 7 - Pipeline Timing Agent Behavior
aliases:
  - Skills.sh Context Phase 7
  - Phase 7 Skill Pipeline Timing
tags:
  - forgecli/skills-sh-context
  - forgecli/planning/phase
  - status/ready
status: ready
phase: 7
research_gate: closed
parent: "[[Skills.sh Context System Master Plan]]"
next_action: "Implement the skill pipeline coordinator after Phase 1 through Phase 6 land."
created: 2026-06-06
updated: 2026-06-07
---

# Phase 7 - Pipeline Timing Agent Behavior

> [!warning] Planning Boundary
> Phase 7 decides when Forge should run the skill lifecycle and which agents should receive skill context. It must not redesign the skills CLI adapter, candidate scoring, audit rules, install layout, or progressive-disclosure renderer owned by prior phases.

> [!abstract] Outcome
> At the end of Phase 7, Forge has a low-noise skill pipeline coordinator that runs discovery, audit, install, and context preparation at deliberate phase gates; injects task-relevant skill context into the right agents; handles external-agent isolated workspaces; reuses prior selections across cycles and resumes; and emits concise live feed events for selected, skipped, installed, and injected skills.

> [!danger] Noise Constraint
> The skill pipeline must never call `skills.sh` search from inside an agent tool loop or for every individual model turn. Discovery happens at bounded pipeline moments only.

## Research Questions

- Where does the current Forge pipeline transition between ideation, architecture, task graph, coding, integration, testing, verification, and deploy?
- Which agents are one-shot model calls and which agents use the native tool loop?
- Which agents run inside isolated task workspaces when Codex CLI or Claude Code are configured?
- When can Forge know enough about the project to search broad skills, stack-specific skills, task-specific skills, failure-specific skills, and deployment skills?
- Which existing prior-phase APIs should Phase 7 compose?
- How should Phase 7 avoid repeated network searches across verification cycles and resumed sessions?
- Should architecture, task graph, review, deploy, verification, and test agents receive skill context by default?
- How should root workspace skill installation differ from external-agent task-workspace installation?
- How should live events report skill selection without flooding the feed?

## Researched Facts

### Evidence: Current Branch And Dirty State

Command:

```bash
git status --short --branch
```

Observed:

```text
## feature/skills-sh-context
?? .env
?? docs/plans/2026-06-06-skills-sh-context.md
?? "docs/plans/Skills.sh Context System Phases.base"
?? docs/plans/skills-sh-context-phases/
?? pyproject.toml
?? tests/test_cli.py
```

Plan impact:

- Work is on `feature/skills-sh-context`.
- `.env`, `pyproject.toml`, and `tests/test_cli.py` are unrelated untracked files and must not be touched by Phase 7.
- Phase 7 remains documentation-only until implementation starts.

### Evidence: Master Phase Boundary

Master plan Phase 7 subphases:

- 7.1 Ideation-to-architecture timing
  - 7.1.1 Broad early discovery
  - 7.1.2 Architecture guidance injection
- 7.2 Architecture-to-coding timing
  - 7.2.1 Stack-specific discovery
  - 7.2.2 Task-specific injection
- 7.3 Verification-loop timing
  - 7.3.1 Failure-specific discovery
  - 7.3.2 Debugging and testing skills
  - 7.3.3 Cycle-to-cycle reuse
- 7.4 Live events
  - 7.4.1 Selected skill event
  - 7.4.2 Skipped skill event
  - 7.4.3 Install and injection event

Plan impact:

- Phase 7 owns orchestration and timing.
- Phase 7 consumes prior-phase APIs rather than reimplementing them.
- Phase 8 owns user-facing CLI flags and setup UX, so Phase 7 should rely on Phase 1 config shape and existing `config.skills.mode`.

### Evidence: Current Forge State Machine

Current phases:

```typescript
export enum Phase {
  IDEATION = "IDEATION",
  ARCHITECTURE = "ARCHITECTURE",
  TASK_GRAPH = "TASK_GRAPH",
  CODING = "CODING",
  INTEGRATION = "INTEGRATION",
  TESTING = "TESTING",
  VERIFICATION = "VERIFICATION",
  DEPLOY = "DEPLOY",
  DONE = "DONE",
  FAILED = "FAILED",
}
```

Current transitions:

```typescript
const TRANSITIONS: Record<Phase, Phase[]> = {
  [Phase.IDEATION]: [Phase.ARCHITECTURE],
  [Phase.ARCHITECTURE]: [Phase.TASK_GRAPH],
  [Phase.TASK_GRAPH]: [Phase.CODING],
  [Phase.CODING]: [Phase.INTEGRATION],
  [Phase.INTEGRATION]: [Phase.TESTING],
  [Phase.TESTING]: [Phase.VERIFICATION],
  [Phase.VERIFICATION]: [Phase.DONE, Phase.CODING, Phase.DEPLOY],
  [Phase.DEPLOY]: [Phase.DONE],
  [Phase.DONE]: [],
  [Phase.FAILED]: [],
};
```

Plan impact:

- Phase 7 should not add a new state-machine phase.
- Skill work should happen inside existing phase methods.
- Verification failure loops back to `CODING`, so failure-specific skills must be prepared before the next coding cycle starts.

### Evidence: Current Overseer Pipeline

Current `Overseer.runPhase()`:

```typescript
private async runPhase(askUser?: AskUser): Promise<void> {
  const p = this.session.phase;
  this.emit(`Starting phase: ${p}`);
  switch (p) {
    case Phase.IDEATION: return this.ideation(askUser);
    case Phase.ARCHITECTURE: return this.architecture();
    case Phase.TASK_GRAPH: return this.taskGraph();
    case Phase.CODING: return this.coding();
    case Phase.INTEGRATION: return this.integration();
    case Phase.TESTING: return this.testing();
    case Phase.VERIFICATION: return this.verification();
    case Phase.DEPLOY: return this.deploy();
  }
}
```

Current agent order:

```text
IDEATION -> ArchitectureAgent -> TaskGraphAgent -> CodingAgent per task
  -> ReviewAgent per task -> IntegrationAgent -> TestAgent -> VerificationAgent
  -> either DONE, DEPLOY, or more CodingAgent fix tasks
```

Plan impact:

- Phase 7 should hook into `Overseer`, not into individual prior-phase modules.
- `Overseer` has access to session config, DB, phase, cycle, workspace, task list, spec, and architecture, which are exactly the inputs needed for timing decisions.

### Evidence: Agent Call Styles

One-shot agents:

- `IdeationAgent` uses `call()`.
- `ArchitectureAgent` uses `call()`.
- `TaskGraphAgent` uses `call()`.
- `ReviewAgent` uses `call()`.

Tool-loop agents:

- `CodingAgent` uses `runAgenticLoop()`.
- `IntegrationAgent` uses `runAgenticLoop()`.
- `TestAgent` uses `runAgenticLoop()`.
- `VerificationAgent` uses `runAgenticLoop()`.
- `DeployAgent` uses `runAgenticLoop()` only when an external agent mode is active; otherwise it uses direct `execSync()`.

Plan impact:

- Phase 7 should inject compact-only skill context into one-shot agents when needed.
- Phase 7 should prefer Phase 6 `skill_list` and `skill_read` for native tool-loop agents.
- Review remains out of scope for v1 because it receives only a task output summary, not a real diff or workspace path.

### Evidence: Current Coding Parallelism And Isolation

Current coding phase:

```typescript
private async coding(): Promise<void> {
  const pending = this.session.db.getTasks(this.session.id, "pending");
  if (!pending.length) { this.session.advancePhase(Phase.INTEGRATION); return; }
  this.emit(`Coding ${pending.length} tasks in parallel...`);

  const useIsolation =
    externalAgentFor(this.session.router.modelFor(ModelTier.REASONING)) !== undefined;
  const tasksDir = path.join(this.session.workspace, "tasks");
  if (useIsolation) {
    if (fs.existsSync(tasksDir)) fs.rmSync(tasksDir, { recursive: true, force: true });
    try {
      await Promise.all(pending.map(t => {
        const taskWorkspace = path.join(tasksDir, String(t["id"]));
        fs.mkdirSync(taskWorkspace, { recursive: true });
        return this.codeTask(t, taskWorkspace);
      }));
      this.mergeTaskDirs(tasksDir, this.session.workspace);
    } finally {
      fs.rmSync(tasksDir, { recursive: true, force: true });
    }
  } else {
    await Promise.all(pending.map(t => this.codeTask(t)));
  }
}
```

Current merge skips dot directories:

```typescript
private copyDir(src: string, dst: string): void {
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(dstPath, { recursive: true });
      this.copyDir(srcPath, dstPath);
    } else {
      fs.mkdirSync(path.dirname(dstPath), { recursive: true });
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}
```

Plan impact:

- Native coding agents use the root workspace, so root skill installation is enough.
- External coding agents use isolated task workspaces, so selected skills must be installed or mirrored into each task workspace before that external agent starts.
- Skill dot directories in isolated task workspaces are disposable because `mergeTaskDirs()` skips them.
- Phase 7 must not rely only on root `.agents/skills` for external isolated tasks.

### Evidence: Verification Failure Loop

Current verification failure behavior:

```typescript
private async verification(): Promise<void> {
  const result = await this.agent(VerificationAgent).run({
    workspace: this.session.workspace,
    architecture: this.arch(),
    spec: this.spec(),
  });
  if (result.success) {
    const next = this.session.deployTarget ? Phase.DEPLOY : Phase.DONE;
    this.session.advancePhase(next);
    this.emit("Build passed - all checks green");
    return;
  }
  if (this.session.cycle >= this.session.maxCycles) {
    this.emit(`Max cycles (${this.session.maxCycles}) reached - build incomplete`);
    this.session.db.updateSession(this.session.id, { phase: Phase.FAILED });
    this.session.phase = Phase.FAILED;
    return;
  }
  this.session.incrementCycle();
  let report: Record<string, unknown[]> = { failed: [], errors: [] };
  try { report = JSON.parse(result.output); } catch {}
  const failures = (report["failed"] as string[]) ?? [];
  for (const failure of failures) {
    this.session.db.createTask(this.session.id, `Fix: ${failure}`, "coding");
  }
  this.emit(`Verification failed: ${failures.length} issue(s). Cycle ${this.session.cycle}/${this.session.maxCycles}`);
  this.session.advancePhase(Phase.CODING);
}
```

Plan impact:

- Failure-specific discovery should happen after the failure report is parsed and before the phase advances back to `CODING`.
- If `maxCycles` is reached, Phase 7 should not run new failure discovery because no repair cycle will run.
- Failure skills should be reused by the next coding, testing, and verification cycle.

### Evidence: Existing Live Feed Shape

Current live event kinds:

```typescript
export type EventKind = "llm" | "tool" | "cmd";
```

Current UI log kind:

```typescript
export type LogKind = "phase" | "llm" | "tool" | "cmd";
```

Current `Overseer.emit()` writes a phase event and stores it in DB:

```typescript
this.emit = (msg) => {
  this.session.db.logEvent(this.session.id, this.session.phase, msg);
  eventCallback?.(msg);
};
```

Plan impact:

- Phase 7 can emit high-level skill lifecycle messages through existing phase events.
- If a dedicated skill log kind is added, both `EventKind` and `LogKind` need to change.
- The minimal implementation should use `emit("Skills: ...")` for selected/skipped/install summaries and Phase 6 tool events for `skill_read`.

### Evidence: Prior Phase Interfaces

Phase 3 planned query planner:

```typescript
export interface SkillPlanningInput {
  phase: string;
  idea?: string;
  spec?: string | Record<string, unknown>;
  architecture?: string | Record<string, unknown>;
  tasks?: Array<{ id?: string; title: string; type?: string }>;
  failures?: string[];
  maxQueries?: number;
}

export function planSkillQueries(input: SkillPlanningInput): PlannedSkillQuery[];
```

Phase 3 planned discovery orchestrator:

```typescript
export interface SkillDiscoveryInput extends SkillPlanningInput {
  sessionId: string;
  workspace: string;
  config: SkillConfig;
}

export async function discoverSkillCandidates(
  input: SkillDiscoveryInput,
  client: SkillSearchClient,
  db: SkillDiscoveryDb,
): Promise<SkillDiscoveryResult>;
```

Phase 4 planned audit orchestrator:

```typescript
export async function auditSelectedSkills(
  input: AuditSelectedSkillInput,
  client: SkillUseClient,
  db: SkillAuditDb,
): Promise<AuditSelectedSkillResult>;
```

Phase 5 planned install utility:

```typescript
export async function ensureSkillsInstalledForWorkspace(
  workspace: string,
  skills: AuditedSkillForInstall[],
  config: SkillConfig,
  client: SkillInstallClient,
  db: SkillInstallDb,
  sessionId: string,
): Promise<InstallAuditedSkillResult[]> {
  return installAuditedSkills({ sessionId, workspace, config, skills }, client, db);
}
```

Phase 6 planned agent options:

```typescript
export interface SkillContextRuntime {
  provider: SkillContextProvider;
  request: SkillContextRequest;
  loggedInjections: Set<string>;
}

export interface AgentRunOptions {
  skillContext?: SkillContextRuntime;
}
```

Plan impact:

- Phase 7 should create a coordinator that composes these functions.
- Phase 7 should pass Phase 6 `AgentRunOptions` through agent `run()` args.
- Phase 7 needs helper methods to map selected/audited/installed records into `selectionIdsBySourceKey` and `relevantSourceKeys`.

### Evidence: External Skill Ecosystem

Sources:

- [vercel-labs/skills README](https://github.com/vercel-labs/skills/blob/main/README.md)
- [Vercel Agent Skills docs](https://vercel.com/docs/agent-resources/skills)
- [OpenAI Codex Agent Skills docs](https://developers.openai.com/codex/skills)
- [Claude Code skills docs](https://code.claude.com/docs/en/skills)
- [OpenCode Agent Skills docs](https://dev.opencode.ai/docs/skills)
- [Hermes Skills System docs](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/skills.md)

Researched facts:

- The skills CLI supports `add`, `use`, `list`, `find`, project installation, agent targets, `--copy`, and non-interactive `--yes`.
- Vercel documents skills as packaged capabilities installed through the skills CLI.
- Codex uses progressive disclosure: initial context includes skill name, description, and file path; full `SKILL.md` loads only when Codex chooses the skill.
- Codex scans `.agents/skills` from the current directory and parent directories up to the repository root.
- Claude Code project skills live in `.claude/skills/<skill-name>/SKILL.md` and can be discovered from current and parent directories.
- Claude Code keeps invoked skill content in conversation context for the rest of a session, so unnecessary full skill invocation has lasting token cost.
- OpenCode exposes available skills and loads full content on demand through a native skill tool.
- Hermes documents a three-level progressive disclosure model: compact list, full skill content, then specific reference file.

Plan impact:

- Phase 7 should align with progressive disclosure by injecting compact context first and relying on Phase 6 `skill_read` or external agent native loading.
- External agent task workspaces must have `.agents/skills` or `.claude/skills` available before launch.
- Discovery should be a phase-gated lifecycle, not a per-turn behavior.

## Design Decisions

### Decision 1: Add A Skill Pipeline Coordinator

Phase 7 should create a single orchestration object:

```typescript
export class SkillPipelineCoordinator {
  constructor(private deps: SkillPipelineDeps) {}

  async prepareForArchitecture(input: ArchitectureSkillInput): Promise<SkillAgentPreparation>;
  async prepareForTaskGraph(input: TaskGraphSkillInput): Promise<SkillAgentPreparation>;
  async prepareForCodingPhase(input: CodingPhaseSkillInput): Promise<void>;
  async prepareForCodingTask(input: CodingTaskSkillInput): Promise<SkillAgentPreparation>;
  async prepareForIntegration(input: WorkspaceSkillInput): Promise<SkillAgentPreparation>;
  async prepareForTesting(input: WorkspaceSkillInput): Promise<SkillAgentPreparation>;
  async prepareForVerification(input: WorkspaceSkillInput): Promise<SkillAgentPreparation>;
  async prepareForVerificationFailure(input: VerificationFailureSkillInput): Promise<void>;
  async prepareForDeploy(input: DeploySkillInput): Promise<SkillAgentPreparation>;
}
```

Rationale:

- `Overseer` stays readable.
- Prior-phase services stay testable.
- Runtime timing rules live in one module.
- A no-op coordinator can preserve existing behavior when skills are off.

### Decision 2: Discovery Happens Only At Gates

Allowed discovery gates:

| Gate | Moment | Max default queries | Purpose |
|---|---|---:|---|
| `pre-architecture` | after spec exists, before architecture | 2 | Broad domain or design guidance |
| `post-architecture` | after architecture, before task graph/coding | 4 | Stack-specific guidance |
| `pre-coding-phase` | after task graph, before parallel coding | 4 | Task-family guidance |
| `post-verification-failure` | after failed verification, before repair cycle | 3 | Failure-specific debugging and testing skills |
| `pre-deploy` | after verification passes, before deploy | 1 | Deployment target guidance |

Forbidden discovery moments:

- Inside `BaseAgent.runAgenticLoop()`.
- Inside `skill_list` or `skill_read`.
- Once for every model turn.
- Once for every tool call.
- Once for every task unless the task is a verification-created fix task with a new failure fingerprint.

### Decision 3: Architecture Gets Compact Guidance Only

Architecture can benefit from broad design or stack guidance, but it returns strict JSON.

Policy:

- Run broad early discovery after ideation produces a JSON spec.
- Install at most one high-confidence broad skill into the root workspace.
- Inject compact context only into `ArchitectureAgent`.
- Do not allow full skill reads in architecture because it is a one-shot call.
- Do not let skills override the existing architecture output schema.

### Decision 4: TaskGraph Does Not Receive Skill Context By Default

Task graph output is strict JSON and skill details can push it toward over-specialized tasks.

Policy:

- Phase 7 can run stack-specific discovery before or after task graph.
- Do not inject skill context into `TaskGraphAgent` by default.
- Keep a feature flag in code for future experiments, but leave it disabled in v1.

### Decision 5: Coding, Integration, Testing, And Verification Receive Skill Context

These agents can inspect files, run commands, and use Phase 6 progressive disclosure.

Policy:

- `CodingAgent`: task-specific relevant skill keys, full `skill_read` allowed.
- `IntegrationAgent`: stack and integration skill keys, full `skill_read` allowed.
- `TestAgent`: test-framework and failure skill keys, full `skill_read` allowed.
- `VerificationAgent`: build, test, and failure skill keys, full `skill_read` allowed.
- `DeployAgent`: deploy target skill keys only when external-agent mode is active.

### Decision 6: ReviewAgent Does Not Receive Skill Context In V1

Current `ReviewAgent` receives `taskTitle` and `diff`, but `diff` is the coding agent output summary, not a real source diff.

Policy:

- Do not inject skill context into `ReviewAgent` in v1.
- Consider a future review-specific phase only after review has a real diff or workspace access.

### Decision 7: External Isolated Task Workspaces Must Get Skill Files

For Codex and Claude Code coding tasks, Forge currently creates:

```text
<session-workspace>/tasks/<task-id>/
```

Policy:

- Install or mirror selected skills into the exact `taskWorkspace` before calling `CodingAgent`.
- Use `config.skills.installTargets` to decide `.agents/skills` and `.claude/skills`.
- Keep `.forge/skills` installed too so Phase 6 Forge-native context provider can read manifests.
- Let `mergeTaskDirs()` drop these dot directories after task completion.

### Decision 8: Resume Prefers Reuse Over Research

Policy:

- On resume, use existing selected, audited, and installed skills where possible.
- Do not re-run `skills find` for a query already logged in the same session unless there is a new verification failure fingerprint.
- Reinstall idempotently into a workspace if the workspace is missing expected files.
- Keep `skill_injections` as per-agent/per-task evidence, not as a trigger to skip future context injection.

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/skills/pipeline.ts` | Create | Skill pipeline coordinator, timing gates, no-op behavior, lifecycle composition |
| `src/skills/relevance.ts` | Create | Map installed skills to relevant source keys per agent/task/failure |
| `src/skills/fingerprints.ts` | Create | Stable query/failure/workspace fingerprints for reuse and dedupe |
| `src/skills/runtime.ts` | Create or extend | Build Phase 6 `SkillContextRuntime` from installed selections |
| `src/overseer.ts` | Modify | Instantiate coordinator and call it at phase gates |
| `src/agents/architecture.ts` | Modify | Accept optional `skillContext` arg and pass it to `call()` |
| `src/agents/taskGraph.ts` | Modify lightly | Accept optional `skillContext`, but v1 coordinator normally passes none |
| `src/agents/coding.ts` | Modify | Accept optional `skillContext` arg and pass it to `runAgenticLoop()` |
| `src/agents/integration.ts` | Modify | Accept optional `skillContext` arg |
| `src/agents/testAgent.ts` | Modify | Accept optional `skillContext` arg |
| `src/agents/verification.ts` | Modify | Accept optional `skillContext` arg |
| `src/agents/deploy.ts` | Modify | Accept optional `skillContext` arg for external-agent path |
| `src/ui/liveFeed.tsx` | Optional modify | Add `skill` event kind only if the implementation chooses a dedicated kind |
| `tests/skillsPipeline.test.ts` | Create | Coordinator unit tests with fake services |
| `tests/skillsRelevance.test.ts` | Create | Relevant source key selection tests |
| `tests/overseerSkills.test.ts` | Create | Integration tests around pipeline timing and workspaces |
| `tests/agentsSkillArgs.test.ts` | Create | Agent arg pass-through tests |
| `docs/plans/skills-sh-context-phases/Phase 7 - Pipeline Timing Agent Behavior.md` | Maintain | This implementation-ready plan |

## Public Interfaces

### Pipeline Moment Types

Create `src/skills/pipeline.ts`.

```typescript
import type { Phase } from "../stateMachine.js";
import type { AgentRunOptions, SkillContextRuntime } from "./types.js";
import type {
  AuditSelectedSkillResult,
  AuditedSkillForInstall,
  InstallAuditedSkillResult,
  RankedSkillCandidate,
  SkillConfig,
  SkillDiscoveryResult,
} from "./types.js";

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

export interface SkillAgentPreparation extends AgentRunOptions {
  moment: SkillPipelineMoment;
  enabled: boolean;
  reason: string;
  relevantSourceKeys: string[];
}
```

Notes:

- `SkillAgentPreparation` extends Phase 6 `AgentRunOptions`.
- `enabled: false` is explicit so tests can assert why no context was used.
- `moment` helps logs and DB rationale.

### Coordinator Dependencies

```typescript
export interface SkillPipelineDeps {
  sessionId: string;
  idea: string;
  workspace: string;
  config: SkillConfig;
  db: SkillPipelineDb;
  searchClient: SkillSearchClient;
  useClient: SkillUseClient;
  installClient: SkillInstallClient;
  contextProvider: SkillContextProvider;
  emit?: (message: string) => void;
  liveEvent?: (kind: "llm" | "tool" | "cmd" | "skill", message: string) => void;
}
```

Implementation rule:

- The concrete coordinator can receive `session.config.skills` from Phase 1.
- If `config.mode !== "auto"`, use `NoopSkillPipelineCoordinator`.
- Until Phase 8 adds CLI controls, this is the only enable/disable path.

### Coordinator DB Interface

Use existing Phase 1 helpers where possible and add read helpers only if Phase 1 did not already land them.

```typescript
export interface SkillPipelineDb
  extends SkillDiscoveryDb,
    SkillAuditDb,
    SkillInstallDb,
    SkillInjectionDb {
  getSkillSelections(sessionId: string): Record<string, unknown>[];
  getSkillAuditTrail(sessionId: string): Record<string, unknown>[];
  getSkillInstallations(sessionId: string): Record<string, unknown>[];
  getSkillQueries(sessionId: string): Record<string, unknown>[];
}
```

Fallback:

- If Phase 1 only exposes broad getters, implement small filtering functions in `src/skills/pipeline.ts`.
- Do not create duplicate DB writes just to simplify the coordinator.

### Gate Input Types

```typescript
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
  externalAgent: "codex" | "claude-code" | undefined;
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
  externalAgent: "codex" | "claude-code" | undefined;
}
```

### No-Op Coordinator

```typescript
const disabled = (moment: SkillPipelineMoment, reason = "skills disabled"): SkillAgentPreparation => ({
  moment,
  enabled: false,
  reason,
  relevantSourceKeys: [],
});

export class NoopSkillPipelineCoordinator {
  async prepareForArchitecture(): Promise<SkillAgentPreparation> {
    return disabled("pre-architecture");
  }

  async prepareForTaskGraph(): Promise<SkillAgentPreparation> {
    return disabled("pre-task-graph");
  }

  async prepareForCodingPhase(): Promise<void> {}

  async prepareForCodingTask(): Promise<SkillAgentPreparation> {
    return disabled("pre-coding-task");
  }

  async prepareForIntegration(): Promise<SkillAgentPreparation> {
    return disabled("pre-integration");
  }

  async prepareForTesting(): Promise<SkillAgentPreparation> {
    return disabled("pre-testing");
  }

  async prepareForVerification(): Promise<SkillAgentPreparation> {
    return disabled("pre-verification");
  }

  async prepareForVerificationFailure(): Promise<void> {}

  async prepareForDeploy(): Promise<SkillAgentPreparation> {
    return disabled("pre-deploy");
  }
}
```

Acceptance:

- With skills disabled, `Overseer` behavior is unchanged.
- Tests should use this no-op to avoid mocking every skill service in unrelated Overseer tests.

## Lifecycle Composition

### Discover, Audit, Install

Core method:

```typescript
private async discoverAuditInstall(input: {
  moment: SkillPipelineMoment;
  phase: Phase | string;
  workspace: string;
  planning: Omit<SkillPlanningInput, "phase">;
  maxQueries: number;
  maxSkills: number;
  installWorkspace?: string;
}): Promise<AuditedSkillForInstall[]> {
  if (!this.isEnabled()) return [];
  if (this.remainingSkillSlots() <= 0) return [];

  const queryInput: SkillDiscoveryInput = {
    sessionId: this.deps.sessionId,
    workspace: input.workspace,
    config: {
      ...this.deps.config,
      maxSkills: Math.min(this.deps.config.maxSkills, input.maxSkills),
    },
    phase: String(input.phase),
    maxQueries: input.maxQueries,
    ...input.planning,
  };

  const queryFingerprint = fingerprintPlanningInput(queryInput);
  if (this.hasSatisfiedFingerprint(queryFingerprint)) {
    this.emit(`Skills: reused prior ${input.moment} selection`);
    return this.passedSkillsForMoment(input.moment);
  }

  const discovered = await discoverSkillCandidates(queryInput, this.deps.searchClient, this.deps.db);
  this.emitDiscoverySummary(input.moment, discovered);

  const selected = discovered.selected.map((item) => ({
    candidateId: this.candidateIdFor(item),
    candidate: item.candidate,
  }));
  if (!selected.length) return [];

  const audited = await auditSelectedSkills({
    sessionId: this.deps.sessionId,
    workspace: input.workspace,
    phase: String(input.phase),
    config: this.deps.config,
    selected,
  }, this.deps.useClient, this.deps.db);
  this.emitAuditSummary(input.moment, audited);

  const passed = audited.passed.map(toAuditedSkillForInstall);
  if (!passed.length) return [];

  const installWorkspace = input.installWorkspace ?? input.workspace;
  await ensureSkillsInstalledForWorkspace(
    installWorkspace,
    passed,
    this.deps.config,
    this.deps.installClient,
    this.deps.db,
    this.deps.sessionId,
  );
  this.markSatisfiedFingerprint(queryFingerprint, passed);
  this.emitInstallSummary(input.moment, installWorkspace, passed);
  return passed;
}
```

Implementation notes:

- The real implementation should adapt exact result shapes after Phases 3, 4, and 5 land.
- Use Phase 1 DB IDs instead of inventing new IDs.
- `fingerprintPlanningInput()` avoids duplicate searches for the same moment.

### Context Runtime Builder

Use Phase 6 context provider after skills are installed:

```typescript
private async prepareContext(input: {
  moment: SkillPipelineMoment;
  agentName: string;
  workspace: string;
  taskId?: string;
  mode: SkillContextMode;
  relevantSourceKeys: string[];
  promptCharBudget?: number;
}): Promise<SkillAgentPreparation> {
  if (!this.isEnabled()) return disabled(input.moment);
  if (!input.relevantSourceKeys.length) {
    return disabled(input.moment, "no relevant installed skills");
  }

  const selectionIdsBySourceKey = this.selectionIdsBySourceKey(input.relevantSourceKeys);
  const skillContext: SkillContextRuntime = {
    provider: this.deps.contextProvider,
    loggedInjections: new Set<string>(),
    request: {
      workspace: input.workspace,
      agentName: input.agentName,
      taskId: input.taskId,
      mode: input.mode,
      maxChars: input.promptCharBudget ?? this.deps.config.promptCharBudget,
      selectionIdsBySourceKey,
      relevantSourceKeys: input.relevantSourceKeys,
    },
  };

  this.emit(`Skills: injecting ${input.relevantSourceKeys.length} into ${input.agentName}`);
  return {
    moment: input.moment,
    enabled: true,
    reason: "relevant installed skills available",
    relevantSourceKeys: input.relevantSourceKeys,
    skillContext,
  };
}
```

## Timing Plan

## 7.1 Ideation-To-Architecture Timing

### 7.1.1 Broad Early Discovery

Goal:

- Find at most a small number of high-confidence broad skills from the product spec before architecture is chosen.

When:

```text
IDEATION produces spec -> run broad discovery -> ARCHITECTURE starts
```

Inputs:

- `session.idea`
- parsed or raw spec
- no architecture yet
- no tasks yet
- no failures yet

Default policy:

| Setting | Value |
|---|---:|
| Max queries | 2 |
| Max selected skills | 1 |
| Allowed query sources | `idea`, `spec` |
| Install workspace | root workspace |
| Injection target | `ArchitectureAgent` only |
| Context mode | `one-shot` |
| Full skill reads | no |

Code sketch:

```typescript
async prepareForArchitecture(input: ArchitectureSkillInput): Promise<SkillAgentPreparation> {
  await this.discoverAuditInstall({
    moment: "pre-architecture",
    phase: Phase.ARCHITECTURE,
    workspace: this.deps.workspace,
    planning: {
      idea: this.deps.idea,
      spec: input.spec,
    },
    maxQueries: 2,
    maxSkills: 1,
  });

  const relevantSourceKeys = selectRelevantSourceKeys({
    moment: "pre-architecture",
    agentName: "ArchitectureAgent",
    installed: this.installedInventory(this.deps.workspace),
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
```

Overseer wiring:

```typescript
private async architecture(): Promise<void> {
  this.emit("Picking stack & file structure...");
  const skills = await this.skills.prepareForArchitecture({ spec: this.spec() });
  const result = await this.agent(ArchitectureAgent).run({
    spec: this.spec(),
    skillContext: skills.skillContext,
  });
  // existing architecture handling continues
}
```

Agent wiring:

```typescript
const response = await this.call(messages, undefined, {
  skillContext: args["skillContext"] as SkillContextRuntime | undefined,
});
```

Acceptance:

- No broad discovery runs before a spec exists.
- Broad discovery runs once per session unless resumed without prior rows.
- Architecture receives compact context only.
- Architecture still outputs valid JSON.
- If no broad skill passes audit, architecture runs unchanged.

### 7.1.2 Architecture Guidance Injection

Goal:

- Give architecture enough skill awareness to avoid missing obvious domain guidance without letting skills dictate the stack.

Prompt policy:

```text
ArchitectureAgent system prompt remains first.
Phase 6 compact skill context is appended as an additional system message.
No full SKILL.md body is injected.
```

Conflict policy:

- If a skill recommends Next.js but the existing Forge architecture prompt says React frontend apps should prefer Vite over Create React App, Forge's architecture prompt wins.
- If the user requested a specific stack, user request wins.
- If architecture output schema conflicts with a skill's output format, architecture output schema wins.

Test:

```typescript
test("architecture receives compact skill context but keeps JSON schema", async () => {
  const session = makeSkillSession({ skillsMode: "auto" });
  const calls = captureArchitectureAgentArgs();

  await new Overseer(session).run();

  expect(calls[0].skillContext).toBeDefined();
  expect(calls[0].spec).toContain("todo");
});
```

## 7.2 Architecture-To-Coding Timing

### 7.2.1 Stack-Specific Discovery

Goal:

- Use the chosen architecture and generated tasks to find stack, framework, testing, and integration skills before implementation starts.

When:

```text
ARCHITECTURE produces architecture -> TASK_GRAPH produces tasks -> pre-coding-phase discovery -> CODING starts
```

Inputs:

- spec
- architecture
- pending tasks
- current cycle

Default policy:

| Setting | Value |
|---|---:|
| Max queries | 4 |
| Max selected skills | remaining `config.skills.maxSkills` slots |
| Allowed query sources | `architecture`, `task`, `spec` |
| Install workspace | root workspace |
| Injection target | later task-specific agents |
| Context mode | not injected at discovery gate |

Why after task graph:

- Architecture gives stack and platform.
- Task graph gives concrete implementation task titles.
- Running once before parallel coding avoids per-task search noise.

Code sketch:

```typescript
async prepareForCodingPhase(input: CodingPhaseSkillInput): Promise<void> {
  await this.discoverAuditInstall({
    moment: "pre-coding-phase",
    phase: Phase.CODING,
    workspace: this.deps.workspace,
    planning: {
      spec: input.spec,
      architecture: input.architecture,
      tasks: input.pendingTasks,
    },
    maxQueries: 4,
    maxSkills: this.remainingSkillSlots(),
  });
}
```

Overseer wiring:

```typescript
private async coding(): Promise<void> {
  const pending = this.session.db.getTasks(this.session.id, "pending");
  if (!pending.length) { this.session.advancePhase(Phase.INTEGRATION); return; }

  await this.skills.prepareForCodingPhase({
    spec: this.spec(),
    architecture: this.arch(),
    pendingTasks: pending.map((t) => ({
      id: String(t["id"]),
      title: String(t["title"]),
      type: String(t["type"] ?? "coding"),
    })),
    cycle: this.session.cycle,
  });

  // existing parallel coding logic continues
}
```

Acceptance:

- Stack discovery runs once before a coding phase, not once per task.
- Existing selected skills are skipped or reused.
- Discovery respects `maxSkills`.
- If skills are disabled, no discovery client is called.

### 7.2.2 Task-Specific Injection

Goal:

- Give each coding task only the installed skills relevant to that task.

When:

```text
inside codeTask(), immediately before CodingAgent.run()
```

Inputs:

- task title
- task id
- spec
- architecture
- actual workspace passed to `CodingAgent`
- external agent mode

Relevant key selection:

```typescript
export interface SkillRelevanceInput {
  moment: SkillPipelineMoment;
  agentName: string;
  installed: CompactSkillContextEntry[];
  taskTitle?: string;
  failures?: string[];
  architecture?: string;
  spec?: string;
  limit: number;
}

export function selectRelevantSourceKeys(input: SkillRelevanceInput): string[] {
  const text = normalizeSearchText([
    input.taskTitle,
    input.failures?.join("\n"),
    input.architecture,
    input.spec,
  ].filter(Boolean).join("\n"));

  return input.installed
    .map((entry) => ({
      sourceKey: entry.sourceKey,
      score: relevanceScoreForInstalledSkill(entry, text, input.moment, input.agentName),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.sourceKey.localeCompare(b.sourceKey))
    .slice(0, input.limit)
    .map((item) => item.sourceKey);
}
```

Simple keyword scoring:

```typescript
function relevanceScoreForInstalledSkill(
  skill: CompactSkillContextEntry,
  text: string,
  moment: SkillPipelineMoment,
  agentName: string,
): number {
  const haystack = normalizeSearchText([
    skill.skillName,
    skill.displayName,
    skill.description,
    skill.packageRef,
  ].join(" "));

  let score = overlapScore(haystack, text);
  if (agentName === "TestAgent" && /test|jest|vitest|pytest|playwright/.test(haystack)) score += 3;
  if (agentName === "DeployAgent" && /deploy|vercel|railway|fly/.test(haystack)) score += 3;
  if (moment === "post-verification-failure" && /debug|error|fix|test|build/.test(haystack)) score += 2;
  return score;
}
```

External task workspace install:

```typescript
async prepareForCodingTask(input: CodingTaskSkillInput): Promise<SkillAgentPreparation> {
  const relevantSourceKeys = this.relevantForTask(input.task, input.workspace);
  const relevantSkills = this.auditedSkillsForSourceKeys(relevantSourceKeys);

  if (input.externalAgent && relevantSkills.length) {
    await ensureSkillsInstalledForWorkspace(
      input.workspace,
      relevantSkills,
      this.deps.config,
      this.deps.installClient,
      this.deps.db,
      this.deps.sessionId,
    );
  }

  return this.prepareContext({
    moment: "pre-coding-task",
    agentName: "CodingAgent",
    workspace: input.workspace,
    taskId: input.task.id,
    mode: input.externalAgent === "codex"
      ? "codex-cli"
      : input.externalAgent === "claude-code"
        ? "claude-code"
        : "native-tool-loop",
    relevantSourceKeys,
  });
}
```

Overseer wiring:

```typescript
private async codeTask(
  task: Record<string, unknown>,
  workspaceOverride?: string,
): Promise<void> {
  const id = String(task["id"]);
  const title = String(task["title"]);
  const workspace = workspaceOverride ?? this.session.workspace;
  const externalAgent = externalAgentFor(this.session.router.modelFor(ModelTier.REASONING));

  const skills = await this.skills.prepareForCodingTask({
    spec: this.spec(),
    architecture: this.arch(),
    task: { id, title, type: String(task["type"] ?? "coding") },
    workspace,
    cycle: this.session.cycle,
    externalAgent,
  });

  const result = await this.agent(CodingAgent).run({
    taskTitle: title,
    spec: this.spec(),
    architecture: this.arch(),
    workspace,
    taskId: id,
    skillContext: skills.skillContext,
  });
}
```

Agent wiring:

```typescript
const summary = await this.runAgenticLoop(messages, workspace, taskId, {
  skillContext: args["skillContext"] as SkillContextRuntime | undefined,
});
```

Acceptance:

- Each coding task receives only relevant source keys.
- Native coding tasks use root installed skills.
- External isolated coding tasks install relevant skills into the isolated task workspace before the agent runs.
- Task workspace skill dot directories are not merged back into root artifacts.
- Parallel coding remains parallel after the pre-coding discovery gate.

## 7.3 Verification-Loop Timing

### 7.3.1 Failure-Specific Discovery

Goal:

- When verification fails, search for debugging or testing skills specific to the observed failures once per unique failure fingerprint.

When:

```text
VERIFICATION fails -> parse report -> if another cycle remains -> failure-specific discovery -> create Fix tasks -> CODING starts
```

Inputs:

- spec
- architecture
- `report.failed`
- `report.errors`
- current cycle

Code sketch:

```typescript
async prepareForVerificationFailure(input: VerificationFailureSkillInput): Promise<void> {
  const failures = [...input.failures, ...input.errors].filter(Boolean);
  if (!failures.length) return;

  const fingerprint = fingerprintFailures({
    architecture: input.architecture,
    failures,
  });
  if (this.hasSatisfiedFingerprint(fingerprint)) {
    this.emit("Skills: reused failure-specific skills");
    return;
  }

  await this.discoverAuditInstall({
    moment: "post-verification-failure",
    phase: Phase.VERIFICATION,
    workspace: this.deps.workspace,
    planning: {
      spec: input.spec,
      architecture: input.architecture,
      failures,
    },
    maxQueries: 3,
    maxSkills: this.remainingSkillSlots(),
  });
}
```

Overseer wiring:

```typescript
if (this.session.cycle >= this.session.maxCycles) {
  this.emit(`Max cycles (${this.session.maxCycles}) reached - build incomplete`);
  this.session.db.updateSession(this.session.id, { phase: Phase.FAILED });
  this.session.phase = Phase.FAILED;
  return;
}

this.session.incrementCycle();
let report: Record<string, unknown[]> = { failed: [], errors: [] };
try { report = JSON.parse(result.output); } catch {}
const failures = (report["failed"] as string[]) ?? [];
const errors = (report["errors"] as string[]) ?? [];

await this.skills.prepareForVerificationFailure({
  spec: this.spec(),
  architecture: this.arch(),
  failures,
  errors,
  cycle: this.session.cycle,
});

for (const failure of failures) {
  this.session.db.createTask(this.session.id, `Fix: ${failure}`, "coding");
}
```

Acceptance:

- Failure discovery does not run when max cycles has been reached.
- Failure discovery runs before fix tasks are coded.
- Same failure fingerprint is reused across resume and repeated verification.
- Failure-specific skills become eligible for the next coding, testing, and verification passes.

### 7.3.2 Debugging And Testing Skills

Goal:

- Give testing and verification agents relevant test/build/debug guidance, not generic frontend or deployment guidance.

Testing policy:

```typescript
async prepareForTesting(input: WorkspaceSkillInput): Promise<SkillAgentPreparation> {
  const relevantSourceKeys = selectRelevantSourceKeys({
    moment: "pre-testing",
    agentName: "TestAgent",
    installed: this.installedCompact(input.workspace),
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
```

Verification policy:

```typescript
async prepareForVerification(input: WorkspaceSkillInput): Promise<SkillAgentPreparation> {
  const relevantSourceKeys = selectRelevantSourceKeys({
    moment: "pre-verification",
    agentName: "VerificationAgent",
    installed: this.installedCompact(input.workspace),
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
```

Overseer wiring:

```typescript
private async testing(): Promise<void> {
  this.emit("Writing and running tests...");
  const skills = await this.skills.prepareForTesting({
    workspace: this.session.workspace,
    architecture: this.arch(),
    cycle: this.session.cycle,
  });
  const result = await this.agent(TestAgent).run({
    workspace: this.session.workspace,
    architecture: this.arch(),
    skillContext: skills.skillContext,
  });
  this.emit(`Tests: ${result.success ? "passed" : "some failures - continuing"}`);
  this.session.advancePhase(Phase.VERIFICATION);
}
```

```typescript
private async verification(): Promise<void> {
  this.emit("Building app and running full suite...");
  const skills = await this.skills.prepareForVerification({
    workspace: this.session.workspace,
    architecture: this.arch(),
    spec: this.spec(),
    cycle: this.session.cycle,
  });
  const result = await this.agent(VerificationAgent).run({
    workspace: this.session.workspace,
    architecture: this.arch(),
    spec: this.spec(),
    skillContext: skills.skillContext,
  });
}
```

Acceptance:

- Test skills go to `TestAgent`.
- Debug/build skills go to `VerificationAgent`.
- Generic frontend skills are not injected into test/verification unless their description overlaps with test/build terms.
- Full `skill_read` remains available for native tool-loop testing and verification.

### 7.3.3 Cycle-To-Cycle Reuse

Goal:

- Use skill lifecycle records as session memory so verification cycles do not repeatedly search the same terms.

Fingerprint inputs:

```typescript
export interface SkillFingerprintInput {
  moment: SkillPipelineMoment;
  phase: string;
  query?: string;
  architecture?: string;
  taskTitles?: string[];
  failures?: string[];
  cycle?: number;
}
```

Fingerprint function:

```typescript
import { createHash } from "crypto";

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
```

Storage policy:

- Prefer existing `skill_queries` rows for query-level reuse.
- Keep in-memory `Set<string>` for fingerprints during a single run.
- If Phase 1 DB helpers are not enough, add a small `skill_pipeline_marks` table only if necessary. Avoid it for v1 if query and selection rows are enough.

Reuse behavior:

| Case | Behavior |
|---|---|
| Same session, same query, same phase | Reuse previous selected/audited/installed skills |
| Resume at `CODING` with installed skills | Build context runtime from installed inventory; do not search |
| Resume with selected but not installed skills | Run audit/install if needed; do not search |
| New verification failure text | Run failure discovery once |
| Repeated failure text in later cycle | Reuse failure-specific skills |

Acceptance:

- Resume does not duplicate `skill_queries` for the same phase/query.
- Resume does not duplicate installs if files are already verified.
- Skill injection can happen again per agent call; injection records are evidence, not dedupe markers.

## 7.4 Live Events

### 7.4.1 Selected Skill Event

Goal:

- Show the user what Forge selected without dumping search output.

Event examples:

```text
Skills: selected web-design-guidelines for ARCHITECTURE
Skills: selected vitest-testing for CODING
Skills: selected deploy-to-vercel for DEPLOY
```

Implementation:

```typescript
private emitSelected(moment: SkillPipelineMoment, selected: RankedSkillCandidate[]): void {
  for (const item of selected.slice(0, 3)) {
    this.emit(`Skills: selected ${item.candidate.skillName} for ${moment}`);
  }
  if (selected.length > 3) {
    this.emit(`Skills: selected ${selected.length - 3} more skill(s) for ${moment}`);
  }
}
```

Policy:

- Emit at most three selected skill names per moment.
- Include the moment or phase.
- Do not include full descriptions in the live feed.

### 7.4.2 Skipped Skill Event

Goal:

- Make skip decisions visible without flooding the feed with every low-score candidate.

Event examples:

```text
Skills: skipped 7 candidate(s) for CODING
Skills: skipped unknown/repo@frontend-design: below install threshold
```

Implementation:

```typescript
private emitSkipped(moment: SkillPipelineMoment, ranked: RankedSkillCandidate[]): void {
  const skipped = ranked.filter((item) => !item.selected);
  if (!skipped.length) return;

  const notable = skipped.find((item) => item.skipReason);
  if (notable) {
    this.emit(`Skills: skipped ${notable.candidate.packageRef}@${notable.candidate.skillName}: ${notable.skipReason}`);
  }
  if (skipped.length > 1) {
    this.emit(`Skills: skipped ${skipped.length} candidate(s) for ${moment}`);
  }
}
```

Policy:

- Emit one representative skip reason plus a count.
- Persist detailed reasons in Phase 1/3 selection rows.
- Do not live-print every skipped result.

### 7.4.3 Install And Injection Event

Goal:

- Show when a selected skill became available to an agent.

Install event examples:

```text
Skills: installed 2 skill(s) into workspace
Skills: installed 1 skill(s) into task workspace 8b3a1c2d
```

Injection event examples:

```text
Skills: injecting 1 skill into ArchitectureAgent
Skills: injecting 2 skills into CodingAgent for task 8b3a1c2d
Skills: no relevant skills for ReviewAgent
```

Implementation:

```typescript
private emitInstallSummary(
  moment: SkillPipelineMoment,
  workspace: string,
  skills: AuditedSkillForInstall[],
): void {
  if (!skills.length) return;
  const scope = workspace === this.deps.workspace
    ? "workspace"
    : `task workspace ${path.basename(workspace)}`;
  this.emit(`Skills: installed ${skills.length} skill(s) into ${scope}`);
}
```

Dedicated `skill` live kind:

```typescript
export type EventKind = "llm" | "tool" | "cmd" | "skill";
export type LogKind = "phase" | "llm" | "tool" | "cmd" | "skill";
```

Recommendation:

- Use phase events for v1 implementation if changing UI types adds churn.
- Add `skill` kind only if the implementation is already touching live feed tests.
- Either way, DB events should store the message with the current phase.

## Agent Behavior Matrix

| Agent | Current call style | Phase 7 default | Discovery trigger | Install workspace | Context mode | Full skill read |
|---|---|---|---|---|---|---|
| `IdeationAgent` | one-shot | no skill context | none | none | none | no |
| `ArchitectureAgent` | one-shot | compact broad context | pre-architecture | root | `one-shot` | no |
| `TaskGraphAgent` | one-shot | no skill context v1 | none or cached stack discovery | root | none | no |
| `CodingAgent` | tool loop or external | task-specific context | pre-coding phase | root or task workspace | native/external | yes for native |
| `ReviewAgent` | one-shot | no skill context v1 | none | none | none | no |
| `IntegrationAgent` | tool loop or external | stack/integration context | pre-integration | root | native/external | yes for native |
| `TestAgent` | tool loop or external | testing context | pre-testing | root | native/external | yes for native |
| `VerificationAgent` | tool loop or external | build/test/failure context | pre-verification | root | native/external | yes for native |
| `DeployAgent` | direct shell or external | deploy context for external only | pre-deploy | root | external | external-native only |

## Overseer Integration Plan

### Constructor

Add a coordinator field:

```typescript
export class Overseer {
  private emit: (msg: string) => void;
  private liveEvent?: LiveEventFn;
  private skills: SkillPipelineCoordinator | NoopSkillPipelineCoordinator;

  constructor(
    private session: Session,
    eventCallback?: (msg: string) => void,
    liveEvent?: LiveEventFn,
  ) {
    this.emit = (msg) => {
      this.session.db.logEvent(this.session.id, this.session.phase, msg);
      eventCallback?.(msg);
    };
    this.liveEvent = liveEvent;
    this.skills = createSkillPipelineCoordinator({
      session: this.session,
      emit: this.emit,
      liveEvent: this.liveEvent,
    });
  }
}
```

Factory:

```typescript
export function createSkillPipelineCoordinator(input: {
  session: Session;
  emit?: (message: string) => void;
  liveEvent?: LiveEventFn;
}): SkillPipelineCoordinator | NoopSkillPipelineCoordinator {
  const config = input.session.config.skills;
  if (!config || config.mode !== "auto" || config.maxSkills <= 0) {
    return new NoopSkillPipelineCoordinator();
  }

  const skillsCli = new SkillsCli();
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
    emit: input.emit,
    liveEvent: input.liveEvent as any,
  });
}
```

### Architecture

```typescript
private async architecture(): Promise<void> {
  this.emit("Picking stack & file structure...");
  const skills = await this.skills.prepareForArchitecture({ spec: this.spec() });
  const result = await this.agent(ArchitectureAgent).run({
    spec: this.spec(),
    skillContext: skills.skillContext,
  });
  if (result.success) {
    this.session.db.updateSession(this.session.id, { architecture: result.output });
    // existing summary handling
  }
  this.session.advancePhase(Phase.TASK_GRAPH);
}
```

### Task Graph

Default v1 no injection, but keep optional pass-through:

```typescript
private async taskGraph(): Promise<void> {
  this.emit("Building task dependency graph...");
  const skills = await this.skills.prepareForTaskGraph({
    spec: this.spec(),
    architecture: this.arch(),
  });
  const result = await this.agent(TaskGraphAgent).run({
    spec: this.spec(),
    architecture: this.arch(),
    skillContext: skills.skillContext,
  });
  // existing parsing and task creation
}
```

The no-op preparation should return no skill context in v1.

### Coding

```typescript
private async coding(): Promise<void> {
  const pending = this.session.db.getTasks(this.session.id, "pending");
  if (!pending.length) { this.session.advancePhase(Phase.INTEGRATION); return; }

  await this.skills.prepareForCodingPhase({
    spec: this.spec(),
    architecture: this.arch(),
    pendingTasks: pending.map((t) => ({
      id: String(t["id"]),
      title: String(t["title"]),
      type: String(t["type"] ?? "coding"),
    })),
    cycle: this.session.cycle,
  });

  this.emit(`Coding ${pending.length} tasks in parallel...`);
  // existing isolation logic continues
}
```

### Integration

```typescript
private async integration(): Promise<void> {
  this.emit("Wiring modules together...");
  const skills = await this.skills.prepareForIntegration({
    workspace: this.session.workspace,
    architecture: this.arch(),
    spec: this.spec(),
    cycle: this.session.cycle,
  });
  const result = await this.agent(IntegrationAgent).run({
    workspace: this.session.workspace,
    spec: this.spec(),
    architecture: this.arch(),
    skillContext: skills.skillContext,
  });
  this.emit(`Integration: ${result.success ? "all imports resolved" : "failed"}`);
  this.session.advancePhase(Phase.TESTING);
}
```

### Deploy

```typescript
private async deploy(): Promise<void> {
  this.emit("Deploying...");
  const externalAgent = externalAgentFor(this.session.router.modelFor(ModelTier.STANDARD));
  const skills = await this.skills.prepareForDeploy({
    workspace: this.session.workspace,
    architecture: this.arch(),
    target: this.session.deployTarget ?? "none",
    externalAgent,
  });
  const result = await this.agent(DeployAgent).run({
    workspace: this.session.workspace,
    architecture: this.arch(),
    target: this.session.deployTarget ?? "none",
    skillContext: skills.skillContext,
  });
  this.emit(`Deploy: ${result.success ? "live" : "failed"} - ${result.output.slice(0, 80)}`);
  this.session.advancePhase(Phase.DONE);
}
```

Deploy policy:

- If `DeployAgent` is in direct shell mode, skill context is ignored.
- If `DeployAgent` is in external-agent mode, install deploy skills into root workspace and pass compact external context.

## Agent Argument Pass-Through

### ArchitectureAgent

```typescript
const response = await this.call(messages, undefined, {
  skillContext: args["skillContext"] as SkillContextRuntime | undefined,
});
```

### CodingAgent

```typescript
const summary = await this.runAgenticLoop(messages, workspace, taskId, {
  skillContext: args["skillContext"] as SkillContextRuntime | undefined,
});
```

### IntegrationAgent

```typescript
const summary = await this.runAgenticLoop(messages, String(args["workspace"] ?? ""), undefined, {
  skillContext: args["skillContext"] as SkillContextRuntime | undefined,
});
```

### TestAgent

```typescript
const summary = await this.runAgenticLoop(messages, workspace, undefined, {
  skillContext: args["skillContext"] as SkillContextRuntime | undefined,
});
```

### VerificationAgent

```typescript
const response = await this.runAgenticLoop(messages, workspace, undefined, {
  skillContext: args["skillContext"] as SkillContextRuntime | undefined,
});
```

### DeployAgent

```typescript
const output = await this.runAgenticLoop(messages, workspace, undefined, {
  skillContext: args["skillContext"] as SkillContextRuntime | undefined,
});
```

## Subphase Plan

## Task Group 7.1 - Ideation-To-Architecture Timing

### Task 7.1.1 - Broad Early Discovery

Implementation tasks:

- Add `prepareForArchitecture()`.
- Plan queries from idea and spec only.
- Limit broad discovery to two queries.
- Limit broad early selected skills to one.
- Audit and install passing skills into the root workspace.
- Emit selected/skipped/install summaries.
- Reuse existing selections on resume.

Acceptance:

- No skill work runs before ideation completes.
- Architecture can run with no skills if discovery yields nothing.
- Discovery does not repeat on resume when selection rows exist.

### Task 7.1.2 - Architecture Guidance Injection

Implementation tasks:

- Pass compact Phase 6 context into `ArchitectureAgent`.
- Keep one-shot cap at `min(promptCharBudget, 3000)`.
- Do not inject full `SKILL.md`.
- Add tests that architecture still receives strict JSON instructions.

Acceptance:

- `ArchitectureAgent.run()` accepts optional `skillContext`.
- Skill context is absent when skills are disabled.
- Skill context is present when a broad skill is installed and relevant.

## Task Group 7.2 - Architecture-To-Coding Timing

### Task 7.2.1 - Stack-Specific Discovery

Implementation tasks:

- Add `prepareForCodingPhase()`.
- Run after tasks exist and before parallel coding starts.
- Plan queries from spec, architecture, and pending task titles.
- Limit default queries to four.
- Respect remaining skill slots.
- Install passing skills into root workspace.

Acceptance:

- One discovery pass per coding phase.
- Parallel tasks do not each trigger search.
- Existing installed skills are reused.

### Task 7.2.2 - Task-Specific Injection

Implementation tasks:

- Add `prepareForCodingTask()`.
- Select relevant source keys per task.
- For native tasks, build context runtime from root workspace.
- For external isolated tasks, install relevant skills into task workspace before agent launch.
- Pass `skillContext` into `CodingAgent.run()`.

Acceptance:

- Native `CodingAgent` gets `native-tool-loop` mode.
- Codex `CodingAgent` gets `codex-cli` mode and `.agents/skills` installed in the task workspace.
- Claude Code `CodingAgent` gets `claude-code` mode and `.claude/skills` installed in the task workspace.
- Task workspace dot directories are discarded after merge.

## Task Group 7.3 - Verification-Loop Timing

### Task 7.3.1 - Failure-Specific Discovery

Implementation tasks:

- Add `prepareForVerificationFailure()`.
- Normalize failed and error messages.
- Fingerprint the failure set.
- Search only if another repair cycle will run.
- Install passing failure skills into root workspace.

Acceptance:

- No failure discovery after max cycles.
- New failure fingerprints trigger at most one search.
- Repeated failure fingerprints reuse existing skills.

### Task 7.3.2 - Debugging And Testing Skills

Implementation tasks:

- Add `prepareForTesting()`.
- Add `prepareForVerification()`.
- Prefer test/build/debug skills for `TestAgent` and `VerificationAgent`.
- Pass `skillContext` through agent args.

Acceptance:

- Testing gets test-framework skills.
- Verification gets build/debug/failure skills.
- Generic unrelated skills are filtered out.

### Task 7.3.3 - Cycle-To-Cycle Reuse

Implementation tasks:

- Add fingerprint helpers.
- Use Phase 1 DB getters to detect prior queries/selections/audits/installs.
- Avoid duplicate `skill_queries`.
- Idempotently reinstall only when workspace files are missing.

Acceptance:

- Resume at `CODING` does not call `skills find` for prior phase queries.
- Resume with missing workspace skill files reinstalls from audited selections.
- Injection can still be logged again for new agent calls.

## Task Group 7.4 - Live Events

### Task 7.4.1 - Selected Skill Event

Implementation tasks:

- Emit selected skill names at each discovery gate.
- Cap selected event details to three names.
- Include moment or phase in message.

Acceptance:

- Feed shows selected skills.
- DB events include selected skill messages.
- No full descriptions are emitted.

### Task 7.4.2 - Skipped Skill Event

Implementation tasks:

- Emit one representative skip reason.
- Emit skipped count.
- Persist detailed skip rationale through Phase 3 selection rows.

Acceptance:

- Feed shows a skipped summary.
- No feed flood from many low-score candidates.

### Task 7.4.3 - Install And Injection Event

Implementation tasks:

- Emit install count per workspace.
- Emit injection count per agent.
- Optionally add a dedicated `skill` event kind.

Acceptance:

- User can see when skills are installed into root or task workspace.
- User can see which agent received skill context.
- Existing live feed tests still pass.

## Test Plan

### `tests/skillsPipeline.test.ts`

```typescript
test("disabled coordinator does not call skill services", async () => {
  const services = fakeSkillServices();
  const coordinator = new SkillPipelineCoordinator({
    ...services,
    config: { ...testSkillConfig(), mode: "off" },
  });

  const prep = await coordinator.prepareForArchitecture({ spec: "{}" });

  expect(prep.enabled).toBe(false);
  expect(services.searchClient.find).not.toHaveBeenCalled();
  expect(services.installClient.install).not.toHaveBeenCalled();
});

test("prepareForArchitecture runs broad discovery once", async () => {
  const services = fakeSkillServices({
    discoverySelected: [frontendDesignCandidate()],
    auditPassed: [frontendDesignAudit()],
  });
  const coordinator = makeCoordinator(services);

  const prep = await coordinator.prepareForArchitecture({ spec: SPEC });

  expect(services.searchClient.find).toHaveBeenCalledTimes(2);
  expect(services.useClient.use).toHaveBeenCalled();
  expect(services.installClient.install).toHaveBeenCalled();
  expect(prep.skillContext).toBeDefined();
});

test("prepareForCodingPhase runs stack discovery once for all pending tasks", async () => {
  const services = fakeSkillServices();
  const coordinator = makeCoordinator(services);

  await coordinator.prepareForCodingPhase({
    spec: SPEC,
    architecture: ARCH,
    pendingTasks: [
      { id: "t1", title: "Build dashboard UI", type: "coding" },
      { id: "t2", title: "Add repository chart", type: "coding" },
    ],
    cycle: 0,
  });

  expect(services.searchClient.find.mock.calls.length).toBeLessThanOrEqual(4);
});

test("prepareForVerificationFailure skips repeated failure fingerprint", async () => {
  const services = fakeSkillServices();
  const coordinator = makeCoordinator(services);
  const input = {
    spec: SPEC,
    architecture: ARCH,
    failures: ["npm run build failed with TS2307"],
    errors: [],
    cycle: 1,
  };

  await coordinator.prepareForVerificationFailure(input);
  await coordinator.prepareForVerificationFailure(input);

  expect(services.searchClient.find.mock.calls.length).toBeLessThanOrEqual(3);
});
```

### `tests/skillsRelevance.test.ts`

```typescript
test("selectRelevantSourceKeys prefers task matching skills", () => {
  const selected = selectRelevantSourceKeys({
    moment: "pre-coding-task",
    agentName: "CodingAgent",
    installed: [
      compactSkill({ sourceKey: "react", description: "React frontend UI patterns" }),
      compactSkill({ sourceKey: "deploy", description: "Deploy to Vercel" }),
    ],
    taskTitle: "Build React dashboard UI",
    limit: 1,
  });

  expect(selected).toEqual(["react"]);
});

test("testing agent prefers test framework skills", () => {
  const selected = selectRelevantSourceKeys({
    moment: "pre-testing",
    agentName: "TestAgent",
    installed: [
      compactSkill({ sourceKey: "vitest", description: "Vitest testing patterns" }),
      compactSkill({ sourceKey: "css", description: "CSS layout guidance" }),
    ],
    architecture: JSON.stringify({ test_framework: "vitest" }),
    limit: 1,
  });

  expect(selected).toEqual(["vitest"]);
});
```

### `tests/overseerSkills.test.ts`

```typescript
test("overseer prepares skills before architecture and coding", async () => {
  const session = makeSessionWithSkillsAuto();
  const coordinator = fakeCoordinator();
  const overseer = new Overseer(session);
  (overseer as any).skills = coordinator;

  await overseer.run();

  expect(coordinator.prepareForArchitecture).toHaveBeenCalled();
  expect(coordinator.prepareForCodingPhase).toHaveBeenCalled();
  expect(coordinator.prepareForCodingTask).toHaveBeenCalled();
});

test("external codex task workspace receives skills before CodingAgent", async () => {
  const session = makeCodexSessionWithSkillsAuto();
  const workspaces: string[] = [];

  const coordinator = fakeCoordinator({
    prepareForCodingTask: jest.fn(async (input) => {
      workspaces.push(input.workspace);
      fs.mkdirSync(path.join(input.workspace, ".agents/skills/react"), { recursive: true });
      fs.writeFileSync(path.join(input.workspace, ".agents/skills/react/SKILL.md"), "---\nname: react\ndescription: React\n---\n");
      return fakeSkillPreparation();
    }),
  });

  const overseer = new Overseer(session);
  (overseer as any).skills = coordinator;
  await overseer.run();

  expect(workspaces.every((ws) => ws.includes(path.join(session.workspace, "tasks")))).toBe(true);
  expect(fs.existsSync(path.join(session.workspace, "tasks"))).toBe(false);
});

test("verification failure prepares failure skills before next coding cycle", async () => {
  const session = makeSessionWithSkillsAuto();
  const coordinator = fakeCoordinator();
  mockVerificationFailsOnceThenPasses();

  const overseer = new Overseer(session);
  (overseer as any).skills = coordinator;
  await overseer.run();

  expect(coordinator.prepareForVerificationFailure).toHaveBeenCalledWith(
    expect.objectContaining({
      failures: expect.arrayContaining(["broken"]),
      cycle: 1,
    }),
  );
});
```

### `tests/agentsSkillArgs.test.ts`

```typescript
test("CodingAgent passes skillContext to runAgenticLoop", async () => {
  const agent = new CodingAgent(fakeRouter(), fakeDb(), "session_1");
  const spy = jest.spyOn(agent as any, "runAgenticLoop").mockResolvedValue("done");
  const skillContext = fakeSkillContextRuntime();

  await agent.run({
    taskTitle: "Build UI",
    spec: "{}",
    architecture: "{}",
    workspace: "/tmp/work",
    taskId: "task_1",
    skillContext,
  });

  expect(spy).toHaveBeenCalledWith(
    expect.any(Array),
    "/tmp/work",
    "task_1",
    { skillContext },
  );
});

test("ArchitectureAgent passes skillContext to call", async () => {
  const agent = new ArchitectureAgent(fakeRouter(), fakeDb(), "session_1");
  const spy = jest.spyOn(agent as any, "call").mockResolvedValue(ARCH);
  const skillContext = fakeSkillContextRuntime();

  await agent.run({ spec: SPEC, skillContext });

  expect(spy).toHaveBeenCalledWith(
    expect.any(Array),
    undefined,
    { skillContext },
  );
});
```

## Acceptance Criteria

- [ ] Phase 7 adds no new state-machine phase.
- [ ] Skills disabled mode leaves existing pipeline behavior unchanged.
- [ ] Broad discovery runs after ideation and before architecture.
- [ ] Architecture receives compact skill context only.
- [ ] Task graph receives no skill context by default.
- [ ] Stack/task discovery runs once before a coding phase.
- [ ] Coding tasks receive task-relevant source keys only.
- [ ] External Codex task workspaces receive selected `.agents/skills` before agent launch.
- [ ] External Claude Code task workspaces receive selected `.claude/skills` before agent launch when configured.
- [ ] Integration, testing, and verification receive relevant installed skills.
- [ ] Verification failure discovery runs only when another repair cycle will run.
- [ ] Repeated failure fingerprints reuse prior skills.
- [ ] Resume reuses selected/audited/installed rows before searching.
- [ ] Live events summarize selected, skipped, installed, and injected skills.
- [ ] No `skills find` call occurs inside `BaseAgent.runAgenticLoop()`.
- [ ] No `skills find` call occurs per tool turn.
- [ ] Existing Overseer tests can use a no-op coordinator.

## Non-Goals

- No new CLI flags; Phase 8 owns user controls.
- No setup wizard changes; Phase 8 owns setup UX.
- No new audit policy; Phase 4 owns trust rules.
- No new install layout; Phase 5 owns workspace paths.
- No prompt rendering redesign; Phase 6 owns context rendering.
- No automatic global skill installation.
- No skill self-authoring or persistent skill memory.
- No ReviewAgent skill support in v1.

## Rollback Plan

Rollback is centralized:

- Instantiate `NoopSkillPipelineCoordinator`.
- Or set `config.skills.mode = "off"`.
- Or remove coordinator calls from `Overseer`.

Expected rollback effect:

- Existing agents receive no `skillContext`.
- Existing prompt rendering and tools remain available but unused.
- Installed skill directories may remain in workspaces but are inert.
- Existing sessions can resume because Phase 7 does not add state-machine phases.

## Research Gate Closure

- [x] Mapped current `Overseer` phase flow.
- [x] Identified one-shot and tool-loop agents.
- [x] Identified external-agent isolated coding workspaces.
- [x] Identified verification failure cycle behavior.
- [x] Compared timing needs with prior Phase 3, 4, 5, and 6 APIs.
- [x] Confirmed external agent project skill paths from Codex, Claude Code, OpenCode, and skills CLI docs.
- [x] Defined low-noise discovery gates.
- [x] Defined agent-by-agent context policy.
- [x] Defined live event wording.
