import { planSkillQueries } from "../src/skills/planner.js";

test("plans React frontend queries from architecture", () => {
  const queries = planSkillQueries({
    phase: "CODING",
    architecture: {
      stack: { language: "TypeScript", framework: "Vite+React", database: "none" },
      deploy_platforms: ["vercel"],
      test_framework: "vitest",
      verification_method: "web",
    },
  });
  const queryStrings = queries.map((q) => q.query);
  expect(queryStrings).toContain("react frontend");
  expect(queryStrings).toContain("vitest testing");
  expect(queryStrings).toContain("vercel deployment");
});

test("plans failure-specific debugging queries with stack context", () => {
  const queries = planSkillQueries({
    phase: "VERIFICATION",
    architecture: { stack: { framework: "Next.js", language: "TypeScript" } },
    failures: ["npm run build failed with TypeScript module resolution error"],
  });
  const queryStrings = queries.map((q) => q.query);
  expect(queryStrings).toContain("typescript build errors");
  expect(queryStrings).toContain("module resolution debugging");
});

test("deduplicates and limits queries by weight", () => {
  const queries = planSkillQueries({
    phase: "CODING",
    idea: "React React React dashboard",
    spec: { tech_stack: ["React"] },
    maxQueries: 2,
  });
  expect(new Set(queries.map((q) => q.query)).size).toBe(queries.length);
  expect(queries).toHaveLength(2);
});

test("returns empty array when no input is provided", () => {
  const queries = planSkillQueries({ phase: "CODING" });
  expect(queries).toEqual([]);
});

test("handles malformed JSON in spec gracefully", () => {
  const queries = planSkillQueries({
    phase: "CODING",
    spec: "{invalid json{{",
  });
  expect(Array.isArray(queries)).toBe(true);
});

test("generates queries from tasks", () => {
  const queries = planSkillQueries({
    phase: "CODING",
    tasks: [{ title: "Build authentication login page" }],
  });
  const queryStrings = queries.map((q) => q.query);
  expect(queryStrings.some((q) => q.includes("auth"))).toBe(true);
});

test("respects default max query limit", () => {
  const queries = planSkillQueries({
    phase: "CODING",
    idea: "a react app",
    spec: { tech_stack: ["React", "TypeScript"], features: ["auth", "dashboard", "charts", "api"] },
    architecture: {
      stack: { language: "TypeScript", framework: "React", database: "postgres" },
      deploy_platforms: ["vercel"],
      test_framework: "vitest",
    },
  });
  expect(queries.length).toBeLessThanOrEqual(8);
});

test("plans NextJS queries from architecture framework", () => {
  const queries = planSkillQueries({
    phase: "CODING",
    architecture: { stack: { framework: "Next.js", language: "TypeScript" } },
  });
  const queryStrings = queries.map((q) => q.query);
  expect(queryStrings).toContain("nextjs");
});
