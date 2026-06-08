import * as fs from "node:fs";
import * as path from "node:path";
import type { SkillInstallTarget } from "./types.js";
import { parseSkillMarkdown } from "./bundle.js";
import { resolveInWorkspace } from "./paths.js";

export interface InstalledSkillManifest {
  schemaVersion: 1;
  installedAt: string;
  packageRef: string;
  skillName: string;
  sourceOwner: string;
  sourceRepo: string;
  candidateId: string;
  selectionId: string;
  auditVerdict: "pass";
  installTargets: SkillInstallTarget[];
  externalPaths: Record<string, string>;
  lock?: {
    source?: string;
    sourceType?: string;
    skillPath?: string;
    computedHash?: string;
  };
}

export interface InstalledSkillInventoryEntry {
  packageRef: string;
  skillName: string;
  displayName: string;
  description: string;
  forgePath?: string;
  agentsPath?: string;
  claudePath?: string;
  sourceKey: string;
  installedAt?: string;
  lockHash?: string;
}

/**
 * Persist an InstalledSkillManifest to disk as a pretty-printed `forge-skill.json`.
 *
 * Ensures `dir` exists (created recursively) and writes the manifest encoded as UTF-8
 * with two-space indentation and a trailing newline.
 *
 * @param dir - Filesystem directory where `forge-skill.json` will be written
 * @param manifest - The installed skill manifest to persist
 */
export function writeForgeManifest(dir: string, manifest: InstalledSkillManifest): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "forge-skill.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    "utf8",
  );
}

/**
 * Read and validate a forge skill manifest JSON file from disk.
 *
 * Attempts to parse the JSON at `manifestPath` and ensure required fields are present and valid.
 *
 * @param manifestPath - Filesystem path to a `forge-skill.json` manifest
 * @returns The parsed `InstalledSkillManifest` if valid, `undefined` otherwise
 */
export function readForgeManifest(manifestPath: string): InstalledSkillManifest | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") return undefined;
    const m = parsed as Record<string, unknown>;
    if (m["schemaVersion"] !== 1) return undefined;
    if (typeof m["packageRef"] !== "string") return undefined;
    if (typeof m["skillName"] !== "string") return undefined;
    return parsed as InstalledSkillManifest;
  } catch {
    return undefined;
  }
}

/**
 * Enumerates installed forge skills in a workspace and returns their inventory entries.
 *
 * Scans the workspace's .forge/skills directory, reads each skill's manifest and SKILL.md frontmatter,
 * and builds an inventory entry for each valid installed skill. Entries are sorted by `skillName`.
 *
 * @param workspace - The workspace root directory to scan for installed skills
 * @returns An array of `InstalledSkillInventoryEntry` objects representing each discovered installed skill, sorted by `skillName`
 */
export function listForgeInstalledSkills(workspace: string): InstalledSkillInventoryEntry[] {
  const root = resolveInWorkspace(workspace, path.join(".forge", "skills"));
  if (!fs.existsSync(root)) return [];

  const entries: InstalledSkillInventoryEntry[] = [];
  for (const dirName of fs.readdirSync(root)) {
    const dir = path.join(root, dirName);
    try {
      if (!fs.statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }

    const manifest = readForgeManifest(path.join(dir, "forge-skill.json"));
    const skillFile = path.join(dir, "SKILL.md");
    if (!manifest || !fs.existsSync(skillFile)) continue;

    let parsed: ReturnType<typeof parseSkillMarkdown>;
    try {
      parsed = parseSkillMarkdown(fs.readFileSync(skillFile, "utf8"));
    } catch {
      continue;
    }

    entries.push({
      packageRef: manifest.packageRef,
      skillName: manifest.skillName,
      displayName: parsed.frontmatter.name ?? manifest.skillName,
      description: parsed.frontmatter.description ?? "",
      forgePath: path.relative(workspace, dir),
      agentsPath: manifest.externalPaths["agents"],
      claudePath: manifest.externalPaths["claude"],
      sourceKey: dirName,
      installedAt: manifest.installedAt,
      lockHash: manifest.lock?.computedHash,
    });
  }

  return entries.sort((a, b) => a.skillName.localeCompare(b.skillName));
}

/**
 * Locate an installed skill by package reference and skill name within a workspace.
 *
 * @param workspace - Path to the workspace root that contains the local `.forge/skills` inventory
 * @param packageRef - Package reference to match; comparison is case-insensitive
 * @param skillName - Skill name to match; comparison is case-insensitive
 * @returns The matching `InstalledSkillInventoryEntry` if found, `undefined` otherwise
 */
export function findInstalledSkill(
  workspace: string,
  packageRef: string,
  skillName: string,
): InstalledSkillInventoryEntry | undefined {
  return listForgeInstalledSkills(workspace).find(
    (e) =>
      e.packageRef.toLowerCase() === packageRef.toLowerCase() &&
      e.skillName.toLowerCase() === skillName.toLowerCase(),
  );
}
