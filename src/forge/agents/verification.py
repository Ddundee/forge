import json
from pathlib import Path
from forge.agents.base import BaseAgent, AgentResult, _extract_json
from forge.router import ModelTier

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

    async def run(
        self,
        workspace: Path,
        architecture: str,
        spec: str,
    ) -> AgentResult:
        messages: list[dict] = [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": (
                f"Architecture:\n{architecture}\n\n"
                f"Spec:\n{spec}\n\n"
                f"Workspace root: {workspace}"
            )},
        ]
        response = await self._run_agentic_loop(messages=messages, workspace=workspace)

        try:
            report: dict = json.loads(_extract_json(response))
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
