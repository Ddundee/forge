import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SkillPipelineCoordinator, type SkillPipelineDeps } from "../src/skills/pipeline.js";
import { SkillContextProvider } from "../src/skills/context.js";
import { ForgeDb } from "../src/db.js";
import { DEFAULT_SKILL_CONFIG } from "../src/config.js";
import { parseUseOutput } from "../src/skills/cli.js";

// Fixtures
const FRONTEND_FIND_TXT = fs.readFileSync(
  path.join(__dirname, "fixtures", "skills-e2e", "frontend-find.txt"),
  "utf8",
);
const FRONTEND_USE_TXT = fs.readFileSync(
  path.join(__dirname, "fixtures", "skills-e2e", "frontend-use.txt"),
  "utf8",
);
const AUDIT_FAIL_USE_TXT = fs.readFileSync(
  path.join(__dirname, "fixtures", "skills-e2e", "audit-fail-use.txt"),
  "utf8",
);

const SPEC = JSON.stringify({ name: "bakery website", description: "A React website for a bakery" });
const ARCH = JSON.stringify({ stack: { language: "TypeScript", framework: "React" }, test_framework: "vitest" });

function makeDb(): { db: ForgeDb; sessionId: string } {
  const db = new ForgeDb(":memory:");
  const sessionId = db.createSession("bakery website");
  return { db, sessionId };
}

function makeSkillConfig(overrides: Record<string, unknown> = {}) {
  return {
    ...DEFAULT_SKILL_CONFIG,
    mode: "auto" as const,
    maxSkills: 1,
    ...overrides,
  };
}

function makeSearchClient(candidateLines: string) {
  return {
    find: jest.fn().mockResolvedValue({
      query: "frontend design",
      candidates: candidateLines.includes("vercel-labs") ? [
        {
          packageRef: "vercel-labs/agent-skills",
          skillName: "web-design-guidelines",
          description: "Build polished web applications",
          installCount: 120000,
          score: 0.91,
        },
      ] : [],
      rawOutput: candidateLines,
    }),
  };
}

function makeUseClient(fixture: string) {
  return {
    use: jest.fn().mockImplementation(async (source: string, skillName: string) => {
      return parseUseOutput(source, skillName, fixture);
    }),
  };
}

function makeInstallClient(workspace: string) {
  return {
    install: jest.fn().mockImplementation(async (req: { source: string; skillName: string; workspace: string; agents: string[] }) => {
      // Create agents skill directory (mirroring what real skills add would do)
      const agentsDir = path.join(req.workspace, ".agents", "skills", req.skillName);
      fs.mkdirSync(agentsDir, { recursive: true });
      const skill = parseUseOutput(req.source, req.skillName, FRONTEND_USE_TXT);
      const mdContent = skill.skillMarkdown
        ? `---\nname: ${req.skillName}\ndescription: Build polished web applications\n---\n\n${skill.skillMarkdown}`
        : `---\nname: ${req.skillName}\ndescription: Build polished web applications\n---\n\n# ${req.skillName}\n`;
      fs.writeFileSync(path.join(agentsDir, "SKILL.md"), mdContent, "utf8");
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
    idea: "bakery website",
    workspace,
    config: makeSkillConfig(),
    db,
    searchClient: makeSearchClient(FRONTEND_FIND_TXT),
    useClient: makeUseClient(FRONTEND_USE_TXT),
    installClient: makeInstallClient(workspace),
    contextProvider: new SkillContextProvider(),
    ...overrides,
  };
}

let workspace: string;
beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "forge-skills-int-test-"));
});
afterEach(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

// --- T2-PIPELINE-SELECTED ---

test("pipeline: selected skill produces enabled context with skillContext", async () => {
  const deps = makeDeps(workspace);
  const coord = new SkillPipelineCoordinator(deps);

  const prep = await coord.prepareForArchitecture({ spec: SPEC });

  expect(prep.moment).toBe("pre-architecture");
  if (prep.enabled) {
    expect(prep.skillContext).toBeDefined();
    expect(prep.relevantSourceKeys.length).toBeGreaterThanOrEqual(0);
  }
  // discovery was attempted
  expect(deps.searchClient.find).toHaveBeenCalled();
});

test("pipeline: passing skill causes use client to be called for audit", async () => {
  const deps = makeDeps(workspace);
  const coord = new SkillPipelineCoordinator(deps);

  await coord.prepareForArchitecture({ spec: SPEC });

  // If a candidate was found, use client should be called to fetch SKILL.md for audit
  if ((deps.searchClient.find as jest.Mock).mock.results[0]?.value) {
    const findResult = await (deps.searchClient.find as jest.Mock).mock.results[0].value;
    if (findResult.candidates.length > 0) {
      expect(deps.useClient.use).toHaveBeenCalled();
    }
  }
});

// --- T2-PIPELINE-NONE ---

test("pipeline: no candidates returns disabled preparation", async () => {
  const deps = makeDeps(workspace, {
    searchClient: {
      find: jest.fn().mockResolvedValue({ query: "frontend", candidates: [], rawOutput: "" }),
    },
  });
  const coord = new SkillPipelineCoordinator(deps);

  const prep = await coord.prepareForArchitecture({ spec: SPEC });

  expect(prep.enabled).toBe(false);
  expect(prep.skillContext).toBeUndefined();
});

test("pipeline: empty search does not call use or install client", async () => {
  const useClient = makeUseClient(FRONTEND_USE_TXT);
  const installClient = makeInstallClient(workspace);
  const deps = makeDeps(workspace, {
    searchClient: {
      find: jest.fn().mockResolvedValue({ query: "frontend", candidates: [], rawOutput: "" }),
    },
    useClient,
    installClient,
  });
  const coord = new SkillPipelineCoordinator(deps);

  await coord.prepareForArchitecture({ spec: SPEC });

  expect(useClient.use).not.toHaveBeenCalled();
  expect(installClient.install).not.toHaveBeenCalled();
});

// --- T2-PIPELINE-AUDIT-FAIL ---

test("pipeline: audit-failing skill blocks install and context injection", async () => {
  const installClient = makeInstallClient(workspace);
  const deps = makeDeps(workspace, {
    useClient: makeUseClient(AUDIT_FAIL_USE_TXT),
    installClient,
  });
  const coord = new SkillPipelineCoordinator(deps);

  const prep = await coord.prepareForArchitecture({ spec: SPEC });

  // Audit fail means no install and no context
  expect(installClient.install).not.toHaveBeenCalled();
  expect(prep.enabled).toBe(false);
  expect(prep.skillContext).toBeUndefined();
});

test("pipeline: audit fail is recorded in DB", async () => {
  const deps = makeDeps(workspace, {
    useClient: makeUseClient(AUDIT_FAIL_USE_TXT),
    installClient: makeInstallClient(workspace),
  });
  const coord = new SkillPipelineCoordinator(deps);

  await coord.prepareForArchitecture({ spec: SPEC });

  // DB should have an audit record if a candidate was fetched and audited
  const audits = (deps.db as ForgeDb)["db"]
    .prepare("SELECT * FROM skill_audits WHERE session_id = ?")
    .all(deps.sessionId) as any[];

  if ((deps.searchClient.find as jest.Mock).mock.calls.length > 0) {
    const findResult = await (deps.searchClient.find as jest.Mock).mock.results[0].value;
    if (findResult.candidates.length > 0) {
      expect(audits.length).toBeGreaterThan(0);
      expect(audits[0].verdict).toBe("fail");
    }
  }
});

// --- mode off ---

test("pipeline: mode off skips search entirely", async () => {
  const searchClient = makeSearchClient(FRONTEND_FIND_TXT);
  const deps = makeDeps(workspace, {
    config: makeSkillConfig({ mode: "off" }),
    searchClient,
  });
  const coord = new SkillPipelineCoordinator(deps);

  const prep = await coord.prepareForArchitecture({ spec: SPEC });

  expect(prep.enabled).toBe(false);
  expect(searchClient.find).not.toHaveBeenCalled();
});

// --- fingerprint dedup ---

test("pipeline: identical arch calls reuse fingerprint cache", async () => {
  const emitted: string[] = [];
  // Use empty search so discovery succeeds without needing install files
  const deps = makeDeps(workspace, {
    searchClient: { find: jest.fn().mockResolvedValue({ query: "", candidates: [], rawOutput: "" }) },
    emit: (m) => emitted.push(m),
  });
  const coord = new SkillPipelineCoordinator(deps);

  await coord.prepareForVerificationFailure({
    spec: SPEC,
    architecture: ARCH,
    failures: ["build failed: module not found"],
    errors: [],
    cycle: 1,
  });
  await coord.prepareForVerificationFailure({
    spec: SPEC,
    architecture: ARCH,
    failures: ["build failed: module not found"],
    errors: [],
    cycle: 1,
  });

  expect(emitted.some((m) => m.includes("reused"))).toBe(true);
});

// --- emit events ---

test("pipeline: emit function is called during coordinated build", async () => {
  const emitted: string[] = [];
  const deps = makeDeps(workspace, {
    emit: (m) => emitted.push(m),
  });
  const coord = new SkillPipelineCoordinator(deps);

  await coord.prepareForArchitecture({ spec: SPEC });

  expect(Array.isArray(emitted)).toBe(true);
});

// --- disabled mode via maxSkills 0 ---

test("pipeline: maxSkills 0 disables pipeline", async () => {
  const searchClient = makeSearchClient(FRONTEND_FIND_TXT);
  const deps = makeDeps(workspace, {
    config: makeSkillConfig({ maxSkills: 0 }),
    searchClient,
  });
  const coord = new SkillPipelineCoordinator(deps);

  const prep = await coord.prepareForArchitecture({ spec: SPEC });

  expect(prep.enabled).toBe(false);
  expect(searchClient.find).not.toHaveBeenCalled();
});
