---
title: Phase 2 - Vercel Skills CLI Adapter
aliases:
  - Skills.sh Context Phase 2
  - Phase 2 Skills CLI Adapter
tags:
  - forgecli/skills-sh-context
  - forgecli/planning/phase
  - status/ready
status: ready
phase: 2
research_gate: closed
parent: "[[Skills.sh Context System Master Plan]]"
next_action: "Implement the Phase 2 source corrections from this note: process-tree timeout handling, supportDir cleanup ownership, strict parsers, loose Phase 1 candidate shape, and no-skills degradation."
created: 2026-06-06
updated: 2026-06-07
---

# Phase 2 - Vercel Skills CLI Adapter

> [!warning] Scope Boundary
> Phase 2 builds a deterministic wrapper around `npx skills`. It must not decide which skills are good, perform security audits, inject prompts into agents, or alter Forge pipeline timing.

> [!abstract] Outcome
> At the end of Phase 2, Forge can run `skills` commands safely through a typed adapter, parse search/list/use/install outputs into stable internal shapes, and test all behavior without network access by using spawn mocks and fixture output.

> [!important] Implementation Status
> This note is complete as the Phase 2 implementation contract. The branch adapter exists, but it is not yet complete against this contract; the source audit below lists the exact corrections still required before Phase 2 can be considered implemented.

## Research Questions

- Which `skills` commands are available and which flags matter for Forge?
- Does `skills find` have a machine-readable mode?
- What does `skills use` emit?
- What files does a project-scoped `skills add` create?
- What does `skills list --json` return?
- What failure outputs and exit codes must the adapter handle?
- Which existing Forge subprocess patterns should the adapter follow?

## Researched Facts

### Evidence: Current Branch And Dirty State

Command:

```bash
git status --short --branch
```

Observed:

```text
## feature/skills-sh-context
?? .env
?? docs/plans/2026-06-06-skills-sh-context.md
?? "docs/plans/Skills.sh Context System Phases.base"
?? docs/plans/skills-sh-context-phases/
?? pyproject.toml
?? tests/test_cli.py
```

Interpretation:

- Work is on `feature/skills-sh-context`.
- `.env`, `pyproject.toml`, and `tests/test_cli.py` are unrelated untracked files and must not be touched by Phase 2.

### Evidence: Official CLI Documentation

Sources:

- [skills.sh CLI docs](https://www.skills.sh/docs/cli)
- [skills.sh overview docs](https://www.skills.sh/docs)
- [vercel-labs/skills README](https://github.com/vercel-labs/skills/blob/main/README.md)
- [Vercel changelog introducing skills](https://vercel.com/changelog/introducing-skills-the-open-agent-skills-ecosystem)

Findings:

- The CLI is run through `npx skills`.
- `skills add <package>` installs skills.
- The upstream README documents `skills find [query]` and shows a single-keyword search example.
- The docs identify telemetry and say it can be disabled with `DISABLE_TELEMETRY=1`.
- skills.sh warns users to review skills and use judgment because the ecosystem cannot guarantee every skill's quality or security.

Plan impact:

- Forge must set `DISABLE_TELEMETRY=1` for automatic commands.
- The adapter must not treat installation as a trust decision.
- Audit and trust remain Phase 4 work.

### Evidence: CLI Version

Command:

```bash
env DISABLE_TELEMETRY=1 NO_COLOR=1 npx --yes skills --version
```

Observed:

```text
1.5.10
```

Interpretation:

- Phase 2 research used `skills` CLI `1.5.10`.
- The adapter should record the CLI version when available for diagnostics, but should not require exactly this version.

### Evidence: CLI Help Output

Command:

```bash
env DISABLE_TELEMETRY=1 NO_COLOR=1 npx --yes skills --help
```

Observed key commands and flags:

```text
Usage: skills <command> [options]

Manage Skills:
  add <package>        Add a skill package (alias: a)
  use <package>@<skill>
                       Generate a prompt for using one skill without installing it
  remove [skills]      Remove installed skills
  list, ls             List installed skills
  find [query]         Search for skills interactively

Add Options:
  -g, --global           Install skill globally (user-level) instead of project-level
  -a, --agent <agents>   Specify agents to install to (use '*' for all agents)
  -s, --skill <skills>   Specify skill names to install (use '*' for all skills)
  -l, --list             List available skills in the repository without installing
  -y, --yes              Skip confirmation prompts
  --copy                 Copy files instead of symlinking to agent directories
  --all                  Shorthand for --skill '*' --agent '*' -y
  --full-depth           Search all subdirectories even when a root SKILL.md exists

Use Options:
  -s, --skill <skill>    Specify the skill to use
  -a, --agent <agent>    Start one supported agent interactively
  --full-depth           Search all subdirectories even when a root SKILL.md exists
  --dangerously-accept-openclaw-risks
                         Allow unverified OpenClaw community skills

List Options:
  -g, --global           List global skills (default: project)
  -a, --agent <agents>   Filter by specific agents
  --json                 Output as JSON (machine-readable, no ANSI codes)
```

Interpretation:

- `list --json` is explicitly machine-readable.
- `find` has no JSON option in help.
- `NO_COLOR=1` did not suppress all ANSI in help, so Forge needs ANSI stripping for non-JSON output.
- Project scope is default for `list`; global scope needs `-g`.

### Evidence: `skills find` Success Output

Command:

```bash
env DISABLE_TELEMETRY=1 NO_COLOR=1 npx --yes skills find react frontend
```

Observed after ANSI stripping:

```text
Install with npx skills add <owner/repo@skill>

vtex/skills@vtex-io-react-apps 415 installs
└ https://skills.sh/vtex/skills/vtex-io-react-apps

hieutrtr/ai1-skills@react-frontend-expert 132 installs
└ https://skills.sh/hieutrtr/ai1-skills/react-frontend-expert

iliaal/ai-skills@react-frontend 105 installs
└ https://skills.sh/iliaal/ai-skills/react-frontend
```

Interpretation:

- `find` returns human text, not JSON.
- It prints a source+skill token shaped as `<owner>/<repo>@<skill>`.
- The URL carries the canonical skills.sh slug.
- Install counts are present when known.
- The adapter must treat `find` parsing as best-effort and preserve raw output.

### Evidence: `skills find` No Results

Command:

```bash
env DISABLE_TELEMETRY=1 NO_COLOR=1 npx --yes skills find zzz-no-such-skill-query-xyz
```

Observed after ANSI stripping:

```text
No skills found for "zzz-no-such-skill-query-xyz"
```

Interpretation:

- No-results is exit code `0`.
- The adapter should return an empty candidate list, not an exception.

### Evidence: `skills add --list`

Command:

```bash
env DISABLE_TELEMETRY=1 NO_COLOR=1 npx --yes skills add kepano/obsidian-skills --list
```

Observed after ANSI stripping:

```text
Source: https://github.com/kepano/obsidian-skills.git
Repository cloned
Found 5 skills

Available Skills

  defuddle
    Extract clean markdown content from web pages using Defuddle CLI...

  json-canvas
    Create and edit JSON Canvas files (.canvas)...

  obsidian-bases
    Create and edit Obsidian Bases (.base files)...

  obsidian-cli
    Interact with Obsidian vaults using the Obsidian CLI...

  obsidian-markdown
    Create and edit Obsidian Flavored Markdown...

Use --skill <name> to install specific skills
```

Interpretation:

- `add --list` is also human output.
- It is useful for available-skill discovery within a known repo, but not reliable enough to be the primary search API.
- The adapter should expose a best-effort `listAvailable(source)` and preserve raw output.

### Evidence: `skills use` Prompt Output

Command:

```bash
env DISABLE_TELEMETRY=1 NO_COLOR=1 npx --yes skills use kepano/obsidian-skills --skill obsidian-markdown
```

Observed prefix:

```text
You are being given a Skill to execute for the user's next request.

Use the following SKILL.md as your instructions:

<SKILL.md>
---
name: obsidian-markdown
description: Create and edit Obsidian Flavored Markdown with wikilinks, embeds, callouts, properties, and other Obsidian-specific syntax.
---

# Obsidian Flavored Markdown Skill
...
</SKILL.md>

Supporting files for this skill were downloaded to:
/var/folders/.../T/skills-use-FCPxnE/obsidian-markdown

When the SKILL.md references relative paths, read them from that directory.
```

Interpretation:

- `use` emits a complete prompt to stdout.
- The prompt wraps `SKILL.md` in `<SKILL.md>...</SKILL.md>`.
- Supporting files are materialized in a temp directory and referenced in stdout.
- The adapter should return raw prompt text, extracted `SKILL.md` content when possible, and the optional support directory path.
- The support directory is temporary and should not be treated as durable session state.

Plan impact:

- `SkillsUseResult.supportDir` is a temporary directory owned by the caller after `use()` returns.
- Phase 2 must not delete `supportDir` immediately because Phase 4 needs to inspect `SKILL.md` and supporting files before audit.
- Phase 2 should expose a small cleanup helper or document a required cleanup call so later phases can remove the temp directory after copying or auditing.
- Treat uncleaned `supportDir` paths as a known pre-v1 leak, not as acceptable final behavior.

### Evidence: Project Install Artifacts

Command started:

```bash
env DISABLE_TELEMETRY=1 NO_COLOR=1 npx --yes skills add kepano/obsidian-skills --skill obsidian-markdown --agent codex --copy --yes
```

Observed files after interruption:

```text
/private/tmp/forge-skills-phase2-07JSA6/.agents/skills/obsidian-markdown/SKILL.md
/private/tmp/forge-skills-phase2-07JSA6/skills-lock.json
```

Observed lock file:

```json
{
  "version": 1,
  "skills": {
    "obsidian-markdown": {
      "source": "kepano/obsidian-skills",
      "sourceType": "github",
      "skillPath": "skills/obsidian-markdown/SKILL.md",
      "computedHash": "cacc9058a35ad3fd4985b4c31121bff8202f1337c39808c1326ded6a19a7915f"
    }
  }
}
```

Interpretation:

- Even an interrupted install can leave partial or complete project files.
- The adapter must verify install state after `add` by running `list --json` or checking expected files.
- `skills-lock.json` is useful diagnostic data, but Phase 2 should not treat it as Forge's canonical persistence.

Plan impact:

- Phase 2 install verification is limited to upstream agent-scoped project installs that appear in `skills list --json`.
- Phase 5 owns verification for any Forge-native `.forge/skills` install target or workspace mirroring path.
- `SkillsInstallResult.installed` may be empty after a successful `add` if the selected target is not visible through `skills list --json`; callers must not treat an empty list as the only source of truth outside Phase 2's agent-scoped path.

### Evidence: `skills list --json`

Command:

```bash
env DISABLE_TELEMETRY=1 NO_COLOR=1 npx --yes skills list --json
```

Observed:

```json
[
  {
    "name": "obsidian-markdown",
    "path": "/private/tmp/forge-skills-phase2-07JSA6/.agents/skills/obsidian-markdown",
    "scope": "project",
    "agents": [
      "Antigravity",
      "Codex",
      "Cursor",
      "Gemini CLI",
      "OpenCode",
      "Zed"
    ]
  }
]
```

Interpretation:

- `list --json` returns an array.
- `agents` are display names, not raw agent IDs.
- For install verification, match by `name`, `scope`, and path, not by raw requested agent ID alone.

### Evidence: Failure Outputs

Command:

```bash
env DISABLE_TELEMETRY=1 NO_COLOR=1 npx --yes skills use kepano/obsidian-skills --skill does-not-exist
```

Observed exit code: `1`

```text
No matching skill found for: does-not-exist
Available skills:
  - defuddle
  - json-canvas
  - obsidian-bases
  - obsidian-cli
  - obsidian-markdown
```

Command:

```bash
env DISABLE_TELEMETRY=1 NO_COLOR=1 npx --yes skills list --json --agent no-such-agent
```

Observed exit code: `1`

```text
Invalid agents: no-such-agent
Valid agents: aider-desk, amp, antigravity, ... universal
```

Command:

```bash
env DISABLE_TELEMETRY=1 NO_COLOR=1 npx --yes skills add kepano/obsidian-skills --skill does-not-exist --agent codex --copy --yes
```

Observed exit code: `1`

```text
No matching skills found for: does-not-exist
Available skills:
  - defuddle
  - json-canvas
  - obsidian-bases
  - obsidian-cli
  - obsidian-markdown
```

Interpretation:

- Non-zero commands often print useful details to stdout, not only stderr.
- Adapter errors should include both stdout and stderr after ANSI stripping.
- The adapter should never assume JSON parse failures mean success.

### Evidence: Upstream Source Behavior

Sources:

- [vercel-labs/skills `cli.ts`](https://github.com/vercel-labs/skills/blob/main/src/cli.ts)
- [vercel-labs/skills `find.ts`](https://github.com/vercel-labs/skills/blob/main/src/find.ts)
- [vercel-labs/skills `use.ts`](https://github.com/vercel-labs/skills/blob/main/src/use.ts)
- [vercel-labs/skills `list.ts`](https://github.com/vercel-labs/skills/blob/main/src/list.ts)

Findings:

- `find` calls `https://skills.sh/api/search?q=...&limit=10` internally and prints up to six results for non-interactive queries.
- `use` constructs a prompt with `SKILL.md` content and optional supporting-file directory.
- `list --json` maps installed skills to `{ name, path, scope, agents }`.
- `use --agent` only supports a single agent and supports Codex/Claude Code launch behavior, but Forge should not use interactive agent launch.

Plan impact:

- The adapter should call `skills use` without `--agent`.
- The adapter should not call the skills.sh API directly in Phase 2.
- `find` parsing is a compatibility layer around human output.

### Evidence: 2026-06-07 Upstream Refresh

Sources checked:

- [skills.sh CLI docs](https://www.skills.sh/docs/cli)
- [Vercel changelog introducing skills](https://vercel.com/changelog/introducing-skills-the-open-agent-skills-ecosystem)
- [vercel-labs/skills raw `cli.ts`](https://raw.githubusercontent.com/vercel-labs/skills/main/src/cli.ts)
- [vercel-labs/skills raw `find.ts`](https://raw.githubusercontent.com/vercel-labs/skills/main/src/find.ts)

Findings:

- The public CLI docs still describe running the CLI through `npx skills` and still document `DISABLE_TELEMETRY=1` as the telemetry opt-out.
- The Vercel changelog still frames `skills` as a CLI for installing and managing skill packages for agents.
- Current upstream help includes additional commands such as update, remove, init, and experimental install/sync, but those remain outside Phase 2's wrapper surface unless a later phase needs them.
- Current `find` behavior still treats the query as a joined string, searches through the skills.sh API internally, and prints human-oriented results rather than JSON for non-interactive search.

Plan impact:

- Keep Phase 2 focused on `version`, `find`, `add --list`, `use`, `add`, and `list --json`.
- Keep telemetry-disable environment variables mandatory on all automatic commands.
- Keep `find` parser fixtures human-output based and preserve raw output for future parser updates.

### Evidence: Existing Forge Subprocess Pattern

Files inspected:

- `src/codexDriver.ts`
- `tests/codexDriver.test.ts`
- `src/claudeCodeDriver.ts`
- `tests/claudeCodeDriver.test.ts`

Findings:

- Forge uses `child_process.spawn`, not shell string execution, for external agent drivers.
- Tests mock `child_process.spawn` with `EventEmitter`.
- Drivers capture stdout/stderr, kill child processes on timeout, and surface installation guidance for `ENOENT`.
- Claude Code driver has a `settled` guard to prevent double resolution.

Plan impact:

- `SkillsCli` should follow the Claude Code driver's safer settled/timer pattern.
- Tests should mock `spawn`, not run `npx`.

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/skills/cli.ts` | Create or revise | `npx skills` process adapter, output parsers, errors, availability check |
| `tests/skillsCli.test.ts` | Create or revise | Spawn-mocked unit tests for every command/parser path |
| `tests/fixtures/skills-cli/find-react.txt` | Create or revise | Human search success fixture |
| `tests/fixtures/skills-cli/find-empty.txt` | Create or revise | Human no-results fixture |
| `tests/fixtures/skills-cli/use-obsidian-markdown.txt` | Create or revise | Prompt output fixture |
| `tests/fixtures/skills-cli/list-json.json` | Create or revise | Installed inventory fixture |
| `tests/fixtures/skills-cli/add-list-obsidian.txt` | Create or revise | Available-skills fixture |
| `docs/plans/skills-sh-context-phases/Phase 2 - Vercel Skills CLI Adapter.md` | Maintain | This implementation-ready plan |

## Public Interfaces

### Types

```typescript
import type {
  SkillCandidate,
  SkillInstallTarget,
} from "./types.js";

export interface SkillsCliOptions {
  command?: string;
  baseArgs?: string[];
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

export interface SkillsCliCommandResult {
  command: string;
  args: string[];
  cwd: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface SkillsFindResult {
  query: string;
  candidates: SkillCandidate[];
  rawOutput: string;
}

export interface SkillsUseResult {
  source: string;
  skillName: string;
  prompt: string;
  skillMarkdown?: string;
  supportDir?: string;
  rawOutput: string;
}

export interface SkillsAvailableSkill {
  name: string;
  description: string;
}

export interface SkillsListEntry {
  name: string;
  path: string;
  scope: "project" | "global" | string;
  agents: string[];
}

export interface SkillsInstallRequest {
  source: string;
  skillName: string;
  workspace: string;
  agents: string[];
  copy?: boolean;
}

export interface SkillsInstallResult {
  source: string;
  skillName: string;
  command: SkillsCliCommandResult;
  installed: SkillsListEntry[];
}
```

### Support Directory Cleanup

`skills use` can create a temporary support directory. Phase 2 should expose cleanup as a small helper so Phase 4 can audit/copy first and then remove the upstream temp tree deliberately.

```typescript
export function cleanupSkillUseSupportDir(supportDir: string | undefined): boolean;
```

Cleanup rules:

- Return `false` for missing paths.
- Resolve the path and only delete an ancestor directory whose basename starts with `skills-use-`.
- Require that the deleted directory is inside `os.tmpdir()` after path resolution.
- Return `false` instead of deleting if those safety checks fail.
- Delete the `skills-use-*` temp root, not only the nested skill directory, because upstream puts support files under a per-use temp root.

### Error Type

```typescript
export class SkillsCliError extends Error {
  constructor(
    message: string,
    public readonly result?: SkillsCliCommandResult,
  ) {
    super(message);
    this.name = "SkillsCliError";
  }
}
```

### Class API

```typescript
export class SkillsCli {
  constructor(private readonly options: SkillsCliOptions = {}) {}

  async version(workspace: string): Promise<string | undefined>;

  async find(query: string, workspace: string): Promise<SkillsFindResult>;

  async listAvailable(source: string, workspace: string): Promise<{
    source: string;
    skills: SkillsAvailableSkill[];
    rawOutput: string;
  }>;

  async use(source: string, skillName: string, workspace: string): Promise<SkillsUseResult>;

  async install(request: SkillsInstallRequest): Promise<SkillsInstallResult>;

  async listInstalled(workspace: string, agent?: string): Promise<SkillsListEntry[]>;
}
```

## Command Design

### Process Invocation

Default command configuration:

```typescript
const DEFAULT_COMMAND = "npx";
const DEFAULT_BASE_ARGS = ["--yes", "skills"];
const DEFAULT_TIMEOUT_MS = 120_000;
```

Environment rules:

```typescript
function makeSkillsEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...extra,
    DISABLE_TELEMETRY: "1",
    DO_NOT_TRACK: "1",
    NO_COLOR: "1",
  };
}
```

Timeout termination helper:

```typescript
import type { ChildProcess } from "child_process";

function terminateSkillsProcess(child: ChildProcess): void {
  if (child.pid && process.platform !== "win32") {
    try {
      process.kill(-child.pid, "SIGTERM");
      setTimeout(() => {
        try { process.kill(-child.pid, "SIGKILL"); } catch {}
      }, 1_000).unref();
      return;
    } catch {
      // Fall through to direct child kill.
    }
  }

  child.kill("SIGTERM");
}
```

Spawn pattern:

```typescript
private run(args: string[], cwd: string, timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS): Promise<SkillsCliCommandResult> {
  const command = this.options.command ?? DEFAULT_COMMAND;
  const fullArgs = [...(this.options.baseArgs ?? DEFAULT_BASE_ARGS), ...args];
  const started = Date.now();

  return new Promise((resolve, reject) => {
    const child = spawn(command, fullArgs, {
      cwd,
      env: makeSkillsEnv(this.options.env),
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn();
    };

    timer = setTimeout(() => {
      terminateSkillsProcess(child);
      finish(() => reject(new SkillsCliError(`skills timed out after ${timeoutMs / 1000}s`)));
    }, timeoutMs);

    child.on("error", (err) => {
      finish(() => {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          reject(new SkillsCliError("npx not found; install Node.js/npm or provide a skills command override"));
        } else {
          reject(err);
        }
      });
    });

    child.on("close", (code) => {
      const result: SkillsCliCommandResult = {
        command,
        args: fullArgs,
        cwd,
        exitCode: code ?? 1,
        stdout,
        stderr,
        durationMs: Date.now() - started,
      };
      finish(() => {
        if (result.exitCode !== 0) {
          reject(new SkillsCliError(formatSkillsError(result), result));
        } else {
          resolve(result);
        }
      });
    });
  });
}
```

Process handling notes:

- Killing only the `npx` process may leave the Node process it spawned alive on macOS and Linux.
- Prefer a process-group kill on non-Windows platforms, then escalate to `SIGKILL` if needed.
- Tests should still mock the child process, but Phase 9 fake CLI tests should include a timeout case that proves no command keeps running after timeout.

Error formatting:

```typescript
function formatSkillsError(result: SkillsCliCommandResult): string {
  const detail = stripAnsi(`${result.stderr}\n${result.stdout}`).trim();
  return `skills exited ${result.exitCode}: ${detail.slice(0, 1000)}`;
}
```

### Commands To Run

Version:

```typescript
await run(["--version"], workspace);
```

Find:

```typescript
await run(["find", query], workspace);
```

Find command notes:

- Passing `query` as one argument is intentional. The upstream README documents `skills find [query]` and shows a single-keyword example.
- Multi-word Forge queries such as `"react frontend"` should remain one logical query string so the adapter does not guess upstream tokenization.
- Phase 2 should keep a test that asserts the spawned args are `["--yes", "skills", "find", "react frontend"]`.
- If live CLI behavior later proves multi-word queries must be split, change the adapter and fixtures together in a follow-up revision.

Available skills in a known repo:

```typescript
await run(["add", source, "--list"], workspace);
```

Use one skill without installing:

```typescript
await run(["use", source, "--skill", skillName], workspace);
```

Install project-scoped copy:

```typescript
await run([
  "add",
  source,
  "--skill",
  skillName,
  "--copy",
  "--yes",
  "--agent",
  ...agents,
], workspace);
```

List installed project skills:

```typescript
await run(["list", "--json"], workspace);
```

List installed skills for one agent:

```typescript
await run(["list", "--json", "--agent", agent], workspace);
```

## Parser Design

### ANSI Stripping

No new dependency is needed.

```typescript
export function stripAnsi(text: string): string {
  return text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}
```

### Install Count Parsing

```typescript
export function parseInstallCount(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const trimmed = text.trim().toUpperCase();
  const match = trimmed.match(/^(\d+(?:\.\d+)?)([KM])?/);
  if (!match) return undefined;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return undefined;
  if (match[2] === "M") return Math.round(value * 1_000_000);
  if (match[2] === "K") return Math.round(value * 1_000);
  return Math.round(value);
}
```

### `find` Parser

Input fixture:

```text
Install with npx skills add <owner/repo@skill>

vtex/skills@vtex-io-react-apps 415 installs
└ https://skills.sh/vtex/skills/vtex-io-react-apps
```

Parser sketch:

```typescript
export function parseFindOutput(query: string, output: string): SkillsFindResult {
  const clean = stripAnsi(output);
  if (/No skills found/i.test(clean)) {
    return { query, candidates: [], rawOutput: output };
  }

  const lines = clean.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const candidates: SkillCandidate[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const match = line.match(/^([^/\s]+)\/([^@\s]+)@([^\s]+)(?:\s+(.+? installs?))?$/i);
    if (!match) continue;

    const sourceOwner = match[1]!;
    const sourceRepo = match[2]!;
    const skillName = match[3]!;
    const installText = match[4];
    const nextLine = lines[i + 1] ?? "";
    const url = nextLine.startsWith("└ ") ? nextLine.slice(2).trim() : undefined;
    if (url) i += 1;

    candidates.push({
      packageRef: `${sourceOwner}/${sourceRepo}`,
      skillName,
      title: skillName,
      url,
      installCount: parseInstallCount(installText),
      raw: { query, line, urlLine: nextLine, sourceOwner, sourceRepo },
    });
  }

  return { query, candidates, rawOutput: output };
}
```

Notes:

- `description` is omitted because `find` output does not include it.
- Phase 3 must not assume descriptions exist. If ranking needs descriptions, combine the search candidate with `add --list` or later metadata first.
- Keep raw output so parser regressions are explainable.
- Advance past the URL line once consumed so future URL formats cannot be accidentally reprocessed as candidates.
- Owner/repo details can be preserved in `raw` and derived from `packageRef`; do not require dedicated top-level fields while Phase 1 candidate persistence is intentionally loose.

### `add --list` Parser

Input fixture excerpt:

```text
Available Skills

  obsidian-bases
    Create and edit Obsidian Bases (.base files)...

  obsidian-markdown
    Create and edit Obsidian Flavored Markdown...
```

Parser sketch:

```typescript
export function parseAvailableSkillsOutput(output: string): SkillsAvailableSkill[] {
  const clean = stripAnsi(output);
  const lines = clean.split(/\r?\n/);
  const skills: SkillsAvailableSkill[] = [];

  for (let i = 0; i < lines.length; i++) {
    const name = lines[i]?.trim() ?? "";
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(name)) continue;

    let description = "";
    let consumedThrough = i;
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j]?.trim() ?? "";
      if (!next) continue;
      consumedThrough = j;
      description = next;
      break;
    }

    if (!description || /^(Source|Repository|Found|Available|Use --skill)/i.test(description)) continue;
    skills.push({ name, description });
    i = consumedThrough;
  }

  return skills;
}
```

Notes:

- This is best-effort human-output parsing.
- Tests should include the `kepano/obsidian-skills --list` fixture.
- Tests should include an edge case where a slug-shaped description such as `workflow` does not become a second skill name.

### `use` Parser

```typescript
export function parseUseOutput(source: string, skillName: string, output: string): SkillsUseResult {
  const skillMatch = output.match(/<SKILL\.md>\n([\s\S]*?)\n<\/SKILL\.md>/);
  const supportMatch = output.match(/Supporting files for this skill were downloaded to:\n(.+)\n/);
  return {
    source,
    skillName,
    prompt: output,
    skillMarkdown: skillMatch?.[1],
    supportDir: supportMatch?.[1]?.trim(),
    rawOutput: output,
  };
}
```

Support cleanup helper:

```typescript
export function cleanupSkillUseSupportDir(supportDir: string | undefined): boolean {
  if (!supportDir) return false;

  const tmpRoot = fs.realpathSync(os.tmpdir());
  let current = path.resolve(supportDir);

  while (current.startsWith(tmpRoot + path.sep) || current === tmpRoot) {
    if (path.basename(current).startsWith("skills-use-")) {
      fs.rmSync(current, { recursive: true, force: true });
      return true;
    }

    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return false;
}
```

Cleanup notes:

- Do not call this helper inside `use()`. The caller owns cleanup timing because Phase 4 must inspect or copy support files first.
- Do not delete arbitrary `supportDir` values from stdout. Only delete the verified upstream temp root.

### `list --json` Parser

```typescript
export function parseListJson(output: string): SkillsListEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output) as unknown;
  } catch (err) {
    throw new SkillsCliError(`skills list --json returned invalid JSON: ${(err as Error).message}`);
  }

  if (!Array.isArray(parsed)) {
    throw new SkillsCliError("skills list --json did not return an array");
  }
  return parsed.map((item, index) => {
    const row = item as Record<string, unknown>;
    const name = String(row["name"] ?? "");
    const entryPath = String(row["path"] ?? "");
    if (!name || !entryPath) {
      throw new SkillsCliError(`skills list --json entry ${index} is missing name or path`);
    }
    return {
      name,
      path: entryPath,
      scope: String(row["scope"] ?? ""),
      agents: Array.isArray(row["agents"]) ? row["agents"].map(String) : [],
    };
  });
}
```

Notes:

- Do not silently drop rows with missing `name` or `path`.
- If upstream renames a field, the adapter should fail with a typed parser error so Phase 9 fixtures and docs can be updated deliberately.

## Review Amendments Applied To This Plan

- Documented `SkillsUseResult.supportDir` as caller-owned temporary state that must be cleaned after audit/copy.
- Limited Phase 2 `install()` verification to upstream agent-scoped project installs visible through `skills list --json`.
- Replaced direct timeout `child.kill("SIGTERM")` guidance with process-group termination on non-Windows platforms and escalation to `SIGKILL`.
- Kept multi-word `find` queries as a single logical argument and documented the upstream docs basis.
- Updated the `find` parser sketch to skip consumed URL lines and avoid empty descriptions as fake metadata.
- Updated the `add --list` parser sketch to skip consumed description lines and require an edge-case test for slug-shaped descriptions.
- Updated `parseListJson()` to fail loudly on malformed row shape instead of silently filtering rows.
- Clarified that network failures must degrade to a no-skills path in later pipeline phases rather than block the build.
- Added `cleanupSkillUseSupportDir()` so later phases have a safe, explicit cleanup path for upstream temp support directories.

## Current Source Audit

Checked on 2026-06-07 against the current branch:

| Area | Current Branch State | Required Correction |
|---|---|---|
| `src/skills/cli.ts` process handling | Uses `spawn()` without `detached`, and timeout calls `child.kill("SIGTERM")` only | Add `detached: process.platform !== "win32"` and process-group termination with SIGKILL escalation where possible |
| `src/skills/cli.ts` support dirs | `use()` returns `supportDir`, but there is no cleanup helper or ownership API | Add `cleanupSkillUseSupportDir()` and document that callers clean after audit/copy |
| `src/skills/cli.ts` candidates | `parseFindOutput()` still sets `description: ""`, `sourceOwner`, and `sourceRepo` on `SkillCandidate` | Align with Phase 1's loose candidate model: omit `description`, preserve owner/repo only in `raw`, and derive owner from `packageRef` later |
| `src/skills/cli.ts` find parsing | URL lines are not consumed after being attached to a candidate | Advance past consumed URL lines to avoid future parser ambiguity |
| `src/skills/cli.ts` available parser | `parseAvailableSkillsOutput()` can revisit consumed description rows | Track `consumedThrough` so a slug-shaped description is not reconsidered as a skill |
| `src/skills/cli.ts` list parser | `parseListJson()` can surface raw `SyntaxError` for invalid JSON and silently filters rows missing required fields | Throw `SkillsCliError` when JSON is invalid, not an array, or an entry is missing `name`/`path` |
| `tests/skillsCli.test.ts` | Tests cover the broad adapter but not malformed list JSON, slug-shaped descriptions, process-group termination, or cleanup safety | Add the tests listed below |
| Downstream handling | Phase 3/7 docs require no-skills degradation, but implementation still needs to catch `SkillsCliError` at orchestration points | Preserve typed errors in Phase 2 and ensure downstream phases catch them |

This audit means Phase 2 is complete as a plan, not complete as implemented code.

## Implementation Tasks

### Task 2.1 - Add Fixture Files

Files:

- Create or revise `tests/fixtures/skills-cli/find-react.txt`
- Create or revise `tests/fixtures/skills-cli/find-empty.txt`
- Create or revise `tests/fixtures/skills-cli/add-list-obsidian.txt`
- Create or revise `tests/fixtures/skills-cli/use-obsidian-markdown.txt`
- Create or revise `tests/fixtures/skills-cli/list-json.json`

Use the observed outputs from this Phase 2 research, trimmed to the minimum needed for stable parser coverage.

### Task 2.2 - Add Parser Tests First

File:

- Create `tests/skillsCli.test.ts`

Parser tests:

```typescript
test("parseFindOutput parses source, skill name, installs, and URL", () => {
  const fixture = fs.readFileSync(path.join(fixtures, "find-react.txt"), "utf8");
  const result = parseFindOutput("react frontend", fixture);
  expect(result.candidates[0]).toMatchObject({
    packageRef: "vtex/skills",
    skillName: "vtex-io-react-apps",
    installCount: 415,
    url: "https://skills.sh/vtex/skills/vtex-io-react-apps",
  });
  expect(result.candidates[0].raw).toMatchObject({
    sourceOwner: "vtex",
    sourceRepo: "skills",
  });
  expect(result.candidates[0]).not.toHaveProperty("sourceOwner");
  expect(result.candidates[0]).not.toHaveProperty("sourceRepo");
  expect(result.candidates[0]).not.toHaveProperty("description");
});

test("parseFindOutput returns empty candidates for no results", () => {
  const fixture = fs.readFileSync(path.join(fixtures, "find-empty.txt"), "utf8");
  expect(parseFindOutput("zzz", fixture).candidates).toEqual([]);
});

test("parseUseOutput extracts SKILL.md and support directory", () => {
  const fixture = fs.readFileSync(path.join(fixtures, "use-obsidian-markdown.txt"), "utf8");
  const result = parseUseOutput("kepano/obsidian-skills", "obsidian-markdown", fixture);
  expect(result.skillMarkdown).toContain("name: obsidian-markdown");
  expect(result.supportDir).toContain("skills-use-");
});

test("parseListJson returns installed project skills", () => {
  const fixture = fs.readFileSync(path.join(fixtures, "list-json.json"), "utf8");
  const result = parseListJson(fixture);
  expect(result[0]).toMatchObject({
    name: "obsidian-markdown",
    scope: "project",
  });
  expect(result[0].agents).toContain("Codex");
});

test("parseAvailableSkillsOutput does not treat slug-shaped descriptions as skill names", () => {
  const output = [
    "Available Skills",
    "",
    "  actual-skill",
    "    workflow",
    "  next-skill",
    "    Useful follow-up description",
  ].join("\n");
  expect(parseAvailableSkillsOutput(output)).toEqual([
    { name: "actual-skill", description: "workflow" },
    { name: "next-skill", description: "Useful follow-up description" },
  ]);
});

test("parseListJson rejects entries missing required fields", () => {
  expect(() => parseListJson(JSON.stringify([{ name: "obsidian-markdown" }]))).toThrow("missing name or path");
});

test("parseListJson wraps invalid JSON in SkillsCliError", () => {
  expect(() => parseListJson("not json")).toThrow(SkillsCliError);
  expect(() => parseListJson("not json")).toThrow("invalid JSON");
});

test("cleanupSkillUseSupportDir removes only verified skills-use temp roots", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skills-use-"));
  const supportDir = path.join(root, "obsidian-markdown");
  fs.mkdirSync(supportDir, { recursive: true });
  fs.writeFileSync(path.join(supportDir, "SKILL.md"), "# test\n");

  expect(cleanupSkillUseSupportDir(supportDir)).toBe(true);
  expect(fs.existsSync(root)).toBe(false);
});

test("cleanupSkillUseSupportDir refuses arbitrary paths", () => {
  const dir = fs.mkdtempSync(path.join(tmpDir, "not-skills-use-"));
  expect(cleanupSkillUseSupportDir(dir)).toBe(false);
  expect(fs.existsSync(dir)).toBe(true);
});
```

### Task 2.3 - Implement Or Revise `src/skills/cli.ts`

Implementation steps:

- [x] Import `spawn` from `child_process`.
- [x] Import Phase 1 types from `src/skills/types.ts`.
- [ ] Import `fs`, `os`, and `path` for safe support-directory cleanup.
- [x] Add `SkillsCliError`.
- [x] Add `stripAnsi`, `parseInstallCount`, `parseFindOutput`, `parseAvailableSkillsOutput`, `parseUseOutput`, and `parseListJson`.
- [x] Add `SkillsCli` class with `run()`, `version()`, `find()`, `listAvailable()`, `use()`, `install()`, and `listInstalled()`.
- [x] Keep process execution shell-free.
- [x] Set telemetry/privacy env values on every command.
- [x] Include stdout and stderr in non-zero error messages after ANSI stripping.
- [ ] Add `cleanupSkillUseSupportDir()` with temp-root safety checks.
- [ ] Add process-group timeout termination on non-Windows platforms.
- [ ] Align `SkillCandidate` construction with the revised Phase 1 loose candidate shape.
- [ ] Make `parseFindOutput()` skip consumed URL lines.
- [ ] Make `parseAvailableSkillsOutput()` skip consumed description lines.
- [ ] Make `parseListJson()` throw `SkillsCliError` on invalid JSON, non-array JSON, and malformed row shape instead of silently dropping rows.

### Task 2.4 - Add Spawn-Mocked Command Tests

Mock style should match existing driver tests:

```typescript
jest.mock("child_process", () => ({ spawn: jest.fn() }));

import { spawn } from "child_process";

const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;

function makeChild(stdout: string, stderr: string, exitCode: number) {
  const child = new EventEmitter() as any;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = jest.fn();
  setImmediate(() => {
    if (stdout) child.stdout.emit("data", Buffer.from(stdout));
    if (stderr) child.stderr.emit("data", Buffer.from(stderr));
    child.emit("close", exitCode);
  });
  return child;
}
```

Command tests:

```typescript
test("find runs npx skills find with telemetry disabled", async () => {
  mockSpawn.mockReturnValueOnce(makeChild(findFixture, "", 0));
  const cli = new SkillsCli();
  await cli.find("react frontend", tmpDir);
  expect(mockSpawn).toHaveBeenCalledWith(
    "npx",
    ["--yes", "skills", "find", "react frontend"],
    expect.objectContaining({
      cwd: tmpDir,
      detached: process.platform !== "win32",
      env: expect.objectContaining({
        DISABLE_TELEMETRY: "1",
        DO_NOT_TRACK: "1",
      }),
    }),
  );
});

test("install runs project scoped add with copy yes and requested agents", async () => {
  mockSpawn
    .mockReturnValueOnce(makeChild("installed", "", 0))
    .mockReturnValueOnce(makeChild(listJsonFixture, "", 0));
  const cli = new SkillsCli();
  await cli.install({
    source: "kepano/obsidian-skills",
    skillName: "obsidian-markdown",
    workspace: tmpDir,
    agents: ["codex"],
    copy: true,
  });
  expect(mockSpawn).toHaveBeenNthCalledWith(
    1,
    "npx",
    ["--yes", "skills", "add", "kepano/obsidian-skills", "--skill", "obsidian-markdown", "--copy", "--yes", "--agent", "codex"],
    expect.objectContaining({ cwd: tmpDir }),
  );
});

test("non-zero skills command rejects with stdout and stderr detail", async () => {
  mockSpawn.mockReturnValueOnce(makeChild("No matching skill found", "", 1));
  const cli = new SkillsCli();
  await expect(cli.use("kepano/obsidian-skills", "missing", tmpDir)).rejects.toThrow("No matching skill found");
});

test("timeout kills child and rejects", async () => {
  const child = new EventEmitter() as any;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = 12345;
  child.kill = jest.fn();
  mockSpawn.mockReturnValueOnce(child);
  const cli = new SkillsCli({ timeoutMs: 50 });
  await expect(cli.version(tmpDir)).rejects.toThrow("timed out");
  if (process.platform === "win32") {
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  } else {
    expect(process.kill).toHaveBeenCalledWith(-12345, "SIGTERM");
  }
}, 1000);
```

Timeout tests should mock `process.kill` and assert SIGTERM on the process group for non-Windows platforms. A focused helper test should also cover SIGKILL escalation and direct-child fallback when group termination fails.

### Task 2.5 - Run Targeted Tests And Build

Commands:

```bash
node --experimental-sqlite node_modules/.bin/jest tests/skillsCli.test.ts --no-coverage
npm run build
```

Expected:

- All adapter tests pass without network.
- TypeScript build passes.

## Failure Modes And Handling

| Failure | Handling |
|---|---|
| `npx` missing | Reject with `SkillsCliError` explaining Node/npm or command override |
| Command timeout | Terminate the process group where possible, escalate to `SIGKILL`, and reject with timeout error |
| Non-zero exit | Reject with stdout+stderr detail after ANSI stripping |
| `find` no results | Return empty candidates and raw output |
| `find` output format changes | Return whatever can be parsed; preserve raw output |
| `list --json` invalid JSON or malformed row | Throw `SkillsCliError` |
| Install partially writes agent-scoped files | Verify with `listInstalled()` after install |
| Install succeeds outside `list --json` visibility | Return the command result and document that Phase 5 owns non-agent verification |
| `NO_COLOR=1` ignored | Strip ANSI in adapter |
| `skills use` creates a temp support directory | Return `supportDir` and require caller cleanup after audit/copy |
| Network unavailable | Surface a typed command error; Phase 3 and Phase 7 must catch it and continue through a no-skills path |

## Non-Goals

- Do not add direct calls to `https://skills.sh/api/search`.
- Do not select or rank candidates.
- Do not audit skill content.
- Do not inject returned prompt text into agents.
- Do not install skills into real user/global scope.
- Do not add setup wizard controls.
- Do not mutate generated Forge workspaces outside explicit `install()` calls.

## Acceptance Criteria

- [x] `src/skills/cli.ts` exists.
- [x] Adapter commands use `spawn`, not shell strings.
- [x] Every automatic command sets `DISABLE_TELEMETRY=1`.
- [x] `find()` parses observed search output into `SkillCandidate[]`.
- [x] `find()` returns `[]` for no-results output.
- [x] `use()` returns prompt text and extracts `SKILL.md` when present.
- [x] `listInstalled()` parses `skills list --json`.
- [x] `install()` runs project-scoped `skills add` and verifies agent-scoped installs with `listInstalled()`.
- [x] Non-zero commands reject with useful stdout/stderr detail.
- [ ] Timeout behavior terminates the spawned process tree where possible.
- [ ] `use()` support directories have documented cleanup ownership and a safe cleanup helper.
- [ ] `cleanupSkillUseSupportDir()` removes only verified `skills-use-*` temp roots.
- [ ] `find()` candidate construction matches Phase 1's revised loose candidate model.
- [ ] `parseFindOutput()` skips consumed URL lines.
- [ ] `parseAvailableSkillsOutput()` does not reinterpret consumed description rows as skills.
- [ ] `parseListJson()` rejects invalid JSON and malformed entries with `SkillsCliError` instead of raw `SyntaxError` or silent row dropping.
- [ ] Phase 3 and Phase 7 explicitly handle `SkillsCliError` as no-skills degradation.
- [x] Unit tests do not call real `npx`.
- [ ] Targeted adapter tests pass after the revised contract lands.
- [ ] `npm run build` passes after the revised contract lands.

## Rollback Notes

If Phase 2 implementation fails:

- Revert only:
  - `src/skills/cli.ts`
  - `tests/skillsCli.test.ts`
  - `tests/fixtures/skills-cli/`
- Keep Phase 1 state model intact.
- Do not remove planning docs unless explicitly requested.
- Do not touch unrelated untracked files.

## Research Gate

- [x] Capture successful command output
- [x] Capture failed command output
- [x] Confirm whether machine-readable output is stable enough
- [x] Confirm `find` has no JSON output in CLI help
- [x] Confirm upstream docs model `find` as one optional query argument
- [x] Confirm `list --json` shape
- [x] Confirm `use` prompt shape
- [x] Confirm project install writes `.agents/skills` and `skills-lock.json`

## Plan Completion Review

- [x] Frontmatter status reflects that the Phase 2 plan is implementation-ready.
- [x] Scope boundary excludes ranking, auditing, prompt injection, and pipeline timing.
- [x] Upstream research covers docs, current source behavior, successful command output, failure output, and project install artifacts.
- [x] Public adapter interfaces cover command results, find/use/list/install results, typed errors, and support-directory cleanup.
- [x] Process design covers shell-free spawn, telemetry-disable environment, timeout handling, and stdout/stderr error detail.
- [x] Parser design covers human `find`, human `add --list`, `use` prompt extraction, strict `list --json`, ANSI stripping, and install count parsing.
- [x] Test plan covers parser fixtures, spawn-mocked command execution, timeout behavior, malformed JSON, loose candidates, and cleanup safety.
- [x] Current source audit identifies every known branch mismatch that must be corrected during implementation.
- [x] Acceptance criteria distinguish current safe behavior from revised-contract source changes that still need to land.
