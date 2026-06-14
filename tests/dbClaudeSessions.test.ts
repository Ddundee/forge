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

test("updateClaudeSession rejects empty or invalid updates", () => {
  const { db, sid } = makeDb();
  const id = db.createClaudeSession(sid, "main", "/tmp/ws");

  expect(() => db.updateClaudeSession(id, {})).toThrow("at least one field");
  expect(() => db.updateClaudeSession(id, { role: "worker:t1" })).toThrow("Invalid claude session update field");
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

test("createClaudeSession stores optional model and permission mode", () => {
  const { db, sid } = makeDb();
  const id = db.createClaudeSession(sid, "main", "/tmp/ws", {
    model: "claude-opus-4-5",
    permissionMode: "default",
  });
  const row = db.findClaudeSession(sid, "main");
  expect(row?.["model"]).toBe("claude-opus-4-5");
  expect(row?.["permission_mode"]).toBe("default");
  expect(row?.["id"]).toBe(id);
});

test("createClaudeSession leaves optional fields null when omitted", () => {
  const { db, sid } = makeDb();
  db.createClaudeSession(sid, "main", "/tmp/ws");
  const row = db.findClaudeSession(sid, "main");
  expect(row?.["model"]).toBeNull();
  expect(row?.["permission_mode"]).toBeNull();
});

test("listClaudeSessions without a forge session id returns rows across sessions", () => {
  const db = new ForgeDb(":memory:");
  const sid1 = db.createSession("idea 1");
  const sid2 = db.createSession("idea 2");
  db.createClaudeSession(sid1, "main", "/ws1");
  db.createClaudeSession(sid2, "main", "/ws2");
  db.createClaudeSession(sid1, "worker:t1", "/ws1/tasks/t1");
  const all = db.listClaudeSessions();
  expect(all).toHaveLength(3);
  const forgeIds = all.map((row) => row["forge_session_id"]);
  expect(forgeIds).toContain(sid1);
  expect(forgeIds).toContain(sid2);
  db.close();
});

test("updateClaudeSession updates closed_at and error fields", () => {
  const { db, sid } = makeDb();
  const id = db.createClaudeSession(sid, "main", "/tmp/ws");
  db.updateClaudeSession(id, { status: "closed", closed_at: "2099-01-01T00:00:00.000Z" });
  let row = db.findClaudeSession(sid, "main");
  expect(row?.["status"]).toBe("closed");
  expect(row?.["closed_at"]).toBe("2099-01-01T00:00:00.000Z");

  db.updateClaudeSession(id, { status: "failed", error: "session limit reached" });
  row = db.findClaudeSession(sid, "main");
  expect(row?.["status"]).toBe("failed");
  expect(row?.["error"]).toBe("session limit reached");
});

test("logLlmCall can associate a call to a task", () => {
  const { db, sid } = makeDb();
  const taskId = db.createTask(sid, "My Task", "coding");
  db.logLlmCall(sid, {
    model: "claude-sonnet-4-6",
    tokensIn: 10,
    tokensOut: 5,
    costUsd: 0.01,
    response: "done",
    cacheRead: 0,
    cacheWrite: 0,
  }, taskId);
  const calls = db.getLlmCalls(sid);
  expect(calls).toHaveLength(1);
  expect(calls[0]["task_id"]).toBe(taskId);
});

test("logLlmCall derives provider from model string when not explicitly given", () => {
  const { db, sid } = makeDb();
  db.logLlmCall(sid, {
    model: "anthropic/claude-haiku",
    tokensIn: 1,
    tokensOut: 1,
    costUsd: 0,
    response: "x",
  });
  expect(db.getLlmCalls(sid)[0]["provider"]).toBe("anthropic");
});

test("getToolCalls returns tool_args as JSON text", () => {
  const { db, sid } = makeDb();
  db.logToolCall(sid, undefined, "Read", { file_path: "/ws/src/index.ts" }, "file contents here");
  const calls = db.getToolCalls(sid);
  expect(calls).toHaveLength(1);
  const toolArgs = JSON.parse(calls[0]["tool_args"] as string);
  expect(toolArgs["file_path"]).toBe("/ws/src/index.ts");
  expect(calls[0]["tool_result"]).toBe("file contents here");
});
