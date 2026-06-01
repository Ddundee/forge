import json
import pytest
from unittest.mock import AsyncMock, MagicMock
from forge.agents.architecture import ArchitectureAgent
from forge.router import LLMRouter, CallResult
from forge.db import Database

ARCH_RESPONSE = json.dumps({
    "stack": {"language": "Python", "framework": "FastAPI", "database": "SQLite"},
    "structure": ["src/main.py", "src/models.py", "src/routes/"],
    "deploy_platforms": ["railway"],
    "test_framework": "pytest",
    "verification_method": "api",
})


@pytest.fixture
def db(tmp_path) -> Database:
    d = Database(tmp_path / "t.db")
    d.create_session("idea")
    return d


@pytest.mark.asyncio
async def test_architecture_returns_structured_json(db: Database) -> None:
    router = MagicMock(spec=LLMRouter)
    router.complete = AsyncMock(return_value=CallResult(
        content=ARCH_RESPONSE, model="claude-opus-4-8", tokens_in=10, tokens_out=5, cost_usd=0.0
    ))
    sid = db.list_sessions()[0]["id"]
    agent = ArchitectureAgent(router, db, sid)
    result = await agent.run(spec='{"name":"x","features":["a"]}')
    assert result.success
    data = json.loads(result.output)
    assert "stack" in data
    assert "structure" in data
    assert "test_framework" in data
