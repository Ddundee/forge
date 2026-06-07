import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "crypto";
import type { SkillCandidate, SkillAuditResult, SkillSelection, SkillInstallRecord, SkillInjectionRecord } from "./skills/types.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    idea TEXT NOT NULL,
    spec TEXT,
    architecture TEXT,
    phase TEXT NOT NULL DEFAULT 'IDEATION',
    cycle INTEGER NOT NULL DEFAULT 0,
    max_cycles INTEGER NOT NULL DEFAULT 5,
    deploy_target TEXT,
    workspace TEXT,
    created_at TEXT NOT NULL,
    config_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    title TEXT NOT NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    assigned_model TEXT,
    output TEXT,
    deps_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    completed_at TEXT
);
CREATE TABLE IF NOT EXISTS artifacts (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    file_path TEXT NOT NULL,
    content_snapshot TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS llm_calls (
    id TEXT PRIMARY KEY,
    task_id TEXT REFERENCES tasks(id),
    session_id TEXT NOT NULL REFERENCES sessions(id),
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    tokens_in INTEGER NOT NULL DEFAULT 0,
    tokens_out INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0.0,
    response TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    timestamp TEXT NOT NULL,
    phase TEXT NOT NULL,
    message TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tool_calls (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    task_id TEXT REFERENCES tasks(id),
    tool_name TEXT NOT NULL,
    tool_args TEXT NOT NULL DEFAULT '{}',
    tool_result TEXT,
    created_at TEXT NOT NULL
);
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
`;

function uid(): string { return randomUUID().slice(0, 8); }
function now(): string { return new Date().toISOString(); }
function bindValue(value: unknown): any {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") return value;
  if (value instanceof Uint8Array) return value;
  return JSON.stringify(value) ?? String(value);
}

function bindValues(values: unknown[]): any[] {
  return values.map(bindValue);
}

function jsonValue(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export class ForgeDb {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec(SCHEMA);
  }

  createSession(idea: string, id?: string, configJson = "{}"): string {
    const sessionId = id ?? uid();
    this.db.prepare(
      "INSERT INTO sessions (id, idea, phase, cycle, created_at, config_json) VALUES (?, ?, 'IDEATION', 0, ?, ?)"
    ).run(...bindValues([sessionId, idea, now(), configJson]));
    return sessionId;
  }

  getSession(sessionId: string): Record<string, unknown> | undefined {
    return this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId) as any;
  }

  updateSession(sessionId: string, fields: Record<string, unknown>): void {
    const sets = Object.keys(fields).map(k => `${k} = ?`).join(", ");
    const params = bindValues([...Object.values(fields), sessionId]);
    this.db.prepare(`UPDATE sessions SET ${sets} WHERE id = ?`).run(...params);
  }

  getTotalCost(sessionId: string): number {
    const row = this.db.prepare(
      "SELECT COALESCE(SUM(cost_usd), 0) as total FROM llm_calls WHERE session_id = ?"
    ).get(sessionId) as any;
    return row?.total ?? 0;
  }

  listSessions(): Record<string, unknown>[] {
    return this.db.prepare(
      "SELECT s.*, COALESCE(SUM(l.cost_usd), 0) as total_cost " +
      "FROM sessions s LEFT JOIN llm_calls l ON l.session_id = s.id " +
      "GROUP BY s.id ORDER BY s.created_at DESC"
    ).all() as any[];
  }

  createTask(sessionId: string, title: string, type: string, deps: string[] = []): string {
    const id = uid();
    this.db.prepare(
      "INSERT INTO tasks (id, session_id, title, type, status, deps_json, created_at) VALUES (?, ?, ?, ?, 'pending', ?, ?)"
    ).run(...bindValues([id, sessionId, title, type, jsonValue(deps), now()]));
    return id;
  }

  updateTask(taskId: string, fields: Record<string, unknown>): void {
    if (fields["status"] === "completed") fields["completed_at"] = now();
    const sets = Object.keys(fields).map(k => `${k} = ?`).join(", ");
    const params = bindValues([...Object.values(fields), taskId]);
    this.db.prepare(`UPDATE tasks SET ${sets} WHERE id = ?`).run(...params);
  }

  getTasks(sessionId: string, status?: string): Record<string, unknown>[] {
    if (status) {
      return this.db.prepare(
        "SELECT * FROM tasks WHERE session_id = ? AND status = ? ORDER BY created_at"
      ).all(sessionId, status) as any[];
    }
    return this.db.prepare(
      "SELECT * FROM tasks WHERE session_id = ? ORDER BY created_at"
    ).all(sessionId) as any[];
  }

  logEvent(sessionId: string, phase: string, message: string): void {
    this.db.prepare(
      "INSERT INTO events (id, session_id, timestamp, phase, message) VALUES (?, ?, ?, ?, ?)"
    ).run(...bindValues([uid(), sessionId, now(), phase, message]));
  }

  logLlmCall(
    sessionId: string,
    data: { model: string; tokensIn: number; tokensOut: number; costUsd: number; response: string },
    taskId?: string,
  ): void {
    this.db.prepare(
      "INSERT INTO llm_calls (id, task_id, session_id, provider, model, tokens_in, tokens_out, cost_usd, response, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(...bindValues([uid(), taskId ?? null, sessionId, data.model.split("/")[0], data.model,
      data.tokensIn, data.tokensOut, data.costUsd, data.response, now()]));
  }

  logToolCall(sessionId: string, taskId: string | undefined, toolName: string, toolArgs: unknown, toolResult: string): void {
    this.db.prepare(
      "INSERT INTO tool_calls (id, session_id, task_id, tool_name, tool_args, tool_result, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(...bindValues([uid(), sessionId, taskId ?? null, toolName, jsonValue(toolArgs), toolResult, now()]));
  }

  saveArtifact(sessionId: string, filePath: string, content: string): void {
    const existing = this.db.prepare(
      "SELECT version FROM artifacts WHERE session_id = ? AND file_path = ? ORDER BY version DESC LIMIT 1"
    ).get(sessionId, filePath) as any;
    const version = existing ? existing.version + 1 : 1;
    this.db.prepare(
      "INSERT INTO artifacts (id, session_id, file_path, content_snapshot, version, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(...bindValues([uid(), sessionId, filePath, content, version, now()]));
  }

  getArtifacts(sessionId: string): Record<string, unknown>[] {
    return this.db.prepare(
      "SELECT * FROM artifacts WHERE session_id = ? ORDER BY version"
    ).all(sessionId) as any[];
  }

  getEvents(sessionId: string): Record<string, unknown>[] {
    return this.db.prepare(
      "SELECT timestamp, phase, message FROM events WHERE session_id = ? ORDER BY timestamp"
    ).all(sessionId) as any[];
  }

  logSkillQuery(sessionId: string, phase: string, query: string, attempt: number, source = "skills-cli"): string {
    const id = uid();
    const normalizedAttempt = Math.max(1, Math.floor(attempt));
    this.db.prepare(
      "INSERT INTO skill_queries (id, session_id, attempt, phase, query, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(...bindValues([id, sessionId, normalizedAttempt, phase, query, source, now()]));
    return id;
  }

  saveSkillCandidate(sessionId: string, queryId: string | undefined, candidate: SkillCandidate): string {
    const id = uid();
    this.db.prepare(
      "INSERT INTO skill_candidates " +
      "(id, session_id, query_id, package_ref, skill_name, title, description, url, install_count, score, raw_json, created_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(...bindValues([
      id, sessionId, queryId ?? null,
      candidate.packageRef, candidate.skillName,
      candidate.title ?? null, candidate.description ?? null,
      candidate.url ?? null, candidate.installCount ?? null, candidate.score ?? null,
      jsonValue(candidate.raw ?? {}), now(),
    ]));
    return id;
  }

  logSkillAudit(sessionId: string, candidateId: string, audit: Pick<SkillAuditResult, "verdict" | "reasons">): string {
    const id = uid();
    this.db.prepare(
      "INSERT INTO skill_audits (id, session_id, candidate_id, verdict, reasons_json, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(...bindValues([id, sessionId, candidateId, audit.verdict, jsonValue(audit.reasons), now()]));
    return id;
  }

  selectSkill(sessionId: string, selection: SkillSelection): string {
    const id = uid();
    const attempt = Math.max(1, Math.floor(selection.attempt));
    this.db.prepare(
      "INSERT INTO skill_selections (id, session_id, candidate_id, status, attempt, phase, task_id, rationale, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(...bindValues([
      id, sessionId, selection.candidateId, selection.status,
      attempt, selection.phase, selection.taskId ?? null, selection.rationale, now(),
    ]));
    return id;
  }

  logSkillInstallation(sessionId: string, install: SkillInstallRecord): string {
    const id = uid();
    const attempt = Math.max(1, Math.floor(install.attempt));
    this.db.prepare(
      "INSERT INTO skill_installations (id, session_id, selection_id, attempt, target, install_path, status, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(...bindValues([
      id, sessionId, install.selectionId, attempt, install.target,
      install.installPath, install.status, install.error ?? null, now(),
    ]));
    return id;
  }

  logSkillInjection(sessionId: string, injection: SkillInjectionRecord): string {
    const id = uid();
    const attempt = Math.max(1, Math.floor(injection.attempt));
    this.db.prepare(
      "INSERT INTO skill_injections (id, session_id, selection_id, attempt, task_id, agent_name, context_kind, char_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(...bindValues([
      id, sessionId, injection.selectionId, attempt, injection.taskId ?? null,
      injection.agentName, injection.contextKind, injection.charCount, now(),
    ]));
    return id;
  }

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

  getSkillCandidates(sessionId: string): Record<string, unknown>[] {
    return this.db.prepare(
      "SELECT * FROM skill_candidates WHERE session_id = ? ORDER BY created_at"
    ).all(sessionId) as any[];
  }

  getSkillSelections(sessionId: string): Record<string, unknown>[] {
    return this.db.prepare(
      "SELECT * FROM skill_selections WHERE session_id = ? ORDER BY created_at"
    ).all(sessionId) as any[];
  }

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

  getSkillAuditTrail(sessionId: string): Record<string, unknown>[] {
    return this.db.prepare(
      "SELECT sq.phase, sq.query, sq.source, sq.attempt, " +
      "sc.package_ref, sc.skill_name, sc.install_count, sc.score, " +
      "sa.verdict, sa.reasons_json " +
      "FROM skill_queries sq " +
      "LEFT JOIN skill_candidates sc ON sc.query_id = sq.id AND sc.session_id = sq.session_id " +
      "LEFT JOIN skill_audits sa ON sa.candidate_id = sc.id AND sa.session_id = sq.session_id " +
      "WHERE sq.session_id = ? ORDER BY sq.created_at"
    ).all(sessionId) as any[];
  }

  close(): void { this.db.close(); }
}
