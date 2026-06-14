<h1 align="center">Forge</h1>
<p align="center"><strong>Idea to product in one command.</strong></p>

<p align="center">
  <a href="https://github.com/Ddundee/forge/releases/latest">
    <img alt="Version" src="https://img.shields.io/github/v/release/Ddundee/forge?label=version&color=blue" />
  </a>
  <a href="LICENSE">
    <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-green" />
  </a>
  <img alt="Node.js" src="https://img.shields.io/badge/node-22.5%2B-brightgreen" />
  <a href="https://brew.sh">
    <img alt="Homebrew" src="https://img.shields.io/badge/install-Homebrew-orange" />
  </a>
</p>

<br />

```bash
forgecli build "a React sticky notes app with drag, color picker, and localStorage"
```

Forge takes a plain-text idea and autonomously builds a working product end-to-end — spec, architecture, code, tests, and verification — iterating until the app actually runs.

---

## How it works

Forge runs a pipeline of specialized LLM agents orchestrated by an Overseer:

```
Your idea
  └─ IdeationAgent     asks 1-3 clarifying questions, produces a spec
  └─ ArchitectureAgent picks stack, file structure, test framework
  └─ TaskGraphAgent    breaks the spec into a dependency-ordered task graph
  └─ CodingAgent ─┐   implements each task (parallel where deps allow)
  └─ ReviewAgent  ┘   reviews each diff inline
  └─ IntegrationAgent  wires everything together, fixes import mismatches
  └─ TestAgent         writes tests, runs them, fixes failures
  └─ VerificationAgent builds the app, runs the suite, applies quick fixes
       └─ passes? → Done
       └─ fails?  → Overseer creates fix tasks, loops back (up to 5 cycles)
```

### Agentic tool loop (API-model profiles)

When forge runs on an API-model profile (Anthropic, OpenAI, Gemini, …), the four execution agents — Coding, Integration, Test, and Verification — run as **true agentic loops**. Each has access to four tools and drives itself until the task is done:

| Tool | What it does |
|---|---|
| `bash_exec` | Run any shell command in the workspace (build, test, lint, install) |
| `read_file` | Read any file relative to the workspace root |
| `write_file` | Write or overwrite a file, creating parent directories automatically |
| `list_dir` | List files and directories at any path in the workspace |

Safety guards built in:
- Dangerous commands (`rm -rf /`, fork bombs, device writes) are hard-blocked
- All file operations are sandboxed to the workspace — no path escapes
- Max 40 LLM turns and 80 tool calls per agent prevents runaway loops
- Every tool call is logged to the session database for full auditability

### Claude Code as the engine

With the `claude-code` profile, forge drives persistent Claude Code sessions
through the Claude Agent SDK instead of its built-in tool loop: one long-lived
session carries the whole pipeline (spec → architecture → tasks → verification)
with prompt-cache continuity, and each parallel coding task gets its own
short-lived worker session. Real token/cost numbers land in `forgecli logs`.

- `forgecli sessions --claude` — list the Claude sessions behind each build
- `forgecli attach [taskId]` — take over a session in the interactive claude CLI
- `forgecli watch` — read-only live tail of the main session transcript

Env knobs: `FORGE_CLAUDE_CODE_PERMISSION_MODE` (default `default`; legacy `auto` maps to `default`),
`FORGE_CLAUDE_CODE_MAX_TURNS` (default `40`), `FORGE_CLAUDE_CODE_TIMEOUT_MS`
(default `300000`), `FORGE_ALLOW_UNSANDBOXED=1` (allow sandbox-disable).

Every run is persisted as a **session** in `~/.forge/sessions/<id>/`. Sessions are resumable after interruption.

---

## Installation

### Homebrew (macOS — recommended)

```bash
brew tap Ddundee/forge
brew install forgecli
```

### From source

Requires **Node.js 22.5+**.

```bash
git clone https://github.com/Ddundee/forge.git
cd forge
npm ci
npm run build
npm link
```

---

## Setup

```bash
forgecli setup
```

The interactive wizard:

1. **Priority** — quality, speed, or cost (sets smart model defaults)
2. **Providers or local agents** — pick API providers or a local CLI agent profile
3. **API keys** — for API providers, entered securely and saved to `~/.forge/keys.env` (mode 600)
4. **Model selection** — for API providers, fetches the live model list and lets you pick a model for each tier

Keys are loaded automatically before every build — no need to export environment variables manually.

**Supported API providers:** Anthropic (Claude), OpenAI, Google (Gemini), Groq, and Mistral.

**Supported local CLI agents:**

| Profile | Requirement | Notes |
|---|---|---|
| `codex` | `codex` CLI installed | Uses an OpenAI Pro subscription; no Forge API key needed |
| `claude-code` | Agent SDK can start a session (`ANTHROPIC_API_KEY` or `claude login`) | Drives persistent Claude Code sessions via the Claude Agent SDK; no Forge API key needed |

Claude Code can be tuned with:

| Env var | Default | Meaning |
|---|---|---|
| `FORGE_CLAUDE_CODE_PERMISSION_MODE` | `default` | SDK permission mode (`default`, `acceptEdits`, `plan`, `delegate`, or `dontAsk`; legacy `auto` maps to `default`) |
| `FORGE_CLAUDE_CODE_MAX_TURNS` | `40` | Max agentic turns per session |
| `FORGE_CLAUDE_CODE_TIMEOUT_MS` | `300000` | Per-turn timeout before the session is interrupted |
| `FORGE_ALLOW_UNSANDBOXED` | unset | Set to `1` to permit `dangerouslyDisableSandbox` Bash calls |

### Manual config

`~/.forge/config.toml`:
```toml
profile = "claude-primary"   # baseline profile (used if no models are set)
max_cycles = 5               # max verification→fix iterations before giving up

[models]
# Set by forgecli setup — override any tier here
overseer  = "claude-opus-4-8"
reasoning = "claude-sonnet-4-6"
standard  = "claude-haiku-4-5-20251001"
fast      = "gemini/gemini-2.0-flash"
```

**Built-in profiles** (used as fallback if `[models]` is empty):

| Profile | Overseer | Reasoning | Standard | Fast |
|---|---|---|---|---|
| `claude-primary` | claude-opus-4-8 | claude-sonnet-4-6 | claude-haiku | claude-haiku |
| `openai-primary` | gpt-4o | o3-mini | gpt-4o-mini | gpt-4o-mini |
| `mixed-cost-optimized` | claude-sonnet-4-6 | claude-sonnet-4-6 | gemini-flash | gemini-flash |
| `codex` | codex | codex | codex | codex |
| `claude-code` | claude-code | claude-code | claude-code | claude-code |

**Model tiers:**

| Tier | Used for | Pick |
|---|---|---|
| `overseer` | Architecture, planning | Most capable model |
| `reasoning` | Coding, integration | Smart + fast |
| `standard` | Review, task graph | Balanced |
| `fast` | Quick single-turn calls | Cheapest |

---

## Usage

### Build something

```bash
forgecli build "a CLI tool that converts markdown to PDF"
forgecli build "a REST API for a bookmarks manager with JWT auth"
forgecli build "a React dashboard that shows GitHub repo stats"
```

```
Options:
  --deploy   TEXT     Deploy after build: vercel | railway | fly.io
  --max-cycles INT    Max fix iterations (default: 5)
```

```bash
forgecli build "a FastAPI backend" --deploy railway
forgecli build "a Next.js app" --deploy vercel --max-cycles 3
```

### Live feed

While Forge runs you get a live terminal dashboard:

```
 forgecli  ●  bookmarks-api  ●  CODING  ●  cycle 1/5

╭─ Overseer ──────────────────────────────────────────────────────────╮
│  Dispatching 4 coding tasks (2 parallel). Next: integration.        │
╰─────────────────────────────────────────────────────────────────────╯

 Tasks                                   Status
 ─────────────────────────────────────────────────
 [✓] Setup project structure             done
 [✓] Database models                     done
 [~] Auth endpoints (JWT)                writing...
 [~] Bookmark CRUD API                   writing...
 [ ] Wire auth into routes               waiting

 [i] interrupt   [r] resume   [s] session info   [q] quit & save
```

Press **`i`** to pause and redirect Forge mid-build.

### Resume a session

```bash
forgecli resume              # most recent session
forgecli resume abc123       # specific session by ID
```

### List sessions

```bash
forgecli sessions
```

```
          Forge Sessions
 ID       Idea                   Phase   Cycle  Cost ($)  Created
 abc123   bookmarks manager...   DONE    1      0.2341    2026-06-01 14:32
 def456   markdown to PDF...     CODING  0      0.0892    2026-06-01 13:15
```

### View logs

```bash
forgecli logs              # most recent session
forgecli logs abc123       # specific session
```

---

## What gets built

Workspaces land in `~/.forge/sessions/<id>/workspace/`. Open that directory in your editor while Forge is running — it's just files.

Forge can build:
- **Web apps** — React + Vite, Next.js, Vue
- **APIs** — FastAPI, Flask, Express, Go
- **CLI tools** — Python, Go, Node
- **Anything** — the ArchitectureAgent picks the right stack for the idea

---

## Skills

Forge can optionally use agent skills from the [skills.sh](https://www.skills.sh) ecosystem to add task-specific guidance to a build. Skills are **disabled by default** during alpha.

Enable skills for one build:

```bash
forgecli build "Create a React website for a local bakery" --skills auto --skills-max 2
```

Disable skills for one build:

```bash
forgecli build "Create a landing page" --skills off
```

Persist a default in `~/.forge/config.toml`:

```toml
[skills]
mode = "auto"
max_skills = 2
prompt_char_budget = 12000
min_install_count = 100
trusted_sources = ["vercel-labs"]
install_targets = ["forge", "agents"]
```

Or set it interactively during `forgecli setup`.

When enabled, Forge may search with `npx skills`, inspect selected skill bundles, install approved skills into the project workspace, and inject bounded guidance into agent prompts for the current session. Forge does not install skills globally by default.

Read [`docs/skills.md`](docs/skills.md) for safety, privacy, troubleshooting, and rollout status.

---

## Development

```bash
git clone https://github.com/Ddundee/forge.git
cd forge
npm ci

npm test           # run the test suite
npm run build      # compile TypeScript to dist/
```

**Project layout:**

```
src/
├── cli.ts              Commander CLI (forgecli build, setup, sessions, resume, logs, prompts)
├── overseer.ts         Main orchestration loop + phase transitions
├── session.ts          Session create / load / resume
├── db.ts               SQLite: sessions, tasks, artifacts, llm_calls, tool_calls
├── stateMachine.ts     Valid phase transitions
├── router.ts           LLM routing via Vercel AI SDK (one-shot + agentic tool calls)
├── config.ts           Config loading, setup wizard
├── modelFetch.ts       Live model list fetching from provider APIs
├── agents/
│   ├── base.ts         BaseAgent + runAgenticLoop()
│   ├── ideation.ts     Idea → spec (one-shot)
│   ├── architecture.ts Spec → stack + structure (one-shot)
│   ├── taskGraph.ts    Spec → task DAG (one-shot)
│   ├── coding.ts       Task → code (agentic loop)
│   ├── review.ts       Code diff → review (one-shot)
│   ├── integration.ts  Workspace → wired project (agentic loop)
│   ├── testAgent.ts    Project → tests + run (agentic loop)
│   ├── verification.ts App → pass/fail report (agentic loop)
│   └── deploy.ts       Project → deployed URL
├── tools/
│   ├── definitions.ts  Tool schemas via Vercel AI SDK + zod
│   └── executor.ts     Tool execution + workspace sandboxing + safety blocks
└── ui/
    ├── liveFeed.tsx    Ink terminal dashboard (React for CLIs)
    └── interrupt.ts    Keyboard interrupt handler
```

---

## Releasing

To ship a new version:

```bash
# 1. Bump version in package.json
# 2. Commit and push to main
git tag v0.2.x
git push origin v0.2.x
```

The [release workflow](.github/workflows/release.yml) then:
- Computes the tarball sha256
- Updates the formula in [Ddundee/homebrew-forge](https://github.com/Ddundee/homebrew-forge)
- Creates a GitHub Release with a changelog from git log

The version badge above updates automatically when the release is published.

---

## Architecture notes

- **SQLite state machine** — every phase transition is persisted. A crash mid-build resumes exactly where it left off.
- **Vercel AI SDK** — one interface for every LLM provider. Switch any model tier in config without changing code. Supports Anthropic, OpenAI, Google, Groq, and Mistral out of the box.
- **Agentic loops** — execution agents run multi-turn conversations with real tool access, not just one-shot JSON generation. They can read their own output, see failures, and fix them.
- **Verification loop** — Forge doesn't stop at "code written". It builds the app, runs the test suite, and iterates on failures up to `max_cycles` times.
- **No vendor lock-in** — the workspace is plain files. If Forge gets stuck, open the workspace and keep going yourself.

---

## License

MIT — see [LICENSE](LICENSE).
