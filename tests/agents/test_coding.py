import pytest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock
from forge.agents.coding import CodingAgent
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


def _write_tc(call_id: str, path: str, content: str) -> ToolCall:
    return ToolCall(
        id=call_id,
        name="write_file",
        arguments={"path": path, "content": content},
    )


@pytest.fixture
def workspace(tmp_path: Path) -> Path:
    ws = tmp_path / "workspace"
    ws.mkdir()
    return ws


@pytest.fixture
def db(tmp_path: Path) -> Database:
    d = Database(tmp_path / "t.db")
    d.create_session("idea")
    return d


@pytest.mark.asyncio
async def test_coding_agent_writes_files(db: Database, workspace: Path) -> None:
    router = MagicMock(spec=LLMRouter)
    router.complete_with_tools = AsyncMock(
        side_effect=[
            _make_loop_result(tool_calls=[_write_tc("c1", "src/main.py", "print('hello')")]),
            _make_loop_result(text="Wrote src/main.py"),
        ]
    )
    sid = db.list_sessions()[0]["id"]
    agent = CodingAgent(router, db, sid)
    result = await agent.run(
        task_title="Write main entry point",
        spec="{}",
        architecture="{}",
        workspace=workspace,
    )
    assert result.success
    assert (workspace / "src" / "main.py").exists()
    assert (workspace / "src" / "main.py").read_text() == "print('hello')"


@pytest.mark.asyncio
async def test_coding_agent_saves_artifact(db: Database, workspace: Path) -> None:
    router = MagicMock(spec=LLMRouter)
    router.complete_with_tools = AsyncMock(
        side_effect=[
            _make_loop_result(tool_calls=[_write_tc("c2", "src/app.py", "# app")]),
            _make_loop_result(text="Done"),
        ]
    )
    sid = db.list_sessions()[0]["id"]
    agent = CodingAgent(router, db, sid)
    await agent.run(task_title="Write app", spec="{}", architecture="{}", workspace=workspace)
    artifacts = db.conn.execute("SELECT * FROM artifacts").fetchall()
    assert len(artifacts) == 1
    assert artifacts[0]["file_path"] == "src/app.py"
