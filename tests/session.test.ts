import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Session } from "../src/session.js";
import { Phase, InvalidTransitionError } from "../src/stateMachine.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-session-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true });
});

function makeSession(): Session {
  return Session.create("build a todo app", undefined, tmpDir);
}

test("create makes workspace and logs dirs", () => {
  const s = makeSession();
  expect(fs.existsSync(s.workspace)).toBe(true);
  const sessionDir = path.dirname(s.workspace);
  expect(fs.existsSync(path.join(sessionDir, "logs"))).toBe(true);
});

test("create persists to db", () => {
  const s = makeSession();
  const row = s.db.getSession(s.id);
  expect(row?.["idea"]).toBe("build a todo app");
  expect(row?.["phase"]).toBe("IDEATION");
});

test("load retrieves saved session", () => {
  const s1 = makeSession();
  const s2 = Session.load(s1.id, tmpDir);
  expect(s2.idea).toBe("build a todo app");
  expect(s2.phase).toBe(Phase.IDEATION);
});

test("load throws for nonexistent session", () => {
  expect(() => Session.load("notexist", tmpDir)).toThrow();
});

test("advancePhase updates phase in db", () => {
  const s = makeSession();
  s.advancePhase(Phase.ARCHITECTURE);
  expect(s.phase).toBe(Phase.ARCHITECTURE);
  expect(s.db.getSession(s.id)?.["phase"]).toBe("ARCHITECTURE");
});

test("advancePhase throws on invalid transition", () => {
  const s = makeSession();
  expect(() => s.advancePhase(Phase.DONE)).toThrow(InvalidTransitionError);
});

test("loadLast returns most recently modified session", async () => {
  const s1 = makeSession();
  await new Promise(r => setTimeout(r, 10));
  const s2 = makeSession();
  const last = Session.loadLast(tmpDir);
  expect(last.id).toBe(s2.id);
});

test("create stores config snapshot in session row", () => {
  const s = makeSession();
  const row = s.db.getSession(s.id);
  const snapshot = JSON.parse(String(row?.["config_json"] ?? "{}"));
  expect(snapshot).toHaveProperty("profile");
  expect(snapshot).toHaveProperty("skills");
  expect(snapshot.skills).toHaveProperty("mode");
});
