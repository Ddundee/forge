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
