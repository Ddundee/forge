import json
import pytest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch
from forge.session import Session
from forge.overseer import Overseer
from forge.state_machine import Phase
from forge.config import ForgeConfig
from forge.router import LLMRouter
from forge.agents.base import AgentResult

SPEC = json.dumps({
    "name": "hello-cli", "description": "Prints hello",
    "tech_stack": ["Python"], "features": ["print hello"],
    "out_of_scope": [], "assumptions": [],
})
ARCH = json.dumps({
    "stack": {"language": "Python", "framework": "CLI", "database": "none"},
    "structure": ["src/main.py"], "deploy_platforms": ["none"],
    "test_framework": "pytest", "verification_method": "cli",
})
TASKS = json.dumps([{"title": "Write main.py", "type": "coding", "deps": []}])
FILES = json.dumps([{"path": "src/main.py", "content": "print('hello world')"}])
REVIEW_OK = json.dumps({"approved": True, "issues": [], "suggestions": []})
VERIFY_OK = json.dumps({"passed": ["prints hello"], "failed": [], "errors": []})


@pytest.fixture(autouse=True)
def patch_sessions(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("forge.session.SESSIONS_DIR", tmp_path / "sessions")
    monkeypatch.setattr("forge.session.load_config", lambda: ForgeConfig())


@pytest.mark.asyncio
async def test_full_pipeline_reaches_done() -> None:
    session = Session.create("print hello world")

    with patch("forge.overseer.IdeationAgent") as MI, \
         patch("forge.overseer.ArchitectureAgent") as MA, \
         patch("forge.overseer.TaskGraphAgent") as MT, \
         patch("forge.overseer.CodingAgent") as MC, \
         patch("forge.overseer.ReviewAgent") as MR, \
         patch("forge.overseer.IntegrationAgent") as MInteg, \
         patch("forge.overseer.TestAgent") as MTest, \
         patch("forge.overseer.VerificationAgent") as MV:

        MI.return_value.run = AsyncMock(return_value=AgentResult(True, SPEC))
        MA.return_value.run = AsyncMock(return_value=AgentResult(True, ARCH))
        MT.return_value.run = AsyncMock(return_value=AgentResult(True, TASKS))
        MC.return_value.run = AsyncMock(return_value=AgentResult(True, FILES))
        MR.return_value.run = AsyncMock(return_value=AgentResult(True, REVIEW_OK))
        MInteg.return_value.run = AsyncMock(return_value=AgentResult(True, "[]"))
        MTest.return_value.run = AsyncMock(return_value=AgentResult(True, "1 passed"))
        MV.return_value.run = AsyncMock(return_value=AgentResult(True, VERIFY_OK))

        overseer = Overseer(session)
        await overseer.run()

    assert session.phase == Phase.DONE


@pytest.mark.asyncio
async def test_pipeline_iterates_on_failure_then_succeeds() -> None:
    session = Session.create("print hello")

    call_count = {"v": 0}

    async def verification_run(**kwargs):
        call_count["v"] += 1
        if call_count["v"] == 1:
            return AgentResult(False, json.dumps({"passed": [], "failed": ["broken"], "errors": []}), "verification_failed")
        return AgentResult(True, VERIFY_OK)

    with patch("forge.overseer.IdeationAgent") as MI, \
         patch("forge.overseer.ArchitectureAgent") as MA, \
         patch("forge.overseer.TaskGraphAgent") as MT, \
         patch("forge.overseer.CodingAgent") as MC, \
         patch("forge.overseer.ReviewAgent") as MR, \
         patch("forge.overseer.IntegrationAgent") as MInteg, \
         patch("forge.overseer.TestAgent") as MTest, \
         patch("forge.overseer.VerificationAgent") as MV:

        MI.return_value.run = AsyncMock(return_value=AgentResult(True, SPEC))
        MA.return_value.run = AsyncMock(return_value=AgentResult(True, ARCH))
        MT.return_value.run = AsyncMock(return_value=AgentResult(True, TASKS))
        MC.return_value.run = AsyncMock(return_value=AgentResult(True, FILES))
        MR.return_value.run = AsyncMock(return_value=AgentResult(True, REVIEW_OK))
        MInteg.return_value.run = AsyncMock(return_value=AgentResult(True, "[]"))
        MTest.return_value.run = AsyncMock(return_value=AgentResult(True, "1 passed"))
        MV.return_value.run = verification_run

        overseer = Overseer(session)
        await overseer.run()

    assert session.phase == Phase.DONE
    assert call_count["v"] == 2
    assert session.cycle == 1
