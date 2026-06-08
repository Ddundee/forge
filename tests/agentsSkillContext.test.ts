import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { BaseAgent, AgentResult, AgentRunOptions } from "../src/agents/base.js";
import { SkillContextRuntime } from "../src/skills/toolExecutor.js";
import { SkillContextProvider } from "../src/skills/context.js";
import type { SkillContextRequest } from "../src/skills/types.js";
import { ForgeDb } from "../src/db.js";

jest.mock("../src/codexDriver.js", () => ({
  CodexDriver: jest.fn().mockImplementation(() => ({
    runTask: jest.fn().mockImplementation((prompt: string) =>
      Promise.resolve(`codex:${prompt.slice(0, 100)}`),
    ),
  })),
}));

jest.mock("../src/claudeCodeDriver.js", () => ({
  ClaudeCodeDriver: jest.fn().mockImplementation(() => ({
    runTask: jest.fn().mockResolvedValue("claude code output"),
  })),
}));

class TestAgent extends BaseAgent {
  async run(): Promise<AgentResult> {
    return { success: true, output: "" };
  }

  async runLoop(workspace: string, options?: AgentRunOptions): Promise<string> {
    return this.runAgenticLoop(
      [{ role: "system", content: "sys" }, { role: "user", content: "task" }],
      workspace,
      undefined,
      options,
    );
  }

  async callMethod(options?: AgentRunOptions): Promise<string> {
    return this.call(
      [{ role: "system", content: "sys" }, { role: "user", content: "task" }],
      undefined,
      options,
    );
  }
}

function makeInstalledSkill(workspace: string, skillName = "deploy"): void {
  const sourceKey = `owner__repo__${skillName}`;
  const dir = path.join(workspace, ".forge", "skills", sourceKey);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "forge-skill.json"),
    JSON.stringify({
      schemaVersion: 1,
      packageRef: "owner/repo",
      skillName,
      installedAt: "2026-06-07T00:00:00.000Z",
      sourceOwner: "owner",
      sourceRepo: "repo",
      candidateId: "c0",
      selectionId: "sel-1",
      auditVerdict: "pass",
      installTargets: ["forge"],
      externalPaths: { agents: `.agents/skills/${skillName}` },
    }),
    "utf8",
  );
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${skillName}\ndescription: Test skill\n---\n\n# ${skillName}\n`,
    "utf8",
  );
}

function makeSkillContext(workspace: string): SkillContextRuntime {
  const request: SkillContextRequest = {
    workspace,
    agentName: "TestAgent",
    attempt: 1,
    mode: "native-tool-loop",
    maxChars: 12000,
    selectionIdsBySourceKey: { "owner__repo__deploy": "sel-1" },
  };
  return new SkillContextRuntime(new SkillContextProvider(), request);
}

let db: ForgeDb;
let sessionId: string;
let mockRouter: any;
let capturedTools: Record<string, unknown>;

beforeEach(() => {
  db = new ForgeDb(":memory:");
  sessionId = db.createSession("test idea");
  capturedTools = {};
  mockRouter = {
    modelFor: jest.fn().mockReturnValue("claude-haiku"),
    override: jest.fn(),
    hasAutoSelector: jest.fn().mockReturnValue(false),
    selectForAgent: jest.fn().mockResolvedValue("claude-haiku"),
    complete: jest.fn().mockResolvedValue({
      content: "test response",
      model: "claude-haiku",
      tokensIn: 10,
      tokensOut: 5,
      costUsd: 0.001,
    }),
    completeWithTools: jest.fn().mockImplementation(
      async (_tier: any, _messages: any, tools: any, _timeout: any, _override: any) => {
        capturedTools = tools;
        return {
          text: "done",
          toolCalls: [],
          model: "claude-haiku",
          tokensIn: 10,
          tokensOut: 5,
          costUsd: 0,
        };
      },
    ),
  };
});

afterEach(() => db.close());

// --- runAgenticLoop without skillContext ---

test("runAgenticLoop without skillContext uses only workspace tools", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "forge-skill-agent-"));
  try {
    const agent = new TestAgent(mockRouter, db, sessionId);
    await agent.runLoop(workspace);
    expect(capturedTools).toHaveProperty("bash_exec");
    expect(capturedTools).not.toHaveProperty("skill_list");
    expect(capturedTools).not.toHaveProperty("skill_read");
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

// --- runAgenticLoop with skillContext ---

test("runAgenticLoop with skillContext includes skill tools", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "forge-skill-agent-"));
  try {
    makeInstalledSkill(workspace);
    const agent = new TestAgent(mockRouter, db, sessionId);
    await agent.runLoop(workspace, { skillContext: makeSkillContext(workspace) });
    expect(capturedTools).toHaveProperty("bash_exec");
    expect(capturedTools).toHaveProperty("skill_list");
    expect(capturedTools).toHaveProperty("skill_read");
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("runAgenticLoop with skillContext adds compact context system message", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "forge-skill-agent-"));
  let capturedMessages: any[] = [];
  mockRouter.completeWithTools.mockImplementation(
    async (_tier: any, messages: any, tools: any) => {
      capturedMessages = messages;
      capturedTools = tools;
      return { text: "done", toolCalls: [], model: "claude-haiku", tokensIn: 0, tokensOut: 0, costUsd: 0 };
    },
  );
  try {
    makeInstalledSkill(workspace);
    const agent = new TestAgent(mockRouter, db, sessionId);
    await agent.runLoop(workspace, { skillContext: makeSkillContext(workspace) });
    const systemMessages = capturedMessages.filter((m: any) => m.role === "system");
    const hasSkillContext = systemMessages.some((m: any) =>
      typeof m.content === "string" && m.content.includes("<forge_skill_context"),
    );
    expect(hasSkillContext).toBe(true);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

// --- call without skillContext ---

test("call without options is backward compatible", async () => {
  const agent = new TestAgent(mockRouter, db, sessionId);
  const result = await agent.callMethod();
  expect(result).toBe("test response");
  expect(mockRouter.complete).toHaveBeenCalled();
});

// --- call with skillContext ---

test("call with skillContext adds compact context system message", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "forge-skill-agent-"));
  let capturedMessages: any[] = [];
  mockRouter.complete.mockImplementation(async (_tier: any, messages: any) => {
    capturedMessages = messages;
    return { content: "response", model: "claude-haiku", tokensIn: 0, tokensOut: 0, costUsd: 0 };
  });
  try {
    makeInstalledSkill(workspace);
    const agent = new TestAgent(mockRouter, db, sessionId);
    await agent.callMethod({ skillContext: makeSkillContext(workspace) });
    const systemMessages = capturedMessages.filter((m: any) => m.role === "system");
    const hasSkillContext = systemMessages.some((m: any) =>
      typeof m.content === "string" && m.content.includes("<forge_skill_context"),
    );
    expect(hasSkillContext).toBe(true);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("call without skillContext does not add extra system message", async () => {
  let capturedMessages: any[] = [];
  mockRouter.complete.mockImplementation(async (_tier: any, messages: any) => {
    capturedMessages = messages;
    return { content: "response", model: "claude-haiku", tokensIn: 0, tokensOut: 0, costUsd: 0 };
  });
  const agent = new TestAgent(mockRouter, db, sessionId);
  await agent.callMethod();
  const skillContextMessages = capturedMessages.filter(
    (m: any) => typeof m.content === "string" && m.content.includes("<forge_skill_context"),
  );
  expect(skillContextMessages).toHaveLength(0);
});

// --- external agent path ---

test("external agent (codex) receives skill context in flattened prompt", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "forge-skill-agent-"));
  const { CodexDriver } = require("../src/codexDriver.js");
  const mockRunTask = jest.fn().mockResolvedValue("codex output");
  CodexDriver.mockImplementation(() => ({ runTask: mockRunTask }));
  mockRouter.modelFor.mockReturnValue("codex");

  try {
    makeInstalledSkill(workspace);
    const agent = new TestAgent(mockRouter, db, sessionId);
    const skillContext = new SkillContextRuntime(new SkillContextProvider(), {
      workspace,
      agentName: "TestAgent",
      attempt: 1,
      mode: "codex-cli",
      maxChars: 12000,
      selectionIdsBySourceKey: { "owner__repo__deploy": "sel-1" },
    });
    await agent.runLoop(workspace, { skillContext });
    const prompt = mockRunTask.mock.calls[0][0] as string;
    expect(prompt).toContain("<forge_skill_context");
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("external agent without skillContext gets unchanged prompt", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "forge-skill-agent-"));
  const { CodexDriver } = require("../src/codexDriver.js");
  const mockRunTask = jest.fn().mockResolvedValue("codex output");
  CodexDriver.mockImplementation(() => ({ runTask: mockRunTask }));
  mockRouter.modelFor.mockReturnValue("codex");

  try {
    const agent = new TestAgent(mockRouter, db, sessionId);
    await agent.runLoop(workspace);
    const prompt = mockRunTask.mock.calls[0][0] as string;
    expect(prompt).not.toContain("<forge_skill_context");
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

// --- skill tool dispatch ---

test("runAgenticLoop dispatches skill_list tool call via skill executor", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "forge-skill-agent-"));
  // Bypass FK constraint: skill_injections.selection_id must reference skill_selections
  jest.spyOn(db, "logSkillInjection").mockReturnValue("inj-1");
  let capturedToolResultMessages: any[] = [];
  let callCount = 0;
  mockRouter.completeWithTools.mockImplementation(async (_tier: any, messages: any) => {
    callCount++;
    if (callCount === 1) {
      return {
        text: "",
        toolCalls: [{ id: "tc1", name: "skill_list", arguments: {} }],
        model: "claude-haiku",
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
      };
    }
    capturedToolResultMessages = messages;
    return { text: "done", toolCalls: [], model: "claude-haiku", tokensIn: 0, tokensOut: 0, costUsd: 0 };
  });

  try {
    makeInstalledSkill(workspace);
    const agent = new TestAgent(mockRouter, db, sessionId);
    const result = await agent.runLoop(workspace, { skillContext: makeSkillContext(workspace) });
    expect(result).toBe("done");
    // Verify skill_list result was routed through skill executor (not "Unknown tool")
    const toolMsgs = capturedToolResultMessages.filter((m: any) => m.role === "tool");
    expect(toolMsgs.length).toBeGreaterThan(0);
    const toolResultContent = toolMsgs.flatMap((m: any) =>
      Array.isArray(m.content) ? m.content : [m.content],
    );
    const hasSkillContext = toolResultContent.some(
      (c: any) => typeof c?.result === "string" && c.result.includes("<forge_skill_context"),
    );
    expect(hasSkillContext).toBe(true);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
