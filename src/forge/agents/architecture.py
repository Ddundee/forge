import json
from forge.agents.base import BaseAgent, AgentResult
from forge.router import ModelTier

SYSTEM = """You are a software architect. Given a product spec, choose the ideal tech stack and project structure.

Output ONLY valid JSON:
{
  "stack": {"language": "...", "framework": "...", "database": "...", "extras": []},
  "structure": ["list of key file paths / dirs"],
  "deploy_platforms": ["vercel|railway|fly.io|none"],
  "test_framework": "pytest|vitest|go-test|jest|...",
  "verification_method": "web|api|cli"
}"""


class ArchitectureAgent(BaseAgent):
    tier = ModelTier.OVERSEER

    async def run(self, spec: str, **kwargs) -> AgentResult:  # type: ignore[override]
        messages = [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": f"Spec:\n{spec}"},
        ]
        response = await self._call(messages)
        try:
            json.loads(response)
            return AgentResult(success=True, output=response)
        except json.JSONDecodeError:
            return AgentResult(success=False, output=response, error="invalid_json")
