import { ForgeConfig, DEFAULT_SKILL_CONFIG } from "../src/config.js";
import {
  parseSkillMode,
  parseNonNegativeInt,
  parseBuildSkillOptions,
  applyBuildSkillOverrides,
} from "../src/skills/cliOptions.js";

// --- parseSkillMode ---

test("parseSkillMode accepts auto", () => {
  expect(parseSkillMode("auto")).toBe("auto");
});

test("parseSkillMode accepts off", () => {
  expect(parseSkillMode("off")).toBe("off");
});

test("parseSkillMode rejects unknown values", () => {
  expect(() => parseSkillMode("manual")).toThrow("Expected auto or off");
});

test("parseSkillMode rejects empty string", () => {
  expect(() => parseSkillMode("")).toThrow("Expected auto or off");
});

// --- parseNonNegativeInt ---

test("parseNonNegativeInt accepts zero", () => {
  expect(parseNonNegativeInt("0", "--skills-max")).toBe(0);
});

test("parseNonNegativeInt accepts positive integer string", () => {
  expect(parseNonNegativeInt("3", "--skills-max")).toBe(3);
});

test("parseNonNegativeInt accepts positive number directly", () => {
  expect(parseNonNegativeInt(5, "--skills-max")).toBe(5);
});

test("parseNonNegativeInt rejects negative integer", () => {
  expect(() => parseNonNegativeInt("-1", "--skills-max")).toThrow();
});

test("parseNonNegativeInt rejects float", () => {
  expect(() => parseNonNegativeInt("1.5", "--skills-max")).toThrow();
});

test("parseNonNegativeInt rejects non-numeric string", () => {
  expect(() => parseNonNegativeInt("abc", "--skills-max")).toThrow();
});

// --- parseBuildSkillOptions ---

test("parseBuildSkillOptions with no options returns no overrides and no warnings", () => {
  const result = parseBuildSkillOptions({});
  expect(result.mode).toBeUndefined();
  expect(result.maxSkills).toBeUndefined();
  expect(result.warnings).toHaveLength(0);
});

test("parseBuildSkillOptions with skills auto returns mode auto", () => {
  const result = parseBuildSkillOptions({ skills: "auto" });
  expect(result.mode).toBe("auto");
});

test("parseBuildSkillOptions with skillsMax parses integer", () => {
  const result = parseBuildSkillOptions({ skillsMax: "2" });
  expect(result.maxSkills).toBe(2);
});

test("parseBuildSkillOptions with invalid skillsMax throws", () => {
  expect(() => parseBuildSkillOptions({ skillsMax: "abc" })).toThrow();
});

// --- applyBuildSkillOverrides ---

function makeBaseConfig(mode: "off" | "auto" = "off", maxSkills = 3): ForgeConfig {
  return new ForgeConfig("claude-primary", {}, 5, "quality", "", {
    ...DEFAULT_SKILL_CONFIG,
    mode,
    maxSkills,
  });
}

test("applyBuildSkillOverrides does not mutate base config", () => {
  const base = makeBaseConfig("off", 3);
  const overrides = parseBuildSkillOptions({ skills: "auto", skillsMax: "1" });
  const effective = applyBuildSkillOverrides(base, overrides);

  expect(base.skills.mode).toBe("off");
  expect(base.skills.maxSkills).toBe(3);
  expect(effective.skills.mode).toBe("auto");
  expect(effective.skills.maxSkills).toBe(1);
});

test("applyBuildSkillOverrides with mode auto overrides off base", () => {
  const base = makeBaseConfig("off");
  const overrides = parseBuildSkillOptions({ skills: "auto" });
  const effective = applyBuildSkillOverrides(base, overrides);
  expect(effective.skills.mode).toBe("auto");
});

test("applyBuildSkillOverrides with mode off overrides auto base", () => {
  const base = makeBaseConfig("auto");
  const overrides = parseBuildSkillOptions({ skills: "off" });
  const effective = applyBuildSkillOverrides(base, overrides);
  expect(effective.skills.mode).toBe("off");
});

test("applyBuildSkillOverrides with no overrides preserves base", () => {
  const base = makeBaseConfig("auto", 5);
  const overrides = parseBuildSkillOptions({});
  const effective = applyBuildSkillOverrides(base, overrides);
  expect(effective.skills.mode).toBe("auto");
  expect(effective.skills.maxSkills).toBe(5);
});

test("skills-max alone warns when effective mode is off", () => {
  const base = makeBaseConfig("off");
  const overrides = parseBuildSkillOptions({ skillsMax: "2" });
  applyBuildSkillOverrides(base, overrides);
  expect(overrides.warnings[0]).toContain("no effect");
});

test("skills-max with skills auto does not warn", () => {
  const base = makeBaseConfig("off");
  const overrides = parseBuildSkillOptions({ skills: "auto", skillsMax: "2" });
  applyBuildSkillOverrides(base, overrides);
  expect(overrides.warnings).toHaveLength(0);
});

test("skills-max with auto base config does not warn", () => {
  const base = makeBaseConfig("auto");
  const overrides = parseBuildSkillOptions({ skillsMax: "1" });
  applyBuildSkillOverrides(base, overrides);
  expect(overrides.warnings).toHaveLength(0);
});

test("applyBuildSkillOverrides preserves other skills fields", () => {
  const base = makeBaseConfig("off");
  const overrides = parseBuildSkillOptions({ skills: "auto" });
  const effective = applyBuildSkillOverrides(base, overrides);
  expect(effective.skills.promptCharBudget).toBe(DEFAULT_SKILL_CONFIG.promptCharBudget);
  expect(effective.skills.trustedSources).toEqual(DEFAULT_SKILL_CONFIG.trustedSources);
  expect(effective.skills.installTargets).toEqual(DEFAULT_SKILL_CONFIG.installTargets);
});
