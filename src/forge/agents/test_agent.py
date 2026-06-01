import json
import subprocess
from pathlib import Path
from forge.agents.base import BaseAgent, AgentResult
from forge.router import ModelTier

SYSTEM = """You are a test engineer. Write comprehensive tests for the project.

Output ONLY a JSON array of test files:
[{"path": "tests/test_module.py", "content": "full test code"}, ...]

Write:
1. Unit tests for every public function/class
2. One integration test exercising the main happy-path flow
Use the test framework specified in the architecture."""

FRAMEWORK_CMD: dict[str, list[str]] = {
    "pytest": ["python", "-m", "pytest", "-v", "--tb=short"],
    "vitest": ["npx", "vitest", "run"],
    "jest": ["npx", "jest", "--no-coverage"],
    "go-test": ["go", "test", "./..."],
}


class TestAgent(BaseAgent):
    tier = ModelTier.REASONING

    async def run(self, workspace: Path, architecture: str) -> AgentResult:  # type: ignore[override]
        arch = json.loads(architecture) if isinstance(architecture, str) else architecture
        framework = arch.get("test_framework", "pytest")

        from forge.agents.integration import _read_workspace
        tree = _read_workspace(workspace)
        messages = [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": f"Framework: {framework}\n\nWorkspace:\n{tree}"},
        ]
        response = await self._call(messages)
        try:
            test_files: list[dict] = json.loads(response)
        except json.JSONDecodeError:
            return AgentResult(success=False, output=response, error="invalid_json")

        for tf in test_files:
            path = workspace / tf["path"]
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(tf["content"])

        cmd = FRAMEWORK_CMD.get(framework, ["python", "-m", "pytest", "-v"])
        proc = subprocess.run(cmd, capture_output=True, text=True, cwd=workspace)
        output = proc.stdout + proc.stderr
        success = proc.returncode == 0
        return AgentResult(success=success, output=output,
                           error=None if success else "tests_failed")
