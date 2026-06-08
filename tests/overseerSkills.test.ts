import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Overseer } from "../src/overseer.js";
import { ForgeDb } from "../src/db.js";
import { Phase } from "../src/stateMachine.js";
import {
  NoopSkillPipelineCoordinator,
  type SkillAgentPreparation,
} from "../src/skills/pipeline.js";

jest.mock("../src/codexDriver.js", () => ({
  CodexDriver: jest.fn().mockImplementation(() => ({
    runTask: jest.fn().mockResolvedValue("codex output"),
  })),
}));

jest.mock("../src/claudeCodeDriver.js", () => ({
  ClaudeCodeDriver: jest.fn().mockImplementation(() => ({
    runTask: jest.fn().mockResolvedValue("claude code output"),
  })),
}));

const ARCH = JSON.stringify({ stack: { language: "TypeScript" }, test_framework: "vitest", verification_method: "cli" });
const SPEC = JSON.stringify({ name: "todo app" });
const VERIFICATION_PASS = JSON.stringify({ passed: ["Build succeeded"], failed: [], errors: [] });
const TASK_GRAPH = JSON.stringify([{ title: "Build UI", type: "coding", deps: [] }]);

function disabled(moment: string): SkillAgentPreparation {
  return {
    moment: moment as any,
    enabled: false,
    reason: "test noop",
    relevantSourceKeys: [],
    skillContext: undefined,
  };
}

function makeFakeCoordinator(overrides: Partial<Record<string, jest.Mock>> = {}) {
  return {
    prepareForArchitecture: jest.fn().mockResolvedValue(disabled("pre-architecture")),
    prepareForTaskGraph: jest.fn().mockResolvedValue(disabled("pre-task-graph")),
    prepareForCodingPhase: jest.fn().mockResolvedValue(undefined),
    prepareForCodingTask: jest.fn().mockResolvedValue(disabled("pre-coding-task")),
    prepareForIntegration: jest.fn().mockResolvedValue(disabled("pre-integration")),
    prepareForTesting: jest.fn().mockResolvedValue(disabled("pre-testing")),
    prepareForVerification: jest.fn().mockResolvedValue(disabled("pre-verification")),
    prepareForVerificationFailure: jest.fn().mockResolvedValue(undefined),
    prepareForDeploy: jest.fn().mockResolvedValue(disabled("pre-deploy")),
    ...overrides,
  };
}

function makeRouter(responses: { complete?: string; completeWithTools?: string } = {}) {
  let callCount = 0;
  return {
    modelFor: jest.fn().mockReturnValue("claude-haiku"),
    override: jest.fn(),
    hasAutoSelector: jest.fn().mockReturnValue(false),
    selectForAgent: jest.fn().mockResolvedValue("claude-haiku"),
    complete: jest.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return { content: SPEC, model: "claude-haiku", tokensIn: 0, tokensOut: 0, costUsd: 0 };
      if (callCount === 2) return { content: ARCH, model: "claude-haiku", tokensIn: 0, tokensOut: 0, costUsd: 0 };
      if (callCount === 3) return { content: TASK_GRAPH, model: "claude-haiku", tokensIn: 0, tokensOut: 0, costUsd: 0 };
      return { content: ARCH, model: "claude-haiku", tokensIn: 0, tokensOut: 0, costUsd: 0 };
    }),
    completeWithTools: jest.fn().mockResolvedValue({
      text: VERIFICATION_PASS,
      toolCalls: [],
      model: "claude-haiku",
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
    }),
  };
}

function makeSession(workspace: string, deployTarget?: string) {
  const db = new ForgeDb(":memory:");
  const sessionId = db.createSession("test idea");
  db.updateSession(sessionId, { workspace });
  const config = {
    skills: {
      mode: "off" as const,
      maxSkills: 5,
      promptCharBudget: 12000,
      minInstallCount: 0,
      trustedSources: [],
      installTargets: ["forge" as const],
    },
    maxCycles: 3,
    toJson: () => ({}),
    tierModels: () => ({} as any),
  };
  const router = makeRouter();
  return {
    id: sessionId,
    idea: "test idea",
    phase: Phase.IDEATION,
    cycle: 0,
    maxCycles: 3,
    deployTarget,
    workspace,
    db,
    router,
    config,
    advancePhase: jest.fn().mockImplementation((p: Phase) => {
      (session as any).phase = p;
    }),
    incrementCycle: jest.fn().mockImplementation(() => {
      (session as any).cycle += 1;
    }),
  };
  const session = arguments[arguments.length - 1] as any;
  return session;
}

let workspace: string;
beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "forge-overseer-test-"));
});
afterEach(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

// --- Coordinator injection ---

test("overseer creates skills field on construction", () => {
  const db = new ForgeDb(":memory:");
  const sessionId = db.createSession("test");
  db.updateSession(sessionId, { workspace });
  const router = makeRouter();
  const session: any = {
    id: sessionId,
    idea: "test",
    phase: Phase.DONE,
    cycle: 0,
    maxCycles: 3,
    deployTarget: undefined,
    workspace,
    db,
    router,
    config: {
      skills: { mode: "off" as const, maxSkills: 0, promptCharBudget: 0, minInstallCount: 0, trustedSources: [], installTargets: [] },
    },
    advancePhase: jest.fn(),
    incrementCycle: jest.fn(),
  };
  const overseer = new Overseer(session as any);
  expect((overseer as any).skills).toBeDefined();
  db.close();
});

test("skills is NoopSkillPipelineCoordinator when mode is off", () => {
  const db = new ForgeDb(":memory:");
  const sessionId = db.createSession("test");
  db.updateSession(sessionId, { workspace });
  const router = makeRouter();
  const session: any = {
    id: sessionId,
    idea: "test",
    phase: Phase.DONE,
    cycle: 0,
    maxCycles: 3,
    deployTarget: undefined,
    workspace,
    db,
    router,
    config: {
      skills: { mode: "off" as const, maxSkills: 0, promptCharBudget: 0, minInstallCount: 0, trustedSources: [], installTargets: [] },
    },
    advancePhase: jest.fn(),
    incrementCycle: jest.fn(),
  };
  const overseer = new Overseer(session as any);
  expect((overseer as any).skills).toBeInstanceOf(NoopSkillPipelineCoordinator);
  db.close();
});

// --- Coordinator called at right moments ---

test("overseer calls prepareForArchitecture before architecture agent", async () => {
  const db = new ForgeDb(":memory:");
  const sessionId = db.createSession("test");
  db.updateSession(sessionId, { workspace, spec: SPEC });
  const router = makeRouter();
  router.complete.mockResolvedValue({ content: ARCH, model: "claude-haiku", tokensIn: 0, tokensOut: 0, costUsd: 0 });
  const coordinator = makeFakeCoordinator();
  const session: any = {
    id: sessionId,
    idea: "test idea",
    phase: Phase.ARCHITECTURE,
    cycle: 0,
    maxCycles: 3,
    deployTarget: undefined,
    workspace,
    db,
    router,
    config: { skills: { mode: "off" as const, maxSkills: 0, promptCharBudget: 0, minInstallCount: 0, trustedSources: [], installTargets: [] } },
    advancePhase: jest.fn().mockImplementation((p: Phase) => { session.phase = p === Phase.TASK_GRAPH ? Phase.DONE : p; }),
    incrementCycle: jest.fn(),
  };
  const overseer = new Overseer(session as any);
  (overseer as any).skills = coordinator;

  session.phase = Phase.ARCHITECTURE;
  await (overseer as any).architecture();

  expect(coordinator.prepareForArchitecture).toHaveBeenCalledWith({ spec: SPEC });
  db.close();
});

test("overseer calls prepareForCodingPhase before parallel coding", async () => {
  const db = new ForgeDb(":memory:");
  const sessionId = db.createSession("test");
  db.updateSession(sessionId, { workspace, spec: SPEC, architecture: ARCH });
  const taskId = db.createTask(sessionId, "Build UI", "coding");
  const router = makeRouter();
  router.completeWithTools.mockResolvedValue({
    text: "done coding",
    toolCalls: [],
    model: "claude-haiku",
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
  });
  const coordinator = makeFakeCoordinator();
  const session: any = {
    id: sessionId,
    idea: "test idea",
    phase: Phase.CODING,
    cycle: 0,
    maxCycles: 3,
    deployTarget: undefined,
    workspace,
    db,
    router,
    config: { skills: { mode: "off" as const, maxSkills: 0, promptCharBudget: 0, minInstallCount: 0, trustedSources: [], installTargets: [] } },
    advancePhase: jest.fn().mockImplementation((p: Phase) => { session.phase = Phase.DONE; }),
    incrementCycle: jest.fn(),
  };
  const overseer = new Overseer(session as any);
  (overseer as any).skills = coordinator;

  await (overseer as any).coding();

  expect(coordinator.prepareForCodingPhase).toHaveBeenCalledWith(
    expect.objectContaining({ cycle: 0 }),
  );
  expect(coordinator.prepareForCodingTask).toHaveBeenCalled();
  db.close();
});

test("overseer calls prepareForVerificationFailure after verification fails", async () => {
  const db = new ForgeDb(":memory:");
  const sessionId = db.createSession("test");
  db.updateSession(sessionId, { workspace, spec: SPEC, architecture: ARCH });
  const router = makeRouter();
  const failureReport = JSON.stringify({ passed: [], failed: ["broken test"], errors: [] });
  router.completeWithTools.mockResolvedValue({
    text: failureReport,
    toolCalls: [],
    model: "claude-haiku",
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
  });
  const coordinator = makeFakeCoordinator();
  let capturedPhase: Phase | null = null;
  const session: any = {
    id: sessionId,
    idea: "test idea",
    phase: Phase.VERIFICATION,
    cycle: 0,
    maxCycles: 3,
    deployTarget: undefined,
    workspace,
    db,
    router,
    config: { skills: { mode: "off" as const, maxSkills: 0, promptCharBudget: 0, minInstallCount: 0, trustedSources: [], installTargets: [] } },
    advancePhase: jest.fn().mockImplementation((p: Phase) => {
      capturedPhase = p;
      session.phase = p;
    }),
    incrementCycle: jest.fn().mockImplementation(() => { session.cycle = 1; }),
  };
  const overseer = new Overseer(session as any);
  (overseer as any).skills = coordinator;

  await (overseer as any).verification();

  expect(coordinator.prepareForVerificationFailure).toHaveBeenCalledWith(
    expect.objectContaining({
      failures: expect.arrayContaining(["broken test"]),
      cycle: 1,
    }),
  );
  db.close();
});

test("overseer calls prepareForIntegration before integration agent", async () => {
  const db = new ForgeDb(":memory:");
  const sessionId = db.createSession("test");
  db.updateSession(sessionId, { workspace, spec: SPEC, architecture: ARCH });
  const router = makeRouter();
  router.completeWithTools.mockResolvedValue({ text: "integrated", toolCalls: [], model: "claude-haiku", tokensIn: 0, tokensOut: 0, costUsd: 0 });
  const coordinator = makeFakeCoordinator();
  const session: any = {
    id: sessionId,
    idea: "test idea",
    phase: Phase.INTEGRATION,
    cycle: 0,
    maxCycles: 3,
    deployTarget: undefined,
    workspace,
    db,
    router,
    config: { skills: { mode: "off" as const, maxSkills: 0, promptCharBudget: 0, minInstallCount: 0, trustedSources: [], installTargets: [] } },
    advancePhase: jest.fn().mockImplementation((p: Phase) => { session.phase = Phase.DONE; }),
    incrementCycle: jest.fn(),
  };
  const overseer = new Overseer(session as any);
  (overseer as any).skills = coordinator;

  await (overseer as any).integration();

  expect(coordinator.prepareForIntegration).toHaveBeenCalledWith(
    expect.objectContaining({ workspace, cycle: 0 }),
  );
  db.close();
});

test("overseer calls prepareForTesting before test agent", async () => {
  const db = new ForgeDb(":memory:");
  const sessionId = db.createSession("test");
  db.updateSession(sessionId, { workspace, spec: SPEC, architecture: ARCH });
  const router = makeRouter();
  router.completeWithTools.mockResolvedValue({ text: "all tests passed", toolCalls: [], model: "claude-haiku", tokensIn: 0, tokensOut: 0, costUsd: 0 });
  const coordinator = makeFakeCoordinator();
  const session: any = {
    id: sessionId,
    idea: "test idea",
    phase: Phase.TESTING,
    cycle: 0,
    maxCycles: 3,
    deployTarget: undefined,
    workspace,
    db,
    router,
    config: { skills: { mode: "off" as const, maxSkills: 0, promptCharBudget: 0, minInstallCount: 0, trustedSources: [], installTargets: [] } },
    advancePhase: jest.fn().mockImplementation((p: Phase) => { session.phase = Phase.DONE; }),
    incrementCycle: jest.fn(),
  };
  const overseer = new Overseer(session as any);
  (overseer as any).skills = coordinator;

  await (overseer as any).testing();

  expect(coordinator.prepareForTesting).toHaveBeenCalledWith(
    expect.objectContaining({ workspace, cycle: 0 }),
  );
  db.close();
});

test("overseer calls prepareForDeploy before deploy agent", async () => {
  const db = new ForgeDb(":memory:");
  const sessionId = db.createSession("test");
  db.updateSession(sessionId, { workspace, spec: SPEC, architecture: ARCH });
  const router = makeRouter();
  router.completeWithTools.mockResolvedValue({ text: "deployed", toolCalls: [], model: "claude-haiku", tokensIn: 0, tokensOut: 0, costUsd: 0 });
  const coordinator = makeFakeCoordinator();
  const session: any = {
    id: sessionId,
    idea: "test idea",
    phase: Phase.DEPLOY,
    cycle: 0,
    maxCycles: 3,
    deployTarget: "vercel",
    workspace,
    db,
    router,
    config: { skills: { mode: "off" as const, maxSkills: 0, promptCharBudget: 0, minInstallCount: 0, trustedSources: [], installTargets: [] } },
    advancePhase: jest.fn().mockImplementation((p: Phase) => { session.phase = Phase.DONE; }),
    incrementCycle: jest.fn(),
  };
  const overseer = new Overseer(session as any);
  (overseer as any).skills = coordinator;

  // DeployAgent in external mode needs router.modelFor to return "codex" for external
  // But with "claude-haiku" it uses execSync — patch deploy to avoid that
  jest.spyOn(overseer as any, "agent").mockReturnValue({
    run: jest.fn().mockResolvedValue({ success: true, output: "deployed to vercel" }),
  });

  await (overseer as any).deploy();

  expect(coordinator.prepareForDeploy).toHaveBeenCalledWith(
    expect.objectContaining({ target: "vercel" }),
  );
  db.close();
});
