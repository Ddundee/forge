from pathlib import Path
from forge.agents.base import BaseAgent, AgentResult
from forge.router import ModelTier

SYSTEM = """You are a senior software engineer implementing one focused coding task.

You have tools available:
- bash_exec: run shell commands (build, lint, syntax check, install packages)
- read_file: read any file in the workspace
- write_file: write or overwrite a file in the workspace
- list_dir: list directory contents

Workflow:
1. Use list_dir and read_file to understand the existing codebase and conventions
2. Write the files needed for this task using write_file
3. Run a quick sanity check (e.g. python -c "import <module>" or npx tsc --noEmit) if useful
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
        messages: list[dict] = [
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

        written: list[str] = []
        for f in workspace.rglob("*"):
            if f.is_file() and not any(
                p.startswith(".") for p in f.parts[len(workspace.parts):]
            ):
                rel = str(f.relative_to(workspace))
                try:
                    self.db.save_artifact(self.session_id, rel, f.read_text())
                    written.append(rel)
                except Exception:
                    pass

        return AgentResult(
            success=True,
            output=summary or f"Wrote {len(written)} files",
        )
