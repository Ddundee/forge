import json
import pytest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch
from forge.overseer import Overseer
from forge.session import Session
from forge.state_machine import Phase
from forge.config import ForgeConfig
from forge.db import Database
from forge.router import LLMRouter
from forge.agents.base import AgentResult


def make_session(tmp_path: Path) -> Session:
    db = Database(tmp_path / "session.db")
    db.create_session("build a todo app")
    sid = db.list_sessions()[0]["id"]
    ws = tmp_path / "workspace"
    ws.mkdir()
    (tmp_path / "logs").mkdir()
    router = MagicMock(spec=LLMRouter)
    return Session(
        id=sid, idea="build a todo app", phase=Phase.IDEATION,
        cycle=0, max_cycles=5, deploy_target=None,
        workspace=ws, db=db, router=router, config=ForgeConfig(),
    )


SPEC = json.dumps({
    "name": "todo-app", "description": "A simple todo list",
    "tech_stack": ["Python", "FastAPI"], "features": ["add todo"],
    "out_of_scope": [], "assumptions": [],
})
ARCH = json.dumps({
    "stack": {"language": "Python", "framework": "FastAPI", "database": "SQLite"},
    "structure": ["src/main.py"], "deploy_platforms": ["none"],
    "test_framework": "pytest", "verification_method": "api",
})
TASKS = json.dumps([{"title": "Setup main.py", "type": "coding", "deps": []}])


@pytest.mark.asyncio
async def test_overseer_advances_through_ideation_to_task_graph(tmp_path: Path) -> None:
    session = make_session(tmp_path)
    events = []

    with patch("forge.overseer.IdeationAgent") as MockIdea, \
         patch("forge.overseer.ArchitectureAgent") as MockArch, \
         patch("forge.overseer.TaskGraphAgent") as MockTasks, \
         patch("forge.overseer.CodingAgent") as MockCode:

        MockIdea.return_value.run = AsyncMock(return_value=AgentResult(True, SPEC))
        MockArch.return_value.run = AsyncMock(return_value=AgentResult(True, ARCH))
        MockTasks.return_value.run = AsyncMock(return_value=AgentResult(True, TASKS))
        MockCode.return_value.run = AsyncMock(side_effect=StopIteration("stop"))

        overseer = Overseer(session, event_callback=events.append)
        try:
            await overseer.run()
        except StopIteration:
            pass

    assert any("ARCHITECTURE" in e for e in events)
    assert any("TASK_GRAPH" in e for e in events)


@pytest.mark.asyncio
async def test_overseer_loops_on_verification_failure(tmp_path: Path) -> None:
    session = make_session(tmp_path)
    session.phase = Phase.VERIFICATION
    session.cycle = 0
    session.db.update_session(session.id, spec=SPEC, phase="VERIFICATION")
    session.db.create_task(session.id, "Fix auth", "coding")
    events = []

    call_count = {"n": 0}

    async def verification_run(**kwargs):
        call_count["n"] += 1
        if call_count["n"] < 2:
            return AgentResult(False, json.dumps({"passed": [], "failed": ["broken"], "errors": []}), "verification_failed")
        return AgentResult(True, json.dumps({"passed": ["ok"], "failed": [], "errors": []}))

    with patch("forge.overseer.VerificationAgent") as MockV, \
         patch("forge.overseer.IntegrationAgent") as MockI, \
         patch("forge.overseer.TestAgent") as MockT, \
         patch("forge.overseer.CodingAgent") as MockC, \
         patch("forge.overseer.ReviewAgent") as MockR:

        MockV.return_value.run = verification_run
        MockI.return_value.run = AsyncMock(return_value=AgentResult(True, "[]"))
        MockT.return_value.run = AsyncMock(return_value=AgentResult(True, "1 passed"))
        MockC.return_value.run = AsyncMock(return_value=AgentResult(True, "[]"))
        MockR.return_value.run = AsyncMock(return_value=AgentResult(True, json.dumps({"approved": True, "issues": [], "suggestions": []})))

        overseer = Overseer(session, event_callback=events.append)
        await overseer.run()

    assert session.phase == Phase.DONE
    assert call_count["n"] == 2
