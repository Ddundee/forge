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

export function writeForgeManifest(dir: string, manifest: InstalledSkillManifest): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "forge-skill.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    "utf8",
  );
}

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
