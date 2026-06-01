import json
from pathlib import Path
from forge.agents.base import BaseAgent, AgentResult, _extract_json
from forge.router import ModelTier

SYSTEM = """You are a senior engineer responsible for wiring a project together.

You will receive the full workspace file tree and contents. Fix any import errors, interface mismatches, missing wiring, or broken connections between modules.

Output ONLY a JSON array of files to overwrite (only files that need changes):
[{"path": "relative/path", "content": "full corrected content"}, ...]

If nothing needs fixing, output an empty array: []"""


class IntegrationAgent(BaseAgent):
    tier = ModelTier.REASONING

    async def run(self, workspace: Path, spec: str,  # type: ignore[override]
                  architecture: str) -> AgentResult:
        tree = _read_workspace(workspace)
        messages = [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": f"Spec:\n{spec}\n\nArchitecture:\n{architecture}\n\nWorkspace:\n{tree}"},
        ]
        response = await self._call(messages)
        try:
            patches: list[dict] = json.loads(_extract_json(response))
        except json.JSONDecodeError:
            return AgentResult(success=False, output=response, error="invalid_json")

        for patch in patches:
            file_path = workspace / patch["path"]
            file_path.parent.mkdir(parents=True, exist_ok=True)
            file_path.write_text(patch["content"])
            self.db.save_artifact(self.session_id, patch["path"], patch["content"])

        return AgentResult(success=True, output=json.dumps(patches))


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
