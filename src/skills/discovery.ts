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
  attempt: number;
  maxCandidatesPerQuery?: number;
  scoreThreshold?: number;
}

export interface SkillDiscoveryFailure {
  query: PlannedSkillQuery;
  message: string;
  recoverable: boolean;
}

export interface SkillDiscoveryResult {
  queries: PlannedSkillQuery[];
  ranked: RankedSkillCandidate[];
  selected: RankedSkillCandidate[];
  failures: SkillDiscoveryFailure[];
}

export interface SkillDiscoveryDb {
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

const DEFAULT_MAX_CANDIDATES_PER_QUERY = 6;

export async function discoverSkillCandidates(
  input: SkillDiscoveryInput,
  client: SkillSearchClient,
  db: SkillDiscoveryDb,
): Promise<SkillDiscoveryResult> {
  const attempt = input.attempt;
  const maxCandidatesPerQuery = input.maxCandidatesPerQuery ?? DEFAULT_MAX_CANDIDATES_PER_QUERY;
  const queries = planSkillQueries(input);

  const existing = new Set(db.getSkillSelectionKeys(input.sessionId));

  const pairs: Array<{ candidate: SkillCandidate; query: PlannedSkillQuery; candidateId: string }> = [];
  const failures: SkillDiscoveryFailure[] = [];

  // Searches are independent CLI calls — run them concurrently and process
  // results in planned order so ranking stays deterministic.
  interface SearchOutcome {
    planned: PlannedSkillQuery;
    queryId: string;
    result?: { query: string; candidates: SkillCandidate[]; rawOutput: string };
    error?: unknown;
  }
  const searches: SearchOutcome[] = await Promise.all(
    queries.map(async (planned): Promise<SearchOutcome> => {
      const queryId = db.logSkillQuery(input.sessionId, planned.phase, planned.query, attempt);
      try {
        return { planned, queryId, result: await client.find(planned.query, input.workspace) };
      } catch (err) {
        return { planned, queryId, error: err };
      }
    }),
  );

  for (const search of searches) {
    if (search.error !== undefined || !search.result) {
      failures.push({
        query: search.planned,
        message: search.error instanceof Error ? search.error.message : String(search.error),
        recoverable: true,
      });
      continue;
    }
    for (const candidate of search.result.candidates.slice(0, maxCandidatesPerQuery)) {
      const candidateId = db.saveSkillCandidate(input.sessionId, search.queryId, candidate);
      pairs.push({ candidate, query: search.planned, candidateId });
    }
  }

  const ranked = rankAndSelectSkills({
    candidates: pairs.map(({ candidate, query, candidateId }) => ({ candidate, query, candidateId })),
    config: input.config,
    existingSkillKeys: existing,
    scoreThreshold: input.scoreThreshold,
  });

  for (const item of ranked) {
    if (!item.candidateId) continue;
    db.selectSkill(input.sessionId, {
      candidateId: item.candidateId,
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
    failures,
  };
}
