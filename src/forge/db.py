import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path


SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    idea TEXT NOT NULL,
    spec TEXT,
    architecture TEXT,
    phase TEXT NOT NULL DEFAULT 'IDEATION',
    cycle INTEGER NOT NULL DEFAULT 0,
    max_cycles INTEGER NOT NULL DEFAULT 5,
    deploy_target TEXT,
    created_at TEXT NOT NULL,
    config_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    title TEXT NOT NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    assigned_model TEXT,
    output TEXT,
    deps_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    completed_at TEXT
);

CREATE TABLE IF NOT EXISTS artifacts (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    file_path TEXT NOT NULL,
    content_snapshot TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS llm_calls (
    id TEXT PRIMARY KEY,
    task_id TEXT REFERENCES tasks(id),
    session_id TEXT NOT NULL REFERENCES sessions(id),
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    tokens_in INTEGER NOT NULL DEFAULT 0,
    tokens_out INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0.0,
    response TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    timestamp TEXT NOT NULL,
    phase TEXT NOT NULL,
    message TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tool_calls (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    task_id TEXT REFERENCES tasks(id),
    tool_name TEXT NOT NULL,
    tool_args TEXT NOT NULL DEFAULT '{}',
    tool_result TEXT,
    created_at TEXT NOT NULL
);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _uid() -> str:
    return str(uuid.uuid4())[:8]


class Database:
    def __init__(self, db_path: Path) -> None:
        self.conn = sqlite3.connect(str(db_path))
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(SCHEMA)
        self.conn.commit()

    def create_session(self, idea: str, config_json: str = "{}") -> str:
        sid = _uid()
        self.conn.execute(
            "INSERT INTO sessions (id, idea, phase, cycle, created_at, config_json) VALUES (?, ?, 'IDEATION', 0, ?, ?)",
            (sid, idea, _now(), config_json),
        )
        self.conn.commit()
        return sid

    def get_session(self, session_id: str) -> sqlite3.Row | None:
        return self.conn.execute(
            "SELECT * FROM sessions WHERE id = ?", (session_id,)
        ).fetchone()

    def update_session(self, session_id: str, **fields) -> None:
        sets = ", ".join(f"{k} = ?" for k in fields)
        self.conn.execute(
            f"UPDATE sessions SET {sets} WHERE id = ?",
            [*fields.values(), session_id],
        )
        self.conn.commit()

    def get_total_cost(self, session_id: str) -> float:
        row = self.conn.execute(
            "SELECT COALESCE(SUM(cost_usd), 0) FROM llm_calls WHERE session_id = ?",
            (session_id,),
        ).fetchone()
        return float(row[0]) if row else 0.0

    def list_sessions(self) -> list[sqlite3.Row]:
        return self.conn.execute(
            "SELECT s.*, COALESCE(SUM(l.cost_usd), 0) as total_cost "
            "FROM sessions s LEFT JOIN llm_calls l ON l.session_id = s.id "
            "GROUP BY s.id ORDER BY s.created_at DESC"
        ).fetchall()

    def create_task(self, session_id: str, title: str, type_: str,
                    deps: list[str] | None = None) -> str:
        tid = _uid()
        self.conn.execute(
            "INSERT INTO tasks (id, session_id, title, type, status, deps_json, created_at) "
            "VALUES (?, ?, ?, ?, 'pending', ?, ?)",
            (tid, session_id, title, type_, json.dumps(deps or []), _now()),
        )
        self.conn.commit()
        return tid

    def update_task(self, task_id: str, **fields) -> None:
        if fields.get("status") == "completed":
            fields["completed_at"] = _now()
        sets = ", ".join(f"{k} = ?" for k in fields)
        self.conn.execute(
            f"UPDATE tasks SET {sets} WHERE id = ?",
            [*fields.values(), task_id],
        )
        self.conn.commit()

    def get_tasks(self, session_id: str, status: str | None = None) -> list[sqlite3.Row]:
        if status:
            return self.conn.execute(
                "SELECT * FROM tasks WHERE session_id = ? AND status = ? ORDER BY created_at",
                (session_id, status),
            ).fetchall()
        return self.conn.execute(
            "SELECT * FROM tasks WHERE session_id = ? ORDER BY created_at",
            (session_id,),
        ).fetchall()

    def log_event(self, session_id: str, phase: str, message: str) -> None:
        self.conn.execute(
            "INSERT INTO events (id, session_id, timestamp, phase, message) VALUES (?, ?, ?, ?, ?)",
            (_uid(), session_id, _now(), phase, message),
        )
        self.conn.commit()

    def log_llm_call(self, session_id: str, provider: str, model: str,
                     tokens_in: int, tokens_out: int, cost_usd: float,
                     response: str, task_id: str | None = None) -> None:
        self.conn.execute(
            "INSERT INTO llm_calls "
            "(id, task_id, session_id, provider, model, tokens_in, tokens_out, cost_usd, response, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (_uid(), task_id, session_id, provider, model,
             tokens_in, tokens_out, cost_usd, response, _now()),
        )
        self.conn.commit()

    def log_tool_call(
        self,
        session_id: str,
        task_id: str | None,
        tool_name: str,
        tool_args: str,
        tool_result: str,
    ) -> None:
        self.conn.execute(
            "INSERT INTO tool_calls "
            "(id, session_id, task_id, tool_name, tool_args, tool_result, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (_uid(), session_id, task_id, tool_name, tool_args, tool_result, _now()),
        )
        self.conn.commit()

    def save_artifact(self, session_id: str, file_path: str, content: str) -> None:
        existing = self.conn.execute(
            "SELECT version FROM artifacts WHERE session_id = ? AND file_path = ? "
            "ORDER BY version DESC LIMIT 1",
            (session_id, file_path),
        ).fetchone()
        version = (existing["version"] + 1) if existing else 1
        self.conn.execute(
            "INSERT INTO artifacts (id, session_id, file_path, content_snapshot, version, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (_uid(), session_id, file_path, content, version, _now()),
        )
        self.conn.commit()

    def close(self) -> None:
        self.conn.close()
