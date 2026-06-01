import json
import pytest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch
from forge.agents.verification import VerificationAgent
from forge.router import LLMRouter, CallResult
from forge.db import Database


@pytest.fixture
def db(tmp_path: Path) -> Database:
    d = Database(tmp_path / "t.db")
    d.create_session("idea")
    return d


@pytest.mark.asyncio
async def test_api_verification_success(db: Database, tmp_path: Path) -> None:
    report = json.dumps({"passed": ["GET /health returns 200"], "failed": [], "errors": []})
    router = MagicMock(spec=LLMRouter)
    router.complete = AsyncMock(return_value=CallResult(
        content=report, model="claude-sonnet-4-6", tokens_in=10, tokens_out=10, cost_usd=0.0
    ))
    sid = db.list_sessions()[0]["id"]
    agent = VerificationAgent(router, db, sid)

    mock_proc = MagicMock(returncode=0)
    with patch("forge.agents.verification.subprocess.Popen", return_value=mock_proc):
        with patch("forge.agents.verification.asyncio.sleep", new=AsyncMock()):
            with patch("forge.agents.verification.httpx.AsyncClient") as mock_client:
                mock_client.return_value.__aenter__ = AsyncMock(return_value=mock_client.return_value)
                mock_client.return_value.__aexit__ = AsyncMock(return_value=False)
                mock_client.return_value.get = AsyncMock(return_value=MagicMock(status_code=200, text="ok"))
                result = await agent.run(
                    workspace=tmp_path / "workspace",
                    architecture='{"verification_method":"api","stack":{"framework":"FastAPI"}}',
                    spec='{"features":["health check"]}',
                )

    assert result.success
    data = json.loads(result.output)
    assert len(data["failed"]) == 0


@pytest.mark.asyncio
async def test_verification_fails_when_report_has_failures(db: Database, tmp_path: Path) -> None:
    report = json.dumps({"passed": [], "failed": ["App crashed on startup"], "errors": ["exit code 1"]})
    router = MagicMock(spec=LLMRouter)
    router.complete = AsyncMock(return_value=CallResult(
        content=report, model="claude-sonnet-4-6", tokens_in=10, tokens_out=10, cost_usd=0.0,
    ))
    sid = db.list_sessions()[0]["id"]
    agent = VerificationAgent(router, db, sid)

    mock_proc = MagicMock(returncode=1)
    with patch("forge.agents.verification.subprocess.Popen", return_value=mock_proc):
        with patch("forge.agents.verification.asyncio.sleep", new=AsyncMock()):
            with patch("forge.agents.verification.httpx.AsyncClient") as mock_client:
                mock_client.return_value.__aenter__ = AsyncMock(return_value=mock_client.return_value)
                mock_client.return_value.__aexit__ = AsyncMock(return_value=False)
                mock_client.return_value.get = AsyncMock(side_effect=Exception("connection refused"))
                result = await agent.run(
                    workspace=tmp_path / "workspace",
                    architecture='{"verification_method":"api","stack":{"framework":"FastAPI"}}',
                    spec='{}',
                )

    assert not result.success
    assert result.error == "verification_failed"
