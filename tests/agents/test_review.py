import json
import pytest
from unittest.mock import AsyncMock, MagicMock
from forge.agents.review import ReviewAgent
from forge.router import LLMRouter, CallResult
from forge.db import Database


@pytest.fixture
def db(tmp_path) -> Database:
    d = Database(tmp_path / "t.db")
    d.create_session("idea")
    return d


@pytest.mark.asyncio
async def test_review_returns_structured_feedback(db: Database) -> None:
    review_json = json.dumps({
        "approved": True,
        "issues": [],
        "suggestions": ["Add type hints to function signatures"],
    })
    router = MagicMock(spec=LLMRouter)
    router.complete = AsyncMock(return_value=CallResult(
        content=review_json, model="claude-haiku-4-5-20251001", tokens_in=10, tokens_out=10, cost_usd=0.0
    ))
    sid = db.list_sessions()[0]["id"]
    agent = ReviewAgent(router, db, sid)
    result = await agent.run(task_title="Auth endpoints", diff="+ def login(): pass")
    assert result.success
    data = json.loads(result.output)
    assert data["approved"] is True


@pytest.mark.asyncio
async def test_review_not_approved_has_issues(db: Database) -> None:
    review_json = json.dumps({
        "approved": False,
        "issues": ["Missing error handling on line 5"],
        "suggestions": [],
    })
    router = MagicMock(spec=LLMRouter)
    router.complete = AsyncMock(return_value=CallResult(
        content=review_json, model="claude-haiku-4-5-20251001", tokens_in=10, tokens_out=10, cost_usd=0.0
    ))
    sid = db.list_sessions()[0]["id"]
    agent = ReviewAgent(router, db, sid)
    result = await agent.run(task_title="Auth", diff="+ def login(): pass")
    data = json.loads(result.output)
    assert data["approved"] is False
    assert len(data["issues"]) == 1
