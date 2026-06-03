# Design: Python → TypeScript Migration

**Date:** 2026-06-03
**Status:** Approved
**Approach:** A — Clean-slate rewrite in the same repo

---

## Motivation

Migrate Forge from Python to TypeScript (Node.js) to improve developer tooling, IDE experience, and npm ecosystem access. User-facing behavior, CLI commands, session format, and Homebrew distribution remain identical.

---

## Constraints

- SQLite schema must be **byte-for-byte identical** — existing sessions must survive the cutover.
- Homebrew distribution is preserved. The formula is updated to pull a Node.js-based tarball instead of a Python one.
- CLI command signatures (`forgecli build`, `setup`, `sessions`, `resume`, `logs`, `prompts`) are unchanged.
- Runtime: **Node.js** (not Bun or Deno).
- Test framework: **Jest**.

---

## Repo Layout

### During migration

Python source stays functional and untouched in `src/forge/`. TypeScript source is developed in `src-ts/` in parallel.

```
forge/
├── package.json
├── tsconfig.json
├── jest.config.ts
├── src-ts/                   # TypeScript source (renamed to src/ at cutover)
│   ├── cli.ts
│   ├── overseer.ts
│   ├── session.ts
│   ├── db.ts
│   ├── stateMachine.ts
│   ├── router.ts
│   ├── config.ts
│   ├── modelFetch.ts
│   ├── promptLog.ts
│   ├── agents/
│   │   ├── base.ts
│   │   ├── ideation.ts
│   │   ├── architecture.ts
│   │   ├── taskGraph.ts
│   │   ├── coding.ts
│   │   ├── review.ts
│   │   ├── integration.ts
│   │   ├── testAgent.ts
│   │   ├── verification.ts
│   │   └── deploy.ts
│   ├── tools/
│   │   ├── definitions.ts
│   │   └── executor.ts
│   ├── commands/
│   │   ├── sessions.ts       # forgecli sessions
│   │   ├── logs.ts           # forgecli logs
│   │   └── prompts.ts        # forgecli prompts
│   └── ui/
│       ├── liveFeed.tsx      # ink (React-for-CLIs)
│       └── interrupt.ts
├── tests/                    # Jest tests
│   ├── agents/
│   │   ├── base.test.ts
│   │   ├── coding.test.ts
│   │   ├── ideation.test.ts
│   │   ├── architecture.test.ts
│   │   ├── taskGraph.test.ts
│   │   ├── review.test.ts
│   │   ├── integration.test.ts
│   │   ├── testAgent.test.ts
│   │   └── verification.test.ts
│   ├── db.test.ts
│   ├── router.test.ts
│   ├── session.test.ts
│   ├── stateMachine.test.ts
│   ├── config.test.ts
│   ├── overseer.test.ts
│   └── e2e.test.ts
└── src/forge/                # Python source — untouched until cutover
```

### At cutover

1. Delete `src/forge/` and `pyproject.toml`.
2. Rename `src-ts/` → `src/`.
3. Update Homebrew formula to pull Node.js tarball.

---

## Library Mapping

| Python | TypeScript | Notes |
|---|---|---|
| `typer` | `commander` | Most mature TS CLI framework, full type safety |
| `rich` (panels/tables) | `chalk` + `cli-table3` | Static output: sessions list, logs, prompts |
| `rich` (Live/Layout TUI) | `ink` | React-for-CLIs — closest match to Rich Live |
| `litellm` | Vercel AI SDK (`ai` + `@ai-sdk/*`) | Multi-provider, best TS types |
| `sqlite3` | `better-sqlite3` | Synchronous API, excellent types |
| `questionary` | `@inquirer/prompts` | Official Inquirer.js v9, full TS support |
| `tomllib` + `tomli_w` | `smol-toml` | Read/write TOML, zero deps |
| `pathlib.Path` | `path` + `fs/promises` | Node.js native |
| `asyncio` | native `async/await` | Node.js is async-native |
| `dataclass` | TypeScript `interface` / `class` | Direct mapping |
| `ABC` | `abstract class` | Direct mapping |
| `enum` | TypeScript `enum` | Direct mapping |
| `pytest` + `pytest-asyncio` | `jest` | Jest handles async natively |
| `pytest-mock` | `jest.fn()` / `jest.mock()` | Built into Jest |

### `package.json` dependencies

```json
{
  "name": "forgecli",
  "version": "0.1.10",
  "type": "module",
  "bin": { "forgecli": "dist/cli.js" },
  "dependencies": {
    "ai": "^4.0.0",
    "@ai-sdk/anthropic": "^1.0.0",
    "@ai-sdk/openai": "^1.0.0",
    "@ai-sdk/google": "^1.0.0",
    "@ai-sdk/groq": "^1.0.0",
    "@ai-sdk/mistral": "^1.0.0",
    "better-sqlite3": "^9.0.0",
    "chalk": "^5.0.0",
    "cli-table3": "^0.6.0",
    "commander": "^12.0.0",
    "ink": "^5.0.0",
    "@inquirer/prompts": "^5.0.0",
    "smol-toml": "^1.0.0",
    "react": "^18.0.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.0.0",
    "@types/node": "^20.0.0",
    "@types/react": "^18.0.0",
    "jest": "^29.0.0",
    "ts-jest": "^29.0.0",
    "typescript": "^5.0.0"
  }
}
```

---

## Module Designs

### `stateMachine.ts`

Direct port of the Python enum + transition guard.

```typescript
export enum Phase {
  IDEATION = "IDEATION",
  ARCHITECTURE = "ARCHITECTURE",
  TASK_GRAPH = "TASK_GRAPH",
  CODING = "CODING",
  INTEGRATION = "INTEGRATION",
  TESTING = "TESTING",
  VERIFICATION = "VERIFICATION",
  DEPLOY = "DEPLOY",
  DONE = "DONE",
  FAILED = "FAILED",
}

const TRANSITIONS: Record<Phase, Phase[]> = {
  [Phase.IDEATION]: [Phase.ARCHITECTURE],
  [Phase.ARCHITECTURE]: [Phase.TASK_GRAPH],
  [Phase.TASK_GRAPH]: [Phase.CODING],
  [Phase.CODING]: [Phase.INTEGRATION],
  [Phase.INTEGRATION]: [Phase.TESTING],
  [Phase.TESTING]: [Phase.VERIFICATION],
  [Phase.VERIFICATION]: [Phase.DONE, Phase.CODING, Phase.DEPLOY],
  [Phase.DEPLOY]: [Phase.DONE],
  [Phase.DONE]: [],
  [Phase.FAILED]: [],
};

export class InvalidTransitionError extends Error {
  constructor(msg: string) { super(msg); this.name = "InvalidTransitionError"; }
}

export function transition(current: Phase, next: Phase): Phase {
  const allowed = TRANSITIONS[current] ?? [];
  if (!allowed.includes(next)) {
    throw new InvalidTransitionError(
      `Cannot go from ${current} to ${next}. Allowed: ${allowed.join(", ")}`
    );
  }
  return next;
}
```

---

### `db.ts`

The SQLite schema is identical to the Python version. `better-sqlite3` uses a synchronous API — no `await` on DB calls, which is cleaner than Python's sqlite3 with its manual `commit()` calls.

```typescript
import Database from "better-sqlite3";
import { randomUUID } from "crypto";

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
`;

function uid(): string { return randomUUID().slice(0, 8); }
function now(): string { return new Date().toISOString(); }

export class ForgeDb {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.exec(SCHEMA);
  }

  createSession(idea: string, configJson = "{}"): string {
    const id = uid();
    this.db.prepare(
      "INSERT INTO sessions (id, idea, phase, cycle, created_at, config_json) VALUES (?, ?, 'IDEATION', 0, ?, ?)"
    ).run(id, idea, now(), configJson);
    return id;
  }

  getSession(sessionId: string): Record<string, unknown> | undefined {
    return this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId) as any;
  }

  updateSession(sessionId: string, fields: Record<string, unknown>): void {
    const sets = Object.keys(fields).map(k => `${k} = ?`).join(", ");
    this.db.prepare(`UPDATE sessions SET ${sets} WHERE id = ?`)
      .run(...Object.values(fields), sessionId);
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
    ).run(id, sessionId, title, type, JSON.stringify(deps), now());
    return id;
  }

  updateTask(taskId: string, fields: Record<string, unknown>): void {
    if (fields["status"] === "completed") fields["completed_at"] = now();
    const sets = Object.keys(fields).map(k => `${k} = ?`).join(", ");
    this.db.prepare(`UPDATE tasks SET ${sets} WHERE id = ?`)
      .run(...Object.values(fields), taskId);
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
    ).run(uid(), sessionId, now(), phase, message);
  }

  logLlmCall(sessionId: string, data: {
    model: string; tokensIn: number; tokensOut: number; costUsd: number; response: string;
  }, taskId?: string): void {
    this.db.prepare(
      "INSERT INTO llm_calls (id, task_id, session_id, provider, model, tokens_in, tokens_out, cost_usd, response, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(uid(), taskId ?? null, sessionId, data.model.split("/")[0], data.model,
      data.tokensIn, data.tokensOut, data.costUsd, data.response, now());
  }

  logToolCall(sessionId: string, taskId: string | undefined, toolName: string, toolArgs: unknown, toolResult: string): void {
    this.db.prepare(
      "INSERT INTO tool_calls (id, session_id, task_id, tool_name, tool_args, tool_result, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(uid(), sessionId, taskId ?? null, toolName, JSON.stringify(toolArgs), toolResult, now());
  }

  saveArtifact(sessionId: string, filePath: string, content: string): void {
    const existing = this.db.prepare(
      "SELECT version FROM artifacts WHERE session_id = ? AND file_path = ? ORDER BY version DESC LIMIT 1"
    ).get(sessionId, filePath) as any;
    const version = existing ? existing.version + 1 : 1;
    this.db.prepare(
      "INSERT INTO artifacts (id, session_id, file_path, content_snapshot, version, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(uid(), sessionId, filePath, content, version, now());
  }

  close(): void { this.db.close(); }
}
```

---

### `router.ts`

Replaces `litellm` with the Vercel AI SDK. `ModelTier` enum and `DEFAULT_MODELS` are identical to the Python version. Timeout is enforced via `Promise.race`.

```typescript
import { generateText, CoreMessage } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";

export enum ModelTier {
  OVERSEER = "overseer",
  REASONING = "reasoning",
  STANDARD = "standard",
  FAST = "fast",
}

export const DEFAULT_MODELS: Record<ModelTier, string> = {
  [ModelTier.OVERSEER]: "claude-opus-4-8",
  [ModelTier.REASONING]: "claude-sonnet-4-6",
  [ModelTier.STANDARD]: "claude-haiku-4-5-20251001",
  [ModelTier.FAST]: "gemini/gemini-2.0-flash",
};

export interface CallResult {
  content: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LoopResult {
  text: string | null;
  toolCalls: ToolCall[];
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

export class LLMTimeoutError extends Error {
  constructor(timeoutSecs: number, model: string) {
    super(`LLM call timed out after ${timeoutSecs}s (model: ${model})`);
    this.name = "LLMTimeoutError";
  }
}

export class LLMRouter {
  private models: Record<ModelTier, string>;

  constructor(tierModels?: Partial<Record<ModelTier, string>>) {
    this.models = { ...DEFAULT_MODELS, ...tierModels };
  }

  modelFor(tier: ModelTier): string {
    return this.models[tier];
  }

  override(tier: ModelTier, model: string): void {
    this.models[tier] = model;
  }

  async complete(tier: ModelTier, messages: CoreMessage[], timeoutMs = 120_000): Promise<CallResult> {
    const modelId = this.models[tier];
    const model = this.resolveModel(modelId);
    const call = generateText({ model, messages });
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new LLMTimeoutError(timeoutMs / 1000, modelId)), timeoutMs)
    );
    const result = await Promise.race([call, timeout]);
    return {
      content: result.text,
      model: modelId,
      tokensIn: result.usage.promptTokens,
      tokensOut: result.usage.completionTokens,
      costUsd: 0,
    };
  }

  async completeWithTools(
    tier: ModelTier,
    messages: CoreMessage[],
    tools: Record<string, unknown>,
    timeoutMs = 120_000,
  ): Promise<LoopResult> {
    const modelId = this.models[tier];
    const model = this.resolveModel(modelId);
    const call = generateText({ model, messages, tools: tools as any, toolChoice: "auto" });
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new LLMTimeoutError(timeoutMs / 1000, modelId)), timeoutMs)
    );
    const result = await Promise.race([call, timeout]);
    const toolCalls: ToolCall[] = (result.toolCalls ?? []).map((tc: any) => ({
      id: tc.toolCallId,
      name: tc.toolName,
      arguments: tc.args ?? {},
    }));
    return {
      text: result.text || null,
      toolCalls,
      model: modelId,
      tokensIn: result.usage.promptTokens,
      tokensOut: result.usage.completionTokens,
      costUsd: 0,
    };
  }

  private resolveModel(modelId: string) {
    if (modelId.startsWith("claude")) return createAnthropic()(modelId);
    if (modelId.startsWith("gpt") || modelId.startsWith("o3") || modelId.startsWith("o4")) {
      return createOpenAI()(modelId);
    }
    if (modelId.startsWith("gemini") || modelId.includes("gemini")) {
      const id = modelId.replace("gemini/", "");
      return createGoogleGenerativeAI()(id);
    }
    // fallback: treat as OpenAI-compatible
    return createOpenAI()(modelId);
  }
}
```

---

### `agents/base.ts`

`BaseAgent` abstract class with `_call` (one-shot) and `runAgenticLoop` (multi-turn tool loop). Direct port of the Python `BaseAgent`.

```typescript
import { CoreMessage } from "ai";
import { ForgeDb } from "../db.js";
import { LLMRouter, ModelTier, CallResult } from "../router.js";
import { TOOL_DEFINITIONS } from "../tools/definitions.js";
import { executeTool } from "../tools/executor.js";

export interface AgentResult {
  success: boolean;
  output: string;
  error?: string;
}

const MAX_TURNS = 40;
const MAX_TOOL_CALLS = 80;

function extractJson(text: string): string {
  const trimmed = text.trim();
  try { JSON.parse(trimmed); return trimmed; } catch {}
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  for (const [open, close] of [["{", "}"], ["[", "]"]]) {
    const s = trimmed.indexOf(open);
    const e = trimmed.lastIndexOf(close);
    if (s !== -1 && e > s) {
      const candidate = trimmed.slice(s, e + 1);
      try { JSON.parse(candidate); return candidate; } catch {}
    }
  }
  return text;
}

export abstract class BaseAgent {
  protected tier: ModelTier = ModelTier.STANDARD;

  constructor(
    protected router: LLMRouter,
    protected db: ForgeDb,
    protected sessionId: string,
  ) {}

  abstract run(args: Record<string, unknown>): Promise<AgentResult>;

  protected async call(messages: CoreMessage[], taskId?: string): Promise<string> {
    const model = this.router.modelFor(this.tier);
    this.db.logEvent(this.sessionId, "LLM_CALL", `${this.constructor.name} → ${model}`);
    const result = await this.router.complete(this.tier, messages);
    this.db.logLlmCall(this.sessionId, result, taskId);
    return result.content;
  }

  protected async runAgenticLoop(
    messages: CoreMessage[],
    workspace: string,
    taskId?: string,
  ): Promise<string> {
    let totalToolCalls = 0;

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const model = this.router.modelFor(this.tier);
      this.db.logEvent(this.sessionId, "LLM_CALL", `${this.constructor.name} turn ${turn + 1} → ${model}`);
      const result = await this.router.completeWithTools(this.tier, messages, TOOL_DEFINITIONS);
      this.db.logLlmCall(this.sessionId, result, taskId);

      if (!result.toolCalls.length) return result.text ?? "";

      messages.push({
        role: "assistant",
        content: [
          ...(result.text ? [{ type: "text" as const, text: result.text }] : []),
          ...result.toolCalls.map(tc => ({
            type: "tool-call" as const,
            toolCallId: tc.id,
            toolName: tc.name,
            args: tc.arguments,
          })),
        ],
      });

      for (const tc of result.toolCalls) {
        totalToolCalls++;
        const toolResult = totalToolCalls > MAX_TOOL_CALLS
          ? "ERROR: Tool call limit reached. Stop and report what you have."
          : executeTool(tc.name, tc.arguments, workspace);

        this.db.logToolCall(this.sessionId, taskId, tc.name, tc.arguments, toolResult.slice(0, 2000));
        messages.push({
          role: "tool",
          content: [{ type: "tool-result" as const, toolCallId: tc.id, result: toolResult }],
        });
      }
    }

    messages.push({ role: "user", content: "You have reached the turn limit. Summarize what you completed." });
    const final = await this.router.completeWithTools(this.tier, messages, {});
    this.db.logLlmCall(this.sessionId, final, taskId);
    return final.text ?? "";
  }

  protected extractJson(text: string): string {
    return extractJson(text);
  }
}
```

---

### `tools/executor.ts`

Direct port. `execSync` from Node.js `child_process` replaces `subprocess.run`. Workspace sandboxing uses `path.resolve` + `startsWith` instead of Python's `Path.relative_to`.

```typescript
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const BLOCKED_PATTERNS = [
  "rm -rf /", "rm -rf ~", ":(){ :|:& };:", "dd if=/dev/zero",
  "mkfs", "> /dev/sda", "chmod 777 /", "chown -R", "sudo rm", "sudo dd",
];

function isBlocked(command: string): boolean {
  const lower = command.toLowerCase();
  return BLOCKED_PATTERNS.some(p => lower.includes(p));
}

function bashExec(args: Record<string, unknown>, workspace: string): string {
  const command = String(args["command"] ?? "");
  const timeout = Number(args["timeout"] ?? 60) * 1000;
  if (!command.trim()) return "ERROR: Empty command";
  if (isBlocked(command)) return `ERROR: Command blocked for safety: ${command}`;
  try {
    const stdout = execSync(command, { cwd: workspace, timeout, encoding: "utf8", stdio: "pipe" });
    const out = stdout.length > 8000 ? stdout.slice(0, 4000) + "\n... [truncated] ...\n" + stdout.slice(-4000) : stdout;
    return out + "\n[exit 0]";
  } catch (e: any) {
    const out = (e.stdout ?? "") + (e.stderr ? `\n[stderr]\n${e.stderr}` : "");
    return out + `\n[exit ${e.status ?? 1}]`;
  }
}

function resolveInWorkspace(relPath: string, workspace: string): string | null {
  const resolved = path.resolve(workspace, relPath);
  if (!resolved.startsWith(path.resolve(workspace))) return null;
  return resolved;
}

function readFile(args: Record<string, unknown>, workspace: string): string {
  const relPath = String(args["path"] ?? "");
  if (!relPath) return "ERROR: No path provided";
  const target = resolveInWorkspace(relPath, workspace);
  if (!target) return `ERROR: Path escapes workspace: ${relPath}`;
  if (!fs.existsSync(target)) return `ERROR: File not found: ${relPath}`;
  if (!fs.statSync(target).isFile()) return `ERROR: Not a file: ${relPath}`;
  try {
    let content = fs.readFileSync(target, "utf8");
    if (content.length > 16000) content = content.slice(0, 8000) + "\n... [truncated] ...\n" + content.slice(-8000);
    return content;
  } catch (e: any) { return `ERROR reading ${relPath}: ${e.message}`; }
}

function writeFile(args: Record<string, unknown>, workspace: string): string {
  const relPath = String(args["path"] ?? "");
  const content = String(args["content"] ?? "");
  if (!relPath) return "ERROR: No path provided";
  const target = resolveInWorkspace(relPath, workspace);
  if (!target) return `ERROR: Path escapes workspace: ${relPath}`;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, "utf8");
    return `OK: Wrote ${content.length} chars to ${relPath}`;
  } catch (e: any) { return `ERROR writing ${relPath}: ${e.message}`; }
}

function listDir(args: Record<string, unknown>, workspace: string): string {
  const relPath = String(args["path"] ?? ".");
  const target = resolveInWorkspace(relPath, workspace);
  if (!target) return `ERROR: Path escapes workspace: ${relPath}`;
  if (!fs.existsSync(target)) return `ERROR: Path not found: ${relPath}`;
  if (!fs.statSync(target).isDirectory()) return `ERROR: Not a directory: ${relPath}`;
  const items = fs.readdirSync(target).sort().map(name => {
    const isDir = fs.statSync(path.join(target, name)).isDirectory();
    return `[${isDir ? "d" : "f"}] ${name}`;
  });
  return items.length ? items.join("\n") : "(empty directory)";
}

export function executeTool(name: string, args: Record<string, unknown>, workspace: string): string {
  if (name === "bash_exec") return bashExec(args, workspace);
  if (name === "read_file") return readFile(args, workspace);
  if (name === "write_file") return writeFile(args, workspace);
  if (name === "list_dir") return listDir(args, workspace);
  return `ERROR: Unknown tool '${name}'`;
}
```

---

### `ui/liveFeed.tsx`

`ink` replaces Rich's `Live`/`Layout`. The `LiveFeedHandle` returned by `render()` exposes `setOverseer`, `updateTask`, and `stop` methods — the same interface the overseer calls today.

```tsx
import React, { useState, useEffect, useCallback } from "react";
import { render, Box, Text, useInput, useApp } from "ink";

interface Task { id: string; title: string; status: string; }

interface LiveFeedState {
  overseerMsg: string;
  tasks: Task[];
  phase: string;
  cycle: number;
  totalCost: number;
  events: { phase: string; message: string; elapsed: number }[];
}

const PHASE_PIPELINE = ["IDEATION","ARCHITECTURE","TASK_GRAPH","CODING","INTEGRATION","TESTING","VERIFICATION"];

const LiveFeedApp: React.FC<{ idea: string; state: { current: LiveFeedState } }> = ({ idea, state }) => {
  const [, forceUpdate] = useState(0);
  const { exit } = useApp();

  useEffect(() => {
    const timer = setInterval(() => forceUpdate(n => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const s = state.current;
  const elapsed = Math.floor((Date.now() - startTime) / 1000);

  return (
    <Box flexDirection="column" width={120}>
      <Text bold>{` forge  ●  ${idea.slice(0, 40)}  ●  ${s.phase}  ●  cycle ${s.cycle}/5  ●  $${s.totalCost.toFixed(3)}`}</Text>
      <Box borderStyle="round" borderColor="cyan" marginTop={1}>
        <Text>{s.overseerMsg}</Text>
      </Box>
      <Box marginTop={1}>
        {s.tasks.slice(-20).map(t => (
          <Box key={t.id}>
            <Text color={t.status === "completed" ? "green" : t.status === "in_progress" ? "cyan" : "white"}>
              {`${t.status === "completed" ? "[✓]" : t.status === "in_progress" ? "[~]" : "[ ]"} ${t.title}`}
            </Text>
          </Box>
        ))}
      </Box>
      <Text dimColor>{" [i] interrupt   [s] session info   [q] quit & save"}</Text>
    </Box>
  );
};

export interface LiveFeedHandle {
  setOverseer(message: string): void;
  updateTask(id: string, title: string, status: string): void;
  pushEvent(phase: string, message: string): void;
  setCycle(n: number): void;
  setTotalCost(cost: number): void;
  stop(): void;
}

export function startLiveFeed(idea: string): LiveFeedHandle {
  const state = {
    current: {
      overseerMsg: "Initializing...",
      tasks: [] as Task[],
      phase: "IDEATION",
      cycle: 0,
      totalCost: 0,
      events: [] as any[],
    }
  };

  const { unmount } = render(<LiveFeedApp idea={idea} state={state} />);
  const startTime = Date.now();

  return {
    setOverseer(message) { state.current = { ...state.current, overseerMsg: message }; },
    updateTask(id, title, status) {
      const tasks = [...state.current.tasks];
      const idx = tasks.findIndex(t => t.id === id);
      if (idx >= 0) tasks[idx] = { id, title, status };
      else tasks.push({ id, title, status });
      state.current = { ...state.current, tasks };
    },
    pushEvent(phase, message) {
      const elapsed = (Date.now() - startTime) / 1000;
      const events = [...state.current.events, { phase, message, elapsed }];
      state.current = { ...state.current, phase, events };
    },
    setCycle(n) { state.current = { ...state.current, cycle: n }; },
    setTotalCost(cost) { state.current = { ...state.current, totalCost: cost }; },
    stop() { unmount(); },
  };
}
```

---

### `cli.ts`

Commander replaces Typer. All six commands (`build`, `setup`, `sessions`, `resume`, `logs`, `prompts`) are preserved with identical option signatures.

```typescript
import { Command } from "commander";
import { loadKeys } from "./config.js";
import { Session } from "./session.js";
import { Overseer } from "./overseer.js";
import { startLiveFeed } from "./ui/liveFeed.js";
import { Phase } from "./stateMachine.js";

const program = new Command("forgecli").description("Idea to product in one command.");

program
  .command("build <idea>")
  .option("-d, --deploy <target>", "Deploy target: vercel, railway, fly.io")
  .option("--max-cycles <n>", "Max fix iterations", "5")
  .action(async (idea: string, opts: { deploy?: string; maxCycles: string }) => {
    loadKeys();
    const session = Session.create(idea, opts.deploy);
    const feed = startLiveFeed(idea);

    const onEvent = (message: string) => {
      feed.setOverseer(message);
      feed.pushEvent(session.phase, message);
      feed.setCycle(session.cycle);
      feed.setTotalCost(session.db.getTotalCost(session.id));
      for (const task of session.db.getTasks(session.id)) {
        feed.updateTask(String(task["id"]), String(task["title"]), String(task["status"]));
      }
    };

    const overseer = new Overseer(session, onEvent);
    try {
      await overseer.run();
    } finally {
      feed.stop();
    }

    if (session.phase === Phase.DONE) {
      console.log(`\n✓ Done! Workspace: ${session.workspace}`);
    } else {
      console.log(`\nStopped at phase: ${session.phase}`);
    }
  });

program.command("setup").action(async () => {
  const { runSetupWizard } = await import("./config.js");
  await runSetupWizard();
});

program.command("sessions").action(async () => {
  const { listSessions } = await import("./commands/sessions.js");
  await listSessions();
});

program.command("resume [sessionId]").action(async (sessionId?: string) => {
  loadKeys();
  const session = sessionId ? Session.load(sessionId) : Session.loadLast();
  const overseer = new Overseer(session, msg => console.log(` ${msg}`));
  await overseer.run();
});

program.command("logs [sessionId]").action(async (sessionId?: string) => {
  const { showLogs } = await import("./commands/logs.js");
  await showLogs(sessionId);
});

program
  .command("prompts [sessionId]")
  .option("-f, --follow", "Stream new entries in real-time")
  .option("-v, --verbose", "Show full prompt and response text")
  .action(async (sessionId?: string, opts?: { follow?: boolean; verbose?: boolean }) => {
    const { showPrompts } = await import("./commands/prompts.js");
    await showPrompts(sessionId, opts);
  });

program.parseAsync(process.argv).catch(err => {
  console.error(`\nError: ${err.message}`);
  console.error("Session saved — resume with: forgecli resume");
  process.exit(1);
});
```

---

## Error Handling

Custom error types replace Python's ad-hoc exceptions:

```typescript
export class InvalidTransitionError extends Error {
  constructor(msg: string) { super(msg); this.name = "InvalidTransitionError"; }
}
export class LLMTimeoutError extends Error {
  constructor(secs: number, model: string) {
    super(`LLM call timed out after ${secs}s (model: ${model})`);
    this.name = "LLMTimeoutError";
  }
}
export class WorkspaceEscapeError extends Error {}
export class SessionNotFoundError extends Error {}
```

The Python `_stop_requested` flag (a PEP 479 workaround for `StopIteration` inside coroutines) disappears entirely — TypeScript throws and catches cleanly with no special-casing needed.

LLM timeout uses `Promise.race` rather than `asyncio.wait_for`:

```typescript
const timeout = new Promise<never>((_, reject) =>
  setTimeout(() => reject(new LLMTimeoutError(timeoutMs / 1000, modelId)), timeoutMs)
);
return Promise.race([this.callLLM(tier, messages), timeout]);
```

---

## Testing

### Configuration

```typescript
// jest.config.ts
export default {
  preset: "ts-jest",
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts", ".tsx"],
  moduleNameMapper: { "^(\\.{1,2}/.*)\\.js$": "$1" },
  testMatch: ["**/tests/**/*.test.ts"],
};
```

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src-ts",
    "strict": true,
    "esModuleInterop": true,
    "jsx": "react",
    "skipLibCheck": true
  }
}
```

### Patterns

**Unit tests** — `jest.mock` replaces `pytest-mock`:

```typescript
jest.mock("../src-ts/router.js");

test("IdeationAgent returns spec on success", async () => {
  const mockRouter = new LLMRouter() as jest.Mocked<LLMRouter>;
  mockRouter.complete.mockResolvedValue({
    content: JSON.stringify({ name: "test-app", description: "..." }),
    model: "claude-haiku", tokensIn: 100, tokensOut: 50, costUsd: 0.001,
  });
  const db = new ForgeDb(":memory:");
  const agent = new IdeationAgent(mockRouter, db, "session-1");
  const result = await agent.run({ idea: "a todo app", conversation: [] });
  expect(result.success).toBe(true);
  expect(JSON.parse(result.output).name).toBe("test-app");
});
```

**DB tests** — `better-sqlite3` supports `:memory:`:

```typescript
test("createSession returns an 8-char ID", () => {
  const db = new ForgeDb(":memory:");
  const id = db.createSession("build a todo app");
  expect(id).toHaveLength(8);
  expect(db.getSession(id)?.["phase"]).toBe("IDEATION");
});
```

**State machine tests** — no mocking needed:

```typescript
test("valid transition succeeds", () => {
  expect(transition(Phase.IDEATION, Phase.ARCHITECTURE)).toBe(Phase.ARCHITECTURE);
});
test("invalid transition throws", () => {
  expect(() => transition(Phase.IDEATION, Phase.CODING)).toThrow(InvalidTransitionError);
});
```

---

## Distribution (Homebrew)

The Homebrew formula changes from pulling a Python tarball + running `uv pip install` to pulling a Node.js tarball and running `npm ci && npm run build`. The compiled `dist/cli.js` becomes the bin target. The user-facing `forgecli` command is unchanged.

Session data at `~/.forge/sessions/` is forward-compatible because the SQLite schema is identical.

---

## Migration Sequence

1. Add `package.json`, `tsconfig.json`, `jest.config.ts` to repo root — Python still works.
2. Port in dependency order (no file depends on files above it in this list):
   - `stateMachine.ts`
   - `db.ts`
   - `router.ts`
   - `config.ts`
   - `modelFetch.ts`
   - `promptLog.ts`
   - `session.ts`
   - `tools/definitions.ts`
   - `tools/executor.ts`
   - `agents/base.ts`
   - `agents/ideation.ts`, `architecture.ts`, `taskGraph.ts`, `review.ts`, `deploy.ts` (one-shot agents — simpler)
   - `agents/coding.ts`, `integration.ts`, `testAgent.ts`, `verification.ts` (agentic loop agents)
   - `overseer.ts`
   - `ui/interrupt.ts`
   - `ui/liveFeed.tsx`
   - `cli.ts`
3. Write Jest tests alongside each module as it is ported.
4. Smoke-test `forgecli build "a hello world web page"` end-to-end.
5. Cutover: delete `src/forge/` and `pyproject.toml`, rename `src-ts/` → `src/`.
6. Update Homebrew formula.
