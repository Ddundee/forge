import type { CompactSkillContextEntry } from "./types.js";

export interface SkillRelevanceInput {
  moment: string;
  agentName: string;
  installed: CompactSkillContextEntry[];
  taskTitle?: string;
  failures?: string[];
  architecture?: string;
  spec?: string;
  text?: string;
  limit: number;
}

function normalizeSearchText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[_\-/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function overlapScore(haystack: string, needle: string): number {
  if (!haystack || !needle) return 0;
  const haystackWords = new Set(haystack.split(/\s+/).filter((w) => w.length > 2));
  const needleWords = needle.split(/\s+/).filter((w) => w.length > 2);
  if (!needleWords.length) return 0;
  let matches = 0;
  for (const word of needleWords) {
    if (haystackWords.has(word)) matches++;
  }
  return matches;
}

export function relevanceScoreForInstalledSkill(
  skill: CompactSkillContextEntry,
  text: string,
  moment: string,
  agentName: string,
): number {
  const haystack = normalizeSearchText(
    [skill.skillName, skill.displayName, skill.description, skill.packageRef].join(" "),
  );
  let score = overlapScore(haystack, text);
  if (agentName === "TestAgent" && /test|jest|vitest|pytest|playwright/.test(haystack)) score += 3;
  if (agentName === "DeployAgent" && /deploy|vercel|railway|fly/.test(haystack)) score += 3;
  if (moment === "post-verification-failure" && /debug|error|fix|test|build/.test(haystack))
    score += 2;
  return score;
}

export function selectRelevantSourceKeys(input: SkillRelevanceInput): string[] {
  const text = normalizeSearchText(
    [
      input.text,
      input.taskTitle,
      (input.failures ?? []).join("\n"),
      input.architecture,
      input.spec,
    ]
      .filter(Boolean)
      .join("\n"),
  );

  return input.installed
    .map((entry) => ({
      sourceKey: entry.sourceKey,
      score: relevanceScoreForInstalledSkill(entry, text, input.moment, input.agentName),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.sourceKey.localeCompare(b.sourceKey))
    .slice(0, input.limit)
    .map((item) => item.sourceKey);
}
