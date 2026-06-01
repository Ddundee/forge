import json
import pytest
from unittest.mock import AsyncMock, MagicMock
from forge.agents.ideation import IdeationAgent
from forge.agents.base import AgentResult
from forge.router import LLMRouter, CallResult
from forge.db import Database


@pytest.fixture
def db(tmp_path) -> Database:
    d = Database(tmp_path / "t.db")
    d.create_session("test idea")
    return d


def make_router(content: str) -> LLMRouter:
    r = MagicMock(spec=LLMRouter)
    r.complete = AsyncMock(return_value=CallResult(
        content=content, model="claude-opus-4-8", tokens_in=10, tokens_out=5, cost_usd=0.0
    ))
    return r


@pytest.mark.asyncio
async def test_returns_question_when_not_json(db: Database) -> None:
    router = make_router("Is this a single-user or multi-user app?")
    agent = IdeationAgent(router, db, db.list_sessions()[0]["id"])
    result = await agent.run(idea="build a todo app")
    assert result.error == "question"
    assert "single-user" in result.output


@pytest.mark.asyncio
async def test_returns_spec_when_json(db: Database) -> None:
    spec = {
        "name": "todo-app",
        "description": "A simple todo list",
        "tech_stack": ["Python", "FastAPI"],
        "features": ["add todo", "delete todo"],
        "out_of_scope": [],
        "assumptions": [],
    }
    router = make_router(json.dumps(spec))
    agent = IdeationAgent(router, db, db.list_sessions()[0]["id"])
    result = await agent.run(idea="build a todo app")
    assert result.error is None
    assert json.loads(result.output)["name"] == "todo-app"


@pytest.mark.asyncio
async def test_conversation_passed_to_llm(db: Database) -> None:
    spec = {"name": "x", "description": "d", "tech_stack": [], "features": [], "out_of_scope": [], "assumptions": []}
    router = make_router(json.dumps(spec))
    sid = db.list_sessions()[0]["id"]
    agent = IdeationAgent(router, db, sid)
    conversation = [
        {"role": "question", "content": "Single-user?"},
        {"role": "answer", "content": "Yes, single-user"},
    ]
    await agent.run(idea="build a todo app", conversation=conversation)
    call_args = router.complete.call_args
    messages = call_args[0][1]
    user_messages = [m["content"] for m in messages if m["role"] == "user"]
    assert any("Single-user" in m or "Yes, single-user" in m for m in user_messages)
