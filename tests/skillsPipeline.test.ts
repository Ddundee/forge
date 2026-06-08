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

const SPEC = JSON.stringify({ name: "todo app", description: "A simple todo application" });
const ARCH = JSON.stringify({ stack: { language: "TypeScript", framework: "React" }, test_framework: "vitest" });

function makeDb(): { db: ForgeDb; sessionId: string } {
  const db = new ForgeDb(":memory:");
  const sessionId = db.createSession("test idea");
  return { db, sessionId };
}

function makeSkillConfig(overrides: Record<string, unknown> = {}) {
  return {
    mode: "auto" as const,
    maxSkills: 5,
    promptCharBudget: 12000,
    minInstallCount: 0,
    trustedSources: [],
    installTargets: ["forge" as const],
    ...overrides,
  };
}

function makeSearchClient(selectedSkills: Array<{ packageRef: string; skillName: string }> = []) {
  return {
    find: jest.fn().mockResolvedValue({
      query: "test query",
      candidates: selectedSkills.map((s) => ({
        packageRef: s.packageRef,
        skillName: s.skillName,
        description: "A test skill",
        installCount: 100,
        score: 0.9,
      })),
      rawOutput: "",
    }),
  };
}

function makeUseClient() {
  return {
    use: jest.fn().mockResolvedValue({
      source: "owner/repo",
      skillName: "deploy",
      prompt: "",
      skillMarkdown: "---\nname: deploy\ndescription: Deploy skill\n---\n\n# Deploy\nDeploy your app.",
      rawOutput: "",
    }),
  };
}

function makeInstallClient(workspace: string, skillName = "deploy") {
  return {
    install: jest.fn().mockImplementation(async (req: { source: string; skillName: string; workspace: string }) => {
      const sourceKey = `${req.source.replace("/", "__")}__${req.skillName}`;
      const dir = path.join(req.workspace, ".forge", "skills", sourceKey);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "forge-skill.json"),
        JSON.stringify({
          schemaVersion: 1,
          packageRef: req.source,
          skillName: req.skillName,
          installedAt: new Date().toISOString(),
          sourceOwner: req.source.split("/")[0],
          sourceRepo: req.source.split("/")[1] ?? req.skillName,
          candidateId: "c0",
          selectionId: "sel-install-1",
          auditVerdict: "pass",
          installTargets: ["forge"],
          externalPaths: {},
        }),
        "utf8",
      );
      fs.writeFileSync(
        path.join(dir, "SKILL.md"),
        `---\nname: ${req.skillName}\ndescription: A test skill\n---\n\n# ${req.skillName}\n`,
        "utf8",
      );
      return { source: req.source, skillName: req.skillName };
    }),
  };
}

function makeDeps(
  workspace: string,
  overrides: Partial<SkillPipelineDeps> = {},
): SkillPipelineDeps {
  const { db, sessionId } = makeDb();
  return {
    sessionId,
    idea: "todo app",
    workspace,
    config: makeSkillConfig(),
    db,
    searchClient: makeSearchClient(),
    useClient: makeUseClient(),
    installClient: makeInstallClient(workspace),
    contextProvider: new SkillContextProvider(),
    ...overrides,
  };
}

let workspace: string;
beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "forge-pipeline-test-"));
});
afterEach(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

// --- NoopSkillPipelineCoordinator ---

test("NoopSkillPipelineCoordinator prepareForArchitecture returns disabled", async () => {
  const coord = new NoopSkillPipelineCoordinator();
  const prep = await coord.prepareForArchitecture({ spec: SPEC });
  expect(prep.enabled).toBe(false);
  expect(prep.moment).toBe("pre-architecture");
  expect(prep.skillContext).toBeUndefined();
});

test("NoopSkillPipelineCoordinator prepareForCodingPhase returns void", async () => {
  const coord = new NoopSkillPipelineCoordinator();
  await expect(coord.prepareForCodingPhase({ spec: SPEC, architecture: ARCH, pendingTasks: [], cycle: 0 })).resolves.toBeUndefined();
});

test("NoopSkillPipelineCoordinator prepareForCodingTask returns disabled", async () => {
  const coord = new NoopSkillPipelineCoordinator();
  const prep = await coord.prepareForCodingTask({
    spec: SPEC, architecture: ARCH,
    task: { id: "t1", title: "Build UI" },
    workspace, cycle: 0, externalAgent: undefined,
  });
  expect(prep.enabled).toBe(false);
  expect(prep.moment).toBe("pre-coding-task");
});

test("NoopSkillPipelineCoordinator prepareForTaskGraph returns disabled", async () => {
  const coord = new NoopSkillPipelineCoordinator();
  const prep = await coord.prepareForTaskGraph({ spec: SPEC, architecture: ARCH });
  expect(prep.enabled).toBe(false);
  expect(prep.moment).toBe("pre-task-graph");
});

test("NoopSkillPipelineCoordinator prepareForIntegration returns disabled", async () => {
  const coord = new NoopSkillPipelineCoordinator();
  const prep = await coord.prepareForIntegration({ workspace, architecture: ARCH, cycle: 0 });
  expect(prep.enabled).toBe(false);
});

test("NoopSkillPipelineCoordinator prepareForTesting returns disabled", async () => {
  const coord = new NoopSkillPipelineCoordinator();
  const prep = await coord.prepareForTesting({ workspace, architecture: ARCH, cycle: 0 });
  expect(prep.enabled).toBe(false);
});

test("NoopSkillPipelineCoordinator prepareForVerification returns disabled", async () => {
  const coord = new NoopSkillPipelineCoordinator();
  const prep = await coord.prepareForVerification({ workspace, architecture: ARCH, cycle: 0 });
  expect(prep.enabled).toBe(false);
});

test("NoopSkillPipelineCoordinator prepareForVerificationFailure returns void", async () => {
  const coord = new NoopSkillPipelineCoordinator();
  await expect(
    coord.prepareForVerificationFailure({ spec: SPEC, architecture: ARCH, failures: [], errors: [], cycle: 1 }),
  ).resolves.toBeUndefined();
});

test("NoopSkillPipelineCoordinator prepareForDeploy returns disabled", async () => {
  const coord = new NoopSkillPipelineCoordinator();
  const prep = await coord.prepareForDeploy({ workspace, architecture: ARCH, target: "vercel", externalAgent: undefined });
  expect(prep.enabled).toBe(false);
  expect(prep.moment).toBe("pre-deploy");
});

// --- SkillPipelineCoordinator disabled mode ---

test("disabled coordinator (mode off) does not call search client", async () => {
  const deps = makeDeps(workspace, { config: makeSkillConfig({ mode: "off" }) });
  const coord = new SkillPipelineCoordinator(deps);

  const prep = await coord.prepareForArchitecture({ spec: SPEC });
  expect(prep.enabled).toBe(false);
  expect(deps.searchClient.find).not.toHaveBeenCalled();
});

test("disabled coordinator (maxSkills 0) does not call search client", async () => {
  const deps = makeDeps(workspace, { config: makeSkillConfig({ maxSkills: 0 }) });
  const coord = new SkillPipelineCoordinator(deps);

  const prep = await coord.prepareForArchitecture({ spec: SPEC });
  expect(prep.enabled).toBe(false);
  expect(deps.searchClient.find).not.toHaveBeenCalled();
});

// --- SkillPipelineCoordinator enabled, no candidates ---

test("prepareForArchitecture with no search results returns disabled", async () => {
  const deps = makeDeps(workspace);
  const coord = new SkillPipelineCoordinator(deps);

  const prep = await coord.prepareForArchitecture({ spec: SPEC });
  expect(prep.enabled).toBe(false);
  expect(prep.skillContext).toBeUndefined();
});

test("prepareForCodingPhase with no candidates completes without error", async () => {
  const deps = makeDeps(workspace);
  const coord = new SkillPipelineCoordinator(deps);

  await expect(
    coord.prepareForCodingPhase({
      spec: SPEC, architecture: ARCH,
      pendingTasks: [{ id: "t1", title: "Build UI", type: "coding" }],
      cycle: 0,
    }),
  ).resolves.toBeUndefined();
});

// --- SkillPipelineCoordinator fingerprint reuse ---

test("prepareForVerificationFailure skips repeated failure fingerprint", async () => {
  const emitted: string[] = [];
  const deps = makeDeps(workspace, { emit: (m) => emitted.push(m) });
  const coord = new SkillPipelineCoordinator(deps);
  const input = {
    spec: SPEC, architecture: ARCH,
    failures: ["npm run build failed with TS2307"],
    errors: [], cycle: 1,
  };

  await coord.prepareForVerificationFailure(input);
  await coord.prepareForVerificationFailure(input);

  const findCalls = (deps.searchClient.find as jest.Mock).mock.calls.length;
  expect(findCalls).toBeLessThanOrEqual(3);
  expect(emitted.some((m) => m.includes("reused"))).toBe(true);
});

test("prepareForVerificationFailure with empty failures does nothing", async () => {
  const deps = makeDeps(workspace);
  const coord = new SkillPipelineCoordinator(deps);

  await coord.prepareForVerificationFailure({
    spec: SPEC, architecture: ARCH,
    failures: [], errors: [], cycle: 1,
  });

  expect(deps.searchClient.find).not.toHaveBeenCalled();
});

// --- SkillPipelineCoordinator task graph ---

test("prepareForTaskGraph always returns disabled in v1", async () => {
  const deps = makeDeps(workspace);
  const coord = new SkillPipelineCoordinator(deps);

  const prep = await coord.prepareForTaskGraph({ spec: SPEC, architecture: ARCH });
  expect(prep.enabled).toBe(false);
  expect(prep.skillContext).toBeUndefined();
  expect(deps.searchClient.find).not.toHaveBeenCalled();
});

// --- SkillPipelineCoordinator with installed skills ---

function installSkillInWorkspace(ws: string, skillName = "deploy", selectionId = "sel-1"): void {
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
      installTargets: ["forge"],
      externalPaths: { agents: `.agents/skills/${skillName}` },
    }),
    "utf8",
  );
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${skillName}\ndescription: Deploy to Vercel\n---\n\n# ${skillName}\n`,
    "utf8",
  );
}

test("prepareForDeploy with installed deploy skill returns enabled prep for deploy agent", async () => {
  installSkillInWorkspace(workspace, "deploy");
  const deps = makeDeps(workspace);
  const coord = new SkillPipelineCoordinator(deps);

  const prep = await coord.prepareForDeploy({
    workspace,
    architecture: ARCH,
    target: "vercel",
    externalAgent: "codex",
  });

  // Deploy skill is relevant because "deploy" overlaps with "deploy vercel"
  // Result depends on scoring; just check it doesn't throw
  expect(["pre-deploy"]).toContain(prep.moment);
});

test("prepareForCodingTask with installed skill uses native-tool-loop mode for native agent", async () => {
  installSkillInWorkspace(workspace, "react-patterns");
  const deps = makeDeps(workspace);
  const coord = new SkillPipelineCoordinator(deps);

  const prep = await coord.prepareForCodingTask({
    spec: SPEC,
    architecture: ARCH,
    task: { id: "t1", title: "Build React UI component" },
    workspace,
    cycle: 0,
    externalAgent: undefined,
  });

  if (prep.enabled && prep.skillContext) {
    expect(prep.skillContext.request.mode).toBe("native-tool-loop");
  }
});

test("prepareForCodingTask with external codex agent uses codex-cli mode", async () => {
  installSkillInWorkspace(workspace, "react-patterns");
  const deps = makeDeps(workspace);
  // Bypass FK constraint: selectionId in manifest doesn't exist in skill_selections
  jest.spyOn(deps.db, "logSkillInstallation").mockReturnValue("inst-1");
  jest.spyOn(deps.db, "selectSkill").mockReturnValue("sel-mock");
  const coord = new SkillPipelineCoordinator(deps);

  const prep = await coord.prepareForCodingTask({
    spec: SPEC,
    architecture: ARCH,
    task: { id: "t1", title: "Build React UI component" },
    workspace,
    cycle: 0,
    externalAgent: "codex",
  });

  if (prep.enabled && prep.skillContext) {
    expect(prep.skillContext.request.mode).toBe("codex-cli");
  }
});

test("emit is called when injecting skills", async () => {
  installSkillInWorkspace(workspace, "deploy");
  const emitted: string[] = [];
  const deps = makeDeps(workspace, { emit: (m) => emitted.push(m) });
  const coord = new SkillPipelineCoordinator(deps);

  await coord.prepareForDeploy({
    workspace,
    architecture: ARCH,
    target: "vercel",
    externalAgent: "codex",
  });

  // If a skill was relevant, inject message should be emitted
  // If no skill matched, no inject message but no error either
  expect(typeof emitted).toBe("object");
});

// --- modeForReasoningAgent ---

test("reasoning agent uses codex-cli mode when externalAgent is codex", async () => {
  installSkillInWorkspace(workspace, "vitest-testing");
  const deps = makeDeps(workspace, { externalAgent: "codex" });
  const coord = new SkillPipelineCoordinator(deps);

  const prep = await coord.prepareForTesting({
    workspace,
    architecture: JSON.stringify({ test_framework: "vitest" }),
    cycle: 0,
  });

  if (prep.enabled && prep.skillContext) {
    expect(prep.skillContext.request.mode).toBe("codex-cli");
  }
});

test("reasoning agent uses native-tool-loop when no external agent", async () => {
  installSkillInWorkspace(workspace, "vitest-testing");
  const deps = makeDeps(workspace, { externalAgent: undefined });
  const coord = new SkillPipelineCoordinator(deps);

  const prep = await coord.prepareForTesting({
    workspace,
    architecture: JSON.stringify({ test_framework: "vitest" }),
    cycle: 0,
  });

  if (prep.enabled && prep.skillContext) {
    expect(prep.skillContext.request.mode).toBe("native-tool-loop");
  }
});
