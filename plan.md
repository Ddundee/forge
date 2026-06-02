# Plan: True Agentic Loop for Forge Agents

## 1. What We're Changing and Why

Today every Forge agent is a **one-shot LLM call**. The model outputs JSON. Python parses it and acts on it. The LLM never sees the result of its own actions.

```
User spec → [LLM call] → JSON → Python writes files → done
```

What we want is a **real agentic loop** like Claude Code or OpenCode:

```
System prompt + context
   ↓
[LLM call] → text OR tool_call
                ↓
           execute tool (bash / read / write)
                ↓
           tool result → back into conversation
                ↓
           [LLM call again] → text OR tool_call
                ↓
           ... repeat until LLM stops calling tools ...
                ↓
           final text output = agent done
```

The LLM drives itself. It reads files to understand context, writes code, runs the test suite, sees the failure, fixes the code, runs again. One agent can span 10–20 LLM calls and 30 tool calls for a complex task — and produce correct output because it can verify its own work.

---

## 2. Scope

### Agents that become true agentic loops:
| Agent | Why |
|---|---|
| `CodingAgent` | Needs to read existing files for context, write code, then verify it compiles/imports |
| `IntegrationAgent` | Needs to read the whole workspace, make targeted fixes, verify they work |
| `TestAgent` | Needs to read source files, write tests, run them, fix failures |
| `VerificationAgent` | Needs to run build/test commands, read output, act on failures |

### Agents that stay one-shot (no filesystem access needed):
| Agent | Why |
|---|---|
| `IdeationAgent` | Pure LLM reasoning over a spec — no files |
| `ArchitectureAgent` | Pure LLM reasoning over a spec — no files |
| `TaskGraphAgent` | Pure LLM reasoning over spec + arch — no files |
| `ReviewAgent` | Reads a code diff as text — already has what it needs |
| `DeployAgent` | Shell commands would be too dangerous to auto-approve; keep explicit |

---

## 3. New Files

### `src/forge/tools/__init__.py`
Empty, marks the package.

### `src/forge/tools/definitions.py`

Defines the four tools the LLM can call, in the OpenAI/Anthropic function-calling JSON schema format that litellm accepts.

```python
TOOL_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "bash_exec",
            "description": (
                "Execute a bash command in the project workspace directory. "
                "Use for: running tests, building the project, checking syntax, "
                "installing packages, inspecting directory structure. "
                "stdout and stderr are both captured and returned."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "The bash command to run. Runs with cwd=workspace."
                    },
                    "timeout": {
                        "type": "integer",
                        "description": "Max seconds to wait. Defaults to 60.",
                        "default": 60
                    }
                },
                "required": ["command"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": (
                "Read the full contents of a file in the workspace. "
                "Path is relative to the workspace root."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Relative path from workspace root, e.g. 'src/App.jsx'"
                    }
                },
                "required": ["path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": (
                "Write (or overwrite) a file in the workspace. "
                "Creates parent directories automatically. "
                "Path is relative to the workspace root."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Relative path from workspace root, e.g. 'src/App.jsx'"
                    },
                    "content": {
                        "type": "string",
                        "description": "Full file content to write"
                    }
                },
                "required": ["path", "content"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "list_dir",
            "description": (
                "List files and directories at a given path in the workspace. "
                "Returns a formatted tree. Path is relative to workspace root."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Relative path to list. Defaults to '.' (workspace root).",
                        "default": "."
                    }
                },
                "required": []
            }
        }
    }
]
```

### `src/forge/tools/executor.py`

The executor receives a tool name + arguments dict and a workspace Path. It actually runs the tool and returns a string result that goes back to the LLM.

```python
import subprocess
import shlex
from pathlib import Path


# Commands that are always blocked, regardless of context.
_BLOCKED_PATTERNS = [
    "rm -rf /",
    "rm -rf ~",
    ":(){ :|:& };:",   # fork bomb
    "dd if=/dev/zero",
    "mkfs",
    "> /dev/sda",
    "chmod 777 /",
    "chown -R",
    "sudo rm",
    "sudo dd",
]


def _is_blocked(command: str) -> bool:
    lowered = command.lower()
    return any(pattern in lowered for pattern in _BLOCKED_PATTERNS)


def execute_tool(name: str, args: dict, workspace: Path) -> str:
    """
    Dispatch a tool call and return the string result.
    Raises ValueError for unknown tools or blocked commands.
    """
    if name == "bash_exec":
        return _bash_exec(args, workspace)
    elif name == "read_file":
        return _read_file(args, workspace)
    elif name == "write_file":
        return _write_file(args, workspace)
    elif name == "list_dir":
        return _list_dir(args, workspace)
    else:
        return f"ERROR: Unknown tool '{name}'"


def _bash_exec(args: dict, workspace: Path) -> str:
    command = args.get("command", "")
    timeout = int(args.get("timeout", 60))

    if not command.strip():
        return "ERROR: Empty command"

    if _is_blocked(command):
        return f"ERROR: Command blocked for safety: {command!r}"

    try:
        result = subprocess.run(
            command,
            shell=True,
            cwd=workspace,
            capture_output=True,
            text=True,
            timeout=timeout
        )
        output = ""
        if result.stdout:
            output += result.stdout
        if result.stderr:
            output += f"\n[stderr]\n{result.stderr}"
        output += f"\n[exit {result.returncode}]"
        # Cap output so it doesn't overflow the context window
        if len(output) > 8000:
            output = output[:4000] + "\n... [truncated] ...\n" + output[-4000:]
        return output.strip()
    except subprocess.TimeoutExpired:
        return f"ERROR: Command timed out after {timeout}s"
    except Exception as e:
        return f"ERROR: {e}"


def _read_file(args: dict, workspace: Path) -> str:
    rel_path = args.get("path", "")
    if not rel_path:
        return "ERROR: No path provided"

    target = (workspace / rel_path).resolve()

    # Sandbox check: don't allow reads outside the workspace
    try:
        target.relative_to(workspace.resolve())
    except ValueError:
        return f"ERROR: Path escapes workspace: {rel_path}"

    if not target.exists():
        return f"ERROR: File not found: {rel_path}"

    if not target.is_file():
        return f"ERROR: Not a file: {rel_path}"

    try:
        content = target.read_text(encoding="utf-8", errors="replace")
        if len(content) > 16000:
            content = content[:8000] + "\n... [truncated] ...\n" + content[-8000:]
        return content
    except Exception as e:
        return f"ERROR reading {rel_path}: {e}"


def _write_file(args: dict, workspace: Path) -> str:
    rel_path = args.get("path", "")
    content = args.get("content", "")

    if not rel_path:
        return "ERROR: No path provided"

    target = (workspace / rel_path).resolve()

    # Sandbox check
    try:
        target.relative_to(workspace.resolve())
    except ValueError:
        return f"ERROR: Path escapes workspace: {rel_path}"

    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        return f"OK: Wrote {len(content)} chars to {rel_path}"
    except Exception as e:
        return f"ERROR writing {rel_path}: {e}"


def _list_dir(args: dict, workspace: Path) -> str:
    rel_path = args.get("path", ".")
    target = (workspace / rel_path).resolve()

    try:
        target.relative_to(workspace.resolve())
    except ValueError:
        return f"ERROR: Path escapes workspace: {rel_path}"

    if not target.exists():
        return f"ERROR: Path not found: {rel_path}"

    lines = []
    for item in sorted(target.iterdir()):
        prefix = "d" if item.is_dir() else "f"
        lines.append(f"[{prefix}] {item.name}")

    return "\n".join(lines) if lines else "(empty directory)"
```

---

## 4. Modified Files

### `src/forge/router.py` — add `complete_with_tools()`

The current `complete()` method does a simple one-shot completion. We add `complete_with_tools()` which passes the `tools` parameter to litellm and returns both the assistant message and any tool_call blocks, so the agentic loop can process them.

```python
@dataclass
class ToolCall:
    id: str
    name: str
    arguments: dict   # already parsed from JSON

@dataclass
class LoopResult:
    """One turn of an agentic loop — the LLM's response."""
    text: str | None               # Final text (if no tool calls, or after all done)
    tool_calls: list[ToolCall]     # Tool calls the LLM wants to make (may be empty)
    model: str
    tokens_in: int
    tokens_out: int
    cost_usd: float

class LLMRouter:
    ...
    async def complete_with_tools(
        self,
        tier: ModelTier,
        messages: list[dict],
        tools: list[dict],
        **kwargs
    ) -> LoopResult:
        import json as _json
        model = self._models[tier]
        response = await litellm.acompletion(
            model=model,
            messages=messages,
            tools=tools,
            **kwargs
        )
        usage = response.usage
        try:
            cost = litellm.completion_cost(response)
        except Exception:
            cost = 0.0

        msg = response.choices[0].message
        text = msg.content or None
        tool_calls = []
        if msg.tool_calls:
            for tc in msg.tool_calls:
                try:
                    args = _json.loads(tc.function.arguments)
                except Exception:
                    args = {}
                tool_calls.append(ToolCall(
                    id=tc.id,
                    name=tc.function.name,
                    arguments=args,
                ))

        return LoopResult(
            text=text,
            tool_calls=tool_calls,
            model=model,
            tokens_in=usage.prompt_tokens,
            tokens_out=usage.completion_tokens,
            cost_usd=cost,
        )
```

### `src/forge/agents/base.py` — add `_run_agentic_loop()`

The agentic loop lives here so any agent can call it. It manages the multi-turn conversation, dispatches tool calls, feeds results back, and stops when the LLM stops calling tools or a limit is reached.

```python
import json
from pathlib import Path
from forge.tools.definitions import TOOL_DEFINITIONS
from forge.tools.executor import execute_tool

MAX_TURNS = 40          # Maximum LLM turns per agent invocation
MAX_TOOL_CALLS = 80     # Hard cap on total tool dispatches

class BaseAgent(ABC):
    ...

    async def _run_agentic_loop(
        self,
        messages: list[dict],
        workspace: Path,
        task_id: str | None = None,
        tools: list[dict] | None = None,
    ) -> str:
        """
        Run a multi-turn agentic conversation where the LLM can call tools.

        Appends tool calls and results to `messages` in-place so the LLM
        always has full context. Returns the final text response from the LLM.
        """
        tool_defs = tools or TOOL_DEFINITIONS
        total_tool_calls = 0

        for turn in range(MAX_TURNS):
            result = await self.router.complete_with_tools(
                self.tier,
                messages,
                tool_defs,
            )

            # Log this LLM call
            self.db.log_llm_call(
                session_id=self.session_id,
                provider=result.model.split("/")[0],
                model=result.model,
                tokens_in=result.tokens_in,
                tokens_out=result.tokens_out,
                cost_usd=result.cost_usd,
                response=result.text or f"[{len(result.tool_calls)} tool call(s)]",
                task_id=task_id,
            )

            # No tool calls → LLM is done
            if not result.tool_calls:
                return result.text or ""

            # Build the assistant message with tool_calls for the next turn
            assistant_msg: dict = {
                "role": "assistant",
                "content": result.text or "",
                "tool_calls": [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {
                            "name": tc.name,
                            "arguments": json.dumps(tc.arguments),
                        }
                    }
                    for tc in result.tool_calls
                ]
            }
            messages.append(assistant_msg)

            # Execute each tool call and append results
            for tc in result.tool_calls:
                total_tool_calls += 1
                if total_tool_calls > MAX_TOOL_CALLS:
                    tool_result = "ERROR: Tool call limit reached. Stop and report what you have."
                else:
                    tool_result = execute_tool(tc.name, tc.arguments, workspace)

                # Log to DB for traceability
                self.db.log_tool_call(
                    session_id=self.session_id,
                    task_id=task_id,
                    tool_name=tc.name,
                    tool_args=json.dumps(tc.arguments),
                    tool_result=tool_result[:2000],
                )

                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": tool_result,
                })

        # Fell through MAX_TURNS — ask for a final summary
        messages.append({
            "role": "user",
            "content": "You have reached the turn limit. Summarize what you completed."
        })
        final = await self.router.complete_with_tools(self.tier, messages, [])
        return final.text or ""
```

### `src/forge/db.py` — add `tool_calls` table and `log_tool_call()`

Add a new table to the schema and a new method. This lets us inspect exactly what each agent did in the DB.

```python
# Add to SCHEMA string:
"""
CREATE TABLE IF NOT EXISTS tool_calls (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    task_id TEXT REFERENCES tasks(id),
    tool_name TEXT NOT NULL,
    tool_args TEXT NOT NULL DEFAULT '{}',
    tool_result TEXT,
    created_at TEXT NOT NULL
);
"""

# New method on Database class:
def log_tool_call(
    self,
    session_id: str,
    task_id: str | None,
    tool_name: str,
    tool_args: str,
    tool_result: str,
) -> None:
    self.conn.execute(
        "INSERT INTO tool_calls "
        "(id, session_id, task_id, tool_name, tool_args, tool_result, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (_uid(), session_id, task_id, tool_name, tool_args, tool_result, _now()),
    )
    self.conn.commit()
```

---

## 5. Agent Rewrites

### `CodingAgent` — before vs. after

**Before:** One LLM call → JSON array of file writes → write them.

**After:** Multi-turn loop. The agent reads the workspace to understand existing code, writes files, optionally runs a quick syntax check, then declares done.

```python
SYSTEM = """You are a senior software engineer implementing one focused coding task.

You have tools available:
- bash_exec: run shell commands (build, lint, syntax check, install packages)
- read_file: read any file in the workspace
- write_file: write or overwrite a file in the workspace
- list_dir: list directory contents

Workflow:
1. Use list_dir and read_file to understand the existing codebase and conventions
2. Write the files needed for this task using write_file
3. Run a quick sanity check (e.g. `python -c "import <module>"` or `npx tsc --noEmit`) if useful
4. When the task is complete, output a brief summary of what you wrote

Rules:
- Write complete, working code — no placeholders or TODOs
- Match the existing code style you observe in the workspace
- Follow the architecture and stack decisions exactly
- When you are done with all file writes, stop calling tools and write your summary"""


class CodingAgent(BaseAgent):
    tier = ModelTier.REASONING

    async def run(
        self,
        task_title: str,
        spec: str,
        architecture: str,
        workspace: Path,
        context: str = "",
        task_id: str | None = None,
    ) -> AgentResult:
        messages = [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": (
                f"Task: {task_title}\n\n"
                f"Spec:\n{spec}\n\n"
                f"Architecture:\n{architecture}"
                + (f"\n\nContext from prior tasks:\n{context}" if context else "")
                + f"\n\nWorkspace root: {workspace}"
            )},
        ]

        summary = await self._run_agentic_loop(
            messages=messages,
            workspace=workspace,
            task_id=task_id,
        )

        # Snapshot artifacts: everything the agent wrote is now in the workspace
        written = []
        for f in workspace.rglob("*"):
            if f.is_file() and not any(p.startswith(".") for p in f.parts[len(workspace.parts):]):
                rel = str(f.relative_to(workspace))
                try:
                    self.db.save_artifact(self.session_id, rel, f.read_text())
                    written.append(rel)
                except Exception:
                    pass

        return AgentResult(success=True, output=summary or f"Wrote {len(written)} files")
```

### `IntegrationAgent` — before vs. after

**Before:** Stuff the whole workspace into one giant prompt → LLM returns patch JSON → apply patches.

**After:** Agent reads files it cares about, applies targeted fixes, runs a build step to verify.

```python
SYSTEM = """You are a senior engineer responsible for wiring a project together after all tasks are coded.

You have tools available:
- bash_exec: run shell commands (build, import checks, linting)
- read_file: read any file in the workspace
- write_file: write or overwrite a file in the workspace
- list_dir: list directory contents

Workflow:
1. Use list_dir to get the project structure
2. Read key entry points and configuration files to find integration issues:
   - broken imports, missing wiring, interface mismatches, wrong file paths
3. Fix each issue by writing the corrected file with write_file
4. Run a build or import check after your fixes to confirm they work
5. When everything is wired correctly, stop calling tools and write a brief summary

If nothing needs fixing, say so immediately without calling any tools."""


class IntegrationAgent(BaseAgent):
    tier = ModelTier.REASONING

    async def run(self, workspace: Path, spec: str, architecture: str) -> AgentResult:
        messages = [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": (
                f"Spec:\n{spec}\n\n"
                f"Architecture:\n{architecture}\n\n"
                f"Workspace root: {workspace}"
            )},
        ]
        summary = await self._run_agentic_loop(messages=messages, workspace=workspace)
        return AgentResult(success=True, output=summary or "Integration complete")
```

### `TestAgent` — before vs. after

**Before:** Stuff workspace into prompt → LLM returns test file JSON → write them → run test command.

**After:** Agent reads source files, writes tests, runs them, sees failures, fixes tests, runs again.

```python
SYSTEM = """You are a test engineer. Write tests for this project and make them pass.

You have tools available:
- bash_exec: run the test suite and see results
- read_file: read source files to understand what to test
- write_file: write test files
- list_dir: list directory contents

Workflow:
1. Use list_dir and read_file to understand the source code structure
2. Write tests using write_file — import only from files that actually exist
3. Run the tests with bash_exec to see results
4. Fix any failing tests (wrong imports, wrong assertions) by writing corrected files
5. Repeat until tests pass or you have exhausted reasonable fixes
6. Write a summary of what you tested and the final result

Critical rules:
- ONLY import from files that ACTUALLY EXIST (verify with read_file first)
- Do NOT invent utility functions that don't exist in the source
- For React+Vitest: import components from their real paths (e.g. '../src/App.jsx')
- Keep tests simple — render the component, assert it mounts without crashing
- For vitest: `import { describe, it, expect } from 'vitest'`"""


class TestAgent(BaseAgent):
    tier = ModelTier.REASONING

    async def run(self, workspace: Path, architecture: str) -> AgentResult:
        arch = json.loads(architecture) if isinstance(architecture, str) else architecture
        framework = arch.get("test_framework", "pytest")

        messages = [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": (
                f"Test framework: {framework}\n"
                f"Workspace root: {workspace}"
            )},
        ]
        summary = await self._run_agentic_loop(messages=messages, workspace=workspace)
        passed = "pass" in summary.lower() or "✓" in summary or "success" in summary.lower()
        return AgentResult(
            success=passed,
            output=summary,
            error=None if passed else "tests_failed",
        )
```

### `VerificationAgent` — before vs. after

**Before:** Python hardcodes `npm run build` and `npx vitest run`, LLM just judges the output.

**After:** Agent drives verification itself — runs build, reads the output, investigates failures, applies quick fixes if obvious, re-runs.

```python
SYSTEM = """You are a QA engineer verifying that a project builds and its tests pass.

You have tools available:
- bash_exec: run build commands, test suites, linters
- read_file: read files to understand failures
- write_file: apply quick fixes for obvious issues (wrong import path, missing config)
- list_dir: list directory contents

Workflow:
1. Use list_dir to understand the project structure
2. Run the build (e.g. `npm run build` or `python -m pytest`) with bash_exec
3. If it fails: read the relevant source files, understand the error, apply a targeted fix
4. Re-run to confirm the fix worked
5. Run the test suite after a successful build
6. When satisfied (build passes, tests pass or are acceptably skipped), output a JSON report:

{
  "passed": ["Build succeeded", "All 5 tests passed"],
  "failed": [],
  "errors": []
}

If the build failed after your best attempts:
{
  "passed": [],
  "failed": ["Build failed: <reason>"],
  "errors": ["<raw error snippet>"]
}

Output ONLY the JSON report as your final message. Do not wrap it in markdown."""


class VerificationAgent(BaseAgent):
    tier = ModelTier.REASONING

    async def run(self, workspace: Path, architecture: str, spec: str) -> AgentResult:
        messages = [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": (
                f"Architecture:\n{architecture}\n\n"
                f"Spec:\n{spec}\n\n"
                f"Workspace root: {workspace}"
            )},
        ]
        response = await self._run_agentic_loop(messages=messages, workspace=workspace)

        try:
            report = json.loads(_extract_json(response))
        except json.JSONDecodeError:
            report = {
                "passed": [],
                "failed": ["Verification agent returned malformed report"],
                "errors": [response[:300]],
            }

        success = len(report.get("failed", [])) == 0 and len(report.get("errors", [])) == 0
        return AgentResult(
            success=success,
            output=json.dumps(report),
            error=None if success else "verification_failed",
        )
```

---

## 6. File-by-File Change Summary

```
src/forge/
├── tools/
│   ├── __init__.py          [NEW] — empty
│   ├── definitions.py       [NEW] — TOOL_DEFINITIONS list (4 tools)
│   └── executor.py          [NEW] — execute_tool() dispatcher + safety checks
│
├── agents/
│   ├── base.py              [MODIFY] — add _run_agentic_loop()
│   ├── coding.py            [REWRITE] — new system prompt + use _run_agentic_loop()
│   ├── integration.py       [REWRITE] — new system prompt + use _run_agentic_loop()
│   ├── test_agent.py        [REWRITE] — new system prompt + use _run_agentic_loop()
│   └── verification.py      [REWRITE] — new system prompt + use _run_agentic_loop()
│
├── router.py                [MODIFY] — add LoopResult, ToolCall, complete_with_tools()
└── db.py                    [MODIFY] — add tool_calls table + log_tool_call()
```

Agents NOT changed: `ideation.py`, `architecture.py`, `task_graph.py`, `review.py`, `deploy.py`

---

## 7. Safety Model

### Tier 1: Hard blocks in `executor.py`
Patterns that are always rejected regardless of context:
- `rm -rf /` or `rm -rf ~`
- Fork bombs (`:(){ :|:& };:`)
- Device writes (`dd if=/dev/zero`, `> /dev/sda`, `mkfs`)
- Privilege escalation (`sudo rm`, `sudo dd`)

### Tier 2: Sandboxing
- All `bash_exec` commands run with `cwd=workspace` — relative paths are naturally scoped
- `read_file` and `write_file` resolve paths against workspace and reject anything that would escape via `../..`
- No network-touching commands are explicitly blocked (npm install, pip install are necessary)

### Tier 3: Limits
- `MAX_TURNS = 40` per agent — prevents infinite LLM loops
- `MAX_TOOL_CALLS = 80` per agent — prevents runaway tool use
- Per-command `timeout=60` default — prevents hanging builds

### Tier 4: Observability
- Every tool call is logged to `tool_calls` table with args and result snippet
- Every LLM turn is logged to `llm_calls` table
- Costs accumulate normally in the DB

---

## 8. Database Schema Addition

```sql
CREATE TABLE IF NOT EXISTS tool_calls (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    task_id TEXT REFERENCES tasks(id),
    tool_name TEXT NOT NULL,
    tool_args TEXT NOT NULL DEFAULT '{}',
    tool_result TEXT,
    created_at TEXT NOT NULL
);
```

This table lets you audit exactly what every agent did:

```sql
-- See every bash command an agent ran during a session
SELECT tool_name, tool_args, substr(tool_result, 1, 200)
FROM tool_calls
WHERE session_id = 'abc123' AND tool_name = 'bash_exec'
ORDER BY created_at;
```

---

## 9. Conversation Message Format

litellm follows the OpenAI multi-turn format. Here's what a 2-turn exchange looks like in the messages list:

```python
# Turn 1: user asks, LLM calls a tool
[
    {"role": "system", "content": "..."},
    {"role": "user", "content": "Implement the login form"},
    # LLM responds with a tool call:
    {
        "role": "assistant",
        "content": "",
        "tool_calls": [
            {
                "id": "call_abc123",
                "type": "function",
                "function": {
                    "name": "list_dir",
                    "arguments": "{\"path\": \".\"}"
                }
            }
        ]
    },
    # Python executes the tool, appends result:
    {
        "role": "tool",
        "tool_call_id": "call_abc123",
        "content": "[f] package.json\n[d] src\n[d] public"
    },
]

# Turn 2: LLM sees the result, calls another tool or finishes
# ... continues appending to the same messages list
```

The messages list grows with each turn. litellm sends the entire history on every call so the LLM has full context.

---

## 10. Implementation Order

1. **`src/forge/tools/definitions.py`** — tool schemas (no dependencies)
2. **`src/forge/tools/executor.py`** — tool execution (depends on nothing)
3. **`src/forge/tools/__init__.py`** — empty package marker
4. **`src/forge/router.py`** — add `LoopResult`, `ToolCall`, `complete_with_tools()` (extend existing)
5. **`src/forge/db.py`** — add `tool_calls` table and `log_tool_call()` (extend existing)
6. **`src/forge/agents/base.py`** — add `_run_agentic_loop()` (depends on router + db + executor)
7. **`src/forge/agents/coding.py`** — rewrite (depends on base)
8. **`src/forge/agents/integration.py`** — rewrite (depends on base)
9. **`src/forge/agents/test_agent.py`** — rewrite (depends on base)
10. **`src/forge/agents/verification.py`** — rewrite (depends on base)
11. **Tests** — run pytest suite, then run a full forge build to validate end-to-end

---

## 11. Key Differences from OpenCode

OpenCode uses Effect (a TypeScript algebraic effects library) for composability and permission gating per tool call. We're keeping it simpler:

| OpenCode | Forge |
|---|---|
| TypeScript + Effect streams | Python async/await |
| Per-tool permission gate (approve/deny in TUI) | Auto-allow within workspace; hard-block unsafe patterns |
| Deferred promises for async tool coordination | Sequential: call tool, get string, append, repeat |
| AI SDK streaming (token-by-token) | litellm `acompletion` (full response per turn) |
| Plugin hooks before/after each tool | DB logging per tool call |
| MCP tools in addition to built-ins | Built-in tools only (for now) |

The simpler design is correct for Forge's use case. Forge agents run unattended in a pipeline — there's no interactive user to approve individual tool calls. The safety model is static (blocked patterns + workspace sandbox) rather than interactive.

---

## 12. Open Questions / Future Work

- **Streaming output**: currently each LLM turn is a blocking `acompletion()`. Could switch to `acompletion(..., stream=True)` and pipe tokens to the live feed UI so the user sees the agent "thinking" in real time.
- **Web fetch tool**: The user said to skip for now. When added, it should be a separate tool `fetch_url(url)` with a domain allowlist.
- **Per-tool permissions**: Could add a `confirm_bash(command)` hook that emits to the live feed and awaits user approval (y/n) for commands matching certain patterns (e.g. `npm install <package>` that wasn't in the original spec).
- **Context window management**: For very large workspaces, the messages list grows long. Could add a compaction step (summarize old tool results) if token count exceeds a threshold — similar to OpenCode's `needsCompaction` flag.
- **DeployAgent**: Currently kept as explicit Python code. Could convert to agentic once we have a controlled permission model for deploy-time commands (git push, fly deploy, etc.).
