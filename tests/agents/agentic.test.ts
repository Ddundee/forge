import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { CodingAgent } from "../../src/agents/coding.js";
import { IntegrationAgent } from "../../src/agents/integration.js";
import { TestAgent } from "../../src/agents/testAgent.js";
import { VerificationAgent } from "../../src/agents/verification.js";
import { ForgeDb } from "../../src/db.js";

let workspace: string;
let db: ForgeDb;
let sessionId: string;

beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "forge-agent-test-"));
  db = new ForgeDb(":memory:");
  sessionId = db.createSession("test");
});
afterEach(() => { db.close(); fs.rmSync(workspace, { recursive: true }); });

function makeRouter(text: string | null, toolCalls: any[] = []) {
  return {
    modelFor: jest.fn().mockReturnValue("claude-sonnet"),
    override: jest.fn(),
    complete: jest.fn(),
    completeWithTools: jest.fn().mockResolvedValue({ text, toolCalls, model: "m", tokensIn: 1, tokensOut: 1, costUsd: 0 }),
  } as any;
}

// CodingAgent
test("CodingAgent calls runAgenticLoop and returns summary", async () => {
  const router = makeRouter("Wrote src/main.ts with hello world logic.");
  const agent = new CodingAgent(router, db, sessionId);
  const result = await agent.run({ taskTitle: "Write main", spec: "{}", architecture: "{}", workspace });
  expect(result.success).toBe(true);
  expect(result.output).toContain("Wrote");
});

test("CodingAgent saves artifacts from workspace files", async () => {
  fs.mkdirSync(path.join(workspace, "src"), { recursive: true });
  fs.writeFileSync(path.join(workspace, "src", "main.ts"), "export {}");
  const router = makeRouter("Done.");
  const agent = new CodingAgent(router, db, sessionId);
  await agent.run({ taskTitle: "task", spec: "{}", architecture: "{}", workspace });
  const db2 = db as any;
  const artifacts = db2.db.prepare("SELECT * FROM artifacts").all();
  expect(artifacts.length).toBeGreaterThanOrEqual(1);
});

// IntegrationAgent
test("IntegrationAgent runs agentic loop on workspace", async () => {
  fs.writeFileSync(path.join(workspace, "index.ts"), "import './missing'");
  const router = makeRouter("Fixed import in index.ts");
  const agent = new IntegrationAgent(router, db, sessionId);
  const result = await agent.run({ workspace, spec: "{}", architecture: "{}" });
  expect(result.success).toBe(true);
});

// VerificationAgent
test("VerificationAgent parses passed report as success", async () => {
  const report = JSON.stringify({ passed: ["Build OK"], failed: [], errors: [] });
  const router = makeRouter(report);
  const agent = new VerificationAgent(router, db, sessionId);
  const result = await agent.run({ workspace, architecture: JSON.stringify({ verification_method: "cli", stack: {} }), spec: "{}" });
  expect(result.success).toBe(true);
});

test("VerificationAgent parses failed report as failure", async () => {
  const report = JSON.stringify({ passed: [], failed: ["Build failed"], errors: ["exit 1"] });
  const router = makeRouter(report);
  const agent = new VerificationAgent(router, db, sessionId);
  const result = await agent.run({ workspace, architecture: JSON.stringify({ verification_method: "cli", stack: {} }), spec: "{}" });
  expect(result.success).toBe(false);
  expect(result.error).toBe("verification_failed");
});
