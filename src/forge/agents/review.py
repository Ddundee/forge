import json
from forge.agents.base import BaseAgent, AgentResult
from forge.router import ModelTier

SYSTEM = """You are a code reviewer. Review the diff for a specific task.

Output ONLY valid JSON:
{
  "approved": true|false,
  "issues": ["blocking issue description", ...],
  "suggestions": ["non-blocking improvement", ...]
}

Approve if there are no blocking correctness issues. Flag: missing error handling at boundaries, broken imports, logic bugs, security holes."""


class ReviewAgent(BaseAgent):
    tier = ModelTier.STANDARD

    async def run(self, task_title: str, diff: str, **kwargs) -> AgentResult:  # type: ignore[override]
        messages = [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": f"Task: {task_title}\n\nDiff:\n{diff}"},
        ]
        response = await self._call(messages)
        try:
            json.loads(response)
            return AgentResult(success=True, output=response)
        except json.JSONDecodeError:
            return AgentResult(success=False, output=response, error="invalid_json")
