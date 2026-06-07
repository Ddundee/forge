import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { SkillCandidate, SkillConfig, SkillInstallRecord, SkillInstallTarget } from "./types.js";
import { parseSkillMarkdown, loadSkillBundle } from "./bundle.js";
import { auditSkillBundle } from "./audit.js";
import type { InstalledSkillManifest } from "./inventory.js";
import { writeForgeManifest } from "./inventory.js";
import type { SkillInstallPaths } from "./paths.js";
import { installPaths, cliAgentsForTargets } from "./paths.js";

export interface AuditedSkillForInstall {
  selectionId: string;
  candidateId: string;
  candidate: SkillCandidate;
  auditVerdict: "pass";
  auditReasons: string[];
}

export interface SkillInstallVerification {
  target: SkillInstallTarget;
  path: string;
  ok: boolean;
  reason?: string;
  name?: string;
  description?: string;
  fileCount?: number;
  byteCount?: number;
  lockHash?: string;
}

export interface SkillsLock {
  version: number;
  skills: Record<string, {
    source?: string;
    sourceType?: string;
    skillPath?: string;
    computedHash?: string;
  }>;
}

export interface SkillInstallClient {
  install(request: {
    source: string;
    skillName: string;
    workspace: string;
    agents: string[];
    copy: true;
  }): Promise<{ source: string; skillName: string }>;
}

export interface SkillInstallDb {
  logSkillInstallation(sessionId: string, install: SkillInstallRecord): string;
  selectSkill(sessionId: string, selection: {
    candidateId: string;
    status: "selected" | "skipped" | "installed" | "failed";
    attempt: number;
    phase: string;
    taskId?: string;
    rationale: string;
  }): string;
}

export interface InstallAuditedSkillInput {
  sessionId: string;
  workspace: string;
  config: SkillConfig;
  attempt: number;
  skill: AuditedSkillForInstall;
}

export interface InstallAuditedSkillResult {
  candidateKey: string;
  status: "installed" | "failed" | "skipped";
  installPaths: SkillInstallPaths;
  verifications: SkillInstallVerification[];
  error?: string;
}

// --- Utilities ---

export function skillInstallKey(candidate: SkillCandidate): string {
  return `${candidate.packageRef}@${candidate.skillName}`.toLowerCase();
}

export function readSkillsLock(lockFile: string): SkillsLock | undefined {
  if (!fs.existsSync(lockFile)) return undefined;
  try {
    const parsed = JSON.parse(fs.readFileSync(lockFile, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") return undefined;
    const m = parsed as Record<string, unknown>;
    if (typeof m["version"] !== "number") return undefined;
    if (!m["skills"] || typeof m["skills"] !== "object") return undefined;
    return parsed as SkillsLock;
  } catch {
    return undefined;
  }
}

export function verifyLockEntry(lock: SkillsLock | undefined, candidate: SkillCandidate): string | undefined {
  if (!lock) return "missing skills-lock.json";
  const entry = lock.skills[candidate.skillName];
  if (!entry) return `missing lock entry for ${candidate.skillName}`;
  if (entry.source !== candidate.packageRef) {
    return `lock source ${entry.source ?? "(missing)"} did not match ${candidate.packageRef}`;
  }
  if (!entry.computedHash) return "missing lock computedHash";
  return undefined;
}

function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      yield full;
    } else if (entry.isDirectory()) {
      yield* walk(full);
    } else {
      yield full;
    }
  }
}

export function containsSymlink(root: string): string | undefined {
  for (const entry of walk(root)) {
    if (fs.lstatSync(entry).isSymbolicLink()) {
      return path.relative(root, entry);
    }
  }
  return undefined;
}

function countFilesAndBytes(dir: string): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  for (const filePath of walk(dir)) {
    try {
      const stat = fs.lstatSync(filePath);
      if (!stat.isSymbolicLink() && stat.isFile()) {
        files++;
        bytes += stat.size;
      }
    } catch {
      // ignore unreadable entries
    }
  }
  return { files, bytes };
}

export function verifyInstalledSkillDir(
  target: SkillInstallTarget,
  dir: string,
  candidate: SkillCandidate,
  lock: SkillsLock | undefined,
): SkillInstallVerification {
  const skillFile = path.join(dir, "SKILL.md");
  if (!fs.existsSync(skillFile)) {
    return { target, path: dir, ok: false, reason: "missing SKILL.md" };
  }

  const symlink = containsSymlink(dir);
  if (symlink) {
    return { target, path: dir, ok: false, reason: `symlink found: ${symlink}` };
  }

  const markdown = fs.readFileSync(skillFile, "utf8");
  const { frontmatter } = parseSkillMarkdown(markdown);
  if (frontmatter.name && frontmatter.name !== candidate.skillName) {
    return {
      target,
      path: dir,
      ok: false,
      reason: `frontmatter name "${frontmatter.name}" did not match "${candidate.skillName}"`,
    };
  }

  const counts = countFilesAndBytes(dir);
  const lockEntry = lock?.skills?.[candidate.skillName];
  return {
    target,
    path: dir,
    ok: true,
    name: frontmatter.name,
    description: frontmatter.description,
    fileCount: counts.files,
    byteCount: counts.bytes,
    lockHash: lockEntry?.computedHash,
  };
}

export function verifyExternalTargets(
  paths: SkillInstallPaths,
  targets: SkillInstallTarget[],
  candidate: SkillCandidate,
  lock: SkillsLock | undefined,
): SkillInstallVerification[] {
  const checks: SkillInstallVerification[] = [];
  if (targets.includes("agents")) {
    checks.push(verifyInstalledSkillDir("agents", paths.agents, candidate, lock));
  }
  if (targets.includes("claude")) {
    checks.push(verifyInstalledSkillDir("claude", paths.claude, candidate, lock));
  }
  return checks;
}

export function verifyInstalledAuditPass(
  dir: string,
  candidate: SkillCandidate,
  config: SkillConfig,
): string | undefined {
  try {
    const bundle = loadSkillBundle({
      source: candidate.packageRef,
      skillName: candidate.skillName,
      skillMarkdown: fs.readFileSync(path.join(dir, "SKILL.md"), "utf8"),
      supportDir: dir,
    });
    const audit = auditSkillBundle({ candidate, bundle, config, phase: "SKILL_INSTALL" });
    return audit.verdict === "pass" ? undefined : `post-install audit ${audit.verdict}: ${audit.summary}`;
  } catch (err) {
    return `post-install audit error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// --- Rollback ---

interface InstallBackupEntry {
  targetPath: string;
  backupPath?: string;
  existed: boolean;
}

function createBackups(targetPaths: string[], backupRoot: string): InstallBackupEntry[] {
  return targetPaths.map((targetPath, index) => {
    if (!fs.existsSync(targetPath)) return { targetPath, existed: false };
    const backupPath = path.join(backupRoot, String(index));
    const stat = fs.lstatSync(targetPath);
    if (stat.isDirectory()) {
      fs.cpSync(targetPath, backupPath, { recursive: true, dereference: false });
    } else {
      fs.mkdirSync(path.dirname(backupPath), { recursive: true });
      fs.copyFileSync(targetPath, backupPath);
    }
    return { targetPath, backupPath, existed: true };
  });
}

function restoreBackups(backups: InstallBackupEntry[]): void {
  for (const backup of backups) {
    fs.rmSync(backup.targetPath, { recursive: true, force: true });
    if (!backup.existed || !backup.backupPath) continue;
    const stat = fs.lstatSync(backup.backupPath);
    fs.mkdirSync(path.dirname(backup.targetPath), { recursive: true });
    if (stat.isDirectory()) {
      fs.cpSync(backup.backupPath, backup.targetPath, { recursive: true, dereference: false });
    } else {
      fs.copyFileSync(backup.backupPath, backup.targetPath);
    }
  }
}

export async function withInstallRollback<T>(
  _workspace: string,
  targetPaths: string[],
  action: () => Promise<T>,
): Promise<T> {
  const backupRoot = fs.mkdtempSync(path.join(os.tmpdir(), "forge-skill-install-"));
  const backups = createBackups(targetPaths, backupRoot);
  try {
    return await action();
  } catch (error) {
    restoreBackups(backups);
    throw error;
  } finally {
    fs.rmSync(backupRoot, { recursive: true, force: true });
  }
}

// --- Internal helpers ---

function pathForTarget(paths: SkillInstallPaths, target: SkillInstallTarget): string {
  if (target === "agents") return paths.agents;
  if (target === "claude") return paths.claude;
  return paths.forge;
}

function preferredSourcePath(paths: SkillInstallPaths, targets: SkillInstallTarget[]): string {
  if (targets.includes("agents")) return paths.agents;
  if (targets.includes("claude")) return paths.claude;
  throw new Error("forge target requires at least one external target (agents or claude) in v1");
}

function pathsForRollback(paths: SkillInstallPaths, targets: SkillInstallTarget[]): string[] {
  const result: string[] = [paths.lockFile];
  if (targets.includes("forge")) result.push(paths.forge);
  if (targets.includes("agents")) result.push(paths.agents);
  if (targets.includes("claude")) result.push(paths.claude);
  return result;
}

function copySkillDirectory(src: string, dst: string): void {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.cpSync(src, dst, { recursive: true, dereference: false });
}

function manifestFor(
  input: InstallAuditedSkillInput,
  paths: SkillInstallPaths,
  lock: SkillsLock | undefined,
  targets: SkillInstallTarget[],
): InstalledSkillManifest {
  const { candidate, selectionId, candidateId } = input.skill;
  const parts = candidate.packageRef.split("/");
  const sourceOwner = parts[0] ?? "";
  const sourceRepo = parts[1] ?? "";
  const externalPaths: Record<string, string> = {};
  if (targets.includes("agents")) {
    externalPaths["agents"] = path.relative(input.workspace, paths.agents);
  }
  if (targets.includes("claude")) {
    externalPaths["claude"] = path.relative(input.workspace, paths.claude);
  }
  const lockEntry = lock?.skills?.[candidate.skillName];
  return {
    schemaVersion: 1,
    installedAt: new Date().toISOString(),
    packageRef: candidate.packageRef,
    skillName: candidate.skillName,
    sourceOwner,
    sourceRepo,
    candidateId,
    selectionId,
    auditVerdict: "pass",
    installTargets: targets,
    externalPaths,
    ...(lockEntry ? { lock: lockEntry } : {}),
  };
}

// --- Main Orchestrator ---

export async function installAuditedSkill(
  input: InstallAuditedSkillInput,
  client: SkillInstallClient,
  db: SkillInstallDb,
): Promise<InstallAuditedSkillResult> {
  const { sessionId, workspace, config, attempt } = input;
  const { skill } = input;
  const candidate = skill.candidate;
  const targets = config.installTargets;
  const paths = installPaths(workspace, candidate);
  const agents = cliAgentsForTargets(targets);
  const candidateKey = skillInstallKey(candidate);

  if (skill.auditVerdict !== "pass") {
    return {
      candidateKey,
      status: "skipped",
      installPaths: paths,
      verifications: [],
      error: "skill was not audit-approved",
    };
  }

  return withInstallRollback(workspace, pathsForRollback(paths, targets), async () => {
    if (agents.length > 0) {
      await client.install({
        source: candidate.packageRef,
        skillName: candidate.skillName,
        workspace,
        agents,
        copy: true,
      });
    }

    const lock = readSkillsLock(paths.lockFile);
    const externalChecks = verifyExternalTargets(paths, targets, candidate, lock);
    const failedExternal = externalChecks.find((check) => !check.ok);
    if (failedExternal) {
      throw new Error(failedExternal.reason ?? `failed verifying ${failedExternal.path}`);
    }

    const verifications: SkillInstallVerification[] = [...externalChecks];

    if (targets.includes("forge")) {
      const sourceForForge = preferredSourcePath(paths, targets);
      copySkillDirectory(sourceForForge, paths.forge);
      writeForgeManifest(paths.forge, manifestFor(input, paths, lock, targets));
      const forgeCheck = verifyInstalledSkillDir("forge", paths.forge, candidate, lock);
      verifications.push(forgeCheck);
      if (!forgeCheck.ok) {
        throw new Error(forgeCheck.reason ?? "forge target verification failed");
      }
    }

    for (const target of targets) {
      db.logSkillInstallation(sessionId, {
        selectionId: skill.selectionId,
        attempt,
        target,
        installPath: path.relative(workspace, pathForTarget(paths, target)),
        status: "installed",
      });
    }

    db.selectSkill(sessionId, {
      candidateId: skill.candidateId,
      status: "installed",
      attempt,
      phase: "SKILL_INSTALL",
      rationale: `installed ${candidateKey} to ${targets.join(", ")}`,
    });

    return {
      candidateKey,
      status: "installed" as const,
      installPaths: paths,
      verifications,
    };
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    for (const target of targets) {
      db.logSkillInstallation(sessionId, {
        selectionId: skill.selectionId,
        attempt,
        target,
        installPath: path.relative(workspace, pathForTarget(paths, target)),
        status: "failed",
        error: message,
      });
    }
    db.selectSkill(sessionId, {
      candidateId: skill.candidateId,
      status: "failed",
      attempt,
      phase: "SKILL_INSTALL",
      rationale: `install failed: ${message}`,
    });
    return {
      candidateKey,
      status: "failed" as const,
      installPaths: paths,
      verifications: [],
      error: message,
    };
  });
}

export async function installAuditedSkills(
  input: {
    sessionId: string;
    workspace: string;
    config: SkillConfig;
    attempt: number;
    skills: AuditedSkillForInstall[];
  },
  client: SkillInstallClient,
  db: SkillInstallDb,
): Promise<InstallAuditedSkillResult[]> {
  const results: InstallAuditedSkillResult[] = [];
  const plannedNames = new Map<string, string>();

  for (const skill of input.skills) {
    const nameKey = skill.candidate.skillName.toLowerCase();
    const candidateKey = skillInstallKey(skill.candidate);
    const existing = plannedNames.get(nameKey);
    if (existing && existing !== candidateKey) {
      results.push({
        candidateKey,
        status: "skipped",
        installPaths: installPaths(input.workspace, skill.candidate),
        verifications: [],
        error: `external skill name conflict with ${existing}`,
      });
      continue;
    }
    plannedNames.set(nameKey, candidateKey);
    results.push(await installAuditedSkill(
      { sessionId: input.sessionId, workspace: input.workspace, config: input.config, attempt: input.attempt, skill },
      client,
      db,
    ));
  }

  return results;
}

export async function ensureSkillsInstalledForWorkspace(
  workspace: string,
  skills: AuditedSkillForInstall[],
  config: SkillConfig,
  attempt: number,
  client: SkillInstallClient,
  db: SkillInstallDb,
  sessionId: string,
): Promise<InstallAuditedSkillResult[]> {
  return installAuditedSkills({ sessionId, workspace, config, attempt, skills }, client, db);
}
