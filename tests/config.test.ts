import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ForgeConfig, loadConfig, saveConfig, loadKeys, PROVIDER_PROFILES } from "../src-ts/config.js";
import { ModelTier } from "../src-ts/router.js";

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
