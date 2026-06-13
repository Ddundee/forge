// tests/claudeSession.test.ts
import { MessageStream, type SdkUserMessage } from "../src/claudeSession.js";
import { ForgeDb } from "../src/db.js";
import { ClaudeSession, buildCanUseTool, type SdkMessage } from "../src/claudeSession.js";

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
