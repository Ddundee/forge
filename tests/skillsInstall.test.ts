import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { SkillCandidate, SkillConfig } from "../src/skills/types.js";
import type { AuditedSkillForInstall } from "../src/skills/install.js";
import {
  skillInstallKey,
  readSkillsLock,
  verifyLockEntry,
  containsSymlink,
  verifyInstalledSkillDir,
  verifyExternalTargets,
  withInstallRollback,
  installAuditedSkill,
  installAuditedSkills,
} from "../src/skills/install.js";
import { installPaths } from "../src/skills/paths.js";

function makeCandidate(overrides: Partial<SkillCandidate> & { skillName: string }): SkillCandidate {
  return {
    packageRef: overrides.packageRef ?? "vercel-labs/agent-skills",
    ...overrides,
  };
}

function makeConfig(overrides: Partial<SkillConfig> = {}): SkillConfig {
  return {
    mode: "auto",
    maxSkills: 3,
    promptCharBudget: 12000,
    minInstallCount: 100,
    trustedSources: ["vercel-labs"],
    installTargets: ["forge", "agents"],
    ...overrides,
  };
}

function makeAuditedSkill(candidate: SkillCandidate, overrides: Partial<AuditedSkillForInstall> = {}): AuditedSkillForInstall {
  return {
    selectionId: "sel-1",
    candidateId: "cand-1",
    candidate,
    auditVerdict: "pass",
    auditReasons: [],
    ...overrides,
  };
}

function makeDb() {
  const installs: any[] = [];
  const selections: any[] = [];
  return {
    installs,
    selections,
    logSkillInstallation: jest.fn().mockImplementation((_sid: string, install: any) => {
      installs.push(install);
      return `inst-${installs.length}`;
    }),
    selectSkill: jest.fn().mockImplementation((_sid: string, sel: any) => {
      selections.push(sel);
      return `sel-${selections.length}`;
    }),
  };
}

function writeSkillMd(dir: string, skillName: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${skillName}\ndescription: test skill\n---\n\n# ${skillName}\n`,
    "utf8",
  );
}

let workspace: string;
beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "forge-install-test-"));
});
afterEach(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

// --- skillInstallKey ---

test("skillInstallKey returns lowercase packageRef@skillName", () => {
  const candidate = makeCandidate({ packageRef: "Vercel-Labs/Agent-Skills", skillName: "Deploy-To-Vercel" });
  expect(skillInstallKey(candidate)).toBe("vercel-labs/agent-skills@deploy-to-vercel");
});

// --- readSkillsLock ---

test("readSkillsLock returns undefined for missing file", () => {
  expect(readSkillsLock("/nonexistent/skills-lock.json")).toBeUndefined();
});

test("readSkillsLock returns undefined for invalid JSON", () => {
  const lockFile = path.join(workspace, "skills-lock.json");
  fs.writeFileSync(lockFile, "not json", "utf8");
  expect(readSkillsLock(lockFile)).toBeUndefined();
});

test("readSkillsLock returns undefined for missing version field", () => {
  const lockFile = path.join(workspace, "skills-lock.json");
  fs.writeFileSync(lockFile, JSON.stringify({ skills: {} }), "utf8");
  expect(readSkillsLock(lockFile)).toBeUndefined();
});

test("readSkillsLock parses valid lock file", () => {
  const lockFile = path.join(workspace, "skills-lock.json");
  const lock = {
    version: 1,
    skills: {
      "deploy-to-vercel": {
        source: "vercel-labs/agent-skills",
        computedHash: "abc123",
      },
    },
  };
  fs.writeFileSync(lockFile, JSON.stringify(lock), "utf8");
  const result = readSkillsLock(lockFile);
  expect(result).toBeDefined();
  expect(result?.version).toBe(1);
  expect(result?.skills["deploy-to-vercel"]?.computedHash).toBe("abc123");
});

// --- verifyLockEntry ---

test("verifyLockEntry returns error for undefined lock", () => {
  const candidate = makeCandidate({ skillName: "deploy-to-vercel" });
  expect(verifyLockEntry(undefined, candidate)).toContain("missing");
});

test("verifyLockEntry returns error for missing entry", () => {
  const candidate = makeCandidate({ skillName: "deploy-to-vercel" });
  const lock = { version: 1, skills: {} };
  expect(verifyLockEntry(lock, candidate)).toContain("missing lock entry");
});

test("verifyLockEntry returns error for source mismatch", () => {
  const candidate = makeCandidate({ packageRef: "correct/repo", skillName: "my-skill" });
  const lock = { version: 1, skills: { "my-skill": { source: "wrong/repo", computedHash: "abc" } } };
  expect(verifyLockEntry(lock, candidate)).toContain("did not match");
});

test("verifyLockEntry returns error for missing computedHash", () => {
  const candidate = makeCandidate({ packageRef: "vercel-labs/agent-skills", skillName: "deploy-to-vercel" });
  const lock = { version: 1, skills: { "deploy-to-vercel": { source: "vercel-labs/agent-skills" } } };
  expect(verifyLockEntry(lock, candidate)).toContain("missing lock computedHash");
});

test("verifyLockEntry returns undefined for valid entry", () => {
  const candidate = makeCandidate({ packageRef: "vercel-labs/agent-skills", skillName: "deploy-to-vercel" });
  const lock = {
    version: 1,
    skills: { "deploy-to-vercel": { source: "vercel-labs/agent-skills", computedHash: "abc123" } },
  };
  expect(verifyLockEntry(lock, candidate)).toBeUndefined();
});

// --- containsSymlink ---

test("containsSymlink returns undefined when no symlinks", () => {
  const dir = path.join(workspace, "normal");
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "file.txt"), "content");
  expect(containsSymlink(dir)).toBeUndefined();
});

test("containsSymlink returns relative path of symlink", () => {
  const dir = path.join(workspace, "with-symlink");
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(workspace, "target.txt"), "content");
  fs.symlinkSync(path.join(workspace, "target.txt"), path.join(dir, "link.txt"));
  expect(containsSymlink(dir)).toBe("link.txt");
});

// --- verifyInstalledSkillDir ---

test("verifyInstalledSkillDir fails when SKILL.md missing", () => {
  const dir = path.join(workspace, "empty-skill");
  fs.mkdirSync(dir);
  const candidate = makeCandidate({ skillName: "deploy-to-vercel" });
  const result = verifyInstalledSkillDir("forge", dir, candidate, undefined);
  expect(result.ok).toBe(false);
  expect(result.reason).toContain("missing SKILL.md");
});

test("verifyInstalledSkillDir fails when symlink found", () => {
  const dir = path.join(workspace, "symlink-skill");
  writeSkillMd(dir, "deploy-to-vercel");
  fs.writeFileSync(path.join(workspace, "outside.txt"), "content");
  fs.symlinkSync(path.join(workspace, "outside.txt"), path.join(dir, "link.txt"));
  const candidate = makeCandidate({ skillName: "deploy-to-vercel" });
  const result = verifyInstalledSkillDir("forge", dir, candidate, undefined);
  expect(result.ok).toBe(false);
  expect(result.reason).toContain("symlink");
});

test("verifyInstalledSkillDir fails when frontmatter name mismatches", () => {
  const dir = path.join(workspace, "mismatch-skill");
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "SKILL.md"), "---\nname: wrong-name\n---\n", "utf8");
  const candidate = makeCandidate({ skillName: "deploy-to-vercel" });
  const result = verifyInstalledSkillDir("forge", dir, candidate, undefined);
  expect(result.ok).toBe(false);
  expect(result.reason).toContain("wrong-name");
});

test("verifyInstalledSkillDir passes with valid SKILL.md", () => {
  const dir = path.join(workspace, "valid-skill");
  writeSkillMd(dir, "deploy-to-vercel");
  const candidate = makeCandidate({ skillName: "deploy-to-vercel" });
  const result = verifyInstalledSkillDir("forge", dir, candidate, undefined);
  expect(result.ok).toBe(true);
  expect(result.fileCount).toBeGreaterThan(0);
});

test("verifyInstalledSkillDir passes when frontmatter name is absent", () => {
  const dir = path.join(workspace, "no-name-skill");
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "SKILL.md"), "---\ndescription: no name\n---\n", "utf8");
  const candidate = makeCandidate({ skillName: "deploy-to-vercel" });
  const result = verifyInstalledSkillDir("forge", dir, candidate, undefined);
  expect(result.ok).toBe(true);
});

// --- withInstallRollback ---

test("withInstallRollback restores existing directory on error", async () => {
  const targetDir = path.join(workspace, "skill-dir");
  fs.mkdirSync(targetDir);
  fs.writeFileSync(path.join(targetDir, "original.txt"), "original content");

  await expect(
    withInstallRollback(workspace, [targetDir], async () => {
      fs.rmSync(targetDir, { recursive: true });
      fs.mkdirSync(targetDir);
      fs.writeFileSync(path.join(targetDir, "new.txt"), "new content");
      throw new Error("installation failed");
    }),
  ).rejects.toThrow("installation failed");

  expect(fs.existsSync(path.join(targetDir, "original.txt"))).toBe(true);
  expect(fs.existsSync(path.join(targetDir, "new.txt"))).toBe(false);
});

test("withInstallRollback removes newly created file on error", async () => {
  const newFile = path.join(workspace, "new-file.txt");
  await expect(
    withInstallRollback(workspace, [newFile], async () => {
      fs.writeFileSync(newFile, "content");
      throw new Error("fail");
    }),
  ).rejects.toThrow("fail");
  expect(fs.existsSync(newFile)).toBe(false);
});

test("withInstallRollback returns result on success", async () => {
  const result = await withInstallRollback(workspace, [], async () => 42);
  expect(result).toBe(42);
});

// --- installAuditedSkill ---

function makeInstallClient(skillName: string): { install: jest.Mock } {
  return {
    install: jest.fn().mockImplementation(async ({ workspace: ws, agents }: { workspace: string; agents: string[] }) => {
      for (const agent of agents) {
        let agentDir: string;
        if (agent === "codex") {
          agentDir = path.join(ws, ".agents", "skills", skillName);
        } else if (agent === "claude-code") {
          agentDir = path.join(ws, ".claude", "skills", skillName);
        } else {
          continue;
        }
        writeSkillMd(agentDir, skillName);
      }
      const lockFile = path.join(ws, "skills-lock.json");
      fs.writeFileSync(lockFile, JSON.stringify({
        version: 1,
        skills: {
          [skillName]: {
            source: "vercel-labs/agent-skills",
            computedHash: "hash123",
          },
        },
      }), "utf8");
      return { source: "vercel-labs/agent-skills", skillName };
    }),
  };
}

test("installAuditedSkill returns skipped for non-pass audit", async () => {
  const candidate = makeCandidate({ skillName: "deploy-to-vercel" });
  const skill = makeAuditedSkill(candidate, { auditVerdict: "pass" });
  (skill as any).auditVerdict = "fail";
  const db = makeDb();
  const client = makeInstallClient("deploy-to-vercel");
  const result = await installAuditedSkill(
    { sessionId: "s1", workspace, config: makeConfig(), attempt: 1, skill },
    client,
    db,
  );
  expect(result.status).toBe("skipped");
  expect(result.error).toContain("not audit-approved");
  expect(client.install).not.toHaveBeenCalled();
});

test("installAuditedSkill installs to agents and forge targets", async () => {
  const candidate = makeCandidate({ skillName: "deploy-to-vercel" });
  const skill = makeAuditedSkill(candidate);
  const config = makeConfig({ installTargets: ["forge", "agents"] });
  const client = makeInstallClient("deploy-to-vercel");
  const db = makeDb();

  const result = await installAuditedSkill(
    { sessionId: "s1", workspace, config, attempt: 1, skill },
    client,
    db,
  );

  expect(result.status).toBe("installed");
  expect(client.install).toHaveBeenCalledWith(
    expect.objectContaining({ agents: ["codex"], copy: true }),
  );
  expect(result.verifications.every((v) => v.ok)).toBe(true);
  expect(db.installs.length).toBeGreaterThan(0);
  expect(db.selections[0].status).toBe("installed");
});

test("installAuditedSkill logs failure when external verification fails", async () => {
  const candidate = makeCandidate({ skillName: "deploy-to-vercel" });
  const skill = makeAuditedSkill(candidate);
  const config = makeConfig({ installTargets: ["forge", "agents"] });

  const client = {
    install: jest.fn().mockResolvedValue({ source: "vercel-labs/agent-skills", skillName: "deploy-to-vercel" }),
  };
  const db = makeDb();

  const result = await installAuditedSkill(
    { sessionId: "s1", workspace, config, attempt: 1, skill },
    client,
    db,
  );

  expect(result.status).toBe("failed");
  expect(result.error).toBeDefined();
  expect(db.selections[0].status).toBe("failed");
});

test("installAuditedSkill logs install record per target", async () => {
  const candidate = makeCandidate({ skillName: "deploy-to-vercel" });
  const skill = makeAuditedSkill(candidate);
  const config = makeConfig({ installTargets: ["forge", "agents"] });
  const client = makeInstallClient("deploy-to-vercel");
  const db = makeDb();

  await installAuditedSkill({ sessionId: "s1", workspace, config, attempt: 1, skill }, client, db);

  expect(db.installs.length).toBe(2);
  const targets = db.installs.map((i: any) => i.target);
  expect(targets).toContain("agents");
  expect(targets).toContain("forge");
});

test("installAuditedSkill passes attempt to db", async () => {
  const candidate = makeCandidate({ skillName: "deploy-to-vercel" });
  const skill = makeAuditedSkill(candidate);
  const config = makeConfig({ installTargets: ["forge", "agents"] });
  const client = makeInstallClient("deploy-to-vercel");
  const db = makeDb();

  await installAuditedSkill({ sessionId: "s1", workspace, config, attempt: 7, skill }, client, db);

  expect(db.installs.every((i: any) => i.attempt === 7)).toBe(true);
});

test("installAuditedSkill includes lockHash in forge verification", async () => {
  const candidate = makeCandidate({ skillName: "deploy-to-vercel" });
  const skill = makeAuditedSkill(candidate);
  const config = makeConfig({ installTargets: ["forge", "agents"] });
  const client = makeInstallClient("deploy-to-vercel");
  const db = makeDb();

  const result = await installAuditedSkill({ sessionId: "s1", workspace, config, attempt: 1, skill }, client, db);

  expect(result.status).toBe("installed");
  const forgeCheck = result.verifications.find((v) => v.target === "forge");
  expect(forgeCheck?.lockHash).toBe("hash123");
});

// --- installAuditedSkills (conflict detection) ---

test("installAuditedSkills skips second skill with same name from different package", async () => {
  const c1 = makeCandidate({ packageRef: "owner-a/repo-a", skillName: "my-skill" });
  const c2 = makeCandidate({ packageRef: "owner-b/repo-b", skillName: "my-skill" });
  const skill1 = makeAuditedSkill(c1, { candidateId: "c1" });
  const skill2 = makeAuditedSkill(c2, { candidateId: "c2" });

  const client = makeInstallClient("my-skill");
  const db = makeDb();
  const config = makeConfig({ installTargets: ["forge", "agents"] });

  const results = await installAuditedSkills(
    { sessionId: "s1", workspace, config, attempt: 1, skills: [skill1, skill2] },
    client,
    db,
  );

  const skipped = results.find((r) => r.status === "skipped" && r.error?.includes("conflict"));
  expect(skipped).toBeDefined();
});

test("installAuditedSkills allows same skill from same package twice (deduped)", async () => {
  const c1 = makeCandidate({ packageRef: "owner-a/repo-a", skillName: "my-skill" });
  const skill1 = makeAuditedSkill(c1, { candidateId: "c1" });
  const skill2 = makeAuditedSkill(c1, { candidateId: "c1" });

  const client = makeInstallClient("my-skill");
  const db = makeDb();
  const config = makeConfig({ installTargets: ["forge", "agents"] });

  const results = await installAuditedSkills(
    { sessionId: "s1", workspace, config, attempt: 1, skills: [skill1, skill2] },
    client,
    db,
  );

  const conflicts = results.filter((r) => r.error?.includes("conflict"));
  expect(conflicts).toHaveLength(0);
});
