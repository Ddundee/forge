---
title: Phase 8 - CLI UX Setup User Controls
aliases:
  - Skills.sh Context Phase 8
  - Phase 8 Skill UX
tags:
  - forgecli/skills-sh-context
  - forgecli/planning/phase
  - status/ready
status: ready
phase: 8
research_gate: closed
parent: "[[Skills.sh Context System Master Plan]]"
next_action: "Implement skill CLI flags, setup opt-in, and future skill command surfaces after Phase 1 through Phase 7 land."
created: 2026-06-06
updated: 2026-06-07
---

# Phase 8 - CLI UX Setup User Controls

> [!warning] Planning Boundary
> Phase 8 exposes user controls for an already-designed skill pipeline. It must not redesign discovery, ranking, auditing, installation, prompt injection, or pipeline timing.
> [!abstract] Outcome
> At the end of Phase 8, users can explicitly control whether Forge uses skills during a build, cap the number of skills selected for a build, opt into skills from setup with clear trust and telemetry copy, and understand the planned future `forgecli skills` command group without changing the alpha rollout defaults.
> [!danger] Default Safety
> Skills remain disabled by default in alpha. A user must opt in through setup or pass `--skills auto` for a build. This avoids surprise network calls, project dot-directory writes, and third-party instruction use.

## Research Questions

- What CLI flags does Forge expose today on `build`?
- Where does Forge currently load and save config?
- How can build flags override skill config for one session without mutating `~/.forge/config.toml`?
- How should resume behave when global config changes after a session starts?
- How should setup explain trust, audit, project installation, prompt injection, and telemetry in plain terms?
- Which skill options should be build-time controls and which should remain setup/config controls?
- Should `--skills-max` imply `--skills auto`, or should it only cap an already-enabled mode?
- Should the future dry-run flag be public in alpha?
- What future `forgecli skills` commands are worth reserving and how should their behavior differ from automatic build behavior?
- How can these changes be tested without running the live TUI, real setup prompts, or real skills CLI network calls?

## Researched Facts

### Evidence: Current Branch And Dirty State

Command:

```bash
git status --short --branch
```

Observed:

```text
## feature/skills-sh-context
?? .env
?? docs/plans/2026-06-06-skills-sh-context.md
?? "docs/plans/Skills.sh Context System Phases.base"
?? docs/plans/skills-sh-context-phases/
?? pyproject.toml
?? tests/test_cli.py
```

Plan impact:

- Work is on `feature/skills-sh-context`.
- `.env`, `pyproject.toml`, and `tests/test_cli.py` are unrelated untracked files and must not be touched by Phase 8.
- Phase 8 remains documentation-only until implementation starts.

### Evidence: Master Phase Boundary

Master plan Phase 8 subphases:

- 8.1 Build command flags
  - 8.1.1 `--skills auto|off`
  - 8.1.2 `--skills-max`
  - 8.1.3 Future dry-run flag
- 8.2 Setup wizard
  - 8.2.1 Opt-in setting
  - 8.2.2 Trust-policy explanation
  - 8.2.3 Telemetry explanation
- 8.3 Future skill commands
  - 8.3.1 `forgecli skills search`
  - 8.3.2 `forgecli skills list`
  - 8.3.3 `forgecli skills audit`
  - 8.3.4 `forgecli skills explain`

Plan impact:

- This phase owns user-facing entry points.
- This phase should keep alpha behavior off by default.
- Future commands should be designed here, but not all need to be public in the first alpha implementation.

### Evidence: Current Build Command

Current `src/cli.ts` build command:

```typescript
program
  .command("build <idea>")
  .option("-d, --deploy <target>", "Deploy target: vercel, railway, fly.io")
  .option("--max-cycles <n>", "Max fix iterations", "5")
  .action(async (idea: string, opts: { deploy?: string; maxCycles: string }) => {
    loadKeys();
    const catalog = await getCatalog().catch(() => undefined);
    const session = Session.create(idea, opts.deploy, undefined, process.cwd(), catalog);
    const feed = startLiveFeed(idea);
    // ...
  });
```

Plan impact:

- `build` currently passes only deploy target and catalog into `Session.create()`.
- `--max-cycles` is parsed but not passed into `Session.create()` in the current code path.
- Skill flags need a clean option parser and explicit effective config path.
- This is the right command for per-build skill overrides.

### Evidence: Current Setup Wizard

Current setup is implemented in `src/config.ts` as `runSetupWizard()`.

Current flow:

```text
priority -> provider/local-agent selection -> key prompts or external-agent profile
  -> model config mode -> model selection -> save ~/.forge/config.toml
```

Current imports:

```typescript
const { select, checkbox, password } = await import("@inquirer/prompts");
```

Current config save for a local agent profile:

```typescript
const cfg = new ForgeConfig(profile, {}, 5, priority);
saveConfig(cfg);
```

Plan impact:

- Setup currently has no skills section.
- Skill opt-in should happen before `saveConfig(cfg)`.
- The wizard should add only a few prompts, not a long policy document.
- Skill setup should be testable without running the whole provider/model wizard.

### Evidence: Current Config Shape

Current `ForgeConfig`:

```typescript
export class ForgeConfig {
  constructor(
    public profile = "claude-primary",
    public models: Record<string, string> = {},
    public maxCycles = 5,
    public priority: "quality" | "speed" | "cost" = "quality",
    public autoOverseer = "",
  ) {}
}
```

Phase 1 planned skill config:

```typescript
export type SkillMode = "off" | "auto";

export type SkillInstallTarget = "forge" | "agents" | "claude";

export interface SkillConfig {
  mode: SkillMode;
  maxSkills: number;
  promptCharBudget: number;
  minInstallCount: number;
  trustedSources: string[];
  installTargets: SkillInstallTarget[];
}

export const DEFAULT_SKILL_CONFIG: SkillConfig = {
  mode: "off",
  maxSkills: 3,
  promptCharBudget: 12_000,
  minInstallCount: 100,
  trustedSources: ["vercel-labs", "anthropics", "openai", "microsoft"],
  installTargets: ["forge", "agents"],
};
```

Plan impact:

- Phase 8 should not add a second config type.
- Build flags should override only fields in `SkillConfig`.
- Setup should save the nested `[skills]` TOML table through Phase 1 `saveConfig()`.

### Evidence: Session Config Snapshot

Current DB schema already has:

```sql
config_json TEXT NOT NULL DEFAULT '{}'
```

Phase 1 planned:

```typescript
db.createSession(idea, id, JSON.stringify(cfg.toJson()));
```

Plan impact:

- Build command skill overrides must be included in `sessions.config_json`.
- Resume should use the session snapshot for skill mode and skill caps, not the current global config.
- Model routing can continue to use current config unless a separate phase changes it.

### Evidence: Current CLI Tests

Current `tests/cli.test.ts` checks only top-level help:

```typescript
test("built CLI responds to --help with all commands", () => {
  const output = execFileSync(process.execPath, [...process.execArgv, cliPath, "--help"], { encoding: "utf8" });
  expect(output).toContain("build");
  expect(output).toContain("setup");
  expect(output).toContain("sessions");
  expect(output).toContain("resume");
  expect(output).toContain("logs");
  expect(output).toContain("prompts");
});
```

Plan impact:

- Add CLI help tests for `build --help`.
- Keep parsing logic in pure helpers so tests do not need to start a full build.
- Avoid tests that run the live feed or real setup prompts.

### Evidence: Commander Option Support

Source:

- [Commander.js docs](https://github.com/tj/commander.js)

Researched facts:

- Commander supports `new Option(...).choices([...])` for restricted option values.
- Commander supports argument parsers through `argParser(...)`.
- Current Forge already uses Commander for command registration.

Plan impact:

- Use `Option("--skills <mode>", "...").choices(["auto", "off"])`.
- Use an argument parser for `--skills-max <n>`.
- Do not rely only on runtime checks for `--skills auto|off`; make invalid values fail at CLI parsing.

### Evidence: Inquirer Prompt Support

Source:

- [Inquirer prompts README](https://github.com/SBoudrias/Inquirer.js/blob/main/packages/prompts/README.md)

Researched facts:

- `@inquirer/prompts` exposes `select`, `checkbox`, `confirm`, `input`, and `password`.
- Prompts can be asked conditionally based on previous answers.
- Prompt functions accept runtime context and return cancelable promises.

Plan impact:

- Add only conditional skill prompts when the user opts in.
- Import `confirm` or `input` only when needed.
- Extract skill setup into testable helper functions rather than embedding all logic inside `runSetupWizard()`.

### Evidence: Skills CLI And Trust Copy

Sources:

- [skills.sh docs](https://www.skills.sh/docs)
- [Vercel Agent Skills docs](https://vercel.com/docs/agent-resources/skills)
- [Vercel Knowledge Base: Agent Skills](https://vercel.com/kb/guide/agent-skills-creating-installing-and-sharing-reusable-agent-context)
- [vercel-labs/skills README](https://github.com/vercel-labs/skills/blob/main/README.md)

Researched facts:

- The skills CLI supports `add`, `use`, `list`, `find`, and other commands.
- `npx skills add <owner/repo>` installs skills.
- `--skill` installs a specific skill.
- `--agent` targets specific agents.
- `--copy` copies files instead of symlinking.
- `--yes` skips prompts.
- Project scope is the default for installs; global scope is a separate flag.
- `skills list --json` provides machine-readable installed inventory.
- The Vercel knowledge base says skills use progressive disclosure: metadata first, full `SKILL.md` only when activated, resources only when requested by the skill.
- The Vercel knowledge base says skills should be treated like code and reviewed, especially when scripts exist.
- skills.sh docs state that install telemetry is anonymous and used for ranking, but also state users should review skills and use judgment because quality and security cannot be guaranteed.

Plan impact:

- Setup copy should mention review, project-scope install, prompt injection, and scripts.
- Forge should state that automatic skills CLI calls run with telemetry disabled per Phase 2.
- Forge should not promise skills are safe merely because they are listed or popular.

### Evidence: Prior Phase Privacy Policy

Phase 2 planned:

```typescript
env: {
  ...process.env,
  DISABLE_TELEMETRY: "1",
  NO_COLOR: "1",
}
```

Phase 2 acceptance includes:

```text
Every automatic command sets DISABLE_TELEMETRY=1.
```

Phase 4 notes:

```text
The Phase 2 adapter must continue disabling telemetry for audit fetches.
```

Plan impact:

- Setup telemetry explanation should say Forge disables skills CLI telemetry for automatic commands.
- Future explicit `forgecli skills` commands should also default to telemetry disabled unless a user-facing option deliberately changes that later.
- Do not add Forge telemetry in Phase 8.

## Design Decisions

### Decision 1: Skills Stay Off By Default

Default config remains:

```typescript
skills: {
  mode: "off",
  maxSkills: 3,
  promptCharBudget: 12000,
  minInstallCount: 100,
  trustedSources: ["vercel-labs", "anthropics", "openai", "microsoft"],
  installTargets: ["forge", "agents"],
}
```

Rationale:

- Automatic skills can trigger network calls.
- Automatic skills can install project dot directories.
- Skill text becomes agent guidance.
- Alpha behavior should be explicit.

### Decision 2: Build Flags Override One Session Only

`forgecli build --skills auto` should not mutate `~/.forge/config.toml`.

Flow:

```text
load global config -> apply build overrides -> create session -> persist effective config snapshot
```

Planned API:

```typescript
const baseConfig = loadConfig();
const effectiveConfig = applyBuildSkillOverrides(baseConfig, parseBuildSkillOptions(opts));
const session = Session.create(idea, opts.deploy, undefined, process.cwd(), catalog, effectiveConfig);
```

### Decision 3: Resume Uses Session Skill Snapshot

If a session starts with `--skills off`, later changing global setup to `auto` should not surprise a resumed session.

Policy:

- `Session.create()` writes effective skill config into `config_json`.
- `Session.load()` reads current config for normal model behavior.
- `Session.load()` overlays `skills` from `config_json` onto `session.config`.
- `resume` has no `--skills` override in Phase 8.

### Decision 4: `--skills-max` Does Not Imply Opt-In

Rules:

- `--skills auto` enables the skill pipeline for that build.
- `--skills off` disables the skill pipeline for that build.
- `--skills-max <n>` only changes the cap.
- If the effective mode is `off`, `--skills-max` is accepted but has no effect.
- CLI should emit a short warning when `--skills-max` is passed and effective mode is `off`.

Rationale:

- A cap should not silently enable networked behavior.
- This keeps opt-in explicit.

### Decision 5: Dry Run Is Designed But Not Public In Alpha

`--skills-dry-run` is not exposed in alpha help.

Reason:

- A true dry run requires more than CLI parsing.
- Useful skill planning depends on spec, architecture, tasks, and failures from later phases.
- A dry run that cannot inspect those phases would mislead users.

Future semantics:

```text
forgecli build <idea> --skills auto --skills-dry-run
```

Should eventually mean:

- Run only enough model planning to derive skill queries.
- Run skill discovery, ranking, and audit.
- Do not install skills.
- Do not inject skill context.
- Print a structured plan and exit before coding.

Phase 8 should reserve the design but not ship the flag yet.

### Decision 6: Future `forgecli skills` Commands Are Read-First

Future skill commands should start as inspection commands:

- `search`: find candidate skills without installing.
- `list`: show Forge-installed and agent-installed skills.
- `audit`: inspect one skill and print verdict without installing.
- `explain`: show why a session selected, skipped, installed, or injected skills.

These commands should be explicit user actions, not part of automatic build behavior.

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/skills/cliOptions.ts` | Create | Parse and validate skill-related build options |
| `src/skills/setup.ts` | Create | Setup wizard skill prompts, trust copy, telemetry copy, and config mutation helpers |
| `src/config.ts` | Modify | Use Phase 1 skill config and delegate setup skill prompts |
| `src/session.ts` | Modify | Accept effective config at create time and overlay session skill snapshot on load |
| `src/cli.ts` | Modify | Add `--skills` and `--skills-max`, apply one-session overrides |
| `src/commands/skills.ts` | Create later | Future `forgecli skills` command group |
| `tests/skillsCliOptions.test.ts` | Create | Pure option parsing and override tests |
| `tests/setupSkills.test.ts` | Create | Prompt decision and copy tests with fake prompt functions |
| `tests/sessionSkillsConfig.test.ts` | Create | Session snapshot and resume behavior tests |
| `tests/cli.test.ts` | Modify | Build help and invalid option tests |
| `tests/skillsCommands.test.ts` | Create later | Future command group tests |
| `docs/plans/skills-sh-context-phases/Phase 8 - CLI UX Setup User Controls.md` | Maintain | This implementation-ready plan |

## Public Interfaces

### Build Skill CLI Options

Create `src/skills/cliOptions.ts`.

```typescript
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

export function parseBuildSkillOptions(raw: RawBuildSkillOptions): BuildSkillOverrides {
  const warnings: string[] = [];
  const mode = raw.skills === undefined ? undefined : parseSkillMode(raw.skills);
  const maxSkills = raw.skillsMax === undefined ? undefined : parseNonNegativeInt(raw.skillsMax, "--skills-max");
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
    overrides.warnings.push("--skills-max was provided but skills mode is off; the cap will have no effect.");
  }

  return base.withSkills(skills);
}
```

Supporting helpers:

```typescript
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
```

Config helper:

```typescript
export class ForgeConfig {
  // existing constructor with skills added in Phase 1

  withSkills(skills: SkillConfig): ForgeConfig {
    return new ForgeConfig(
      this.profile,
      { ...this.models },
      this.maxCycles,
      this.priority,
      this.autoOverseer,
      skills,
    );
  }
}
```

### Commander Registration

Modify `src/cli.ts`.

```typescript
import { Command, Option } from "commander";
import { loadConfig, loadKeys } from "./config.js";
import { applyBuildSkillOverrides, parseBuildSkillOptions, parseNonNegativeInt } from "./skills/cliOptions.js";

program
  .command("build <idea>")
  .option("-d, --deploy <target>", "Deploy target: vercel, railway, fly.io")
  .option("--max-cycles <n>", "Max fix iterations", "5")
  .addOption(new Option("--skills <mode>", "Skill usage for this build").choices(["auto", "off"]))
  .addOption(
    new Option("--skills-max <n>", "Maximum skills Forge may select for this build")
      .argParser((value) => parseNonNegativeInt(value, "--skills-max")),
  )
  .action(async (idea: string, opts: BuildCommandOptions) => {
    loadKeys();
    const catalog = await getCatalog().catch(() => undefined);
    const baseConfig = loadConfig();
    const skillOverrides = parseBuildSkillOptions(opts);
    const effectiveConfig = applyBuildSkillOverrides(baseConfig, skillOverrides);
    for (const warning of skillOverrides.warnings) console.warn(`Warning: ${warning}`);

    const session = Session.create(
      idea,
      opts.deploy,
      undefined,
      process.cwd(),
      catalog,
      effectiveConfig,
    );
    // existing live feed and overseer flow
  });
```

Type:

```typescript
interface BuildCommandOptions {
  deploy?: string;
  maxCycles: string;
  skills?: "auto" | "off";
  skillsMax?: number;
}
```

Notes:

- Do not set a Commander default for `--skills`; config default should decide.
- Do not set a Commander default for `--skills-max`; config default should decide.
- Avoid adding `--skills-dry-run` until it is implemented.

### Session Create Signature

Modify `src/session.ts` after Phase 1 lands.

Current:

```typescript
static create(
  idea: string,
  deployTarget?: string,
  sessionsDir = SESSIONS_DIR,
  workspace?: string,
  catalog?: MdCatalog,
): Session
```

Planned:

```typescript
static create(
  idea: string,
  deployTarget?: string,
  sessionsDir = SESSIONS_DIR,
  workspace?: string,
  catalog?: MdCatalog,
  configOverride?: ForgeConfig,
): Session {
  const cfg = configOverride ?? loadConfig();
  // ...
  db.createSession(idea, id, JSON.stringify(cfg.toJson()));
  // ...
}
```

Rationale:

- Adding the final optional parameter preserves old call sites.
- Build command can pass an effective config without writing global config.
- Tests can create sessions with skill config directly.

### Session Load Skill Snapshot

Add helper:

```typescript
function applySessionSkillSnapshot(current: ForgeConfig, row: Record<string, unknown>): ForgeConfig {
  const raw = typeof row["config_json"] === "string" ? row["config_json"] : "{}";
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const skills = normalizeSkillConfig(parsed["skills"]);
    return current.withSkills(skills);
  } catch {
    return current;
  }
}
```

Use in `Session.load()`:

```typescript
const loadedConfig = loadConfig();
const cfg = applySessionSkillSnapshot(loadedConfig, row);
```

Policy:

- Skill resume behavior uses session snapshot.
- Provider/model config can continue to use current config.
- If `config_json` is malformed, fall back to current config and log no error.

## Setup Wizard Design

### Skill Setup Helper

Create `src/skills/setup.ts`.

```typescript
import type { ForgeConfig } from "../config.js";
import type { SkillConfig, SkillInstallTarget, SkillMode } from "./types.js";

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
  input(config: { message: string; default?: string; validate?: (value: string) => boolean | string }): Promise<string>;
}

export interface SkillSetupOptions {
  selectedProfile: string;
  output?: { log(message: string): void };
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
```

### Setup Copy

Print before the skill mode prompt:

```text
Forge can optionally use skills.sh during builds.

When enabled, Forge may search skills.sh, audit candidate SKILL.md files and bundled support files, install approved skills into project dot directories, and provide bounded skill context to agents.

Automatic Forge skill commands run with skills CLI telemetry disabled. Forge does not add new telemetry for this feature.

Treat skills like code: review their source, especially bundled scripts. Forge's audit skips risky skills in automatic mode, but no marketplace listing can guarantee a skill is safe or useful.
```

Keep this as output text, not as a prompt choice description, because users need to see it before choosing.

### Setup Prompt - Opt-In Setting

Prompt:

```typescript
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
        description: "Uses project-scoped installs only and applies Forge's audit policy.",
      },
    ],
    default: "off",
  });
}
```

Prompt for max skills only if auto:

```typescript
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
```

### Setup Prompt - Trust-Policy Explanation

Trust copy requirements:

- Explain that skills are third-party instructions and files.
- Explain that Forge audits before auto install.
- Explain that auto mode skips warn/fail audit results.
- Explain that project installs use dot directories in the workspace.
- Explain that skills may reference scripts/resources.
- Explain that skill context has lower authority than user/Forge/system instructions.
- Do not imply official marketplace approval is a security guarantee.

Implementation constant:

```typescript
export const SKILL_TRUST_COPY = [
  "Treat skills like code.",
  "Forge audits candidate SKILL.md files and support files before automatic install.",
  "Automatic mode skips skills with warnings or failures.",
  "Approved skills are installed project-locally under dot directories such as .forge/skills and .agents/skills.",
  "Skill text is guidance only; it does not override user instructions, Forge policy, or safety controls.",
].join("\n");
```

### Setup Prompt - Telemetry Explanation

Telemetry copy requirements:

- Forge does not add new telemetry for this feature.
- Forge automatic commands set `DISABLE_TELEMETRY=1` through Phase 2 adapter.
- skills.sh docs say install telemetry can be used for leaderboard/ranking when the skills CLI is run normally.
- Users running `npx skills` manually outside Forge are responsible for that command's telemetry settings.

Implementation constant:

```typescript
export const SKILL_TELEMETRY_COPY = [
  "Forge does not add new telemetry for skill usage.",
  "Forge automatic skills CLI commands run with DISABLE_TELEMETRY=1.",
  "If you run npx skills manually outside Forge, that command follows the upstream skills CLI telemetry behavior.",
].join("\n");
```

### Install Target Prompt

This is not a build flag in v1, but it is useful setup config.

```typescript
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
```

Policy:

- `forge` is always included.
- `agents` remains default because Phase 5 defaults to `["forge", "agents"]`.
- `claude` is suggested when the selected profile is `claude-code`.

### Setup Wizard Integration

In `runSetupWizard()`:

```typescript
const { select, checkbox, password, input } = await import("@inquirer/prompts");
const prompts = { select, checkbox, input };

// existing provider/model flow creates cfg
let cfg = new ForgeConfig(profile, chosenModels, 5, priority, autoOverseer);
cfg = await configureSkillsForSetup(cfg, prompts, {
  selectedProfile: cfg.profile,
  output: console,
});
saveConfig(cfg);
```

For external-agent early returns:

```typescript
let cfg = new ForgeConfig(profile, {}, 5, priority);
cfg = await configureSkillsForSetup(cfg, prompts, {
  selectedProfile: cfg.profile,
  output: console,
});
saveConfig(cfg);
```

Acceptance:

- Every setup save path runs through skill setup.
- Default answer keeps skills off.
- Choosing auto persists `[skills] mode = "auto"`.
- Existing provider/model setup remains unchanged aside from the new skill section.

## Build Command Flag Plan

## 8.1 Build Command Flags

### 8.1.1 `--skills auto|off`

Goal:

- Let a user override skill mode for one build.

User examples:

```bash
forgecli build "make a portfolio site" --skills auto
forgecli build "make a portfolio site" --skills off
```

Behavior:

| Global config | Build flag | Effective session mode |
|---|---|---|
| `off` | absent | `off` |
| `off` | `--skills auto` | `auto` |
| `auto` | absent | `auto` |
| `auto` | `--skills off` | `off` |

Implementation tasks:

- Add Commander choice option.
- Parse into `BuildSkillOverrides.mode`.
- Apply before `Session.create()`.
- Store effective config in `sessions.config_json`.
- Emit no warning for explicit `--skills off`.

Acceptance:

- `forgecli build --help` shows `--skills <mode>`.
- Invalid modes fail before session creation.
- Global config is not modified.
- Session config snapshot records the effective mode.

### 8.1.2 `--skills-max`

Goal:

- Let a user cap automatic skill selection for one build.

User examples:

```bash
forgecli build "make a dashboard" --skills auto --skills-max 1
forgecli build "make a dashboard" --skills-max 5
```

Behavior:

- Accept only non-negative integers.
- Override `config.skills.maxSkills` for this session only.
- Do not imply `--skills auto`.
- If effective mode is off, warn that the cap has no effect.

Implementation tasks:

- Add Commander option with `argParser`.
- Add pure `parseNonNegativeInt`.
- Add warnings array to override result.
- Add unit tests for `0`, positive values, negative values, floats, and text.

Acceptance:

- `--skills-max 2` persists `max_skills = 2` in the session snapshot.
- `--skills-max -1` fails before session creation.
- `--skills-max abc` fails before session creation.
- `--skills-max 2 --skills off` does not enable skills.

### 8.1.3 Future Dry-Run Flag

Goal:

- Define the future preview behavior without exposing a misleading flag in alpha.

Do not implement public flag in Phase 8 alpha:

```bash
# Not in alpha help yet
forgecli build "make a dashboard" --skills auto --skills-dry-run
```

Future interface:

```typescript
export interface SkillDryRunReport {
  idea: string;
  plannedQueries: Array<{ phase: string; query: string; reason: string }>;
  selected: Array<{ packageRef: string; skillName: string; rationale: string }>;
  audited: Array<{ packageRef: string; skillName: string; verdict: "pass" | "warn" | "fail"; reasons: string[] }>;
  wouldInstall: Array<{ packageRef: string; skillName: string; targets: string[] }>;
  wouldInject: Array<{ agentName: string; sourceKeys: string[] }>;
}
```

Future behavior:

- Run planning and skill lifecycle preview.
- Do not install skills.
- Do not inject prompts.
- Print text by default and JSON with `--json`.
- Exit before coding.

Phase 8 tasks:

- Document the semantics.
- Do not register the flag publicly.
- Add no tests expecting this flag in help.

## 8.2 Setup Wizard

### 8.2.1 Opt-In Setting

Implementation tasks:

- Add `configureSkillsForSetup()`.
- Add skill mode prompt with default `off`.
- Prompt for max skills only if auto.
- Prompt for install targets only if auto.
- Save nested skills config.

Acceptance:

- Setup default leaves skills off.
- Setup auto saves mode auto.
- Setup max skill prompt validates integer input.
- Setup includes `forge` install target even if a fake prompt omits it.

### 8.2.2 Trust-Policy Explanation

Implementation tasks:

- Add trust copy constant.
- Print before opt-in prompt.
- Keep copy concise.
- Mention project dot directories and audit skip behavior.

Acceptance:

- Test can assert copy includes "Treat skills like code".
- Test can assert copy includes "project-locally".
- Test can assert copy does not claim guaranteed safety.

### 8.2.3 Telemetry Explanation

Implementation tasks:

- Add telemetry copy constant.
- Print with trust copy.
- Mention `DISABLE_TELEMETRY=1`.
- Mention manual `npx skills` is separate.

Acceptance:

- Test can assert copy includes `DISABLE_TELEMETRY=1`.
- Test can assert Forge adds no new telemetry.
- Phase 2 automatic command env remains authoritative.

## 8.3 Future Skill Commands

### Command Group Registration

Future `src/commands/skills.ts`:

```typescript
import { Command, Option } from "commander";

export function registerSkillsCommands(program: Command): void {
  const skills = program
    .command("skills")
    .description("Inspect and manage Forge skill discovery, audit, install, and session usage.");

  skills
    .command("search [query]")
    .description("Search skills.sh candidates without installing them.")
    .option("--json", "Print machine-readable JSON")
    .option("--limit <n>", "Maximum results to display", "10")
    .action(searchSkillsCommand);

  skills
    .command("list")
    .description("List Forge-installed project skills for the current workspace.")
    .option("--json", "Print machine-readable JSON")
    .action(listSkillsCommand);

  skills
    .command("audit <source>")
    .description("Audit one skill source without installing it.")
    .option("--skill <name>", "Skill name inside a multi-skill source")
    .option("--json", "Print machine-readable JSON")
    .action(auditSkillCommand);

  skills
    .command("explain [sessionId]")
    .description("Explain skill queries, selections, audits, installs, and injections for a session.")
    .option("--json", "Print machine-readable JSON")
    .action(explainSkillsCommand);
}
```

Phase 8 alpha policy:

- The command group can remain unregistered until implementation is ready.
- If registered in alpha, commands must be read-only except future explicit install/remove commands.
- Do not add `forgecli skills install` in Phase 8.

### 8.3.1 `forgecli skills search`

Goal:

- Let users inspect candidate skills manually before enabling auto mode.

Command:

```bash
forgecli skills search "react frontend"
forgecli skills search "vercel deploy" --json
```

Planned behavior:

- Calls Phase 2 `SkillsCli.find()`.
- Uses telemetry-disabled env from Phase 2 adapter.
- Parses and ranks with Phase 3 scoring if config is available.
- Does not audit.
- Does not install.
- Does not mutate session DB unless `--session` is added in a future phase.

Table output:

```text
Skill                         Source                    Installs  Score
web-design-guidelines         vercel-labs/agent-skills  120000    0.91
deploy-to-vercel              vercel-labs/agent-skills  66000     0.87
```

JSON output:

```json
{
  "query": "react frontend",
  "candidates": [
    {
      "packageRef": "vercel-labs/agent-skills",
      "skillName": "web-design-guidelines",
      "installCount": 120000,
      "score": 0.91
    }
  ]
}
```

### 8.3.2 `forgecli skills list`

Goal:

- Show skills installed in the current project workspace.

Command:

```bash
forgecli skills list
forgecli skills list --json
```

Planned behavior:

- Reads Phase 5 `listForgeInstalledSkills(process.cwd())`.
- Optionally compares with `SkillsCli.listInstalled(workspace, agent)`.
- Does not search.
- Does not mutate.

Table output:

```text
Name                   Package                   Forge path                         Agents path
web-design-guidelines  vercel-labs/agent-skills  .forge/skills/...                  .agents/skills/web-design-guidelines
```

JSON output:

```json
[
  {
    "packageRef": "vercel-labs/agent-skills",
    "skillName": "web-design-guidelines",
    "forgePath": ".forge/skills/vercel-labs__agent-skills__web-design-guidelines",
    "agentsPath": ".agents/skills/web-design-guidelines"
  }
]
```

### 8.3.3 `forgecli skills audit`

Goal:

- Let users inspect whether Forge would trust one skill before auto mode uses it.

Command:

```bash
forgecli skills audit vercel-labs/agent-skills --skill web-design-guidelines
forgecli skills audit vercel-labs/agent-skills@web-design-guidelines --json
```

Planned behavior:

- Calls Phase 2 `SkillsCli.use()` into a temporary workspace.
- Runs Phase 4 audit rules.
- Prints pass/warn/fail and reasons.
- Does not install.
- Does not write session lifecycle rows by default.

Result output:

```text
Audit: pass
Skill: vercel-labs/agent-skills@web-design-guidelines
Reasons:
- Trusted source
- No blocked instruction patterns found
- Support files within audit size limits
```

JSON output:

```json
{
  "source": "vercel-labs/agent-skills",
  "skillName": "web-design-guidelines",
  "verdict": "pass",
  "reasons": ["Trusted source", "No blocked instruction patterns found"]
}
```

### 8.3.4 `forgecli skills explain`

Goal:

- Explain skill lifecycle decisions for a session.

Command:

```bash
forgecli skills explain
forgecli skills explain abc12345
forgecli skills explain abc12345 --json
```

Planned behavior:

- Loads last session if no ID is provided.
- Reads Phase 1 skill lifecycle tables:
  - `skill_queries`
  - `skill_candidates`
  - `skill_audits`
  - `skill_selections`
  - `skill_installations`
  - `skill_injections`
- Groups by phase and task.
- Shows selected, skipped, installed, and injected decisions.
- Does not call skills.sh.

Output:

```text
Session abc12345

ARCHITECTURE
  Query: frontend design
  Selected: web-design-guidelines (score 0.91)
  Audit: pass
  Injected: ArchitectureAgent compact 1280 chars

CODING
  Query: vitest testing
  Skipped: unknown/repo@testing (below install threshold)
  Installed: vitest-testing -> .forge/skills/...
```

## Implementation Sequence

### Step 1: Pure CLI Option Helpers

- Add `src/skills/cliOptions.ts`.
- Add `parseSkillMode()`.
- Add `parseNonNegativeInt()`.
- Add `parseBuildSkillOptions()`.
- Add `applyBuildSkillOverrides()`.
- Add tests before touching `src/cli.ts`.

### Step 2: Config And Session Overrides

- Add `ForgeConfig.withSkills()`.
- Add optional `configOverride` to `Session.create()`.
- Add skill snapshot overlay for `Session.load()`.
- Add session tests.

### Step 3: Build Command Flags

- Add Commander `Option` import.
- Add `--skills <mode>` with choices.
- Add `--skills-max <n>` parser.
- Apply overrides before session creation.
- Print warnings before live feed starts.
- Add build help tests.

### Step 4: Setup Skill Helper

- Create `src/skills/setup.ts`.
- Add copy constants.
- Add prompt helper functions.
- Add fake prompt tests.
- Integrate helper into every setup save path.

### Step 5: Future Commands Design Hooks

- Create `src/commands/skills.ts` only if command registration is ready.
- Otherwise keep command designs in docs and Phase 9 rollout.
- Do not expose incomplete commands.

## Test Plan

### `tests/skillsCliOptions.test.ts`

```typescript
test("parseSkillMode accepts auto and off", () => {
  expect(parseSkillMode("auto")).toBe("auto");
  expect(parseSkillMode("off")).toBe("off");
});

test("parseSkillMode rejects unknown values", () => {
  expect(() => parseSkillMode("manual")).toThrow("Expected auto or off");
});

test("parseNonNegativeInt accepts zero and positive integers", () => {
  expect(parseNonNegativeInt("0", "--skills-max")).toBe(0);
  expect(parseNonNegativeInt("3", "--skills-max")).toBe(3);
});

test("parseNonNegativeInt rejects invalid values", () => {
  expect(() => parseNonNegativeInt("-1", "--skills-max")).toThrow();
  expect(() => parseNonNegativeInt("1.5", "--skills-max")).toThrow();
  expect(() => parseNonNegativeInt("abc", "--skills-max")).toThrow();
});

test("applyBuildSkillOverrides does not mutate base config", () => {
  const base = new ForgeConfig("claude-primary", {}, 5, "quality", "", {
    ...DEFAULT_SKILL_CONFIG,
    mode: "off",
    maxSkills: 3,
  });

  const overrides = parseBuildSkillOptions({ skills: "auto", skillsMax: "1" });
  const effective = applyBuildSkillOverrides(base, overrides);

  expect(base.skills.mode).toBe("off");
  expect(base.skills.maxSkills).toBe(3);
  expect(effective.skills.mode).toBe("auto");
  expect(effective.skills.maxSkills).toBe(1);
});

test("skills max alone warns when effective mode is off", () => {
  const base = new ForgeConfig();
  const overrides = parseBuildSkillOptions({ skillsMax: "2" });
  const effective = applyBuildSkillOverrides(base, overrides);

  expect(effective.skills.mode).toBe("off");
  expect(overrides.warnings[0]).toContain("no effect");
});
```

### `tests/sessionSkillsConfig.test.ts`

```typescript
test("Session.create persists effective skill config snapshot", () => {
  const cfg = new ForgeConfig("claude-primary", {}, 5, "quality", "", {
    ...DEFAULT_SKILL_CONFIG,
    mode: "auto",
    maxSkills: 1,
  });

  const session = Session.create("build app", undefined, tmpDir, undefined, undefined, cfg);
  const row = session.db.getSession(session.id);
  const snapshot = JSON.parse(String(row?.["config_json"]));

  expect(snapshot.skills.mode).toBe("auto");
  expect(snapshot.skills.max_skills).toBe(1);
});

test("Session.load overlays skill config from session snapshot", () => {
  const cfg = new ForgeConfig("claude-primary", {}, 5, "quality", "", {
    ...DEFAULT_SKILL_CONFIG,
    mode: "auto",
    maxSkills: 2,
  });
  const created = Session.create("build app", undefined, tmpDir, undefined, undefined, cfg);
  created.db.close();

  const loaded = Session.load(created.id, tmpDir);
  expect(loaded.config.skills.mode).toBe("auto");
  expect(loaded.config.skills.maxSkills).toBe(2);
});
```

### `tests/setupSkills.test.ts`

```typescript
test("configureSkillsForSetup defaults to off", async () => {
  const prompts = fakeSkillPrompts({
    selectAnswers: ["off"],
  });

  const cfg = await configureSkillsForSetup(new ForgeConfig(), prompts, {
    selectedProfile: "claude-primary",
    output: fakeOutput(),
  });

  expect(cfg.skills.mode).toBe("off");
});

test("configureSkillsForSetup saves auto max and targets", async () => {
  const prompts = fakeSkillPrompts({
    selectAnswers: ["auto"],
    inputAnswers: ["2"],
    checkboxAnswers: [["agents", "claude"]],
  });

  const cfg = await configureSkillsForSetup(new ForgeConfig("claude-code"), prompts, {
    selectedProfile: "claude-code",
    output: fakeOutput(),
  });

  expect(cfg.skills.mode).toBe("auto");
  expect(cfg.skills.maxSkills).toBe(2);
  expect(cfg.skills.installTargets).toEqual(["forge", "agents", "claude"]);
});

test("setup copy includes trust and telemetry text", async () => {
  const output = fakeOutput();
  const prompts = fakeSkillPrompts({ selectAnswers: ["off"] });

  await configureSkillsForSetup(new ForgeConfig(), prompts, {
    selectedProfile: "claude-primary",
    output,
  });

  expect(output.lines.join("\n")).toContain("Treat skills like code");
  expect(output.lines.join("\n")).toContain("DISABLE_TELEMETRY=1");
});
```

### `tests/cli.test.ts`

```typescript
test("build help includes skill flags", () => {
  const output = execFileSync(
    process.execPath,
    [...process.execArgv, cliPath, "build", "--help"],
    { encoding: "utf8" },
  );

  expect(output).toContain("--skills <mode>");
  expect(output).toContain("--skills-max <n>");
});

test("build rejects invalid skills mode", () => {
  expect(() => execFileSync(
    process.execPath,
    [...process.execArgv, cliPath, "build", "idea", "--skills", "manual"],
    { encoding: "utf8", stdio: "pipe" },
  )).toThrow();
});
```

### Future `tests/skillsCommands.test.ts`

```typescript
test("top-level help includes skills command when command group is registered", () => {
  const output = runCli(["--help"]);
  expect(output).toContain("skills");
});

test("skills search calls search client without install", async () => {
  const clients = fakeSkillsCommandClients();
  await searchSkillsCommand("react frontend", { json: true }, clients);
  expect(clients.searchClient.find).toHaveBeenCalled();
  expect(clients.installClient.install).not.toHaveBeenCalled();
});

test("skills explain does not call skills.sh", async () => {
  const clients = fakeSkillsCommandClients();
  await explainSkillsCommand("abc12345", {}, clients);
  expect(clients.searchClient.find).not.toHaveBeenCalled();
  expect(clients.useClient.use).not.toHaveBeenCalled();
});
```

## Acceptance Criteria

- [ ] Skills remain off by default.
- [ ] Setup default leaves skills off.
- [ ] Setup can opt into skills auto.
- [ ] Setup copy explains trust, project installs, lower prompt authority, and telemetry.
- [ ] Setup auto can configure max skills.
- [ ] Setup auto can configure install targets.
- [ ] `forgecli build --skills auto` enables skills for that session only.
- [ ] `forgecli build --skills off` disables skills for that session only.
- [ ] `forgecli build --skills-max <n>` overrides `maxSkills` for that session only.
- [ ] `--skills-max` does not imply `--skills auto`.
- [ ] Invalid `--skills` values fail before session creation.
- [ ] Invalid `--skills-max` values fail before session creation.
- [ ] Build overrides are persisted into `sessions.config_json`.
- [ ] Global `~/.forge/config.toml` is not mutated by build flags.
- [ ] Resume uses the session skill snapshot.
- [ ] No public `--skills-dry-run` flag is exposed in alpha.
- [ ] Future skill command semantics are documented.
- [ ] Existing CLI commands still appear in top-level help.

## Non-Goals

- No new discovery logic.
- No new audit rules.
- No install layout changes.
- No prompt rendering changes.
- No pipeline timing changes.
- No global skills installation.
- No `forgecli skills install` command.
- No manual audit override.
- No public dry-run implementation in alpha.
- No change to model-routing config semantics except skill snapshot overlay for resume.

## Rollback Plan

Rollback options:

- Remove or hide `--skills` and `--skills-max` from `build`.
- Keep `skills.mode = "off"` in config.
- Skip `configureSkillsForSetup()` in setup.
- Leave future `src/commands/skills.ts` unregistered.

Expected rollback behavior:

- Existing build behavior is unchanged.
- Existing sessions still load because `config_json` already tolerated missing or extra fields.
- Skill pipeline remains disabled through Phase 7 no-op behavior.

## Research Gate Closure

- [x] Captured current `build` command flags and setup wizard flow.
- [x] Captured current config and session creation behavior.
- [x] Reviewed Phase 1 skill config and session snapshot plan.
- [x] Reviewed Phase 2 telemetry-disabled skills CLI adapter plan.
- [x] Reviewed Phase 5 install targets and defaults.
- [x] Reviewed Phase 7 pipeline ownership and no-new-flags boundary.
- [x] Checked Commander option choice and argument parser support.
- [x] Checked Inquirer conditional prompt and prompt API support.
- [x] Checked skills.sh and Vercel trust, install, and telemetry documentation.
- [x] Decided alpha defaults, setup copy direction, and dry-run deferral.
