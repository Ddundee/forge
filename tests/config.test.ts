import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ForgeConfig, loadConfig, saveConfig, loadKeys, PROVIDER_PROFILES, DEFAULT_SKILL_CONFIG } from "../src/config.js";
import { ModelTier } from "../src/router.js";
import type { SkillConfig } from "../src/skills/types.js";

let tmpDir: string;

beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-test-")); });
afterEach(() => { fs.rmSync(tmpDir, { recursive: true }); });

test("ForgeConfig defaults", () => {
  const cfg = new ForgeConfig();
  expect(cfg.profile).toBe("claude-primary");
  expect(cfg.maxCycles).toBe(5);
});

test("tierModels returns correct profile models", () => {
  const cfg = new ForgeConfig("openai-primary");
  const models = cfg.tierModels();
  expect(models[ModelTier.OVERSEER]).toBe("gpt-4o");
});

test("tierModels applies model overrides on top of profile", () => {
  const cfg = new ForgeConfig("claude-primary", { overseer: "gpt-4o" });
  expect(cfg.tierModels()[ModelTier.OVERSEER]).toBe("gpt-4o");
  expect(cfg.tierModels()[ModelTier.STANDARD]).toContain("haiku");
});

test("saveConfig and loadConfig round-trip", () => {
  const configFile = path.join(tmpDir, "config.toml");
  saveConfig(new ForgeConfig("openai-primary", {}, 3), configFile);
  const loaded = loadConfig(configFile);
  expect(loaded.profile).toBe("openai-primary");
  expect(loaded.maxCycles).toBe(3);
});

test("loadConfig returns default when file missing", () => {
  const cfg = loadConfig(path.join(tmpDir, "nonexistent.toml"));
  expect(cfg.profile).toBe("claude-primary");
});

test("loadKeys sets env vars from file", () => {
  const keysFile = path.join(tmpDir, "keys.env");
  fs.writeFileSync(keysFile, "TEST_API_KEY_XYZ=secret123\n");
  delete process.env["TEST_API_KEY_XYZ"];
  loadKeys(keysFile);
  expect(process.env["TEST_API_KEY_XYZ"]).toBe("secret123");
  delete process.env["TEST_API_KEY_XYZ"];
});

test("ForgeConfig defaults priority to quality and autoOverseer to empty string", () => {
  const cfg = new ForgeConfig();
  expect(cfg.priority).toBe("quality");
  expect(cfg.autoOverseer).toBe("");
});

test("ForgeConfig constructor accepts priority and autoOverseer", () => {
  const cfg = new ForgeConfig("auto", {}, 5, "speed", "claude-opus-4-8");
  expect(cfg.priority).toBe("speed");
  expect(cfg.autoOverseer).toBe("claude-opus-4-8");
});

test("saveConfig and loadConfig round-trips priority and autoOverseer", () => {
  const configFile = path.join(tmpDir, "config.toml");
  saveConfig(new ForgeConfig("auto", {}, 5, "speed", "claude-opus-4-8"), configFile);
  const loaded = loadConfig(configFile);
  expect(loaded.profile).toBe("auto");
  expect(loaded.priority).toBe("speed");
  expect(loaded.autoOverseer).toBe("claude-opus-4-8");
});

test("loadConfig defaults priority and autoOverseer when fields absent", () => {
  const configFile = path.join(tmpDir, "config.toml");
  fs.writeFileSync(configFile, 'profile = "claude-primary"\nmax_cycles = 5\n');
  const loaded = loadConfig(configFile);
  expect(loaded.priority).toBe("quality");
  expect(loaded.autoOverseer).toBe("");
});

test("codex profile maps all tiers to 'codex'", () => {
  const cfg = new ForgeConfig("codex");
  const models = cfg.tierModels();
  expect(models[ModelTier.OVERSEER]).toBe("codex");
  expect(models[ModelTier.REASONING]).toBe("codex");
  expect(models[ModelTier.STANDARD]).toBe("codex");
  expect(models[ModelTier.FAST]).toBe("codex");
});

test("claude-code profile maps all tiers to 'claude-code'", () => {
  const cfg = new ForgeConfig("claude-code");
  const models = cfg.tierModels();
  expect(models[ModelTier.OVERSEER]).toBe("claude-code");
  expect(models[ModelTier.REASONING]).toBe("claude-code");
  expect(models[ModelTier.STANDARD]).toBe("claude-code");
  expect(models[ModelTier.FAST]).toBe("claude-code");
});

test("PROVIDER_PROFILES contains codex key", () => {
  expect(PROVIDER_PROFILES).toHaveProperty("codex");
});

test("PROVIDER_PROFILES contains claude-code key", () => {
  expect(PROVIDER_PROFILES).toHaveProperty("claude-code");
});

test("ForgeConfig defaults skills config to off", () => {
  const cfg = new ForgeConfig();
  expect(cfg.skills.mode).toBe("off");
  expect(cfg.skills.maxSkills).toBe(3);
  expect(cfg.skills.promptCharBudget).toBe(12000);
  expect(cfg.skills.minInstallCount).toBe(100);
  expect(cfg.skills.trustedSources).toContain("vercel-labs");
  expect(cfg.skills.installTargets).toContain("forge");
});

test("saveConfig and loadConfig round-trips skills config", () => {
  const configFile = path.join(tmpDir, "config.toml");
  const skillsCfg: SkillConfig = {
    mode: "auto",
    maxSkills: 4,
    promptCharBudget: 9000,
    minInstallCount: 500,
    trustedSources: ["vercel-labs"],
    installTargets: ["forge", "agents"],
  };
  const cfg = new ForgeConfig("openai-primary", {}, 5, "quality", "", skillsCfg);
  saveConfig(cfg, configFile);
  const loaded = loadConfig(configFile);
  expect(loaded.skills).toEqual(cfg.skills);
});

test("loadConfig defaults skills config when skills table is absent", () => {
  const configFile = path.join(tmpDir, "config.toml");
  fs.writeFileSync(configFile, 'profile = "claude-primary"\nmax_cycles = 5\n');
  const loaded = loadConfig(configFile);
  expect(loaded.skills.mode).toBe("off");
  expect(loaded.skills.maxSkills).toBe(3);
});

test("loadConfig falls back to default install targets when all configured targets are invalid", () => {
  const configFile = path.join(tmpDir, "config.toml");
  fs.writeFileSync(configFile, [
    'profile = "claude-primary"',
    "",
    "[skills]",
    'install_targets = ["nonsense"]',
  ].join("\n"));

  const loaded = loadConfig(configFile);
  expect(loaded.skills.installTargets).toEqual(DEFAULT_SKILL_CONFIG.installTargets);
});

test("loadConfig defaults invalid numeric skill values instead of storing NaN", () => {
  const configFile = path.join(tmpDir, "config.toml");
  fs.writeFileSync(configFile, [
    'profile = "claude-primary"',
    "",
    "[skills]",
    'max_skills = "many"',
    'prompt_char_budget = "large"',
    'min_install_count = "popular"',
  ].join("\n"));

  const loaded = loadConfig(configFile);
  expect(loaded.skills.maxSkills).toBe(DEFAULT_SKILL_CONFIG.maxSkills);
  expect(loaded.skills.promptCharBudget).toBe(DEFAULT_SKILL_CONFIG.promptCharBudget);
  expect(loaded.skills.minInstallCount).toBe(DEFAULT_SKILL_CONFIG.minInstallCount);
});
