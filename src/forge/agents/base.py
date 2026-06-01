from abc import ABC, abstractmethod
from dataclasses import dataclass

from forge.db import Database
from forge.router import CallResult, LLMRouter, ModelTier


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
