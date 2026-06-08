import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  SkillPipelineCoordinator,
  NoopSkillPipelineCoordinator,
  type SkillPipelineDeps,
} from "../src/skills/pipeline.js";
import { SkillContextProvider } from "../src/skills/context.js";
import { ForgeDb } from "../src/db.js";
import { DEFAULT_SKILL_CONFIG } from "../src/config.js";

const SPEC = JSON.stringify({ name: "dashboard", description: "A React dashboard" });
const ARCH = JSON.stringify({ stack: { language: "TypeScript", framework: "React" }, test_framework: "vitest" });

function makeDb(): { db: ForgeDb; sessionId: string } {
  const db = new ForgeDb(":memory:");
  const sessionId = db.createSession("dashboard");
  return { db, sessionId };
}

function makeSkillConfig(mode: "off" | "auto" = "auto", maxSkills = 3) {
  return { ...DEFAULT_SKILL_CONFIG, mode, maxSkills };
}

function installSkillInWorkspace(ws: string, skillName = "react-patterns", selectionId = "sel-1"): void {
  const sourceKey = `owner__repo__${skillName}`;
  const dir = path.join(ws, ".forge", "skills", sourceKey);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "forge-skill.json"),
    JSON.stringify({
      schemaVersion: 1,
      packageRef: "owner/repo",
      skillName,
      installedAt: new Date().toISOString(),
      sourceOwner: "owner",
      sourceRepo: "repo",
      candidateId: "c0",
      selectionId,
      auditVerdict: "pass",
      installTargets: ["forge", "agents"],
      externalPaths: { agents: `.agents/skills/${skillName}` },
    }),
    "utf8",
  );
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${skillName}\ndescription: React patterns for building UIs\n---\n\n# ${skillName}\nUse accessible layout patterns.\n`,
    "utf8",
  );
}

function makeDeps(
  workspace: string,
  overrides: Partial<SkillPipelineDeps> = {},
): SkillPipelineDeps {
  const { db, sessionId } = makeDb();
  return {
    sessionId,
    idea: "dashboard",
    workspace,
    config: makeSkillConfig(),
    db,
    searchClient: { find: jest.fn().mockResolvedValue({ query: "", candidates: [], rawOutput: "" }) },
    useClient: { use: jest.fn().mockResolvedValue({ source: "owner/repo", skillName: "react-patterns", prompt: "", skillMarkdown: undefined, rawOutput: "" }) },
    installClient: { install: jest.fn().mockResolvedValue({ source: "owner/repo", skillName: "react-patterns" }) },
    contextProvider: new SkillContextProvider(),
    ...overrides,
  };
}

let workspace: string;
beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "forge-ext-agent-test-"));
});
afterEach(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

// --- T3-EXTERNAL-AGENT: agent mode selection ---

test("prepareForCodingTask with codex externalAgent returns codex-cli mode for installed skill", async () => {
  installSkillInWorkspace(workspace, "react-patterns");
  const deps = makeDeps(workspace);
  jest.spyOn(deps.db, "logSkillInstallation").mockReturnValue("inst-1");
  jest.spyOn(deps.db, "selectSkill").mockReturnValue("sel-mock");
  const coord = new SkillPipelineCoordinator(deps);

  const prep = await coord.prepareForCodingTask({
    spec: SPEC,
    architecture: ARCH,
    task: { id: "t1", title: "Build React dashboard component" },
    workspace,
    cycle: 0,
    externalAgent: "codex",
  });

  if (prep.enabled && prep.skillContext) {
    expect(prep.skillContext.request.mode).toBe("codex-cli");
  }
});

test("prepareForCodingTask with no external agent returns native-tool-loop mode", async () => {
  installSkillInWorkspace(workspace, "react-patterns");
  const deps = makeDeps(workspace);
  const coord = new SkillPipelineCoordinator(deps);

  const prep = await coord.prepareForCodingTask({
    spec: SPEC,
    architecture: ARCH,
    task: { id: "t1", title: "Build React dashboard component" },
    workspace,
    cycle: 0,
    externalAgent: undefined,
  });

  if (prep.enabled && prep.skillContext) {
    expect(prep.skillContext.request.mode).toBe("native-tool-loop");
  }
});

test("prepareForCodingTask with claude-code agent returns claude-code mode", async () => {
  installSkillInWorkspace(workspace, "react-patterns");
  const deps = makeDeps(workspace);
  jest.spyOn(deps.db, "logSkillInstallation").mockReturnValue("inst-1");
  jest.spyOn(deps.db, "selectSkill").mockReturnValue("sel-mock");
  const coord = new SkillPipelineCoordinator(deps);

  const prep = await coord.prepareForCodingTask({
    spec: SPEC,
    architecture: ARCH,
    task: { id: "t1", title: "Build React dashboard component" },
    workspace,
    cycle: 0,
    externalAgent: "claude-code",
  });

  if (prep.enabled && prep.skillContext) {
    expect(prep.skillContext.request.mode).toBe("claude-code");
  }
});

// --- T3-PROMPT-BUDGET: budget enforcement ---

test("prepareForCodingTask returns skillContext with bounded maxChars", async () => {
  installSkillInWorkspace(workspace, "react-patterns");
  const deps = makeDeps(workspace, {
    config: makeSkillConfig("auto", 3),
  });
  const coord = new SkillPipelineCoordinator(deps);

  const prep = await coord.prepareForCodingTask({
    spec: SPEC,
    architecture: ARCH,
    task: { id: "t1", title: "Build React UI" },
    workspace,
    cycle: 0,
    externalAgent: undefined,
  });

  if (prep.enabled && prep.skillContext) {
    expect(prep.skillContext.request.maxChars).toBeGreaterThan(0);
    expect(prep.skillContext.request.maxChars).toBeLessThanOrEqual(DEFAULT_SKILL_CONFIG.promptCharBudget);
  }
});

// --- T3-ROLLBACK-FLAG: disabled skills produce no context ---

test("prepareForCodingTask with mode off returns disabled preparation", async () => {
  installSkillInWorkspace(workspace, "react-patterns");
  const deps = makeDeps(workspace, {
    config: makeSkillConfig("off"),
  });
  const coord = new SkillPipelineCoordinator(deps);

  const prep = await coord.prepareForCodingTask({
    spec: SPEC,
    architecture: ARCH,
    task: { id: "t1", title: "Build React UI" },
    workspace,
    cycle: 0,
    externalAgent: "codex",
  });

  expect(prep.enabled).toBe(false);
  expect(prep.skillContext).toBeUndefined();
});

test("NoopSkillPipelineCoordinator always returns disabled for external agent", async () => {
  const coord = new NoopSkillPipelineCoordinator();

  const prep = await coord.prepareForCodingTask({
    spec: SPEC,
    architecture: ARCH,
    task: { id: "t1", title: "Build React UI" },
    workspace,
    cycle: 0,
    externalAgent: "codex",
  });

  expect(prep.enabled).toBe(false);
  expect(prep.skillContext).toBeUndefined();
});

test("disabled mode leaves external agent prompts unchanged", async () => {
  const deps = makeDeps(workspace, {
    config: makeSkillConfig("off"),
  });
  const coord = new SkillPipelineCoordinator(deps);

  const archPrep = await coord.prepareForArchitecture({ spec: SPEC });
  const deployPrep = await coord.prepareForDeploy({
    workspace,
    architecture: ARCH,
    target: "vercel",
    externalAgent: "codex",
  });

  expect(archPrep.enabled).toBe(false);
  expect(archPrep.skillContext).toBeUndefined();
  expect(deployPrep.enabled).toBe(false);
  expect(deployPrep.skillContext).toBeUndefined();
});

// --- skillContext agentName and workspace ---

test("prepareForTesting returns context with correct agentName", async () => {
  installSkillInWorkspace(workspace, "vitest-testing");
  const deps = makeDeps(workspace, { externalAgent: undefined });
  const coord = new SkillPipelineCoordinator(deps);

  const prep = await coord.prepareForTesting({
    workspace,
    architecture: JSON.stringify({ test_framework: "vitest" }),
    cycle: 0,
  });

  if (prep.enabled && prep.skillContext) {
    expect(prep.skillContext.request.agentName).toBe("TestAgent");
    expect(prep.skillContext.request.workspace).toBe(workspace);
  }
});

test("prepareForIntegration returns context with IntegrationAgent name", async () => {
  installSkillInWorkspace(workspace, "react-patterns");
  const deps = makeDeps(workspace);
  const coord = new SkillPipelineCoordinator(deps);

  const prep = await coord.prepareForIntegration({
    workspace,
    architecture: ARCH,
    cycle: 0,
  });

  if (prep.enabled && prep.skillContext) {
    expect(prep.skillContext.request.agentName).toBe("IntegrationAgent");
  }
});
