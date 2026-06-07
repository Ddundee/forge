import type { SkillCandidate, SkillConfig } from "./types.js";
import type { PlannedSkillQuery, SkillPlanningInput } from "./planner.js";
import { planSkillQueries } from "./planner.js";
import type { RankedSkillCandidate } from "./scoring.js";
import { rankAndSelectSkills, skillKey } from "./scoring.js";

export interface SkillSearchClient {
  find(query: string, workspace: string): Promise<{
    query: string;
    candidates: SkillCandidate[];
    rawOutput: string;
  }>;
}

export interface SkillDiscoveryInput extends SkillPlanningInput {
  sessionId: string;
  workspace: string;
  config: SkillConfig;
  attempt?: number;
}

export interface SkillDiscoveryResult {
  queries: PlannedSkillQuery[];
  ranked: RankedSkillCandidate[];
  selected: RankedSkillCandidate[];
}

interface SkillDiscoveryDb {
  logSkillQuery(sessionId: string, phase: string, query: string, attempt: number, source?: string): string;
  saveSkillCandidate(sessionId: string, queryId: string | undefined, candidate: SkillCandidate): string;
  selectSkill(sessionId: string, selection: {
    candidateId: string;
    status: "selected" | "skipped";
    attempt: number;
    phase: string;
    taskId?: string;
    rationale: string;
  }): string;
  getSkillSelectionKeys(sessionId: string, attempt?: number): string[];
}

export async function discoverSkillCandidates(
  input: SkillDiscoveryInput,
  client: SkillSearchClient,
  db: SkillDiscoveryDb,
): Promise<SkillDiscoveryResult> {
  const attempt = Math.max(1, Math.floor(input.attempt ?? 1));
  const queries = planSkillQueries(input);

  const existing = new Set(db.getSkillSelectionKeys(input.sessionId));

  const pairs: Array<{ candidate: SkillCandidate; query: PlannedSkillQuery; candidateId: string }> = [];

  for (const planned of queries) {
    const queryId = db.logSkillQuery(input.sessionId, planned.phase, planned.query, attempt);
    const result = await client.find(planned.query, input.workspace);
    for (const candidate of result.candidates) {
      const candidateId = db.saveSkillCandidate(input.sessionId, queryId, candidate);
      pairs.push({ candidate, query: planned, candidateId });
    }
  }

  const ranked = rankAndSelectSkills({
    candidates: pairs.map(({ candidate, query }) => ({ candidate, query })),
    config: input.config,
    existingSkillKeys: existing,
  });

  for (const item of ranked) {
    const key = skillKey(item.candidate);
    const pair = pairs.find((p) => skillKey(p.candidate) === key);
    if (!pair) continue;
    db.selectSkill(input.sessionId, {
      candidateId: pair.candidateId,
      status: item.selected ? "selected" : "skipped",
      attempt,
      phase: input.phase,
      rationale: item.selected
        ? `score ${item.score.total.toFixed(3)} from query "${item.query.query}"`
        : item.skipReason ?? `score ${item.score.total.toFixed(3)}`,
    });
  }

  return {
    queries,
    ranked,
    selected: ranked.filter((item) => item.selected),
  };
}
