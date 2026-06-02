import json
import pytest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch
from forge.agents.base import BaseAgent, AgentResult, MAX_TOOL_CALLS, MAX_TURNS
from forge.router import LLMRouter, LoopResult, ToolCall
from forge.db import Database


class ConcreteAgent(BaseAgent):
    async def run(self, **kwargs) -> AgentResult:
        return AgentResult(success=True, output="")


def _make_loop_result(
    text: str | None = None,
    tool_calls: list[ToolCall] | None = None,
) -> LoopResult:
    return LoopResult(
        text=text,
        tool_calls=tool_calls or [],
        model="claude-sonnet-4-6",
        tokens_in=10,
        tokens_out=5,
        cost_usd=0.001,
    )


@pytest.fixture
def workspace(tmp_path: Path) -> Path:
    return tmp_path


@pytest.fixture
def db(tmp_path: Path) -> Database:
    return Database(tmp_path / "test.db")


@pytest.fixture
def session_id(db: Database) -> str:
    return db.create_session("test idea")


@pytest.fixture
def agent(db: Database, session_id: str) -> ConcreteAgent:
    router = MagicMock(spec=LLMRouter)
    return ConcreteAgent(router, db, session_id)


@pytest.mark.asyncio
async def test_loop_no_tool_calls_returns_text(
    agent: ConcreteAgent, workspace: Path
) -> None:
    agent.router.complete_with_tools = AsyncMock(  # type: ignore[method-assign]
        return_value=_make_loop_result(text="done")
    )
    messages: list[dict] = [{"role": "user", "content": "go"}]
    result = await agent._run_agentic_loop(messages, workspace)
    assert result == "done"
    agent.router.complete_with_tools.assert_called_once()


@pytest.mark.asyncio
async def test_loop_one_tool_call_then_done(
    agent: ConcreteAgent, workspace: Path, db: Database, session_id: str
) -> None:
    tc = ToolCall(id="c1", name="bash_exec", arguments={"command": "echo hi"})

    agent.router.complete_with_tools = AsyncMock(  # type: ignore[method-assign]
        side_effect=[
            _make_loop_result(tool_calls=[tc]),
            _make_loop_result(text="all done"),
        ]
    )
    messages: list[dict] = [{"role": "user", "content": "go"}]
    result = await agent._run_agentic_loop(messages, workspace)

    assert result == "all done"
    assert agent.router.complete_with_tools.call_count == 2

    tool_rows = db.conn.execute(
        "SELECT * FROM tool_calls WHERE session_id = ?", (session_id,)
    ).fetchall()
    assert len(tool_rows) == 1
    assert tool_rows[0]["tool_name"] == "bash_exec"


@pytest.mark.asyncio
async def test_loop_tool_result_appended_to_messages(
    agent: ConcreteAgent, workspace: Path
) -> None:
    tc = ToolCall(id="c2", name="list_dir", arguments={"path": "."})

    agent.router.complete_with_tools = AsyncMock(  # type: ignore[method-assign]
        side_effect=[
            _make_loop_result(tool_calls=[tc]),
            _make_loop_result(text="done"),
        ]
    )
    messages: list[dict] = [{"role": "user", "content": "go"}]
    await agent._run_agentic_loop(messages, workspace)

    tool_msgs = [m for m in messages if m.get("role") == "tool"]
    assert len(tool_msgs) == 1
    assert tool_msgs[0]["tool_call_id"] == "c2"


@pytest.mark.asyncio
async def test_loop_logs_llm_calls(
    agent: ConcreteAgent, workspace: Path, db: Database, session_id: str
) -> None:
    agent.router.complete_with_tools = AsyncMock(  # type: ignore[method-assign]
        return_value=_make_loop_result(text="done")
    )
    await agent._run_agentic_loop([{"role": "user", "content": "go"}], workspace)

    llm_rows = db.conn.execute(
        "SELECT * FROM llm_calls WHERE session_id = ?", (session_id,)
    ).fetchall()
    assert len(llm_rows) == 1


@pytest.mark.asyncio
async def test_loop_max_tool_calls_returns_error_string(
    agent: ConcreteAgent, workspace: Path
) -> None:
    # Use 3 tool calls per turn so we exceed MAX_TOOL_CALLS within MAX_TURNS.
    # After ceil(MAX_TOOL_CALLS / 3) + 1 turns the error string appears.
    calls_per_turn = 3
    turns_to_exceed = (MAX_TOOL_CALLS // calls_per_turn) + 2

    def make_multi_tc_result(turn: int) -> LoopResult:
        tcs = [
            ToolCall(
                id=f"t{turn}_{i}",
                name="bash_exec",
                arguments={"command": "echo x"},
            )
            for i in range(calls_per_turn)
        ]
        return _make_loop_result(tool_calls=tcs)

    side_effects: list[LoopResult] = (
        [make_multi_tc_result(t) for t in range(turns_to_exceed)]
        + [_make_loop_result(text="finished")]
    )
    agent.router.complete_with_tools = AsyncMock(  # type: ignore[method-assign]
        side_effect=side_effects
    )

    messages: list[dict] = [{"role": "user", "content": "go"}]
    await agent._run_agentic_loop(messages, workspace)

    tool_msgs = [m for m in messages if m.get("role") == "tool"]
    over_limit = [
        m for m in tool_msgs
        if "Tool call limit reached" in m.get("content", "")
    ]
    assert len(over_limit) > 0


@pytest.mark.asyncio
async def test_loop_max_turns_triggers_summary(
    agent: ConcreteAgent, workspace: Path
) -> None:
    tc = ToolCall(id="cx", name="bash_exec", arguments={"command": "echo x"})
    always_tool = _make_loop_result(tool_calls=[tc])
    final_summary = _make_loop_result(text="summary after limit")

    side_effects = [always_tool] * MAX_TURNS + [final_summary]
    agent.router.complete_with_tools = AsyncMock(  # type: ignore[method-assign]
        side_effect=side_effects
    )

    messages: list[dict] = [{"role": "user", "content": "go"}]
    result = await agent._run_agentic_loop(messages, workspace)

    assert result == "summary after limit"
    assert agent.router.complete_with_tools.call_count == MAX_TURNS + 1

    last_user = next(
        (m for m in reversed(messages) if m.get("role") == "user"), None
    )
    assert last_user is not None
    assert "turn limit" in last_user["content"]
