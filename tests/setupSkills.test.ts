import { ForgeConfig } from "../src/config.js";
import {
  configureSkillsForSetup,
  SKILL_TRUST_COPY,
  SKILL_TELEMETRY_COPY,
  SKILL_SETUP_COPY,
  type SkillSetupPrompts,
} from "../src/skills/setup.js";

interface FakePromptsOptions {
  selectAnswers?: unknown[];
  inputAnswers?: string[];
  checkboxAnswers?: unknown[][];
}

function fakeSkillPrompts(options: FakePromptsOptions = {}): SkillSetupPrompts {
  let selectIdx = 0;
  let inputIdx = 0;
  let checkboxIdx = 0;
  return {
    select: jest.fn().mockImplementation(async () => {
      const answers = options.selectAnswers ?? [];
      return answers[selectIdx++] ?? "off";
    }),
    input: jest.fn().mockImplementation(async () => {
      const answers = options.inputAnswers ?? [];
      return answers[inputIdx++] ?? "3";
    }),
    checkbox: jest.fn().mockImplementation(async () => {
      const answers = options.checkboxAnswers ?? [];
      return answers[checkboxIdx++] ?? [];
    }),
  };
}

function fakeOutput() {
  const lines: string[] = [];
  return { log: (msg: string) => lines.push(msg), lines };
}

// --- copy constants ---

test("SKILL_TRUST_COPY includes treat skills like code", () => {
  expect(SKILL_TRUST_COPY).toContain("Treat skills like code");
});

test("SKILL_TRUST_COPY mentions project-locally", () => {
  expect(SKILL_TRUST_COPY).toContain("project-locally");
});

test("SKILL_TRUST_COPY does not claim guaranteed safety", () => {
  expect(SKILL_TRUST_COPY).not.toContain("guaranteed safe");
});

test("SKILL_TELEMETRY_COPY mentions DISABLE_TELEMETRY=1", () => {
  expect(SKILL_TELEMETRY_COPY).toContain("DISABLE_TELEMETRY=1");
});

test("SKILL_TELEMETRY_COPY mentions Forge adds no new telemetry", () => {
  expect(SKILL_TELEMETRY_COPY).toContain("does not add new telemetry");
});

test("SKILL_SETUP_COPY includes both trust and telemetry content", () => {
  expect(SKILL_SETUP_COPY).toContain("Treat skills like code");
  expect(SKILL_SETUP_COPY).toContain("DISABLE_TELEMETRY=1");
});

// --- configureSkillsForSetup off ---

test("configureSkillsForSetup defaults to off when user selects off", async () => {
  const prompts = fakeSkillPrompts({ selectAnswers: ["off"] });
  const cfg = await configureSkillsForSetup(new ForgeConfig(), prompts, {
    selectedProfile: "claude-primary",
    output: fakeOutput(),
  });
  expect(cfg.skills.mode).toBe("off");
});

test("configureSkillsForSetup with off does not prompt for max or targets", async () => {
  const prompts = fakeSkillPrompts({ selectAnswers: ["off"] });
  await configureSkillsForSetup(new ForgeConfig(), prompts, {
    selectedProfile: "claude-primary",
    output: fakeOutput(),
  });
  expect((prompts.input as jest.Mock).mock.calls.length).toBe(0);
  expect((prompts.checkbox as jest.Mock).mock.calls.length).toBe(0);
});

// --- configureSkillsForSetup auto ---

test("configureSkillsForSetup saves auto mode", async () => {
  const prompts = fakeSkillPrompts({
    selectAnswers: ["auto"],
    inputAnswers: ["3"],
    checkboxAnswers: [["agents"]],
  });
  const cfg = await configureSkillsForSetup(new ForgeConfig(), prompts, {
    selectedProfile: "claude-primary",
    output: fakeOutput(),
  });
  expect(cfg.skills.mode).toBe("auto");
});

test("configureSkillsForSetup saves max and targets when auto", async () => {
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
  expect(cfg.skills.installTargets).toContain("agents");
  expect(cfg.skills.installTargets).toContain("claude");
});

test("configureSkillsForSetup always includes forge in install targets", async () => {
  const prompts = fakeSkillPrompts({
    selectAnswers: ["auto"],
    inputAnswers: ["1"],
    checkboxAnswers: [[]], // user selects nothing (forge is disabled/required)
  });
  const cfg = await configureSkillsForSetup(new ForgeConfig(), prompts, {
    selectedProfile: "claude-primary",
    output: fakeOutput(),
  });
  expect(cfg.skills.installTargets).toContain("forge");
});

test("configureSkillsForSetup max skill prompt validates integer", async () => {
  const promptsFake = fakeSkillPrompts({
    selectAnswers: ["auto"],
    inputAnswers: ["5"],
    checkboxAnswers: [[]],
  });

  const validateFn = jest.fn().mockImplementation((raw: string) => {
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 ? true : "Enter a non-negative integer.";
  });
  (promptsFake.input as jest.Mock).mockImplementationOnce(async ({ validate }: { validate?: (v: string) => boolean | string }) => {
    expect(validate?.("0")).toBe(true);
    expect(validate?.("3")).toBe(true);
    expect(validate?.("-1")).toContain("non-negative");
    expect(validate?.("1.5")).toContain("non-negative");
    return "5";
  });

  const cfg = await configureSkillsForSetup(new ForgeConfig(), promptsFake, {
    selectedProfile: "claude-primary",
    output: fakeOutput(),
  });
  expect(cfg.skills.maxSkills).toBe(5);
});

// --- output / copy display ---

test("setup copy includes trust and telemetry text in output", async () => {
  const output = fakeOutput();
  const prompts = fakeSkillPrompts({ selectAnswers: ["off"] });

  await configureSkillsForSetup(new ForgeConfig(), prompts, {
    selectedProfile: "claude-primary",
    output,
  });

  const combined = output.lines.join("\n");
  expect(combined).toContain("Treat skills like code");
  expect(combined).toContain("DISABLE_TELEMETRY=1");
});
