import json
import pytest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch
from forge.agents.test_agent import TestAgent
from forge.router import LLMRouter, CallResult
from forge.db import Database


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
async def test_test_agent_writes_tests_and_runs(db: Database, workspace: Path) -> None:
    test_code = "def test_add():\n    from src.main import add\n    assert add(1, 2) == 3"
    test_files = json.dumps([{"path": "tests/test_main.py", "content": test_code}])
    router = MagicMock(spec=LLMRouter)
    router.complete = AsyncMock(return_value=CallResult(
        content=test_files, model="claude-sonnet-4-6", tokens_in=10, tokens_out=20, cost_usd=0.0
    ))
    sid = db.list_sessions()[0]["id"]
    agent = TestAgent(router, db, sid)

    mock_result = MagicMock(returncode=0, stdout="1 passed", stderr="")
    with patch("forge.agents.test_agent.subprocess.run", return_value=mock_result):
        result = await agent.run(workspace=workspace, architecture='{"test_framework":"pytest"}')

    assert result.success
    assert "passed" in result.output
