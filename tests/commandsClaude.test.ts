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
