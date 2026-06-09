import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { executeTool } from "../../src/tools/executor.js";

let workspace: string;
beforeEach(() => { workspace = fs.mkdtempSync(path.join(os.tmpdir(), "forge-exec-test-")); });
afterEach(() => { fs.rmSync(workspace, { recursive: true }); });

test("bash_exec runs a command and returns output", async () => {
  const result = await executeTool("bash_exec", { command: "echo hello" }, workspace);
  expect(result).toContain("hello");
  expect(result).toContain("[exit 0]");
});

test("bash_exec blocks dangerous commands", async () => {
  const result = await executeTool("bash_exec", { command: "rm -rf /" }, workspace);
  expect(result).toContain("ERROR: Command blocked");
});

test("bash_exec returns error for empty command", async () => {
  const result = await executeTool("bash_exec", { command: "" }, workspace);
  expect(result).toContain("ERROR: Empty command");
});

test("bash_exec reports non-zero exit code with stderr", async () => {
  const result = await executeTool("bash_exec", { command: "echo oops >&2; exit 3" }, workspace);
  expect(result).toContain("oops");
  expect(result).toContain("[exit 3]");
});

test("bash_exec does not block the event loop while running", async () => {
  let timerFired = false;
  const timer = setTimeout(() => { timerFired = true; }, 200);
  try {
    await executeTool("bash_exec", { command: "sleep 1" }, workspace);
    expect(timerFired).toBe(true);
  } finally {
    clearTimeout(timer);
  }
});

test("write_file creates file and parent dirs", async () => {
  const result = await executeTool("write_file", { path: "src/app.ts", content: "export {}" }, workspace);
  expect(result).toContain("OK");
  expect(fs.existsSync(path.join(workspace, "src", "app.ts"))).toBe(true);
});

test("read_file reads existing file", async () => {
  fs.mkdirSync(path.join(workspace, "src"), { recursive: true });
  fs.writeFileSync(path.join(workspace, "src", "main.ts"), "hello ts");
  const result = await executeTool("read_file", { path: "src/main.ts" }, workspace);
  expect(result).toBe("hello ts");
});

test("read_file returns error for missing file", async () => {
  const result = await executeTool("read_file", { path: "missing.ts" }, workspace);
  expect(result).toContain("ERROR: File not found");
});

test("read_file blocks path escapes", async () => {
  const result = await executeTool("read_file", { path: "../../etc/passwd" }, workspace);
  expect(result).toContain("ERROR: Path escapes workspace");
});

test("list_dir lists files", async () => {
  fs.writeFileSync(path.join(workspace, "README.md"), "");
  fs.mkdirSync(path.join(workspace, "src"), { recursive: true });
  const result = await executeTool("list_dir", { path: "." }, workspace);
  expect(result).toContain("[f] README.md");
  expect(result).toContain("[d] src");
});

test("unknown tool returns error", async () => {
  const result = await executeTool("unknown_tool", {}, workspace);
  expect(result).toContain("ERROR: Unknown tool");
});
