import json
import re
from abc import ABC, abstractmethod
from dataclasses import dataclass

from forge.db import Database
from forge.router import CallResult, LLMRouter, ModelTier


def _extract_json(text: str) -> str:
    """Return the JSON substring from an LLM response.

    Handles three cases in order:
    1. Response is already valid JSON — return as-is.
    2. JSON is wrapped in markdown code fences — strip them.
    3. JSON is embedded in prose — scan for outermost { } or [ ] and
       validate each candidate so inner arrays inside objects are not
       mistaken for the root structure.
    """
    text = text.strip()
    # Fast path: already valid JSON
    try:
        json.loads(text)
        return text
    except (json.JSONDecodeError, ValueError):
        pass
    # Strip markdown code fences
    m = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if m:
        return m.group(1).strip()
    # Scan for outermost structure — try { } before [ ] so object keys
    # don't confuse the array scanner
    for start_char, end_char in [("{", "}"), ("[", "]")]:
        s = text.find(start_char)
        e = text.rfind(end_char)
        if s != -1 and e > s:
            candidate = text[s : e + 1]
            try:
                json.loads(candidate)
                return candidate
            except (json.JSONDecodeError, ValueError):
                continue
    return text


@dataclass
class AgentResult:
    success: bool
    output: str
    error: str | None = None


class BaseAgent(ABC):
    tier: ModelTier = ModelTier.STANDARD

    def __init__(self, router: LLMRouter, db: Database, session_id: str) -> None:
        self.router = router
        self.db = db
        self.session_id = session_id

    @abstractmethod
    async def run(self, **kwargs) -> AgentResult:
        ...

    async def _call(self, messages: list[dict],
                    task_id: str | None = None, **kwargs) -> str:
        result: CallResult = await self.router.complete(self.tier, messages, **kwargs)
        self.db.log_llm_call(
            session_id=self.session_id,
            provider=result.model.split("/")[0],
            model=result.model,
            tokens_in=result.tokens_in,
            tokens_out=result.tokens_out,
            cost_usd=result.cost_usd,
            response=result.content,
            task_id=task_id,
        )
        return result.content
