import json
import pytest
from unittest.mock import AsyncMock, MagicMock
from forge.agents.task_graph import TaskGraphAgent
from forge.router import LLMRouter, CallResult
from forge.db import Database

TASKS_RESPONSE = json.dumps([
    {"title": "Setup project structure", "type": "coding", "deps": []},
    {"title": "Database models", "type": "coding", "deps": ["Setup project structure"]},
    {"title": "Auth endpoints", "type": "coding", "deps": ["Database models"]},
])


@pytest.fixture
def db(tmp_path) -> Database:
    d = Database(tmp_path / "t.db")
    d.create_session("idea")
    return d


@pytest.mark.asyncio
async def test_task_graph_returns_list(db: Database) -> None:
    router = MagicMock(spec=LLMRouter)
    router.complete = AsyncMock(return_value=CallResult(
        content=TASKS_RESPONSE, model="claude-sonnet-4-6", tokens_in=10, tokens_out=5, cost_usd=0.0
    ))
    sid = db.list_sessions()[0]["id"]
    agent = TaskGraphAgent(router, db, sid)
    result = await agent.run(spec='{}', architecture='{}')
    assert result.success
    tasks = json.loads(result.output)
    assert len(tasks) == 3
    assert tasks[1]["deps"] == ["Setup project structure"]
