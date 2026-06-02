import pytest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock
from forge.agents.integration import IntegrationAgent
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
        tokens_out=10,
        cost_usd=0.0,
    )


@pytest.fixture
def workspace(tmp_path: Path) -> Path:
    ws = tmp_path / "workspace"
    (ws / "src").mkdir(parents=True)
    (ws / "src" / "main.py").write_text("from src.auth import login")
    (ws / "src" / "auth.py").write_text("def login(): pass")
    return ws


@pytest.fixture
def db(tmp_path: Path) -> Database:
    d = Database(tmp_path / "t.db")
    d.create_session("idea")
    return d


@pytest.mark.asyncio
async def test_integration_applies_patches(db: Database, workspace: Path) -> None:
    write_tc = ToolCall(
        id="c1",
        name="write_file",
        arguments={"path": "src/main.py", "content": "from src.auth import login\nlogin()"},
    )
    router = MagicMock(spec=LLMRouter)
    router.complete_with_tools = AsyncMock(
        side_effect=[
            _make_loop_result(tool_calls=[write_tc]),
            _make_loop_result(text="Fixed import wiring"),
        ]
    )
    sid = db.list_sessions()[0]["id"]
    agent = IntegrationAgent(router, db, sid)
    result = await agent.run(workspace=workspace, spec="{}", architecture="{}")
    assert result.success
    assert "login()" in (workspace / "src" / "main.py").read_text()
