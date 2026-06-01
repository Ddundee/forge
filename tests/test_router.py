import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from forge.router import LLMRouter, ModelTier, DEFAULT_MODELS, CallResult


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
