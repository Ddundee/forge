from pathlib import Path
from forge.agents.base import BaseAgent, AgentResult
from forge.router import ModelTier

SYSTEM = """You are a senior engineer responsible for wiring a project together after all tasks are coded.

You have tools available:
- bash_exec: run shell commands (build, import checks, linting)
- read_file: read any file in the workspace
- write_file: write or overwrite a file in the workspace
- list_dir: list directory contents

Workflow:
1. Use list_dir to get the project structure
2. Read key entry points and configuration files to find integration issues:
   broken imports, missing wiring, interface mismatches, wrong file paths
3. Fix each issue by writing the corrected file with write_file
4. Run a build or import check after your fixes to confirm they work
5. When everything is wired correctly, stop calling tools and write a brief summary

If nothing needs fixing, say so immediately without calling any tools."""


class IntegrationAgent(BaseAgent):
    tier = ModelTier.REASONING

    async def run(
        self,
        workspace: Path,
        spec: str,
        architecture: str,
    ) -> AgentResult:
        messages: list[dict] = [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": (
                f"Spec:\n{spec}\n\n"
                f"Architecture:\n{architecture}\n\n"
                f"Workspace root: {workspace}"
            )},
        ]
        summary = await self._run_agentic_loop(messages=messages, workspace=workspace)
        return AgentResult(success=True, output=summary or "Integration complete")


def _read_workspace(workspace: Path) -> str:
    parts = []
    for f in sorted(workspace.rglob("*")):
        if f.is_file() and not any(p.startswith(".") for p in f.parts):
            rel = f.relative_to(workspace)
            try:
                parts.append(f"=== {rel} ===\n{f.read_text()}")
            except UnicodeDecodeError:
                parts.append(f"=== {rel} === [binary]")
    return "\n\n".join(parts)
