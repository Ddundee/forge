import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Session } from "../src/session.js";
import { ForgeConfig, DEFAULT_SKILL_CONFIG } from "../src/config.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-session-skills-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true });
});

function makeSkillConfig(mode: "off" | "auto", maxSkills: number) {
  return { ...DEFAULT_SKILL_CONFIG, mode: mode as "off" | "auto", maxSkills };
}

// --- Session.create with configOverride ---

test("Session.create persists effective skill config snapshot with mode auto", () => {
  const cfg = new ForgeConfig("claude-primary", {}, 5, "quality", "", makeSkillConfig("auto", 1));
  const session = Session.create("build app", undefined, tmpDir, undefined, undefined, cfg);
  const row = session.db.getSession(session.id);
  const snapshot = JSON.parse(String(row?.["config_json"]));

  expect(snapshot.skills.mode).toBe("auto");
  expect(snapshot.skills.max_skills).toBe(1);
  session.db.close();
});

test("Session.create without configOverride uses default config (mode off)", () => {
  const session = Session.create("build app", undefined, tmpDir);
  const row = session.db.getSession(session.id);
  const snapshot = JSON.parse(String(row?.["config_json"]));

  expect(snapshot.skills).toBeDefined();
  session.db.close();
});

test("Session.create persists max_skills in snapshot", () => {
  const cfg = new ForgeConfig("claude-primary", {}, 5, "quality", "", makeSkillConfig("auto", 2));
  const session = Session.create("build app", undefined, tmpDir, undefined, undefined, cfg);
  const row = session.db.getSession(session.id);
  const snapshot = JSON.parse(String(row?.["config_json"]));

  expect(snapshot.skills.max_skills).toBe(2);
  session.db.close();
});

// --- Session.load overlays skill snapshot ---

test("Session.load overlays skill config from session snapshot", () => {
  const cfg = new ForgeConfig("claude-primary", {}, 5, "quality", "", makeSkillConfig("auto", 2));
  const created = Session.create("build app", undefined, tmpDir, undefined, undefined, cfg);
  created.db.close();

  const loaded = Session.load(created.id, tmpDir);
  expect(loaded.config.skills.mode).toBe("auto");
  expect(loaded.config.skills.maxSkills).toBe(2);
  loaded.db.close();
});

test("Session.load with off snapshot preserves off mode", () => {
  const cfg = new ForgeConfig("claude-primary", {}, 5, "quality", "", makeSkillConfig("off", 3));
  const created = Session.create("build app", undefined, tmpDir, undefined, undefined, cfg);
  created.db.close();

  const loaded = Session.load(created.id, tmpDir);
  expect(loaded.config.skills.mode).toBe("off");
  loaded.db.close();
});

test("Session.load snapshot overrides maxSkills from current global config", () => {
  // Session was created with maxSkills=1
  const cfg = new ForgeConfig("claude-primary", {}, 5, "quality", "", makeSkillConfig("auto", 1));
  const created = Session.create("build app", undefined, tmpDir, undefined, undefined, cfg);
  created.db.close();

  // Even if current global config has different maxSkills, loaded session uses snapshot
  const loaded = Session.load(created.id, tmpDir);
  expect(loaded.config.skills.maxSkills).toBe(1);
  loaded.db.close();
});

test("Session.load falls back gracefully for malformed config_json", () => {
  // Create session, then corrupt config_json
  const session = Session.create("build app", undefined, tmpDir);
  session.db.updateSession(session.id, { config_json: "not valid json" } as any);
  session.db.close();

  // Load should not throw
  const loaded = Session.load(session.id, tmpDir);
  expect(loaded.config).toBeDefined();
  loaded.db.close();
});
