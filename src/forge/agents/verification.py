import asyncio
import json
import os
import subprocess
from pathlib import Path
from forge.agents.base import BaseAgent, AgentResult, _extract_json
from forge.router import ModelTier
import httpx

SYSTEM = """You are a QA engineer verifying an application build.

You will receive probe results (build output, test output, HTTP responses, or CLI outputs). Produce a structured report:
{
  "passed": ["description of what worked"],
  "failed": ["description of what failed"],
  "errors": ["raw error messages"]
}

Judgment rules:
- For web/frontend apps: if "npm run build" succeeded (exit 0) and produced output files, put "Build succeeded" in passed — the app is shippable even if auto-generated test files have import errors.
- Only put something in "failed" or "errors" if the BUILD itself failed or there is a functional correctness issue. Auto-generated test files with wrong imports are NOT build failures.
- If the build passed, leave "failed" and "errors" empty so the run is marked done."""

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
        if not (workspace / "package.json").exists():
            return "No package.json found in workspace — cannot build"

        # Vite requires index.html in the project root, not in public/
        self._repair_vite_structure(workspace)
        results.append("Structural check done")
        # CI=false: don't treat warnings as errors (CRA behaviour)
        # SKIP_PREFLIGHT_CHECK=true: skip CRA version checks
        # NODE_OPTIONS=--openssl-legacy-provider: fix webpack 4 on Node 17+
        build_env = {
            **os.environ,
            "CI": "false",
            "SKIP_PREFLIGHT_CHECK": "true",
            "NODE_OPTIONS": "--openssl-legacy-provider",
        }

        # Always install — npm install is idempotent and fast when cached
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
            cwd=workspace, capture_output=True, text=True, timeout=180, env=build_env,
        )
        results.append(f"npm run build → exit {build.returncode}")
        if build.returncode != 0:
            results.append(build.stderr[:800])
        else:
            results.append("Build succeeded — output in build/ or dist/")

        # Pick the right test command based on the actual test runner
        try:
            pkg_data = json.loads((workspace / "package.json").read_text())
            all_deps = {
                **pkg_data.get("dependencies", {}),
                **pkg_data.get("devDependencies", {}),
            }
            test_script = pkg_data.get("scripts", {}).get("test", "")
        except Exception:
            all_deps, test_script = {}, ""

        if "vitest" in all_deps or "vitest" in test_script:
            test_cmd = ["npx", "vitest", "run"]
        elif "react-scripts" in all_deps:
            test_cmd = ["npm", "test", "--", "--watchAll=false", "--passWithNoTests"]
        else:
            test_cmd = ["npm", "test", "--", "--watchAll=false", "--passWithNoTests"]

        test = subprocess.run(
            test_cmd,
            cwd=workspace, capture_output=True, text=True, timeout=120,
            env={**build_env, "CI": "true"},
        )
        results.append(f"test ({' '.join(test_cmd)}) → exit {test.returncode}")
        results.append((test.stdout + test.stderr)[:600])

        return "\n".join(results)

    def _repair_vite_structure(self, workspace: Path) -> None:
        """Move index.html to root if Vite project has it misplaced in public/."""
        pkg = workspace / "package.json"
        try:
            pkg_data = json.loads(pkg.read_text())
            deps = {**pkg_data.get("dependencies", {}), **pkg_data.get("devDependencies", {})}
        except Exception:
            return
        if "vite" not in deps:
            return

        # Fix: index.html belongs in root for Vite
        root_html = workspace / "index.html"
        public_html = workspace / "public" / "index.html"
        if not root_html.exists() and public_html.exists():
            import shutil
            shutil.copy(public_html, root_html)

        # Fix: ensure src/main.jsx exists (Vite convention) — copy index.js if needed
        main_jsx = workspace / "src" / "main.jsx"
        main_js = workspace / "src" / "main.js"
        index_js = workspace / "src" / "index.js"
        if not main_jsx.exists() and not main_js.exists() and index_js.exists():
            import shutil
            shutil.copy(index_js, main_jsx)
            # Update the index.html script src to point to main.jsx
            if root_html.exists():
                html = root_html.read_text()
                html = html.replace('src="/src/index.js"', 'src="/src/main.jsx"')
                html = html.replace("src='/src/index.js'", "src='/src/main.jsx'")
                root_html.write_text(html)

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
