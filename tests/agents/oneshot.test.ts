import { IdeationAgent } from "../../src/agents/ideation.js";
import { ArchitectureAgent } from "../../src/agents/architecture.js";
import { TaskGraphAgent } from "../../src/agents/taskGraph.js";
import { ReviewAgent } from "../../src/agents/review.js";
import { DeployAgent } from "../../src/agents/deploy.js";
import { ForgeDb } from "../../src/db.js";

function makeRouter(content: string) {
  return {
    modelFor: jest.fn().mockReturnValue("claude-haiku"),
    override: jest.fn(),
    complete: jest.fn().mockResolvedValue({ content, model: "m", tokensIn: 1, tokensOut: 1, costUsd: 0 }),
    completeWithTools: jest.fn(),
  } as any;
}

let db: ForgeDb;
let sessionId: string;
beforeEach(() => { db = new ForgeDb(":memory:"); sessionId = db.createSession("test"); });
afterEach(() => db.close());

// IdeationAgent
test("IdeationAgent returns question error when response is not JSON", async () => {
  const agent = new IdeationAgent(makeRouter("Is this single-user?"), db, sessionId);
  const result = await agent.run({ idea: "todo app", conversation: [] });
  expect(result.error).toBe("question");
  expect(result.output).toBe("Is this single-user?");
});

test("IdeationAgent returns spec when response is JSON", async () => {
  const spec = JSON.stringify({ name: "todo-app", description: "d", tech_stack: [], features: [], out_of_scope: [], assumptions: [] });
  const agent = new IdeationAgent(makeRouter(spec), db, sessionId);
  const result = await agent.run({ idea: "todo app", conversation: [] });
  expect(result.error).toBeUndefined();
  expect(JSON.parse(result.output).name).toBe("todo-app");
});

// ArchitectureAgent
test("ArchitectureAgent returns success with structured JSON", async () => {
  const arch = JSON.stringify({ stack: { language: "TS" }, structure: [], deploy_platforms: [], test_framework: "jest", verification_method: "api" });
  const agent = new ArchitectureAgent(makeRouter(arch), db, sessionId);
  const result = await agent.run({ spec: "{}" });
  expect(result.success).toBe(true);
  expect(JSON.parse(result.output).stack.language).toBe("TS");
});

// TaskGraphAgent
test("TaskGraphAgent returns task array", async () => {
  const tasks = JSON.stringify([{ title: "Setup", type: "coding", deps: [] }]);
  const agent = new TaskGraphAgent(makeRouter(tasks), db, sessionId);
  const result = await agent.run({ spec: "{}", architecture: "{}" });
  expect(result.success).toBe(true);
  expect(JSON.parse(result.output)).toHaveLength(1);
});

// ReviewAgent
test("ReviewAgent returns structured review", async () => {
  const review = JSON.stringify({ approved: true, issues: [], suggestions: [] });
  const agent = new ReviewAgent(makeRouter(review), db, sessionId);
  const result = await agent.run({ taskTitle: "Auth", diff: "+ def login(): pass" });
  expect(result.success).toBe(true);
  expect(JSON.parse(result.output).approved).toBe(true);
});

// DeployAgent
test("DeployAgent returns error for unknown target", async () => {
  const agent = new DeployAgent(makeRouter(""), db, sessionId);
  const result = await agent.run({ workspace: "/tmp", architecture: "{}", target: "unknown" });
  expect(result.success).toBe(false);
  expect(result.error).toContain("Unknown deploy target");
});
