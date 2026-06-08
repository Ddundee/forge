import type { ForgeConfig } from "../config.js";
import type { SkillConfig, SkillMode } from "./types.js";

export interface RawBuildSkillOptions {
  skills?: string;
  skillsMax?: string | number;
}

export interface BuildSkillOverrides {
  mode?: SkillMode;
  maxSkills?: number;
  warnings: string[];
}

export function parseSkillMode(value: string): SkillMode {
  if (value === "auto" || value === "off") return value;
  throw new Error(`Invalid --skills value: ${value}. Expected auto or off.`);
}

export function parseNonNegativeInt(value: string | number, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return parsed;
}

export function parseBuildSkillOptions(raw: RawBuildSkillOptions): BuildSkillOverrides {
  const warnings: string[] = [];
  const mode = raw.skills === undefined ? undefined : parseSkillMode(raw.skills);
  const maxSkills =
    raw.skillsMax === undefined ? undefined : parseNonNegativeInt(raw.skillsMax, "--skills-max");
  return { mode, maxSkills, warnings };
}

export function applyBuildSkillOverrides(
  base: ForgeConfig,
  overrides: BuildSkillOverrides,
): ForgeConfig {
  const skills: SkillConfig = {
    ...base.skills,
    mode: overrides.mode ?? base.skills.mode,
    maxSkills: overrides.maxSkills ?? base.skills.maxSkills,
  };

  if (overrides.maxSkills !== undefined && skills.mode === "off") {
    overrides.warnings.push(
      "--skills-max was provided but skills mode is off; the cap will have no effect.",
    );
  }

  return base.withSkills(skills);
}
