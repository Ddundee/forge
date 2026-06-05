# Codex CLI Subagent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `"codex"` as a forge profile that routes all agent phases through the OpenAI Codex CLI subprocess (`codex --approval-mode full-auto`) instead of direct LLM API calls, enabling users to use their OpenAI Pro subscription rather than API billing.

**Architecture:** A new `CodexDriver` class wraps the `codex` CLI subprocess and is invoked from `BaseAgent` whenever `router.modelFor(tier) === "codex"`. The coding fan-out in `Overseer` creates per-task isolated workspace subdirectories when the codex profile is active, merging files back after all parallel tasks complete.

**Tech Stack:** TypeScript, Node.js `child_process.spawn`, Jest (ts-jest), existing forge agent/router/config patterns.

**Spec:** `docs/specs/2026-06-04-codex-subagent-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/codexDriver.ts` | **Create** | Subprocess runner: spawn `codex` CLI, capture stdout, handle errors/timeouts/long prompts |
| `tests/codexDriver.test.ts` | **Create** | Unit tests for `CodexDriver` and `checkCodexInstalled` |
| `src/router.ts` | **Modify** | Add defensive guard in `resolveModel()` that throws if `"codex"` reaches it |
| `src/config.ts` | **Modify** | Add `"codex"` entry to `PROVIDER_PROFILES`; add Codex CLI option to setup wizard |
| `src/agents/base.ts` | **Modify** | Add `isCodexMode()`, `runViaCodex()`, guards at top of `call()` and `runAgenticLoop()` |
| `src/overseer.ts` | **Modify** | Per-task workspace isolation + file merge for codex coding fan-out |
| `tests/codexDriver.test.ts` | **Create** | (listed above) |
| `tests/router.test.ts` | **Modify** | Add test that `resolveModel("codex")` throws |
| `tests/config.test.ts` | **Modify** | Add test for codex profile tier models |
| `tests/agents/base.test.ts` | **Modify** | Add tests for codex mode in `call()` and `runAgenticLoop()` |
| `tests/overseer.test.ts` | **Modify** | Add test for workspace isolation + merge during coding phase |

---

## Task 1: `src/codexDriver.ts` — subprocess runner

**Files:**
- Create: `src/codexDriver.ts`
- Create: `tests/codexDriver.test.ts`

- [ ] **Step 1.1: Write the failing tests**

Create `tests/codexDriver.test.ts`:

```typescript
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

test("runTask spawns codex with --approval-mode full-auto and cwd", async () => {
  mockSpawn.mockReturnValueOnce(makeChild("ok", 0));
  const driver = new CodexDriver();
  await driver.runTask("my task", tmpDir);
  expect(mockSpawn).toHaveBeenCalledWith(
    "codex",
    ["--approval-mode", "full-auto", "my task"],
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
```

- [ ] **Step 1.2: Run tests to verify they fail**

```bash
node --experimental-sqlite node_modules/.bin/jest tests/codexDriver.test.ts --no-coverage
```

Expected: all tests fail with `Cannot find module '../src/codexDriver.js'`

- [ ] **Step 1.3: Create `src/codexDriver.ts`**

```typescript
import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";

export class CodexDriver {
  async runTask(
    prompt: string,
    workdir: string,
    timeoutMs = 300_000,
  ): Promise<string> {
    fs.mkdirSync(workdir, { recursive: true });

    let taskArg: string;
    if (prompt.length > 8_000) {
      const taskFile = path.join(workdir, ".forge-task.md");
      fs.writeFileSync(taskFile, prompt, "utf8");
      taskArg = `Read the file .forge-task.md and follow its instructions exactly. Delete the file when done.`;
    } else {
      taskArg = prompt;
    }

    return new Promise((resolve, reject) => {
      const child = spawn(
        "codex",
        ["--approval-mode", "full-auto", taskArg],
        { cwd: workdir, env: process.env, stdio: ["ignore", "pipe", "pipe"] },
      );

      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
      child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error(`Codex timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);

      child.on("error", (err) => {
        clearTimeout(timer);
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          reject(new Error("codex CLI not found — install it with: npm install -g @openai/codex"));
        } else {
          reject(err);
        }
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          reject(new Error(`codex exited ${code}: ${stderr.slice(0, 500)}`));
        } else {
          resolve(stdout);
        }
      });
    });
  }
}

export async function checkCodexInstalled(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("codex", ["--version"], { stdio: "ignore" });
    child.on("close", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}
```

- [ ] **Step 1.4: Run tests to verify they pass**

```bash
node --experimental-sqlite node_modules/.bin/jest tests/codexDriver.test.ts --no-coverage
```

Expected: all 9 tests pass

- [ ] **Step 1.5: Commit**

```bash
git add src/codexDriver.ts tests/codexDriver.test.ts
git commit -m "feat: add CodexDriver subprocess runner and checkCodexInstalled"
```

---

## Task 2: `src/router.ts` — defensive guard

**Files:**
- Modify: `src/router.ts` (the `resolveModel` private method)
- Modify: `tests/router.test.ts`

- [ ] **Step 2.1: Write the failing test**

Add to the bottom of `tests/router.test.ts`:

```typescript
test("resolveModel throws a clear error if 'codex' model id reaches it", () => {
  const router = new LLMRouter({ [ModelTier.FAST]: "codex" });
  // resolveModel is private — test via complete() which calls it
  return expect(
    router.complete(ModelTier.FAST, [{ role: "user", content: "hi" }])
  ).rejects.toThrow('Model id "codex" reached LLMRouter');
});
```

- [ ] **Step 2.2: Run the test to verify it fails**

```bash
node --experimental-sqlite node_modules/.bin/jest tests/router.test.ts --no-coverage
```

Expected: the new test fails — currently completes (or crashes with a bad API call) rather than throwing that message

- [ ] **Step 2.3: Add the guard to `src/router.ts`**

Open `src/router.ts` and add the guard as the FIRST line inside `private resolveModel(modelId: string)`:

```typescript
private resolveModel(modelId: string) {
  if (modelId === "codex") {
    throw new Error(
      'Model id "codex" reached LLMRouter — use CodexDriver via BaseAgent',
    );
  }
  if (modelId.startsWith("claude")) return createAnthropic()(modelId);
  // ... rest unchanged
}
```

- [ ] **Step 2.4: Run all router tests**

```bash
node --experimental-sqlite node_modules/.bin/jest tests/router.test.ts --no-coverage
```

Expected: all tests pass including the new one

- [ ] **Step 2.5: Commit**

```bash
git add src/router.ts tests/router.test.ts
git commit -m "feat: guard LLMRouter.resolveModel against codex model id"
```

---

## Task 3: `src/config.ts` — add "codex" profile

**Files:**
- Modify: `src/config.ts` (`PROVIDER_PROFILES` constant)
- Modify: `tests/config.test.ts`

- [ ] **Step 3.1: Write the failing test**

Add to the bottom of `tests/config.test.ts`:

```typescript
test("codex profile maps all tiers to 'codex'", () => {
  const cfg = new ForgeConfig("codex");
  const models = cfg.tierModels();
  expect(models[ModelTier.OVERSEER]).toBe("codex");
  expect(models[ModelTier.REASONING]).toBe("codex");
  expect(models[ModelTier.STANDARD]).toBe("codex");
  expect(models[ModelTier.FAST]).toBe("codex");
});

test("PROVIDER_PROFILES contains codex key", () => {
  expect(PROVIDER_PROFILES).toHaveProperty("codex");
});
```

- [ ] **Step 3.2: Run the tests to verify they fail**

```bash
node --experimental-sqlite node_modules/.bin/jest tests/config.test.ts --no-coverage
```

Expected: 2 new tests fail — `codex` key missing from `PROVIDER_PROFILES`

- [ ] **Step 3.3: Add the codex profile to `src/config.ts`**

In `src/config.ts`, add the `"codex"` entry to `PROVIDER_PROFILES` (after the existing entries):

```typescript
export const PROVIDER_PROFILES: Record<string, Record<ModelTier, string>> = {
  "claude-primary": {
    [ModelTier.OVERSEER]: "claude-opus-4-8",
    [ModelTier.REASONING]: "claude-sonnet-4-6",
    [ModelTier.STANDARD]: "claude-haiku-4-5-20251001",
    [ModelTier.FAST]: "claude-haiku-4-5-20251001",
  },
  "openai-primary": {
    [ModelTier.OVERSEER]: "gpt-4o",
    [ModelTier.REASONING]: "o3-mini",
    [ModelTier.STANDARD]: "gpt-4o-mini",
    [ModelTier.FAST]: "gpt-4o-mini",
  },
  "mixed-cost-optimized": {
    [ModelTier.OVERSEER]: "claude-sonnet-4-6",
    [ModelTier.REASONING]: "claude-sonnet-4-6",
    [ModelTier.STANDARD]: "gemini/gemini-2.0-flash",
    [ModelTier.FAST]: "gemini/gemini-2.0-flash",
  },
  "codex": {
    [ModelTier.OVERSEER]:  "codex",
    [ModelTier.REASONING]: "codex",
    [ModelTier.STANDARD]:  "codex",
    [ModelTier.FAST]:      "codex",
  },
};
```

- [ ] **Step 3.4: Run the config tests**

```bash
node --experimental-sqlite node_modules/.bin/jest tests/config.test.ts --no-coverage
```

Expected: all tests pass

- [ ] **Step 3.5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: add codex profile to PROVIDER_PROFILES"
```

---

## Task 4: `src/agents/base.ts` — codex dispatch

**Files:**
- Modify: `src/agents/base.ts`
- Modify: `tests/agents/base.test.ts`

- [ ] **Step 4.1: Write the failing tests**

Add to `tests/agents/base.test.ts`. First add the mock at the top of the file (after existing imports, before the `class ConcreteAgent` definition):

```typescript
jest.mock("../../src/codexDriver.js", () => ({
  CodexDriver: jest.fn().mockImplementation(() => ({
    runTask: jest.fn().mockResolvedValue("codex output"),
  })),
}));
```

Add a second concrete agent class that exercises `runAgenticLoop`, after the existing `ConcreteAgent` class:

```typescript
class LoopAgent extends BaseAgent {
  async run(args: Record<string, unknown>): Promise<AgentResult> {
    const content = await this.runAgenticLoop(
      [{ role: "system", content: "sys" }, { role: "user", content: "task" }],
      String(args["workspace"] ?? os.tmpdir()),
    );
    return { success: true, output: content };
  }
}
```

Also add `import * as os from "os";` to the imports at the top.

Then add these tests at the bottom of the file:

```typescript
test("call routes to CodexDriver when model tier resolves to 'codex'", async () => {
  mockRouter.modelFor.mockReturnValue("codex");
  const agent = new ConcreteAgent(mockRouter, db, sessionId);
  const result = await agent.run();
  expect(result.output).toBe("codex output");
  expect(mockRouter.complete).not.toHaveBeenCalled();
});

test("call logs CODEX_CALL event when in codex mode", async () => {
  mockRouter.modelFor.mockReturnValue("codex");
  const agent = new ConcreteAgent(mockRouter, db, sessionId);
  await agent.run();
  const events = db.getEvents(sessionId);
  expect(events.some((e) => String(e["phase"]) === "CODEX_CALL")).toBe(true);
});

test("runAgenticLoop routes to CodexDriver when model is codex", async () => {
  mockRouter.modelFor.mockReturnValue("codex");
  const tmpWs = fs.mkdtempSync(path.join(os.tmpdir(), "forge-test-ws-"));
  try {
    const agent = new LoopAgent(mockRouter, db, sessionId);
    const result = await agent.run({ workspace: tmpWs });
    expect(result.output).toBe("codex output");
    expect(mockRouter.completeWithTools).not.toHaveBeenCalled();
  } finally {
    fs.rmSync(tmpWs, { recursive: true });
  }
});

test("call still uses router when model is not codex", async () => {
  mockRouter.modelFor.mockReturnValue("claude-haiku");
  const agent = new ConcreteAgent(mockRouter, db, sessionId);
  const result = await agent.run();
  expect(result.output).toBe("test response");
  expect(mockRouter.complete).toHaveBeenCalled();
});
```

- [ ] **Step 4.2: Run the tests to verify they fail**

```bash
node --experimental-sqlite node_modules/.bin/jest tests/agents/base.test.ts --no-coverage
```

Expected: the 4 new tests fail — `isCodexMode`, `runViaCodex` don't exist yet

- [ ] **Step 4.3: Implement the changes in `src/agents/base.ts`**

Add these imports at the top (after existing imports):

```typescript
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { CodexDriver } from "../codexDriver.js";
```

Add `private codexDriver = new CodexDriver();` as the first field in the class body (after `protected tier = ModelTier.STANDARD;`):

```typescript
export abstract class BaseAgent {
  protected tier: ModelTier = ModelTier.STANDARD;
  private codexDriver = new CodexDriver();
```

Add these two private methods after `resolveAutoModel()` and before `call()`:

```typescript
private isCodexMode(): boolean {
  return this.router.modelFor(this.tier) === "codex";
}

private async runViaCodex(
  messages: CoreMessage[],
  workdir: string,
  taskId?: string,
): Promise<string> {
  const systemMsg = messages.find((m) => m.role === "system");
  const userParts = messages
    .filter((m) => m.role === "user")
    .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
    .join("\n\n");
  const system = typeof systemMsg?.content === "string" ? systemMsg.content : "";
  const prompt = system ? `${system}\n\n---\n\n${userParts}` : userParts;

  this.db.logEvent(this.sessionId, "CODEX_CALL", `${this.constructor.name} → codex`);
  const result = await this.codexDriver.runTask(prompt, workdir);
  this.db.logLlmCall(
    this.sessionId,
    { model: "codex", tokensIn: 0, tokensOut: 0, costUsd: 0, response: result },
    taskId,
  );
  return result;
}
```

Add the codex guard at the top of `call()`:

```typescript
protected async call(messages: CoreMessage[], taskId?: string): Promise<string> {
  if (this.isCodexMode()) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-codex-"));
    try {
      return await this.runViaCodex(messages, tmpDir, taskId);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }
  const modelOverride = await this.resolveAutoModel();
  // ... rest of existing call() body unchanged
```

Add the codex guard at the top of `runAgenticLoop()`:

```typescript
protected async runAgenticLoop(
  messages: CoreMessage[],
  workspace: string,
  taskId?: string,
): Promise<string> {
  if (this.isCodexMode()) {
    return this.runViaCodex(messages, workspace, taskId);
  }
  const modelOverride = await this.resolveAutoModel();
  // ... rest of existing runAgenticLoop() body unchanged
```

- [ ] **Step 4.4: Run the base agent tests**

```bash
node --experimental-sqlite node_modules/.bin/jest tests/agents/base.test.ts --no-coverage
```

Expected: all tests pass

- [ ] **Step 4.5: Run the full test suite to check for regressions**

```bash
node --experimental-sqlite node_modules/.bin/jest --no-coverage
```

Expected: all existing tests continue to pass

- [ ] **Step 4.6: Commit**

```bash
git add src/agents/base.ts tests/agents/base.test.ts
git commit -m "feat: add codex dispatch to BaseAgent call() and runAgenticLoop()"
```

---

## Task 5: `src/overseer.ts` — workspace isolation + merge

**Files:**
- Modify: `src/overseer.ts`
- Modify: `tests/overseer.test.ts`

- [ ] **Step 5.1: Write the failing test**

Add these imports at the top of `tests/overseer.test.ts` (after existing imports):

```typescript
import { LLMRouter, ModelTier } from "../src/router.js";
```

Add this helper after the existing `makeSession()` function:

```typescript
function makeCodexSession(): Session {
  const db = new ForgeDb(":memory:");
  const sessionId = db.createSession("codex idea");
  const ws = path.join(tmpDir, "codex-workspace");
  fs.mkdirSync(ws, { recursive: true });
  const mockRouter = {
    modelFor: jest.fn().mockImplementation((tier: string) =>
      tier === ModelTier.REASONING ? "codex" : "claude-haiku"
    ),
    hasAutoSelector: jest.fn().mockReturnValue(false),
    complete: jest.fn(),
    completeWithTools: jest.fn(),
  } as unknown as LLMRouter;
  return new Session(sessionId, "codex idea", Phase.IDEATION, 0, 5, undefined, ws, db, mockRouter, new ForgeConfig("codex"));
}
```

Then add this test block at the bottom of the file:

```typescript
test("coding phase gives each task an isolated workspace subdir when codex profile active", async () => {
  const receivedWorkspaces: string[] = [];

  (CodingAgent as jest.Mock).mockImplementation(() => ({
    run: jest.fn().mockImplementation(async (args: Record<string, unknown>) => {
      receivedWorkspaces.push(String(args["workspace"]));
      fs.writeFileSync(path.join(String(args["workspace"]), "output.ts"), "// generated");
      return { success: true, output: "wrote files" };
    }),
  }));

  const session = makeCodexSession();
  const overseer = new Overseer(session);
  // Run full pipeline from IDEATION — all other agents use the existing beforeEach mocks
  await overseer.run();

  // Each task workspace should be a subdirectory of the main workspace's tasks/ dir
  for (const ws of receivedWorkspaces) {
    expect(ws).toContain(path.join(session.workspace, "tasks"));
  }

  // Files written by tasks should be merged into the main workspace
  expect(fs.existsSync(path.join(session.workspace, "output.ts"))).toBe(true);

  // The tasks/ dir should be cleaned up after merge
  expect(fs.existsSync(path.join(session.workspace, "tasks"))).toBe(false);
});
```

- [ ] **Step 5.2: Run the test to verify it fails**

```bash
node --experimental-sqlite node_modules/.bin/jest tests/overseer.test.ts --no-coverage
```

Expected: the new test fails — tasks aren't isolated, files aren't merged

- [ ] **Step 5.3: Add imports to `src/overseer.ts`**

Confirm `fs`, `path`, and `ModelTier` are imported. If any are missing, add them:

```typescript
import * as fs from "fs";
import * as path from "path";
import { ModelTier } from "./router.js";
```

- [ ] **Step 5.4: Update `coding()` in `src/overseer.ts`**

Replace the existing `coding()` method:

```typescript
private async coding(): Promise<void> {
  const pending = this.session.db.getTasks(this.session.id, "pending");
  if (!pending.length) { this.session.advancePhase(Phase.INTEGRATION); return; }
  this.emit(`Coding ${pending.length} tasks in parallel…`);

  const useIsolation = this.session.router.modelFor(ModelTier.REASONING) === "codex";

  await Promise.all(pending.map(t => {
    let taskWorkspace: string | undefined;
    if (useIsolation) {
      taskWorkspace = path.join(this.session.workspace, "tasks", String(t["id"]));
      fs.mkdirSync(taskWorkspace, { recursive: true });
    }
    return this.codeTask(t, taskWorkspace);
  }));

  if (useIsolation) {
    this.mergeTaskDirs(path.join(this.session.workspace, "tasks"), this.session.workspace);
    fs.rmSync(path.join(this.session.workspace, "tasks"), { recursive: true, force: true });
  }

  const done = this.session.db.getTasks(this.session.id, "completed").length;
  this.emit(`Coding complete — ${done} tasks done`);
  this.session.advancePhase(Phase.INTEGRATION);
}
```

- [ ] **Step 5.5: Update `codeTask()` in `src/overseer.ts`**

Replace the existing `codeTask()` method signature and workspace usage:

```typescript
private async codeTask(
  task: Record<string, unknown>,
  workspaceOverride?: string,
): Promise<void> {
  const id = String(task["id"]);
  const title = String(task["title"]);
  const workspace = workspaceOverride ?? this.session.workspace;
  this.emit(`Coding: ${title}`);
  this.session.db.updateTask(id, { status: "in_progress" });
  const result = await this.agent(CodingAgent).run({
    taskTitle: title, spec: this.spec(), architecture: this.arch(),
    workspace, taskId: id,
  });
  this.session.db.updateTask(id, { status: result.success ? "completed" : "failed", output: result.output });
  this.emit(`${result.success ? "✓" : "✗"} ${title}`);
  const review = await this.agent(ReviewAgent).run({ taskTitle: title, diff: result.output });
  if (review.success) {
    try {
      const rv = JSON.parse(review.output);
      if (!rv.approved && rv.issues?.length) this.emit(`Review: ${rv.issues[0]}`);
      else this.emit(`Review approved: ${title}`);
    } catch {}
  }
}
```

- [ ] **Step 5.6: Add `mergeTaskDirs()` and `copyDir()` private helpers to `src/overseer.ts`**

Add these two methods to the `Overseer` class (e.g., at the end, before the closing `}`):

```typescript
private mergeTaskDirs(tasksDir: string, dst: string): void {
  if (!fs.existsSync(tasksDir)) return;
  for (const taskId of fs.readdirSync(tasksDir)) {
    const taskDir = path.join(tasksDir, taskId);
    if (!fs.statSync(taskDir).isDirectory()) continue;
    this.copyDir(taskDir, dst);
  }
}

private copyDir(src: string, dst: string): void {
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(dstPath, { recursive: true });
      this.copyDir(srcPath, dstPath);
    } else {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}
```

- [ ] **Step 5.7: Run the overseer tests**

```bash
node --experimental-sqlite node_modules/.bin/jest tests/overseer.test.ts --no-coverage
```

Expected: all tests pass including the new codex workspace isolation test

- [ ] **Step 5.8: Run the full test suite**

```bash
node --experimental-sqlite node_modules/.bin/jest --no-coverage
```

Expected: all tests pass

- [ ] **Step 5.9: Commit**

```bash
git add src/overseer.ts tests/overseer.test.ts
git commit -m "feat: add per-task workspace isolation and merge for codex coding phase"
```

---

## Task 6: `src/config.ts` — setup wizard codex option

**Files:**
- Modify: `src/config.ts` (the `runSetupWizard` async function)

No unit tests for this task: the setup wizard uses `@inquirer/prompts` which requires an interactive TTY and cannot be unit-tested without a heavy mocking harness. Manual verification covers this.

- [ ] **Step 6.1: Add codex option to the provider checkbox in `runSetupWizard()`**

In `src/config.ts`, locate the `providers` checkbox inside `runSetupWizard()`:

```typescript
const providers = await checkbox({
  message: "Which API providers do you have keys for?",
  choices: ["Anthropic (Claude)", "OpenAI", "Google (Gemini)", "Groq", "Mistral"].map(n => ({ name: n, value: n })),
});
```

Replace it with:

```typescript
const providers = await checkbox({
  message: "Which API providers do you have keys for?",
  choices: [
    "Anthropic (Claude)",
    "OpenAI",
    "Google (Gemini)",
    "Groq",
    "Mistral",
    "Codex CLI  (OpenAI Pro subscription — no API key needed)",
  ].map(n => ({ name: n, value: n })),
});
```

- [ ] **Step 6.2: Add the codex short-circuit path in `runSetupWizard()`**

Add the following block immediately after the `providers` checkbox result and before the `PROVIDER_KEY_MAP` / key collection loop:

```typescript
if (providers.includes("Codex CLI  (OpenAI Pro subscription — no API key needed)")) {
  const { checkCodexInstalled } = await import("./codexDriver.js");
  const installed = await checkCodexInstalled();
  if (!installed) {
    console.log("\n✗  codex CLI not found. Install it with:\n\n    npm install -g @openai/codex\n");
    process.exit(1);
  }
  console.log("\n✓  codex CLI detected — no API key needed\n");
  const cfg = new ForgeConfig("codex", {}, 5, priority);
  saveConfig(cfg);
  console.log("✓ Configuration saved to ~/.forge/config.toml\n");
  return cfg;
}
```

- [ ] **Step 6.3: Build the project**

```bash
npm run build
```

Expected: TypeScript compiles with no errors

- [ ] **Step 6.4: Manual smoke test — setup wizard codex path**

```bash
node dist/cli.js setup
```

Walk through the wizard:
1. Select any priority (e.g. "Quality")
2. In the provider checkbox, select "Codex CLI" (use space to check, enter to confirm)
3. If `codex` is installed: should print `✓  codex CLI detected` and save config, then exit
4. If `codex` is not installed: should print install instructions and exit with code 1

Verify `~/.forge/config.toml` contains `profile = "codex"` after a successful run:

```bash
cat ~/.forge/config.toml
# Expected: profile = "codex"
```

- [ ] **Step 6.5: Commit**

```bash
git add src/config.ts
git commit -m "feat: add Codex CLI option to forge setup wizard"
```

---

## Task 7: End-to-end validation

- [ ] **Step 7.1: Run the full test suite one final time**

```bash
node --experimental-sqlite node_modules/.bin/jest --no-coverage
```

Expected: all tests pass

- [ ] **Step 7.2: Build**

```bash
npm run build
```

Expected: zero TypeScript errors

- [ ] **Step 7.3: Manual end-to-end test (requires `codex` CLI installed and OpenAI Pro)**

```bash
node dist/cli.js setup
# Select "Quality", then "Codex CLI"
# Verify: ✓ codex CLI detected, config saved

node dist/cli.js build "a script that prints hello world"
# Verify: all phases complete (IDEATION → ARCHITECTURE → TASK_GRAPH → CODING → ... → DONE)
# Verify: DB logs show CODEX_CALL events (not LLM_CALL with claude/gpt model names)
# Verify: workspace contains generated files
```

- [ ] **Step 7.4: Final commit**

```bash
git add -p  # stage any stray changes
git commit -m "chore: codex subagent feature complete"
```
