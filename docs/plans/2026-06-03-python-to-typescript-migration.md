# Python → TypeScript Migration: Implementation Todo List

> **Spec:** `docs/specs/2026-06-03-python-to-typescript-migration-design.md`
> **Approach:** Clean-slate rewrite in `src-ts/` alongside live Python source. Port in dependency order. Write Jest tests alongside each module. Cutover when all tests pass and e2e smoke test passes.

---

## Phase 0 — Project Scaffolding

- [ ] **0.1** Create `package.json` at repo root

```json
{
  "name": "forgecli",
  "version": "0.1.10",
  "type": "module",
  "bin": { "forgecli": "dist/cli.js" },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "jest",
    "test:watch": "jest --watch"
  },
  "dependencies": {
    "ai": "^4.0.0",
    "@ai-sdk/anthropic": "^1.0.0",
    "@ai-sdk/openai": "^1.0.0",
    "@ai-sdk/google": "^1.0.0",
    "@ai-sdk/groq": "^1.0.0",
    "@ai-sdk/mistral": "^1.0.0",
    "better-sqlite3": "^9.0.0",
    "chalk": "^5.0.0",
    "cli-table3": "^0.6.0",
    "commander": "^12.0.0",
    "ink": "^5.0.0",
    "@inquirer/prompts": "^5.0.0",
    "smol-toml": "^1.0.0",
    "react": "^18.0.0",
    "zod": "^3.0.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.0.0",
    "@types/node": "^20.0.0",
    "@types/react": "^18.0.0",
    "jest": "^29.0.0",
    "ts-jest": "^29.0.0",
    "typescript": "^5.0.0"
  }
}
```

- [ ] **0.2** Create `tsconfig.json` at repo root

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src-ts",
    "strict": true,
    "esModuleInterop": true,
    "jsx": "react",
    "skipLibCheck": true,
    "declaration": true
  },
  "include": ["src-ts/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **0.3** Create `jest.config.ts` at repo root

```typescript
import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts", ".tsx"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { useESM: true }],
  },
  testMatch: ["**/tests/**/*.test.ts"],
};

export default config;
```

- [ ] **0.4** Run `npm install` and confirm it succeeds
- [ ] **0.5** Create `src-ts/` directory and `tests/` directory
- [ ] **0.6** Run `npx tsc --noEmit` — expect no errors (empty project)
- [ ] **0.7** Commit: `chore: add TypeScript project scaffold (package.json, tsconfig, jest)`

---

## Phase 1 — Core Infrastructure (no LLM deps)

### Task 1.1 — `src-ts/stateMachine.ts`

- [ ] **1.1.1** Write `tests/stateMachine.test.ts`

```typescript
import { Phase, transition, InvalidTransitionError } from "../src-ts/stateMachine.js";

test("valid transition IDEATION → ARCHITECTURE", () => {
  expect(transition(Phase.IDEATION, Phase.ARCHITECTURE)).toBe(Phase.ARCHITECTURE);
});

test("valid transition VERIFICATION → CODING (loop back)", () => {
  expect(transition(Phase.VERIFICATION, Phase.CODING)).toBe(Phase.CODING);
});

test("valid transition VERIFICATION → DEPLOY", () => {
  expect(transition(Phase.VERIFICATION, Phase.DEPLOY)).toBe(Phase.DEPLOY);
});

test("invalid transition throws InvalidTransitionError", () => {
  expect(() => transition(Phase.IDEATION, Phase.CODING)).toThrow(InvalidTransitionError);
});

test("cannot leave DONE", () => {
  expect(() => transition(Phase.DONE, Phase.IDEATION)).toThrow(InvalidTransitionError);
});

test("Phase enum values are strings", () => {
  expect(Phase.IDEATION).toBe("IDEATION");
  expect(Phase.CODING).toBe("CODING");
});
```

- [ ] **1.1.2** Run `npm test -- stateMachine` — expect FAIL (module not found)
- [ ] **1.1.3** Implement `src-ts/stateMachine.ts` (see spec §Module Designs / stateMachine.ts)
- [ ] **1.1.4** Run `npm test -- stateMachine` — expect 6 passed
- [ ] **1.1.5** Commit: `feat(ts): add stateMachine.ts with Phase enum and transition guard`

---

### Task 1.2 — `src-ts/db.ts`

- [ ] **1.2.1** Write `tests/db.test.ts`

```typescript
import { ForgeDb } from "../src-ts/db.js";

let db: ForgeDb;

beforeEach(() => { db = new ForgeDb(":memory:"); });
afterEach(() => { db.close(); });

test("createSession returns 8-char ID", () => {
  const id = db.createSession("build a todo app");
  expect(id).toHaveLength(8);
});

test("getSession returns correct row", () => {
  const id = db.createSession("build a todo app");
  const row = db.getSession(id);
  expect(row?.["idea"]).toBe("build a todo app");
  expect(row?.["phase"]).toBe("IDEATION");
  expect(row?.["cycle"]).toBe(0);
});

test("updateSession persists fields", () => {
  const id = db.createSession("idea");
  db.updateSession(id, { phase: "ARCHITECTURE", cycle: 1 });
  const row = db.getSession(id);
  expect(row?.["phase"]).toBe("ARCHITECTURE");
  expect(row?.["cycle"]).toBe(1);
});

test("createTask returns ID and appears in getTasks", () => {
  const sid = db.createSession("idea");
  db.createTask(sid, "Write auth", "coding");
  const tasks = db.getTasks(sid);
  expect(tasks).toHaveLength(1);
  expect(tasks[0]["title"]).toBe("Write auth");
  expect(tasks[0]["status"]).toBe("pending");
});

test("getTasks filters by status", () => {
  const sid = db.createSession("idea");
  const tid = db.createTask(sid, "Write auth", "coding");
  db.updateTask(tid, { status: "completed" });
  expect(db.getTasks(sid, "completed")).toHaveLength(1);
  expect(db.getTasks(sid, "pending")).toHaveLength(0);
});

test("updateTask sets completed_at when status is completed", () => {
  const sid = db.createSession("idea");
  const tid = db.createTask(sid, "task", "coding");
  db.updateTask(tid, { status: "completed" });
  const tasks = db.getTasks(sid);
  expect(tasks[0]["completed_at"]).toBeTruthy();
});

test("logEvent is retrievable", () => {
  const sid = db.createSession("idea");
  db.logEvent(sid, "IDEATION", "Starting ideation");
  const db2 = db as any;
  const events = db2.db.prepare("SELECT * FROM events WHERE session_id = ?").all(sid);
  expect(events).toHaveLength(1);
  expect(events[0].message).toBe("Starting ideation");
});

test("logLlmCall persists cost", () => {
  const sid = db.createSession("idea");
  db.logLlmCall(sid, { model: "claude-opus-4-8", tokensIn: 100, tokensOut: 50, costUsd: 0.003, response: "hi" });
  expect(db.getTotalCost(sid)).toBeCloseTo(0.003);
});

test("saveArtifact versions correctly", () => {
  const sid = db.createSession("idea");
  db.saveArtifact(sid, "src/main.ts", "v1");
  db.saveArtifact(sid, "src/main.ts", "v2");
  const db2 = db as any;
  const rows = db2.db.prepare("SELECT version FROM artifacts WHERE session_id = ? ORDER BY version").all(sid);
  expect(rows.map((r: any) => r.version)).toEqual([1, 2]);
});

test("listSessions aggregates total_cost", () => {
  const sid = db.createSession("idea");
  db.logLlmCall(sid, { model: "m", tokensIn: 1, tokensOut: 1, costUsd: 0.005, response: "r" });
  const sessions = db.listSessions();
  expect(sessions[0]["total_cost"]).toBeCloseTo(0.005);
});
```

- [ ] **1.2.2** Run `npm test -- db` — expect FAIL
- [ ] **1.2.3** Implement `src-ts/db.ts` (see spec §Module Designs / db.ts)
- [ ] **1.2.4** Run `npm test -- db` — expect 10 passed
- [ ] **1.2.5** Commit: `feat(ts): add ForgeDb with identical SQLite schema to Python version`

---

### Task 1.3 — `src-ts/stateMachine.ts` types export (no new test needed — just verify import chain works)

- [ ] **1.3.1** Run `npx tsc --noEmit` — expect no errors

---

## Phase 2 — LLM Router

### Task 2.1 — `src-ts/router.ts`

- [ ] **2.1.1** Write `tests/router.test.ts`

```typescript
import { LLMRouter, ModelTier, DEFAULT_MODELS } from "../src-ts/router.js";

jest.mock("ai", () => ({
  generateText: jest.fn(),
}));

import { generateText } from "ai";
const mockGenerateText = generateText as jest.MockedFunction<typeof generateText>;

beforeEach(() => jest.clearAllMocks());

test("modelFor returns default model for each tier", () => {
  const router = new LLMRouter();
  expect(router.modelFor(ModelTier.OVERSEER)).toBe(DEFAULT_MODELS[ModelTier.OVERSEER]);
  expect(router.modelFor(ModelTier.FAST)).toBe(DEFAULT_MODELS[ModelTier.FAST]);
});

test("override replaces a tier's model", () => {
  const router = new LLMRouter();
  router.override(ModelTier.OVERSEER, "gpt-4o");
  expect(router.modelFor(ModelTier.OVERSEER)).toBe("gpt-4o");
});

test("constructor accepts partial tier overrides", () => {
  const router = new LLMRouter({ [ModelTier.STANDARD]: "gemini/gemini-2.0-flash" });
  expect(router.modelFor(ModelTier.STANDARD)).toBe("gemini/gemini-2.0-flash");
  expect(router.modelFor(ModelTier.OVERSEER)).toBe(DEFAULT_MODELS[ModelTier.OVERSEER]);
});

test("complete returns CallResult with text and token counts", async () => {
  mockGenerateText.mockResolvedValue({
    text: "hello world",
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    toolCalls: [],
  } as any);

  const router = new LLMRouter();
  const result = await router.complete(ModelTier.FAST, [{ role: "user", content: "hi" }]);
  expect(result.content).toBe("hello world");
  expect(result.tokensIn).toBe(10);
  expect(result.tokensOut).toBe(5);
});

test("complete rejects after timeout", async () => {
  mockGenerateText.mockImplementation(() => new Promise(r => setTimeout(r, 10_000)));
  const router = new LLMRouter();
  await expect(
    router.complete(ModelTier.FAST, [{ role: "user", content: "hi" }], 50)
  ).rejects.toThrow("timed out");
}, 1000);

test("completeWithTools normalises toolCalls", async () => {
  mockGenerateText.mockResolvedValue({
    text: null,
    usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
    toolCalls: [{ toolCallId: "tc1", toolName: "bash_exec", args: { command: "ls" } }],
  } as any);

  const router = new LLMRouter();
  const result = await router.completeWithTools(ModelTier.FAST, [], {} as any);
  expect(result.toolCalls).toHaveLength(1);
  expect(result.toolCalls[0]).toEqual({ id: "tc1", name: "bash_exec", arguments: { command: "ls" } });
});
```

- [ ] **2.1.2** Run `npm test -- router` — expect FAIL
- [ ] **2.1.3** Implement `src-ts/router.ts` (see spec §Module Designs / router.ts)
- [ ] **2.1.4** Run `npm test -- router` — expect 6 passed
- [ ] **2.1.5** Commit: `feat(ts): add LLMRouter backed by Vercel AI SDK`

---

## Phase 3 — Config, Model Fetch, Prompt Log, Session

### Task 3.1 — `src-ts/config.ts`

- [ ] **3.1.1** Write `tests/config.test.ts`

```typescript
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ForgeConfig, loadConfig, saveConfig, loadKeys, PROVIDER_PROFILES } from "../src-ts/config.js";
import { ModelTier } from "../src-ts/router.js";

let tmpDir: string;

beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-test-")); });
afterEach(() => { fs.rmSync(tmpDir, { recursive: true }); });

test("ForgeConfig defaults", () => {
  const cfg = new ForgeConfig();
  expect(cfg.profile).toBe("claude-primary");
  expect(cfg.maxCycles).toBe(5);
});

test("tierModels returns correct profile models", () => {
  const cfg = new ForgeConfig("openai-primary");
  const models = cfg.tierModels();
  expect(models[ModelTier.OVERSEER]).toBe("gpt-4o");
});

test("tierModels applies model overrides on top of profile", () => {
  const cfg = new ForgeConfig("claude-primary", { overseer: "gpt-4o" });
  expect(cfg.tierModels()[ModelTier.OVERSEER]).toBe("gpt-4o");
  expect(cfg.tierModels()[ModelTier.STANDARD]).toContain("haiku");
});

test("saveConfig and loadConfig round-trip", () => {
  const configFile = path.join(tmpDir, "config.toml");
  saveConfig(new ForgeConfig("openai-primary", {}, 3), configFile);
  const loaded = loadConfig(configFile);
  expect(loaded.profile).toBe("openai-primary");
  expect(loaded.maxCycles).toBe(3);
});

test("loadConfig returns default when file missing", () => {
  const cfg = loadConfig(path.join(tmpDir, "nonexistent.toml"));
  expect(cfg.profile).toBe("claude-primary");
});

test("loadKeys sets env vars from file", () => {
  const keysFile = path.join(tmpDir, "keys.env");
  fs.writeFileSync(keysFile, "TEST_API_KEY_XYZ=secret123\n");
  delete process.env["TEST_API_KEY_XYZ"];
  loadKeys(keysFile);
  expect(process.env["TEST_API_KEY_XYZ"]).toBe("secret123");
  delete process.env["TEST_API_KEY_XYZ"];
});
```

- [ ] **3.1.2** Run `npm test -- config` — expect FAIL
- [ ] **3.1.3** Implement `src-ts/config.ts`

```typescript
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { ModelTier, DEFAULT_MODELS } from "./router.js";

export const CONFIG_DIR = path.join(os.homedir(), ".forge");
export const CONFIG_FILE = path.join(CONFIG_DIR, "config.toml");
export const KEYS_FILE = path.join(CONFIG_DIR, "keys.env");

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
};

export class ForgeConfig {
  constructor(
    public profile = "claude-primary",
    public models: Record<string, string> = {},
    public maxCycles = 5,
  ) {}

  tierModels(): Record<ModelTier, string> {
    const base = { ...(PROVIDER_PROFILES[this.profile] ?? PROVIDER_PROFILES["claude-primary"]) };
    for (const [tierName, model] of Object.entries(this.models)) {
      if (Object.values(ModelTier).includes(tierName as ModelTier)) {
        base[tierName as ModelTier] = model;
      }
    }
    return base;
  }
}

export function loadConfig(configFile = CONFIG_FILE): ForgeConfig {
  if (!fs.existsSync(configFile)) return new ForgeConfig();
  const data = parseToml(fs.readFileSync(configFile, "utf8")) as any;
  return new ForgeConfig(
    data.profile ?? "claude-primary",
    data.models ?? {},
    data.max_cycles ?? 5,
  );
}

export function saveConfig(cfg: ForgeConfig, configFile = CONFIG_FILE): void {
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  fs.writeFileSync(configFile, stringifyToml({ profile: cfg.profile, models: cfg.models, max_cycles: cfg.maxCycles }));
}

export function saveKeys(keys: Record<string, string>, keysFile = KEYS_FILE): void {
  fs.mkdirSync(path.dirname(keysFile), { recursive: true });
  fs.writeFileSync(keysFile, Object.entries(keys).map(([k, v]) => `${k}=${v}`).join("\n") + "\n", { mode: 0o600 });
}

export function loadKeys(keysFile = KEYS_FILE): void {
  if (!fs.existsSync(keysFile)) return;
  for (const line of fs.readFileSync(keysFile, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...rest] = trimmed.split("=");
    if (!(key in process.env)) process.env[key] = rest.join("=");
  }
}
```

- [ ] **3.1.4** Run `npm test -- config` — expect 6 passed
- [ ] **3.1.5** Commit: `feat(ts): add config.ts with ForgeConfig, load/save, and loadKeys`

---

### Task 3.2 — `src-ts/modelFetch.ts`

- [ ] **3.2.1** Write `tests/modelFetch.test.ts`

```typescript
import { fetchModelsForProvider } from "../src-ts/modelFetch.js";

// Mock fetch — tests verify filtering logic, not live API
global.fetch = jest.fn();

beforeEach(() => (global.fetch as jest.Mock).mockReset());

test("returns empty array when API key missing", async () => {
  const models = await fetchModelsForProvider("Anthropic (Claude)", "");
  expect(Array.isArray(models)).toBe(true);
});

test("filters out embed/tts/whisper models from Anthropic response", async () => {
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: async () => ({
      data: [
        { id: "claude-opus-4-8" },
        { id: "claude-embed-001" },     // should be filtered
        { id: "claude-haiku-4-5-20251001" },
      ],
    }),
  });
  const models = await fetchModelsForProvider("Anthropic (Claude)", "sk-test");
  expect(models).toContain("claude-opus-4-8");
  expect(models.some(m => m.includes("embed"))).toBe(false);
});
```

- [ ] **3.2.2** Run `npm test -- modelFetch` — expect FAIL
- [ ] **3.2.3** Implement `src-ts/modelFetch.ts`

```typescript
const SKIP_PATTERNS = ["embed","tts","whisper","dall-e","-audio","native-audio","-image",
  "gpt-image","chatgpt-image","guard","-instruct","babbage","davinci","curie","-ada-",
  "-live-","deep-research","computer-use","256-x-","512-x-","1024-x-","1536-x-"];

function shouldSkip(id: string): boolean {
  const lower = id.toLowerCase();
  return SKIP_PATTERNS.some(p => lower.includes(p));
}

async function httpGetJson(url: string, headers: Record<string, string>): Promise<any> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchAnthropic(apiKey: string): Promise<string[]> {
  const data = await httpGetJson("https://api.anthropic.com/v1/models", {
    "x-api-key": apiKey, "anthropic-version": "2023-06-01",
  });
  return (data.data ?? [])
    .map((m: any) => m.id as string)
    .filter((id: string) => id.startsWith("claude") && !shouldSkip(id))
    .sort()
    .reverse();
}

async function fetchOpenAI(apiKey: string): Promise<string[]> {
  const data = await httpGetJson("https://api.openai.com/v1/models", { Authorization: `Bearer ${apiKey}` });
  return (data.data ?? []).map((m: any) => m.id as string).filter((id: string) => !shouldSkip(id)).sort().reverse();
}

async function fetchGoogle(apiKey: string): Promise<string[]> {
  const data = await httpGetJson(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`, {});
  return (data.models ?? [])
    .map((m: any) => m.name as string)
    .filter((n: string) => n.startsWith("models/gemini"))
    .map((n: string) => "gemini/" + n.replace("models/", ""))
    .filter((id: string) => !shouldSkip(id))
    .sort().reverse();
}

async function fetchGroq(apiKey: string): Promise<string[]> {
  const data = await httpGetJson("https://api.groq.com/openai/v1/models", { Authorization: `Bearer ${apiKey}` });
  return (data.data ?? [])
    .map((m: any) => m.id as string)
    .filter((id: string) => !shouldSkip(id))
    .map((id: string) => id.startsWith("groq/") ? id : `groq/${id}`)
    .sort().reverse();
}

async function fetchMistral(apiKey: string): Promise<string[]> {
  const data = await httpGetJson("https://api.mistral.ai/v1/models", { Authorization: `Bearer ${apiKey}` });
  return (data.data ?? [])
    .map((m: any) => m.id as string)
    .filter((id: string) => !shouldSkip(id))
    .map((id: string) => id.startsWith("mistral/") ? id : `mistral/${id}`)
    .sort().reverse();
}

const FETCHERS: Record<string, (key: string) => Promise<string[]>> = {
  "Anthropic (Claude)": fetchAnthropic,
  "OpenAI": fetchOpenAI,
  "Google (Gemini)": fetchGoogle,
  "Groq": fetchGroq,
  "Mistral": fetchMistral,
};

export async function fetchModelsForProvider(providerLabel: string, apiKey: string): Promise<string[]> {
  if (!apiKey) return [];
  const fetcher = FETCHERS[providerLabel];
  if (!fetcher) return [];
  try {
    const result = await fetcher(apiKey);
    return result.length ? result : [];
  } catch {
    return [];
  }
}
```

- [ ] **3.2.4** Run `npm test -- modelFetch` — expect 3 passed
- [ ] **3.2.5** Commit: `feat(ts): add modelFetch.ts with per-provider API model fetching`

---

### Task 3.3 — `src-ts/promptLog.ts`

- [ ] **3.3.1** Write `tests/promptLog.test.ts`

```typescript
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
```

- [ ] **3.3.2** Run `npm test -- promptLog` — expect FAIL
- [ ] **3.3.3** Implement `src-ts/promptLog.ts`

```typescript
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { CoreMessage } from "ai";

const SESSIONS_DIR = path.join(os.homedir(), ".forge", "sessions");

export function logPath(sessionId: string, sessionsDir = SESSIONS_DIR): string {
  return path.join(sessionsDir, sessionId, "logs", "prompts.log");
}

interface LogEntry {
  agent: string; tier: string; model: string;
  messages: CoreMessage[]; response: string;
  tokensIn: number; tokensOut: number; costUsd: number;
  toolsCalled?: string[];
}

export class PromptLogger {
  private filePath: string;

  constructor(sessionId: string, sessionsDir = SESSIONS_DIR) {
    this.filePath = logPath(sessionId, sessionsDir);
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
  }

  log(entry: LogEntry): void {
    let userPrompt = "";
    for (let i = entry.messages.length - 1; i >= 0; i--) {
      const m = entry.messages[i];
      if (m.role === "user" && typeof m.content === "string") {
        userPrompt = m.content;
        break;
      }
    }
    const record: Record<string, unknown> = {
      ts: new Date().toISOString(),
      agent: entry.agent, tier: entry.tier, model: entry.model,
      tokens_in: entry.tokensIn, tokens_out: entry.tokensOut,
      cost_usd: entry.costUsd, user_prompt: userPrompt, response: entry.response,
    };
    if (entry.toolsCalled?.length) record["tools_called"] = entry.toolsCalled;
    fs.appendFileSync(this.filePath, JSON.stringify(record) + "\n");
  }
}
```

- [ ] **3.3.4** Run `npm test -- promptLog` — expect 3 passed
- [ ] **3.3.5** Commit: `feat(ts): add PromptLogger writing JSONL prompt log per session`

---

### Task 3.4 — `src-ts/session.ts`

- [ ] **3.4.1** Write `tests/session.test.ts`

```typescript
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Session, SESSIONS_DIR } from "../src-ts/session.js";
import { Phase, InvalidTransitionError } from "../src-ts/stateMachine.js";
import { ForgeConfig } from "../src-ts/config.js";

let tmpDir: string;

// Override SESSIONS_DIR for tests
jest.mock("../src-ts/session.js", () => {
  const actual = jest.requireActual("../src-ts/session.js");
  return { ...actual };
});

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-session-test-"));
  // Override SESSIONS_DIR at module level via jest.spyOn isn't possible on const,
  // so we patch the config loader instead
  jest.spyOn(require("../src-ts/config.js"), "loadConfig").mockReturnValue(new ForgeConfig());
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true });
  jest.restoreAllMocks();
});

function makeSession(): Session {
  return Session.create("build a todo app", undefined, tmpDir);
}

test("create makes workspace and logs dirs", () => {
  const s = makeSession();
  expect(fs.existsSync(s.workspace)).toBe(true);
  expect(fs.existsSync(path.join(path.dirname(s.workspace), "logs"))).toBe(true);
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
```

- [ ] **3.4.2** Run `npm test -- session` — expect FAIL
- [ ] **3.4.3** Implement `src-ts/session.ts`

```typescript
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { randomUUID } from "crypto";
import { ForgeDb } from "./db.js";
import { LLMRouter } from "./router.js";
import { ForgeConfig, loadConfig } from "./config.js";
import { Phase, transition } from "./stateMachine.js";

export const SESSIONS_DIR = path.join(os.homedir(), ".forge", "sessions");

export class Session {
  constructor(
    public id: string,
    public idea: string,
    public phase: Phase,
    public cycle: number,
    public maxCycles: number,
    public deployTarget: string | undefined,
    public workspace: string,
    public db: ForgeDb,
    public router: LLMRouter,
    public config: ForgeConfig,
  ) {}

  static create(idea: string, deployTarget?: string, sessionsDir = SESSIONS_DIR): Session {
    const id = randomUUID().slice(0, 8);
    const sessionDir = path.join(sessionsDir, id);
    fs.mkdirSync(path.join(sessionDir, "workspace"), { recursive: true });
    fs.mkdirSync(path.join(sessionDir, "logs"), { recursive: true });
    const cfg = loadConfig();
    const db = new ForgeDb(path.join(sessionDir, "session.db"));
    db.createSession(idea);
    if (deployTarget) db.updateSession(id, { deploy_target: deployTarget });
    return new Session(
      id, idea, Phase.IDEATION, 0, cfg.maxCycles, deployTarget,
      path.join(sessionDir, "workspace"),
      db, new LLMRouter(cfg.tierModels()), cfg,
    );
  }

  static load(sessionId: string, sessionsDir = SESSIONS_DIR): Session {
    const sessionDir = path.join(sessionsDir, sessionId);
    if (!fs.existsSync(sessionDir)) throw new Error(`Session ${sessionId} not found`);
    const cfg = loadConfig();
    const db = new ForgeDb(path.join(sessionDir, "session.db"));
    const row = db.getSession(sessionId);
    if (!row) throw new Error(`Session ${sessionId} not in database`);
    return new Session(
      sessionId, String(row["idea"]), row["phase"] as Phase,
      Number(row["cycle"]), Number(row["max_cycles"]),
      row["deploy_target"] as string | undefined,
      path.join(sessionDir, "workspace"),
      db, new LLMRouter(cfg.tierModels()), cfg,
    );
  }

  static loadLast(sessionsDir = SESSIONS_DIR): Session {
    if (!fs.existsSync(sessionsDir)) throw new Error("No sessions found");
    const dirs = fs.readdirSync(sessionsDir)
      .map(name => ({ name, mtime: fs.statSync(path.join(sessionsDir, name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    if (!dirs.length) throw new Error("No sessions found");
    return Session.load(dirs[0].name, sessionsDir);
  }

  advancePhase(next: Phase): void {
    transition(this.phase, next);
    this.phase = next;
    this.db.updateSession(this.id, { phase: next });
  }

  incrementCycle(): void {
    this.cycle++;
    this.db.updateSession(this.id, { cycle: this.cycle });
  }
}
```

- [ ] **3.4.4** Run `npm test -- session` — expect 7 passed
- [ ] **3.4.5** Commit: `feat(ts): add Session with create/load/loadLast and phase transitions`

---

## Phase 4 — Tools

### Task 4.1 — `src-ts/tools/definitions.ts`

- [ ] **4.1.1** Write `tests/tools/definitions.test.ts`

```typescript
import { TOOL_DEFINITIONS } from "../../src-ts/tools/definitions.js";

test("TOOL_DEFINITIONS contains all four tools", () => {
  expect(Object.keys(TOOL_DEFINITIONS)).toEqual(
    expect.arrayContaining(["bash_exec", "read_file", "write_file", "list_dir"])
  );
});

test("each tool has description and parameters", () => {
  for (const [name, def] of Object.entries(TOOL_DEFINITIONS)) {
    expect((def as any).description).toBeTruthy();
    expect((def as any).parameters).toBeTruthy();
  }
});
```

- [ ] **4.1.2** Implement `src-ts/tools/definitions.ts`

```typescript
import { tool } from "ai";
import { z } from "zod";

export const TOOL_DEFINITIONS = {
  bash_exec: tool({
    description: "Execute a bash command in the project workspace directory. Use for: running tests, building, checking syntax, installing packages, inspecting directory structure. stdout and stderr are captured.",
    parameters: z.object({
      command: z.string().describe("The bash command to run. Runs with cwd=workspace."),
      timeout: z.number().optional().default(60).describe("Max seconds to wait. Defaults to 60."),
    }),
  }),
  read_file: tool({
    description: "Read the full contents of a file in the workspace. Path is relative to the workspace root.",
    parameters: z.object({
      path: z.string().describe("Relative path from workspace root, e.g. 'src/App.tsx'"),
    }),
  }),
  write_file: tool({
    description: "Write (or overwrite) a file in the workspace. Creates parent directories automatically. Path is relative to workspace root.",
    parameters: z.object({
      path: z.string().describe("Relative path from workspace root"),
      content: z.string().describe("Full file content to write"),
    }),
  }),
  list_dir: tool({
    description: "List files and directories at a given path in the workspace. Path is relative to workspace root.",
    parameters: z.object({
      path: z.string().optional().default(".").describe("Relative path to list. Defaults to '.' (workspace root)."),
    }),
  }),
};
```

- [ ] **4.1.3** Run `npm test -- definitions` — expect 2 passed
- [ ] **4.1.4** Commit: `feat(ts): add tool definitions using Vercel AI SDK + zod`

---

### Task 4.2 — `src-ts/tools/executor.ts`

- [ ] **4.2.1** Write `tests/tools/executor.test.ts`

```typescript
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
```

- [ ] **4.2.2** Run `npm test -- executor` — expect FAIL
- [ ] **4.2.3** Implement `src-ts/tools/executor.ts` (see spec §Module Designs / tools/executor.ts)
- [ ] **4.2.4** Run `npm test -- executor` — expect 9 passed
- [ ] **4.2.5** Commit: `feat(ts): add tool executor with workspace sandboxing and safety blocks`

---

## Phase 5 — Agents

### Task 5.1 — `src-ts/agents/base.ts`

- [ ] **5.1.1** Write `tests/agents/base.test.ts`

```typescript
import { BaseAgent, AgentResult } from "../../src-ts/agents/base.js";
import { LLMRouter, ModelTier } from "../../src-ts/router.js";
import { ForgeDb } from "../../src-ts/db.js";

class ConcreteAgent extends BaseAgent {
  async run(): Promise<AgentResult> {
    const content = await this.call([{ role: "user", content: "hello" }]);
    return { success: true, output: content };
  }
}

let db: ForgeDb;
let sessionId: string;
let mockRouter: jest.Mocked<LLMRouter>;

beforeEach(() => {
  db = new ForgeDb(":memory:");
  sessionId = db.createSession("test idea");
  mockRouter = {
    modelFor: jest.fn().mockReturnValue("claude-haiku"),
    override: jest.fn(),
    complete: jest.fn().mockResolvedValue({ content: "test response", model: "claude-haiku", tokensIn: 10, tokensOut: 5, costUsd: 0.001 }),
    completeWithTools: jest.fn(),
  } as any;
});

afterEach(() => db.close());

test("call returns LLM content", async () => {
  const agent = new ConcreteAgent(mockRouter, db, sessionId);
  const result = await agent.run();
  expect(result.output).toBe("test response");
});

test("call logs llm_call to db", async () => {
  const agent = new ConcreteAgent(mockRouter, db, sessionId);
  await agent.run();
  expect(db.getTotalCost(sessionId)).toBeCloseTo(0.001);
});

test("extractJson handles fenced markdown", () => {
  const agent = new ConcreteAgent(mockRouter, db, sessionId);
  const result = (agent as any).extractJson('```json\n{"key": "value"}\n```');
  expect(JSON.parse(result)).toEqual({ key: "value" });
});

test("extractJson handles embedded JSON in prose", () => {
  const agent = new ConcreteAgent(mockRouter, db, sessionId);
  const result = (agent as any).extractJson('Here is the data: {"key": 42} — done.');
  expect(JSON.parse(result)).toEqual({ key: 42 });
});
```

- [ ] **5.1.2** Run `npm test -- agents/base` — expect FAIL
- [ ] **5.1.3** Implement `src-ts/agents/base.ts` (see spec §Module Designs / agents/base.ts)
- [ ] **5.1.4** Run `npm test -- agents/base` — expect 4 passed
- [ ] **5.1.5** Commit: `feat(ts): add BaseAgent abstract class with call() and runAgenticLoop()`

---

### Task 5.2 — One-Shot Agents (ideation, architecture, taskGraph, review, deploy)

- [ ] **5.2.1** Write `tests/agents/oneshot.test.ts`

```typescript
import { IdeationAgent } from "../../src-ts/agents/ideation.js";
import { ArchitectureAgent } from "../../src-ts/agents/architecture.js";
import { TaskGraphAgent } from "../../src-ts/agents/taskGraph.js";
import { ReviewAgent } from "../../src-ts/agents/review.js";
import { DeployAgent } from "../../src-ts/agents/deploy.js";
import { ForgeDb } from "../../src-ts/db.js";

function makeRouter(content: string) {
  return {
    modelFor: jest.fn().mockReturnValue("claude-haiku"),
    override: jest.fn(),
    complete: jest.fn().mockResolvedValue({ content, model: "m", tokensIn: 1, tokensOut: 1, costUsd: 0 }),
    completeWithTools: jest.fn(),
  } as any;
}

let db: ForgeDb;
let sessionId: string;
beforeEach(() => { db = new ForgeDb(":memory:"); sessionId = db.createSession("test"); });
afterEach(() => db.close());

// IdeationAgent
test("IdeationAgent returns question error when response is not JSON", async () => {
  const agent = new IdeationAgent(makeRouter("Is this single-user?"), db, sessionId);
  const result = await agent.run({ idea: "todo app", conversation: [] });
  expect(result.error).toBe("question");
  expect(result.output).toBe("Is this single-user?");
});

test("IdeationAgent returns spec when response is JSON", async () => {
  const spec = JSON.stringify({ name: "todo-app", description: "d", tech_stack: [], features: [], out_of_scope: [], assumptions: [] });
  const agent = new IdeationAgent(makeRouter(spec), db, sessionId);
  const result = await agent.run({ idea: "todo app", conversation: [] });
  expect(result.error).toBeUndefined();
  expect(JSON.parse(result.output).name).toBe("todo-app");
});

// ArchitectureAgent
test("ArchitectureAgent returns success with structured JSON", async () => {
  const arch = JSON.stringify({ stack: { language: "TS" }, structure: [], deploy_platforms: [], test_framework: "jest", verification_method: "api" });
  const agent = new ArchitectureAgent(makeRouter(arch), db, sessionId);
  const result = await agent.run({ spec: "{}" });
  expect(result.success).toBe(true);
  expect(JSON.parse(result.output).stack.language).toBe("TS");
});

// TaskGraphAgent
test("TaskGraphAgent returns task array", async () => {
  const tasks = JSON.stringify([{ title: "Setup", type: "coding", deps: [] }]);
  const agent = new TaskGraphAgent(makeRouter(tasks), db, sessionId);
  const result = await agent.run({ spec: "{}", architecture: "{}" });
  expect(result.success).toBe(true);
  expect(JSON.parse(result.output)).toHaveLength(1);
});

// ReviewAgent
test("ReviewAgent returns structured review", async () => {
  const review = JSON.stringify({ approved: true, issues: [], suggestions: [] });
  const agent = new ReviewAgent(makeRouter(review), db, sessionId);
  const result = await agent.run({ taskTitle: "Auth", diff: "+ def login(): pass" });
  expect(result.success).toBe(true);
  expect(JSON.parse(result.output).approved).toBe(true);
});

// DeployAgent
test("DeployAgent returns error for unknown target", async () => {
  const agent = new DeployAgent(makeRouter(""), db, sessionId);
  const result = await agent.run({ workspace: "/tmp", architecture: "{}", target: "unknown" });
  expect(result.success).toBe(false);
  expect(result.error).toContain("Unknown deploy target");
});
```

- [ ] **5.2.2** Run `npm test -- oneshot` — expect FAIL
- [ ] **5.2.3** Implement `src-ts/agents/ideation.ts`

```typescript
import { BaseAgent, AgentResult } from "./base.js";
import { ModelTier } from "../router.js";

const SYSTEM = `You are an expert product architect. Take a raw idea and produce a clear, buildable product spec.

Ask ONE clarifying question at a time (max 3 total). After 3 questions or when you have enough context, output a JSON spec:

{
  "name": "kebab-case-name",
  "description": "one paragraph",
  "tech_stack": ["list"],
  "features": ["list"],
  "out_of_scope": ["list"],
  "assumptions": ["list of assumptions made"]
}

Output ONLY the JSON when producing the spec. Output ONLY the question string when asking.`;

export class IdeationAgent extends BaseAgent {
  protected tier = ModelTier.OVERSEER;

  async run(args: { idea: string; conversation: { role: string; content: string }[] }): Promise<AgentResult> {
    const messages: any[] = [
      { role: "system", content: SYSTEM },
      { role: "user", content: `Idea: ${args.idea}` },
    ];
    for (const turn of args.conversation ?? []) {
      messages.push({ role: turn.role === "question" ? "assistant" : "user", content: turn.content });
    }
    const response = await this.call(messages);
    try {
      const spec = JSON.parse(this.extractJson(response));
      return { success: true, output: JSON.stringify(spec) };
    } catch {
      return { success: true, output: response, error: "question" };
    }
  }
}
```

- [ ] **5.2.4** Implement `src-ts/agents/architecture.ts`

```typescript
import { BaseAgent, AgentResult } from "./base.js";
import { ModelTier } from "../router.js";

const SYSTEM = `You are a software architect. Given a product spec, choose the ideal tech stack and project structure.

Output ONLY valid JSON:
{
  "stack": {"language": "...", "framework": "...", "database": "...", "extras": []},
  "structure": ["list of key file paths / dirs"],
  "deploy_platforms": ["vercel|railway|fly.io|none"],
  "test_framework": "pytest|vitest|go-test|jest|...",
  "verification_method": "web|api|cli"
}

Important: For React frontend apps, prefer Vite (framework: "Vite+React") over Create React App.`;

export class ArchitectureAgent extends BaseAgent {
  protected tier = ModelTier.OVERSEER;

  async run(args: { spec: string }): Promise<AgentResult> {
    const messages: any[] = [
      { role: "system", content: SYSTEM },
      { role: "user", content: `Spec:\n${args.spec}` },
    ];
    const response = await this.call(messages);
    try {
      const cleaned = this.extractJson(response);
      JSON.parse(cleaned);
      return { success: true, output: cleaned };
    } catch {
      return { success: false, output: response, error: "invalid_json" };
    }
  }
}
```

- [ ] **5.2.5** Implement `src-ts/agents/taskGraph.ts`

```typescript
import { BaseAgent, AgentResult } from "./base.js";
import { ModelTier } from "../router.js";

const SYSTEM = `You are a senior engineer breaking a product into coding tasks.

Output ONLY a valid JSON array of tasks. Each task:
{
  "title": "imperative title",
  "type": "coding",
  "deps": ["list of titles this depends on"]
}

Rules:
- Each task writes one focused unit (one file or one endpoint group)
- Order deps correctly so parallelism is possible
- No task should be too large; max ~150 lines of code per task`;

export class TaskGraphAgent extends BaseAgent {
  protected tier = ModelTier.REASONING;

  async run(args: { spec: string; architecture: string }): Promise<AgentResult> {
    const messages: any[] = [
      { role: "system", content: SYSTEM },
      { role: "user", content: `Spec:\n${args.spec}\n\nArchitecture:\n${args.architecture}` },
    ];
    const response = await this.call(messages);
    try {
      const tasks = JSON.parse(this.extractJson(response));
      return { success: true, output: JSON.stringify(tasks) };
    } catch {
      return { success: false, output: response, error: "invalid_json" };
    }
  }
}
```

- [ ] **5.2.6** Implement `src-ts/agents/review.ts`

```typescript
import { BaseAgent, AgentResult } from "./base.js";
import { ModelTier } from "../router.js";

const SYSTEM = `You are a code reviewer. Review the diff for a specific task.

Output ONLY valid JSON:
{
  "approved": true|false,
  "issues": ["blocking issue description", ...],
  "suggestions": ["non-blocking improvement", ...]
}

Approve if there are no blocking correctness issues. Flag: missing error handling at boundaries, broken imports, logic bugs, security holes.`;

export class ReviewAgent extends BaseAgent {
  protected tier = ModelTier.STANDARD;

  async run(args: { taskTitle: string; diff: string }): Promise<AgentResult> {
    const messages: any[] = [
      { role: "system", content: SYSTEM },
      { role: "user", content: `Task: ${args.taskTitle}\n\nDiff:\n${args.diff}` },
    ];
    const response = await this.call(messages);
    try {
      const cleaned = this.extractJson(response);
      JSON.parse(cleaned);
      return { success: true, output: cleaned };
    } catch {
      return { success: false, output: response, error: "invalid_json" };
    }
  }
}
```

- [ ] **5.2.7** Implement `src-ts/agents/deploy.ts`

```typescript
import { execSync } from "child_process";
import { BaseAgent, AgentResult } from "./base.js";
import { ModelTier } from "../router.js";

const DEPLOY_CMDS: Record<string, string[]> = {
  vercel: ["vercel", "--yes"],
  railway: ["railway", "up"],
  "fly.io": ["fly", "deploy"],
};

export class DeployAgent extends BaseAgent {
  protected tier = ModelTier.STANDARD;

  async run(args: { workspace: string; architecture: string; target: string }): Promise<AgentResult> {
    const cmd = DEPLOY_CMDS[args.target];
    if (!cmd) return { success: false, output: "", error: `Unknown deploy target: ${args.target}` };
    try {
      const output = execSync(cmd.join(" "), { cwd: args.workspace, encoding: "utf8", stdio: "pipe" });
      return { success: true, output };
    } catch (e: any) {
      return { success: false, output: e.stdout + e.stderr, error: "deploy_failed" };
    }
  }
}
```

- [ ] **5.2.8** Run `npm test -- oneshot` — expect 6 passed
- [ ] **5.2.9** Commit: `feat(ts): add one-shot agents (ideation, architecture, taskGraph, review, deploy)`

---

### Task 5.3 — Agentic Loop Agents (coding, integration, testAgent, verification)

- [ ] **5.3.1** Write `tests/agents/agentic.test.ts`

```typescript
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { CodingAgent } from "../../src-ts/agents/coding.js";
import { IntegrationAgent } from "../../src-ts/agents/integration.js";
import { TestAgent } from "../../src-ts/agents/testAgent.js";
import { VerificationAgent } from "../../src-ts/agents/verification.js";
import { ForgeDb } from "../../src-ts/db.js";

let workspace: string;
let db: ForgeDb;
let sessionId: string;

beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "forge-agent-test-"));
  db = new ForgeDb(":memory:");
  sessionId = db.createSession("test");
});
afterEach(() => { db.close(); fs.rmSync(workspace, { recursive: true }); });

function makeRouter(text: string | null, toolCalls: any[] = []) {
  return {
    modelFor: jest.fn().mockReturnValue("claude-sonnet"),
    override: jest.fn(),
    complete: jest.fn(),
    completeWithTools: jest.fn().mockResolvedValue({ text, toolCalls, model: "m", tokensIn: 1, tokensOut: 1, costUsd: 0 }),
  } as any;
}

// CodingAgent
test("CodingAgent calls runAgenticLoop and returns summary", async () => {
  const router = makeRouter("Wrote src/main.ts with hello world logic.");
  const agent = new CodingAgent(router, db, sessionId);
  const result = await agent.run({ taskTitle: "Write main", spec: "{}", architecture: "{}", workspace });
  expect(result.success).toBe(true);
  expect(result.output).toContain("Wrote");
});

test("CodingAgent saves artifacts from workspace files", async () => {
  fs.mkdirSync(path.join(workspace, "src"), { recursive: true });
  fs.writeFileSync(path.join(workspace, "src", "main.ts"), "export {}");
  const router = makeRouter("Done.");
  const agent = new CodingAgent(router, db, sessionId);
  await agent.run({ taskTitle: "task", spec: "{}", architecture: "{}", workspace });
  const db2 = db as any;
  const artifacts = db2.db.prepare("SELECT * FROM artifacts").all();
  expect(artifacts.length).toBeGreaterThanOrEqual(1);
});

// IntegrationAgent
test("IntegrationAgent runs agentic loop on workspace", async () => {
  fs.writeFileSync(path.join(workspace, "index.ts"), "import './missing'");
  const router = makeRouter("Fixed import in index.ts");
  const agent = new IntegrationAgent(router, db, sessionId);
  const result = await agent.run({ workspace, spec: "{}", architecture: "{}" });
  expect(result.success).toBe(true);
});

// VerificationAgent
test("VerificationAgent parses passed report as success", async () => {
  const report = JSON.stringify({ passed: ["Build OK"], failed: [], errors: [] });
  const router = makeRouter(report);
  const agent = new VerificationAgent(router, db, sessionId);
  const result = await agent.run({ workspace, architecture: JSON.stringify({ verification_method: "cli", stack: {} }), spec: "{}" });
  expect(result.success).toBe(true);
});

test("VerificationAgent parses failed report as failure", async () => {
  const report = JSON.stringify({ passed: [], failed: ["Build failed"], errors: ["exit 1"] });
  const router = makeRouter(report);
  const agent = new VerificationAgent(router, db, sessionId);
  const result = await agent.run({ workspace, architecture: JSON.stringify({ verification_method: "cli", stack: {} }), spec: "{}" });
  expect(result.success).toBe(false);
  expect(result.error).toBe("verification_failed");
});
```

- [ ] **5.3.2** Run `npm test -- agentic` — expect FAIL
- [ ] **5.3.3** Implement `src-ts/agents/coding.ts`

```typescript
import * as fs from "fs";
import * as path from "path";
import { BaseAgent, AgentResult } from "./base.js";
import { ModelTier } from "../router.js";

const SYSTEM = `You are a senior software engineer implementing one focused coding task.

You have tools available:
- bash_exec: run shell commands (build, lint, syntax check, install packages)
- read_file: read any file in the workspace
- write_file: write or overwrite a file in the workspace
- list_dir: list directory contents

Workflow:
1. Use list_dir and read_file to understand the existing codebase and conventions
2. Write the files needed for this task using write_file
3. Run a quick sanity check (e.g. npx tsc --noEmit) if useful
4. When the task is complete, output a brief summary of what you wrote

Rules:
- Write complete, working code — no placeholders or TODOs
- Match the existing code style you observe in the workspace
- Follow the architecture and stack decisions exactly`;

export class CodingAgent extends BaseAgent {
  protected tier = ModelTier.REASONING;

  async run(args: { taskTitle: string; spec: string; architecture: string; workspace: string; context?: string; taskId?: string }): Promise<AgentResult> {
    const messages: any[] = [
      { role: "system", content: SYSTEM },
      { role: "user", content: `Task: ${args.taskTitle}\n\nSpec:\n${args.spec}\n\nArchitecture:\n${args.architecture}${args.context ? `\n\nContext from prior tasks:\n${args.context}` : ""}\n\nWorkspace root: ${args.workspace}` },
    ];
    const summary = await this.runAgenticLoop(messages, args.workspace, args.taskId);
    const written: string[] = [];
    for (const entry of this.walkWorkspace(args.workspace)) {
      try {
        const content = fs.readFileSync(entry.full, "utf8");
        this.db.saveArtifact(this.sessionId, entry.rel, content);
        written.push(entry.rel);
      } catch {}
    }
    return { success: true, output: summary || `Wrote ${written.length} files` };
  }

  private walkWorkspace(workspace: string): { full: string; rel: string }[] {
    const result: { full: string; rel: string }[] = [];
    const walk = (dir: string) => {
      for (const name of fs.readdirSync(dir)) {
        if (name.startsWith(".")) continue;
        const full = path.join(dir, name);
        if (fs.statSync(full).isDirectory()) walk(full);
        else result.push({ full, rel: path.relative(workspace, full) });
      }
    };
    if (fs.existsSync(workspace)) walk(workspace);
    return result;
  }
}
```

- [ ] **5.3.4** Implement `src-ts/agents/integration.ts`

```typescript
import * as fs from "fs";
import * as path from "path";
import { BaseAgent, AgentResult } from "./base.js";
import { ModelTier } from "../router.js";

const SYSTEM = `You are a senior engineer responsible for wiring a project together after all tasks are coded.

You have tools available:
- bash_exec: run shell commands (build, import checks, linting)
- read_file: read any file in the workspace
- write_file: write or overwrite a file in the workspace
- list_dir: list directory contents

Workflow:
1. Use list_dir to get the project structure
2. Read key entry points and configuration files to find integration issues: broken imports, missing wiring, interface mismatches, wrong file paths
3. Fix each issue by writing the corrected file with write_file
4. Run a build or import check after your fixes to confirm they work
5. When everything is wired correctly, stop calling tools and write a brief summary

If nothing needs fixing, say so immediately without calling any tools.`;

export class IntegrationAgent extends BaseAgent {
  protected tier = ModelTier.REASONING;

  async run(args: { workspace: string; spec: string; architecture: string }): Promise<AgentResult> {
    const messages: any[] = [
      { role: "system", content: SYSTEM },
      { role: "user", content: `Spec:\n${args.spec}\n\nArchitecture:\n${args.architecture}\n\nWorkspace root: ${args.workspace}` },
    ];
    const summary = await this.runAgenticLoop(messages, args.workspace);
    return { success: true, output: summary || "Integration complete" };
  }
}
```

- [ ] **5.3.5** Implement `src-ts/agents/testAgent.ts`

```typescript
import { BaseAgent, AgentResult } from "./base.js";
import { ModelTier } from "../router.js";

const SYSTEM = `You are a test engineer. Write tests for this project and make them pass.

You have tools available:
- bash_exec: run the test suite and see results
- read_file: read source files to understand what to test
- write_file: write test files
- list_dir: list directory contents

Workflow:
1. Use list_dir and read_file to understand the source code structure
2. Write tests using write_file — import only from files that actually exist
3. Run the tests with bash_exec to see results
4. Fix any failing tests by writing corrected files
5. Repeat until tests pass or you have exhausted reasonable fixes
6. Write a summary of what you tested and the final result

Critical rules:
- ONLY import from files that ACTUALLY EXIST (verify with read_file first)
- Do NOT invent utility functions that don't exist in the source
- Keep tests simple — test one behaviour per test`;

export class TestAgent extends BaseAgent {
  protected tier = ModelTier.REASONING;

  async run(args: { workspace: string; architecture: string }): Promise<AgentResult> {
    const arch = typeof args.architecture === "string" ? JSON.parse(args.architecture) : args.architecture;
    const framework = arch.test_framework ?? "jest";
    const messages: any[] = [
      { role: "system", content: SYSTEM },
      { role: "user", content: `Test framework: ${framework}\nWorkspace root: ${args.workspace}` },
    ];
    const summary = await this.runAgenticLoop(messages, args.workspace);
    const lower = summary.toLowerCase();
    const passed = lower.includes("pass") || summary.includes("✓") || lower.includes("success") || lower.includes("all tests");
    return { success: passed, output: summary, error: passed ? undefined : "tests_failed" };
  }
}
```

- [ ] **5.3.6** Implement `src-ts/agents/verification.ts`

```typescript
import * as path from "path";
import { execSync, spawn } from "child_process";
import { BaseAgent, AgentResult } from "./base.js";
import { ModelTier } from "../router.js";

const SYSTEM = `You are a QA engineer verifying that a project builds and its tests pass.

You have tools available:
- bash_exec: run build commands, test suites, linters
- read_file: read files to understand failures
- write_file: apply quick fixes for obvious issues
- list_dir: list directory contents

Workflow:
1. Use list_dir to understand the project structure
2. Run the build (e.g. \`npm run build\` or \`python -m pytest\`) with bash_exec
3. If it fails: read the relevant source files, understand the error, apply a targeted fix
4. Re-run to confirm the fix worked
5. Run the test suite after a successful build
6. When satisfied, output a JSON report:

{
  "passed": ["Build succeeded", "All 5 tests passed"],
  "failed": [],
  "errors": []
}

Output ONLY the JSON report as your final message. Do not wrap it in markdown.`;

export class VerificationAgent extends BaseAgent {
  protected tier = ModelTier.REASONING;

  async run(args: { workspace: string; architecture: string; spec: string }): Promise<AgentResult> {
    const messages: any[] = [
      { role: "system", content: SYSTEM },
      { role: "user", content: `Architecture:\n${args.architecture}\n\nSpec:\n${args.spec}\n\nWorkspace root: ${args.workspace}` },
    ];
    const response = await this.runAgenticLoop(messages, args.workspace);
    let report: Record<string, unknown[]>;
    try {
      report = JSON.parse(this.extractJson(response));
    } catch {
      report = { passed: [], failed: ["Verification agent returned malformed report"], errors: [response.slice(0, 300)] };
    }
    const success = (report["failed"] as unknown[]).length === 0 && (report["errors"] as unknown[]).length === 0;
    return { success, output: JSON.stringify(report), error: success ? undefined : "verification_failed" };
  }
}
```

- [ ] **5.3.7** Run `npm test -- agentic` — expect 5 passed
- [ ] **5.3.8** Commit: `feat(ts): add agentic loop agents (coding, integration, testAgent, verification)`

---

## Phase 6 — Overseer

### Task 6.1 — `src-ts/overseer.ts`

- [ ] **6.1.1** Write `tests/overseer.test.ts`

```typescript
import { Overseer } from "../src-ts/overseer.js";
import { Session } from "../src-ts/session.js";
import { Phase } from "../src-ts/stateMachine.js";
import { ForgeDb } from "../src-ts/db.js";
import { ForgeConfig } from "../src-ts/config.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// Mock all agents
jest.mock("../src-ts/agents/ideation.js");
jest.mock("../src-ts/agents/architecture.js");
jest.mock("../src-ts/agents/taskGraph.js");
jest.mock("../src-ts/agents/coding.js");
jest.mock("../src-ts/agents/review.js");
jest.mock("../src-ts/agents/integration.js");
jest.mock("../src-ts/agents/testAgent.js");
jest.mock("../src-ts/agents/verification.js");
jest.mock("../src-ts/agents/deploy.js");

import { IdeationAgent } from "../src-ts/agents/ideation.js";
import { ArchitectureAgent } from "../src-ts/agents/architecture.js";
import { TaskGraphAgent } from "../src-ts/agents/taskGraph.js";
import { CodingAgent } from "../src-ts/agents/coding.js";
import { ReviewAgent } from "../src-ts/agents/review.js";
import { IntegrationAgent } from "../src-ts/agents/integration.js";
import { TestAgent } from "../src-ts/agents/testAgent.js";
import { VerificationAgent } from "../src-ts/agents/verification.js";

const SPEC = JSON.stringify({ name: "todo", description: "d", tech_stack: [], features: [], out_of_scope: [], assumptions: [] });
const ARCH = JSON.stringify({ stack: { language: "TS" }, structure: [], deploy_platforms: [], test_framework: "jest", verification_method: "cli" });
const TASKS = JSON.stringify([{ title: "Write main.ts", type: "coding", deps: [] }]);
const VERIFY_OK = JSON.stringify({ passed: ["ok"], failed: [], errors: [] });
const VERIFY_FAIL = JSON.stringify({ passed: [], failed: ["broken"], errors: [] });
const REVIEW_OK = JSON.stringify({ approved: true, issues: [], suggestions: [] });

let tmpDir: string;

function makeSession(): Session {
  const db = new ForgeDb(":memory:");
  const sessionId = db.createSession("todo app");
  const ws = path.join(tmpDir, "workspace");
  fs.mkdirSync(ws, { recursive: true });
  return new Session(sessionId, "todo app", Phase.IDEATION, 0, 5, undefined, ws, db, {} as any, new ForgeConfig());
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-overseer-test-"));
  jest.clearAllMocks();
  (IdeationAgent as jest.Mock).mockImplementation(() => ({ run: jest.fn().mockResolvedValue({ success: true, output: SPEC }) }));
  (ArchitectureAgent as jest.Mock).mockImplementation(() => ({ run: jest.fn().mockResolvedValue({ success: true, output: ARCH }) }));
  (TaskGraphAgent as jest.Mock).mockImplementation(() => ({ run: jest.fn().mockResolvedValue({ success: true, output: TASKS }) }));
  (CodingAgent as jest.Mock).mockImplementation(() => ({ run: jest.fn().mockResolvedValue({ success: true, output: "wrote files" }) }));
  (ReviewAgent as jest.Mock).mockImplementation(() => ({ run: jest.fn().mockResolvedValue({ success: true, output: REVIEW_OK }) }));
  (IntegrationAgent as jest.Mock).mockImplementation(() => ({ run: jest.fn().mockResolvedValue({ success: true, output: "[]" }) }));
  (TestAgent as jest.Mock).mockImplementation(() => ({ run: jest.fn().mockResolvedValue({ success: true, output: "1 passed" }) }));
  (VerificationAgent as jest.Mock).mockImplementation(() => ({ run: jest.fn().mockResolvedValue({ success: true, output: VERIFY_OK }) }));
});

afterEach(() => fs.rmSync(tmpDir, { recursive: true }));

test("full pipeline reaches DONE", async () => {
  const session = makeSession();
  const overseer = new Overseer(session);
  await overseer.run();
  expect(session.phase).toBe(Phase.DONE);
});

test("verification failure loops back to CODING then DONE", async () => {
  let calls = 0;
  (VerificationAgent as jest.Mock).mockImplementation(() => ({
    run: jest.fn().mockImplementation(async () => {
      calls++;
      return calls === 1
        ? { success: false, output: VERIFY_FAIL, error: "verification_failed" }
        : { success: true, output: VERIFY_OK };
    }),
  }));
  const session = makeSession();
  const overseer = new Overseer(session);
  await overseer.run();
  expect(session.phase).toBe(Phase.DONE);
  expect(calls).toBe(2);
  expect(session.cycle).toBe(1);
});

test("emits events throughout pipeline", async () => {
  const events: string[] = [];
  const session = makeSession();
  const overseer = new Overseer(session, msg => events.push(msg));
  await overseer.run();
  expect(events.some(e => e.includes("IDEATION"))).toBe(true);
  expect(events.some(e => e.includes("Verification passed"))).toBe(true);
});

test("reaches FAILED when max_cycles exceeded", async () => {
  (VerificationAgent as jest.Mock).mockImplementation(() => ({
    run: jest.fn().mockResolvedValue({ success: false, output: VERIFY_FAIL, error: "verification_failed" }),
  }));
  const session = makeSession();
  session.maxCycles = 1;
  const overseer = new Overseer(session);
  await overseer.run();
  expect(session.phase).toBe(Phase.FAILED);
});
```

- [ ] **6.1.2** Run `npm test -- overseer` — expect FAIL
- [ ] **6.1.3** Implement `src-ts/overseer.ts` (see spec §Module Designs / cli.ts for the pattern; overseer mirrors the Python version)

```typescript
import { Session } from "./session.js";
import { Phase } from "./stateMachine.js";
import { IdeationAgent } from "./agents/ideation.js";
import { ArchitectureAgent } from "./agents/architecture.js";
import { TaskGraphAgent } from "./agents/taskGraph.js";
import { CodingAgent } from "./agents/coding.js";
import { ReviewAgent } from "./agents/review.js";
import { IntegrationAgent } from "./agents/integration.js";
import { TestAgent } from "./agents/testAgent.js";
import { VerificationAgent } from "./agents/verification.js";
import { DeployAgent } from "./agents/deploy.js";
import { AgentResult } from "./agents/base.js";

type AskUser = (question: string) => Promise<string | undefined>;

export class Overseer {
  private emit: (msg: string) => void;

  constructor(private session: Session, eventCallback?: (msg: string) => void) {
    this.emit = (msg) => {
      this.session.db.logEvent(this.session.id, this.session.phase, msg);
      eventCallback?.(msg);
    };
  }

  async run(askUser?: AskUser): Promise<void> {
    while (this.session.phase !== Phase.DONE && this.session.phase !== Phase.FAILED) {
      await this.runPhase(askUser);
    }
  }

  private agent<T>(Cls: new (...args: any[]) => T): T {
    return new Cls(this.session.router, this.session.db, this.session.id);
  }

  private spec(): string { return String(this.session.db.getSession(this.session.id)?.["spec"] ?? "{}"); }
  private arch(): string { return String(this.session.db.getSession(this.session.id)?.["architecture"] ?? "{}"); }

  private async runPhase(askUser?: AskUser): Promise<void> {
    const p = this.session.phase;
    this.emit(`Starting phase: ${p}`);
    switch (p) {
      case Phase.IDEATION: return this.ideation(askUser);
      case Phase.ARCHITECTURE: return this.architecture();
      case Phase.TASK_GRAPH: return this.taskGraph();
      case Phase.CODING: return this.coding();
      case Phase.INTEGRATION: return this.integration();
      case Phase.TESTING: return this.testing();
      case Phase.VERIFICATION: return this.verification();
      case Phase.DEPLOY: return this.deploy();
    }
  }

  private async ideation(askUser?: AskUser): Promise<void> {
    const agent = this.agent(IdeationAgent);
    const conversation: { role: string; content: string }[] = [];
    for (let i = 0; i < 4; i++) {
      const result = await agent.run({ idea: this.session.idea, conversation });
      if (result.error === "question") {
        const answer = askUser ? await askUser(result.output) : "skip";
        conversation.push({ role: "question", content: result.output }, { role: "answer", content: answer ?? "skip" });
      } else {
        this.session.db.updateSession(this.session.id, { spec: result.output });
        this.emit(`Spec: ${JSON.parse(result.output).name ?? "unnamed"}`);
        this.session.advancePhase(Phase.ARCHITECTURE);
        return;
      }
    }
    this.session.advancePhase(Phase.ARCHITECTURE);
  }

  private async architecture(): Promise<void> {
    const result = await this.agent(ArchitectureAgent).run({ spec: this.spec() });
    if (result.success) {
      this.session.db.updateSession(this.session.id, { architecture: result.output });
      this.emit("Architecture decided");
    }
    this.session.advancePhase(Phase.TASK_GRAPH);
  }

  private async taskGraph(): Promise<void> {
    const result = await this.agent(TaskGraphAgent).run({ spec: this.spec(), architecture: this.arch() });
    if (result.success) {
      const tasks = JSON.parse(result.output) as { title: string; type: string; deps?: string[] }[];
      for (const t of tasks) this.session.db.createTask(this.session.id, t.title, t.type, t.deps);
      this.emit(`Task graph: ${tasks.length} tasks`);
    }
    this.session.advancePhase(Phase.CODING);
  }

  private async coding(): Promise<void> {
    const pending = this.session.db.getTasks(this.session.id, "pending");
    if (!pending.length) { this.session.advancePhase(Phase.INTEGRATION); return; }
    await Promise.all(pending.map(t => this.codeTask(t)));
    this.session.advancePhase(Phase.INTEGRATION);
  }

  private async codeTask(task: Record<string, unknown>): Promise<void> {
    const id = String(task["id"]);
    const title = String(task["title"]);
    this.emit(`Coding: ${title}`);
    this.session.db.updateTask(id, { status: "in_progress" });
    const result = await this.agent(CodingAgent).run({
      taskTitle: title, spec: this.spec(), architecture: this.arch(),
      workspace: this.session.workspace, taskId: id,
    });
    this.session.db.updateTask(id, { status: result.success ? "completed" : "failed", output: result.output });
    const review = await this.agent(ReviewAgent).run({ taskTitle: title, diff: result.output });
    if (review.success) {
      const rv = JSON.parse(review.output);
      if (!rv.approved && rv.issues?.length) this.emit(`Review issues for '${title}': ${rv.issues}`);
    }
  }

  private async integration(): Promise<void> {
    const result = await this.agent(IntegrationAgent).run({ workspace: this.session.workspace, spec: this.spec(), architecture: this.arch() });
    this.emit(`Integration: ${result.success ? "complete" : "failed"}`);
    this.session.advancePhase(Phase.TESTING);
  }

  private async testing(): Promise<void> {
    const result = await this.agent(TestAgent).run({ workspace: this.session.workspace, architecture: this.arch() });
    this.emit(`Tests: ${result.success ? "passed" : "failed"}`);
    this.session.advancePhase(Phase.VERIFICATION);
  }

  private async verification(): Promise<void> {
    const result = await this.agent(VerificationAgent).run({ workspace: this.session.workspace, architecture: this.arch(), spec: this.spec() });
    if (result.success) {
      const next = this.session.deployTarget ? Phase.DEPLOY : Phase.DONE;
      this.session.advancePhase(next);
      this.emit("Verification passed");
      return;
    }
    if (this.session.cycle >= this.session.maxCycles) {
      this.emit(`Max cycles (${this.session.maxCycles}) reached. Build incomplete.`);
      this.session.db.updateSession(this.session.id, { phase: Phase.FAILED });
      this.session.phase = Phase.FAILED;
      return;
    }
    this.session.incrementCycle();
    let report: Record<string, unknown[]> = { failed: [], errors: [] };
    try { report = JSON.parse(result.output); } catch {}
    for (const failure of report["failed"] as string[]) {
      this.session.db.createTask(this.session.id, `Fix: ${failure}`, "coding");
    }
    this.emit(`Verification failed. Cycle ${this.session.cycle}/${this.session.maxCycles}`);
    this.session.advancePhase(Phase.CODING);
  }

  private async deploy(): Promise<void> {
    const result = await this.agent(DeployAgent).run({ workspace: this.session.workspace, architecture: this.arch(), target: this.session.deployTarget ?? "none" });
    this.emit(`Deploy: ${result.success ? "success" : "failed"} — ${result.output.slice(0, 100)}`);
    this.session.advancePhase(Phase.DONE);
  }
}
```

- [ ] **6.1.4** Run `npm test -- overseer` — expect 4 passed
- [ ] **6.1.5** Commit: `feat(ts): add Overseer orchestration loop with phase pipeline and cycle guard`

---

## Phase 7 — UI

### Task 7.1 — `src-ts/ui/interrupt.ts`

- [ ] **7.1.1** Implement `src-ts/ui/interrupt.ts` (no automated test — interactive keyboard handler)

```typescript
import { createInterface } from "readline";

type OnInterrupt = (redirect: string) => Promise<void>;
type OnSessionInfo = () => void;

export class InterruptHandler {
  private rl: ReturnType<typeof createInterface> | null = null;
  private running = false;

  constructor(
    private onInterrupt: OnInterrupt,
    private onSessionInfo?: OnSessionInfo,
  ) {}

  start(): void {
    if (!process.stdin.isTTY) return;
    this.running = true;
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", this.handleKey);
  }

  stop(): void {
    this.running = false;
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
      process.stdin.pause();
    }
    process.stdin.off("data", this.handleKey);
  }

  private handleKey = async (key: string): Promise<void> => {
    if (!this.running) return;
    if (key === "i") {
      process.stdin.setRawMode(false);
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      rl.question("\nRedirect (or Enter to skip): ", async (answer) => {
        rl.close();
        if (process.stdin.isTTY) process.stdin.setRawMode(true);
        if (answer.trim()) await this.onInterrupt(answer.trim());
      });
    } else if (key === "s") {
      this.onSessionInfo?.();
    } else if (key === "q" || key === "Q") {
      process.stdin.setRawMode(false);
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      rl.question("\nSave and quit? [y/N]: ", (answer) => {
        rl.close();
        if (answer.toLowerCase() === "y") process.exit(0);
        else if (process.stdin.isTTY) process.stdin.setRawMode(true);
      });
    } else if (key === "") {
      process.exit(0);
    }
  };
}
```

- [ ] **7.1.2** Commit: `feat(ts): add InterruptHandler with i/s/q key bindings`

---

### Task 7.2 — `src-ts/ui/liveFeed.tsx`

- [ ] **7.2.1** Write `tests/ui/liveFeed.test.ts`

```typescript
import { startLiveFeed } from "../../src-ts/ui/liveFeed.js";

// ink renders to a virtual terminal — mock render to avoid tty dependency
jest.mock("ink", () => ({
  render: jest.fn(() => ({ unmount: jest.fn() })),
  Box: "Box",
  Text: "Text",
  useApp: () => ({ exit: jest.fn() }),
}));
jest.mock("react", () => ({ createElement: jest.fn(), useState: jest.fn(() => [0, jest.fn()]), useEffect: jest.fn() }));

test("startLiveFeed returns handle with all methods", () => {
  const handle = startLiveFeed("build a todo app");
  expect(typeof handle.setOverseer).toBe("function");
  expect(typeof handle.updateTask).toBe("function");
  expect(typeof handle.pushEvent).toBe("function");
  expect(typeof handle.setCycle).toBe("function");
  expect(typeof handle.setTotalCost).toBe("function");
  expect(typeof handle.stop).toBe("function");
});

test("handle methods do not throw", () => {
  const handle = startLiveFeed("idea");
  expect(() => handle.setOverseer("Starting...")).not.toThrow();
  expect(() => handle.updateTask("t1", "Task one", "in_progress")).not.toThrow();
  expect(() => handle.pushEvent("CODING", "Coding task")).not.toThrow();
  expect(() => handle.setCycle(1)).not.toThrow();
  expect(() => handle.setTotalCost(0.05)).not.toThrow();
  expect(() => handle.stop()).not.toThrow();
});
```

- [ ] **7.2.2** Run `npm test -- liveFeed` — expect FAIL
- [ ] **7.2.3** Implement `src-ts/ui/liveFeed.tsx` (see spec §Module Designs / ui/liveFeed.tsx)
- [ ] **7.2.4** Run `npm test -- liveFeed` — expect 2 passed
- [ ] **7.2.5** Commit: `feat(ts): add ink-based LiveFeed TUI with LiveFeedHandle interface`

---

## Phase 8 — CLI Commands

### Task 8.1 — `src-ts/commands/sessions.ts`

- [ ] **8.1.1** Implement `src-ts/commands/sessions.ts`

```typescript
import * as fs from "fs";
import * as path from "path";
import chalk from "chalk";
import Table from "cli-table3";
import { SESSIONS_DIR } from "../session.js";
import { ForgeDb } from "../db.js";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

export async function listSessions(): Promise<void> {
  if (!fs.existsSync(SESSIONS_DIR)) { console.log("No sessions yet."); return; }

  const table = new Table({ head: ["ID", "Idea", "Status", "Cycle", "Cost ($)", "Created"] });

  for (const entry of fs.readdirSync(SESSIONS_DIR).sort().reverse()) {
    const dbPath = path.join(SESSIONS_DIR, entry, "session.db");
    if (!fs.existsSync(dbPath)) continue;
    const db = new ForgeDb(dbPath);
    for (const row of db.listSessions()) {
      const phase = String(row["phase"]);
      const status = phase === "DONE" ? chalk.green("✓ done")
        : phase === "FAILED" ? chalk.red("✗ failed")
        : chalk.cyan(`⟳ ${phase.toLowerCase()}`);
      table.push([
        chalk.cyan(String(row["id"])),
        String(row["idea"]).slice(0, 50),
        status,
        String(row["cycle"]),
        `$${Number(row["total_cost"]).toFixed(4)}`,
        timeAgo(String(row["created_at"])),
      ]);
    }
    db.close();
  }
  console.log(table.toString());
}
```

- [ ] **8.1.2** Commit: `feat(ts): add sessions command`

---

### Task 8.2 — `src-ts/commands/logs.ts`

- [ ] **8.2.1** Implement `src-ts/commands/logs.ts`

```typescript
import * as path from "path";
import chalk from "chalk";
import { SESSIONS_DIR, Session } from "../session.js";
import { ForgeDb } from "../db.js";

const PHASE_COLORS: Record<string, chalk.Chalk> = {
  IDEATION: chalk.magenta, ARCHITECTURE: chalk.blue, TASK_GRAPH: chalk.yellow,
  CODING: chalk.cyan, INTEGRATION: chalk.green, TESTING: chalk.yellowBright,
  VERIFICATION: chalk.greenBright, FAILED: chalk.red,
};

export async function showLogs(sessionId?: string): Promise<void> {
  let db: ForgeDb;
  let sid: string;
  if (sessionId) {
    sid = sessionId;
    db = new ForgeDb(path.join(SESSIONS_DIR, sessionId, "session.db"));
  } else {
    const s = Session.loadLast();
    sid = s.id;
    db = s.db;
  }

  const row = db.getSession(sid);
  if (row) {
    const cost = db.getTotalCost(sid);
    console.log(`\n${chalk.bold.cyan(String(row["id"]))}  ${String(row["idea"]).slice(0, 50)}  ${chalk.dim(String(row["phase"]))}  ${chalk.green(`$${cost.toFixed(4)}`)}\n`);
  }

  const events = (db as any).db.prepare("SELECT timestamp, phase, message FROM events ORDER BY timestamp").all() as any[];
  for (const e of events) {
    const color = PHASE_COLORS[e.phase] ?? chalk.white;
    console.log(`${chalk.dim(String(e.timestamp).slice(0, 19))} ${color(e.phase.padEnd(14))} ${e.message}`);
  }
}
```

- [ ] **8.2.2** Commit: `feat(ts): add logs command`

---

### Task 8.3 — `src-ts/commands/prompts.ts`

- [ ] **8.3.1** Implement `src-ts/commands/prompts.ts`

```typescript
import * as fs from "fs";
import chalk from "chalk";
import { logPath } from "../promptLog.js";
import { Session } from "../session.js";

const TIER_COLORS: Record<string, chalk.Chalk> = {
  overseer: chalk.magenta, reasoning: chalk.blue, standard: chalk.cyan, fast: chalk.green,
};

function renderEntry(raw: string, verbose: boolean): void {
  let e: any;
  try { e = JSON.parse(raw); } catch { return; }
  const tier = e.tier ?? "";
  const color = TIER_COLORS[tier] ?? chalk.white;
  const model = String(e.model ?? "?").split("/").pop();
  const ts = String(e.ts ?? "").slice(0, 19).replace("T", " ");
  const header = `${color.bold((tier.toUpperCase() + " ").slice(0, 8))}  ${chalk.bold(e.agent ?? "?")}  ${chalk.dim(model)}  ${chalk.dim(ts)}  ${chalk.cyan(`↑${e.tokens_in ?? 0} ↓${e.tokens_out ?? 0}`)}  ${chalk.green(`$${(e.cost_usd ?? 0).toFixed(4)}`)}`;
  console.log(header);
  if (e.tools_called?.length) console.log(`  ${chalk.yellow("Tools:")} ${e.tools_called.join(" → ")}`);
  const limit = verbose ? undefined : 200;
  if (e.user_prompt) {
    const text = limit ? String(e.user_prompt).slice(0, limit) + (String(e.user_prompt).length > limit ? "…" : "") : e.user_prompt;
    console.log(`  ${chalk.dim("Prompt:")} ${text}`);
  }
  if (e.response) {
    const text = limit ? String(e.response).slice(0, limit) + (String(e.response).length > limit ? "…" : "") : e.response;
    console.log(`  ${chalk.dim("Reply :")} ${text}`);
  }
  console.log(chalk.dim("─".repeat(80)));
}

export async function showPrompts(sessionId?: string, opts?: { follow?: boolean; verbose?: boolean }): Promise<void> {
  const sid = sessionId ?? Session.loadLast().id;
  const lp = logPath(sid);
  console.log(chalk.dim(`Session ${sid}  →  ${lp}\n`));

  if (!fs.existsSync(lp)) {
    if (!opts?.follow) { console.log(chalk.dim("No prompts logged yet.")); return; }
    console.log(chalk.dim("Waiting for first prompt…"));
  }

  let pos = 0;
  const tick = () => {
    if (!fs.existsSync(lp)) return;
    const content = fs.readFileSync(lp, "utf8");
    const lines = content.slice(pos).split("\n");
    pos = content.length;
    for (const line of lines) { if (line.trim()) renderEntry(line, opts?.verbose ?? false); }
  };

  tick();
  if (opts?.follow) {
    setInterval(tick, 500);
    await new Promise(() => {}); // keep alive
  }
}
```

- [ ] **8.3.2** Commit: `feat(ts): add prompts command`

---

## Phase 9 — CLI Entry Point

### Task 9.1 — `src-ts/cli.ts`

- [ ] **9.1.1** Write `tests/cli.test.ts`

```typescript
// Smoke test: import doesn't crash and program is defined
jest.mock("commander", () => {
  const mock = {
    name: jest.fn().mockReturnThis(),
    description: jest.fn().mockReturnThis(),
    command: jest.fn().mockReturnThis(),
    option: jest.fn().mockReturnThis(),
    action: jest.fn().mockReturnThis(),
    parseAsync: jest.fn().mockResolvedValue(undefined),
  };
  return { Command: jest.fn(() => mock) };
});

test("cli module can be imported without error", async () => {
  await expect(import("../src-ts/cli.js")).resolves.toBeDefined();
});
```

- [ ] **9.1.2** Implement `src-ts/cli.ts` (see spec §Module Designs / cli.ts)
- [ ] **9.1.3** Run `npm run build` — expect clean compile with no errors
- [ ] **9.1.4** Run `node dist/cli.js --help` — expect all commands listed
- [ ] **9.1.5** Commit: `feat(ts): add Commander CLI with all six commands wired`

---

### Task 9.2 — Interactive setup wizard

- [ ] **9.2.1** Implement `runSetupWizard()` in `src-ts/config.ts` using `@inquirer/prompts`

```typescript
export async function runSetupWizard(): Promise<ForgeConfig> {
  const { select, checkbox, password } = await import("@inquirer/prompts");

  console.log("\n⚒  FORGE  —  idea to product in one command\n");

  const priority = await select({
    message: "What matters most to you?",
    choices: [
      { name: "Quality  — best output, higher cost", value: "quality" },
      { name: "Speed    — fastest responses", value: "speed" },
      { name: "Cost     — minimize spend", value: "cost" },
    ],
  });

  const providers = await checkbox({
    message: "Which API providers do you have keys for?",
    choices: ["Anthropic (Claude)", "OpenAI", "Google (Gemini)", "Groq", "Mistral"].map(n => ({ name: n, value: n })),
  });

  const PROVIDER_KEY_MAP: Record<string, [string, string]> = {
    "Anthropic (Claude)": ["ANTHROPIC_API_KEY", "Anthropic API key"],
    "OpenAI": ["OPENAI_API_KEY", "OpenAI API key"],
    "Google (Gemini)": ["GOOGLE_API_KEY", "Google API key"],
    "Groq": ["GROQ_API_KEY", "Groq API key"],
    "Mistral": ["MISTRAL_API_KEY", "Mistral API key"],
  };

  const keys: Record<string, string> = {};
  for (const provider of providers) {
    const [envVar, label] = PROVIDER_KEY_MAP[provider];
    const existing = process.env[envVar] ?? "";
    const entered = await password({ message: `${label} [${envVar}]${existing ? " (already set, Enter to keep)" : ""}:` });
    if (entered) keys[envVar] = entered;
    else if (existing) keys[envVar] = existing;
  }

  console.log("\nFetching available models…");
  const { fetchModelsForProvider } = await import("./modelFetch.js");
  const allModels: string[] = [];
  const seen = new Set<string>();
  for (const provider of providers) {
    const [envVar] = PROVIDER_KEY_MAP[provider];
    const apiKey = keys[envVar] ?? process.env[envVar] ?? "";
    for (const m of await fetchModelsForProvider(provider, apiKey)) {
      if (!seen.has(m)) { seen.add(m); allModels.push(m); }
    }
  }

  const chosenModels: Record<string, string> = {};
  if (allModels.length) {
    const tiers: [ModelTier, string][] = [
      [ModelTier.OVERSEER, "Overseer   — architecture & planning (most capable)"],
      [ModelTier.REASONING, "Reasoning  — coding & integration (smart + fast)"],
      [ModelTier.STANDARD, "Standard   — review & task graph (balanced)"],
      [ModelTier.FAST, "Fast       — quick single-turn calls (cheapest)"],
    ];
    for (const [tier, desc] of tiers) {
      chosenModels[tier] = await select({ message: desc, choices: allModels.map(m => ({ name: m, value: m })) });
    }
  }

  const profile = providers.includes("Anthropic (Claude)") ? "claude-primary"
    : providers.includes("OpenAI") ? "openai-primary" : "claude-primary";

  const cfg = new ForgeConfig(profile, chosenModels);
  saveConfig(cfg);
  if (Object.keys(keys).length) saveKeys(keys);
  console.log(`\n✓ Setup complete! Config → ${CONFIG_FILE}\n`);
  return cfg;
}
```

- [ ] **9.2.2** Commit: `feat(ts): add setup wizard with provider selection and model fetching`

---

## Phase 10 — End-to-End Smoke Test

### Task 10.1 — E2E test

- [ ] **10.1.1** Write `tests/e2e.test.ts`

```typescript
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Session } from "../src-ts/session.js";
import { Overseer } from "../src-ts/overseer.js";
import { Phase } from "../src-ts/stateMachine.js";
import { ForgeConfig } from "../src-ts/config.js";
import { ForgeDb } from "../src-ts/db.js";

jest.mock("../src-ts/agents/ideation.js");
jest.mock("../src-ts/agents/architecture.js");
jest.mock("../src-ts/agents/taskGraph.js");
jest.mock("../src-ts/agents/coding.js");
jest.mock("../src-ts/agents/review.js");
jest.mock("../src-ts/agents/integration.js");
jest.mock("../src-ts/agents/testAgent.js");
jest.mock("../src-ts/agents/verification.js");
jest.mock("../src-ts/agents/deploy.js");

import { IdeationAgent } from "../src-ts/agents/ideation.js";
import { ArchitectureAgent } from "../src-ts/agents/architecture.js";
import { TaskGraphAgent } from "../src-ts/agents/taskGraph.js";
import { CodingAgent } from "../src-ts/agents/coding.js";
import { ReviewAgent } from "../src-ts/agents/review.js";
import { IntegrationAgent } from "../src-ts/agents/integration.js";
import { TestAgent } from "../src-ts/agents/testAgent.js";
import { VerificationAgent } from "../src-ts/agents/verification.js";

const SPEC = JSON.stringify({ name: "hello-cli", description: "Prints hello", tech_stack: ["Node.js"], features: ["print hello"], out_of_scope: [], assumptions: [] });
const ARCH = JSON.stringify({ stack: { language: "TypeScript", framework: "CLI", database: "none" }, structure: ["src/main.ts"], deploy_platforms: ["none"], test_framework: "jest", verification_method: "cli" });
const TASKS = JSON.stringify([{ title: "Write main.ts", type: "coding", deps: [] }]);
const VERIFY_OK = JSON.stringify({ passed: ["CLI prints hello"], failed: [], errors: [] });
const REVIEW_OK = JSON.stringify({ approved: true, issues: [], suggestions: [] });

let tmpDir: string;

beforeAll(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-e2e-test-")); });
afterAll(() => fs.rmSync(tmpDir, { recursive: true }));

function makeSession(): Session {
  const db = new ForgeDb(":memory:");
  const id = db.createSession("print hello world");
  const ws = path.join(tmpDir, "workspace-" + Math.random().toString(36).slice(2));
  fs.mkdirSync(ws, { recursive: true });
  return new Session(id, "print hello world", Phase.IDEATION, 0, 5, undefined, ws, db, {} as any, new ForgeConfig());
}

function setupMocks() {
  jest.clearAllMocks();
  (IdeationAgent as jest.Mock).mockImplementation(() => ({ run: jest.fn().mockResolvedValue({ success: true, output: SPEC }) }));
  (ArchitectureAgent as jest.Mock).mockImplementation(() => ({ run: jest.fn().mockResolvedValue({ success: true, output: ARCH }) }));
  (TaskGraphAgent as jest.Mock).mockImplementation(() => ({ run: jest.fn().mockResolvedValue({ success: true, output: TASKS }) }));
  (CodingAgent as jest.Mock).mockImplementation(() => ({ run: jest.fn().mockResolvedValue({ success: true, output: "wrote files" }) }));
  (ReviewAgent as jest.Mock).mockImplementation(() => ({ run: jest.fn().mockResolvedValue({ success: true, output: REVIEW_OK }) }));
  (IntegrationAgent as jest.Mock).mockImplementation(() => ({ run: jest.fn().mockResolvedValue({ success: true, output: "integrated" }) }));
  (TestAgent as jest.Mock).mockImplementation(() => ({ run: jest.fn().mockResolvedValue({ success: true, output: "1 passed" }) }));
  (VerificationAgent as jest.Mock).mockImplementation(() => ({ run: jest.fn().mockResolvedValue({ success: true, output: VERIFY_OK }) }));
}

test("full pipeline reaches DONE", async () => {
  setupMocks();
  const session = makeSession();
  const overseer = new Overseer(session);
  await overseer.run();
  expect(session.phase).toBe(Phase.DONE);
});

test("verification failure loops then reaches DONE", async () => {
  setupMocks();
  let calls = 0;
  (VerificationAgent as jest.Mock).mockImplementation(() => ({
    run: jest.fn().mockImplementation(async () => {
      calls++;
      return calls === 1
        ? { success: false, output: JSON.stringify({ passed: [], failed: ["broken"], errors: [] }), error: "verification_failed" }
        : { success: true, output: VERIFY_OK };
    }),
  }));
  const session = makeSession();
  await new Overseer(session).run();
  expect(session.phase).toBe(Phase.DONE);
  expect(session.cycle).toBe(1);
  expect(calls).toBe(2);
});

test("session is SQLite-compatible with Python sessions", () => {
  // The schema must match exactly — verify all table names exist
  const db = new ForgeDb(":memory:");
  const id = db.createSession("test");
  const row = db.getSession(id);
  expect(row?.["spec"]).toBeNull();
  expect(row?.["architecture"]).toBeNull();
  expect(row?.["deploy_target"]).toBeNull();
  expect(row?.["config_json"]).toBe("{}");
  db.close();
});
```

- [ ] **10.1.2** Run `npm test -- e2e` — expect 3 passed
- [ ] **10.1.3** Run full test suite: `npm test` — expect all tests passing
- [ ] **10.1.4** Run `npm run build` — expect clean compile
- [ ] **10.1.5** Commit: `test(ts): add e2e smoke tests for full pipeline`

---

## Phase 11 — Cutover

- [ ] **11.1** Delete Python source: `rm -rf src/forge/`
- [ ] **11.2** Delete Python tooling: `rm pyproject.toml uv.lock`
- [ ] **11.3** Rename TypeScript source: `mv src-ts src/forge` (or update `tsconfig.json` `rootDir` to match)
- [ ] **11.4** Update `tsconfig.json` `rootDir` to `src/forge` if renamed
- [ ] **11.5** Run `npm run build && node dist/cli.js --help` — confirm CLI works
- [ ] **11.6** Run `npm test` — confirm all tests still pass
- [ ] **11.7** Update Homebrew formula to install via Node.js:
  - Change `url` to new tarball
  - Replace `uv pip install` steps with `npm ci && npm run build`
  - Change `bin` target from Python script to `dist/cli.js` via Node shebang
- [ ] **11.8** Update `README.md`: remove Python/uv install instructions, add `npm install -g forgecli` and Homebrew Node.js instructions
- [ ] **11.9** Tag release: `git tag v0.2.0 && git push origin v0.2.0`
- [ ] **11.10** Commit: `chore: cut over to TypeScript — delete Python source, update Homebrew formula`

---

## Quick Reference: Port Order

```
Phase 0  →  package.json · tsconfig.json · jest.config.ts
Phase 1  →  stateMachine.ts · db.ts
Phase 2  →  router.ts
Phase 3  →  config.ts · modelFetch.ts · promptLog.ts · session.ts
Phase 4  →  tools/definitions.ts · tools/executor.ts
Phase 5  →  agents/base.ts · ideation.ts · architecture.ts · taskGraph.ts
         →  review.ts · deploy.ts · coding.ts · integration.ts
         →  testAgent.ts · verification.ts
Phase 6  →  overseer.ts
Phase 7  →  ui/interrupt.ts · ui/liveFeed.tsx
Phase 8  →  commands/sessions.ts · commands/logs.ts · commands/prompts.ts
Phase 9  →  cli.ts · config.ts (setup wizard)
Phase 10 →  e2e tests
Phase 11 →  cutover
```

Total: ~19 tasks, ~150 checkboxes. Each task is independently testable and committable.
