import type { SkillConfig } from "../src/skills/types.js";
import { discoverSkillCandidates } from "../src/skills/discovery.js";

function testConfig(overrides: Partial<SkillConfig> = {}): SkillConfig {
  return {
    mode: "auto",
    maxSkills: 3,
    promptCharBudget: 12000,
    minInstallCount: 100,
    trustedSources: ["vercel-labs", "anthropics", "openai", "microsoft"],
    installTargets: ["forge", "agents"],
    ...overrides,
  };
}

function makeFakeSkillDiscoveryDb() {
  const queries: any[] = [];
  const candidates: any[] = [];
  const selections: any[] = [];
  return {
    queries,
    candidates,
    selections,
    logSkillQuery: jest.fn().mockImplementation((_sid: string, phase: string, query: string, attempt: number) => {
      const id = `q${queries.length}`;
      queries.push({ id, phase, query, attempt });
      return id;
    }),
    saveSkillCandidate: jest.fn().mockImplementation((_sid: string, queryId: string, candidate: any) => {
      const id = `c${candidates.length}`;
      candidates.push({ id, queryId, candidate });
      return id;
    }),
    selectSkill: jest.fn().mockImplementation((_sid: string, selection: any) => {
      const id = `s${selections.length}`;
      selections.push({ id, ...selection });
      return id;
    }),
    getSkillSelectionKeys: jest.fn().mockReturnValue([]),
  };
}

test("discoverSkillCandidates logs queries and selected candidates", async () => {
  const client = {
    find: jest.fn().mockResolvedValue({
      query: "vercel deployment",
      rawOutput: "fixture",
      candidates: [{
        packageRef: "vercel-labs/agent-skills",
        skillName: "deploy-to-vercel",
        title: "deploy-to-vercel",
        installCount: 66000,
      }],
    }),
  };
  const db = makeFakeSkillDiscoveryDb();
  const result = await discoverSkillCandidates({
    sessionId: "s1",
    workspace: "/tmp/ws",
    phase: "DEPLOY",
    attempt: 1,
    architecture: { deploy_platforms: ["vercel"] },
    config: testConfig(),
  }, client, db);
  expect(client.find).toHaveBeenCalled();
  expect(result.selected).toHaveLength(1);
  expect(db.selections[0].status).toBe("selected");
});

test("discoverSkillCandidates returns empty when no queries planned", async () => {
  const client = { find: jest.fn() };
  const db = makeFakeSkillDiscoveryDb();
  const result = await discoverSkillCandidates({
    sessionId: "s1",
    workspace: "/tmp/ws",
    phase: "CODING",
    attempt: 1,
    config: testConfig(),
  }, client, db);
  expect(client.find).not.toHaveBeenCalled();
  expect(result.selected).toHaveLength(0);
  expect(result.queries).toHaveLength(0);
});

test("discoverSkillCandidates skips candidates with low install count", async () => {
  const client = {
    find: jest.fn().mockResolvedValue({
      query: "react frontend",
      rawOutput: "fixture",
      candidates: [{
        packageRef: "unknown/repo",
        skillName: "react-thing",
        title: "react-thing",
        installCount: 5,
      }],
    }),
  };
  const db = makeFakeSkillDiscoveryDb();
  const result = await discoverSkillCandidates({
    sessionId: "s1",
    workspace: "/tmp/ws",
    phase: "CODING",
    attempt: 1,
    architecture: { stack: { framework: "React", language: "TypeScript" } },
    config: testConfig({ minInstallCount: 100 }),
  }, client, db);
  expect(result.selected).toHaveLength(0);
  const skipped = db.selections.filter((s: any) => s.status === "skipped");
  expect(skipped.length).toBeGreaterThan(0);
});

test("discoverSkillCandidates logs all queries and candidates to DB", async () => {
  const client = {
    find: jest.fn().mockResolvedValue({
      query: "any",
      rawOutput: "",
      candidates: [],
    }),
  };
  const db = makeFakeSkillDiscoveryDb();
  await discoverSkillCandidates({
    sessionId: "s1",
    workspace: "/tmp/ws",
    phase: "DEPLOY",
    attempt: 1,
    architecture: { deploy_platforms: ["vercel"] },
    config: testConfig(),
  }, client, db);
  expect(db.logSkillQuery).toHaveBeenCalled();
  expect(db.queries.length).toBeGreaterThan(0);
});

test("discoverSkillCandidates passes attempt to logSkillQuery", async () => {
  const client = {
    find: jest.fn().mockResolvedValue({ query: "vercel deployment", rawOutput: "", candidates: [] }),
  };
  const db = makeFakeSkillDiscoveryDb();
  await discoverSkillCandidates({
    sessionId: "s1",
    workspace: "/tmp/ws",
    phase: "DEPLOY",
    attempt: 3,
    architecture: { deploy_platforms: ["vercel"] },
    config: testConfig(),
  }, client, db);
  expect(db.queries.every((q: any) => q.attempt === 3)).toBe(true);
});

test("discoverSkillCandidates respects maxCandidatesPerQuery", async () => {
  const candidates = Array.from({ length: 10 }, (_, i) => ({
    packageRef: `vercel-labs/agent-skills`,
    skillName: `skill-${i}`,
    title: `skill-${i}`,
    installCount: 66000,
  }));
  const client = {
    find: jest.fn().mockResolvedValue({ query: "vercel deployment", rawOutput: "", candidates }),
  };
  const db = makeFakeSkillDiscoveryDb();
  await discoverSkillCandidates({
    sessionId: "s1",
    workspace: "/tmp/ws",
    phase: "DEPLOY",
    attempt: 1,
    architecture: { deploy_platforms: ["vercel"] },
    config: testConfig({ maxSkills: 10 }),
    maxCandidatesPerQuery: 3,
  }, client, db);
  expect(db.candidates.length).toBeLessThanOrEqual(3);
});

test("discoverSkillCandidates collects recoverable failures and continues", async () => {
  const client = {
    find: jest.fn()
      .mockRejectedValueOnce(new Error("network timeout"))
      .mockResolvedValue({ query: "any", rawOutput: "", candidates: [] }),
  };
  const db = makeFakeSkillDiscoveryDb();
  const result = await discoverSkillCandidates({
    sessionId: "s1",
    workspace: "/tmp/ws",
    phase: "DEPLOY",
    attempt: 1,
    architecture: { deploy_platforms: ["vercel", "railway"] },
    config: testConfig(),
  }, client, db);
  expect(result.failures).toHaveLength(1);
  expect(result.failures[0].recoverable).toBe(true);
  expect(result.failures[0].message).toContain("network timeout");
});

test("discoverSkillCandidates uses candidateId from DB when persisting selections", async () => {
  const client = {
    find: jest.fn().mockResolvedValue({
      query: "vercel deployment",
      rawOutput: "",
      candidates: [{
        packageRef: "vercel-labs/agent-skills",
        skillName: "deploy-to-vercel",
        title: "deploy-to-vercel",
        installCount: 66000,
      }],
    }),
  };
  const db = makeFakeSkillDiscoveryDb();
  await discoverSkillCandidates({
    sessionId: "s1",
    workspace: "/tmp/ws",
    phase: "DEPLOY",
    attempt: 1,
    architecture: { deploy_platforms: ["vercel"] },
    config: testConfig(),
  }, client, db);
  expect(db.selections[0].candidateId).toBe("c0");
});
