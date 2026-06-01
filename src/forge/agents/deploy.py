import subprocess
from pathlib import Path
from forge.agents.base import BaseAgent, AgentResult
from forge.router import ModelTier

DEPLOY_CMDS: dict[str, list[str]] = {
    "vercel": ["vercel", "--yes"],
    "railway": ["railway", "up"],
    "fly.io": ["fly", "deploy"],
}


class DeployAgent(BaseAgent):
    tier = ModelTier.STANDARD

    async def run(self, workspace: Path, architecture: str,  # type: ignore[override]
                  target: str) -> AgentResult:
        cmd = DEPLOY_CMDS.get(target)
        if not cmd:
            return AgentResult(success=False, output="", error=f"Unknown deploy target: {target}")

        proc = subprocess.run(cmd, capture_output=True, text=True, cwd=workspace)
        output = proc.stdout + proc.stderr
        success = proc.returncode == 0
        return AgentResult(success=success, output=output,
                           error=None if success else "deploy_failed")
