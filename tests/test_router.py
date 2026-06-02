import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from forge.router import LLMRouter, ModelTier, DEFAULT_MODELS, CallResult, LoopResult, ToolCall


def test_default_model_for_tier() -> None:
    router = LLMRouter()
    assert router.model_for(ModelTier.OVERSEER) == DEFAULT_MODELS[ModelTier.OVERSEER]
    assert router.model_for(ModelTier.FAST) == DEFAULT_MODELS[ModelTier.FAST]


def test_override_tier() -> None:
    router = LLMRouter()
    router.override(ModelTier.OVERSEER, "gpt-4o")
    assert router.model_for(ModelTier.OVERSEER) == "gpt-4o"


def test_custom_tier_models_at_init() -> None:
    router = LLMRouter({ModelTier.STANDARD: "gemini/gemini-2.0-flash"})
    assert router.model_for(ModelTier.STANDARD) == "gemini/gemini-2.0-flash"
    # Other tiers still have defaults
    assert router.model_for(ModelTier.OVERSEER) == DEFAULT_MODELS[ModelTier.OVERSEER]


@pytest.mark.asyncio
async def test_complete_returns_call_result() -> None:
    router = LLMRouter()
    mock_response = MagicMock()
    mock_response.choices = [MagicMock(message=MagicMock(content="hello world"))]
    mock_response.usage = MagicMock(prompt_tokens=10, completion_tokens=5)
    mock_response.model = "claude-opus-4-8"

    with patch("forge.router.litellm.acompletion", new=AsyncMock(return_value=mock_response)):
        with patch("forge.router.litellm.completion_cost", return_value=0.001):
            result = await router.complete(
                ModelTier.OVERSEER, [{"role": "user", "content": "hi"}]
            )

    assert isinstance(result, CallResult)
    assert result.content == "hello world"
    assert result.tokens_in == 10
    assert result.tokens_out == 5
    assert result.cost_usd == pytest.approx(0.001)


def _make_tool_call_mock(tc_id: str, name: str, arguments: str) -> MagicMock:
    tc = MagicMock()
    tc.id = tc_id
    tc.function = MagicMock()
    tc.function.name = name
    tc.function.arguments = arguments
    return tc


def _mock_loop_response(
    content: str | None,
    tool_calls: list[MagicMock] | None = None,
) -> MagicMock:
    mock_response = MagicMock()
    msg = MagicMock()
    msg.content = content
    msg.tool_calls = tool_calls
    mock_response.choices = [MagicMock(message=msg)]
    mock_response.usage = MagicMock(prompt_tokens=10, completion_tokens=5)
    mock_response.model = "claude-sonnet-4-6"
    return mock_response


@pytest.mark.asyncio
async def test_complete_with_tools_no_tool_calls() -> None:
    router = LLMRouter()
    mock_response = _mock_loop_response("final answer", tool_calls=None)

    with patch("forge.router.litellm.acompletion", new=AsyncMock(return_value=mock_response)):
        with patch("forge.router.litellm.completion_cost", return_value=0.001):
            result = await router.complete_with_tools(
                ModelTier.REASONING,
                [{"role": "user", "content": "hi"}],
                [],
            )

    assert isinstance(result, LoopResult)
    assert result.text == "final answer"
    assert result.tool_calls == []


@pytest.mark.asyncio
async def test_complete_with_tools_one_tool_call() -> None:
    router = LLMRouter()
    tc_mock = _make_tool_call_mock("call_1", "bash_exec", '{"command": "ls"}')
    mock_response = _mock_loop_response(None, tool_calls=[tc_mock])

    with patch("forge.router.litellm.acompletion", new=AsyncMock(return_value=mock_response)):
        with patch("forge.router.litellm.completion_cost", return_value=0.0):
            result = await router.complete_with_tools(
                ModelTier.REASONING,
                [{"role": "user", "content": "list files"}],
                [{"type": "function", "function": {"name": "bash_exec"}}],
            )

    assert len(result.tool_calls) == 1
    assert result.tool_calls[0].id == "call_1"
    assert result.tool_calls[0].name == "bash_exec"
    assert result.tool_calls[0].arguments == {"command": "ls"}


@pytest.mark.asyncio
async def test_complete_with_tools_malformed_arguments() -> None:
    router = LLMRouter()
    tc_mock = _make_tool_call_mock("call_2", "read_file", "not-valid-json{{")
    mock_response = _mock_loop_response(None, tool_calls=[tc_mock])

    with patch("forge.router.litellm.acompletion", new=AsyncMock(return_value=mock_response)):
        with patch("forge.router.litellm.completion_cost", return_value=0.0):
            result = await router.complete_with_tools(
                ModelTier.REASONING,
                [{"role": "user", "content": "read"}],
                [],
            )

    assert len(result.tool_calls) == 1
    assert result.tool_calls[0].arguments == {}
