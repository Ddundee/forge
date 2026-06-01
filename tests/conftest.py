import pytest
from pathlib import Path


@pytest.fixture
def tmp_path_session(tmp_path: Path) -> Path:
    session_dir = tmp_path / "sessions" / "test01"
    (session_dir / "workspace").mkdir(parents=True)
    (session_dir / "logs").mkdir()
    return session_dir
