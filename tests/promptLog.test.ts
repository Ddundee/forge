import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { PromptLogger, logPath } from "../src-ts/promptLog.js";

let tmpDir: string;
beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-log-test-")); });
afterEach(() => { fs.rmSync(tmpDir, { recursive: true }); });

test("logPath returns correct path", () => {
  const p = logPath("session123", path.join(tmpDir, "sessions"));
  expect(p).toContain("session123");
  expect(p).toContain("prompts.log");
});

test("log writes valid JSONL entry", () => {
  const sessionsDir = path.join(tmpDir, "sessions");
  const logger = new PromptLogger("sid1", sessionsDir);
  logger.log({
    agent: "IdeationAgent", tier: "overseer", model: "claude-opus-4-8",
    messages: [{ role: "user", content: "hello" }],
    response: "world", tokensIn: 10, tokensOut: 5, costUsd: 0.001,
  });
  const lp = logPath("sid1", sessionsDir);
  const line = fs.readFileSync(lp, "utf8").trim();
  const entry = JSON.parse(line);
  expect(entry.agent).toBe("IdeationAgent");
  expect(entry.tokens_in).toBe(10);
  expect(entry.response).toBe("world");
});

test("multiple calls append lines", () => {
  const sessionsDir = path.join(tmpDir, "sessions");
  const logger = new PromptLogger("sid2", sessionsDir);
  const base = { agent: "A", tier: "fast", model: "m", messages: [], response: "r", tokensIn: 1, tokensOut: 1, costUsd: 0 };
  logger.log(base);
  logger.log(base);
  const lp = logPath("sid2", sessionsDir);
  const lines = fs.readFileSync(lp, "utf8").trim().split("\n");
  expect(lines).toHaveLength(2);
});
