import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { SkillCandidate } from "../src/skills/types.js";
import {
  resolveInWorkspace,
  installPaths,
  cliAgentsForTargets,
  safeSkillDirPart,
  forgeSkillDirName,
} from "../src/skills/paths.js";

function makeCandidate(overrides: Partial<SkillCandidate> & { skillName: string }): SkillCandidate {
  return {
    packageRef: overrides.packageRef ?? "test-owner/test-repo",
    skillName: overrides.skillName,
    title: overrides.skillName,
    ...overrides,
  };
}

test("resolveInWorkspace rejects path escapes", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "forge-skill-paths-"));
  expect(() => resolveInWorkspace(workspace, "../outside")).toThrow("Path escapes workspace");
});

test("resolveInWorkspace allows nested paths", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "forge-skill-paths-"));
  const result = resolveInWorkspace(workspace, ".forge/skills/my-skill");
  expect(result).toBe(path.join(workspace, ".forge", "skills", "my-skill"));
});

test("installPaths maps candidate to forge agents and claude paths", () => {
  const candidate = makeCandidate({
    packageRef: "vercel-labs/agent-skills",
    skillName: "deploy-to-vercel",
  });
  const paths = installPaths("/tmp/ws", candidate);
  expect(paths.forge).toBe("/tmp/ws/.forge/skills/vercel-labs__agent-skills__deploy-to-vercel");
  expect(paths.agents).toBe("/tmp/ws/.agents/skills/deploy-to-vercel");
  expect(paths.claude).toBe("/tmp/ws/.claude/skills/deploy-to-vercel");
  expect(paths.lockFile).toBe("/tmp/ws/skills-lock.json");
});

test("cliAgentsForTargets maps agents target to codex", () => {
  expect(cliAgentsForTargets(["forge", "agents"])).toEqual(["codex"]);
});

test("cliAgentsForTargets maps claude target to claude-code", () => {
  expect(cliAgentsForTargets(["forge", "agents", "claude"])).toEqual(["codex", "claude-code"]);
});

test("cliAgentsForTargets returns empty for forge-only", () => {
  expect(cliAgentsForTargets(["forge"])).toEqual([]);
});

test("safeSkillDirPart normalizes special chars to lowercase kebab", () => {
  expect(safeSkillDirPart("Deploy/To Vercel!!")).toBe("deploy-to-vercel");
});

test("safeSkillDirPart collapses repeated hyphens", () => {
  expect(safeSkillDirPart("foo---bar")).toBe("foo-bar");
});

test("forgeSkillDirName creates double-underscore separated key", () => {
  const candidate = makeCandidate({
    packageRef: "vercel-labs/agent-skills",
    skillName: "deploy-to-vercel",
  });
  expect(forgeSkillDirName(candidate)).toBe("vercel-labs__agent-skills__deploy-to-vercel");
});
