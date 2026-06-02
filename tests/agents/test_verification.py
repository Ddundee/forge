import json
import pytest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock
from forge.agents.verification import VerificationAgent
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
def db(tmp_path: Path) -> Database:
    d = Database(tmp_path / "t.db")
    d.create_session("idea")
    return d


@pytest.mark.asyncio
async def test_verification_success(db: Database, tmp_path: Path) -> None:
    report = json.dumps({"passed": ["Build succeeded"], "failed": [], "errors": []})
    router = MagicMock(spec=LLMRouter)
    router.complete_with_tools = AsyncMock(return_value=_make_loop_result(text=report))
    sid = db.list_sessions()[0]["id"]
    agent = VerificationAgent(router, db, sid)
    result = await agent.run(
        workspace=tmp_path / "workspace",
        architecture='{"verification_method":"web","stack":{"framework":"Vite+React"}}',
        spec='{"features":["sticky notes"]}',
    )
    assert result.success
    data = json.loads(result.output)
    assert len(data["failed"]) == 0


@pytest.mark.asyncio
async def test_verification_fails_when_report_has_failures(db: Database, tmp_path: Path) -> None:
    report = json.dumps({"passed": [], "failed": ["Build failed"], "errors": ["exit code 1"]})
    router = MagicMock(spec=LLMRouter)
    router.complete_with_tools = AsyncMock(return_value=_make_loop_result(text=report))
    sid = db.list_sessions()[0]["id"]
    agent = VerificationAgent(router, db, sid)
    result = await agent.run(
        workspace=tmp_path / "workspace",
        architecture='{"verification_method":"api","stack":{"framework":"FastAPI"}}',
        spec='{}',
    )
    assert not result.success
    assert result.error == "verification_failed"


@pytest.mark.asyncio
async def test_verification_malformed_report(db: Database, tmp_path: Path) -> None:
    router = MagicMock(spec=LLMRouter)
    router.complete_with_tools = AsyncMock(
        return_value=_make_loop_result(text="the build totally worked great")
    )
    sid = db.list_sessions()[0]["id"]
    agent = VerificationAgent(router, db, sid)
    result = await agent.run(
        workspace=tmp_path / "workspace",
        architecture="{}",
        spec="{}",
    )
    assert not result.success
    data = json.loads(result.output)
    assert len(data["failed"]) > 0
