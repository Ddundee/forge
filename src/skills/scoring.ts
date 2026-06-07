import type { SkillCandidate, SkillConfig } from "./types.js";
import type { PlannedSkillQuery } from "./planner.js";

export interface SkillScoreBreakdown {
  relevance: number;
  sourceReputation: number;
  installPopularity: number;
  phaseFit: number;
  duplicatePenalty: number;
  total: number;
}

export interface SkillCandidateForRanking {
  candidate: SkillCandidate;
  query: PlannedSkillQuery;
  candidateId?: string;
}

export interface RankedSkillCandidate {
  candidate: SkillCandidate;
  query: PlannedSkillQuery;
  candidateId?: string;
  score: SkillScoreBreakdown;
  selected: boolean;
  skipReason?: string;
}

export interface SkillRankingInput {
  candidates: SkillCandidateForRanking[];
  config: SkillConfig;
  existingSkillKeys?: Set<string>;
  maxSkills?: number;
  scoreThreshold?: number;
}

const DEFAULT_SCORE_THRESHOLD = 0.62;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function skillKey(candidate: SkillCandidate): string {
  return `${candidate.packageRef}@${candidate.skillName}`.toLowerCase();
}

const STOP_WORDS = new Set(["a", "an", "and", "for", "of", "the", "to", "with"]);

function words(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .replace(/[-_/]+/g, " ")
    .replace(/[^a-z0-9+#. ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
  return new Set(tokens);
}

function relevanceScore(candidate: SkillCandidate, query: PlannedSkillQuery): number {
  const queryTokens = words(query.query);
  const candidateText = [
    candidate.skillName,
    candidate.title,
    candidate.description,
    candidate.packageRef,
    candidate.url ?? "",
  ].join(" ");
  const candidateTokens = words(candidateText);

  let hits = 0;
  for (const token of queryTokens) {
    if (candidateTokens.has(token)) hits++;
  }
  const overlap = queryTokens.size ? hits / queryTokens.size : 0;
  const slugQuery = query.query.toLowerCase().replace(/\s+/g, "-");
  const exactSlug = candidate.skillName.toLowerCase().includes(slugQuery) ? 0.25 : 0;
  return clamp(overlap + exactSlug, 0, 1);
}

function sourceReputationScore(candidate: SkillCandidate, config: SkillConfig): number {
  const owner = (candidate.packageRef.split("/")[0] ?? "").toLowerCase();
  const source = candidate.packageRef.toLowerCase();
  if (config.trustedSources.map((s) => s.toLowerCase()).includes(owner)) return 1;
  if (config.trustedSources.some((s) => source.startsWith(`${s.toLowerCase()}/`))) return 1;
  if ((candidate.installCount ?? 0) >= 10_000) return 0.75;
  if ((candidate.installCount ?? 0) >= 1_000) return 0.55;
  return 0.25;
}

function installPopularityScore(candidate: SkillCandidate): number {
  const installs = Math.max(0, candidate.installCount ?? 0);
  if (installs === 0) return 0;
  return clamp(Math.log10(installs + 1) / 5, 0, 1);
}

function phaseFitScore(candidate: SkillCandidate, query: PlannedSkillQuery): number {
  const text = `${candidate.skillName} ${candidate.title ?? ""} ${candidate.description ?? ""}`.toLowerCase();
  if (query.phase === "ARCHITECTURE" && /architecture|design|stack|frontend|backend|database/.test(text)) return 1;
  if (query.phase === "CODING" && /react|next|typescript|python|api|frontend|backend|database/.test(text)) return 0.85;
  if (query.phase === "TESTING" && /test|testing|playwright|jest|vitest|pytest/.test(text)) return 1;
  if (query.phase === "VERIFICATION" && /debug|troubleshoot|build|test|deploy|verify/.test(text)) return 1;
  if (query.phase === "DEPLOY" && /deploy|vercel|railway|fly|ci/.test(text)) return 1;
  return 0.5;
}

export function scoreSkillCandidate(
  candidate: SkillCandidate,
  query: PlannedSkillQuery,
  config: SkillConfig,
  existingSkillKeys: Set<string> = new Set(),
): SkillScoreBreakdown {
  const relevance = relevanceScore(candidate, query);
  const sourceReputation = sourceReputationScore(candidate, config);
  const installPopularity = installPopularityScore(candidate);
  const phaseFit = phaseFitScore(candidate, query);
  const duplicatePenalty = existingSkillKeys.has(skillKey(candidate)) ? 1 : 0;

  const total = clamp(
    relevance * 0.35 +
    sourceReputation * 0.25 +
    installPopularity * 0.20 +
    phaseFit * 0.15 +
    query.weight * 0.05 -
    duplicatePenalty * 0.75,
    0,
    1,
  );

  return { relevance, sourceReputation, installPopularity, phaseFit, duplicatePenalty, total };
}

export function rankAndSelectSkills(input: SkillRankingInput): RankedSkillCandidate[] {
  const maxSkills = input.maxSkills ?? input.config.maxSkills;
  const threshold = input.scoreThreshold ?? DEFAULT_SCORE_THRESHOLD;
  const seen = new Set<string>();

  const ranked: RankedSkillCandidate[] = input.candidates
    .map(({ candidate, query, candidateId }) => ({
      candidate,
      query,
      candidateId,
      score: scoreSkillCandidate(candidate, query, input.config, input.existingSkillKeys),
      selected: false,
    }))
    .sort((a, b) => b.score.total - a.score.total);

  let selectedCount = 0;
  for (const item of ranked) {
    const key = skillKey(item.candidate);

    if (seen.has(key)) {
      item.skipReason = "duplicate candidate";
      continue;
    }
    seen.add(key);

    if ((item.candidate.installCount ?? 0) < input.config.minInstallCount && item.score.sourceReputation < 1) {
      item.skipReason = `install count below ${input.config.minInstallCount}`;
      continue;
    }

    if (item.score.total < threshold) {
      item.skipReason = `score below threshold ${threshold}`;
      continue;
    }

    if (selectedCount >= maxSkills) {
      item.skipReason = `max skills ${maxSkills} reached`;
      continue;
    }

    item.selected = true;
    selectedCount++;
  }

  return ranked;
}
