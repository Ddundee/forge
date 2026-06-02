import json
import subprocess
from pathlib import Path
from forge.agents.base import BaseAgent, AgentResult, _extract_json
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
    "react-scripts": ["npx", "react-scripts", "test", "--watchAll=false", "--passWithNoTests"],
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
            test_files: list[dict] = json.loads(_extract_json(response))
        except json.JSONDecodeError:
            return AgentResult(success=False, output=response, error="invalid_json")

        for tf in test_files:
            path = workspace / tf["path"]
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(tf["content"])

        # If the workspace is a CRA project, override to react-scripts test
        pkg = workspace / "package.json"
        if pkg.exists():
            import json as _json
            try:
                pkg_data = _json.loads(pkg.read_text())
                deps = {**pkg_data.get("dependencies", {}), **pkg_data.get("devDependencies", {})}
                if "react-scripts" in deps:
                    framework = "react-scripts"
            except Exception:
                pass

        cmd = FRAMEWORK_CMD.get(framework, ["python", "-m", "pytest", "-v"])
        env = {
            **__import__("os").environ,
            "CI": "true",
            "SKIP_PREFLIGHT_CHECK": "true",
            "NODE_OPTIONS": "--openssl-legacy-provider",
        }
        proc = subprocess.run(cmd, capture_output=True, text=True, cwd=workspace, env=env)
        output = proc.stdout + proc.stderr
        success = proc.returncode == 0
        return AgentResult(success=success, output=output,
                           error=None if success else "tests_failed")
