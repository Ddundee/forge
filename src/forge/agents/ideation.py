import json
from forge.agents.base import BaseAgent, AgentResult, _extract_json
from forge.router import ModelTier

SYSTEM = """You are an expert product architect. Take a raw idea and produce a clear, buildable product spec.

Ask ONE clarifying question at a time (max 3 total). After 3 questions or when you have enough context, output a JSON spec:

{
  "name": "kebab-case-name",
  "description": "one paragraph",
  "tech_stack": ["list"],
  "features": ["list"],
  "out_of_scope": ["list"],
  "assumptions": ["list of assumptions made"]
}

Output ONLY the JSON when producing the spec. Output ONLY the question string when asking."""


class IdeationAgent(BaseAgent):
    tier = ModelTier.OVERSEER

    async def run(self, idea: str,  # type: ignore[override]
                  conversation: list[dict] | None = None) -> AgentResult:
        messages: list[dict] = [{"role": "system", "content": SYSTEM},
                                 {"role": "user", "content": f"Idea: {idea}"}]
        for turn in conversation or []:
            role = "assistant" if turn["role"] == "question" else "user"
            messages.append({"role": role, "content": turn["content"]})

        response = await self._call(messages)
        try:
            spec = json.loads(_extract_json(response))
            return AgentResult(success=True, output=json.dumps(spec))
        except json.JSONDecodeError:
            return AgentResult(success=True, output=response, error="question")
