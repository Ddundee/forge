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

/**
 * Produce a stable lowercase install key for a skill candidate.
 *
 * @param candidate - Skill candidate containing `packageRef` and `skillName`
 * @returns The normalized identifier in the form `<packageRef>@<skillName>` lowercased
 */

export function skillInstallKey(candidate: SkillCandidate): string {
  return `${candidate.packageRef}@${candidate.skillName}`.toLowerCase();
}

/**
 * Load and validate a skills-lock JSON file from the given path.
 *
 * @param lockFile - Filesystem path to the `skills-lock.json` file
 * @returns The parsed `SkillsLock` when the file exists and contains a numeric `version` and an object-valued `skills` property, `undefined` otherwise
 */
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

/**
 * Validates that a skills-lock entry exists and matches the given skill candidate.
 *
 * @param lock - The parsed `skills-lock.json` object, or `undefined` if the file is missing.
 * @param candidate - The skill candidate whose lock entry is being verified.
 * @returns An error message describing the verification failure, or `undefined` when the lock entry is present and matches the candidate (including a computed hash).
 */
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

/**
 * Finds the first symbolic link located under the given root directory.
 *
 * @param root - Path to the directory to search
 * @returns The path of the first symbolic link relative to `root`, or `undefined` if none is found
 */
export function containsSymlink(root: string): string | undefined {
  for (const entry of walk(root)) {
    if (fs.lstatSync(entry).isSymbolicLink()) {
      return path.relative(root, entry);
    }
  }
  return undefined;
}

/**
 * Count regular files and their total size under a directory, excluding symbolic links.
 *
 * @param dir - Root directory to traverse
 * @returns An object with `files` (the number of regular files found) and `bytes` (the sum of their sizes in bytes)
 */
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

/**
 * Verify that a directory contains a valid installed skill and collect metadata about it.
 *
 * @returns A `SkillInstallVerification` describing the check result. If the check failed, `ok` is `false` and `reason` explains why (e.g., missing `SKILL.md`, symlink found, frontmatter name mismatch). If the check passed, `ok` is `true` and the object includes `name`, `description`, `fileCount`, `byteCount`, and `lockHash` when available.
 */
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

/**
 * Verify installed skill directories for the requested external targets.
 *
 * Checks the configured external target directories (agents and/or claude) and returns a verification result for each target that was requested.
 *
 * @param paths - Resolved install paths for the workspace
 * @param targets - List of install targets to verify (may include `"agents"` and/or `"claude"`)
 * @param candidate - Skill candidate being verified
 * @param lock - Optional parsed `skills-lock.json` used to validate lock entries
 * @returns An array of `SkillInstallVerification` entries corresponding to the checked external targets; returns an empty array if no external targets were requested.
 */
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

/**
 * Runs a post-install audit of the skill installed in `dir` and reports any audit failure or error.
 *
 * @param dir - Filesystem path to the installed skill directory (contains `SKILL.md`)
 * @param candidate - The skill candidate metadata used to identify the skill
 * @param config - Audit configuration to apply during the post-install audit
 * @returns A string describing the audit verdict or error if the audit did not pass or failed to run, or `undefined` if the audit passed
 */
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

/**
 * Create filesystem backups for a list of target paths under a backup root.
 *
 * For each entry in `targetPaths`, returns an `InstallBackupEntry` describing whether
 * the target originally existed and, when it did, where its backup was written.
 *
 * @param targetPaths - Absolute or relative paths to back up (order preserved; each entry is assigned an index-based subpath under `backupRoot`)
 * @param backupRoot - Directory where per-target backups will be created (each backup is placed at `path.join(backupRoot, String(index))`)
 * @returns An array of `InstallBackupEntry` objects, one per `targetPath`. If a target did not exist the entry has `existed: false`; if it existed the entry includes `backupPath` and `existed: true`. Directory targets are copied recursively (symlinks preserved), and file targets are copied with parent directories created as needed.
 */
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

/**
 * Restores a set of filesystem backups to their original target paths.
 *
 * For each backup entry this removes whatever currently exists at `targetPath` and, if the entry indicates the target originally existed and a `backupPath` is present, restores the backup (recursively copying directories or copying a single file).
 *
 * @param backups - Array of backup entries describing `targetPath`, optional `backupPath`, and whether the target originally existed (`existed`).
 */
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

/**
 * Run an async action with filesystem backups of the given target paths and automatic rollback on failure.
 *
 * Creates a temporary backup of each path in `targetPaths` before invoking `action`. If `action` throws,
 * backups are restored to their original locations and the error is rethrown. The temporary backup directory
 * is removed after the action completes or fails.
 *
 * @param targetPaths - Filesystem paths to back up and restore on failure
 * @param action - Async function to execute while backups are in place; its resolved value is returned
 * @returns The value returned by `action`
 */
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

/**
 * Return the filesystem path corresponding to the specified install target.
 *
 * @param paths - Object containing candidate install paths
 * @param target - Install target name; "agents" maps to `paths.agents`, "claude" maps to `paths.claude`, otherwise `paths.forge`
 * @returns The selected path for the given `target`
 */

function pathForTarget(paths: SkillInstallPaths, target: SkillInstallTarget): string {
  if (target === "agents") return paths.agents;
  if (target === "claude") return paths.claude;
  return paths.forge;
}

/**
 * Selects which external directory should be used as the source when installing into the `forge` target.
 *
 * Prefers the `agents` path if present in `targets`, otherwise uses `claude`.
 *
 * @param paths - Object containing external install paths (`agents`, `claude`, etc.)
 * @param targets - List of installation targets; determines which external path is available
 * @returns The filesystem path to use as the source for copying into `forge`
 * @throws Error if neither `agents` nor `claude` is included in `targets`
 */
function preferredSourcePath(paths: SkillInstallPaths, targets: SkillInstallTarget[]): string {
  if (targets.includes("agents")) return paths.agents;
  if (targets.includes("claude")) return paths.claude;
  throw new Error("forge target requires at least one external target (agents or claude) in v1");
}

/**
 * Compute the filesystem paths that need backup/restore for the given install targets.
 *
 * @param paths - Object containing canonical install paths (including `lockFile`, `forge`, `agents`, `claude`)
 * @param targets - The install targets to include (any subset of `forge`, `agents`, `claude`)
 * @returns An array of filesystem paths to back up or restore; always includes the lock file and also includes each target's path when that target is present in `targets`
 */
function pathsForRollback(paths: SkillInstallPaths, targets: SkillInstallTarget[]): string[] {
  const result: string[] = [paths.lockFile];
  if (targets.includes("forge")) result.push(paths.forge);
  if (targets.includes("agents")) result.push(paths.agents);
  if (targets.includes("claude")) result.push(paths.claude);
  return result;
}

/**
 * Copy a skill directory tree into the destination, creating any missing destination parent directories.
 *
 * Copies `src` to `dst` recursively and preserves symbolic links (does not dereference them).
 *
 * @param src - Source path of the skill directory or file to copy
 * @param dst - Destination path where the source will be copied
 */
function copySkillDirectory(src: string, dst: string): void {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.cpSync(src, dst, { recursive: true, dereference: false });
}

/**
 * Builds an InstalledSkillManifest describing the installed skill and its installation targets.
 *
 * @param input - The install request containing workspace and selected candidate metadata
 * @param paths - Resolved filesystem paths for install targets and related files
 * @param lock - Parsed `skills-lock.json` (if present); when it contains an entry for the candidate, that entry is included in the manifest
 * @param targets - The install targets to record (e.g., `"agents"`, `"claude"`, `"forge"`)
 * @returns An InstalledSkillManifest object containing metadata (packageRef, skillName, candidate/selection IDs, source owner/repo), installTargets, relative external paths, install timestamp, schemaVersion, and an optional `lock` entry when available
 */
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

/**
 * Installs a single audited skill into the configured targets, performing verification and filesystem rollback on failure.
 *
 * Attempts the installation only if the skill's audit verdict is "pass"; creates backups of existing target paths before mutating them, verifies installed content (external targets and optional forge target), writes a forge manifest when applicable, and records per-target and selection status to the database. On any error the function restores backups, marks the install as failed in persistence, and returns a failed result containing the error message.
 *
 * @param input - Installation request containing sessionId, workspace, config (including installTargets), attempt, and the audited skill candidate
 * @param client - Installer client used to copy external/agent content when required
 * @param db - Persistence client used to log per-target installation records and update selection status
 * @returns An InstallAuditedSkillResult describing the outcome: `candidateKey`, `status` ("installed", "skipped", or "failed"), `installPaths`, an array of `verifications`, and an optional `error` message when failed or skipped.
 */

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

/**
 * Install multiple audited skills sequentially, preserving input order and skipping conflicting external skill names.
 *
 * Processes `input.skills` in order; if two skills share the same `skillName` when compared case-insensitively
 * but come from different candidates, the later entry is skipped and recorded with a `"skipped"` status and an
 * error describing the conflict. Each non-conflicting skill is installed in turn and its result is included in
 * the returned array.
 *
 * @param input - Orchestration parameters including `sessionId`, `workspace`, `config`, `attempt`, and the list of audited skills to install.
 * @param client - Installer client used to perform external installs (omitted from detailed param docs).
 * @param db - Database persistence used to log installations and selection updates (omitted from detailed param docs).
 * @returns An array of `InstallAuditedSkillResult` objects in the same order as `input.skills`; skipped conflicts produce entries with `status: "skipped"` and an explanatory `error` message.
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

/**
 * Ensure a set of audited skills are installed into the given workspace.
 *
 * @param workspace - Path to the workspace root where skills will be installed
 * @param skills - Audited skills selected for installation
 * @param config - Installation configuration that controls targets and behavior
 * @param attempt - Numeric attempt identifier used for logging and DB records
 * @param sessionId - Session identifier for this installation operation
 * @returns An array of per-skill installation results in the same order as `skills`
 */
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
