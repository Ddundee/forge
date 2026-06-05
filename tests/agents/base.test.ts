import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { BaseAgent, AgentResult } from "../../src/agents/base.js";
import { LLMRouter, ModelTier } from "../../src/router.js";
import { ForgeDb } from "../../src/db.js";

jest.mock("../../src/codexDriver.js", () => ({
  CodexDriver: jest.fn().mockImplementation(() => ({
    runTask: jest.fn().mockResolvedValue("codex output"),
  })),
}));

class ConcreteAgent extends BaseAgent {
  constructor(router: any, db: any, sessionId: string, onLiveEvent?: any) {
    super(router, db, sessionId, onLiveEvent);
  }
  async run(): Promise<AgentResult> {
    const content = await this.call([{ role: "user", content: "hello" }]);
    return { success: true, output: content };
  }
}

class LoopAgent extends BaseAgent {
  constructor(router: any, db: any, sessionId: string, onLiveEvent?: any) {
    super(router, db, sessionId, onLiveEvent);
  }
  async run(args: Record<string, unknown>): Promise<AgentResult> {
    const content = await this.runAgenticLoop(
      [{ role: "system", content: "sys" }, { role: "user", content: "task" }],
      String(args["workspace"] ?? os.tmpdir()),
    );
    return { success: true, output: content };
  }
}

let db: ForgeDb;
let sessionId: string;
let mockRouter: jest.Mocked<LLMRouter>;

beforeEach(() => {
  db = new ForgeDb(":memory:");
  sessionId = db.createSession("test idea");
  mockRouter = {
    modelFor: jest.fn().mockReturnValue("claude-haiku"),
    override: jest.fn(),
    hasAutoSelector: jest.fn().mockReturnValue(false),
    complete: jest.fn().mockResolvedValue({ content: "test response", model: "claude-haiku", tokensIn: 10, tokensOut: 5, costUsd: 0.001 }),
    completeWithTools: jest.fn(),
  } as any;
});

afterEach(() => db.close());

test("call returns LLM content", async () => {
  const agent = new ConcreteAgent(mockRouter, db, sessionId);
  const result = await agent.run();
  expect(result.output).toBe("test response");
});

test("call logs llm_call to db", async () => {
  const agent = new ConcreteAgent(mockRouter, db, sessionId);
  await agent.run();
  expect(db.getTotalCost(sessionId)).toBeCloseTo(0.001);
});

test("extractJson handles fenced markdown", () => {
  const agent = new ConcreteAgent(mockRouter, db, sessionId);
  const result = (agent as any).extractJson('```json\n{"key": "value"}\n```');
  expect(JSON.parse(result)).toEqual({ key: "value" });
});

test("extractJson handles embedded JSON in prose", () => {
  const agent = new ConcreteAgent(mockRouter, db, sessionId);
  const result = (agent as any).extractJson('Here is the data: {"key": 42} — done.');
  expect(JSON.parse(result)).toEqual({ key: 42 });
});

test("call routes to CodexDriver when model tier resolves to 'codex'", async () => {
  mockRouter.modelFor.mockReturnValue("codex");
  const agent = new ConcreteAgent(mockRouter, db, sessionId);
  const result = await agent.run();
  expect(result.output).toBe("codex output");
  expect(mockRouter.complete).not.toHaveBeenCalled();
});

test("call logs CODEX_CALL event when in codex mode", async () => {
  mockRouter.modelFor.mockReturnValue("codex");
  const agent = new ConcreteAgent(mockRouter, db, sessionId);
  await agent.run();
  const events = db.getEvents(sessionId);
  expect(events.some((e) => String(e["phase"]) === "CODEX_CALL")).toBe(true);
});

test("runAgenticLoop routes to CodexDriver when model is codex", async () => {
  mockRouter.modelFor.mockReturnValue("codex");
  const tmpWs = fs.mkdtempSync(path.join(os.tmpdir(), "forge-test-ws-"));
  try {
    const agent = new LoopAgent(mockRouter, db, sessionId);
    const result = await agent.run({ workspace: tmpWs });
    expect(result.output).toBe("codex output");
    expect(mockRouter.completeWithTools).not.toHaveBeenCalled();
  } finally {
    fs.rmSync(tmpWs, { recursive: true, force: true });
  }
});

test("call still uses router when model is not codex", async () => {
  mockRouter.modelFor.mockReturnValue("claude-haiku");
  const agent = new ConcreteAgent(mockRouter, db, sessionId);
  const result = await agent.run();
  expect(result.output).toBe("test response");
  expect(mockRouter.complete).toHaveBeenCalled();
});

test("call fires onLiveEvent with kind 'llm' when model is not codex", async () => {
  const events: Array<{ kind: string; msg: string }> = [];
  const agent = new ConcreteAgent(mockRouter, db, sessionId, (kind: string, msg: string) => events.push({ kind, msg }));
  await agent.run();
  const llmEvents = events.filter(e => e.kind === "llm");
  expect(llmEvents.length).toBeGreaterThanOrEqual(1);
  expect(llmEvents[0].msg).toContain("ConcreteAgent");
});

test("call fires onLiveEvent with kind 'llm' when model is codex", async () => {
  mockRouter.modelFor.mockReturnValue("codex");
  const events: Array<{ kind: string; msg: string }> = [];
  const agent = new ConcreteAgent(mockRouter, db, sessionId, (kind: string, msg: string) => events.push({ kind, msg }));
  await agent.run();
  const llmEvents = events.filter(e => e.kind === "llm");
  expect(llmEvents.length).toBeGreaterThanOrEqual(1);
  expect(llmEvents[0].msg).toContain("codex");
});

test("runAgenticLoop fires 'cmd' event for bash_exec tool calls", async () => {
  const tmpWs = fs.mkdtempSync(path.join(os.tmpdir(), "forge-test-ws-"));
  try {
    mockRouter.modelFor.mockReturnValue("claude-haiku");
    mockRouter.completeWithTools
      .mockResolvedValueOnce({
        text: "I will run a command",
        toolCalls: [{ id: "tc1", name: "bash_exec", arguments: { command: "echo hello", timeout: 10 } }],
        model: "claude-haiku", tokensIn: 10, tokensOut: 5, costUsd: 0.001,
      })
      .mockResolvedValueOnce({
        text: "Done",
        toolCalls: [],
        model: "claude-haiku", tokensIn: 5, tokensOut: 3, costUsd: 0.0005,
      });

    const events: Array<{ kind: string; msg: string }> = [];
    const agent = new LoopAgent(mockRouter, db, sessionId, (kind: string, msg: string) => events.push({ kind, msg }));
    await agent.run({ workspace: tmpWs });

    const cmdEvents = events.filter(e => e.kind === "cmd");
    expect(cmdEvents.length).toBe(1);
    expect(cmdEvents[0].msg).toContain("echo hello");
  } finally {
    fs.rmSync(tmpWs, { recursive: true, force: true });
  }
});

test("runAgenticLoop fires 'tool' event for non-bash tool calls", async () => {
  const tmpWs = fs.mkdtempSync(path.join(os.tmpdir(), "forge-test-ws-"));
  try {
    mockRouter.modelFor.mockReturnValue("claude-haiku");
    mockRouter.completeWithTools
      .mockResolvedValueOnce({
        text: null,
        toolCalls: [{ id: "tc1", name: "read_file", arguments: { path: "package.json" } }],
        model: "claude-haiku", tokensIn: 10, tokensOut: 5, costUsd: 0.001,
      })
      .mockResolvedValueOnce({
        text: "Done reading",
        toolCalls: [],
        model: "claude-haiku", tokensIn: 5, tokensOut: 3, costUsd: 0.0005,
      });

    const events: Array<{ kind: string; msg: string }> = [];
    const agent = new LoopAgent(mockRouter, db, sessionId, (kind: string, msg: string) => events.push({ kind, msg }));
    await agent.run({ workspace: tmpWs });

    const toolEvents = events.filter(e => e.kind === "tool");
    expect(toolEvents.length).toBe(1);
    expect(toolEvents[0].msg).toContain("read_file");
    expect(toolEvents[0].msg).toContain("package.json");
  } finally {
    fs.rmSync(tmpWs, { recursive: true, force: true });
  }
});
