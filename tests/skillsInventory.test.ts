import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { InstalledSkillManifest } from "../src/skills/inventory.js";
import {
  writeForgeManifest,
  readForgeManifest,
  listForgeInstalledSkills,
  findInstalledSkill,
} from "../src/skills/inventory.js";

function makeManifest(overrides: Partial<InstalledSkillManifest> = {}): InstalledSkillManifest {
  return {
    schemaVersion: 1,
    installedAt: "2024-01-01T00:00:00.000Z",
    packageRef: "vercel-labs/agent-skills",
    skillName: "deploy-to-vercel",
    sourceOwner: "vercel-labs",
    sourceRepo: "agent-skills",
    candidateId: "c0",
    selectionId: "s0",
    auditVerdict: "pass",
    installTargets: ["forge", "agents"],
    externalPaths: { agents: ".agents/skills/deploy-to-vercel" },
    ...overrides,
  };
}

function makeSkillDir(workspace: string, dirName: string, manifest: InstalledSkillManifest, skillMd?: string): string {
  const dir = path.join(workspace, ".forge", "skills", dirName);
  fs.mkdirSync(dir, { recursive: true });
  writeForgeManifest(dir, manifest);
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    skillMd ?? `---\nname: ${manifest.skillName}\ndescription: A test skill\n---\n\n# Body\n`,
    "utf8",
  );
  return dir;
}

let workspace: string;
beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "forge-inv-test-"));
});
afterEach(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

test("writeForgeManifest creates forge-skill.json", () => {
  const dir = path.join(workspace, "skill-dir");
  fs.mkdirSync(dir);
  const manifest = makeManifest();
  writeForgeManifest(dir, manifest);
  const filePath = path.join(dir, "forge-skill.json");
  expect(fs.existsSync(filePath)).toBe(true);
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  expect(parsed.skillName).toBe("deploy-to-vercel");
  expect(parsed.schemaVersion).toBe(1);
});

test("readForgeManifest returns undefined for missing file", () => {
  expect(readForgeManifest("/nonexistent/path/forge-skill.json")).toBeUndefined();
});

test("readForgeManifest returns undefined for invalid JSON", () => {
  const filePath = path.join(workspace, "forge-skill.json");
  fs.writeFileSync(filePath, "not json", "utf8");
  expect(readForgeManifest(filePath)).toBeUndefined();
});

test("readForgeManifest returns undefined for wrong schemaVersion", () => {
  const filePath = path.join(workspace, "forge-skill.json");
  fs.writeFileSync(filePath, JSON.stringify({ schemaVersion: 99, packageRef: "a/b", skillName: "foo" }), "utf8");
  expect(readForgeManifest(filePath)).toBeUndefined();
});

test("readForgeManifest roundtrips a valid manifest", () => {
  const manifest = makeManifest();
  const filePath = path.join(workspace, "forge-skill.json");
  fs.writeFileSync(filePath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  const result = readForgeManifest(filePath);
  expect(result).toBeDefined();
  expect(result?.skillName).toBe("deploy-to-vercel");
  expect(result?.packageRef).toBe("vercel-labs/agent-skills");
});

test("listForgeInstalledSkills returns empty array for missing skills dir", () => {
  expect(listForgeInstalledSkills(workspace)).toEqual([]);
});

test("listForgeInstalledSkills returns entry for valid installed skill", () => {
  makeSkillDir(workspace, "vercel-labs__agent-skills__deploy-to-vercel", makeManifest());
  const entries = listForgeInstalledSkills(workspace);
  expect(entries).toHaveLength(1);
  expect(entries[0].skillName).toBe("deploy-to-vercel");
  expect(entries[0].packageRef).toBe("vercel-labs/agent-skills");
  expect(entries[0].forgePath).toContain(".forge/skills");
  expect(entries[0].agentsPath).toBe(".agents/skills/deploy-to-vercel");
});

test("listForgeInstalledSkills skips dirs without forge-skill.json", () => {
  const dir = path.join(workspace, ".forge", "skills", "no-manifest");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), "---\nname: orphan\n---\n", "utf8");
  expect(listForgeInstalledSkills(workspace)).toHaveLength(0);
});

test("listForgeInstalledSkills skips dirs without SKILL.md", () => {
  const dir = path.join(workspace, ".forge", "skills", "no-skill-md");
  fs.mkdirSync(dir, { recursive: true });
  writeForgeManifest(dir, makeManifest({ skillName: "no-skill-md" }));
  expect(listForgeInstalledSkills(workspace)).toHaveLength(0);
});

test("listForgeInstalledSkills returns multiple entries sorted by skillName", () => {
  makeSkillDir(workspace, "a__b__zebra", makeManifest({ skillName: "zebra", packageRef: "a/b" }));
  makeSkillDir(workspace, "a__b__alpha", makeManifest({ skillName: "alpha", packageRef: "a/b" }));
  const entries = listForgeInstalledSkills(workspace);
  expect(entries).toHaveLength(2);
  expect(entries[0].skillName).toBe("alpha");
  expect(entries[1].skillName).toBe("zebra");
});

test("listForgeInstalledSkills reads displayName from SKILL.md frontmatter", () => {
  makeSkillDir(
    workspace,
    "vercel-labs__agent-skills__deploy-to-vercel",
    makeManifest(),
    "---\nname: Deploy to Vercel\ndescription: Deploys to Vercel\n---\n",
  );
  const entries = listForgeInstalledSkills(workspace);
  expect(entries[0].displayName).toBe("Deploy to Vercel");
  expect(entries[0].description).toBe("Deploys to Vercel");
});

test("listForgeInstalledSkills falls back to skillName when frontmatter name missing", () => {
  makeSkillDir(
    workspace,
    "vercel-labs__agent-skills__deploy-to-vercel",
    makeManifest(),
    "---\ndescription: no name field here\n---\n",
  );
  const entries = listForgeInstalledSkills(workspace);
  expect(entries[0].displayName).toBe("deploy-to-vercel");
});

test("findInstalledSkill returns entry matching packageRef and skillName", () => {
  makeSkillDir(workspace, "vercel-labs__agent-skills__deploy-to-vercel", makeManifest());
  const entry = findInstalledSkill(workspace, "vercel-labs/agent-skills", "deploy-to-vercel");
  expect(entry).toBeDefined();
  expect(entry?.skillName).toBe("deploy-to-vercel");
});

test("findInstalledSkill returns undefined for unknown skill", () => {
  makeSkillDir(workspace, "vercel-labs__agent-skills__deploy-to-vercel", makeManifest());
  expect(findInstalledSkill(workspace, "other/repo", "other-skill")).toBeUndefined();
});

test("findInstalledSkill is case-insensitive", () => {
  makeSkillDir(workspace, "vercel-labs__agent-skills__deploy-to-vercel", makeManifest());
  const entry = findInstalledSkill(workspace, "VERCEL-LABS/AGENT-SKILLS", "DEPLOY-TO-VERCEL");
  expect(entry).toBeDefined();
});

test("listForgeInstalledSkills exposes lockHash from manifest", () => {
  makeSkillDir(
    workspace,
    "vercel-labs__agent-skills__deploy-to-vercel",
    makeManifest({ lock: { computedHash: "abc123", source: "vercel-labs/agent-skills" } }),
  );
  const entries = listForgeInstalledSkills(workspace);
  expect(entries[0].lockHash).toBe("abc123");
});
