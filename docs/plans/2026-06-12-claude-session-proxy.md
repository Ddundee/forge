# Claude Session Proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace forge's one-shot `claude -p` driver with persistent Claude Code sessions driven through the Claude Agent SDK — one long-lived main session per build plus short-lived worker sessions for parallel coding tasks — with real cost accounting, live events, safety guards, and attach/watch tooling.

**Architecture:** A new `src/claudeSession.ts` wraps the SDK's `query()` streaming-input mode behind a forge-owned `ClaudeSession.send()` queue (one in-flight turn per session, result-message correlation). A `ClaudeSessionManager` (one per `Overseer` run) owns the main/worker sessions and is threaded through `BaseAgent`. The homegrown tool loop remains the path for API-model profiles; codex is untouched.

**Tech Stack:** TypeScript (ESM, `"type": "module"`), `@anthropic-ai/claude-agent-sdk`, `node:sqlite`, jest + ts-jest, commander.

**Source of truth:** `docs/superpowers/specs/2026-06-12-claude-session-proxy-master-for-claude-code.md` (the annotated master). Its Implementation Checklist maps onto the tasks below.

**Known deviations from the master spec (intentional):**
1. `ClaudeSessionManager.main()` / `.worker()` return `Promise<ClaudeSession>` (master sketched them sync). Reason: the SDK is loaded via lazy dynamic `import()` so non-Claude profiles never pay the load cost, and concurrent first calls (parallel review agents) need promise memoization to avoid double-creating the main session.
2. The env-gated smoke test is a standalone node script (`scripts/claude-session-smoke.mjs`), not a jest test. Reason: the SDK is ESM-only and this repo's jest runs ts-jest in CJS mode; `import()` of an ESM-only package inside jest transpiles to `require()` and fails with `ERR_REQUIRE_ESM`. Production code is unaffected (dist is ESM). All unit tests inject a fake `query()` and never load the SDK.
3. `forgecli watch` reads transcripts from `~/.claude/projects/*/<session-id>.jsonl` (located via the recorded claude session id) instead of SDK `listSessions()`/`getSessionMessages()`. Reason: those SDK lookup APIs are methods on a live `Query` object in the installed SDK surface we verified — there is no standalone export to call without starting a session. The forge DB (`claude_sessions` table) is the stable lookup; the glob is only for live tailing, which the master permits.

**Verify the installed SDK before relying on plan assumptions:** Task 1 adds a probe that asserts `query` exists. During Task 5, also open `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` and confirm: `query({prompt: string | AsyncIterable<SDKUserMessage>, options}): Query`, `Query.interrupt()`, result messages carry `total_cost_usd`/`usage`, and the `PermissionResult` deny shape. If the installed surface differs, adjust `src/claudeSession.ts` (the only file that touches the SDK) and note it in the commit message.

---

### Task 1: Add the Agent SDK dependency with an import probe

**Files:**
- Modify: `package.json`
- Test: `tests/claudeSdk.probe.test.ts`

- [ ] **Step 1: Write the failing probe test**

```typescript
// tests/claudeSdk.probe.test.ts
import { spawnSync } from "child_process";

// The SDK is ESM-only; jest's CJS transform cannot import it directly.
// Probe it in a real node ESM context instead.
test("claude-agent-sdk is installed and exposes query()", () => {
  const res = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "const m = await import('@anthropic-ai/claude-agent-sdk'); process.exit(typeof m.query === 'function' ? 0 : 1);",
    ],
    { encoding: "utf8" },
  );
  expect(res.status).toBe(0);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- tests/claudeSdk.probe.test.ts`
Expected: FAIL — exit status 1 (module not found).

- [ ] **Step 3: Install the dependency**

Run: `npm install @anthropic-ai/claude-agent-sdk`
Expected: package.json gains `"@anthropic-ai/claude-agent-sdk"` under `dependencies`; a platform binary optional dependency appears in the lockfile.

- [ ] **Step 4: Run the probe to verify it passes**

Run: `npm test -- tests/claudeSdk.probe.test.ts`
Expected: PASS

- [ ] **Step 5: Inspect the installed SDK surface and record the version**

Run: `node -e "console.log(require('./node_modules/@anthropic-ai/claude-agent-sdk/package.json').version)"`
Then skim `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` for `query(`, `interrupt(`, `SDKUserMessage`, `PermissionResult`. Note the version in the commit message.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tests/claudeSdk.probe.test.ts
git commit -m "feat: add @anthropic-ai/claude-agent-sdk dependency with import probe"
```

---

### Task 2: Shared bash safety helper

**Files:**
- Create: `src/safety.ts`
- Modify: `src/tools/executor.ts:5-13`
- Test: `tests/safety.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/safety.test.ts
import { isBlockedCommand, BLOCKED_PATTERNS } from "../src/safety.js";

test("blocks dangerous commands case-insensitively", () => {
  expect(isBlockedCommand("rm -rf /")).toBe(true);
  expect(isBlockedCommand("RM -RF /")).toBe(true);
  expect(isBlockedCommand("echo hi && sudo rm -rf /tmp/x")).toBe(true);
  expect(isBlockedCommand("dd if=/dev/zero of=/dev/disk0")).toBe(true);
});

test("allows ordinary commands", () => {
  expect(isBlockedCommand("npm test")).toBe(false);
  expect(isBlockedCommand("rm -rf node_modules")).toBe(false);
  expect(isBlockedCommand("git status")).toBe(false);
});

test("pattern list is non-empty", () => {
  expect(BLOCKED_PATTERNS.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- tests/safety.test.ts`
Expected: FAIL — cannot find module `../src/safety.js`.

- [ ] **Step 3: Create `src/safety.ts`** (moved verbatim from `src/tools/executor.ts:5-13`)

```typescript
// src/safety.ts
export const BLOCKED_PATTERNS = [
  "rm -rf /", "rm -rf ~", ":(){ :|:& };:", "dd if=/dev/zero",
  "mkfs", "> /dev/sda", "chmod 777 /", "chown -R", "sudo rm", "sudo dd",
];

export function isBlockedCommand(command: string): boolean {
  const lower = command.toLowerCase();
  return BLOCKED_PATTERNS.some(p => lower.includes(p));
}
```

- [ ] **Step 4: Use it from `src/tools/executor.ts`**

Delete lines 5-13 of `src/tools/executor.ts` (the local `BLOCKED_PATTERNS` const and `isBlocked` function) and add the import; update the one call site:

```typescript
import { isBlockedCommand } from "../safety.js";
```

In `bashExec`, change `if (isBlocked(command))` to `if (isBlockedCommand(command))`.

- [ ] **Step 5: Run safety tests plus the existing executor tests**

Run: `npm test -- tests/safety.test.ts tests/tools`
Expected: PASS (executor behavior unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/safety.ts src/tools/executor.ts tests/safety.test.ts
git commit -m "refactor: extract shared bash safety blocklist into src/safety.ts"
```

---

### Task 3: Database — `claude_sessions` table, cache-token columns, accessors

**Files:**
- Modify: `src/db.ts`
- Test: `tests/dbClaudeSessions.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/dbClaudeSessions.test.ts
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ForgeDb } from "../src/db.js";

function makeDb(): { db: ForgeDb; sid: string } {
  const db = new ForgeDb(":memory:");
  const sid = db.createSession("test idea");
  return { db, sid };
}

test("claude session lifecycle: create, find, update, list", () => {
  const { db, sid } = makeDb();
  const id = db.createClaudeSession(sid, "main", "/tmp/ws", { permissionMode: "default" });
  let row = db.findClaudeSession(sid, "main");
  expect(row?.["status"]).toBe("starting");
  expect(row?.["cwd"]).toBe("/tmp/ws");
  expect(row?.["permission_mode"]).toBe("default");

  db.updateClaudeSession(id, { claude_session_id: "abc-123", status: "running", model: "claude-sonnet-4-6" });
  row = db.findClaudeSession(sid, "main");
  expect(row?.["claude_session_id"]).toBe("abc-123");
  expect(row?.["status"]).toBe("running");

  db.createClaudeSession(sid, "worker:t1", "/tmp/ws/tasks/t1");
  expect(db.listClaudeSessions(sid)).toHaveLength(2);
  expect(db.findClaudeSession(sid, "worker:t1")?.["role"]).toBe("worker:t1");
});

test("findClaudeSession returns the most recent row for a role", () => {
  const { db, sid } = makeDb();
  db.createClaudeSession(sid, "main", "/tmp/a");
  // Force distinct created_at ordering via direct update on the second row.
  const second = db.createClaudeSession(sid, "main", "/tmp/b");
  db.updateClaudeSession(second, { created_at: "2999-01-01T00:00:00.000Z" });
  expect(db.findClaudeSession(sid, "main")?.["cwd"]).toBe("/tmp/b");
});

test("logLlmCall stores cache token columns and provider override", () => {
  const { db, sid } = makeDb();
  db.logLlmCall(sid, {
    model: "claude-sonnet-4-6", provider: "claude-agent-sdk",
    tokensIn: 15, tokensOut: 5, costUsd: 0.05,
    cacheRead: 3, cacheWrite: 2, response: "hi",
  });
  const calls = db.getLlmCalls(sid);
  expect(calls).toHaveLength(1);
  expect(calls[0]["provider"]).toBe("claude-agent-sdk");
  expect(calls[0]["cache_read_tokens"]).toBe(3);
  expect(calls[0]["cache_write_tokens"]).toBe(2);
});

test("logLlmCall without cache fields defaults to 0 and derived provider", () => {
  const { db, sid } = makeDb();
  db.logLlmCall(sid, { model: "gemini/gemini-2.0-flash", tokensIn: 1, tokensOut: 1, costUsd: 0, response: "x" });
  const calls = db.getLlmCalls(sid);
  expect(calls[0]["provider"]).toBe("gemini");
  expect(calls[0]["cache_read_tokens"]).toBe(0);
});

test("getToolCalls returns logged tool calls", () => {
  const { db, sid } = makeDb();
  db.logToolCall(sid, undefined, "Bash", { command: "ls" }, "(executed by Claude Code)");
  const calls = db.getToolCalls(sid);
  expect(calls).toHaveLength(1);
  expect(calls[0]["tool_name"]).toBe("Bash");
});

test("re-opening an existing database is idempotent (column migration safe)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-db-test-"));
  const dbPath = path.join(dir, "session.db");
  new ForgeDb(dbPath).close();
  expect(() => new ForgeDb(dbPath).close()).not.toThrow();
  fs.rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- tests/dbClaudeSessions.test.ts`
Expected: FAIL — `createClaudeSession is not a function`.

- [ ] **Step 3: Extend the schema in `src/db.ts`**

In the `SCHEMA` template string: add the two cache columns to `llm_calls` (after `cost_usd REAL NOT NULL DEFAULT 0.0,`):

```sql
    cache_read_tokens INTEGER NOT NULL DEFAULT 0,
    cache_write_tokens INTEGER NOT NULL DEFAULT 0,
```

Append the new table and indexes before the `CREATE INDEX` block:

```sql
CREATE TABLE IF NOT EXISTS claude_sessions (
    id TEXT PRIMARY KEY,
    forge_session_id TEXT NOT NULL REFERENCES sessions(id),
    role TEXT NOT NULL,
    claude_session_id TEXT,
    cwd TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'starting',
    model TEXT,
    permission_mode TEXT,
    transcript_path TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    closed_at TEXT
);
```

And with the other indexes:

```sql
CREATE INDEX IF NOT EXISTS idx_claude_sessions_forge
  ON claude_sessions(forge_session_id, role, created_at);
CREATE INDEX IF NOT EXISTS idx_claude_sessions_claude
  ON claude_sessions(claude_session_id);
```

- [ ] **Step 4: Add the migration helper and call it from the constructor**

`CREATE TABLE IF NOT EXISTS` ignores new columns on existing DBs, so after `this.db.exec(SCHEMA);` in the constructor add:

```typescript
    this.ensureColumn("llm_calls", "cache_read_tokens", "cache_read_tokens INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("llm_calls", "cache_write_tokens", "cache_write_tokens INTEGER NOT NULL DEFAULT 0");
```

And the private method:

```typescript
  /** SQLite has no ADD COLUMN IF NOT EXISTS; check pragma first so old session DBs migrate safely. */
  private ensureColumn(table: string, column: string, ddl: string): void {
    const cols = this.db.prepare(`PRAGMA table_info(${table})`).all() as { name?: string }[];
    if (!cols.some((c) => c.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    }
  }
```

- [ ] **Step 5: Extend `logLlmCall` and add the new methods**

Replace `logLlmCall` with:

```typescript
  logLlmCall(
    sessionId: string,
    data: {
      model: string; tokensIn: number; tokensOut: number; costUsd: number; response: string;
      cacheRead?: number; cacheWrite?: number; provider?: string;
    },
    taskId?: string,
  ): void {
    this.db.prepare(
      "INSERT INTO llm_calls (id, task_id, session_id, provider, model, tokens_in, tokens_out, cost_usd, cache_read_tokens, cache_write_tokens, response, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(...bindValues([logId(), taskId ?? null, sessionId, data.provider ?? data.model.split("/")[0], data.model,
      data.tokensIn, data.tokensOut, data.costUsd, data.cacheRead ?? 0, data.cacheWrite ?? 0, data.response, now()]));
  }
```

Add after `logToolCall`:

```typescript
  getLlmCalls(sessionId: string): Record<string, unknown>[] {
    return this.db.prepare(
      "SELECT * FROM llm_calls WHERE session_id = ? ORDER BY created_at"
    ).all(sessionId) as any[];
  }

  getToolCalls(sessionId: string): Record<string, unknown>[] {
    return this.db.prepare(
      "SELECT * FROM tool_calls WHERE session_id = ? ORDER BY created_at"
    ).all(sessionId) as any[];
  }

  createClaudeSession(
    forgeSessionId: string,
    role: string,
    cwd: string,
    fields: { model?: string; permissionMode?: string } = {},
  ): string {
    const id = logId();
    this.db.prepare(
      "INSERT INTO claude_sessions (id, forge_session_id, role, cwd, status, model, permission_mode, created_at, updated_at) VALUES (?, ?, ?, ?, 'starting', ?, ?, ?, ?)"
    ).run(...bindValues([id, forgeSessionId, role, cwd, fields.model ?? null, fields.permissionMode ?? null, now(), now()]));
    return id;
  }

  updateClaudeSession(id: string, fields: Record<string, unknown>): void {
    const sets = Object.keys(fields).map(k => `${k} = ?`).join(", ");
    this.db.prepare(`UPDATE claude_sessions SET ${sets}, updated_at = ? WHERE id = ?`)
      .run(...bindValues([...Object.values(fields), now(), id]));
  }

  listClaudeSessions(forgeSessionId?: string): Record<string, unknown>[] {
    if (forgeSessionId) {
      return this.db.prepare(
        "SELECT * FROM claude_sessions WHERE forge_session_id = ? ORDER BY created_at"
      ).all(forgeSessionId) as any[];
    }
    return this.db.prepare("SELECT * FROM claude_sessions ORDER BY created_at").all() as any[];
  }

  findClaudeSession(forgeSessionId: string, role: string): Record<string, unknown> | undefined {
    return this.db.prepare(
      "SELECT * FROM claude_sessions WHERE forge_session_id = ? AND role = ? ORDER BY created_at DESC LIMIT 1"
    ).get(forgeSessionId, role) as any;
  }
```

- [ ] **Step 6: Run the new tests plus existing db tests**

Run: `npm test -- tests/dbClaudeSessions.test.ts tests/db.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/db.ts tests/dbClaudeSessions.test.ts
git commit -m "feat(db): claude_sessions table, cache token columns, accessors"
```

---

### Task 4: `MessageStream` — pushable async iterable

**Files:**
- Create: `src/claudeSession.ts` (types + MessageStream only in this task)
- Test: `tests/claudeSession.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/claudeSession.test.ts
import { MessageStream, type SdkUserMessage } from "../src/claudeSession.js";

function userMsg(content: string): SdkUserMessage {
  return { type: "user", message: { role: "user", content }, parent_tool_use_id: null, session_id: "" };
}

describe("MessageStream", () => {
  test("yields pushed messages in order", async () => {
    const stream = new MessageStream();
    stream.push(userMsg("a"));
    stream.push(userMsg("b"));
    stream.end();
    const seen: string[] = [];
    for await (const m of stream) seen.push(m.message.content);
    expect(seen).toEqual(["a", "b"]);
  });

  test("waits for messages pushed after iteration starts", async () => {
    const stream = new MessageStream();
    const collected = (async () => {
      const seen: string[] = [];
      for await (const m of stream) seen.push(m.message.content);
      return seen;
    })();
    stream.push(userMsg("late"));
    stream.end();
    await expect(collected).resolves.toEqual(["late"]);
  });

  test("push after end throws", () => {
    const stream = new MessageStream();
    stream.end();
    expect(() => stream.push(userMsg("x"))).toThrow("closed");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- tests/claudeSession.test.ts`
Expected: FAIL — cannot find module `../src/claudeSession.js`.

- [ ] **Step 3: Create `src/claudeSession.ts` with types and MessageStream**

```typescript
// src/claudeSession.ts
import { ForgeDb } from "./db.js";
import type { LiveEventFn } from "./agents/base.js";
import { isBlockedCommand } from "./safety.js";

// Minimal structural view of the Agent SDK surface. The SDK is loaded via
// dynamic import (loadSdkQuery) and injected everywhere else, so unit tests
// never touch the real package and the SDK contact surface stays in one file.
export type SdkMessage = Record<string, unknown>;

export interface SdkUserMessage {
  type: "user";
  message: { role: "user"; content: string };
  parent_tool_use_id: null;
  session_id: string;
}

export interface SdkQuery extends AsyncIterable<SdkMessage> {
  interrupt(): Promise<void>;
}

export type SdkQueryFn = (params: {
  prompt: AsyncIterable<SdkUserMessage>;
  options: Record<string, unknown>;
}) => SdkQuery;

export async function loadSdkQuery(): Promise<SdkQueryFn> {
  const mod = await import("@anthropic-ai/claude-agent-sdk");
  return mod.query as unknown as SdkQueryFn;
}

/** Pushable AsyncIterable bridging ClaudeSession.send() to the SDK's streaming prompt input. */
export class MessageStream implements AsyncIterable<SdkUserMessage> {
  private queue: SdkUserMessage[] = [];
  private waiters: ((r: IteratorResult<SdkUserMessage>) => void)[] = [];
  private closed = false;

  push(msg: SdkUserMessage): void {
    if (this.closed) throw new Error("MessageStream is closed");
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value: msg, done: false });
    else this.queue.push(msg);
  }

  end(): void {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined as never, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<SdkUserMessage> {
    return {
      next: (): Promise<IteratorResult<SdkUserMessage>> => {
        if (this.queue.length) return Promise.resolve({ value: this.queue.shift()!, done: false });
        if (this.closed) return Promise.resolve({ value: undefined as never, done: true });
        return new Promise((resolve) => this.waiters.push(resolve));
      },
    };
  }
}
```

Note: `import type { LiveEventFn }` is type-only, so the base↔claudeSession import cycle is erased at runtime. `ForgeDb` and `isBlockedCommand` are used starting Tasks 5 and 8; the unused-import compile error until then is avoided because Task 5 lands in the same PR — if running strict per-task builds, add them in Task 5 instead.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/claudeSession.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/claudeSession.ts tests/claudeSession.test.ts
git commit -m "feat: MessageStream pushable iterable for Claude session input"
```

---

### Task 5: `ClaudeSession` core — send queue, init capture, usage mapping, llm logging

**Files:**
- Modify: `src/claudeSession.ts`
- Test: `tests/claudeSession.test.ts`

- [ ] **Step 1: Add the FakeSdk helper and failing tests to `tests/claudeSession.test.ts`**

```typescript
// Append imports at top of tests/claudeSession.test.ts:
import { ForgeDb } from "../src/db.js";
import { ClaudeSession, type SdkMessage } from "../src/claudeSession.js";

// Append below the MessageStream tests:

/** Scriptable stand-in for the SDK query(): records pushed user messages, emits scripted SdkMessages. */
class FakeSdk {
  received: SdkUserMessage[] = [];
  interrupted = false;
  onMessage?: (m: SdkUserMessage) => void;
  private out: SdkMessage[] = [];
  private waiters: { resolve: (r: IteratorResult<SdkMessage>) => void; reject: (e: Error) => void }[] = [];
  private done = false;
  private error?: Error;

  emit(msg: SdkMessage): void {
    const w = this.waiters.shift();
    if (w) w.resolve({ value: msg, done: false });
    else this.out.push(msg);
  }

  finish(): void {
    this.done = true;
    for (const w of this.waiters.splice(0)) w.resolve({ value: undefined as never, done: true });
  }

  crash(err: Error): void {
    this.error = err;
    for (const w of this.waiters.splice(0)) w.reject(err);
  }

  queryFn = (params: { prompt: AsyncIterable<SdkUserMessage>; options: Record<string, unknown> }) => {
    void (async () => {
      for await (const m of params.prompt) {
        this.received.push(m);
        this.onMessage?.(m);
      }
      this.finish(); // input stream ended → process exits
    })();
    const self = this;
    return {
      interrupt: async () => { self.interrupted = true; },
      [Symbol.asyncIterator]() {
        return {
          next: (): Promise<IteratorResult<SdkMessage>> => {
            if (self.out.length) return Promise.resolve({ value: self.out.shift()!, done: false });
            if (self.error) return Promise.reject(self.error);
            if (self.done) return Promise.resolve({ value: undefined as never, done: true });
            return new Promise((resolve, reject) => self.waiters.push({ resolve, reject }));
          },
        };
      },
    };
  };
}

const INIT: SdkMessage = { type: "system", subtype: "init", session_id: "abc-123", model: "claude-sonnet-4-6" };

function successResult(text: string, totalCost = 0.01): SdkMessage {
  return {
    type: "result", subtype: "success", result: text, session_id: "abc-123",
    total_cost_usd: totalCost,
    usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 2, cache_read_input_tokens: 3 },
  };
}

const tick = () => new Promise((r) => setImmediate(r));

function makeSession(fake: FakeSdk, opts: { onLiveEvent?: jest.Mock; taskId?: string } = {}) {
  const db = new ForgeDb(":memory:");
  const forgeSessionId = db.createSession("test idea");
  const session = new ClaudeSession({
    queryFn: fake.queryFn, db, forgeSessionId, role: "main", cwd: "/tmp",
    onLiveEvent: opts.onLiveEvent, taskId: opts.taskId,
  });
  return { session, db, forgeSessionId };
}

describe("ClaudeSession core", () => {
  test("records a claude_sessions row and captures session id from init", async () => {
    const fake = new FakeSdk();
    const { session, db, forgeSessionId } = makeSession(fake);
    expect(db.findClaudeSession(forgeSessionId, "main")?.["status"]).toBe("starting");
    fake.emit(INIT);
    await tick();
    expect(session.sessionId).toBe("abc-123");
    const row = db.findClaudeSession(forgeSessionId, "main");
    expect(row?.["claude_session_id"]).toBe("abc-123");
    expect(row?.["status"]).toBe("running");
    expect(row?.["model"]).toBe("claude-sonnet-4-6");
  });

  test("send resolves with mapped usage from the result message", async () => {
    const fake = new FakeSdk();
    fake.onMessage = () => fake.emit(successResult("done", 0.05));
    const { session, db, forgeSessionId } = makeSession(fake);
    fake.emit(INIT);
    const result = await session.send("do the thing");
    expect(result).toEqual({
      text: "done", model: "claude-sonnet-4-6",
      tokensIn: 15, tokensOut: 5, cacheRead: 3, cacheWrite: 2, costUsd: 0.05,
    });
    const calls = db.getLlmCalls(forgeSessionId);
    expect(calls).toHaveLength(1);
    expect(calls[0]["provider"]).toBe("claude-agent-sdk");
    expect(calls[0]["cache_read_tokens"]).toBe(3);
    expect(db.getTotalCost(forgeSessionId)).toBeCloseTo(0.05);
  });

  test("costUsd is the per-turn delta of cumulative total_cost_usd", async () => {
    const fake = new FakeSdk();
    let n = 0;
    fake.onMessage = () => fake.emit(successResult(`r${++n}`, n === 1 ? 0.01 : 0.03));
    const { session } = makeSession(fake);
    const first = await session.send("one");
    const second = await session.send("two");
    expect(first.costUsd).toBeCloseTo(0.01);
    expect(second.costUsd).toBeCloseTo(0.02);
  });

  test("sends serialize: second user message is not pushed until first turn resolves", async () => {
    const fake = new FakeSdk();
    const { session } = makeSession(fake);
    const p1 = session.send("one");
    const p2 = session.send("two");
    await tick();
    expect(fake.received).toHaveLength(1);
    fake.emit(successResult("r1", 0.01));
    await p1;
    await tick();
    expect(fake.received).toHaveLength(2);
    fake.emit(successResult("r2", 0.02));
    await expect(p2).resolves.toMatchObject({ text: "r2" });
  });

  test("send attaches taskId to the logged llm call", async () => {
    const fake = new FakeSdk();
    fake.onMessage = () => fake.emit(successResult("ok"));
    const { session, db, forgeSessionId } = makeSession(fake);
    await session.send("x", { taskId: "task-9" });
    expect(db.getLlmCalls(forgeSessionId)[0]["task_id"]).toBe("task-9");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- tests/claudeSession.test.ts`
Expected: FAIL — `ClaudeSession` is not exported.

- [ ] **Step 3: Implement the core of `ClaudeSession` in `src/claudeSession.ts`**

Append:

```typescript
export interface TurnResult {
  text: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd: number;
}

export interface ClaudeSessionDeps {
  queryFn: SdkQueryFn;
  db: ForgeDb;
  forgeSessionId: string;
  role: string; // "main" | `worker:<taskId>`
  cwd: string;
  onLiveEvent?: LiveEventFn;
  taskId?: string;
}

interface Pending {
  resolve: (r: TurnResult) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  taskId?: string;
}

export class ClaudeSession {
  readonly role: string;
  readonly cwd: string;
  readonly recordId: string;
  sessionId?: string;

  private stream = new MessageStream();
  private query: SdkQuery;
  private readLoop: Promise<void>;
  private pending?: Pending;
  private chain: Promise<unknown> = Promise.resolve();
  private lastTotalCostUsd = 0;
  private model = "claude-code";
  private failure?: Error;
  private closed = false;

  constructor(private deps: ClaudeSessionDeps) {
    this.role = deps.role;
    this.cwd = deps.cwd;
    const permissionMode = process.env["FORGE_CLAUDE_CODE_PERMISSION_MODE"] ?? "default";
    this.recordId = deps.db.createClaudeSession(deps.forgeSessionId, deps.role, deps.cwd, { permissionMode });
    this.query = deps.queryFn({
      prompt: this.stream,
      options: {
        cwd: deps.cwd,
        permissionMode,
        maxTurns: Number(process.env["FORGE_CLAUDE_CODE_MAX_TURNS"] ?? 40),
        // The SDK loads no filesystem settings or CLAUDE.md by default; opt in
        // to the Claude Code preset and project-level settings only, keeping
        // builds deterministic w.r.t. the user's personal ~/.claude config.
        systemPrompt: { type: "preset", preset: "claude_code" },
        settingSources: ["project"],
        canUseTool: buildCanUseTool(),
      },
    });
    this.readLoop = this.consume();
  }

  send(text: string, opts: { timeoutMs?: number; taskId?: string } = {}): Promise<TurnResult> {
    const timeoutMs = opts.timeoutMs ?? Number(process.env["FORGE_CLAUDE_CODE_TIMEOUT_MS"] ?? 300_000);
    const turn = this.chain.then(() => this.sendTurn(text, timeoutMs, opts.taskId));
    this.chain = turn.catch(() => {});
    return turn;
  }

  private sendTurn(text: string, timeoutMs: number, taskId?: string): Promise<TurnResult> {
    if (this.failure) return Promise.reject(this.failure);
    if (this.closed) return Promise.reject(new Error("Claude session is closed"));
    return new Promise<TurnResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = undefined;
        void this.interrupt();
        reject(new Error(`Claude session turn timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);
      this.pending = { resolve, reject, timer, taskId };
      this.stream.push({
        type: "user",
        message: { role: "user", content: text },
        parent_tool_use_id: null,
        session_id: this.sessionId ?? "",
      });
    });
  }

  async interrupt(): Promise<void> {
    try { await this.query.interrupt(); } catch {}
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.stream.end();
    await Promise.race([this.readLoop, new Promise((r) => setTimeout(r, 5_000))]);
    this.deps.db.updateClaudeSession(this.recordId, {
      status: this.failure ? "failed" : "closed",
      closed_at: new Date().toISOString(),
    });
  }

  private async consume(): Promise<void> {
    try {
      for await (const msg of this.query) this.handle(msg);
      this.fail(new Error("Claude session process exited"));
    } catch (e) {
      this.fail(e instanceof Error ? e : new Error(String(e)));
    }
  }

  private fail(error: Error): void {
    if (this.closed && !this.pending) return; // clean shutdown, nothing waiting
    if (!this.failure) this.failure = error;
    if (!this.closed) {
      this.deps.db.updateClaudeSession(this.recordId, { status: "failed", error: error.message });
    }
    const pending = this.pending;
    this.pending = undefined;
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
  }

  private handle(msg: SdkMessage): void {
    if (msg["type"] === "system" && msg["subtype"] === "init") {
      this.sessionId = String(msg["session_id"]);
      if (typeof msg["model"] === "string") this.model = msg["model"];
      this.deps.db.updateClaudeSession(this.recordId, {
        claude_session_id: this.sessionId, model: this.model, status: "running",
      });
      return;
    }
    if (msg["type"] === "assistant") { this.handleAssistant(msg); return; }
    if (msg["type"] === "result") { this.handleResult(msg); return; }
  }

  private handleAssistant(_msg: SdkMessage): void {
    // Implemented in the stream-parsing task.
  }

  private handleResult(msg: SdkMessage): void {
    // total_cost_usd is cumulative for the whole query() session; log the per-turn delta.
    const total = Number(msg["total_cost_usd"]);
    const totalCost = Number.isFinite(total) ? total : this.lastTotalCostUsd;
    const costUsd = Math.max(0, totalCost - this.lastTotalCostUsd);
    this.lastTotalCostUsd = totalCost;

    const pending = this.pending;
    this.pending = undefined;
    if (!pending) return; // e.g. result arriving after a timeout already rejected the turn
    clearTimeout(pending.timer);

    const subtype = String(msg["subtype"] ?? "success");
    const text = typeof msg["result"] === "string" ? msg["result"] : "";
    if (subtype !== "success") {
      pending.reject(new Error(`Claude session turn failed (${subtype}): ${text.slice(0, 500)}`));
      return;
    }
    const u = (msg["usage"] ?? {}) as Record<string, unknown>;
    const cacheRead = Number(u["cache_read_input_tokens"] ?? 0) || 0;
    const cacheWrite = Number(u["cache_creation_input_tokens"] ?? 0) || 0;
    const turn: TurnResult = {
      text,
      model: this.model,
      tokensIn: (Number(u["input_tokens"] ?? 0) || 0) + cacheRead + cacheWrite,
      tokensOut: Number(u["output_tokens"] ?? 0) || 0,
      cacheRead,
      cacheWrite,
      costUsd,
    };
    this.deps.db.logLlmCall(this.deps.forgeSessionId, {
      model: turn.model, provider: "claude-agent-sdk",
      tokensIn: turn.tokensIn, tokensOut: turn.tokensOut, costUsd: turn.costUsd,
      cacheRead, cacheWrite, response: turn.text,
    }, pending.taskId ?? this.deps.taskId);
    pending.resolve(turn);
  }
}

/** Placeholder until the permission-guard task; allows everything. Replaced in Task 8. */
export function buildCanUseTool(): unknown {
  return async (_toolName: string, input: Record<string, unknown>) => ({ behavior: "allow" as const, updatedInput: input });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/claudeSession.test.ts`
Expected: PASS (MessageStream + ClaudeSession core suites).

- [ ] **Step 5: Verify the installed SDK message shapes match the assumptions**

Open `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` and confirm: result messages carry `total_cost_usd`, `usage.input_tokens`, `usage.cache_creation_input_tokens`, `usage.cache_read_input_tokens`; the system init message carries `session_id` and `model`; user messages accept `{type, message:{role, content}, parent_tool_use_id, session_id}`. If any differ, fix the mapping in `handleResult`/`handle` and the test fixtures together.

- [ ] **Step 6: Commit**

```bash
git add src/claudeSession.ts tests/claudeSession.test.ts
git commit -m "feat: ClaudeSession persistent turn queue over Agent SDK streaming input"
```

---

### Task 6: Stream parsing — live events and tool-call logging

**Files:**
- Modify: `src/claudeSession.ts` (fill in `handleAssistant`)
- Test: `tests/claudeSession.test.ts`

- [ ] **Step 1: Write the failing tests** (append to `tests/claudeSession.test.ts`)

```typescript
describe("ClaudeSession stream parsing", () => {
  test("assistant text and tool_use blocks map to live events and tool_calls rows", async () => {
    const fake = new FakeSdk();
    const onLiveEvent = jest.fn();
    fake.onMessage = () => {
      fake.emit({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Working on it" },
            { type: "tool_use", id: "t1", name: "Bash", input: { command: "npm test --silent" } },
            { type: "tool_use", id: "t2", name: "Read", input: { file_path: "/ws/src/index.ts" } },
          ],
        },
      });
      fake.emit(successResult("done"));
    };
    const { session, db, forgeSessionId } = makeSession(fake, { onLiveEvent });
    await session.send("run tests", { taskId: "task-1" });

    expect(onLiveEvent).toHaveBeenCalledWith("llm", "Working on it");
    expect(onLiveEvent).toHaveBeenCalledWith("cmd", "npm test --silent");
    expect(onLiveEvent).toHaveBeenCalledWith("tool", "Read(/ws/src/index.ts)");

    const toolCalls = db.getToolCalls(forgeSessionId);
    expect(toolCalls).toHaveLength(2);
    expect(toolCalls[0]["tool_name"]).toBe("Bash");
    expect(toolCalls[0]["task_id"]).toBe("task-1");
    // Tool execution happens inside Claude Code; forge logs the invocation, not the result.
    expect(toolCalls[0]["tool_result"]).toBe("(executed by Claude Code)");
    expect(toolCalls[1]["tool_name"]).toBe("Read");
  });

  test("assistant messages without array content are ignored", async () => {
    const fake = new FakeSdk();
    fake.onMessage = () => {
      fake.emit({ type: "assistant", message: { content: "plain string" } });
      fake.emit(successResult("ok"));
    };
    const { session, db, forgeSessionId } = makeSession(fake);
    await expect(session.send("x")).resolves.toMatchObject({ text: "ok" });
    expect(db.getToolCalls(forgeSessionId)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- tests/claudeSession.test.ts`
Expected: FAIL — no live events emitted, zero tool_calls rows.

- [ ] **Step 3: Implement `handleAssistant`** (replace the placeholder body)

```typescript
  private handleAssistant(msg: SdkMessage): void {
    const content = (msg["message"] as Record<string, unknown> | undefined)?.["content"];
    if (!Array.isArray(content)) return;
    for (const block of content as Record<string, unknown>[]) {
      if (block?.["type"] === "text" && typeof block["text"] === "string" && block["text"].trim()) {
        this.deps.onLiveEvent?.("llm", (block["text"] as string).slice(0, 80));
      } else if (block?.["type"] === "tool_use") {
        const name = String(block["name"] ?? "tool");
        const input = (block["input"] ?? {}) as Record<string, unknown>;
        if (name === "Bash") {
          this.deps.onLiveEvent?.("cmd", String(input["command"] ?? "").slice(0, 80));
        } else {
          const target = input["file_path"] ?? input["path"] ?? input["pattern"] ?? "";
          this.deps.onLiveEvent?.("tool", `${name}(${String(target).slice(0, 50)})`);
        }
        this.deps.db.logToolCall(
          this.deps.forgeSessionId,
          this.pending?.taskId ?? this.deps.taskId,
          name,
          input,
          "(executed by Claude Code)",
        );
      }
    }
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/claudeSession.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/claudeSession.ts tests/claudeSession.test.ts
git commit -m "feat: map Claude session stream to forge live events and tool_calls"
```

---

### Task 7: Timeout, interrupt, error subtypes, crash, close

**Files:**
- Modify: `src/claudeSession.ts` (behavior already implemented in Task 5 — this task proves it)
- Test: `tests/claudeSession.test.ts`

- [ ] **Step 1: Write the failing/verifying tests** (append)

```typescript
describe("ClaudeSession failure handling", () => {
  test("timeout interrupts the query and rejects the send; session survives", async () => {
    const fake = new FakeSdk();
    const { session } = makeSession(fake);
    await expect(session.send("slow", { timeoutMs: 50 })).rejects.toThrow("timed out after 0.05s");
    expect(fake.interrupted).toBe(true);
    // Next turn still works on the same session.
    fake.onMessage = (m) => { if (m.message.content === "next") fake.emit(successResult("recovered")); };
    await expect(session.send("next")).resolves.toMatchObject({ text: "recovered" });
  });

  test("error result subtype rejects the send with the subtype", async () => {
    const fake = new FakeSdk();
    fake.onMessage = () => fake.emit({
      type: "result", subtype: "error_max_turns", result: "Reached max turns", total_cost_usd: 0.01, usage: {},
    });
    const { session } = makeSession(fake);
    await expect(session.send("x")).rejects.toThrow("error_max_turns");
  });

  test("stream crash rejects the pending send and marks the session failed", async () => {
    const fake = new FakeSdk();
    const { session, db, forgeSessionId } = makeSession(fake);
    const p = session.send("x");
    await tick();
    fake.crash(new Error("You've hit your session limit · resets 3pm"));
    await expect(p).rejects.toThrow("session limit");
    expect(db.findClaudeSession(forgeSessionId, "main")?.["status"]).toBe("failed");
    // Subsequent sends fail fast with the recorded failure.
    await expect(session.send("y")).rejects.toThrow("session limit");
  });

  test("close ends the input stream and marks the session closed", async () => {
    const fake = new FakeSdk();
    const { session, db, forgeSessionId } = makeSession(fake);
    await session.close();
    expect(db.findClaudeSession(forgeSessionId, "main")?.["status"]).toBe("closed");
    await expect(session.send("after close")).rejects.toThrow("closed");
  });

  test("result arriving after timeout is ignored but still advances the cost baseline", async () => {
    const fake = new FakeSdk();
    const { session } = makeSession(fake);
    await expect(session.send("a", { timeoutMs: 30 })).rejects.toThrow("timed out");
    fake.emit(successResult("late", 0.10)); // late result for the timed-out turn
    await tick();
    fake.onMessage = (m) => { if (m.message.content === "b") fake.emit(successResult("fresh", 0.12)); };
    const second = await session.send("b");
    expect(second.costUsd).toBeCloseTo(0.02); // baseline advanced to 0.10 by the late result
  });
});
```

- [ ] **Step 2: Run them**

Run: `npm test -- tests/claudeSession.test.ts`
Expected: PASS if Task 5's implementation is correct; if any fail, fix `sendTurn`/`fail`/`handleResult` until green. Known subtlety: `close()` must resolve even when the FakeSdk never emits anything (the `Promise.race` 5s guard covers a hung process; the fake's `finish()` fires when the input stream ends, so it resolves immediately).

- [ ] **Step 3: Commit**

```bash
git add tests/claudeSession.test.ts src/claudeSession.ts
git commit -m "test: ClaudeSession timeout, interrupt, error, crash, and close semantics"
```

---

### Task 8: `canUseTool` permission guard

**Files:**
- Modify: `src/claudeSession.ts` (replace the placeholder `buildCanUseTool`)
- Test: `tests/claudeSession.test.ts`

- [ ] **Step 1: Write the failing tests** (append; also add `buildCanUseTool` to the existing import from `../src/claudeSession.js`)

```typescript
describe("buildCanUseTool", () => {
  const canUseTool = buildCanUseTool() as (
    toolName: string, input: Record<string, unknown>,
  ) => Promise<{ behavior: string; message?: string; updatedInput?: unknown }>;

  test("denies blocked bash commands", async () => {
    const verdict = await canUseTool("Bash", { command: "sudo rm -rf /" });
    expect(verdict.behavior).toBe("deny");
    expect(verdict.message).toContain("blocked");
  });

  test("denies sandbox-disable unless explicitly enabled", async () => {
    const old = process.env["FORGE_ALLOW_UNSANDBOXED"];
    delete process.env["FORGE_ALLOW_UNSANDBOXED"];
    const denied = await canUseTool("Bash", { command: "ls", dangerouslyDisableSandbox: true });
    expect(denied.behavior).toBe("deny");
    process.env["FORGE_ALLOW_UNSANDBOXED"] = "1";
    const allowed = await canUseTool("Bash", { command: "ls", dangerouslyDisableSandbox: true });
    expect(allowed.behavior).toBe("allow");
    if (old === undefined) delete process.env["FORGE_ALLOW_UNSANDBOXED"];
    else process.env["FORGE_ALLOW_UNSANDBOXED"] = old;
  });

  test("allows ordinary bash and non-bash tools with updatedInput", async () => {
    const bash = await canUseTool("Bash", { command: "npm test" });
    expect(bash).toEqual({ behavior: "allow", updatedInput: { command: "npm test" } });
    const read = await canUseTool("Read", { file_path: "/x" });
    expect(read).toEqual({ behavior: "allow", updatedInput: { file_path: "/x" } });
  });
});
```

- [ ] **Step 2: Run them to verify the deny cases fail**

Run: `npm test -- tests/claudeSession.test.ts`
Expected: FAIL — placeholder allows everything.

- [ ] **Step 3: Implement the real guard** (replace the placeholder)

```typescript
/**
 * Hard forge override on top of Claude Code's own permission system: the
 * dangerous-command blocklist that guarded the homegrown bash_exec loop
 * must keep holding when Claude Code executes Bash itself.
 */
export function buildCanUseTool() {
  return async (toolName: string, input: Record<string, unknown>) => {
    if (toolName === "Bash") {
      const command = String(input["command"] ?? "");
      if (isBlockedCommand(command)) {
        // `interrupt` is honored by current SDK versions; harmless extra field otherwise.
        return { behavior: "deny" as const, message: `Forge safety: command blocked: ${command}`, interrupt: true };
      }
      if (input["dangerouslyDisableSandbox"] === true && process.env["FORGE_ALLOW_UNSANDBOXED"] !== "1") {
        return {
          behavior: "deny" as const,
          message: "Forge safety: disabling the sandbox is not permitted (set FORGE_ALLOW_UNSANDBOXED=1 to override)",
        };
      }
    }
    return { behavior: "allow" as const, updatedInput: input };
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/claudeSession.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/claudeSession.ts tests/claudeSession.test.ts
git commit -m "feat: hard-deny canUseTool guard porting forge's bash blocklist"
```

---

### Task 9: `ClaudeSessionManager`

**Files:**
- Modify: `src/claudeSession.ts`
- Test: `tests/claudeSessionManager.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/claudeSessionManager.test.ts
import { ForgeDb } from "../src/db.js";
import { ClaudeSessionManager, type SdkQueryFn } from "../src/claudeSession.js";

function setup() {
  const db = new ForgeDb(":memory:");
  const sid = db.createSession("idea");
  let loads = 0;
  let queries = 0;
  const queryFn: SdkQueryFn = (params) => {
    queries++;
    void (async () => { for await (const _ of params.prompt) { /* drain */ } })();
    return {
      interrupt: async () => {},
      [Symbol.asyncIterator]() {
        let done = false;
        return {
          next: () => done
            ? Promise.resolve({ value: undefined as never, done: true as const })
            : new Promise<IteratorResult<Record<string, unknown>>>((resolve) => {
                // Resolve done once the drain loop finishes (input ended).
                setTimeout(() => { done = true; resolve({ value: undefined as never, done: true }); }, 10);
              }),
        };
      },
    };
  };
  const loadQueryFn = async () => { loads++; return queryFn; };
  const manager = new ClaudeSessionManager(db, sid, "/tmp/ws", undefined, loadQueryFn);
  return { db, sid, manager, counts: { get loads() { return loads; }, get queries() { return queries; } } };
}

test("main() is memoized — concurrent calls share one session", async () => {
  const { manager, counts } = setup();
  const [a, b] = await Promise.all([manager.main(), manager.main()]);
  expect(a).toBe(b);
  expect(counts.queries).toBe(1);
  expect(counts.loads).toBe(1);
});

test("worker() creates one session per task id, rooted at the task cwd", async () => {
  const { manager, db, sid, counts } = setup();
  const w1 = await manager.worker("t1", "/tmp/ws/tasks/t1");
  const w1again = await manager.worker("t1", "/tmp/ws/tasks/t1");
  const w2 = await manager.worker("t2", "/tmp/ws/tasks/t2");
  expect(w1).toBe(w1again);
  expect(w1).not.toBe(w2);
  expect(counts.queries).toBe(2);
  expect(db.findClaudeSession(sid, "worker:t1")?.["cwd"]).toBe("/tmp/ws/tasks/t1");
});

test("closeWorker closes and forgets the worker", async () => {
  const { manager, db, sid } = setup();
  await manager.worker("t1", "/tmp/ws/tasks/t1");
  await manager.closeWorker("t1");
  expect(db.findClaudeSession(sid, "worker:t1")?.["status"]).toBe("closed");
});

test("closeAll closes main and all workers", async () => {
  const { manager, db, sid } = setup();
  await manager.main();
  await manager.worker("t1", "/tmp/ws/tasks/t1");
  await manager.closeAll();
  expect(db.findClaudeSession(sid, "main")?.["status"]).toBe("closed");
  expect(db.findClaudeSession(sid, "worker:t1")?.["status"]).toBe("closed");
});

test("closeWorker on unknown task id is a no-op", async () => {
  const { manager } = setup();
  await expect(manager.closeWorker("nope")).resolves.toBeUndefined();
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- tests/claudeSessionManager.test.ts`
Expected: FAIL — `ClaudeSessionManager` is not exported.

- [ ] **Step 3: Implement the manager** (append to `src/claudeSession.ts`)

```typescript
/**
 * One per Overseer run. Owns the long-lived main session (sequential phases)
 * and short-lived worker sessions (parallel coding tasks). Promise-memoized:
 * concurrent first callers (parallel review agents) share one main session.
 */
export class ClaudeSessionManager {
  private mainPromise?: Promise<ClaudeSession>;
  private workers = new Map<string, Promise<ClaudeSession>>();
  private queryFnPromise?: Promise<SdkQueryFn>;

  constructor(
    private db: ForgeDb,
    private forgeSessionId: string,
    private workspace: string,
    private onLiveEvent?: LiveEventFn,
    private loadQueryFn: () => Promise<SdkQueryFn> = loadSdkQuery,
  ) {}

  main(): Promise<ClaudeSession> {
    this.mainPromise ??= this.start("main", this.workspace);
    return this.mainPromise;
  }

  worker(taskId: string, cwd: string): Promise<ClaudeSession> {
    let w = this.workers.get(taskId);
    if (!w) {
      w = this.start(`worker:${taskId}`, cwd, taskId);
      this.workers.set(taskId, w);
    }
    return w;
  }

  async closeWorker(taskId: string): Promise<void> {
    const w = this.workers.get(taskId);
    this.workers.delete(taskId);
    if (w) {
      try { await (await w).close(); } catch {}
    }
  }

  async closeAll(): Promise<void> {
    const all = [this.mainPromise, ...this.workers.values()];
    this.mainPromise = undefined;
    this.workers.clear();
    await Promise.all(all.filter(Boolean).map(async (p) => {
      try { await (await p!).close(); } catch {}
    }));
  }

  private async start(role: string, cwd: string, taskId?: string): Promise<ClaudeSession> {
    this.queryFnPromise ??= this.loadQueryFn();
    const queryFn = await this.queryFnPromise;
    return new ClaudeSession({
      queryFn,
      db: this.db,
      forgeSessionId: this.forgeSessionId,
      role,
      cwd,
      onLiveEvent: this.onLiveEvent,
      taskId,
    });
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/claudeSessionManager.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/claudeSession.ts tests/claudeSessionManager.test.ts
git commit -m "feat: ClaudeSessionManager with memoized main and per-task workers"
```

---

### Task 10: `checkClaudeSessionReady`

**Files:**
- Modify: `src/claudeSession.ts`
- Test: `tests/claudeSession.test.ts`

- [ ] **Step 1: Write the failing tests** (append; add `checkClaudeSessionReady` to the import)

```typescript
describe("checkClaudeSessionReady", () => {
  test("ready when the SDK emits an init message", async () => {
    const fake = new FakeSdk();
    setTimeout(() => fake.emit(INIT), 10);
    const status = await checkClaudeSessionReady(async () => fake.queryFn, 2_000);
    expect(status).toEqual({ ready: true });
  });

  test("not ready with error when the SDK throws", async () => {
    const status = await checkClaudeSessionReady(async () => {
      throw new Error("Cannot find module '@anthropic-ai/claude-agent-sdk'");
    }, 2_000);
    expect(status.ready).toBe(false);
    expect(status.error).toContain("Cannot find module");
  });

  test("not ready when init never arrives within the timeout", async () => {
    const fake = new FakeSdk();
    const status = await checkClaudeSessionReady(async () => fake.queryFn, 100);
    expect(status.ready).toBe(false);
    expect(status.error).toContain("did not start");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- tests/claudeSession.test.ts`
Expected: FAIL — `checkClaudeSessionReady` is not exported.

- [ ] **Step 3: Implement it** (append to `src/claudeSession.ts`)

```typescript
export interface ClaudeSessionReadyStatus {
  ready: boolean;
  error?: string;
}

/**
 * Setup/doctor probe: can the Agent SDK actually start a session here?
 * Replaces the old `claude --version` / `claude auth status` CLI checks.
 */
export async function checkClaudeSessionReady(
  loadQueryFn: () => Promise<SdkQueryFn> = loadSdkQuery,
  timeoutMs = 15_000,
): Promise<ClaudeSessionReadyStatus> {
  const stream = new MessageStream();
  try {
    const queryFn = await loadQueryFn();
    const q = queryFn({
      prompt: stream,
      options: { cwd: process.cwd(), maxTurns: 1, permissionMode: "default", settingSources: [] },
    });
    const sawInit = (async () => {
      for await (const msg of q) {
        if (msg["type"] === "system" && msg["subtype"] === "init") return true;
      }
      return false;
    })();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Claude Code session did not start within ${timeoutMs / 1000}s`)),
        timeoutMs,
      );
    });
    try {
      const ready = await Promise.race([sawInit, timeout]);
      return { ready: Boolean(ready) };
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch (e) {
    return { ready: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    try { stream.end(); } catch {}
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/claudeSession.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/claudeSession.ts tests/claudeSession.test.ts
git commit -m "feat: checkClaudeSessionReady SDK startup probe"
```

---

### Task 11: Wire `BaseAgent` to sessions; migrate agent tests

**Files:**
- Modify: `src/agents/base.ts`
- Create: `tests/helpers/fakeClaudeSessions.ts`
- Modify: `tests/agents/base.test.ts`, `tests/agents/oneshot.test.ts`, `tests/agentsSkillArgs.test.ts`, `tests/agentsSkillContext.test.ts`

- [ ] **Step 1: Create the shared fake manager helper**

```typescript
// tests/helpers/fakeClaudeSessions.ts
/** Fake ClaudeSessionManager for agent/overseer tests. Cast to `any` at the call site. */
export function makeFakeClaudeSessions(text = "claude code output") {
  const sendMock = jest.fn().mockResolvedValue({
    text, model: "claude-code", tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0,
  });
  const session = { send: sendMock, interrupt: jest.fn(), close: jest.fn() };
  const manager = {
    main: jest.fn(async () => session),
    worker: jest.fn(async () => session),
    closeWorker: jest.fn(async () => {}),
    closeAll: jest.fn(async () => {}),
  };
  return { sendMock, session, manager: manager as any };
}
```

- [ ] **Step 2: Write the failing wiring tests** (in `tests/agents/base.test.ts`, replace the `jest.mock("../../src/claudeCodeDriver.js", ...)` block at lines 14-18 with the helper import, and update the two claude-code tests; add a worker-routing test)

Replace the mock block with:

```typescript
import { makeFakeClaudeSessions } from "../helpers/fakeClaudeSessions.js";
```

Update `ConcreteAgent`'s constructor (lines 20-23) to forward the new parameter:

```typescript
class ConcreteAgent extends BaseAgent {
  constructor(router: any, db: any, sessionId: string, onLiveEvent?: any, claudeSessions?: any) {
    super(router, db, sessionId, onLiveEvent, claudeSessions);
  }
  // ... run() unchanged
}
```

Replace the test at line 93 and the one at line 130:

```typescript
test("call routes to the main Claude session when model tier resolves to 'claude-code'", async () => {
  mockRouter.modelFor.mockReturnValue("claude-code");
  const fake = makeFakeClaudeSessions();
  const agent = new ConcreteAgent(mockRouter, db, sessionId, undefined, fake.manager);
  const result = await agent.run();
  expect(result.output).toBe("claude code output");
  expect(fake.manager.main).toHaveBeenCalled();
  expect(fake.manager.worker).not.toHaveBeenCalled();
  expect(mockRouter.complete).not.toHaveBeenCalled();
});

test("call without a session manager fails fast in claude-code mode", async () => {
  mockRouter.modelFor.mockReturnValue("claude-code");
  const agent = new ConcreteAgent(mockRouter, db, sessionId);
  await expect(agent.run()).rejects.toThrow("Claude session manager");
});

test("runAgenticLoop uses a worker session when a taskId is present", async () => {
  mockRouter.modelFor.mockReturnValue("claude-code");
  const fake = makeFakeClaudeSessions();
  const tmpWs = fs.mkdtempSync(path.join(os.tmpdir(), "forge-test-ws-"));
  try {
    const agent = new LoopAgent(mockRouter, db, sessionId, undefined, fake.manager);
    const result = await agent.run({ workspace: tmpWs, taskId: "task-7" });
    expect(result.output).toBe("claude code output");
    expect(fake.manager.worker).toHaveBeenCalledWith("task-7", tmpWs);
    expect(fake.sendMock).toHaveBeenCalledWith(expect.any(String), { taskId: "task-7" });
  } finally {
    fs.rmSync(tmpWs, { recursive: true, force: true });
  }
});

test("runAgenticLoop uses the main session when no taskId is present", async () => {
  mockRouter.modelFor.mockReturnValue("claude-code");
  const fake = makeFakeClaudeSessions();
  const tmpWs = fs.mkdtempSync(path.join(os.tmpdir(), "forge-test-ws-"));
  try {
    const agent = new LoopAgent(mockRouter, db, sessionId, undefined, fake.manager);
    const result = await agent.run({ workspace: tmpWs });
    expect(result.output).toBe("claude code output");
    expect(fake.manager.main).toHaveBeenCalled();
    expect(fake.manager.worker).not.toHaveBeenCalled();
  } finally {
    fs.rmSync(tmpWs, { recursive: true, force: true });
  }
});
```

Check `LoopAgent` in this file: if its `run()` does not already forward `args["taskId"]` into `runAgenticLoop`, update it to `this.runAgenticLoop(messages, String(args["workspace"]), args["taskId"] as string | undefined)`.

- [ ] **Step 3: Run to verify the new tests fail**

Run: `npm test -- tests/agents/base.test.ts`
Expected: FAIL — BaseAgent has no 5th constructor parameter; claude path still imports `ClaudeCodeDriver`.

- [ ] **Step 4: Rewire `src/agents/base.ts`**

1. Replace the import `import { ClaudeCodeDriver } from "../claudeCodeDriver.js";` with:

```typescript
import type { ClaudeSessionManager } from "../claudeSession.js";
```

2. Trim the externalAgents import to what remains used:

```typescript
import { type ExternalAgentId, externalAgentFor } from "../externalAgents.js";
```

3. Replace the field `private claudeCodeDriver = new ClaudeCodeDriver();` and extend the constructor:

```typescript
  constructor(
    protected router: LLMRouter,
    protected db: ForgeDb,
    protected sessionId: string,
    protected onLiveEvent?: LiveEventFn,
    protected claudeSessions?: ClaudeSessionManager,
  ) {}
```

4. Replace `runViaExternalAgent` with two private methods:

```typescript
  private async runViaCodex(messages: CoreMessage[], workdir: string, taskId?: string): Promise<string> {
    const prompt = this.promptFromMessages(messages);
    this.db.logEvent(this.sessionId, "CODEX_CALL", `${this.constructor.name} -> codex`);
    this.onLiveEvent?.("llm", `${this.constructor.name} → codex`);
    const result = await this.codexDriver.runTask(prompt, workdir);
    this.db.logLlmCall(
      this.sessionId,
      { model: "codex", tokensIn: 0, tokensOut: 0, costUsd: 0, response: result },
      taskId,
    );
    return result;
  }

  private async runViaClaudeSession(messages: CoreMessage[], taskId?: string, workerCwd?: string): Promise<string> {
    if (!this.claudeSessions) {
      throw new Error("claude-code profile requires a Claude session manager (agents must be constructed by the Overseer)");
    }
    const prompt = this.promptFromMessages(messages);
    this.db.logEvent(this.sessionId, "CLAUDE_CODE_CALL", `${this.constructor.name} -> claude-code`);
    this.onLiveEvent?.("llm", `${this.constructor.name} → claude-code`);
    const session = workerCwd !== undefined && taskId !== undefined
      ? await this.claudeSessions.worker(taskId, workerCwd)
      : await this.claudeSessions.main();
    const result = await session.send(prompt, { taskId });
    return result.text;
  }
```

Note: `ClaudeSession.send()` logs the llm call itself — do NOT also call `db.logLlmCall` on the claude path (double-logging would inflate cost totals).

5. Replace the external-agent branch in `call()`:

```typescript
    const prepared = this.prepareMessagesWithSkillContext(messages, options.skillContext);
    const externalAgent = this.externalAgentMode();
    if (externalAgent === "claude-code") {
      return this.runViaClaudeSession(prepared, taskId);
    }
    if (externalAgent === "codex") {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-codex-"));
      try {
        return await this.runViaCodex(prepared, tmpDir, taskId);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }
```

6. Replace the external-agent branch in `runAgenticLoop()`:

```typescript
    const externalAgent = this.externalAgentMode();
    if (externalAgent === "claude-code") {
      return this.runViaClaudeSession(prepared, taskId, taskId ? workspace : undefined);
    }
    if (externalAgent === "codex") {
      return this.runViaCodex(prepared, workspace, taskId);
    }
```

- [ ] **Step 5: Migrate the other agent test files**

In each of `tests/agents/oneshot.test.ts`, `tests/agentsSkillArgs.test.ts`, `tests/agentsSkillContext.test.ts`:

1. Delete the five-line `jest.mock("../src/claudeCodeDriver.js", ...)` / `jest.mock("../../src/claudeCodeDriver.js", ...)` block (it is identical in all three files):

```typescript
jest.mock("../src/claudeCodeDriver.js", () => ({
  ClaudeCodeDriver: jest.fn().mockImplementation(() => ({
    runTask: jest.fn().mockResolvedValue("claude code output"),
  })),
}));
```

2. Add `import { makeFakeClaudeSessions } from "./helpers/fakeClaudeSessions.js";` (path `../helpers/` from `tests/agents/`).
3. For every agent constructed while the router resolves to `"claude-code"`, pass the fake as the 5th constructor argument, e.g. `tests/agents/oneshot.test.ts:135` becomes:

```typescript
  const fake = makeFakeClaudeSessions();
  const agent = new DeployAgent(router, db, sessionId, undefined, fake.manager);
```

4. Any assertion that previously inspected the `runTask` mock's arguments now reads the prompt from `fake.sendMock.mock.calls[0][0]` (send's first argument is the flattened prompt string).
5. Run `grep -n "new .*Agent(" <file>` in each file to find every construction site; only claude-code-mode constructions need the new argument (API-model constructions are unaffected).

- [ ] **Step 6: Run the affected suites**

Run: `npm test -- tests/agents tests/agentsSkillArgs.test.ts tests/agentsSkillContext.test.ts`
Expected: PASS, including untouched codex and API-model tests.

- [ ] **Step 7: Commit**

```bash
git add src/agents/base.ts tests/helpers/fakeClaudeSessions.ts tests/agents tests/agentsSkillArgs.test.ts tests/agentsSkillContext.test.ts
git commit -m "feat: route claude-code agents through persistent sessions"
```

---

### Task 12: Wire the `Overseer`; migrate overseer tests

**Files:**
- Modify: `src/overseer.ts`
- Modify: `tests/overseerSkills.test.ts`, `tests/overseer.test.ts` (only if it constructs claude-code agents)

- [ ] **Step 1: Update the overseer test mock**

In `tests/overseerSkills.test.ts`, replace the `jest.mock("../src/claudeCodeDriver.js", ...)` block (lines 18-22) with:

```typescript
jest.mock("../src/claudeSession.js", () => {
  const send = jest.fn().mockResolvedValue({
    text: "claude code output", model: "claude-code",
    tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0,
  });
  const session = { send, interrupt: jest.fn(), close: jest.fn() };
  return {
    ClaudeSessionManager: jest.fn().mockImplementation(() => ({
      main: jest.fn(async () => session),
      worker: jest.fn(async () => session),
      closeWorker: jest.fn(async () => {}),
      closeAll: jest.fn(async () => {}),
    })),
  };
});
```

Check `tests/overseer.test.ts` with `grep -n "claude" tests/overseer.test.ts`; if it exercises claude-code mode, apply the same mock; if not, leave it untouched (the real `ClaudeSessionManager` constructor is side-effect-free until `main()`/`worker()` is called, so API-model overseer tests run unchanged).

- [ ] **Step 2: Run to verify current state fails**

Run: `npm test -- tests/overseerSkills.test.ts`
Expected: FAIL — overseer doesn't construct a manager yet, agents in claude-code mode throw "requires a Claude session manager".

- [ ] **Step 3: Wire the manager through `src/overseer.ts`**

1. Add the import:

```typescript
import { ClaudeSessionManager } from "./claudeSession.js";
```

2. Add the field and construct it at the end of the constructor:

```typescript
  private claudeSessions: ClaudeSessionManager;
```

```typescript
    this.claudeSessions = new ClaudeSessionManager(
      this.session.db, this.session.id, this.session.workspace, this.liveEvent,
    );
```

3. Pass it through the agent factory (line 60-62):

```typescript
  private agent<T>(Cls: new (...args: any[]) => T): T {
    return new Cls(this.session.router, this.session.db, this.session.id, this.liveEvent, this.claudeSessions);
  }
```

4. Close sessions at run end (line 54-58):

```typescript
  async run(askUser?: AskUser): Promise<void> {
    try {
      while (this.session.phase !== Phase.DONE && this.session.phase !== Phase.FAILED) {
        await this.runPhase(askUser);
      }
    } finally {
      await this.claudeSessions.closeAll();
    }
  }
```

5. Close each coding worker when its task finishes — in `codeTask()`, add a `finally` to the existing try/catch around `CodingAgent.run` (the `finally` runs even on the early `return` in the catch):

```typescript
    let result: { success: boolean; output: string };
    try {
      // ... existing skills prep, emit, updateTask, CodingAgent.run — unchanged
    } catch (err) {
      // ... existing failure handling — unchanged
      return;
    } finally {
      await this.claudeSessions.closeWorker(id);
    }
```

- [ ] **Step 4: Run the overseer suites**

Run: `npm test -- tests/overseer.test.ts tests/overseerSkills.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/overseer.ts tests/overseerSkills.test.ts tests/overseer.test.ts
git commit -m "feat: Overseer owns the ClaudeSessionManager lifecycle"
```

---

### Task 13: Setup readiness via SDK probe

**Files:**
- Modify: `src/config.ts:205-218`

- [ ] **Step 1: Replace the CLI checks with the SDK probe**

Replace the block at `src/config.ts:205-218`:

```typescript
  if (providers.includes(claudeCodeCliLabel)) {
    const { checkClaudeSessionReady } = await import("./claudeSession.js");
    console.log("\nProbing Claude Code session engine…");
    const status = await checkClaudeSessionReady();
    if (!status.ready) {
      console.log(
        `\nX  Claude Code session could not start${status.error ? `: ${status.error}` : ""}\n\n` +
        "    Authenticate with one of:\n" +
        "      export ANTHROPIC_API_KEY=sk-ant-...   (API key)\n" +
        "      claude login                           (Claude subscription via the claude CLI)\n\n" +
        "    Install the claude CLI (also used by `forgecli attach`):\n" +
        "      curl -fsSL https://claude.ai/install.sh | bash\n",
      );
      process.exit(1);
    }
    console.log("\nOK  Claude Code session engine ready\n");
    selectedExternalProfiles.push("claude-code");
  }
```

Note: the default profile stays `claude-primary` — the master spec defers the default flip.

- [ ] **Step 2: Build and run config tests**

Run: `npm run build && npm test -- tests/config.test.ts`
Expected: build clean; PASS (setup wizard branch is interactive and not unit-tested today; this keeps it that way).

- [ ] **Step 3: Commit**

```bash
git add src/config.ts
git commit -m "feat: setup probes the Agent SDK session engine for claude-code readiness"
```

---

### Task 14: CLI — `sessions --claude`, `attach`, `watch`

**Files:**
- Modify: `src/commands/sessions.ts`, `src/cli.ts`
- Create: `src/commands/attach.ts`, `src/commands/watch.ts`
- Test: `tests/commandsClaude.test.ts`

- [ ] **Step 1: Write the failing tests** (pure helpers only — the commands themselves are thin I/O shells)

```typescript
// tests/commandsClaude.test.ts
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ForgeDb } from "../src/db.js";
import { resolveAttachTarget } from "../src/commands/attach.js";
import { findTranscript } from "../src/commands/watch.js";

test("resolveAttachTarget finds main and worker sessions and flags active builds", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-attach-test-"));
  const sid = "abc12345";
  fs.mkdirSync(path.join(dir, sid), { recursive: true });
  const db = new ForgeDb(path.join(dir, sid, "session.db"));
  db.createSession("idea", sid);
  const mainId = db.createClaudeSession(sid, "main", "/ws");
  db.updateClaudeSession(mainId, { claude_session_id: "claude-main-1" });
  const workerId = db.createClaudeSession(sid, "worker:t1", "/ws/tasks/t1");
  db.updateClaudeSession(workerId, { claude_session_id: "claude-w-1" });
  db.close();

  const main = resolveAttachTarget(dir, undefined, undefined);
  expect(main).toMatchObject({ claudeSessionId: "claude-main-1", cwd: "/ws", active: true });
  const worker = resolveAttachTarget(dir, "t1", undefined);
  expect(worker).toMatchObject({ claudeSessionId: "claude-w-1", cwd: "/ws/tasks/t1" });
  expect(resolveAttachTarget(dir, "missing", undefined)).toBeUndefined();

  const db2 = new ForgeDb(path.join(dir, sid, "session.db"));
  db2.updateSession(sid, { phase: "DONE" });
  db2.close();
  expect(resolveAttachTarget(dir, undefined, sid)?.active).toBe(false);

  fs.rmSync(dir, { recursive: true, force: true });
});

test("findTranscript locates the session jsonl under a projects root", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "forge-watch-test-"));
  const projectDir = path.join(root, "-Users-someone-ws");
  fs.mkdirSync(projectDir, { recursive: true });
  const transcript = path.join(projectDir, "claude-main-1.jsonl");
  fs.writeFileSync(transcript, "");
  expect(findTranscript("claude-main-1", root)).toBe(transcript);
  expect(findTranscript("nope", root)).toBeUndefined();
  fs.rmSync(root, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- tests/commandsClaude.test.ts`
Expected: FAIL — modules do not exist.

- [ ] **Step 3: Create `src/commands/attach.ts`**

```typescript
import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";
import chalk from "chalk";
import { SESSIONS_DIR } from "../session.js";
import { ForgeDb } from "../db.js";

export interface AttachTarget {
  forgeSessionId: string;
  claudeSessionId: string;
  cwd: string;
  role: string;
  active: boolean;
}

function latestForgeSessionId(sessionsDir: string): string | undefined {
  if (!fs.existsSync(sessionsDir)) return undefined;
  const dirs = fs.readdirSync(sessionsDir)
    .filter((name) => fs.existsSync(path.join(sessionsDir, name, "session.db")))
    .map((name) => ({ name, mtime: fs.statSync(path.join(sessionsDir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return dirs[0]?.name;
}

/** Pure resolution logic, unit-testable without spawning anything. */
export function resolveAttachTarget(
  sessionsDir: string,
  taskId: string | undefined,
  forgeSessionId: string | undefined,
): AttachTarget | undefined {
  const forgeId = forgeSessionId ?? latestForgeSessionId(sessionsDir);
  if (!forgeId) return undefined;
  const dbPath = path.join(sessionsDir, forgeId, "session.db");
  if (!fs.existsSync(dbPath)) return undefined;
  const db = new ForgeDb(dbPath);
  try {
    const role = taskId ? `worker:${taskId}` : "main";
    const row = db.findClaudeSession(forgeId, role);
    const claudeSessionId = row?.["claude_session_id"];
    if (!claudeSessionId) return undefined;
    const phase = String(db.getSession(forgeId)?.["phase"] ?? "");
    return {
      forgeSessionId: forgeId,
      claudeSessionId: String(claudeSessionId),
      cwd: String(row?.["cwd"] ?? process.cwd()),
      role,
      active: phase !== "DONE" && phase !== "FAILED",
    };
  } finally {
    db.close();
  }
}

export async function attachSession(taskId?: string, opts: { session?: string } = {}): Promise<void> {
  const target = resolveAttachTarget(SESSIONS_DIR, taskId, opts.session);
  if (!target) {
    console.log(taskId
      ? `No Claude session recorded for task "${taskId}". Run forgecli sessions --claude to list sessions.`
      : "No Claude sessions recorded yet. Run a build with the claude-code profile first.");
    return;
  }
  if (target.active) {
    console.log(chalk.yellow(
      "Warning: this build is still active. Attaching now interleaves your messages into the live transcript.",
    ));
  }
  console.log(`Resuming Claude session ${target.claudeSessionId} (${target.role}) in ${target.cwd}…`);
  const child = spawn("claude", ["--resume", target.claudeSessionId], { cwd: target.cwd, stdio: "inherit" });
  await new Promise<void>((resolve, reject) => {
    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        reject(new Error("claude CLI not found. Install it to attach:\n  curl -fsSL https://claude.ai/install.sh | bash"));
      } else {
        reject(err);
      }
    });
    child.on("close", () => resolve());
  });
}
```

- [ ] **Step 4: Create `src/commands/watch.ts`**

```typescript
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import chalk from "chalk";
import { SESSIONS_DIR } from "../session.js";
import { resolveAttachTarget } from "./attach.js";

const DEFAULT_PROJECTS_ROOT = path.join(os.homedir(), ".claude", "projects");

/** Locate a session transcript under ~/.claude/projects (claude-code encodes the cwd as the dir name). */
export function findTranscript(claudeSessionId: string, projectsRoot = DEFAULT_PROJECTS_ROOT): string | undefined {
  if (!fs.existsSync(projectsRoot)) return undefined;
  for (const dir of fs.readdirSync(projectsRoot)) {
    const candidate = path.join(projectsRoot, dir, `${claudeSessionId}.jsonl`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

function printEvent(line: string): void {
  let entry: Record<string, any>;
  try { entry = JSON.parse(line); } catch { return; }
  const msg = entry["message"];
  if (entry["type"] === "assistant" && Array.isArray(msg?.content)) {
    for (const block of msg.content) {
      if (block?.type === "text" && typeof block.text === "string" && block.text.trim()) {
        console.log(chalk.cyan(`claude> ${block.text.slice(0, 200)}`));
      } else if (block?.type === "tool_use") {
        const preview = block.name === "Bash"
          ? String(block.input?.command ?? "").slice(0, 120)
          : JSON.stringify(block.input ?? {}).slice(0, 120);
        console.log(chalk.yellow(`  ⚙ ${block.name}: ${preview}`));
      }
    }
  } else if (entry["type"] === "user" && typeof msg?.content === "string") {
    console.log(chalk.green(`user>  ${msg.content.slice(0, 200)}`));
  }
}

export async function watchSession(claudeSessionId?: string): Promise<void> {
  const id = claudeSessionId
    ?? resolveAttachTarget(SESSIONS_DIR, undefined, undefined)?.claudeSessionId;
  if (!id) { console.log("No Claude session to watch."); return; }
  const transcript = findTranscript(id);
  if (!transcript) {
    console.log(`Transcript for ${id} not found under ~/.claude/projects (the session may not have started yet).`);
    return;
  }
  console.log(`Watching ${transcript} — Ctrl+C to stop.\n`);
  let offset = 0;
  const drain = () => {
    const size = fs.statSync(transcript).size;
    if (size <= offset) return;
    const fd = fs.openSync(transcript, "r");
    const buf = Buffer.alloc(size - offset);
    fs.readSync(fd, buf, 0, buf.length, offset);
    fs.closeSync(fd);
    offset = size;
    for (const line of buf.toString("utf8").split("\n")) {
      if (line.trim()) printEvent(line);
    }
  };
  drain();
  setInterval(drain, 500);
  await new Promise(() => {}); // read-only tail; runs until Ctrl+C
}
```

- [ ] **Step 5: Extend `src/commands/sessions.ts`**

Change the signature and add the claude listing:

```typescript
export async function listSessions(opts: { claude?: boolean } = {}): Promise<void> {
  if (!fs.existsSync(SESSIONS_DIR)) { console.log("No sessions yet."); return; }
  if (opts.claude) { listClaudeSessions(); return; }
  // ... existing body unchanged
}

function listClaudeSessions(): void {
  const table = new Table({ head: ["Forge", "Role", "Claude session", "Status", "Cwd"] });
  const attachLines: string[] = [];
  for (const entry of fs.readdirSync(SESSIONS_DIR).sort().reverse()) {
    const dbPath = path.join(SESSIONS_DIR, entry, "session.db");
    if (!fs.existsSync(dbPath)) continue;
    const db = new ForgeDb(dbPath);
    for (const row of db.listClaudeSessions()) {
      table.push([
        chalk.cyan(String(row["forge_session_id"])),
        String(row["role"]),
        String(row["claude_session_id"] ?? "(not started)"),
        String(row["status"]),
        String(row["cwd"]),
      ]);
      if (row["claude_session_id"]) {
        attachLines.push(`  cd ${row["cwd"]} && claude --resume ${row["claude_session_id"]}`);
      }
    }
    db.close();
  }
  console.log(table.toString());
  if (attachLines.length) {
    console.log("\nAttach with:");
    for (const line of attachLines) console.log(line);
  }
}
```

- [ ] **Step 6: Register the commands in `src/cli.ts`**

Replace the `sessions` command (lines 85-88) and add `attach`/`watch` after it:

```typescript
program
  .command("sessions")
  .option("--claude", "List Claude Code sessions driven by Forge")
  .action(async (opts: { claude?: boolean }) => {
    const { listSessions } = await import("./commands/sessions.js");
    await listSessions(opts);
  });

program
  .command("attach [taskId]")
  .description("Take over a Forge-driven Claude session in the interactive claude CLI")
  .option("-s, --session <id>", "Forge session id (default: latest)")
  .action(async (taskId: string | undefined, opts: { session?: string }) => {
    const { attachSession } = await import("./commands/attach.js");
    await attachSession(taskId, opts);
  });

program
  .command("watch [claudeSessionId]")
  .description("Live-tail a Claude session transcript (read-only)")
  .action(async (claudeSessionId?: string) => {
    const { watchSession } = await import("./commands/watch.js");
    await watchSession(claudeSessionId);
  });
```

- [ ] **Step 7: Run the tests and the CLI suite**

Run: `npm test -- tests/commandsClaude.test.ts tests/cli.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/commands/attach.ts src/commands/watch.ts src/commands/sessions.ts src/cli.ts tests/commandsClaude.test.ts
git commit -m "feat: sessions --claude, attach, and watch commands"
```

---

### Task 15: Retire the old driver; full verification

**Files:**
- Delete: `src/claudeCodeDriver.ts`, `tests/claudeCodeDriver.test.ts`

- [ ] **Step 1: Confirm nothing imports the old driver**

Run: `grep -rn "claudeCodeDriver" src/ tests/ --include="*.ts"`
Expected: only `src/claudeCodeDriver.ts` and `tests/claudeCodeDriver.test.ts` themselves. If anything else still imports it, fix that first — do not delete with live importers.

- [ ] **Step 2: Delete both files**

```bash
git rm src/claudeCodeDriver.ts tests/claudeCodeDriver.test.ts
```

- [ ] **Step 3: Full suite and build**

Run: `npm test && npm run build`
Expected: all suites PASS, `tsc` clean.

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor: remove one-shot claude -p driver, superseded by ClaudeSession"
```

---

### Task 16: Env-gated smoke script and docs

**Files:**
- Create: `scripts/claude-session-smoke.mjs`
- Modify: `package.json` (scripts), `README.md`

- [ ] **Step 1: Create the smoke script** (real SDK, real quota — never run in CI by default)

```javascript
// scripts/claude-session-smoke.mjs
// Usage: npm run build && FORGE_E2E_CLAUDE=1 node scripts/claude-session-smoke.mjs
// Verifies: a real SDK session starts, retains context across two turns, and records a session id.
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ForgeDb } from "../dist/db.js";
import { ClaudeSessionManager } from "../dist/claudeSession.js";

if (process.env.FORGE_E2E_CLAUDE !== "1") {
  console.log("Skipped. Set FORGE_E2E_CLAUDE=1 to run the real-SDK smoke test (uses Claude quota).");
  process.exit(0);
}

const dir = mkdtempSync(join(tmpdir(), "forge-smoke-"));
const db = new ForgeDb(":memory:");
const forgeId = db.createSession("smoke");
const manager = new ClaudeSessionManager(db, forgeId, dir);

try {
  const session = await manager.main();
  const first = await session.send(
    "Remember this marker: forge-session-proxy-smoke. Reply with OK and nothing else.",
    { timeoutMs: 120_000 },
  );
  console.log(`turn 1: ${first.text.slice(0, 80)} (cost $${first.costUsd.toFixed(4)})`);
  const second = await session.send(
    "What marker did I give you earlier? Reply with the marker and nothing else.",
    { timeoutMs: 120_000 },
  );
  console.log(`turn 2: ${second.text.slice(0, 80)} (cacheRead ${second.cacheRead} tokens)`);
  const recorded = db.listClaudeSessions(forgeId)[0]?.claude_session_id;
  if (!second.text.includes("forge-session-proxy-smoke")) {
    throw new Error(`context NOT retained across turns: "${second.text.slice(0, 200)}"`);
  }
  if (!recorded) throw new Error("no claude_session_id recorded");
  console.log(`PASS — session ${recorded} retained context. Attach with: claude --resume ${recorded}`);
} finally {
  await manager.closeAll();
  rmSync(dir, { recursive: true, force: true });
}
```

- [ ] **Step 2: Add the npm script** (in `package.json` `scripts`)

```json
    "smoke:claude": "node scripts/claude-session-smoke.mjs"
```

- [ ] **Step 3: Run it for real once** (requires auth and quota; uses two tiny turns)

Run: `npm run build && FORGE_E2E_CLAUDE=1 npm run smoke:claude`
Expected: `PASS — session <uuid> retained context…`. If it fails on auth, the readiness guidance from Task 13 applies. Record the observed result in the commit message.

- [ ] **Step 4: Update README**

In the "How it works" section, replace the description of claude-code mode (the agentic tool-loop paragraph stays, scoped to API-model profiles) and add under a new `### Claude Code as the engine` heading:

```markdown
### Claude Code as the engine

With the `claude-code` profile, forge drives persistent Claude Code sessions
through the Claude Agent SDK instead of its built-in tool loop: one long-lived
session carries the whole pipeline (spec → architecture → tasks → verification)
with prompt-cache continuity, and each parallel coding task gets its own
short-lived worker session. Real token/cost numbers land in `forgecli logs`.

- `forgecli sessions --claude` — list the Claude sessions behind each build
- `forgecli attach [taskId]` — take over a session in the interactive claude CLI
- `forgecli watch` — read-only live tail of the main session transcript

Env knobs: `FORGE_CLAUDE_CODE_PERMISSION_MODE` (default `default`; legacy `auto` maps to `default`),
`FORGE_CLAUDE_CODE_MAX_TURNS` (default `40`), `FORGE_CLAUDE_CODE_TIMEOUT_MS`
(default `300000`), `FORGE_ALLOW_UNSANDBOXED=1` (allow sandbox-disable).
```

- [ ] **Step 5: Final full verification**

Run: `npm test && npm run build`
Expected: PASS / clean.

- [ ] **Step 6: Commit**

```bash
git add scripts/claude-session-smoke.mjs package.json README.md
git commit -m "feat: env-gated real-SDK smoke script and claude-code engine docs"
```

---

## Master-spec checklist → task map

| Master checklist item | Task |
|---|---|
| Add SDK dependency | 1 |
| Shared safety helper | 2 |
| `claude_sessions` schema + cache-token migration | 3 |
| DB methods for Claude sessions + cache-aware LLM calls | 3 |
| `src/claudeSession.ts` with injectable query | 4-5 |
| `send()` queueing, timeout, interrupt, close, result parsing | 5, 7 |
| SDK stream-to-forge event mapping | 6 |
| Hard-deny `canUseTool` | 8 |
| One manager through Overseer and BaseAgent | 9, 11, 12 |
| Preserve codex and API-model behavior | 11 (tests), 15 (full suite) |
| Remove Claude temp-dir usage from `call()` | 11 |
| Coding tasks → workers; phases/reviews → main | 11 |
| Close workers after tasks; close all at run end | 12 |
| Setup/readiness copy and behavior | 13 |
| `sessions --claude`, `attach`, `watch` | 14 |
| Rewrite driver tests; manager tests; update agent/overseer tests | 4-12 |
| Env-gated real SDK smoke test | 16 |
