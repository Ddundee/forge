# Forge — Design Spec
**Date:** 2026-06-01  
**Status:** Approved

## Overview

Forge is a Python CLI tool that takes a plain-text idea and autonomously builds a working product end-to-end. It solves the "last mile" problem with current LLMs — where models can start a project but fail to fully connect, verify, and ship it without repeated human prompting.

```
forge "build an expense tracker with auth"
```

Forge figures out what to build, plans the work, writes code with specialized agents, reviews it, runs tests, verifies the running app, and iterates until it passes — all in one command.

---

## Architecture

### Core Model

Forge is a **Python CLI backed by a SQLite state machine**. Every run creates a **Session** stored at `~/.forge/sessions/<id>/`, containing:

- `session.db` — SQLite database with full state
- `workspace/` — the generated project (a real directory, openable in any editor live)
- `logs/` — full agent logs per task

Sessions are resumable: `forge resume <id>` re-enters at the start of the last incomplete phase.

### Overseer

A persistent **Overseer Agent** (Opus-class LLM) owns all phase transitions. It reads full session state, decides what to do next, and dispatches specialized agents. It never writes code itself — it coordinates.

### Specialized Agents

Each agent is a focused LLM call with a tight prompt and tools:

| Agent | Responsibility |
|-------|---------------|
| `IdeationAgent` | Expands raw idea into concrete spec via 2-3 clarifying questions |
| `ArchitectureAgent` | Picks tech stack, file structure, deployment target |
| `TaskGraphAgent` | Produces a DAG of coding tasks with dependencies |
| `CodingAgent` | Writes one task's code (file-scoped) |
| `ReviewAgent` | Reviews one task's diff for correctness and quality |
| `IntegrationAgent` | Wires all tasks together, fixes import/interface mismatches |
| `TestAgent` | Writes and runs tests (framework inferred from stack) |
| `VerificationAgent` | Runs the app, probes it, produces structured pass/fail report |
| `DeployAgent` | Deploys to chosen platform (optional) |

---

## Phase Pipeline

```
IDEATION → ARCHITECTURE → TASK_GRAPH
  → [CODING → REVIEW] per task (parallel where deps allow)
    → INTEGRATION → TESTING → VERIFICATION
      → (DEPLOY?) → DONE
```

Each phase writes output to the session DB before transitioning. A crash mid-phase re-enters at the start of that phase with all prior output intact.

### Iteration Loop

VERIFICATION failures do not end the run. The Overseer reads the failure report, creates targeted fix tasks, and loops back:

```
VERIFICATION fails
  └─ Overseer reads failure report
       └─ Creates targeted fix tasks
            └─ Re-enters CODING → REVIEW → INTEGRATION → TESTING → VERIFICATION
                 └─ Repeat until passes or max cycles hit
```

**Max iteration guard:** 5 fix cycles by default (configurable). If still failing after max cycles, Forge surfaces a clear summary of what's broken and exits cleanly — never silently loops forever.

### IDEATION Detail

Before locking the spec, the Overseer asks 2-3 clarifying questions in the terminal (e.g., *"Should users be able to share expenses, or is this single-user?"*). The user can answer or skip — skips result in a noted assumption.

### Interrupt Handling

Pressing `i` at any time freezes the live feed and opens an inline text prompt. The user types a redirect (e.g., "make the UI dark mode"), and the Overseer folds it into the current phase before continuing.

---

## LLM Routing

All LLM calls go through a single `LLMRouter` backed by `litellm`, giving access to Claude, OpenAI, Gemini, Grok, Mistral, and 100+ others behind one interface.

### Model Tiers

| Tier | Used for | Default |
|------|----------|---------|
| `overseer` | Phase decisions, architecture | Claude Opus / GPT-4o |
| `reasoning` | Complex coding, integration | Claude Sonnet / o3-mini |
| `standard` | Boilerplate coding, reviews | Claude Haiku / GPT-4o-mini |
| `fast` | Scaffolding, simple edits | Gemini Flash / Haiku |

The Overseer can escalate a task's tier mid-run (e.g., a tricky bug gets bumped to `reasoning`).

### Recommendation System (New Users)

On first run with no API keys, `forge setup` runs a wizard:

1. Asks priority: *speed / cost / quality* (pick 1-3)
2. Asks which API keys the user has
3. Recommends a named **provider profile**: `claude-primary`, `openai-primary`, `mixed-cost-optimized`
4. Writes to `~/.forge/config.toml`

Experienced users can pin specific models per tier in `config.toml` or pass `--model overseer=claude-opus-4-8` at the CLI.

---

## Live Feed UX

Built with `rich`. A persistent dashboard updates in place:

```
 forge  ●  expense-tracker  ●  CODING  ●  cycle 1/5          [i] interrupt

 ┌─ Overseer ──────────────────────────────────────────────────────────────┐
 │  Dispatching 4 coding tasks (2 parallel). Next: integration.            │
 └─────────────────────────────────────────────────────────────────────────┘

 Tasks                                    Agent         Status
 ────────────────────────────────────────────────────────────────────────
 [✓] Setup project structure              CodingAgent   done
 [✓] Database schema + migrations         CodingAgent   done
 [~] Auth endpoints (JWT)                 CodingAgent   writing...  ████░░
 [~] Expense CRUD API                     CodingAgent   writing...  ██░░░░
 [ ] Frontend components                  —             waiting
 [ ] Wire auth into frontend              —             waiting

 ─────────────────────────────────────────────────────────────────────────
 [i] interrupt   [r] resume   [s] session info   [q] quit & save
```

- **Overseer box** always shows what the brain is currently thinking/deciding
- Completed tasks collapse; failed tasks show red with a one-line reason
- `q` saves and exits cleanly; `forge resume` brings it back

---

## CLI Surface

```
forge "idea"              # start new build
forge resume [id]         # resume a session (defaults to last)
forge sessions            # list all sessions + status + cost
forge setup               # run provider recommendation wizard
forge logs [id]           # tail full agent logs for a session
```

---

## State Schema (SQLite)

```sql
sessions    — id, idea, spec, phase, cycle, created_at, config_json
tasks       — id, session_id, title, type, status, assigned_model, output, deps_json
artifacts   — id, session_id, file_path, content, version
llm_calls   — id, task_id, provider, model, tokens_in, tokens_out, cost_usd, response
events      — id, session_id, timestamp, phase, message   -- drives the live feed
```

---

## Testing & Verification

### TestAgent
- Infers the right test framework from the stack (pytest, vitest, go test, etc.)
- Writes unit tests per module + one integration test covering the happy path
- Runs via subprocess; stdout/stderr passed to the Overseer

### VerificationAgent
- Starts the app in a subprocess
- **Web apps:** headless Playwright to click through core flows
- **APIs:** `httpx` requests against documented endpoints
- **CLIs:** runs binary with sample inputs, checks outputs
- Produces a structured report: `{passed: [...], failed: [...], errors: [...]}`
- The Overseer reads this report to decide whether to loop or declare done

### Cost Tracking
Every LLM call is logged with token counts and estimated USD cost. `forge sessions` shows total spend per session.

---

## Deployment (Optional)

When the user selects "deploy" at session start, `DeployAgent` runs after VERIFICATION passes:

- Detects the app type and recommends a platform (Vercel for web, Railway for backend, Fly.io for containers)
- Handles auth via existing CLI tools (`vercel`, `railway`, `flyctl`) — user must have these installed
- Outputs the live URL on success

---

## Out of Scope (v1)

- GUI / web dashboard
- Multi-user / team sessions
- Billing / usage management
- Mobile app targets
- Self-hosted LLM inference
