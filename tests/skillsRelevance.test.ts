import type { CompactSkillContextEntry } from "../src/skills/types.js";
import {
  selectRelevantSourceKeys,
  relevanceScoreForInstalledSkill,
} from "../src/skills/relevance.js";

function makeSkill(overrides: Partial<CompactSkillContextEntry> = {}): CompactSkillContextEntry {
  return {
    sourceKey: "owner__repo__my-skill",
    selectionId: "sel-1",
    packageRef: "owner/repo",
    skillName: "my-skill",
    displayName: "my-skill",
    description: "A useful skill.",
    forgePath: ".forge/skills/owner__repo__my-skill",
    ...overrides,
  };
}

// --- relevanceScoreForInstalledSkill ---

test("relevanceScoreForInstalledSkill returns 0 for unrelated skill", () => {
  const skill = makeSkill({ skillName: "deploy", description: "Deploy to Vercel" });
  const score = relevanceScoreForInstalledSkill(skill, "react testing vitest", "pre-coding-task", "CodingAgent");
  expect(score).toBe(0);
});

test("relevanceScoreForInstalledSkill returns >0 for matching text", () => {
  const skill = makeSkill({ skillName: "react", description: "React frontend UI patterns" });
  const score = relevanceScoreForInstalledSkill(skill, "react dashboard component", "pre-coding-task", "CodingAgent");
  expect(score).toBeGreaterThan(0);
});

test("TestAgent gets bonus for test-related skill", () => {
  const skill = makeSkill({ skillName: "vitest-setup", description: "Vitest testing patterns" });
  const scoreTest = relevanceScoreForInstalledSkill(skill, "run tests", "pre-testing", "TestAgent");
  const scoreCoding = relevanceScoreForInstalledSkill(skill, "run tests", "pre-testing", "CodingAgent");
  expect(scoreTest).toBeGreaterThan(scoreCoding);
});

test("DeployAgent gets bonus for deploy-related skill", () => {
  const skill = makeSkill({ skillName: "vercel-deploy", description: "Deploy to Vercel" });
  const scoreDeploy = relevanceScoreForInstalledSkill(skill, "deploy app", "pre-deploy", "DeployAgent");
  const scoreCoding = relevanceScoreForInstalledSkill(skill, "deploy app", "pre-deploy", "CodingAgent");
  expect(scoreDeploy).toBeGreaterThan(scoreCoding);
});

test("post-verification-failure gets bonus for debug skill", () => {
  const skill = makeSkill({ skillName: "debug-helper", description: "Fix and debug errors" });
  const scoreFailure = relevanceScoreForInstalledSkill(skill, "fix build error", "post-verification-failure", "CodingAgent");
  const scoreNormal = relevanceScoreForInstalledSkill(skill, "fix build error", "pre-coding-task", "CodingAgent");
  expect(scoreFailure).toBeGreaterThan(scoreNormal);
});

// --- selectRelevantSourceKeys ---

test("selectRelevantSourceKeys returns empty array when no installed skills", () => {
  const result = selectRelevantSourceKeys({
    moment: "pre-coding-task",
    agentName: "CodingAgent",
    installed: [],
    taskTitle: "Build React UI",
    limit: 3,
  });
  expect(result).toHaveLength(0);
});

test("selectRelevantSourceKeys returns empty when no overlap", () => {
  const result = selectRelevantSourceKeys({
    moment: "pre-coding-task",
    agentName: "CodingAgent",
    installed: [makeSkill({ sourceKey: "deploy", skillName: "deploy", description: "Deploy to Vercel" })],
    taskTitle: "Write React components for dashboard",
    limit: 3,
  });
  expect(result).toHaveLength(0);
});

test("selectRelevantSourceKeys prefers task-matching skill", () => {
  const selected = selectRelevantSourceKeys({
    moment: "pre-coding-task",
    agentName: "CodingAgent",
    installed: [
      makeSkill({ sourceKey: "react", skillName: "react", description: "React frontend UI patterns" }),
      makeSkill({ sourceKey: "deploy", skillName: "deploy", description: "Deploy to Vercel" }),
    ],
    taskTitle: "Build React dashboard UI",
    limit: 1,
  });
  expect(selected).toEqual(["react"]);
});

test("selectRelevantSourceKeys respects limit", () => {
  const installed = [
    makeSkill({ sourceKey: "react", skillName: "react", description: "React frontend UI patterns" }),
    makeSkill({ sourceKey: "vitest", skillName: "vitest", description: "Vitest testing patterns" }),
    makeSkill({ sourceKey: "tailwind", skillName: "tailwind", description: "Tailwind CSS frontend" }),
  ];
  const result = selectRelevantSourceKeys({
    moment: "pre-coding-task",
    agentName: "CodingAgent",
    installed,
    text: "react vitest tailwind frontend testing",
    limit: 2,
  });
  expect(result).toHaveLength(2);
});

test("selectRelevantSourceKeys testing agent prefers test framework skills", () => {
  const selected = selectRelevantSourceKeys({
    moment: "pre-testing",
    agentName: "TestAgent",
    installed: [
      makeSkill({ sourceKey: "vitest", skillName: "vitest", description: "Vitest testing patterns" }),
      makeSkill({ sourceKey: "css", skillName: "css-layout", description: "CSS layout guidance" }),
    ],
    architecture: JSON.stringify({ test_framework: "vitest" }),
    limit: 1,
  });
  expect(selected).toEqual(["vitest"]);
});

test("selectRelevantSourceKeys sorts ties by sourceKey alphabetically", () => {
  const installed = [
    makeSkill({ sourceKey: "z-skill", skillName: "react", description: "React UI frontend" }),
    makeSkill({ sourceKey: "a-skill", skillName: "react-x", description: "React UI frontend" }),
  ];
  const result = selectRelevantSourceKeys({
    moment: "pre-coding-task",
    agentName: "CodingAgent",
    installed,
    text: "react frontend ui",
    limit: 2,
  });
  // Both match equally — sorted alphabetically
  expect(result[0]).toBe("a-skill");
  expect(result[1]).toBe("z-skill");
});

test("selectRelevantSourceKeys uses text for scoring", () => {
  const result = selectRelevantSourceKeys({
    moment: "pre-integration",
    agentName: "IntegrationAgent",
    installed: [
      makeSkill({ sourceKey: "prisma", skillName: "prisma", description: "Prisma database ORM" }),
    ],
    text: "prisma database orm integration",
    limit: 1,
  });
  expect(result).toContain("prisma");
});
