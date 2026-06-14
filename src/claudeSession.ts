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

const SDK_PERMISSION_MODES = new Set(["default", "acceptEdits", "plan", "delegate", "dontAsk"]);

function claudePermissionMode(): string {
  const raw = process.env["FORGE_CLAUDE_CODE_PERMISSION_MODE"]?.trim();
  if (!raw || raw === "auto") return "default";
  if (raw === "bypassPermissions") {
    throw new Error("FORGE_CLAUDE_CODE_PERMISSION_MODE=bypassPermissions is not supported because it bypasses Forge safety checks");
  }
  if (!SDK_PERMISSION_MODES.has(raw)) {
    throw new Error(
      `Invalid FORGE_CLAUDE_CODE_PERMISSION_MODE "${raw}". Expected one of: ${[...SDK_PERMISSION_MODES].join(", ")}`,
    );
  }
  return raw;
}

/**
 * Loads the Claude Agent SDK query function.
 *
 * @returns The SDK's `query` function.
 */
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
    const permissionMode = claudePermissionMode();
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
      // Don't let a long pending-turn timeout hold the event loop open after an
      // abnormal close (mirrors close()'s race timer).
      timer.unref?.();
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
    let t: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([this.readLoop, new Promise((r) => { t = setTimeout(r, 5_000); t.unref?.(); })]);
    clearTimeout(t);
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

/**
 * Enforces Forge safety rules for Claude Code tool requests.
 *
 * @returns A callback that denies blocked Bash commands and sandbox disabling unless explicitly allowed, and allows other tool requests unchanged.
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

export interface ClaudeSessionReadyStatus {
  ready: boolean;
  error?: string;
}

/**
 * Determines whether the Agent SDK can successfully initialize a session in the current environment.
 *
 * @returns An object with a `ready` flag and an optional error message if initialization failed.
 */
export async function checkClaudeSessionReady(
  loadQueryFn: () => Promise<SdkQueryFn> = loadSdkQuery,
  timeoutMs = 15_000,
): Promise<ClaudeSessionReadyStatus> {
  const stream = new MessageStream();
  let q: SdkQuery | undefined;
  try {
    const queryFn = await loadQueryFn();
    q = queryFn({
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
    try { await q?.interrupt(); } catch {}
    try { stream.end(); } catch {}
  }
}
