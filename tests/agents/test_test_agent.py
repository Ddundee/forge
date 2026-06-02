import pytest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock
from forge.agents.test_agent import TestAgent
from forge.router import LLMRouter, LoopResult, ToolCall
from forge.db import Database


def _make_loop_result(
    text: str | None = None,
    tool_calls: list[ToolCall] | None = None,
) -> LoopResult:
    return LoopResult(
        text=text,
        tool_calls=tool_calls or [],
        model="claude-sonnet-4-6",
        tokens_in=10,
        tokens_out=20,
        cost_usd=0.0,
    )


@pytest.fixture
def workspace(tmp_path: Path) -> Path:
    ws = tmp_path / "workspace"
    (ws / "src").mkdir(parents=True)
    (ws / "src" / "main.py").write_text("def add(a, b): return a + b")
    return ws


@pytest.fixture
def db(tmp_path: Path) -> Database:
    d = Database(tmp_path / "t.db")
    d.create_session("idea")
    return d


@pytest.mark.asyncio
async def test_test_agent_success_from_summary(db: Database, workspace: Path) -> None:
    router = MagicMock(spec=LLMRouter)
    router.complete_with_tools = AsyncMock(
        return_value=_make_loop_result(text="All tests passed. 1 passed in 0.1s")
    )
    sid = db.list_sessions()[0]["id"]
    agent = TestAgent(router, db, sid)
    result = await agent.run(workspace=workspace, architecture='{"test_framework":"pytest"}')
    assert result.success
    assert "passed" in result.output


@pytest.mark.asyncio
async def test_test_agent_failure_from_summary(db: Database, workspace: Path) -> None:
    router = MagicMock(spec=LLMRouter)
    router.complete_with_tools = AsyncMock(
        return_value=_make_loop_result(text="Tests failed: 1 error in test_main.py")
    )
    sid = db.list_sessions()[0]["id"]
    agent = TestAgent(router, db, sid)
    result = await agent.run(workspace=workspace, architecture='{"test_framework":"pytest"}')
    assert not result.success
    assert result.error == "tests_failed"
