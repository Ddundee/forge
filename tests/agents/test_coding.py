import json
import pytest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock
from forge.agents.coding import CodingAgent
from forge.router import LLMRouter, CallResult
from forge.db import Database


def make_tool_response(path: str, content: str) -> str:
    return json.dumps([{"path": path, "content": content}])


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
    file_writes = make_tool_response("src/main.py", "print('hello')")
    router = MagicMock(spec=LLMRouter)
    router.complete = AsyncMock(return_value=CallResult(
        content=file_writes, model="claude-sonnet-4-6", tokens_in=10, tokens_out=20, cost_usd=0.0
    ))
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
    file_writes = make_tool_response("src/app.py", "# app")
    router = MagicMock(spec=LLMRouter)
    router.complete = AsyncMock(return_value=CallResult(
        content=file_writes, model="claude-sonnet-4-6", tokens_in=10, tokens_out=10, cost_usd=0.0
    ))
    sid = db.list_sessions()[0]["id"]
    agent = CodingAgent(router, db, sid)
    await agent.run(task_title="Write app", spec="{}", architecture="{}", workspace=workspace)
    artifacts = db.conn.execute("SELECT * FROM artifacts").fetchall()
    assert len(artifacts) == 1
    assert artifacts[0]["file_path"] == "src/app.py"
