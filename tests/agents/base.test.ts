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
  async run(): Promise<AgentResult> {
    const content = await this.call([{ role: "user", content: "hello" }]);
    return { success: true, output: content };
  }
}

class LoopAgent extends BaseAgent {
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
