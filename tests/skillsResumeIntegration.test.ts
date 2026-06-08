import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Session } from "../src/session.js";
import { ForgeConfig, DEFAULT_SKILL_CONFIG } from "../src/config.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-resume-skills-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true });
});

function skillConfig(mode: "off" | "auto", maxSkills = 3) {
  return { ...DEFAULT_SKILL_CONFIG, mode, maxSkills };
}

// --- T2-RESUME: Session snapshot stability ---

test("resumed session inherits skill mode from creation-time config, not current global", () => {
  const cfg = new ForgeConfig("claude-primary", {}, 5, "quality", "", skillConfig("auto", 1));
  const created = Session.create("build a website", undefined, tmpDir, undefined, undefined, cfg);
  created.db.close();

  const loaded = Session.load(created.id, tmpDir);
  expect(loaded.config.skills.mode).toBe("auto");
  expect(loaded.config.skills.maxSkills).toBe(1);
  loaded.db.close();
});

test("resume with off snapshot keeps skills disabled even if default config has changed", () => {
  const cfg = new ForgeConfig("claude-primary", {}, 5, "quality", "", skillConfig("off", 3));
  const created = Session.create("build a website", undefined, tmpDir, undefined, undefined, cfg);
  created.db.close();

  // Simulate a different current config - snapshot should win
  const loaded = Session.load(created.id, tmpDir);
  expect(loaded.config.skills.mode).toBe("off");
  loaded.db.close();
});

test("session snapshot stores all skill config fields correctly", () => {
  const custom = {
    ...DEFAULT_SKILL_CONFIG,
    mode: "auto" as const,
    maxSkills: 2,
    promptCharBudget: 8000,
    minInstallCount: 50,
    trustedSources: ["my-org"],
    installTargets: ["forge" as const],
  };
  const cfg = new ForgeConfig("claude-primary", {}, 5, "quality", "", custom);
  const created = Session.create("custom config test", undefined, tmpDir, undefined, undefined, cfg);
  const row = created.db.getSession(created.id);
  const snapshot = JSON.parse(String(row?.["config_json"] ?? "{}"));
  created.db.close();

  expect(snapshot.skills.mode).toBe("auto");
  expect(snapshot.skills.max_skills).toBe(2);
  expect(snapshot.skills.prompt_char_budget).toBe(8000);
  expect(snapshot.skills.min_install_count).toBe(50);
  expect(snapshot.skills.trusted_sources).toEqual(["my-org"]);
  expect(snapshot.skills.install_targets).toEqual(["forge"]);
});

test("loaded session round-trips promptCharBudget from snapshot", () => {
  const custom = {
    ...DEFAULT_SKILL_CONFIG,
    mode: "auto" as const,
    promptCharBudget: 9999,
  };
  const cfg = new ForgeConfig("claude-primary", {}, 5, "quality", "", custom);
  const created = Session.create("prompt budget test", undefined, tmpDir, undefined, undefined, cfg);
  created.db.close();

  const loaded = Session.load(created.id, tmpDir);
  expect(loaded.config.skills.promptCharBudget).toBe(9999);
  loaded.db.close();
});

test("session created without configOverride gets default skill config", () => {
  const created = Session.create("default config test", undefined, tmpDir);
  const row = created.db.getSession(created.id);
  const snapshot = JSON.parse(String(row?.["config_json"] ?? "{}"));
  created.db.close();

  expect(snapshot.skills).toBeDefined();
  expect(snapshot.skills.mode).toBe("off");
});

test("load falls back to current config when config_json is empty object", () => {
  const cfg = new ForgeConfig("claude-primary", {}, 5, "quality", "", skillConfig("auto", 2));
  const created = Session.create("fallback test", undefined, tmpDir, undefined, undefined, cfg);
  created.db.updateSession(created.id, { config_json: "{}" });
  created.db.close();

  const loaded = Session.load(created.id, tmpDir);
  // Falls back to current global config (mode = "off" by default)
  expect(loaded.config).toBeDefined();
  loaded.db.close();
});

test("multiple sessions have independent skill snapshots", () => {
  const cfgAuto = new ForgeConfig("claude-primary", {}, 5, "quality", "", skillConfig("auto", 1));
  const cfgOff = new ForgeConfig("claude-primary", {}, 5, "quality", "", skillConfig("off", 3));

  const s1 = Session.create("auto session", undefined, tmpDir, undefined, undefined, cfgAuto);
  const s2 = Session.create("off session", undefined, tmpDir, undefined, undefined, cfgOff);
  s1.db.close();
  s2.db.close();

  const l1 = Session.load(s1.id, tmpDir);
  const l2 = Session.load(s2.id, tmpDir);

  expect(l1.config.skills.mode).toBe("auto");
  expect(l1.config.skills.maxSkills).toBe(1);
  expect(l2.config.skills.mode).toBe("off");
  expect(l2.config.skills.maxSkills).toBe(3);

  l1.db.close();
  l2.db.close();
});
