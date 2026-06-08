import type { SkillConfig } from "../src/skills/types.js";
import type { PlannedSkillQuery } from "../src/skills/planner.js";
import type { SkillCandidate } from "../src/skills/types.js";
import { scoreSkillCandidate, rankAndSelectSkills, skillKey } from "../src/skills/scoring.js";

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

function q(queryStr: string, phase = "CODING"): PlannedSkillQuery {
  return { query: queryStr, source: "architecture", phase, reason: "test", weight: 1 };
}

function candidate(overrides: Partial<SkillCandidate> & { packageRef: string; skillName: string }): SkillCandidate {
  return {
    title: overrides.skillName,
    ...overrides,
  };
}

test("skillKey produces lowercase packageRef@skillName", () => {
  const c = candidate({ packageRef: "Vercel-Labs/Agent-Skills", skillName: "Deploy-to-Vercel" });
  expect(skillKey(c)).toBe("vercel-labs/agent-skills@deploy-to-vercel");
});

test("trusted high relevance deployment skill is selected", () => {
  const ranked = rankAndSelectSkills({
    config: {
      mode: "auto",
      maxSkills: 3,
      promptCharBudget: 12000,
      minInstallCount: 100,
      trustedSources: ["vercel-labs", "anthropics", "openai", "microsoft"],
      installTargets: ["forge", "agents"],
    },
    candidates: [{
      query: { query: "vercel deployment", source: "architecture", phase: "DEPLOY", reason: "deploy target", weight: 1 },
      candidate: {
        packageRef: "vercel-labs/agent-skills",
        skillName: "deploy-to-vercel",
        title: "deploy-to-vercel",
        installCount: 66000,
      },
    }],
  });
  expect(ranked[0].selected).toBe(true);
});

test("low install unknown source is skipped even when relevant", () => {
  const ranked = rankAndSelectSkills({
    config: testConfig({ minInstallCount: 100 }),
    candidates: [{
      query: { query: "frontend design", source: "spec", phase: "CODING", reason: "ui", weight: 1 },
      candidate: {
        packageRef: "unknown/repo",
        skillName: "frontend-design",
        title: "frontend-design",
        installCount: 12,
      },
    }],
  });
  expect(ranked[0].selected).toBe(false);
  expect(ranked[0].skipReason).toContain("install count");
});

test("selection respects maxSkills and deduplicates exact skill keys", () => {
  const c = candidate({
    packageRef: "vercel-labs/agent-skills",
    skillName: "deploy-to-vercel",
    installCount: 66000,
  });
  const ranked = rankAndSelectSkills({
    config: testConfig({ maxSkills: 1 }),
    candidates: [
      { query: q("vercel deployment", "DEPLOY"), candidate: c },
      { query: q("deployment", "DEPLOY"), candidate: c },
    ],
  });
  expect(ranked.filter((r) => r.selected)).toHaveLength(1);
  expect(ranked.some((r) => r.skipReason === "duplicate candidate")).toBe(true);
});

test("scoreSkillCandidate gives trusted source a high reputation score", () => {
  const c = candidate({ packageRef: "vercel-labs/agent-skills", skillName: "deploy", installCount: 100 });
  const score = scoreSkillCandidate(c, q("vercel deployment"), testConfig());
  expect(score.sourceReputation).toBe(1);
});

test("scoreSkillCandidate penalizes existing skill keys from DB", () => {
  const c = candidate({ packageRef: "vercel-labs/agent-skills", skillName: "deploy-to-vercel", installCount: 66000 });
  const existing = new Set([skillKey(c)]);
  const score = scoreSkillCandidate(c, q("vercel deployment", "DEPLOY"), testConfig(), existing);
  expect(score.duplicatePenalty).toBe(1);
  expect(score.total).toBeLessThan(0.3);
});

test("candidates below score threshold are skipped", () => {
  const c = candidate({ packageRef: "obscure/repo", skillName: "some-skill", installCount: 9999 });
  const ranked = rankAndSelectSkills({
    config: testConfig({ minInstallCount: 0 }),
    candidates: [{ query: q("completely unrelated topic"), candidate: c }],
    scoreThreshold: 0.99,
  });
  expect(ranked[0].selected).toBe(false);
  expect(ranked[0].skipReason).toContain("score below threshold");
});

test("max skills limit stops selection after limit reached", () => {
  const configs = testConfig({ maxSkills: 1, minInstallCount: 0 });
  const c1 = candidate({ packageRef: "vercel-labs/agent-skills", skillName: "deploy-to-vercel", installCount: 66000 });
  const c2 = candidate({ packageRef: "anthropics/skills", skillName: "testing", installCount: 10000 });
  const ranked = rankAndSelectSkills({
    config: configs,
    candidates: [
      { query: q("vercel deployment", "DEPLOY"), candidate: c1 },
      { query: q("testing", "TESTING"), candidate: c2 },
    ],
    scoreThreshold: 0,
  });
  const selected = ranked.filter((r) => r.selected);
  const maxReached = ranked.filter((r) => r.skipReason?.includes("max skills"));
  expect(selected).toHaveLength(1);
  expect(maxReached).toHaveLength(1);
});

test("slug tokenization improves relevance for hyphenated skill names", () => {
  const c = candidate({ packageRef: "vtex/skills", skillName: "vtex-io-react-apps", installCount: 1000 });
  const score = scoreSkillCandidate(c, q("react frontend"), testConfig({ minInstallCount: 0 }));
  expect(score.relevance).toBeGreaterThan(0);
});

test("candidateId is preserved through rankAndSelectSkills", () => {
  const c = candidate({ packageRef: "vercel-labs/agent-skills", skillName: "deploy-to-vercel", installCount: 66000 });
  const ranked = rankAndSelectSkills({
    config: testConfig(),
    candidates: [{ query: q("vercel deployment", "DEPLOY"), candidate: c, candidateId: "c42" }],
    scoreThreshold: 0,
  });
  expect(ranked[0].candidateId).toBe("c42");
});

test("null title and description do not throw in phaseFit scoring", () => {
  const c = candidate({ packageRef: "vercel-labs/agent-skills", skillName: "deploy-to-vercel", installCount: 66000 });
  expect(() => scoreSkillCandidate(c, q("vercel deployment", "DEPLOY"), testConfig())).not.toThrow();
});

test("build token is not a stop word in scoring relevance", () => {
  const c = candidate({ packageRef: "vercel-labs/agent-skills", skillName: "build-tool", installCount: 1000 });
  const score = scoreSkillCandidate(c, q("build tool"), testConfig({ minInstallCount: 0 }));
  expect(score.relevance).toBeGreaterThan(0);
});
