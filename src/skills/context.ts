import * as fs from "node:fs";
import * as path from "node:path";
import type {
  CompactSkillContextEntry,
  RenderedSkillContext,
  SkillContextRequest,
  SkillReadRequest,
  SkillReadResult,
} from "./types.js";
import { listForgeInstalledSkills } from "./inventory.js";
import { resolveInWorkspace } from "./paths.js";
import {
  renderCompactSkillContext,
  renderExternalSkillPrompt,
  renderFullSkillReadResult,
  truncateWithNotice,
} from "./render.js";

/**
 * Resolve a relative path against a base directory and ensure the result remains within that directory.
 *
 * @param rootDir - Base directory to resolve against
 * @param relPath - Relative path to resolve; absolute paths are rejected
 * @returns The resolved absolute path when it is equal to `rootDir` or located under it, `null` if `relPath` is absolute or resolves outside `rootDir`
 */
function resolveInside(rootDir: string, relPath: string): string | null {
  if (path.isAbsolute(relPath)) return null;
  const root = path.resolve(rootDir);
  const resolved = path.resolve(root, relPath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return resolved;
}

/**
 * Compute the effective character cap for a given request mode.
 *
 * @param mode - The request mode which determines a mode-specific ceiling
 *   ("one-shot" → 3000, "codex-cli" or "claude-code" → 4000, otherwise → 8000).
 * @param maxChars - The caller-provided maximum character limit to be enforced.
 * @returns The lesser of `maxChars` and the mode-specific ceiling.
function capFor(mode: SkillContextRequest["mode"], maxChars: number): number {
  if (mode === "one-shot") return Math.min(maxChars, 3_000);
  if (mode === "codex-cli" || mode === "claude-code") return Math.min(maxChars, 4_000);
  return Math.min(maxChars, 8_000);
}

export class SkillContextProvider {
  listCompact(request: SkillContextRequest): CompactSkillContextEntry[] {
    if (request.maxChars <= 0) return [];
    const installed = listForgeInstalledSkills(request.workspace);
    const allowed = request.relevantSourceKeys
      ? new Set(request.relevantSourceKeys)
      : undefined;

    return installed
      .filter((entry) => !!entry.forgePath)
      .filter((entry) => !allowed || allowed.has(entry.sourceKey))
      .filter((entry) => !!request.selectionIdsBySourceKey[entry.sourceKey])
      .map((entry) => ({
        sourceKey: entry.sourceKey,
        selectionId: request.selectionIdsBySourceKey[entry.sourceKey]!,
        packageRef: entry.packageRef,
        skillName: entry.skillName,
        displayName: entry.displayName,
        description: entry.description,
        forgePath: entry.forgePath!,
        agentsPath: entry.agentsPath,
        claudePath: entry.claudePath,
      }));
  }

  renderCompact(request: SkillContextRequest): RenderedSkillContext {
    if (request.maxChars <= 0) {
      return { kind: "compact", content: "", charCount: 0, sourceKeys: [], truncated: false };
    }

    const entries = this.listCompact(request);
    const cap = capFor(request.mode, request.maxChars);

    const raw =
      request.mode === "codex-cli" || request.mode === "claude-code"
        ? renderExternalSkillPrompt(entries, request.mode)
        : renderCompactSkillContext(entries, request);

    const truncated = truncateWithNotice(raw, cap, "compact skill context");
    return {
      kind: "compact",
      content: truncated.content,
      charCount: truncated.content.length,
      sourceKeys: entries.map((e) => e.sourceKey),
      truncated: truncated.truncated,
    };
  }

  readSkill(request: SkillContextRequest, read: SkillReadRequest): SkillReadResult {
    const entry = this.listCompact(request).find((e) => e.sourceKey === read.sourceKey);
    if (!entry) {
      throw new Error(
        `Skill is not installed or not selected for this request: ${read.sourceKey}`,
      );
    }

    const baseDir = resolveInWorkspace(request.workspace, entry.forgePath);
    const relativePath = read.file && read.file.trim() ? read.file : "SKILL.md";
    const filePath = resolveInside(baseDir, relativePath);
    if (!filePath) {
      throw new Error(`Skill file escapes installed skill directory: ${relativePath}`);
    }
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      throw new Error(`Skill file not found: ${relativePath}`);
    }

    const raw = fs.readFileSync(filePath, "utf8");
    const maxChars =
      read.maxChars !== undefined
        ? Math.min(read.maxChars, request.maxChars)
        : Math.min(request.maxChars, 8_000);
    const truncated = truncateWithNotice(raw, maxChars, `skill file ${relativePath}`);
    return {
      sourceKey: read.sourceKey,
      relativePath,
      content: truncated.content,
      charCount: truncated.content.length,
      truncated: truncated.truncated,
    };
  }
}
