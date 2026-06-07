import type { ForgeConfig } from "../config.js";
import type { SkillInstallTarget, SkillMode } from "./types.js";

export interface SkillSetupPrompts {
  select<T>(config: {
    message: string;
    choices: Array<{ name: string; value: T; description?: string }>;
    default?: T;
  }): Promise<T>;
  checkbox<T>(config: {
    message: string;
    choices: Array<{ name: string; value: T; checked?: boolean; disabled?: boolean | string }>;
  }): Promise<T[]>;
  input(config: {
    message: string;
    default?: string;
    validate?: (value: string) => boolean | string;
  }): Promise<string>;
}

export interface SkillSetupOptions {
  selectedProfile: string;
  output?: { log(message: string): void };
}

export const SKILL_TRUST_COPY = [
  "Treat skills like code.",
  "Forge audits candidate SKILL.md files and support files before automatic install.",
  "Automatic mode skips skills with warnings or failures.",
  "Approved skills are installed project-locally under dot directories such as .forge/skills and .agents/skills.",
  "Skill text is guidance only; it does not override user instructions, Forge policy, or safety controls.",
].join("\n");

export const SKILL_TELEMETRY_COPY = [
  "Forge does not add new telemetry for skill usage.",
  "Forge automatic skills CLI commands run with DISABLE_TELEMETRY=1.",
  "If you run npx skills manually outside Forge, that command follows the upstream skills CLI telemetry behavior.",
].join("\n");

export const SKILL_SETUP_COPY = [
  "Forge can optionally use skills.sh during builds.",
  "",
  "When enabled, Forge may search skills.sh, audit candidate SKILL.md files and bundled support files,",
  "install approved skills into project dot directories, and provide bounded skill context to agents.",
  "",
  SKILL_TRUST_COPY,
  "",
  SKILL_TELEMETRY_COPY,
].join("\n");

async function askSkillMode(
  prompts: SkillSetupPrompts,
  options: SkillSetupOptions,
): Promise<SkillMode> {
  options.output?.log(SKILL_SETUP_COPY);
  return prompts.select<SkillMode>({
    message: "Use skills.sh during Forge builds?",
    choices: [
      {
        name: "Off - do not search, install, or inject skills",
        value: "off",
        description: "Recommended for alpha unless you want to test the skill pipeline.",
      },
      {
        name: "Auto - search, audit, install, and inject approved skills",
        value: "auto",
        description:
          "Uses project-scoped installs only and applies Forge's audit policy.",
      },
    ],
    default: "off",
  });
}

async function askSkillMax(prompts: SkillSetupPrompts): Promise<number> {
  const value = await prompts.input({
    message: "Maximum skills per build",
    default: "3",
    validate: (raw) => {
      const n = Number(raw);
      return Number.isInteger(n) && n >= 0 ? true : "Enter a non-negative integer.";
    },
  });
  return Number(value);
}

async function askInstallTargets(
  prompts: SkillSetupPrompts,
  selectedProfile: string,
): Promise<SkillInstallTarget[]> {
  const wantsClaude = selectedProfile === "claude-code";
  const targets = await prompts.checkbox<SkillInstallTarget>({
    message: "Where should Forge install approved project skills?",
    choices: [
      {
        name: "Forge native context (.forge/skills)",
        value: "forge",
        checked: true,
        disabled: "required",
      },
      {
        name: "Shared agent path for Codex/OpenCode-compatible agents (.agents/skills)",
        value: "agents",
        checked: true,
      },
      {
        name: "Claude Code project skills (.claude/skills)",
        value: "claude",
        checked: wantsClaude,
      },
    ],
  });

  return Array.from(new Set<SkillInstallTarget>(["forge", ...targets]));
}

export async function configureSkillsForSetup(
  cfg: ForgeConfig,
  prompts: SkillSetupPrompts,
  options: SkillSetupOptions,
): Promise<ForgeConfig> {
  const mode = await askSkillMode(prompts, options);
  if (mode === "off") return cfg.withSkills({ ...cfg.skills, mode: "off" });

  const maxSkills = await askSkillMax(prompts);
  const installTargets = await askInstallTargets(prompts, options.selectedProfile);
  return cfg.withSkills({
    ...cfg.skills,
    mode: "auto",
    maxSkills,
    installTargets,
  });
}
