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
    const waiters: Array<(r: IteratorResult<Record<string, unknown>>) => void> = [];
    let done = false;
    void (async () => {
      for await (const _ of params.prompt) { /* drain */ }
      done = true;
      for (const resolve of waiters.splice(0)) {
        resolve({ value: undefined as never, done: true });
      }
    })();
    return {
      interrupt: async () => {},
      [Symbol.asyncIterator]() {
        return {
          next: () => done
            ? Promise.resolve({ value: undefined as never, done: true as const })
            : new Promise<IteratorResult<Record<string, unknown>>>((resolve) => waiters.push(resolve)),
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

test("loadQueryFn is called at most once even when main and workers are started", async () => {
  const { manager, counts } = setup();
  await manager.main();
  await manager.worker("t1", "/tmp/ws/tasks/t1");
  await manager.worker("t2", "/tmp/ws/tasks/t2");
  expect(counts.loads).toBe(1);
  expect(counts.queries).toBe(3);
});

test("worker records the correct role name in the database", async () => {
  const { manager, db, sid } = setup();
  await manager.worker("my-task", "/tmp/ws/tasks/my-task");
  const row = db.findClaudeSession(sid, "worker:my-task");
  expect(row).toBeDefined();
  expect(row?.["role"]).toBe("worker:my-task");
  expect(row?.["cwd"]).toBe("/tmp/ws/tasks/my-task");
});

test("closeAll is idempotent", async () => {
  const { manager } = setup();
  await manager.main();
  await manager.closeAll();
  await expect(manager.closeAll()).resolves.toBeUndefined();
});

test("calling main() after closeAll creates a fresh session", async () => {
  const { manager, counts } = setup();
  await manager.main();
  await manager.closeAll();
  const second = await manager.main();
  expect(counts.queries).toBe(2);
  expect(second).toBeDefined();
});
