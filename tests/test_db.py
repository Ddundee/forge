import pytest
from pathlib import Path
from forge.db import Database


@pytest.fixture
def db(tmp_path: Path) -> Database:
    return Database(tmp_path / "test.db")


def test_create_and_get_session(db: Database) -> None:
    sid = db.create_session("build a todo app")
    row = db.get_session(sid)
    assert row is not None
    assert row["idea"] == "build a todo app"
    assert row["phase"] == "IDEATION"
    assert row["cycle"] == 0


def test_update_session(db: Database) -> None:
    sid = db.create_session("idea")
    db.update_session(sid, phase="ARCHITECTURE", cycle=1)
    row = db.get_session(sid)
    assert row["phase"] == "ARCHITECTURE"
    assert row["cycle"] == 1


def test_create_and_get_tasks(db: Database) -> None:
    sid = db.create_session("idea")
    tid = db.create_task(sid, "Setup project", "coding")
    tasks = db.get_tasks(sid)
    assert len(tasks) == 1
    assert tasks[0]["title"] == "Setup project"
    assert tasks[0]["status"] == "pending"


def test_update_task_completed(db: Database) -> None:
    sid = db.create_session("idea")
    tid = db.create_task(sid, "Write auth", "coding")
    db.update_task(tid, status="completed", output="done")
    tasks = db.get_tasks(sid, status="completed")
    assert len(tasks) == 1
    assert tasks[0]["completed_at"] is not None


def test_log_event(db: Database) -> None:
    sid = db.create_session("idea")
    db.log_event(sid, "IDEATION", "Starting ideation")
    events = db.conn.execute("SELECT * FROM events WHERE session_id = ?", (sid,)).fetchall()
    assert len(events) == 1
    assert events[0]["message"] == "Starting ideation"


def test_log_llm_call(db: Database) -> None:
    sid = db.create_session("idea")
    db.log_llm_call(sid, "anthropic", "claude-opus-4-8", 100, 50, 0.003, "response text")
    calls = db.conn.execute("SELECT * FROM llm_calls WHERE session_id = ?", (sid,)).fetchall()
    assert calls[0]["cost_usd"] == pytest.approx(0.003)


def test_list_sessions_with_cost(db: Database) -> None:
    sid = db.create_session("idea")
    db.log_llm_call(sid, "anthropic", "claude-opus-4-8", 100, 50, 0.005, "r")
    rows = db.list_sessions()
    assert len(rows) == 1
    assert rows[0]["total_cost"] == pytest.approx(0.005)


def test_save_artifact_versioned(db: Database) -> None:
    sid = db.create_session("idea")
    db.save_artifact(sid, "src/main.py", "v1 content")
    db.save_artifact(sid, "src/main.py", "v2 content")
    rows = db.conn.execute(
        "SELECT version FROM artifacts WHERE session_id = ? ORDER BY version",
        (sid,),
    ).fetchall()
    assert [r["version"] for r in rows] == [1, 2]
