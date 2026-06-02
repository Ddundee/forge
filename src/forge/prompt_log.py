import json
import threading
from datetime import datetime, timezone
from pathlib import Path

_SESSIONS_DIR = Path.home() / ".forge" / "sessions"


def log_path(session_id: str) -> Path:
    return _SESSIONS_DIR / session_id / "logs" / "prompts.log"


class PromptLogger:
    def __init__(self, session_id: str) -> None:
        self._file = log_path(session_id)
        self._lock = threading.Lock()
        self._file.parent.mkdir(parents=True, exist_ok=True)

    def log(
        self,
        agent: str,
        tier: str,
        model: str,
        messages: list[dict],
        response: str,
        tokens_in: int,
        tokens_out: int,
        cost_usd: float,
        tools_called: list[str] | None = None,
    ) -> None:
        user_prompt = ""
        for m in reversed(messages):
            if m.get("role") == "user" and isinstance(m.get("content"), str):
                user_prompt = m["content"]
                break

        entry: dict = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "agent": agent,
            "tier": tier,
            "model": model,
            "tokens_in": tokens_in,
            "tokens_out": tokens_out,
            "cost_usd": cost_usd,
            "user_prompt": user_prompt,
            "response": response,
        }
        if tools_called:
            entry["tools_called"] = tools_called

        with self._lock:
            with self._file.open("a") as f:
                f.write(json.dumps(entry) + "\n")
