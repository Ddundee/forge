import json
from forge.agents.base import BaseAgent, AgentResult, _extract_json
from forge.router import ModelTier

SYSTEM = """You are a senior engineer breaking a product into coding tasks.

Output ONLY a valid JSON array of tasks. Each task:
{
  "title": "imperative title",
  "type": "coding",
  "deps": ["list of titles this depends on"]
}

Rules:
- Each task writes one focused unit (one file or one endpoint group)
- Order deps correctly so parallelism is possible
- No task should be too large; max ~150 lines of code per task"""


class TaskGraphAgent(BaseAgent):
    tier = ModelTier.REASONING

    async def run(self, spec: str, architecture: str, **kwargs) -> AgentResult:  # type: ignore[override]
        messages = [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": f"Spec:\n{spec}\n\nArchitecture:\n{architecture}"},
        ]
        response = await self._call(messages)
        try:
            tasks = json.loads(_extract_json(response))
            return AgentResult(success=True, output=json.dumps(tasks))
        except json.JSONDecodeError:
            return AgentResult(success=False, output=response, error="invalid_json")
