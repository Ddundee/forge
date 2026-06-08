import * as path from "node:path";
import type { SkillCandidate, SkillInstallTarget } from "./types.js";

export interface SkillInstallPaths {
  forge: string;
  agents: string;
  claude: string;
  lockFile: string;
}

export function resolveInWorkspace(workspace: string, relativePath: string): string {
  const base = path.resolve(workspace);
  const resolved = path.resolve(workspace, relativePath);
  if (!resolved.startsWith(base + path.sep) && resolved !== base) {
    throw new Error(`Path escapes workspace: ${relativePath}`);
  }
  return resolved;
}

export function safeSkillDirPart(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function forgeSkillDirName(candidate: SkillCandidate): string {
  const safePkg = candidate.packageRef.replace(/\//g, "__");
  return `${safePkg}__${candidate.skillName}`;
}

export function installPaths(workspace: string, candidate: SkillCandidate): SkillInstallPaths {
  return {
    forge: path.join(workspace, ".forge", "skills", forgeSkillDirName(candidate)),
    agents: path.join(workspace, ".agents", "skills", candidate.skillName),
    claude: path.join(workspace, ".claude", "skills", candidate.skillName),
    lockFile: path.join(workspace, "skills-lock.json"),
  };
}

export function cliAgentsForTargets(targets: SkillInstallTarget[]): string[] {
  const agents: string[] = [];
  if (targets.includes("agents")) agents.push("codex");
  if (targets.includes("claude")) agents.push("claude-code");
  return agents;
}
