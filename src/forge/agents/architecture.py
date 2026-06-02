import json
from forge.agents.base import BaseAgent, AgentResult, _extract_json
from forge.router import ModelTier

SYSTEM = """You are a software architect. Given a product spec, choose the ideal tech stack and project structure.

Output ONLY valid JSON:
{
  "stack": {"language": "...", "framework": "...", "database": "...", "extras": []},
  "structure": ["list of key file paths / dirs"],
  "deploy_platforms": ["vercel|railway|fly.io|none"],
  "test_framework": "pytest|vitest|go-test|jest|...",
  "verification_method": "web|api|cli"
}

Important stack guidance:
- For React frontend apps, prefer Vite (framework: "Vite+React") over Create React App — CRA is deprecated and breaks on modern Node.js.
- Vite projects use: npm create vite@latest, test_framework: "vitest", scripts: {"dev": "vite", "build": "vite build", "test": "vitest run"}
- For purely frontend apps set verification_method to "web"."""


class ArchitectureAgent(BaseAgent):
    tier = ModelTier.OVERSEER

    async def run(self, spec: str, **kwargs) -> AgentResult:  # type: ignore[override]
        messages = [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": f"Spec:\n{spec}"},
        ]
        response = await self._call(messages)
        try:
            cleaned = _extract_json(response)
            json.loads(cleaned)
            return AgentResult(success=True, output=cleaned)
        except json.JSONDecodeError:
            return AgentResult(success=False, output=response, error="invalid_json")
