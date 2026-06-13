// tests/claudeSession.test.ts
import { MessageStream, type SdkUserMessage } from "../src/claudeSession.js";
import { ForgeDb } from "../src/db.js";
import { ClaudeSession, buildCanUseTool, checkClaudeSessionReady, type SdkMessage } from "../src/claudeSession.js";

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
    // llm_calls.task_id has a FK to tasks(id) and node:sqlite enforces foreign
    // keys by default, so the referenced task must exist before it is logged.
    const taskId = db.createTask(forgeSessionId, "task", "coding");
    await session.send("x", { taskId });
    expect(db.getLlmCalls(forgeSessionId)[0]["task_id"]).toBe(taskId);
  });
});

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
    // tool_calls.task_id has a FK to tasks(id) and node:sqlite enforces foreign
    // keys by default, so the referenced task must exist before it is logged.
    const taskId = db.createTask(forgeSessionId, "task", "coding");
    await session.send("run tests", { taskId });

    expect(onLiveEvent).toHaveBeenCalledWith("llm", "Working on it");
    expect(onLiveEvent).toHaveBeenCalledWith("cmd", "npm test --silent");
    expect(onLiveEvent).toHaveBeenCalledWith("tool", "Read(/ws/src/index.ts)");

    const toolCalls = db.getToolCalls(forgeSessionId);
    expect(toolCalls).toHaveLength(2);
    expect(toolCalls[0]["tool_name"]).toBe("Bash");
    expect(toolCalls[0]["task_id"]).toBe(taskId);
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

  test("timeout error message includes the timeout value in seconds", async () => {
    const fake = new FakeSdk();
    // Use 200ms so the error says "0.2s" (distinct from the 100ms test that says "0.1s").
    const status = await checkClaudeSessionReady(async () => fake.queryFn, 200);
    expect(status.ready).toBe(false);
    expect(status.error).toContain("0.2s");
  });

  test("non-init system messages before init do not trigger ready", async () => {
    const fake = new FakeSdk();
    // Emit a different system message first, then emit init.
    setTimeout(() => {
      fake.emit({ type: "system", subtype: "other", data: "something" });
      fake.emit(INIT);
    }, 10);
    const status = await checkClaudeSessionReady(async () => fake.queryFn, 2_000);
    expect(status).toEqual({ ready: true });
  });
});

describe("ClaudeSession tool_use live events — path variants", () => {
  test("tool_use with 'path' input field triggers generic tool live event", async () => {
    const fake = new FakeSdk();
    const onLiveEvent = jest.fn();
    fake.onMessage = () => {
      fake.emit({
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", id: "t1", name: "Glob", input: { path: "/ws/src" } },
          ],
        },
      });
      fake.emit(successResult("ok"));
    };
    const { session } = makeSession(fake, { onLiveEvent });
    await session.send("find files");
    expect(onLiveEvent).toHaveBeenCalledWith("tool", "Glob(/ws/src)");
  });

  test("tool_use with 'pattern' input field triggers generic tool live event", async () => {
    const fake = new FakeSdk();
    const onLiveEvent = jest.fn();
    fake.onMessage = () => {
      fake.emit({
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", id: "t1", name: "Grep", input: { pattern: "TODO" } },
          ],
        },
      });
      fake.emit(successResult("ok"));
    };
    const { session } = makeSession(fake, { onLiveEvent });
    await session.send("search code");
    expect(onLiveEvent).toHaveBeenCalledWith("tool", "Grep(TODO)");
  });

  test("tool_use with no recognized input field shows empty target", async () => {
    const fake = new FakeSdk();
    const onLiveEvent = jest.fn();
    fake.onMessage = () => {
      fake.emit({
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", id: "t1", name: "UnknownTool", input: { other: "value" } },
          ],
        },
      });
      fake.emit(successResult("ok"));
    };
    const { session } = makeSession(fake, { onLiveEvent });
    await session.send("do something");
    expect(onLiveEvent).toHaveBeenCalledWith("tool", "UnknownTool()");
  });

  test("text block longer than 80 chars is truncated in the live event", async () => {
    const fake = new FakeSdk();
    const onLiveEvent = jest.fn();
    const longText = "A".repeat(100);
    fake.onMessage = () => {
      fake.emit({
        type: "assistant",
        message: {
          content: [{ type: "text", text: longText }],
        },
      });
      fake.emit(successResult("ok"));
    };
    const { session } = makeSession(fake, { onLiveEvent });
    await session.send("long response");
    const llmEvent = onLiveEvent.mock.calls.find(([kind]) => kind === "llm");
    expect(llmEvent).toBeDefined();
    expect((llmEvent![1] as string).length).toBe(80);
  });

  test("whitespace-only text block does NOT emit a live event", async () => {
    const fake = new FakeSdk();
    const onLiveEvent = jest.fn();
    fake.onMessage = () => {
      fake.emit({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "   \n\t  " },
          ],
        },
      });
      fake.emit(successResult("ok"));
    };
    const { session } = makeSession(fake, { onLiveEvent });
    await session.send("empty text");
    expect(onLiveEvent).not.toHaveBeenCalledWith("llm", expect.anything());
  });

  test("Bash tool_use command longer than 80 chars is truncated in cmd event", async () => {
    const fake = new FakeSdk();
    const onLiveEvent = jest.fn();
    const longCommand = "npm run " + "x".repeat(100);
    fake.onMessage = () => {
      fake.emit({
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", id: "t1", name: "Bash", input: { command: longCommand } },
          ],
        },
      });
      fake.emit(successResult("ok"));
    };
    const { session } = makeSession(fake, { onLiveEvent });
    await session.send("run long command");
    const cmdEvent = onLiveEvent.mock.calls.find(([kind]) => kind === "cmd");
    expect(cmdEvent).toBeDefined();
    expect((cmdEvent![1] as string).length).toBe(80);
  });
});

describe("ClaudeSession token accounting edge cases", () => {
  test("usage with NaN total_cost_usd keeps the last baseline and reports costUsd=0", async () => {
    const fake = new FakeSdk();
    fake.onMessage = () => fake.emit({
      type: "result", subtype: "success", result: "done",
      total_cost_usd: NaN, // malformed
      usage: { input_tokens: 5, output_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    });
    const { session } = makeSession(fake);
    const result = await session.send("test");
    // Baseline stays at 0, costUsd = max(0, 0 - 0) = 0
    expect(result.costUsd).toBe(0);
  });

  test("tokensIn includes input_tokens plus both cache token types", async () => {
    const fake = new FakeSdk();
    fake.onMessage = () => fake.emit({
      type: "result", subtype: "success", result: "ok",
      total_cost_usd: 0.05,
      usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 30, cache_read_input_tokens: 50 },
    });
    const { session } = makeSession(fake);
    const result = await session.send("tokens check");
    // tokensIn = 100 (input) + 30 (cacheWrite) + 50 (cacheRead) = 180
    expect(result.tokensIn).toBe(180);
    expect(result.tokensOut).toBe(20);
    expect(result.cacheRead).toBe(50);
    expect(result.cacheWrite).toBe(30);
  });

  test("missing usage fields default to 0", async () => {
    const fake = new FakeSdk();
    fake.onMessage = () => fake.emit({
      type: "result", subtype: "success", result: "ok",
      total_cost_usd: 0.01,
      usage: {}, // no token fields
    });
    const { session } = makeSession(fake);
    const result = await session.send("no usage");
    expect(result.tokensIn).toBe(0);
    expect(result.tokensOut).toBe(0);
    expect(result.cacheRead).toBe(0);
    expect(result.cacheWrite).toBe(0);
  });
});

describe("ClaudeSession model tracking", () => {
  test("model defaults to claude-code before init arrives", async () => {
    const fake = new FakeSdk();
    const { session } = makeSession(fake);
    // session.sessionId is undefined, model is internal — verify via result
    fake.onMessage = () => fake.emit(successResult("ok", 0.01));
    const result = await session.send("check model");
    // The init message hasn't arrived so model stays as default "claude-code"
    expect(result.model).toBe("claude-code");
  });

  test("model from init message is used in subsequent turn results", async () => {
    const fake = new FakeSdk();
    const { session } = makeSession(fake);
    fake.emit({ type: "system", subtype: "init", session_id: "s-1", model: "claude-opus-4-5" });
    await tick();
    fake.onMessage = () => fake.emit(successResult("ok", 0.01));
    const result = await session.send("check model");
    expect(result.model).toBe("claude-opus-4-5");
  });

  test("init message without model field leaves the default model unchanged", async () => {
    const fake = new FakeSdk();
    const { session } = makeSession(fake);
    // Emit init with no model field
    fake.emit({ type: "system", subtype: "init", session_id: "s-2" });
    await tick();
    fake.onMessage = () => fake.emit(successResult("ok", 0.01));
    const result = await session.send("no model field");
    expect(result.model).toBe("claude-code"); // stays at default
  });
});
