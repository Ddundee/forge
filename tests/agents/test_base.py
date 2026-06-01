import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock
from forge.agents.base import BaseAgent, AgentResult
from forge.router import LLMRouter, ModelTier, CallResult
from forge.db import Database


class ConcreteAgent(BaseAgent):
    async def run(self, **kwargs) -> AgentResult:
        content = await self._call([{"role": "user", "content": "hello"}])
        return AgentResult(success=True, output=content)


@pytest.fixture
def router() -> LLMRouter:
    r = MagicMock(spec=LLMRouter)
    r.complete = AsyncMock(return_value=CallResult(
        content="test response", model="claude-opus-4-8",
        tokens_in=10, tokens_out=5, cost_usd=0.001,
    ))
    return r


@pytest.fixture
def db(tmp_path) -> Database:
    return Database(tmp_path / "test.db")


@pytest.fixture
def session_id(db: Database) -> str:
    return db.create_session("test idea")


def test_agent_call_returns_content(router, db, session_id) -> None:
    agent = ConcreteAgent(router, db, session_id)
    result = asyncio.run(agent.run())
    assert result.success
    assert result.output == "test response"


def test_agent_call_logs_llm_call(router, db, session_id) -> None:
    agent = ConcreteAgent(router, db, session_id)
    asyncio.run(agent.run())
    calls = db.conn.execute("SELECT * FROM llm_calls").fetchall()
    assert len(calls) == 1
    assert calls[0]["cost_usd"] == pytest.approx(0.001)
