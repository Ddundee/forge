import pytest
from pathlib import Path
from forge.session import Session
from forge.state_machine import Phase


@pytest.fixture(autouse=True)
def patch_sessions_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("forge.session.SESSIONS_DIR", tmp_path / "sessions")


@pytest.fixture(autouse=True)
def patch_config(monkeypatch: pytest.MonkeyPatch) -> None:
    from forge.config import ForgeConfig
    monkeypatch.setattr("forge.session.load_config", lambda: ForgeConfig())


def test_create_session_makes_dirs(tmp_path: Path) -> None:
    s = Session.create("build a todo app")
    assert s.workspace.exists()
    assert (s.workspace.parent / "logs").exists()


def test_create_session_persists_to_db() -> None:
    s = Session.create("build a todo app")
    row = s.db.get_session(s.id)
    assert row["idea"] == "build a todo app"
    assert row["phase"] == "IDEATION"


def test_load_session() -> None:
    s1 = Session.create("build a chat app")
    s2 = Session.load(s1.id)
    assert s2.idea == "build a chat app"
    assert s2.phase == Phase.IDEATION


def test_load_nonexistent_raises() -> None:
    with pytest.raises(FileNotFoundError):
        Session.load("notexist")


def test_advance_phase() -> None:
    s = Session.create("idea")
    s.advance_phase(Phase.ARCHITECTURE)
    assert s.phase == Phase.ARCHITECTURE
    row = s.db.get_session(s.id)
    assert row["phase"] == "ARCHITECTURE"


def test_advance_invalid_phase_raises() -> None:
    from forge.state_machine import InvalidTransitionError
    s = Session.create("idea")
    with pytest.raises(InvalidTransitionError):
        s.advance_phase(Phase.DONE)


def test_load_last_returns_most_recent(tmp_path: Path) -> None:
    import time
    s1 = Session.create("first")
    time.sleep(0.01)
    s2 = Session.create("second")
    last = Session.load_last()
    assert last.id == s2.id
