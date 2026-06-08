export type SkillQuerySource = "idea" | "spec" | "architecture" | "task" | "failure";

export interface PlannedSkillQuery {
  query: string;
  source: SkillQuerySource;
  phase: string;
  reason: string;
  weight: number;
}

export interface SkillPlanningInput {
  phase: string;
  idea?: string;
  spec?: string | Record<string, unknown>;
  architecture?: string | Record<string, unknown>;
  tasks?: Array<{ id?: string; title: string; type?: string }>;
  failures?: string[];
  maxQueries?: number;
}

const STOP_WORDS = new Set([
  "a", "an", "and", "app", "application", "create",
  "for", "of", "the", "to", "with",
]);

const DEFAULT_MAX_QUERIES = 8;

function mq(query: string, source: SkillQuerySource, phase: string, reason: string, weight: number): PlannedSkillQuery {
  return { query, source, phase, reason, weight };
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[-_/]+/g, " ")
    .replace(/[^a-z0-9+#. ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
}

function objectFromMaybeJson(value: string | Record<string, unknown> | undefined): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return { raw: value };
  }
}

const FRAMEWORK_QUERIES: Array<[RegExp, string[]]> = [
  [/next\.?js|nextjs/i, ["nextjs", "react frontend"]],
  [/vite.*react|react.*vite/i, ["react frontend", "typescript react"]],
  [/react/i, ["react frontend", "typescript react"]],
  [/vue/i, ["vue frontend"]],
  [/svelte/i, ["svelte frontend"]],
  [/fastapi/i, ["fastapi python"]],
  [/express|node\.?js/i, ["nodejs backend", "express api"]],
];

const DOMAIN_QUERIES: Array<[RegExp, string[]]> = [
  [/\b(?:landing|website|frontend|ui|ux|dashboard)\b/i, ["frontend design"]],
  [/accessibility|a11y/i, ["accessibility frontend"]],
  [/auth|login|oauth|jwt/i, ["authentication security"]],
  [/database|postgres|sqlite|supabase/i, ["database"]],
  [/test|testing|e2e|playwright|vitest|jest/i, ["testing", "playwright testing"]],
  [/deploy|deployment|vercel|railway|fly/i, ["deployment"]],
  [/readme|documentation|docs/i, ["documentation readme"]],
];

const FAILURE_QUERY_RULES: Array<[RegExp, string]> = [
  [/build|compile|tsc|typescript/i, "typescript build errors"],
  [/test|assert|expect|jest|vitest|pytest/i, "testing failures"],
  [/playwright|browser|locator/i, "playwright testing"],
  [/deploy|vercel|railway|fly/i, "deployment troubleshooting"],
  [/import|module|resolve/i, "module resolution debugging"],
  [/css|layout|responsive|mobile/i, "frontend design debugging"],
];

function addRuleQueries(
  queries: PlannedSkillQuery[],
  text: string,
  rules: Array<[RegExp, string[]]>,
  source: SkillQuerySource,
  phase: string,
  baseWeight: number,
): void {
  for (const [regex, queryList] of rules) {
    if (regex.test(text)) {
      queryList.forEach((queryStr, i) => {
        queries.push(mq(queryStr, source, phase, text.slice(0, 40), Math.max(0.1, baseWeight - i * 0.1)));
      });
      return;
    }
  }
}

function queriesFromArchitecture(architecture: Record<string, unknown>, phase: string): PlannedSkillQuery[] {
  const stack = (architecture["stack"] ?? {}) as Record<string, unknown>;
  const framework = String(stack["framework"] ?? "");
  const language = String(stack["language"] ?? "");
  const database = String(stack["database"] ?? "");
  const extras = Array.isArray(stack["extras"]) ? stack["extras"].map(String) : [];
  const testFramework = String(architecture["test_framework"] ?? "");
  const deployPlatforms = Array.isArray(architecture["deploy_platforms"])
    ? architecture["deploy_platforms"].map(String)
    : [];

  const queries: PlannedSkillQuery[] = [];
  if (framework && framework !== "undefined") {
    addRuleQueries(queries, `${framework} ${language}`, FRAMEWORK_QUERIES, "architecture", phase, 1.0);
  }
  if (testFramework && testFramework !== "undefined") {
    queries.push(mq(`${testFramework} testing`, "architecture", phase, "test framework", 0.75));
  }
  for (const platform of deployPlatforms.filter((p) => p && p !== "none" && p !== "undefined")) {
    queries.push(mq(`${platform} deployment`, "architecture", phase, "deploy target", 0.65));
  }
  if (database && database !== "none" && database !== "undefined") {
    queries.push(mq(`${database} database`, "architecture", phase, "database", 0.6));
  }
  for (const extra of extras.slice(0, 3)) {
    if (extra && extra !== "undefined") {
      queries.push(mq(extra, "architecture", phase, "stack extra", 0.45));
    }
  }
  return queries;
}

function queriesFromSpec(spec: Record<string, unknown>, phase: string): PlannedSkillQuery[] {
  const techStack = Array.isArray(spec["tech_stack"]) ? spec["tech_stack"].map(String) : [];
  const features = Array.isArray(spec["features"]) ? spec["features"].map(String) : [];
  const queries: PlannedSkillQuery[] = [];

  for (const tech of techStack) {
    addRuleQueries(queries, tech, FRAMEWORK_QUERIES, "spec", phase, 0.8);
    addRuleQueries(queries, tech, DOMAIN_QUERIES, "spec", phase, 0.6);
  }

  for (const feature of features.slice(0, 4)) {
    const fw = words(feature);
    if (fw.length >= 2) {
      queries.push(mq(fw.slice(0, 2).join(" "), "spec", phase, "feature keyword", 0.6));
    }
    addRuleQueries(queries, feature, DOMAIN_QUERIES, "spec", phase, 0.6);
  }

  return queries;
}

function queriesFromIdea(idea: string, phase: string): PlannedSkillQuery[] {
  const queries: PlannedSkillQuery[] = [];
  addRuleQueries(queries, idea, FRAMEWORK_QUERIES, "idea", phase, 0.65);
  addRuleQueries(queries, idea, DOMAIN_QUERIES, "idea", phase, 0.5);
  return queries;
}

function queriesFromTasks(tasks: Array<{ id?: string; title: string; type?: string }>, phase: string): PlannedSkillQuery[] {
  const queries: PlannedSkillQuery[] = [];
  for (const task of tasks.slice(0, 4)) {
    addRuleQueries(queries, task.title, DOMAIN_QUERIES, "task", phase, 0.5);
    addRuleQueries(queries, task.title, FRAMEWORK_QUERIES, "task", phase, 0.5);
  }
  return queries;
}

function queriesFromFailures(failures: string[], phase: string): PlannedSkillQuery[] {
  const queries: PlannedSkillQuery[] = [];
  for (const failure of failures.slice(0, 4)) {
    for (const [regex, queryStr] of FAILURE_QUERY_RULES) {
      if (regex.test(failure)) {
        queries.push(mq(queryStr, "failure", phase, failure.slice(0, 40), 0.9));
      }
    }
  }
  return queries;
}

function dedupeAndLimit(queries: PlannedSkillQuery[], maxQueries: number): PlannedSkillQuery[] {
  const seen = new Set<string>();
  return queries
    .sort((a, b) => b.weight - a.weight)
    .filter((item) => {
      const key = item.query.toLowerCase().trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, maxQueries);
}

export function planSkillQueries(input: SkillPlanningInput): PlannedSkillQuery[] {
  const maxQueries = input.maxQueries ?? DEFAULT_MAX_QUERIES;
  const archObj = objectFromMaybeJson(input.architecture);
  const specObj = objectFromMaybeJson(input.spec);

  const queries: PlannedSkillQuery[] = [];

  if (Object.keys(archObj).length) {
    queries.push(...queriesFromArchitecture(archObj, input.phase));
  }
  if (Object.keys(specObj).length) {
    queries.push(...queriesFromSpec(specObj, input.phase));
  }
  if (input.idea) {
    queries.push(...queriesFromIdea(input.idea, input.phase));
  }
  if (input.tasks?.length) {
    queries.push(...queriesFromTasks(input.tasks, input.phase));
  }
  if (input.failures?.length) {
    queries.push(...queriesFromFailures(input.failures, input.phase));
  }

  return dedupeAndLimit(queries, maxQueries);
}
