import json
import re
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path

from forge.db import Database
from forge.prompt_log import PromptLogger
from forge.router import CallResult, LLMRouter, ModelTier
from forge.tools.definitions import TOOL_DEFINITIONS
from forge.tools.executor import execute_tool

MAX_TURNS = 40
MAX_TOOL_CALLS = 80


def _extract_json(text: str) -> str:
    """Return the JSON substring from an LLM response.

    Handles three cases in order:
    1. Response is already valid JSON — return as-is.
    2. JSON is wrapped in markdown code fences — strip them.
    3. JSON is embedded in prose — scan for outermost { } or [ ] and
       validate each candidate so inner arrays inside objects are not
       mistaken for the root structure.
    """
    text = text.strip()
    try:
        json.loads(text)
        return text
    except (json.JSONDecodeError, ValueError):
        pass
    m = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if m:
        return m.group(1).strip()
    for start_char, end_char in [("{", "}"), ("[", "]")]:
        s = text.find(start_char)
        e = text.rfind(end_char)
        if s != -1 and e > s:
            candidate = text[s : e + 1]
            try:
                json.loads(candidate)
                return candidate
            except (json.JSONDecodeError, ValueError):
                continue
    return text


@dataclass
class AgentResult:
    success: bool
    output: str
    error: str | None = None


class BaseAgent(ABC):
    tier: ModelTier = ModelTier.STANDARD

    def __init__(self, router: LLMRouter, db: Database, session_id: str) -> None:
        self.router = router
        self.db = db
        self.session_id = session_id
        self._prompt_logger = PromptLogger(session_id)

    @abstractmethod
    async def run(self, **kwargs) -> AgentResult:
        ...

    async def _call(self, messages: list[dict],
                    task_id: str | None = None, **kwargs) -> str:
        result: CallResult = await self.router.complete(self.tier, messages, **kwargs)
        self.db.log_llm_call(
            session_id=self.session_id,
            provider=result.model.split("/")[0],
            model=result.model,
            tokens_in=result.tokens_in,
            tokens_out=result.tokens_out,
            cost_usd=result.cost_usd,
            response=result.content,
            task_id=task_id,
        )
        self._prompt_logger.log(
            agent=type(self).__name__,
            tier=self.tier.value,
            model=result.model,
            messages=messages,
            response=result.content,
            tokens_in=result.tokens_in,
            tokens_out=result.tokens_out,
            cost_usd=result.cost_usd,
        )
        return result.content

    async def _run_agentic_loop(
        self,
        messages: list[dict],
        workspace: Path,
        task_id: str | None = None,
        tools: list[dict] | None = None,
    ) -> str:
        tool_defs = tools if tools is not None else TOOL_DEFINITIONS
        total_tool_calls = 0

        for _ in range(MAX_TURNS):
            result = await self.router.complete_with_tools(self.tier, messages, tool_defs)

            log_response = result.text or f"[{len(result.tool_calls)} tool call(s)]"
            self.db.log_llm_call(
                session_id=self.session_id,
                provider=result.model.split("/")[0],
                model=result.model,
                tokens_in=result.tokens_in,
                tokens_out=result.tokens_out,
                cost_usd=result.cost_usd,
                response=log_response,
                task_id=task_id,
            )

            tools_used = [tc.name for tc in result.tool_calls] if result.tool_calls else None
            self._prompt_logger.log(
                agent=type(self).__name__,
                tier=self.tier.value,
                model=result.model,
                messages=messages,
                response=result.text or "",
                tokens_in=result.tokens_in,
                tokens_out=result.tokens_out,
                cost_usd=result.cost_usd,
                tools_called=tools_used,
            )

            if not result.tool_calls:
                return result.text or ""

            assistant_msg: dict = {
                "role": "assistant",
                "content": result.text or "",
                "tool_calls": [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {
                            "name": tc.name,
                            "arguments": json.dumps(tc.arguments),
                        },
                    }
                    for tc in result.tool_calls
                ],
            }
            messages.append(assistant_msg)

            for tc in result.tool_calls:
                total_tool_calls += 1
                if total_tool_calls > MAX_TOOL_CALLS:
                    tool_result = "ERROR: Tool call limit reached. Stop and report what you have."
                else:
                    tool_result = execute_tool(tc.name, tc.arguments, workspace)

                self.db.log_tool_call(
                    session_id=self.session_id,
                    task_id=task_id,
                    tool_name=tc.name,
                    tool_args=json.dumps(tc.arguments),
                    tool_result=tool_result[:2000],
                )

                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": tool_result,
                })

        messages.append({
            "role": "user",
            "content": "You have reached the turn limit. Summarize what you completed.",
        })
        final = await self.router.complete_with_tools(self.tier, messages, [])
        self.db.log_llm_call(
            session_id=self.session_id,
            provider=final.model.split("/")[0],
            model=final.model,
            tokens_in=final.tokens_in,
            tokens_out=final.tokens_out,
            cost_usd=final.cost_usd,
            response=final.text or "",
            task_id=task_id,
        )
        self._prompt_logger.log(
            agent=type(self).__name__,
            tier=self.tier.value,
            model=final.model,
            messages=messages,
            response=final.text or "",
            tokens_in=final.tokens_in,
            tokens_out=final.tokens_out,
            cost_usd=final.cost_usd,
        )
        return final.text or ""
