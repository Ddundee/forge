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

test("resolveAttachTarget returns undefined when sessionsDir does not exist", () => {
  const nonExistentDir = path.join(os.tmpdir(), `forge-no-such-dir-${Date.now()}`);
  expect(resolveAttachTarget(nonExistentDir, undefined, undefined)).toBeUndefined();
});

test("resolveAttachTarget returns undefined when no session.db is present", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-no-db-"));
  const sid = "nosession1";
  fs.mkdirSync(path.join(dir, sid), { recursive: true });
  expect(resolveAttachTarget(dir, undefined, sid)).toBeUndefined();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("resolveAttachTarget returns undefined when no claude session row exists", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-empty-claude-"));
  const sid = "emptysession";
  fs.mkdirSync(path.join(dir, sid), { recursive: true });
  const db = new ForgeDb(path.join(dir, sid, "session.db"));
  db.createSession("idea", sid);
  db.close();
  expect(resolveAttachTarget(dir, undefined, sid)).toBeUndefined();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("resolveAttachTarget returns undefined when claude_session_id is not assigned", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-no-csid-"));
  const sid = "pending-session";
  fs.mkdirSync(path.join(dir, sid), { recursive: true });
  const db = new ForgeDb(path.join(dir, sid, "session.db"));
  db.createSession("idea", sid);
  db.createClaudeSession(sid, "main", "/ws");
  db.close();
  expect(resolveAttachTarget(dir, undefined, sid)).toBeUndefined();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("resolveAttachTarget marks failed sessions inactive", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-failed-"));
  const sid = "failed-session";
  fs.mkdirSync(path.join(dir, sid), { recursive: true });
  const db = new ForgeDb(path.join(dir, sid, "session.db"));
  db.createSession("idea", sid);
  const mainId = db.createClaudeSession(sid, "main", "/ws");
  db.updateClaudeSession(mainId, { claude_session_id: "csid-fail-1" });
  db.updateSession(sid, { phase: "FAILED" });
  db.close();
  expect(resolveAttachTarget(dir, undefined, sid)?.active).toBe(false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("resolveAttachTarget includes session and role fields", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-target-fields-"));
  const sid = "target-session";
  fs.mkdirSync(path.join(dir, sid), { recursive: true });
  const db = new ForgeDb(path.join(dir, sid, "session.db"));
  db.createSession("idea", sid);
  const mainId = db.createClaudeSession(sid, "main", "/workspace");
  db.updateClaudeSession(mainId, { claude_session_id: "csid-xyz" });
  db.close();
  const target = resolveAttachTarget(dir, undefined, sid);
  expect(target?.forgeSessionId).toBe(sid);
  expect(target?.role).toBe("main");
  expect(target?.claudeSessionId).toBe("csid-xyz");
  expect(target?.cwd).toBe("/workspace");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("findTranscript returns undefined for missing or empty project roots", () => {
  const nonExistentRoot = path.join(os.tmpdir(), `forge-no-projects-${Date.now()}`);
  expect(findTranscript("any-session-id", nonExistentRoot)).toBeUndefined();

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "forge-empty-projects-"));
  expect(findTranscript("any-session-id", root)).toBeUndefined();
  fs.rmSync(root, { recursive: true, force: true });
});

test("findTranscript finds a transcript nested under any project directory", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "forge-multi-proj-"));
  const proj1 = path.join(root, "-home-alice-proj1");
  const proj2 = path.join(root, "-home-bob-proj2");
  fs.mkdirSync(proj1, { recursive: true });
  fs.mkdirSync(proj2, { recursive: true });
  const transcript = path.join(proj2, "session-99.jsonl");
  fs.writeFileSync(transcript, "");
  expect(findTranscript("session-99", root)).toBe(transcript);
  expect(findTranscript("session-00", root)).toBeUndefined();
  fs.rmSync(root, { recursive: true, force: true });
});
