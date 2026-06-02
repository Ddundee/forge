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
- Correct Vite+React project structure (MUST follow exactly):
  - index.html in the PROJECT ROOT (NOT in public/) with <script type="module" src="/src/main.jsx"></script>
  - src/main.jsx as the React entry point (NOT src/index.js)
  - src/App.jsx for the root component
  - vite.config.js at root with @vitejs/plugin-react plugin
  - package.json scripts: {"dev": "vite", "build": "vite build", "preview": "vite preview", "test": "vitest run"}
  - devDependencies: vite, @vitejs/plugin-react, vitest, @vitest/ui, jsdom, @testing-library/react, @testing-library/jest-dom
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
