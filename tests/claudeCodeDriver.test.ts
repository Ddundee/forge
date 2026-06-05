import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { EventEmitter } from "events";

jest.mock("child_process", () => ({ spawn: jest.fn() }));

import { spawn } from "child_process";
import { ClaudeCodeDriver, checkClaudeCodeReady } from "../src/claudeCodeDriver.js";

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

function makeCheckChild(exitCode: number) {
  const child = new EventEmitter() as any;
  child.kill = jest.fn();
  setImmediate(() => child.emit("close", exitCode));
  return child;
}

let tmpDir: string;
let oldPermissionMode: string | undefined;
let oldMaxTurns: string | undefined;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-claude-code-test-"));
  oldPermissionMode = process.env["FORGE_CLAUDE_CODE_PERMISSION_MODE"];
  oldMaxTurns = process.env["FORGE_CLAUDE_CODE_MAX_TURNS"];
  delete process.env["FORGE_CLAUDE_CODE_PERMISSION_MODE"];
  delete process.env["FORGE_CLAUDE_CODE_MAX_TURNS"];
  jest.clearAllMocks();
});

afterEach(() => {
  if (oldPermissionMode === undefined) delete process.env["FORGE_CLAUDE_CODE_PERMISSION_MODE"];
  else process.env["FORGE_CLAUDE_CODE_PERMISSION_MODE"] = oldPermissionMode;
  if (oldMaxTurns === undefined) delete process.env["FORGE_CLAUDE_CODE_MAX_TURNS"];
  else process.env["FORGE_CLAUDE_CODE_MAX_TURNS"] = oldMaxTurns;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("runTask spawns claude -p with json output and defaults", async () => {
  mockSpawn.mockReturnValueOnce(makeChild(JSON.stringify({ result: "done" }), 0));
  const driver = new ClaudeCodeDriver();
  await driver.runTask("my task", tmpDir);
  expect(mockSpawn).toHaveBeenCalledWith(
    "claude",
    [
      "-p",
      "my task",
      "--output-format",
      "json",
      "--permission-mode",
      "auto",
      "--max-turns",
      "40",
    ],
    expect.objectContaining({ cwd: tmpDir }),
  );
});

test("runTask uses Claude Code env overrides for permission mode and max turns", async () => {
  process.env["FORGE_CLAUDE_CODE_PERMISSION_MODE"] = "acceptEdits";
  process.env["FORGE_CLAUDE_CODE_MAX_TURNS"] = "7";
  mockSpawn.mockReturnValueOnce(makeChild(JSON.stringify({ result: "done" }), 0));
  const driver = new ClaudeCodeDriver();
  await driver.runTask("my task", tmpDir);
  const [, args] = mockSpawn.mock.calls[0];
  expect(args).toContain("acceptEdits");
  expect(args).toContain("7");
});

test("runTask returns parsed JSON result when present", async () => {
  mockSpawn.mockReturnValueOnce(makeChild(JSON.stringify({ result: "claude output" }), 0));
  const driver = new ClaudeCodeDriver();
  const result = await driver.runTask("do a thing", tmpDir);
  expect(result).toBe("claude output");
});

test("runTask returns raw stdout when JSON result is absent", async () => {
  const stdout = JSON.stringify({ message: "no result" });
  mockSpawn.mockReturnValueOnce(makeChild(stdout, 0));
  const driver = new ClaudeCodeDriver();
  const result = await driver.runTask("do a thing", tmpDir);
  expect(result).toBe(stdout);
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
  const driver = new ClaudeCodeDriver();
  await expect(driver.runTask("task", tmpDir)).rejects.toThrow("claude exited 1");
});

test("runTask rejects with install guidance when claude CLI is missing", async () => {
  const child = new EventEmitter() as any;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = jest.fn();
  setImmediate(() => child.emit("error", Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" })));
  mockSpawn.mockReturnValueOnce(child);
  const driver = new ClaudeCodeDriver();
  await expect(driver.runTask("task", tmpDir)).rejects.toThrow("brew install --cask claude-code");
});

test("runTask kills process and rejects on timeout", async () => {
  const child = new EventEmitter() as any;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = jest.fn();
  mockSpawn.mockReturnValueOnce(child);
  const driver = new ClaudeCodeDriver();
  await expect(driver.runTask("task", tmpDir, 50)).rejects.toThrow("timed out");
  expect(child.kill).toHaveBeenCalledWith("SIGTERM");
}, 1000);

test("runTask writes prompt to .forge-claude-task.md for prompts over 8KB", async () => {
  const longPrompt = "x".repeat(9000);
  mockSpawn.mockReturnValueOnce(makeChild(JSON.stringify({ result: "done" }), 0));
  const driver = new ClaudeCodeDriver();
  await driver.runTask(longPrompt, tmpDir);
  const taskFile = path.join(tmpDir, ".forge-claude-task.md");
  expect(fs.existsSync(taskFile)).toBe(true);
  expect(fs.readFileSync(taskFile, "utf8")).toBe(longPrompt);
  const [, args] = mockSpawn.mock.calls[0];
  expect((args as string[])[1]).toContain(".forge-claude-task.md");
  expect((args as string[])[1]).not.toBe(longPrompt);
});

test("checkClaudeCodeReady returns ready when version and auth status pass", async () => {
  mockSpawn
    .mockReturnValueOnce(makeCheckChild(0))
    .mockReturnValueOnce(makeCheckChild(0));
  await expect(checkClaudeCodeReady()).resolves.toEqual({
    installed: true,
    authenticated: true,
    ready: true,
  });
  expect(mockSpawn).toHaveBeenNthCalledWith(1, "claude", ["--version"], { stdio: "ignore" });
  expect(mockSpawn).toHaveBeenNthCalledWith(2, "claude", ["auth", "status"], { stdio: "ignore" });
});

test("checkClaudeCodeReady returns not ready when auth status fails", async () => {
  mockSpawn
    .mockReturnValueOnce(makeCheckChild(0))
    .mockReturnValueOnce(makeCheckChild(1));
  await expect(checkClaudeCodeReady()).resolves.toEqual({
    installed: true,
    authenticated: false,
    ready: false,
  });
});

test("checkClaudeCodeReady returns not installed when version check errors", async () => {
  const child = new EventEmitter() as any;
  child.kill = jest.fn();
  setImmediate(() => child.emit("error", Object.assign(new Error(), { code: "ENOENT" })));
  mockSpawn.mockReturnValueOnce(child);
  await expect(checkClaudeCodeReady()).resolves.toEqual({
    installed: false,
    authenticated: false,
    ready: false,
  });
});
