import json
from dataclasses import dataclass, field
from enum import Enum
import litellm


class ModelTier(str, Enum):
    OVERSEER = "overseer"
    REASONING = "reasoning"
    STANDARD = "standard"
    FAST = "fast"


DEFAULT_MODELS: dict[ModelTier, str] = {
    ModelTier.OVERSEER: "claude-opus-4-8",
    ModelTier.REASONING: "claude-sonnet-4-6",
    ModelTier.STANDARD: "claude-haiku-4-5-20251001",
    ModelTier.FAST: "gemini/gemini-2.0-flash",
}


@dataclass
class CallResult:
    content: str
    model: str
    tokens_in: int
    tokens_out: int
    cost_usd: float


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: dict[str, object]


@dataclass
class LoopResult:
    text: str | None
    tool_calls: list[ToolCall]
    model: str
    tokens_in: int
    tokens_out: int
    cost_usd: float


class LLMRouter:
    def __init__(self, tier_models: dict[ModelTier, str] | None = None) -> None:
        self._models: dict[ModelTier, str] = {**DEFAULT_MODELS, **(tier_models or {})}

    def model_for(self, tier: ModelTier) -> str:
        return self._models[tier]

    def override(self, tier: ModelTier, model: str) -> None:
        self._models[tier] = model

    async def complete(self, tier: ModelTier, messages: list[dict],
                       **kwargs) -> CallResult:
        model = self._models[tier]
        response = await litellm.acompletion(model=model, messages=messages, **kwargs)
        usage = response.usage
        try:
            cost = litellm.completion_cost(response)
        except Exception:
            cost = 0.0
        return CallResult(
            content=response.choices[0].message.content or "",
            model=model,
            tokens_in=usage.prompt_tokens,
            tokens_out=usage.completion_tokens,
            cost_usd=cost,
        )

    async def complete_with_tools(
        self,
        tier: ModelTier,
        messages: list[dict],
        tools: list[dict],
        **kwargs,
    ) -> LoopResult:
        model = self._models[tier]
        call_kwargs: dict[str, object] = {"model": model, "messages": messages, **kwargs}
        if tools:
            call_kwargs["tools"] = tools
        response = await litellm.acompletion(**call_kwargs)
        usage = response.usage
        try:
            cost = litellm.completion_cost(response)
        except Exception:
            cost = 0.0

        msg = response.choices[0].message
        text: str | None = msg.content or None
        tool_calls: list[ToolCall] = []

        if msg.tool_calls:
            for tc in msg.tool_calls:
                try:
                    args: dict[str, object] = json.loads(tc.function.arguments)
                except Exception:
                    args = {}
                tool_calls.append(ToolCall(
                    id=tc.id,
                    name=tc.function.name,
                    arguments=args,
                ))

        return LoopResult(
            text=text,
            tool_calls=tool_calls,
            model=model,
            tokens_in=usage.prompt_tokens,
            tokens_out=usage.completion_tokens,
            cost_usd=cost,
        )
