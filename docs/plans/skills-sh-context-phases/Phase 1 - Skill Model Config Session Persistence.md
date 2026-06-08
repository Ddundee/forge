---
title: Phase 1 - Skill Model Config Session Persistence
aliases:
  - Skills.sh Context Phase 1
  - Phase 1 Skill State Model
tags:
  - forgecli/skills-sh-context
  - forgecli/planning/phase
  - status/ready
status: ready
phase: 1
research_gate: closed
parent: "[[Skills.sh Context System Master Plan]]"
next_action: "Implement the Phase 1 source corrections from this note: revised skill types, strict config normalization, attempt-aware DB helpers, join-backed selection keys, indexes, and session config snapshots."
created: 2026-06-06
updated: 2026-06-07
---

# Phase 1 - Skill Model Config Session Persistence

> [!warning] Scope Boundary
> Phase 1 defines durable types, config, and session persistence only. It must not call `npx skills`, install skills, score candidates, audit skill content, inject prompt context, or change agent behavior.

> [!abstract] Outcome
> At the end of Phase 1, Forge has a typed skill domain model, TOML-backed user skill preferences, SQLite tables/methods for skill lifecycle audit records, and session config snapshots that future phases can rely on.

> [!important] Implementation Status
> This note is complete as the Phase 1 implementation contract. The branch code is not yet complete against this contract; the source audit below lists the exact corrections still required before Phase 1 can be considered implemented.

## Research Questions

- What current Forge files own config, session creation, and session storage?
- How does config currently serialize and deserialize TOML?
- Does `smol-toml` support the nested `[skills]` table shape planned for skill preferences?
- What SQLite patterns already exist in `ForgeDb`?
- Where should Phase 1 persist user defaults versus per-session skill state?
- How should resume behave before discovery and prompt-injection phases exist?

## Researched Facts

### Evidence: Current Branch And Dirty State

Command:

```bash
git status --short --branch
```

Observed:

```text
## feature/skills-sh-context
?? .env
?? docs/plans/2026-06-06-skills-sh-context.md
?? "docs/plans/Skills.sh Context System Phases.base"
?? docs/plans/skills-sh-context-phases/
?? pyproject.toml
?? tests/test_cli.py
```

Interpretation:

- Work is already on `feature/skills-sh-context`.
- Phase docs are untracked.
- `.env`, `pyproject.toml`, and `tests/test_cli.py` are unrelated untracked files and must not be staged or changed by Phase 1.

### Evidence: Current Config Model

Files inspected:

- `src/config.ts`
- `tests/config.test.ts`

Current behavior:

- `ForgeConfig` is a class with positional constructor fields:
  - `profile`
  - `models`
  - `maxCycles`
  - `priority`
  - `autoOverseer`
- `loadConfig()` maps TOML keys into the constructor.
- `saveConfig()` writes a TOML object with snake_case persisted keys where needed:
  - `max_cycles`
  - `auto_overseer`
- Tests already verify defaults, constructor behavior, and load/save round trips.

Plan impact:

- Skill settings should be added as a nested field on `ForgeConfig`, with helper defaults so old TOML files still load.
- Tests should follow the existing `config.test.ts` pattern.

### Evidence: Nested TOML Support

Command:

```bash
node -e "import('smol-toml').then(({stringify}) => console.log(stringify({ profile: 'claude-primary', skills: { mode: 'auto', max: 4, trusted_sources: ['vercel-labs', 'anthropics'] } })))"
```

Observed:

```toml
profile = "claude-primary"

[skills]
mode = "auto"
max = 4
trusted_sources = [ "vercel-labs", "anthropics" ]
```

Interpretation:

- `smol-toml` supports the nested `[skills]` table needed for skill preferences.
- Phase 1 can use a nested `skills` TOML table without adding another config file.

### Evidence: Current DB Model

Files inspected:

- `src/db.ts`
- `tests/db.test.ts`

Current schema:

- `sessions`
- `tasks`
- `artifacts`
- `llm_calls`
- `events`
- `tool_calls`

Current DB patterns:

- `SCHEMA` is a SQL string executed from the `ForgeDb` constructor.
- New tables can be added through `CREATE TABLE IF NOT EXISTS`.
- IDs use the private `uid()` helper.
- Dates use the private `now()` helper.
- Complex values are serialized with `jsonValue()`.
- Public methods return `Record<string, unknown>` rows rather than strict row classes.

Plan impact:

- Phase 1 should add skill tables to `SCHEMA`.
- DB methods should follow existing style: simple inserts, JSON text fields, `Record<string, unknown>[]` reads.
- No migration runner is needed for new tables because `CREATE TABLE IF NOT EXISTS` is already the project pattern.

### Evidence: Current Session Model

Files inspected:

- `src/session.ts`
- `tests/session.test.ts`

Current behavior:

- `Session.create()` loads current config with `loadConfig()`.
- `Session.create()` creates a session DB row with `db.createSession(idea, id)`.
- `sessions.config_json` exists but currently receives the default `"{}"` in normal session creation.
- `Session.load()` loads current config again with `loadConfig()`, then reads the session row.
- Existing resume behavior uses the current global config for runtime model routing.

Plan impact:

- Phase 1 should start storing a config snapshot in `sessions.config_json`.
- To avoid broad behavioral changes, Phase 1 should not replace current model-routing behavior on resume.
- Skill-specific future phases should read session-scoped skill state from skill tables, not from current global config.

## State Ownership Decision

| State | Owner | Reason |
|---|---|---|
| User skill defaults | `~/.forge/config.toml` through `ForgeConfig.skills` | User-level preferences belong with existing Forge setup/config |
| Effective config at session start | `sessions.config_json` | Needed for auditability and reproducible reasoning |
| Search queries | SQLite skill query table | Must be visible in session history and explainable later |
| Discovered candidates | SQLite skill candidate table | Needed for scoring, audit, and explanation |
| Audit verdicts | SQLite skill audit table | Security decisions must be durable |
| Selected skills | SQLite skill selection table | Resume must know what was selected before |
| Install attempts | SQLite skill installation table | Future install failures need auditability |
| Prompt/context injection records | SQLite skill injection table | Needed to explain which agent received which skill context |
| Installed skill files | Generated workspace | Actual skill content belongs with the project that used it |

> [!important] Resume Policy
> Phase 1 persists enough state for future resume behavior, but does not yet change runtime skill behavior. Skill query, selection, installation, and injection rows carry a required integer `attempt` number so future phases can distinguish the original run from resume attempts without inferring from `created_at` ordering. Future phases must reuse the latest valid selected/audited skill rows on resume instead of re-searching by default.

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/skills/types.ts` | Create or revise | Shared TypeScript domain model for config, candidates, audit, selection, install, and injection |
| `src/config.ts` | Modify or revise | Add `SkillConfig`, defaults, load/save TOML support, and config serialization |
| `src/db.ts` | Modify or revise | Add skill lifecycle tables and CRUD/logging helpers |
| `src/session.ts` | Modify or verify | Store a full config snapshot in `sessions.config_json` during session creation |
| `tests/config.test.ts` | Modify or revise | Cover skill config defaults and TOML round trip |
| `tests/db.test.ts` | Modify or revise | Cover skill lifecycle persistence helpers |
| `tests/session.test.ts` | Modify or verify | Cover session config snapshot persistence |
| `docs/plans/skills-sh-context-phases/Phase 1 - Skill Model Config Session Persistence.md` | Maintain | This implementation-ready plan |

## Public Interfaces

### `src/skills/types.ts`

Create a new module that owns feature-specific types without importing runtime services.

```typescript
export type SkillMode = "off" | "auto";

export type SkillInstallTarget = "forge" | "agents" | "claude";

export interface SkillConfig {
  mode: SkillMode;
  maxSkills: number;
  promptCharBudget: number;
  minInstallCount: number;
  trustedSources: string[];
  installTargets: SkillInstallTarget[];
}

export interface SkillCandidate {
  packageRef: string;
  skillName: string;
  title?: string;
  description?: string;
  url?: string;
  installCount?: number;
  score?: number;
  raw?: unknown;
}

export type SkillAuditVerdict = "pass" | "warn" | "fail";

export interface SkillAuditResult {
  verdict: SkillAuditVerdict;
  reasons: string[];
}

export type SkillSelectionStatus =
  | "selected"
  | "skipped";

export interface SkillSelection {
  candidateId: string;
  status: SkillSelectionStatus;
  phase: string;
  attempt: number;
  taskId?: string;
  rationale: string;
}

export interface SkillInstallRecord {
  selectionId: string;
  attempt: number;
  target: SkillInstallTarget;
  installPath: string;
  status: "installed" | "failed";
  error?: string;
}

export interface SkillInjectionRecord {
  selectionId: string;
  attempt: number;
  agentName: string;
  taskId?: string;
  contextKind: "compact" | "full";
  charCount: number;
}
```

Notes:

- Keep `SkillMode` to `"off" | "auto"` for v1. Interactive approval can be added later.
- Keep `SkillSelectionStatus` scoped to selection decisions. Installation outcomes belong only to `SkillInstallRecord`.
- Make `attempt` required on query logging, selection, install, and injection records. Silent defaulting to attempt `1` makes resume rows indistinguishable from original-run rows.
- Do not add a typed query row interface until a caller needs one. Phase 1 DB helpers can return IDs and simple record rows.
- Store `source` as a DB string with default `"skills-cli"`, not as a narrow TypeScript literal, so later API/local sources can be added without changing the Phase 1 type model.
- Keep the candidate type intentionally loose. Phase 2 owns the final `npx skills find` parser shape.
- Avoid importing `ForgeDb`, `Session`, or router types from this file.

### `src/config.ts`

Add defaults and a nested config object.

```typescript
import type { SkillConfig } from "./skills/types.js";

export const DEFAULT_SKILL_CONFIG: SkillConfig = {
  mode: "off",
  maxSkills: 3,
  promptCharBudget: 12_000,
  minInstallCount: 100,
  trustedSources: ["vercel-labs", "anthropics", "openai", "microsoft"],
  installTargets: ["forge", "agents"],
};

function normalizeSkillConfig(value: unknown): SkillConfig {
  const data = (value && typeof value === "object") ? value as Record<string, unknown> : {};
  const nonNegativeNumber = (raw: unknown, fallback: number): number => {
    const parsed = Number(raw ?? fallback);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
  };
  const installTargets = Array.isArray(data["install_targets"])
    ? data["install_targets"].map(String).filter((v): v is SkillConfig["installTargets"][number] =>
        v === "forge" || v === "agents" || v === "claude"
      )
    : DEFAULT_SKILL_CONFIG.installTargets;

  return {
    mode: data["mode"] === "auto" ? "auto" : "off",
    maxSkills: nonNegativeNumber(data["max_skills"], DEFAULT_SKILL_CONFIG.maxSkills),
    promptCharBudget: nonNegativeNumber(data["prompt_char_budget"], DEFAULT_SKILL_CONFIG.promptCharBudget),
    minInstallCount: nonNegativeNumber(data["min_install_count"], DEFAULT_SKILL_CONFIG.minInstallCount),
    trustedSources: Array.isArray(data["trusted_sources"])
      ? data["trusted_sources"].map(String).filter(Boolean)
      : DEFAULT_SKILL_CONFIG.trustedSources,
    installTargets: installTargets.length > 0 ? installTargets : DEFAULT_SKILL_CONFIG.installTargets,
  };
}
```

Config notes:

- `anthropics` is intentional. The official Anthropic GitHub organization and skills.sh owner are `anthropics`, including `anthropics/skills`.
- `normalizeSkillConfig()` reads persisted TOML keys only. TypeScript callers that already have camelCase values should construct `SkillConfig` directly instead of round-tripping through TOML normalization.
- If a numeric value is missing or invalid, default back to `DEFAULT_SKILL_CONFIG` rather than storing `NaN`.
- If all configured install targets are invalid, fall back to `DEFAULT_SKILL_CONFIG.installTargets`; an empty install target list would make later install phases silently do nothing.

Update the constructor by adding `skills` last so older call sites remain valid:

```typescript
export class ForgeConfig {
  constructor(
    public profile = "claude-primary",
    public models: Record<string, string> = {},
    public maxCycles = 5,
    public priority: "quality" | "speed" | "cost" = "quality",
    public autoOverseer = "",
    public skills: SkillConfig = DEFAULT_SKILL_CONFIG,
  ) {}

  toJson(): Record<string, unknown> {
    return {
      profile: this.profile,
      models: this.models,
      max_cycles: this.maxCycles,
      priority: this.priority,
      auto_overseer: this.autoOverseer,
      skills: {
        mode: this.skills.mode,
        max_skills: this.skills.maxSkills,
        prompt_char_budget: this.skills.promptCharBudget,
        min_install_count: this.skills.minInstallCount,
        trusted_sources: this.skills.trustedSources,
        install_targets: this.skills.installTargets,
      },
    };
  }
}
```

Load config:

```typescript
export function loadConfig(configFile = CONFIG_FILE): ForgeConfig {
  if (!fs.existsSync(configFile)) return new ForgeConfig();
  const data = parseToml(fs.readFileSync(configFile, "utf8")) as any;
  return new ForgeConfig(
    data.profile ?? "claude-primary",
    data.models ?? {},
    data.max_cycles ?? 5,
    (data.priority as "quality" | "speed" | "cost") ?? "quality",
    data.auto_overseer ?? "",
    normalizeSkillConfig(data.skills),
  );
}
```

Save config:

```typescript
export function saveConfig(cfg: ForgeConfig, configFile = CONFIG_FILE): void {
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  fs.writeFileSync(configFile, stringifyToml(cfg.toJson()));
}
```

Expected TOML shape:

```toml
profile = "claude-primary"
max_cycles = 5
priority = "quality"
auto_overseer = ""

[models]

[skills]
mode = "off"
max_skills = 3
prompt_char_budget = 12000
min_install_count = 100
trusted_sources = [ "vercel-labs", "anthropics", "openai", "microsoft" ]
install_targets = [ "forge", "agents" ]
```

### `src/db.ts`

Extend `SCHEMA` with skill lifecycle tables.

Candidate persistence stays deliberately loose in Phase 1. Store the stable identity fields, optional display metadata, optional score/install count, and raw upstream payload. Do not bake `source_owner` or `source_repo` into the schema before Phase 2 finishes the adapter/parser research; later phases can derive owner/repo from `package_ref` or add a migration if upstream output proves stable.

```sql
CREATE TABLE IF NOT EXISTS skill_queries (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    attempt INTEGER NOT NULL DEFAULT 1,
    phase TEXT NOT NULL,
    query TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'skills-cli',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skill_candidates (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    query_id TEXT REFERENCES skill_queries(id),
    package_ref TEXT NOT NULL,
    skill_name TEXT NOT NULL,
    title TEXT,
    description TEXT,
    url TEXT,
    install_count INTEGER,
    score REAL,
    raw_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skill_audits (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    candidate_id TEXT NOT NULL REFERENCES skill_candidates(id),
    verdict TEXT NOT NULL,
    reasons_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skill_selections (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    candidate_id TEXT NOT NULL REFERENCES skill_candidates(id),
    status TEXT NOT NULL,
    attempt INTEGER NOT NULL DEFAULT 1,
    phase TEXT NOT NULL,
    task_id TEXT REFERENCES tasks(id),
    rationale TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skill_installations (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    selection_id TEXT NOT NULL REFERENCES skill_selections(id),
    attempt INTEGER NOT NULL,
    target TEXT NOT NULL,
    install_path TEXT NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skill_injections (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    selection_id TEXT NOT NULL REFERENCES skill_selections(id),
    attempt INTEGER NOT NULL,
    task_id TEXT REFERENCES tasks(id),
    agent_name TEXT NOT NULL,
    context_kind TEXT NOT NULL,
    char_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_skill_queries_session ON skill_queries(session_id, attempt, created_at);
CREATE INDEX IF NOT EXISTS idx_skill_candidates_session ON skill_candidates(session_id, query_id, created_at);
CREATE INDEX IF NOT EXISTS idx_skill_audits_session ON skill_audits(session_id, candidate_id, created_at);
CREATE INDEX IF NOT EXISTS idx_skill_selections_session ON skill_selections(session_id, attempt, candidate_id, created_at);
CREATE INDEX IF NOT EXISTS idx_skill_installations_session ON skill_installations(session_id, attempt, selection_id, created_at);
CREATE INDEX IF NOT EXISTS idx_skill_injections_session ON skill_injections(session_id, attempt, selection_id, created_at);
```

Add public helper methods:

```typescript
logSkillQuery(sessionId: string, phase: string, query: string, attempt: number, source?: string): string
saveSkillCandidate(sessionId: string, queryId: string | undefined, candidate: SkillCandidate): string
logSkillAudit(sessionId: string, candidateId: string, audit: Pick<SkillAuditResult, "verdict" | "reasons">): string
selectSkill(sessionId: string, selection: SkillSelection): string
logSkillInstallation(sessionId: string, install: SkillInstallRecord): string
logSkillInjection(sessionId: string, injection: SkillInjectionRecord): string
getSkillQueries(sessionId: string, attempt?: number): Record<string, unknown>[]
getSkillCandidates(sessionId: string): Record<string, unknown>[]
getSkillSelections(sessionId: string): Record<string, unknown>[]
getSkillSelectionKeys(sessionId: string, attempt?: number): string[]
getSkillAuditTrail(sessionId: string): Record<string, unknown>[]
```

Implementation style:

```typescript
logSkillQuery(
  sessionId: string,
  phase: string,
  query: string,
  attempt: number,
  source = "skills-cli",
): string {
  const id = uid();
  const normalizedAttempt = Math.max(1, Math.floor(attempt));
  this.db.prepare(
    "INSERT INTO skill_queries (id, session_id, attempt, phase, query, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(...bindValues([id, sessionId, normalizedAttempt, phase, query, source, now()]));
  return id;
}
```

Query read style:

```typescript
getSkillQueries(sessionId: string, attempt?: number): Record<string, unknown>[] {
  if (attempt !== undefined) {
    return this.db.prepare(
      "SELECT * FROM skill_queries WHERE session_id = ? AND attempt = ? ORDER BY created_at"
    ).all(sessionId, Math.max(1, Math.floor(attempt))) as any[];
  }

  return this.db.prepare(
    "SELECT * FROM skill_queries WHERE session_id = ? ORDER BY attempt, created_at"
  ).all(sessionId) as any[];
}
```

Selection key read style:

```typescript
getSkillSelectionKeys(sessionId: string, attempt?: number): string[] {
  const rows = attempt !== undefined
    ? this.db.prepare(
        "SELECT sc.package_ref, sc.skill_name " +
        "FROM skill_selections ss " +
        "JOIN skill_candidates sc ON sc.id = ss.candidate_id AND sc.session_id = ss.session_id " +
        "WHERE ss.session_id = ? AND ss.status = 'selected' AND ss.attempt = ? " +
        "ORDER BY ss.created_at"
      ).all(sessionId, Math.max(1, Math.floor(attempt))) as any[]
    : this.db.prepare(
        "SELECT sc.package_ref, sc.skill_name " +
        "FROM skill_selections ss " +
        "JOIN skill_candidates sc ON sc.id = ss.candidate_id AND sc.session_id = ss.session_id " +
        "WHERE ss.session_id = ? AND ss.status = 'selected' " +
        "ORDER BY ss.attempt, ss.created_at"
      ).all(sessionId) as any[];

  return rows.map((row) => `${row.package_ref}@${row.skill_name}`.toLowerCase());
}
```

Selection key notes:

- Return selected rows only. Skipped rows remain available through `getSkillSelections()` for audit/history, but they must not block future attempts from reconsidering a skill.
- Return exact `packageRef@skillName` keys so Phase 3 can share the same `skillKey(candidate)` format.
- Keep the optional `attempt` filter for diagnostics and future CLI history views; default resume dedupe should consider selected rows from the whole session.

Candidate insert style:

```typescript
saveSkillCandidate(sessionId: string, queryId: string | undefined, candidate: SkillCandidate): string {
  const id = uid();
  this.db.prepare(
    "INSERT INTO skill_candidates " +
    "(id, session_id, query_id, package_ref, skill_name, title, description, url, install_count, score, raw_json, created_at) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(...bindValues([
    id,
    sessionId,
    queryId ?? null,
    candidate.packageRef,
    candidate.skillName,
    candidate.title ?? null,
    candidate.description ?? null,
    candidate.url ?? null,
    candidate.installCount ?? null,
    candidate.score ?? null,
    jsonValue(candidate.raw ?? {}),
    now(),
  ]));
  return id;
}
```

Selection insert style:

```typescript
selectSkill(sessionId: string, selection: SkillSelection): string {
  const id = uid();
  const attempt = Math.max(1, Math.floor(selection.attempt));
  this.db.prepare(
    "INSERT INTO skill_selections (id, session_id, candidate_id, status, attempt, phase, task_id, rationale, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(...bindValues([
    id,
    sessionId,
    selection.candidateId,
    selection.status,
    attempt,
    selection.phase,
    selection.taskId ?? null,
    selection.rationale,
    now(),
  ]));
  return id;
}
```

Install and injection insert style:

```typescript
logSkillInstallation(sessionId: string, install: SkillInstallRecord): string {
  const id = uid();
  const attempt = Math.max(1, Math.floor(install.attempt));
  this.db.prepare(
    "INSERT INTO skill_installations (id, session_id, selection_id, attempt, target, install_path, status, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(...bindValues([
    id,
    sessionId,
    install.selectionId,
    attempt,
    install.target,
    install.installPath,
    install.status,
    install.error ?? null,
    now(),
  ]));
  return id;
}

logSkillInjection(sessionId: string, injection: SkillInjectionRecord): string {
  const id = uid();
  const attempt = Math.max(1, Math.floor(injection.attempt));
  this.db.prepare(
    "INSERT INTO skill_injections (id, session_id, selection_id, attempt, task_id, agent_name, context_kind, char_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(...bindValues([
    id,
    sessionId,
    injection.selectionId,
    attempt,
    injection.taskId ?? null,
    injection.agentName,
    injection.contextKind,
    injection.charCount,
    now(),
  ]));
  return id;
}
```

### `src/session.ts`

Store the config snapshot during session creation.

Current:

```typescript
db.createSession(idea, id);
```

Planned:

```typescript
db.createSession(idea, id, JSON.stringify(cfg.toJson()));
```

Do not change model-routing behavior in Phase 1:

- `Session.create()` should still construct `LLMRouter(cfg.tierModels(), catalog)`.
- `Session.load()` should still load current config as it does today.
- Future skill phases may read `config_json` for skill-specific resume decisions.

## Review Amendments Applied To This Plan

- Added required explicit `attempt` tracking to `skill_queries`, `skill_selections`, `skill_installations`, and `skill_injections` so resume behavior does not rely on `created_at` ordering.
- Removed `"installed"` and `"failed"` from `SkillSelectionStatus`; install outcomes belong only to `SkillInstallRecord`.
- Removed `checkedAt` from `SkillAuditResult`; persisted timestamps belong to DB rows.
- Removed the typed `SkillQueryRecord` from Phase 1 until a caller needs a typed query row.
- Kept `anthropics` as a trusted source and documented why the plural owner is intentional.
- Simplified `normalizeSkillConfig()` to read persisted TOML snake_case keys only.
- Added fallback behavior when configured install targets filter down to an empty array.
- Loosened `skill_candidates` so Phase 2 can define stable parser fields after researching real `npx skills find` output.
- Added session-scoped indexes for skill lifecycle tables.
- Added `getSkillSelectionKeys(sessionId, attempt?)` so Phase 3 can dedupe selected skills through a joined candidate identity read instead of raw selection rows.
- Changed the query persistence test to use `getSkillQueries()` instead of relying on `getSkillAuditTrail()`, and added an attempt-specific query test.

## Current Source Audit

Checked on 2026-06-07 against the current branch:

| Area | Current Branch State | Required Correction |
|---|---|---|
| `src/skills/types.ts` | Still has `SkillQueryRecord`, required `sourceOwner`/`sourceRepo`, required `title`/`description`, `SkillAuditResult.checkedAt`, selection statuses `"installed"`/`"failed"`, and missing `attempt` on selection/install/injection records | Replace with the exact type contract in this note |
| `src/config.ts` | `normalizeSkillConfig()` still accepts camelCase keys, invalid numbers can become `NaN`, and all-invalid `install_targets` can normalize to `[]` | Read persisted snake_case TOML keys, guard numeric parsing with `Number.isFinite`, and fall back to default install targets when the filtered list is empty |
| `src/db.ts` | Skill tables exist but lack `attempt` on queries/selections/installations/injections, still require `source_owner`/`source_repo`, lack session indexes, lack `getSkillQueries()`, and lack `getSkillSelectionKeys()` | Replace schema and helpers with the Phase 1 DB contract below |
| `src/session.ts` | `Session.create()` already stores `JSON.stringify(cfg.toJson())` in `sessions.config_json` and leaves resume model routing unchanged | Verify with tests; no redesign needed |
| Tests | Existing tests do not yet cover the revised attempt, loose candidate, fallback, index, and selection-key contracts | Add or revise the tests listed below |

This audit means Phase 1 is complete as a plan, not complete as implemented code.

## Implementation Tasks

### Task 1.1 - Add Skill Domain Types

Files:

- Create or revise `src/skills/types.ts`

Steps:

- [x] Create `src/skills/`.
- [ ] Replace the stale type definitions with the exact Phase 1 contract above.
- [ ] Remove `SkillQueryRecord`.
- [ ] Remove required `sourceOwner` and `sourceRepo` fields from `SkillCandidate`.
- [ ] Make `SkillCandidate.title` and `SkillCandidate.description` optional.
- [ ] Remove `checkedAt` from `SkillAuditResult`.
- [ ] Keep `SkillSelectionStatus` to `"selected" | "skipped"`.
- [ ] Add required `attempt` to selection, installation, and injection records.
- [x] Keep this file dependency-light. It should not import config, DB, agents, router, or session code.

Acceptance:

```bash
npm run build
```

Expected:

```text
# no TypeScript errors from src/skills/types.ts
```

### Task 1.2 - Add Skill Config Defaults And TOML Round Trip

Files:

- Modify `src/config.ts`
- Modify `tests/config.test.ts`

Tests to add first:

```typescript
test("ForgeConfig defaults skills config to off", () => {
  const cfg = new ForgeConfig();
  expect(cfg.skills.mode).toBe("off");
  expect(cfg.skills.maxSkills).toBe(3);
  expect(cfg.skills.promptCharBudget).toBe(12000);
  expect(cfg.skills.minInstallCount).toBe(100);
  expect(cfg.skills.trustedSources).toContain("vercel-labs");
  expect(cfg.skills.installTargets).toContain("forge");
});

test("saveConfig and loadConfig round-trips skills config", () => {
  const configFile = path.join(tmpDir, "config.toml");
  const cfg = new ForgeConfig("openai-primary", {}, 5, "quality", "", {
    mode: "auto",
    maxSkills: 4,
    promptCharBudget: 9000,
    minInstallCount: 500,
    trustedSources: ["vercel-labs"],
    installTargets: ["forge", "agents"],
  });
  saveConfig(cfg, configFile);
  const loaded = loadConfig(configFile);
  expect(loaded.skills).toEqual(cfg.skills);
});

test("loadConfig defaults skills config when skills table is absent", () => {
  const configFile = path.join(tmpDir, "config.toml");
  fs.writeFileSync(configFile, 'profile = "claude-primary"\nmax_cycles = 5\n');
  const loaded = loadConfig(configFile);
  expect(loaded.skills.mode).toBe("off");
  expect(loaded.skills.maxSkills).toBe(3);
});

test("loadConfig falls back to default install targets when all configured targets are invalid", () => {
  const configFile = path.join(tmpDir, "config.toml");
  fs.writeFileSync(configFile, [
    'profile = "claude-primary"',
    "",
    "[skills]",
    'install_targets = ["nonsense"]',
  ].join("\n"));

  const loaded = loadConfig(configFile);
  expect(loaded.skills.installTargets).toEqual(DEFAULT_SKILL_CONFIG.installTargets);
});

test("loadConfig defaults invalid numeric skill values instead of storing NaN", () => {
  const configFile = path.join(tmpDir, "config.toml");
  fs.writeFileSync(configFile, [
    'profile = "claude-primary"',
    "",
    "[skills]",
    'max_skills = "many"',
    'prompt_char_budget = "large"',
    'min_install_count = "popular"',
  ].join("\n"));

  const loaded = loadConfig(configFile);
  expect(loaded.skills.maxSkills).toBe(DEFAULT_SKILL_CONFIG.maxSkills);
  expect(loaded.skills.promptCharBudget).toBe(DEFAULT_SKILL_CONFIG.promptCharBudget);
  expect(loaded.skills.minInstallCount).toBe(DEFAULT_SKILL_CONFIG.minInstallCount);
});
```

Implementation:

- [x] Import `SkillConfig`.
- [x] Add `DEFAULT_SKILL_CONFIG`.
- [ ] Revise `normalizeSkillConfig` to read persisted snake_case TOML keys only.
- [ ] Ensure invalid numeric values fall back to defaults instead of producing `NaN`.
- [ ] Ensure invalid `install_targets` falls back to defaults when filtering removes every target.
- [x] Add `skills` as the final `ForgeConfig` constructor parameter.
- [x] Add `toJson()` to `ForgeConfig`.
- [x] Update `loadConfig()` to read `data.skills`.
- [x] Update `saveConfig()` to use `cfg.toJson()`.

Targeted test command:

```bash
node --experimental-sqlite node_modules/.bin/jest tests/config.test.ts --no-coverage
```

### Task 1.3 - Add Skill Persistence Tables And DB Helpers

Files:

- Modify `src/db.ts`
- Modify `tests/db.test.ts`

Tests to add first:

```typescript
test("logSkillQuery persists a search query", () => {
  const sid = db.createSession("idea");
  const qid = db.logSkillQuery(sid, "ARCHITECTURE", "react frontend", 1);
  const queries = db.getSkillQueries(sid);
  expect(qid).toHaveLength(8);
  expect(queries.some((r) => r["query"] === "react frontend")).toBe(true);
  expect(queries[0]["attempt"]).toBe(1);
});

test("skill queries are queryable by attempt", () => {
  const sid = db.createSession("idea");
  db.logSkillQuery(sid, "ARCHITECTURE", "react frontend", 1);
  db.logSkillQuery(sid, "CODING", "debug failing tests", 2);

  const secondAttempt = db.getSkillQueries(sid, 2);
  expect(secondAttempt).toHaveLength(1);
  expect(secondAttempt[0]["attempt"]).toBe(2);
  expect(secondAttempt[0]["query"]).toBe("debug failing tests");
});

test("saveSkillCandidate persists candidate metadata", () => {
  const sid = db.createSession("idea");
  const qid = db.logSkillQuery(sid, "ARCHITECTURE", "react frontend", 1);
  const cid = db.saveSkillCandidate(sid, qid, {
    packageRef: "vercel-labs/agent-skills",
    skillName: "frontend-design",
    title: "Frontend Design",
    description: "Guidance for polished frontend work",
    url: "https://skills.sh/vercel-labs/agent-skills/frontend-design",
    installCount: 100000,
    score: 0.92,
    raw: { source: "fixture" },
  });
  const candidates = db.getSkillCandidates(sid);
  expect(cid).toHaveLength(8);
  expect(candidates[0]["skill_name"]).toBe("frontend-design");
  expect(candidates[0]["package_ref"]).toBe("vercel-labs/agent-skills");
});

test("skill audit selection install and injection records are persisted", () => {
  const sid = db.createSession("idea");
  const qid = db.logSkillQuery(sid, "CODING", "testing", 2);
  const cid = db.saveSkillCandidate(sid, qid, {
    packageRef: "anthropics/skills",
    skillName: "testing",
    title: "Testing",
    description: "Testing guidance",
  });
  db.logSkillAudit(sid, cid, { verdict: "pass", reasons: ["trusted source"] });
  const selectionId = db.selectSkill(sid, {
    candidateId: cid,
    status: "selected",
    phase: "CODING",
    attempt: 2,
    rationale: "Matches test task",
  });
  db.logSkillInstallation(sid, {
    selectionId,
    attempt: 2,
    target: "forge",
    installPath: ".forge/skills/testing",
    status: "installed",
  });
  db.logSkillInjection(sid, {
    selectionId,
    attempt: 2,
    agentName: "CodingAgent",
    contextKind: "compact",
    charCount: 1200,
  });
  const selections = db.getSkillSelections(sid);
  expect(selections).toHaveLength(1);
  expect(selections[0]["status"]).toBe("selected");
  expect(selections[0]["attempt"]).toBe(2);
  expect(db.getSkillAuditTrail(sid).some((r) => r["verdict"] === "pass")).toBe(true);
});

test("getSkillSelectionKeys returns joined selected candidate keys", () => {
  const sid = db.createSession("idea");
  const qid = db.logSkillQuery(sid, "CODING", "vercel deployment", 1);
  const selectedCandidateId = db.saveSkillCandidate(sid, qid, {
    packageRef: "vercel-labs/agent-skills",
    skillName: "deploy-to-vercel",
  });
  const skippedCandidateId = db.saveSkillCandidate(sid, qid, {
    packageRef: "example/skills",
    skillName: "skip-me",
  });

  db.selectSkill(sid, {
    candidateId: selectedCandidateId,
    status: "selected",
    phase: "CODING",
    attempt: 1,
    rationale: "selected for audit",
  });
  db.selectSkill(sid, {
    candidateId: skippedCandidateId,
    status: "skipped",
    phase: "CODING",
    attempt: 1,
    rationale: "below threshold",
  });

  expect(db.getSkillSelectionKeys(sid)).toEqual([
    "vercel-labs/agent-skills@deploy-to-vercel",
  ]);
});
```

Implementation:

- [ ] Replace the existing skill table definitions with the revised schema above.
- [ ] Add required `attempt` to `skill_queries`, `skill_selections`, `skill_installations`, and `skill_injections`.
- [ ] Keep `skill_candidates` schema minimal until Phase 2 parser research is closed.
- [ ] Add indexes for session-scoped skill reads.
- [ ] Add `getSkillQueries(sessionId, attempt?)`.
- [ ] Add `getSkillSelectionKeys(sessionId, attempt?)`.
- [x] Import skill types with type-only imports.
- [ ] Revise helper methods to require attempt where this contract requires it.
- [x] Use `jsonValue()` for raw candidate data and audit reasons.
- [ ] Add or revise read helpers for future phases and tests.

Targeted test command:

```bash
node --experimental-sqlite node_modules/.bin/jest tests/db.test.ts --no-coverage
```

### Task 1.4 - Snapshot Config On Session Creation

Files:

- Modify `src/session.ts`
- Modify `tests/session.test.ts`

Tests to add first:

```typescript
test("create stores config snapshot in session row", () => {
  const s = makeSession();
  const row = s.db.getSession(s.id);
  const snapshot = JSON.parse(String(row?.["config_json"] ?? "{}"));
  expect(snapshot).toHaveProperty("profile");
  expect(snapshot).toHaveProperty("skills");
  expect(snapshot.skills).toHaveProperty("mode");
});
```

Implementation:

- [x] Change `Session.create()` to call `db.createSession(idea, id, JSON.stringify(cfg.toJson()))`.
- [x] Do not change `Session.load()` model routing behavior.
- [x] Do not consume skill config in agents yet.

Targeted test command:

```bash
node --experimental-sqlite node_modules/.bin/jest tests/session.test.ts --no-coverage
```

### Task 1.5 - Build And Focused Test Pass

Commands:

```bash
node --experimental-sqlite node_modules/.bin/jest tests/config.test.ts tests/db.test.ts tests/session.test.ts --no-coverage
npm run build
```

Expected:

- Config tests pass.
- DB tests pass.
- Session tests pass.
- TypeScript build passes.

Do not run networked `npx skills` commands in Phase 1.

## Failure Modes And Handling

| Failure | Expected Handling |
|---|---|
| Existing config file lacks `[skills]` | `loadConfig()` uses `DEFAULT_SKILL_CONFIG` |
| Existing config has invalid skill mode | Normalize to `"off"` |
| Existing config has negative numeric budgets | Clamp to `0` or default according to helper logic |
| Existing config has non-numeric skill budgets | Use `DEFAULT_SKILL_CONFIG` values instead of preserving `NaN` |
| Existing config has some unknown install targets | Drop unknown target values |
| Existing config has only unknown install targets | Fall back to `DEFAULT_SKILL_CONFIG.installTargets` |
| Existing session DB lacks skill tables | Constructor creates them with `CREATE TABLE IF NOT EXISTS` |
| Skill candidate raw data is not serializable | Existing `jsonValue()` fallback handles common objects; future adapter should pass plain data |
| Later phases need selected skill identity keys | Use `getSkillSelectionKeys()` instead of reading raw selection rows |
| Session created before this phase has `{}` config snapshot | Future resume logic must handle missing `skills` with defaults |
| Resume attempt writes skill rows without attempt context | Type signatures require attempt; DB methods normalize explicit attempt values to `>= 1` |

## Acceptance Criteria

- [ ] `src/skills/types.ts` matches the revised Phase 1 domain contract and exports only domain types.
- [x] `ForgeConfig` includes `skills`.
- [x] Old config TOML files without `[skills]` still load.
- [x] `saveConfig()` writes a `[skills]` TOML table.
- [x] `sessions.config_json` receives a config snapshot during `Session.create()`.
- [ ] DB schema includes the revised skill query, candidate, audit, selection, installation, and injection tables.
- [ ] DB helper methods can write and read revised skill lifecycle records.
- [ ] Skill query, selection, installation, and injection rows include an `attempt` value.
- [ ] Attempt-bearing helper APIs require attempt from callers instead of silently defaulting to `1`.
- [ ] `getSkillQueries(sessionId, attempt)` can filter rows for a specific resume attempt.
- [ ] `getSkillSelectionKeys(sessionId, attempt?)` returns joined selected `packageRef@skillName` keys.
- [ ] Invalid `install_targets` cannot normalize to an empty target list.
- [ ] Invalid numeric skill config values cannot normalize to `NaN`.
- [ ] Candidate persistence avoids premature `source_owner` and `source_repo` columns.
- [ ] Skill lifecycle read paths have session-scoped indexes.
- [ ] Query persistence has a direct `getSkillQueries()` read helper.
- [ ] Targeted config, DB, and session tests pass after the revised contract lands.
- [ ] `npm run build` passes after the revised contract lands.
- [x] No skills CLI commands are called.
- [x] No prompt injection, agent behavior, or install behavior changes are introduced.

## Rollback Notes

If Phase 1 causes test or build failures:

- Revert only Phase 1 code files and tests:
  - `src/skills/types.ts`
  - `src/config.ts`
  - `src/db.ts`
  - `src/session.ts`
  - `tests/config.test.ts`
  - `tests/db.test.ts`
  - `tests/session.test.ts`
- Do not remove planning docs unless the user explicitly asks.
- Do not touch unrelated untracked files.

## Research Gate

- [x] Decide whether SQLite, config JSON, or workspace files own each part of skill state
- [x] Define resume behavior before implementation
- [x] Confirm nested TOML shape is supported
- [x] Confirm current DB extension pattern
- [x] Confirm current session config snapshot gap

## Plan Completion Review

- [x] Frontmatter status reflects that the Phase 1 plan is implementation-ready.
- [x] Scope boundary excludes skills CLI calls, installs, audits, ranking, prompt injection, and agent behavior changes.
- [x] Public TypeScript interfaces define the revised loose candidate model and attempt-bearing lifecycle records.
- [x] Config plan covers defaults, TOML serialization, invalid install targets, invalid numeric values, and session snapshots.
- [x] DB plan covers all skill lifecycle tables, session-scoped indexes, attempt-aware helpers, and joined selected skill keys.
- [x] Test plan covers the reviewer-found failure cases and downstream Phase 3 resume/dedupe needs.
- [x] Current source audit identifies every known branch mismatch that must be corrected during implementation.
- [x] Acceptance criteria distinguish completed research and existing safe behavior from code changes that still need to land.
