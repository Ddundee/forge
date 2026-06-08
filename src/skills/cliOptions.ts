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

/**
 * Parse a raw `--skills` option into a valid SkillMode.
 *
 * @param value - The raw value provided for the `--skills` option
 * @returns The parsed `SkillMode`, either `"auto"` or `"off"`
 * @throws Error if `value` is not `"auto"` or `"off"`
 */
export function parseSkillMode(value: string): SkillMode {
  if (value === "auto" || value === "off") return value;
  throw new Error(`Invalid --skills value: ${value}. Expected auto or off.`);
}

/**
 * Validate and return a non-negative integer parsed from the input.
 *
 * @param value - The input number or numeric string to parse.
 * @param label - Label used in the error message when validation fails.
 * @returns The parsed integer greater than or equal to zero.
 * @throws Error if `value` is not an integer or is negative; the error message is `${label} must be a non-negative integer.`
 */
export function parseNonNegativeInt(value: string | number, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return parsed;
}

/**
 * Parse raw CLI build-skill options into structured overrides.
 *
 * @param raw - Raw CLI-style inputs for build skills (e.g., `skills`, `skillsMax`)
 * @returns A `BuildSkillOverrides` object containing:
 *  - `mode`: the parsed `SkillMode` or `undefined` if not provided
 *  - `maxSkills`: the parsed non-negative integer or `undefined` if not provided
 *  - `warnings`: an array collecting any configuration warnings
 */
export function parseBuildSkillOptions(raw: RawBuildSkillOptions): BuildSkillOverrides {
  const warnings: string[] = [];
  const mode = raw.skills === undefined ? undefined : parseSkillMode(raw.skills);
  const maxSkills =
    raw.skillsMax === undefined ? undefined : parseNonNegativeInt(raw.skillsMax, "--skills-max");
  return { mode, maxSkills, warnings };
}

/**
 * Applies skill-related overrides to a base ForgeConfig and returns an updated config.
 *
 * @param base - The original ForgeConfig to update.
 * @param overrides - Parsed skill overrides; may include `mode`, `maxSkills`, and a `warnings` array which will be appended to if an override is ineffective.
 * @returns A ForgeConfig with `skills` merged from `base` and `overrides`.
 */
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
