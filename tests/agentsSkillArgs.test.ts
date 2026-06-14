import { ArchitectureAgent } from "../src/agents/architecture.js";
import { TaskGraphAgent } from "../src/agents/taskGraph.js";
import { CodingAgent } from "../src/agents/coding.js";
import { IntegrationAgent } from "../src/agents/integration.js";
import { TestAgent } from "../src/agents/testAgent.js";
import { VerificationAgent } from "../src/agents/verification.js";
import { DeployAgent } from "../src/agents/deploy.js";
import { ForgeDb } from "../src/db.js";
import type { SkillContextRuntime } from "../src/skills/toolExecutor.js";

jest.mock("../src/codexDriver.js", () => ({
  CodexDriver: jest.fn().mockImplementation(() => ({
    runTask: jest.fn().mockResolvedValue("codex output"),
  })),
}));

const ARCH = JSON.stringify({ stack: { language: "TypeScript" }, test_framework: "vitest" });
const SPEC = JSON.stringify({ name: "todo app" });

function makeRouter(overrides: Record<string, jest.Mock> = {}) {
  return {
    modelFor: jest.fn().mockReturnValue("claude-haiku"),
    override: jest.fn(),
    hasAutoSelector: jest.fn().mockReturnValue(false),
    selectForAgent: jest.fn().mockResolvedValue("claude-haiku"),
    complete: jest.fn().mockResolvedValue({
      content: ARCH,
      model: "claude-haiku",
      tokensIn: 10,
      tokensOut: 5,
      costUsd: 0.001,
    }),
    completeWithTools: jest.fn().mockResolvedValue({
      text: "done",
      toolCalls: [],
      model: "claude-haiku",
      tokensIn: 10,
      tokensOut: 5,
      costUsd: 0,
    }),
    ...overrides,
  };
}

function makeDb() {
  const db = new ForgeDb(":memory:");
  const sessionId = db.createSession("test idea");
  return { db, sessionId };
}

function fakeSkillContextRuntime(): SkillContextRuntime {
  const provider = {
    renderCompact: jest.fn().mockReturnValue({ kind: "compact", content: "", charCount: 0, sourceKeys: [], truncated: false }),
    listCompact: jest.fn().mockReturnValue([]),
    readSkill: jest.fn(),
  } as any;
  const request = {
    workspace: "/tmp/test",
    agentName: "TestAgent",
    attempt: 1,
    mode: "native-tool-loop" as const,
    maxChars: 12000,
    selectionIdsBySourceKey: {},
  };
  const { SkillContextRuntime } = require("../src/skills/toolExecutor.js");
  return new SkillContextRuntime(provider, request);
}

// --- ArchitectureAgent ---

test("ArchitectureAgent passes skillContext to call", async () => {
  const { db, sessionId } = makeDb();
  const router = makeRouter();
  router.complete.mockResolvedValue({ content: ARCH, model: "claude-haiku", tokensIn: 0, tokensOut: 0, costUsd: 0 });
  const agent = new ArchitectureAgent(router as any, db, sessionId);
  const spy = jest.spyOn(agent as any, "call").mockResolvedValue(ARCH);
  const skillContext = fakeSkillContextRuntime();

  await agent.run({ spec: SPEC, skillContext });

  expect(spy).toHaveBeenCalledWith(
    expect.any(Array),
    undefined,
    { skillContext },
  );
  db.close();
});

test("ArchitectureAgent without skillContext passes empty options to call", async () => {
  const { db, sessionId } = makeDb();
  const router = makeRouter();
  const agent = new ArchitectureAgent(router as any, db, sessionId);
  const spy = jest.spyOn(agent as any, "call").mockResolvedValue(ARCH);

  await agent.run({ spec: SPEC });

  expect(spy).toHaveBeenCalledWith(
    expect.any(Array),
    undefined,
    { skillContext: undefined },
  );
  db.close();
});

// --- TaskGraphAgent ---

test("TaskGraphAgent passes skillContext to call", async () => {
  const { db, sessionId } = makeDb();
  const router = makeRouter();
  const agent = new TaskGraphAgent(router as any, db, sessionId);
  const spy = jest.spyOn(agent as any, "call").mockResolvedValue("[]");
  const skillContext = fakeSkillContextRuntime();

  await agent.run({ spec: SPEC, architecture: ARCH, skillContext });

  expect(spy).toHaveBeenCalledWith(
    expect.any(Array),
    undefined,
    { skillContext },
  );
  db.close();
});

// --- CodingAgent ---

test("CodingAgent passes skillContext to runAgenticLoop", async () => {
  const { db, sessionId } = makeDb();
  const router = makeRouter();
  const agent = new CodingAgent(router as any, db, sessionId);
  const spy = jest.spyOn(agent as any, "runAgenticLoop").mockResolvedValue("done");
  const skillContext = fakeSkillContextRuntime();

  await agent.run({
    taskTitle: "Build UI",
    spec: SPEC,
    architecture: ARCH,
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
  db.close();
});

test("CodingAgent without skillContext passes empty options", async () => {
  const { db, sessionId } = makeDb();
  const router = makeRouter();
  const agent = new CodingAgent(router as any, db, sessionId);
  const spy = jest.spyOn(agent as any, "runAgenticLoop").mockResolvedValue("done");

  await agent.run({
    taskTitle: "Build UI",
    spec: SPEC,
    architecture: ARCH,
    workspace: "/tmp/work",
    taskId: "task_1",
  });

  expect(spy).toHaveBeenCalledWith(
    expect.any(Array),
    "/tmp/work",
    "task_1",
    { skillContext: undefined },
  );
  db.close();
});

// --- IntegrationAgent ---

test("IntegrationAgent passes skillContext to runAgenticLoop", async () => {
  const { db, sessionId } = makeDb();
  const router = makeRouter();
  const agent = new IntegrationAgent(router as any, db, sessionId);
  const spy = jest.spyOn(agent as any, "runAgenticLoop").mockResolvedValue("done");
  const skillContext = fakeSkillContextRuntime();

  await agent.run({ workspace: "/tmp/work", spec: SPEC, architecture: ARCH, skillContext });

  expect(spy).toHaveBeenCalledWith(
    expect.any(Array),
    "/tmp/work",
    undefined,
    { skillContext },
  );
  db.close();
});

// --- TestAgent ---

test("TestAgent passes skillContext to runAgenticLoop", async () => {
  const { db, sessionId } = makeDb();
  const router = makeRouter();
  const agent = new TestAgent(router as any, db, sessionId);
  const spy = jest.spyOn(agent as any, "runAgenticLoop").mockResolvedValue("all tests passed");
  const skillContext = fakeSkillContextRuntime();

  await agent.run({ workspace: "/tmp/work", architecture: ARCH, skillContext });

  expect(spy).toHaveBeenCalledWith(
    expect.any(Array),
    "/tmp/work",
    undefined,
    { skillContext },
  );
  db.close();
});

// --- VerificationAgent ---

test("VerificationAgent passes skillContext to runAgenticLoop", async () => {
  const { db, sessionId } = makeDb();
  const router = makeRouter();
  const agent = new VerificationAgent(router as any, db, sessionId);
  const spy = jest.spyOn(agent as any, "runAgenticLoop").mockResolvedValue(
    JSON.stringify({ passed: [], failed: [], errors: [] }),
  );
  const skillContext = fakeSkillContextRuntime();

  await agent.run({ workspace: "/tmp/work", architecture: ARCH, spec: SPEC, skillContext });

  expect(spy).toHaveBeenCalledWith(
    expect.any(Array),
    "/tmp/work",
    undefined,
    { skillContext },
  );
  db.close();
});

// --- DeployAgent (external-agent mode) ---

test("DeployAgent passes skillContext to runAgenticLoop in external mode", async () => {
  const { db, sessionId } = makeDb();
  const router = makeRouter({
    modelFor: jest.fn().mockReturnValue("codex"),
  });
  const agent = new DeployAgent(router as any, db, sessionId);
  const spy = jest.spyOn(agent as any, "runAgenticLoop").mockResolvedValue("deployed");
  const skillContext = fakeSkillContextRuntime();

  await agent.run({ workspace: "/tmp/work", architecture: ARCH, target: "vercel", skillContext });

  expect(spy).toHaveBeenCalledWith(
    expect.any(Array),
    "/tmp/work",
    undefined,
    { skillContext },
  );
  db.close();
});
