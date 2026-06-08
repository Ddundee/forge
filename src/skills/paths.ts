import * as path from "node:path";
import type { SkillCandidate, SkillInstallTarget } from "./types.js";

export interface SkillInstallPaths {
  forge: string;
  agents: string;
  claude: string;
  lockFile: string;
}

/**
 * Resolve a user-provided path against a workspace and ensure it does not escape the workspace root.
 *
 * @param workspace - The workspace root directory used as the base for resolution
 * @param relativePath - A path (absolute or relative) to resolve inside the workspace
 * @returns The absolute path resolved within `workspace`
 * @throws Error if the resolved path is located outside of `workspace`
 */
export function resolveInWorkspace(workspace: string, relativePath: string): string {
  const base = path.resolve(workspace);
  const resolved = path.resolve(workspace, relativePath);
  if (!resolved.startsWith(base + path.sep) && resolved !== base) {
    throw new Error(`Path escapes workspace: ${relativePath}`);
  }
  return resolved;
}

/**
 * Converts arbitrary text into a filesystem-safe directory-name fragment.
 *
 * @param text - The input string to normalize.
 * @returns The normalized, lowercased string containing only ASCII letters and digits separated by single hyphens, with no leading or trailing hyphens.
 */
export function safeSkillDirPart(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Produces a filesystem-safe directory name for a forge skill candidate.
 *
 * @param candidate - Object with `packageRef` (package identifier, e.g., "owner/package") and `skillName`
 * @returns The directory name formed by replacing `/` in `packageRef` with `__` and joining it to `skillName` with `__` (for example: `owner__package__skillName`)
 */
export function forgeSkillDirName(candidate: SkillCandidate): string {
  const safePkg = candidate.packageRef.replace(/\//g, "__");
  return `${safePkg}__${candidate.skillName}`;
}

/**
 * Compute standard installation directories and the shared lockfile path for a skill candidate inside a workspace.
 *
 * @param workspace - Root workspace directory used as the base for constructed paths
 * @param candidate - Skill candidate whose names are used to derive per-agent and forge directory names
 * @returns A `SkillInstallPaths` object with:
 *  - `forge` — path to the forge-specific skill directory
 *  - `agents` — path to the agents skill directory
 *  - `claude` — path to the claude skill directory
 *  - `lockFile` — path to the shared `skills-lock.json`
 */
export function installPaths(workspace: string, candidate: SkillCandidate): SkillInstallPaths {
  return {
    forge: path.join(workspace, ".forge", "skills", forgeSkillDirName(candidate)),
    agents: path.join(workspace, ".agents", "skills", candidate.skillName),
    claude: path.join(workspace, ".claude", "skills", candidate.skillName),
    lockFile: path.join(workspace, "skills-lock.json"),
  };
}

/**
 * Maps requested install targets to the corresponding CLI agent identifiers.
 *
 * @param targets - Array of install targets (e.g., `"agents"`, `"claude"`) to map
 * @returns An array of CLI agent identifiers: includes `"codex"` if `targets` contains `"agents"`, and includes `"claude-code"` if `targets` contains `"claude"`
 */
export function cliAgentsForTargets(targets: SkillInstallTarget[]): string[] {
  const agents: string[] = [];
  if (targets.includes("agents")) agents.push("codex");
  if (targets.includes("claude")) agents.push("claude-code");
  return agents;
}
