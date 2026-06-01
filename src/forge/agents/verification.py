import asyncio
import json
import os
import subprocess
from pathlib import Path
from forge.agents.base import BaseAgent, AgentResult, _extract_json
from forge.router import ModelTier
import httpx

SYSTEM = """You are a QA engineer verifying a running application.

You will receive probe results (build output, test output, HTTP responses, or CLI outputs). Produce a structured report:
{
  "passed": ["description of what worked"],
  "failed": ["description of what failed"],
  "errors": ["raw error messages"]
}

Be thorough. Test the core user flows described in the spec features."""

# Backend frameworks that can be started and probed over HTTP
START_COMMANDS: dict[str, list[str]] = {
    "FastAPI": ["uvicorn", "src.main:app", "--port", "18765", "--host", "127.0.0.1"],
    "Flask": ["python", "-m", "flask", "run", "--port", "18765"],
    "Express": ["node", "src/index.js"],
    "Next.js": ["npx", "next", "start", "-p", "18765"],
}

# Frontend frameworks verified via build rather than live server
_FRONTEND_FRAMEWORKS = {
    "react", "vue", "angular", "svelte", "vite",
    "create react app", "react+vite", "next.js (static)",
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
            report = json.loads(_extract_json(response))
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
        # web method or any frontend framework → build-based verification
        if method == "web" or framework.lower() in _FRONTEND_FRAMEWORKS:
            return await self._probe_web_build(workspace)

        # CRA detection via package.json regardless of what architecture returned
        pkg = workspace / "package.json"
        if pkg.exists():
            try:
                pkg_data = json.loads(pkg.read_text())
                deps = {**pkg_data.get("dependencies", {}), **pkg_data.get("devDependencies", {})}
                if "react-scripts" in deps or "vite" in deps:
                    return await self._probe_web_build(workspace)
            except Exception:
                pass

        cmd = START_COMMANDS.get(framework)
        if not cmd:
            # Unknown backend — fall back to build verification if package.json exists
            if pkg.exists():
                return await self._probe_web_build(workspace)
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

    async def _probe_web_build(self, workspace: Path) -> str:
        results = []
        env = {**os.environ, "CI": "false"}  # CI=true makes CRA treat warnings as errors

        # Install dependencies if node_modules is missing
        if not (workspace / "node_modules").exists():
            install = subprocess.run(
                ["npm", "install", "--prefer-offline", "--legacy-peer-deps"],
                cwd=workspace, capture_output=True, text=True, timeout=180,
            )
            results.append(f"npm install → exit {install.returncode}")
            if install.returncode != 0:
                results.append(install.stderr[:600])
                return "\n".join(results)

        # Build
        build = subprocess.run(
            ["npm", "run", "build"],
            cwd=workspace, capture_output=True, text=True, timeout=180, env=env,
        )
        results.append(f"npm run build → exit {build.returncode}")
        if build.returncode != 0:
            results.append(build.stderr[:800])
        else:
            results.append("Build succeeded — output in build/ or dist/")

        # Run tests
        test = subprocess.run(
            ["npm", "test", "--", "--watchAll=false", "--passWithNoTests"],
            cwd=workspace, capture_output=True, text=True, timeout=120,
            env={**os.environ, "CI": "true"},
        )
        results.append(f"npm test → exit {test.returncode}")
        results.append((test.stdout + test.stderr)[:600])

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
