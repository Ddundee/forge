import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { EventEmitter } from "events";

jest.mock("child_process", () => ({ spawn: jest.fn() }));

import { spawn } from "child_process";
import { CodexDriver, checkCodexInstalled } from "../src/codexDriver.js";

const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;

function makeChild(stdout: string, exitCode: number) {
  const child = new EventEmitter() as any;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = jest.fn();
  setImmediate(() => {
    child.stdout.emit("data", Buffer.from(stdout));
    child.emit("close", exitCode);
  });
  return child;
}

let tmpDir: string;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-codex-test-"));
  jest.clearAllMocks();
});
afterEach(() => fs.rmSync(tmpDir, { recursive: true }));

test("runTask resolves with stdout on exit 0", async () => {
  mockSpawn.mockReturnValueOnce(makeChild("codex output", 0));
  const driver = new CodexDriver();
  const result = await driver.runTask("do a thing", tmpDir);
  expect(result).toBe("codex output");
});

test("runTask spawns codex exec with --dangerously-bypass-approvals-and-sandbox and cwd", async () => {
  mockSpawn.mockReturnValueOnce(makeChild("ok", 0));
  const driver = new CodexDriver();
  await driver.runTask("my task", tmpDir);
  expect(mockSpawn).toHaveBeenCalledWith(
    "codex",
    ["exec", "--dangerously-bypass-approvals-and-sandbox", "my task"],
    expect.objectContaining({ cwd: tmpDir }),
  );
});

test("runTask rejects on non-zero exit code", async () => {
  const child = new EventEmitter() as any;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = jest.fn();
  setImmediate(() => {
    child.stderr.emit("data", Buffer.from("something went wrong"));
    child.emit("close", 1);
  });
  mockSpawn.mockReturnValueOnce(child);
  const driver = new CodexDriver();
  await expect(driver.runTask("task", tmpDir)).rejects.toThrow("codex exited 1");
});

test("runTask rejects with install hint when codex CLI not found (ENOENT)", async () => {
  const child = new EventEmitter() as any;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = jest.fn();
  setImmediate(() => child.emit("error", Object.assign(new Error("spawn codex ENOENT"), { code: "ENOENT" })));
  mockSpawn.mockReturnValueOnce(child);
  const driver = new CodexDriver();
  await expect(driver.runTask("task", tmpDir)).rejects.toThrow("npm install -g @openai/codex");
});

test("runTask kills process and rejects on timeout", async () => {
  const child = new EventEmitter() as any;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = jest.fn();
  // never emits close
  mockSpawn.mockReturnValueOnce(child);
  const driver = new CodexDriver();
  await expect(driver.runTask("task", tmpDir, 50)).rejects.toThrow("timed out");
  expect(child.kill).toHaveBeenCalledWith("SIGTERM");
}, 1000);

test("runTask writes prompt to .forge-task.md for prompts > 8KB", async () => {
  const longPrompt = "x".repeat(9000);
  mockSpawn.mockReturnValueOnce(makeChild("done", 0));
  const driver = new CodexDriver();
  await driver.runTask(longPrompt, tmpDir);
  const taskFile = path.join(tmpDir, ".forge-task.md");
  expect(fs.existsSync(taskFile)).toBe(true);
  expect(fs.readFileSync(taskFile, "utf8")).toBe(longPrompt);
  const [, args] = mockSpawn.mock.calls[0];
  expect((args as string[])[2]).toContain(".forge-task.md");
  expect((args as string[])[2]).not.toBe(longPrompt);
});

test("checkCodexInstalled returns true when codex --version exits 0", async () => {
  const child = new EventEmitter() as any;
  child.kill = jest.fn();
  setImmediate(() => child.emit("close", 0));
  mockSpawn.mockReturnValueOnce(child);
  expect(await checkCodexInstalled()).toBe(true);
});

test("checkCodexInstalled returns false on non-zero exit", async () => {
  const child = new EventEmitter() as any;
  child.kill = jest.fn();
  setImmediate(() => child.emit("close", 1));
  mockSpawn.mockReturnValueOnce(child);
  expect(await checkCodexInstalled()).toBe(false);
});

test("checkCodexInstalled returns false on ENOENT", async () => {
  const child = new EventEmitter() as any;
  child.kill = jest.fn();
  setImmediate(() => child.emit("error", Object.assign(new Error(), { code: "ENOENT" })));
  mockSpawn.mockReturnValueOnce(child);
  expect(await checkCodexInstalled()).toBe(false);
});
