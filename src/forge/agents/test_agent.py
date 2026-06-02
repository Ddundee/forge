import json
from pathlib import Path
from forge.agents.base import BaseAgent, AgentResult
from forge.router import ModelTier

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

    async def run(self, workspace: Path, architecture: str) -> AgentResult:  # type: ignore[override]
        arch = json.loads(architecture) if isinstance(architecture, str) else architecture
        framework = arch.get("test_framework", "pytest")

        messages: list[dict] = [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": (
                f"Test framework: {framework}\n"
                f"Workspace root: {workspace}"
            )},
        ]
        summary = await self._run_agentic_loop(messages=messages, workspace=workspace)

        lowered = summary.lower()
        passed = (
            "pass" in lowered
            or "✓" in summary
            or "success" in lowered
            or "all tests" in lowered
        )
        return AgentResult(
            success=passed,
            output=summary,
            error=None if passed else "tests_failed",
        )
