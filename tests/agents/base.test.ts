import { BaseAgent, AgentResult } from "../../src/agents/base.js";
import { LLMRouter, ModelTier } from "../../src/router.js";
import { ForgeDb } from "../../src/db.js";

class ConcreteAgent extends BaseAgent {
  async run(): Promise<AgentResult> {
    const content = await this.call([{ role: "user", content: "hello" }]);
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
