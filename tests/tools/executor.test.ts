import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { executeTool } from "../../src-ts/tools/executor.js";

let workspace: string;
beforeEach(() => { workspace = fs.mkdtempSync(path.join(os.tmpdir(), "forge-exec-test-")); });
afterEach(() => { fs.rmSync(workspace, { recursive: true }); });

test("bash_exec runs a command and returns output", () => {
  const result = executeTool("bash_exec", { command: "echo hello" }, workspace);
  expect(result).toContain("hello");
  expect(result).toContain("[exit 0]");
});

test("bash_exec blocks dangerous commands", () => {
  const result = executeTool("bash_exec", { command: "rm -rf /" }, workspace);
  expect(result).toContain("ERROR: Command blocked");
});

test("bash_exec returns error for empty command", () => {
  const result = executeTool("bash_exec", { command: "" }, workspace);
  expect(result).toContain("ERROR: Empty command");
});

test("write_file creates file and parent dirs", () => {
  const result = executeTool("write_file", { path: "src/app.ts", content: "export {}" }, workspace);
  expect(result).toContain("OK");
  expect(fs.existsSync(path.join(workspace, "src", "app.ts"))).toBe(true);
});

test("read_file reads existing file", () => {
  fs.mkdirSync(path.join(workspace, "src"), { recursive: true });
  fs.writeFileSync(path.join(workspace, "src", "main.ts"), "hello ts");
  const result = executeTool("read_file", { path: "src/main.ts" }, workspace);
  expect(result).toBe("hello ts");
});

test("read_file returns error for missing file", () => {
  const result = executeTool("read_file", { path: "missing.ts" }, workspace);
  expect(result).toContain("ERROR: File not found");
});

test("read_file blocks path escapes", () => {
  const result = executeTool("read_file", { path: "../../etc/passwd" }, workspace);
  expect(result).toContain("ERROR: Path escapes workspace");
});

test("list_dir lists files", () => {
  fs.writeFileSync(path.join(workspace, "README.md"), "");
  fs.mkdirSync(path.join(workspace, "src"), { recursive: true });
  const result = executeTool("list_dir", { path: "." }, workspace);
  expect(result).toContain("[f] README.md");
  expect(result).toContain("[d] src");
});

test("unknown tool returns error", () => {
  const result = executeTool("unknown_tool", {}, workspace);
  expect(result).toContain("ERROR: Unknown tool");
});
