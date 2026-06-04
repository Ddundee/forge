import { ForgeDb } from "../src/db.js";

let db: ForgeDb;

beforeEach(() => { db = new ForgeDb(":memory:"); });
afterEach(() => { db.close(); });

test("createSession returns 8-char ID", () => {
  const id = db.createSession("build a todo app");
  expect(id).toHaveLength(8);
});

test("getSession returns correct row", () => {
  const id = db.createSession("build a todo app");
  const row = db.getSession(id);
  expect(row?.["idea"]).toBe("build a todo app");
  expect(row?.["phase"]).toBe("IDEATION");
  expect(row?.["cycle"]).toBe(0);
});

test("updateSession persists fields", () => {
  const id = db.createSession("idea");
  db.updateSession(id, { phase: "ARCHITECTURE", cycle: 1 });
  const row = db.getSession(id);
  expect(row?.["phase"]).toBe("ARCHITECTURE");
  expect(row?.["cycle"]).toBe(1);
});

test("createTask returns ID and appears in getTasks", () => {
  const sid = db.createSession("idea");
  db.createTask(sid, "Write auth", "coding");
  const tasks = db.getTasks(sid);
  expect(tasks).toHaveLength(1);
  expect(tasks[0]["title"]).toBe("Write auth");
  expect(tasks[0]["status"]).toBe("pending");
});

test("getTasks filters by status", () => {
  const sid = db.createSession("idea");
  const tid = db.createTask(sid, "Write auth", "coding");
  db.updateTask(tid, { status: "completed" });
  expect(db.getTasks(sid, "completed")).toHaveLength(1);
  expect(db.getTasks(sid, "pending")).toHaveLength(0);
});

test("updateTask sets completed_at when status is completed", () => {
  const sid = db.createSession("idea");
  const tid = db.createTask(sid, "task", "coding");
  db.updateTask(tid, { status: "completed" });
  const tasks = db.getTasks(sid);
  expect(tasks[0]["completed_at"]).toBeTruthy();
});

test("logEvent is retrievable", () => {
  const sid = db.createSession("idea");
  db.logEvent(sid, "IDEATION", "Starting ideation");
  const events = db.getEvents(sid);
  expect(events).toHaveLength(1);
  expect(events[0]["message"]).toBe("Starting ideation");
});

test("logLlmCall persists cost", () => {
  const sid = db.createSession("idea");
  db.logLlmCall(sid, { model: "claude-opus-4-8", tokensIn: 100, tokensOut: 50, costUsd: 0.003, response: "hi" });
  expect(db.getTotalCost(sid)).toBeCloseTo(0.003);
});

test("saveArtifact versions correctly", () => {
  const sid = db.createSession("idea");
  db.saveArtifact(sid, "src/main.ts", "v1");
  db.saveArtifact(sid, "src/main.ts", "v2");
  const rows = db.getArtifacts(sid);
  expect(rows.map((r) => r["version"])).toEqual([1, 2]);
});

test("listSessions aggregates total_cost", () => {
  const sid = db.createSession("idea");
  db.logLlmCall(sid, { model: "m", tokensIn: 1, tokensOut: 1, costUsd: 0.005, response: "r" });
  const sessions = db.listSessions();
  expect(sessions[0]["total_cost"]).toBeCloseTo(0.005);
});
