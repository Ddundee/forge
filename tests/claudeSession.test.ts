// tests/claudeSession.test.ts
import { MessageStream, type SdkUserMessage } from "../src/claudeSession.js";
import { ForgeDb } from "../src/db.js";
import { ClaudeSession, type SdkMessage } from "../src/claudeSession.js";

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
