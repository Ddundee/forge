import asyncio
import json
import subprocess
from pathlib import Path
from forge.agents.base import BaseAgent, AgentResult
from forge.router import ModelTier
import httpx

SYSTEM = """You are a QA engineer verifying a running application.

You will receive probe results (HTTP responses, CLI outputs, or browser snapshots). Produce a structured report:
{
  "passed": ["description of what worked"],
  "failed": ["description of what failed"],
  "errors": ["raw error messages"]
}

Be thorough. Test the core user flows described in the spec features."""

START_COMMANDS: dict[str, list[str]] = {
    "FastAPI": ["uvicorn", "src.main:app", "--port", "18765", "--host", "127.0.0.1"],
    "Flask": ["python", "-m", "flask", "run", "--port", "18765"],
    "Express": ["node", "src/index.js"],
    "Next.js": ["npx", "next", "start", "-p", "18765"],
}


class VerificationAgent(BaseAgent):
    tier = ModelTier.REASONING

    async def run(self, workspace: Path, architecture: str,  # type: ignore[override]
                  spec: str) -> AgentResult:
        arch = json.loads(architecture) if isinstance(architecture, str) else architecture
        method = arch.get("verification_method", "api")
        framework = arch.get("stack", {}).get("framework", "")

        probe_results = await self._probe(method, framework, workspace, spec)

        messages = [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": f"Spec:\n{spec}\n\nProbe results:\n{probe_results}"},
        ]
        response = await self._call(messages)
        try:
            report = json.loads(response)
        except json.JSONDecodeError:
            return AgentResult(success=False, output=response, error="invalid_json")

        success = len(report.get("failed", [])) == 0 and len(report.get("errors", [])) == 0
        return AgentResult(
            success=success,
            output=json.dumps(report),
            error=None if success else "verification_failed",
        )

    async def _probe(self, method: str, framework: str,
                     workspace: Path, spec: str) -> str:
        cmd = START_COMMANDS.get(framework)
        if not cmd:
            return f"Could not determine start command for framework: {framework}"

        proc = subprocess.Popen(cmd, cwd=workspace, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        await asyncio.sleep(2)

        results = []
        if method == "api":
            results = await self._probe_api()
        elif method == "cli":
            results = self._probe_cli(workspace)

        proc.terminate()
        return "\n".join(results)

    async def _probe_api(self) -> list[str]:
        results = []
        async with httpx.AsyncClient(base_url="http://127.0.0.1:18765", timeout=5.0) as client:
            for path in ["/", "/health", "/api/health"]:
                try:
                    r = await client.get(path)
                    results.append(f"GET {path} → {r.status_code}: {r.text[:200]}")
                except Exception as e:
                    results.append(f"GET {path} → ERROR: {e}")
        return results

    def _probe_cli(self, workspace: Path) -> list[str]:
        import glob
        results = []
        for entry in glob.glob(str(workspace / "*.py")) + glob.glob(str(workspace / "main*")):
            proc = subprocess.run(
                ["python", entry, "--help"],
                capture_output=True, text=True, cwd=workspace, timeout=10,
            )
            results.append(f"{entry} --help → {proc.returncode}: {proc.stdout[:200]}")
        return results
