import { Overseer } from "../src/overseer.js";
import { Session } from "../src/session.js";
import { Phase } from "../src/stateMachine.js";
import { ForgeDb } from "../src/db.js";
import { ForgeConfig } from "../src/config.js";
import { LLMRouter, ModelTier } from "../src/router.js";
import { LiveEventFn } from "../src/agents/base.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// Mock all agents
jest.mock("../src/agents/ideation.js");
jest.mock("../src/agents/architecture.js");
jest.mock("../src/agents/taskGraph.js");
jest.mock("../src/agents/coding.js");
jest.mock("../src/agents/review.js");
jest.mock("../src/agents/integration.js");
jest.mock("../src/agents/testAgent.js");
jest.mock("../src/agents/verification.js");
jest.mock("../src/agents/deploy.js");

import { IdeationAgent } from "../src/agents/ideation.js";
import { ArchitectureAgent } from "../src/agents/architecture.js";
import { TaskGraphAgent } from "../src/agents/taskGraph.js";
import { CodingAgent } from "../src/agents/coding.js";
import { ReviewAgent } from "../src/agents/review.js";
import { IntegrationAgent } from "../src/agents/integration.js";
import { TestAgent } from "../src/agents/testAgent.js";
import { VerificationAgent } from "../src/agents/verification.js";

const SPEC = JSON.stringify({ name: "todo", description: "d", tech_stack: [], features: [], out_of_scope: [], assumptions: [] });
const ARCH = JSON.stringify({ stack: { language: "TS" }, structure: [], deploy_platforms: [], test_framework: "jest", verification_method: "cli" });
const TASKS = JSON.stringify([{ title: "Write main.ts", type: "coding", deps: [] }]);
const VERIFY_OK = JSON.stringify({ passed: ["ok"], failed: [], errors: [] });
const VERIFY_FAIL = JSON.stringify({ passed: [], failed: ["broken"], errors: [] });
const REVIEW_OK = JSON.stringify({ approved: true, issues: [], suggestions: [] });

let tmpDir: string;

function makeSession(): Session {
  const db = new ForgeDb(":memory:");
  const sessionId = db.createSession("todo app");
  const ws = path.join(tmpDir, "workspace");
  fs.mkdirSync(ws, { recursive: true });
  const mockRouter = {
    modelFor: jest.fn().mockReturnValue("claude-haiku"),
    hasAutoSelector: jest.fn().mockReturnValue(false),
    complete: jest.fn(),
    completeWithTools: jest.fn(),
  } as unknown as LLMRouter;
  return new Session(sessionId, "todo app", Phase.IDEATION, 0, 5, undefined, ws, db, mockRouter, new ForgeConfig());
}

function makeCodexSession(): Session {
  const db = new ForgeDb(":memory:");
  const sessionId = db.createSession("codex idea");
  const ws = path.join(tmpDir, "codex-workspace");
  fs.mkdirSync(ws, { recursive: true });
  const mockRouter = {
    modelFor: jest.fn().mockImplementation((tier: string) =>
      tier === ModelTier.REASONING ? "codex" : "claude-haiku"
    ),
    hasAutoSelector: jest.fn().mockReturnValue(false),
    complete: jest.fn(),
    completeWithTools: jest.fn(),
  } as unknown as LLMRouter;
  return new Session(sessionId, "codex idea", Phase.IDEATION, 0, 5, undefined, ws, db, mockRouter, new ForgeConfig("codex"));
}

function makeClaudeCodeSession(): Session {
  const db = new ForgeDb(":memory:");
  const sessionId = db.createSession("claude code idea");
  const ws = path.join(tmpDir, "claude-code-workspace");
  fs.mkdirSync(ws, { recursive: true });
  const mockRouter = {
    modelFor: jest.fn().mockImplementation((tier: string) =>
      tier === ModelTier.REASONING ? "claude-code" : "claude-haiku"
    ),
    hasAutoSelector: jest.fn().mockReturnValue(false),
    complete: jest.fn(),
    completeWithTools: jest.fn(),
  } as unknown as LLMRouter;
  return new Session(sessionId, "claude code idea", Phase.IDEATION, 0, 5, undefined, ws, db, mockRouter, new ForgeConfig("claude-code"));
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-overseer-test-"));
  jest.clearAllMocks();
  (IdeationAgent as jest.Mock).mockImplementation(() => ({ run: jest.fn().mockResolvedValue({ success: true, output: SPEC }) }));
  (ArchitectureAgent as jest.Mock).mockImplementation(() => ({ run: jest.fn().mockResolvedValue({ success: true, output: ARCH }) }));
  (TaskGraphAgent as jest.Mock).mockImplementation(() => ({ run: jest.fn().mockResolvedValue({ success: true, output: TASKS }) }));
  (CodingAgent as jest.Mock).mockImplementation(() => ({ run: jest.fn().mockResolvedValue({ success: true, output: "wrote files" }) }));
  (ReviewAgent as jest.Mock).mockImplementation(() => ({ run: jest.fn().mockResolvedValue({ success: true, output: REVIEW_OK }) }));
  (IntegrationAgent as jest.Mock).mockImplementation(() => ({ run: jest.fn().mockResolvedValue({ success: true, output: "[]" }) }));
  (TestAgent as jest.Mock).mockImplementation(() => ({ run: jest.fn().mockResolvedValue({ success: true, output: "1 passed" }) }));
  (VerificationAgent as jest.Mock).mockImplementation(() => ({ run: jest.fn().mockResolvedValue({ success: true, output: VERIFY_OK }) }));
});

afterEach(() => fs.rmSync(tmpDir, { recursive: true }));

test("full pipeline reaches DONE", async () => {
  const session = makeSession();
  const overseer = new Overseer(session);
  await overseer.run();
  expect(session.phase).toBe(Phase.DONE);
});

test("verification failure loops back to CODING then DONE", async () => {
  let calls = 0;
  (VerificationAgent as jest.Mock).mockImplementation(() => ({
    run: jest.fn().mockImplementation(async () => {
      calls++;
      return calls === 1
        ? { success: false, output: VERIFY_FAIL, error: "verification_failed" }
        : { success: true, output: VERIFY_OK };
    }),
  }));
  const session = makeSession();
  const overseer = new Overseer(session);
  await overseer.run();
  expect(session.phase).toBe(Phase.DONE);
  expect(calls).toBe(2);
  expect(session.cycle).toBe(1);
});

test("emits events throughout pipeline", async () => {
  const events: string[] = [];
  const session = makeSession();
  const overseer = new Overseer(session, msg => events.push(msg));
  await overseer.run();
  expect(events.some(e => e.includes("IDEATION") || e.includes("Spec"))).toBe(true);
  expect(events.some(e => e.includes("Build passed") || e.includes("Verification"))).toBe(true);
});

test("reaches FAILED when max_cycles exceeded", async () => {
  (VerificationAgent as jest.Mock).mockImplementation(() => ({
    run: jest.fn().mockResolvedValue({ success: false, output: VERIFY_FAIL, error: "verification_failed" }),
  }));
  const session = makeSession();
  session.maxCycles = 1;
  const overseer = new Overseer(session);
  await overseer.run();
  expect(session.phase).toBe(Phase.FAILED);
});

test("Overseer accepts liveEvent as third constructor argument", () => {
  const liveEvents: Array<{ kind: string; msg: string }> = [];
  const liveEventFn: LiveEventFn = (kind, msg) => liveEvents.push({ kind, msg });
  const session = makeSession();
  // Constructing with a liveEvent arg should not throw and should store it
  const overseer = new Overseer(session, undefined, liveEventFn);
  expect((overseer as any).liveEvent).toBe(liveEventFn);
});

test("coding phase gives each task an isolated workspace subdir when codex profile active", async () => {
  const receivedWorkspaces: string[] = [];

  (CodingAgent as jest.Mock).mockImplementation(() => ({
    run: jest.fn().mockImplementation(async (args: Record<string, unknown>) => {
      const workspace = String(args["workspace"]);
      receivedWorkspaces.push(workspace);
      fs.writeFileSync(path.join(workspace, "output.ts"), "// generated");
      return { success: true, output: "wrote files" };
    }),
  }));

  const session = makeCodexSession();
  const overseer = new Overseer(session);
  await overseer.run();

  for (const ws of receivedWorkspaces) {
    expect(ws).toContain(path.join(session.workspace, "tasks"));
  }
  expect(fs.existsSync(path.join(session.workspace, "output.ts"))).toBe(true);
  expect(fs.existsSync(path.join(session.workspace, "tasks"))).toBe(false);
});

test("coding phase gives each task an isolated workspace subdir when claude-code profile active", async () => {
  const receivedWorkspaces: string[] = [];

  (CodingAgent as jest.Mock).mockImplementation(() => ({
    run: jest.fn().mockImplementation(async (args: Record<string, unknown>) => {
      const workspace = String(args["workspace"]);
      receivedWorkspaces.push(workspace);
      fs.writeFileSync(path.join(workspace, "output.ts"), "// generated");
      return { success: true, output: "wrote files" };
    }),
  }));

  const session = makeClaudeCodeSession();
  const overseer = new Overseer(session);
  await overseer.run();

  for (const ws of receivedWorkspaces) {
    expect(ws).toContain(path.join(session.workspace, "tasks"));
  }
  expect(fs.existsSync(path.join(session.workspace, "output.ts"))).toBe(true);
  expect(fs.existsSync(path.join(session.workspace, "tasks"))).toBe(false);
});
