<h1 align="center">Forge</h1>
<p align="center"><strong>Idea to product in one command.</strong></p>

<p align="center">
  <a href="https://github.com/Ddundee/forge/releases/latest">
    <img alt="Version" src="https://img.shields.io/github/v/release/Ddundee/forge?label=version&color=blue" />
  </a>
  <a href="https://github.com/Ddundee/forge/actions/workflows/test.yml">
    <img alt="Tests" src="https://img.shields.io/github/actions/workflow/status/Ddundee/forge/test.yml?label=tests" />
  </a>
  <a href="LICENSE">
    <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-green" />
  </a>
  <img alt="Python" src="https://img.shields.io/badge/python-3.11%2B-blue" />
  <a href="https://brew.sh">
    <img alt="Homebrew" src="https://img.shields.io/badge/install-Homebrew-orange" />
  </a>
</p>

<br />

```bash
forge build "a React sticky notes app with drag, color picker, and localStorage"
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

### Agentic tool loop

The four execution agents — Coding, Integration, Test, and Verification — run as **true agentic loops**. Each has access to four tools and drives itself until the task is done:

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

Every run is persisted as a **session** in `~/.forge/sessions/<id>/`. Sessions are resumable after interruption.

---

## Installation

### Homebrew (macOS — recommended)

```bash
brew tap Ddundee/forge https://github.com/Ddundee/forge
brew install forge
```

### From source

Requires **Python 3.11+** and [uv](https://github.com/astral-sh/uv).

```bash
git clone https://github.com/Ddundee/forge.git
cd forge
uv venv .venv && source .venv/bin/activate
uv pip install -e .
```

---

## Setup

```bash
forge setup
```

The interactive wizard:

1. **Priority** — quality, speed, or cost (sets smart model defaults)
2. **Providers** — pick which APIs you have keys for (Anthropic, OpenAI, Google, Groq, Mistral)
3. **API keys** — entered securely per provider, saved to `~/.forge/keys.env` (mode 600)
4. **Model selection** — fetches the live model list from each provider's API, then lets you pick a model for each of the four tiers with arrow keys

Keys are loaded automatically before every build — no need to export environment variables manually.

**Supported providers:** Anthropic (Claude), OpenAI, Google (Gemini), Groq, Mistral, and 100+ others via [litellm](https://github.com/BerriAI/litellm).

### Manual config

`~/.forge/config.toml`:
```toml
profile = "claude-primary"   # baseline profile (used if no models are set)
max_cycles = 5               # max verification→fix iterations before giving up

[models]
# Set by forge setup — override any tier here
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
forge build "a CLI tool that converts markdown to PDF"
forge build "a REST API for a bookmarks manager with JWT auth"
forge build "a React dashboard that shows GitHub repo stats"
```

```
Options:
  --deploy   TEXT     Deploy after build: vercel | railway | fly.io
  --max-cycles INT    Max fix iterations (default: 5)
```

```bash
forge build "a FastAPI backend" --deploy railway
forge build "a Next.js app" --deploy vercel --max-cycles 3
```

### Live feed

While Forge runs you get a live terminal dashboard:

```
 forge  ●  bookmarks-api  ●  CODING  ●  cycle 1/5

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
forge resume              # most recent session
forge resume abc123       # specific session by ID
```

### List sessions

```bash
forge sessions
```

```
          Forge Sessions
 ID       Idea                   Phase   Cycle  Cost ($)  Created
 abc123   bookmarks manager...   DONE    1      0.2341    2026-06-01 14:32
 def456   markdown to PDF...     CODING  0      0.0892    2026-06-01 13:15
```

### View logs

```bash
forge logs              # most recent session
forge logs abc123       # specific session
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

## Development

```bash
git clone https://github.com/Ddundee/forge.git
cd forge
uv pip install -e ".[dev]"

pytest -v          # run all 109 tests
pytest tests/test_overseer.py -v  # specific file
```

**Project layout:**

```
src/forge/
├── cli.py              Typer CLI (build, setup, sessions, resume, logs)
├── overseer.py         Main orchestration loop + phase transitions
├── session.py          Session create / load / resume
├── db.py               SQLite: sessions, tasks, artifacts, llm_calls, tool_calls
├── state_machine.py    Valid phase transitions
├── router.py           LLM routing via litellm (one-shot + agentic tool calls)
├── config.py           Config loading, setup wizard
├── model_fetch.py      Live model list fetching from provider APIs
├── agents/
│   ├── base.py         BaseAgent + _run_agentic_loop()
│   ├── ideation.py     Idea → spec (one-shot)
│   ├── architecture.py Spec → stack + structure (one-shot)
│   ├── task_graph.py   Spec → task DAG (one-shot)
│   ├── coding.py       Task → code (agentic loop)
│   ├── review.py       Code diff → review (one-shot)
│   ├── integration.py  Workspace → wired project (agentic loop)
│   ├── test_agent.py   Project → tests + run (agentic loop)
│   ├── verification.py App → pass/fail report (agentic loop)
│   └── deploy.py       Project → deployed URL
├── tools/
│   ├── definitions.py  Tool JSON schemas (bash_exec, read_file, write_file, list_dir)
│   └── executor.py     Tool execution + workspace sandboxing + safety blocks
└── ui/
    ├── live_feed.py    Rich terminal dashboard
    └── interrupt.py    Keyboard interrupt handler
```

---

## Releasing

Releases are fully automated. To ship a new version:

```bash
# 1. Bump version in pyproject.toml
# 2. Commit and push to main
git tag v0.1.3
git push origin v0.1.3
```

The [release workflow](.github/workflows/release.yml) then:
- Computes the tarball sha256
- Updates `Formula/forge.rb` and commits it back to main
- Creates a GitHub Release with a changelog from git log

The version badge above updates automatically when the release is published.

---

## Architecture notes

- **SQLite state machine** — every phase transition is persisted. A crash mid-build resumes exactly where it left off.
- **litellm** — one interface for every LLM provider. Switch any model tier in config without changing code.
- **Agentic loops** — execution agents run multi-turn conversations with real tool access, not just one-shot JSON generation. They can read their own output, see failures, and fix them.
- **Verification loop** — Forge doesn't stop at "code written". It builds the app, runs the test suite, and iterates on failures up to `max_cycles` times.
- **No vendor lock-in** — the workspace is plain files. If Forge gets stuck, open the workspace and keep going yourself.

---

## License

MIT — see [LICENSE](LICENSE).
