# Forge

**Idea to product in one command.**

```
forge "build a REST API for a todo app with auth"
```

Forge takes a plain-text idea and autonomously builds a working product end-to-end — spec, architecture, code, tests, verification — iterating until the app actually runs. No more prompting an LLM a dozen times to connect things up.

---

## How it works

Forge runs a pipeline of specialized LLM agents orchestrated by an Overseer:

```
Your idea
  └─ IdeationAgent     asks 1-3 clarifying questions, locks a spec
  └─ ArchitectureAgent picks stack, file structure, test framework
  └─ TaskGraphAgent    breaks the project into a dependency-ordered task graph
  └─ CodingAgent       writes each task's code (runs in parallel where deps allow)
  └─ ReviewAgent       reviews each diff
  └─ IntegrationAgent  wires everything together, fixes import mismatches
  └─ TestAgent         writes and runs the test suite
  └─ VerificationAgent starts the app and probes it (HTTP, CLI, or Playwright)
       └─ passes? → Done
       └─ fails?  → Overseer creates fix tasks and loops back (up to 5 cycles)
```

Every run creates a **session** — persisted to `~/.forge/sessions/<id>/`. Sessions are resumable if interrupted.

---

## Installation

### Homebrew (recommended)

```bash
brew tap Ddundee/forge
brew install forge
```

For web-app verification (Playwright):
```bash
playwright install chromium
```

### From source

**Requirements:** Python 3.11+, [uv](https://github.com/astral-sh/uv)

```bash
git clone https://github.com/Ddundee/forge.git
cd forge
uv venv .venv
source .venv/bin/activate     # Windows: .venv\Scripts\activate
uv pip install -e .
```

---

## Setup

Run the setup wizard to configure your LLM provider(s):

```bash
forge setup
```

This asks what you care about (speed / cost / quality) and which API keys you have, then writes a provider profile to `~/.forge/config.toml`.

**Supported providers:** Claude (Anthropic), GPT-4 (OpenAI), Gemini (Google), Grok, Mistral, and 100+ others via [litellm](https://github.com/BerriAI/litellm).

### Manual config

`~/.forge/config.toml`:
```toml
profile = "claude-primary"   # claude-primary | openai-primary | mixed-cost-optimized
max_cycles = 5               # max verification→fix iterations before giving up

[models]
# Override specific tiers (optional)
# overseer = "claude-opus-4-8"
# reasoning = "claude-sonnet-4-6"
# standard = "claude-haiku-4-5-20251001"
# fast = "gemini/gemini-2.0-flash"
```

**Provider profiles:**

| Profile | Overseer | Reasoning | Standard | Fast |
|---------|----------|-----------|----------|------|
| `claude-primary` | claude-opus-4-8 | claude-sonnet-4-6 | claude-haiku | claude-haiku |
| `openai-primary` | gpt-4o | o3-mini | gpt-4o-mini | gpt-4o-mini |
| `mixed-cost-optimized` | claude-sonnet-4-6 | claude-sonnet-4-6 | gemini-flash | gemini-flash |

Set your API keys as environment variables before running:
```bash
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
export GOOGLE_API_KEY=...
```

---

## Usage

### Start a build

```bash
forge "build a CLI tool that converts markdown to PDF"
forge "build a REST API for a bookmarks manager with JWT auth"
forge "build a React dashboard that shows GitHub repo stats"
```

**Options:**
```
--deploy   vercel | railway | fly.io   Deploy after build completes
--max-cycles INT                       Max fix iterations (default: 5)
```

```bash
forge "build a FastAPI backend" --deploy railway
forge "build a Next.js app" --deploy vercel --max-cycles 3
```

### Live feed

While Forge runs, you get a live dashboard:

```
 forge  ●  bookmarks-api  ●  CODING  ●  cycle 1/5

 ┌─ Overseer ──────────────────────────────────────────────────────────┐
 │  Dispatching 4 coding tasks (2 parallel). Next: integration.        │
 └─────────────────────────────────────────────────────────────────────┘

 Tasks                                   Agent         Status
 ────────────────────────────────────────────────────────────────────
 [✓] Setup project structure             CodingAgent   done
 [✓] Database models                     CodingAgent   done
 [~] Auth endpoints (JWT)                CodingAgent   writing...
 [~] Bookmark CRUD API                   CodingAgent   writing...
 [ ] Wire auth into routes               —             waiting

 [i] interrupt   [r] resume (after interrupt)   [q] quit & save
```

Press **`i`** to pause and redirect Forge mid-build. Press **`q`** to save and exit.

### Resume a session

```bash
forge resume              # resume the most recent session
forge resume abc123       # resume a specific session by ID
```

### List all sessions

```bash
forge sessions
```

```
                     Forge Sessions
 ID       Idea                   Phase     Cycle  Cost ($)  Created
 abc123   bookmarks manager...   DONE      1      0.2341    2026-06-01T14:32
 def456   markdown to PDF...     CODING    0      0.0892    2026-06-01T13:15
```

### View logs

```bash
forge logs              # logs for most recent session
forge logs abc123       # logs for a specific session
```

---

## What gets built

Generated projects land in `~/.forge/sessions/<id>/workspace/`. Open that directory in your editor while Forge is running — it's just files.

Forge can build:
- **Web apps** — React, Next.js, Vue frontends
- **APIs** — FastAPI, Flask, Express, Go backends
- **CLI tools** — Python, Go, Node scripts
- **Anything** — the ArchitectureAgent picks the right stack for the idea

---

## Development

```bash
# Run tests
pytest -v

# Run a specific test
pytest tests/test_overseer.py -v

# Install dev dependencies
uv pip install -e ".[dev]"
```

**Project structure:**
```
src/forge/
  cli.py           Typer CLI commands
  overseer.py      Main orchestration loop
  session.py       Session create/load/resume
  db.py            SQLite state persistence
  state_machine.py Phase transitions
  router.py        LLM routing via litellm
  config.py        Config + setup wizard
  agents/
    ideation.py    Idea → spec
    architecture.py  Spec → stack + structure
    task_graph.py  Spec → task DAG
    coding.py      Task → code files
    review.py      Code diff → review
    integration.py Workspace → wired project
    test_agent.py  Project → tests + run
    verification.py  Running app → pass/fail report
    deploy.py      Project → deployed URL
  ui/
    live_feed.py   Rich terminal dashboard
    interrupt.py   Keyboard interrupt handler
```

---

## Architecture decisions

- **SQLite state machine** — every phase transition is persisted. A crash mid-build resumes exactly where it left off.
- **litellm** — one interface for every LLM provider. Switch models per tier in config without changing code.
- **Verification loop** — Forge doesn't stop at "code written". It runs the app and probes it. Failures feed back as fix tasks.
- **No vendor lock-in** — the workspace is plain files. If Forge gets stuck, open the workspace and keep going yourself.
