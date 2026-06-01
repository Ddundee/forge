import json
from pathlib import Path
from forge.agents.base import BaseAgent, AgentResult
from forge.router import ModelTier

SYSTEM = """You are a senior software engineer implementing one focused coding task.

Write the files needed for this task. Output ONLY a valid JSON array of file writes:
[
  {"path": "relative/path/from/workspace/root.py", "content": "full file content"},
  ...
]

Rules:
- Write complete, working code — no placeholders, no TODOs
- Each file must be self-contained and importable
- Follow the architecture and stack decisions exactly
- Include all necessary imports"""


class CodingAgent(BaseAgent):
    tier = ModelTier.REASONING

    async def run(self, task_title: str, spec: str, architecture: str,  # type: ignore[override]
                  workspace: Path, context: str = "", task_id: str | None = None) -> AgentResult:
        messages = [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": (
                f"Task: {task_title}\n\nSpec:\n{spec}\n\nArchitecture:\n{architecture}"
                + (f"\n\nContext from prior tasks:\n{context}" if context else "")
            )},
        ]
        response = await self._call(messages, task_id=task_id)
        try:
            file_writes: list[dict] = json.loads(response)
        except json.JSONDecodeError:
            return AgentResult(success=False, output=response, error="invalid_json")

        for fw in file_writes:
            file_path = workspace / fw["path"]
            file_path.parent.mkdir(parents=True, exist_ok=True)
            file_path.write_text(fw["content"])
            self.db.save_artifact(self.session_id, fw["path"], fw["content"])

        return AgentResult(success=True, output=json.dumps(file_writes))
