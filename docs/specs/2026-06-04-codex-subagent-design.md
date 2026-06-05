# Codex CLI Subagent Feature — Design Spec

**Date:** 2026-06-04
**Status:** Approved

---

## Problem

Forge currently only supports LLM API billing (Anthropic, OpenAI, Google, etc.) for all agent calls. Users with an OpenAI Pro subscription have access to the Codex CLI tool at no additional per-token cost, but there is no way to route forge tasks through it. This feature adds `"codex"` as a first-class profile so users can leverage their Pro subscription instead of API billing.

---

## Goal

When the user selects the `"codex"` profile, every forge agent phase (ideation, architecture, task graph, coding, integration, testing, verification, deploy) routes through the OpenAI Codex CLI (`codex --approval-mode full-auto`) as the execution engine instead of making direct LLM API calls.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                          Overseer                               │
│  (all phases: ideation → arch → task_graph → coding → ...)      │
└───────────────────────────┬─────────────────────────────────────┘
                            │ agent.run(args)
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                         BaseAgent                               │
│  call() / runAgenticLoop()                                      │
│                                                                 │
│  if isCodexMode()  ──────────────►  runViaCodex(messages, dir)  │
│  else              ──────────────►  router.complete(...)        │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────┐
│              CodexDriver                 │
│  runTask(prompt, workdir, timeoutMs)     │
│  spawn("codex", ["--approval-mode",      │
│    "full-auto", prompt], { cwd: workdir })│
│  capture stdout → return string          │
└──────────────────────────────────────────┘
```

**Files touched:** `src/codexDriver.ts` (new), `src/agents/base.ts`, `src/overseer.ts`, `src/config.ts`, `src/router.ts`

---

## Coding Fan-out Workspace Isolation

When the codex profile is active, the coding phase creates per-task isolated subdirectories to prevent parallel codex processes from clobbering each other's file writes:

```
session/workspace/
  tasks/
    <taskId-1>/   ← codex subprocess runs here
    <taskId-2>/   ← codex subprocess runs here
  ← files merged back here after all tasks finish (last-write-wins)
```

When the standard profile is active, this isolation is skipped and the existing shared-workspace behavior is unchanged.

---

## Component Designs

### `src/codexDriver.ts` (new)

Single class `CodexDriver` with one public method:

```typescript
async runTask(prompt: string, workdir: string, timeoutMs = 300_000): Promise<string>
```

- Creates `workdir` if it doesn't exist.
- Prompts over 8 KB are written to `.forge-task.md` in `workdir`; codex is asked to read and follow it (avoids shell argument length limits).
- Spawns `codex --approval-mode full-auto <taskArg>` with `cwd: workdir`, captures stdout.
- On `ENOENT`: rejects with a friendly install hint (`npm install -g @openai/codex`).
- On timeout: sends `SIGTERM` and rejects.
- On non-zero exit: rejects with stderr snippet.

Also exports `checkCodexInstalled(): Promise<boolean>` which runs `codex --version` to verify presence.

### `src/agents/base.ts` changes

Two new private methods added; two existing methods get a single guard at their top:

**`isCodexMode(): boolean`**
```typescript
return this.router.modelFor(this.tier) === "codex";
```

**`runViaCodex(messages, workdir, taskId?): Promise<string>`**
- Extracts the system message and joins all user messages.
- Combines them into a single prompt string (`system\n\n---\n\nuser`).
- Calls `this.codexDriver.runTask(prompt, workdir)`.
- Logs the call to DB with `model: "codex"` and `costUsd: 0`.

**`call()` update:**
```typescript
if (this.isCodexMode()) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-codex-"));
  try { return await this.runViaCodex(messages, tmpDir, taskId); }
  finally { fs.rmSync(tmpDir, { recursive: true, force: true }); }
}
// existing body unchanged
```

Planning agents (ideation, architecture, task graph) use `call()` and don't write files — the temp dir is discarded after each call.

**`runAgenticLoop()` update:**
```typescript
if (this.isCodexMode()) {
  return this.runViaCodex(messages, workspace, taskId);
}
// existing body unchanged
```

Implementation agents (coding, integration, testing, verification) use `runAgenticLoop()` and pass their real workspace — codex writes files there directly using its own agentic loop.

### `src/overseer.ts` changes

Only `coding()` and `codeTask()` are modified:

- `coding()` detects `useIsolation` by checking `router.modelFor(ModelTier.REASONING) === "codex"`.
- When `useIsolation` is true, creates `workspace/tasks/<taskId>/` for each task before fanning out.
- After all tasks finish, calls `mergeTaskDirs()` to copy all files into the main workspace, then removes the `tasks/` dir.
- Two new private helpers: `mergeTaskDirs(tasksDir, dst)` and `copyDir(src, dst)` (recursive, skips dotfiles, last-write-wins).
- `codeTask()` accepts an optional `workspaceOverride` parameter; passes it to `CodingAgent.run()`.

### `src/config.ts` changes

**New profile in `PROVIDER_PROFILES`:**
```typescript
"codex": {
  [ModelTier.OVERSEER]:  "codex",
  [ModelTier.REASONING]: "codex",
  [ModelTier.STANDARD]:  "codex",
  [ModelTier.FAST]:      "codex",
}
```

**Setup wizard update:**
- Adds `"Codex CLI  (OpenAI Pro subscription — no API key needed)"` to the provider checkbox.
- When selected: runs `checkCodexInstalled()`; exits with a helpful message if not found.
- Short-circuits the rest of the wizard (no tier selection needed) and saves `profile: "codex"` to `~/.forge/config.toml`.

### `src/router.ts` change

`resolveModel()` gets a defensive guard at the top:
```typescript
if (modelId === "codex") {
  throw new Error('Model id "codex" reached LLMRouter — use CodexDriver via BaseAgent');
}
```

This fires only if a call bypasses the `isCodexMode()` guard in `BaseAgent` — it is never expected to trigger in normal operation.

---

## Error Handling

| Scenario | Behavior |
|---|---|
| `codex` CLI not installed | `ENOENT` caught in `CodexDriver`; rejects with `npm install -g @openai/codex` message |
| `codex` not installed at setup | `checkCodexInstalled()` returns false; wizard exits with install hint |
| Codex process times out | `SIGTERM` sent, promise rejects with timeout message |
| Codex exits non-zero | Promise rejects with exit code + stderr snippet |
| Planning agent returns malformed JSON | `extractJson()` in `BaseAgent` handles this the same way it does today |
| File conflict during merge | Last-write-wins (same behavior as if tasks shared workspace) |

---

## What Does Not Change

- All existing profiles (`claude-primary`, `openai-primary`, `mixed-cost-optimized`, `auto`) are completely unaffected.
- `LLMRouter`, `AutoSelector`, `ModelTier`, and all agent business logic are untouched except for the two guards in `BaseAgent`.
- DB schema, session lifecycle, state machine, and all CLI commands are unchanged.
- Tests for existing agents continue to pass without modification.

---

## Out of Scope

- Streaming codex output to forge's live feed (codex stdout is captured whole)
- Per-agent codex model configuration (all tiers are `"codex"` when the profile is active)
- Fallback to API when codex fails mid-session (fail fast is the current contract for all agents)
