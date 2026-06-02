import pytest
from pathlib import Path
from forge.tools.executor import execute_tool, _is_blocked


@pytest.fixture
def workspace(tmp_path: Path) -> Path:
    return tmp_path


def test_bash_exec_returns_stdout(workspace: Path) -> None:
    result = execute_tool("bash_exec", {"command": "echo hello"}, workspace)
    assert "hello" in result
    assert "[exit 0]" in result


def test_bash_exec_captures_stderr(workspace: Path) -> None:
    result = execute_tool("bash_exec", {"command": "echo err >&2"}, workspace)
    assert "err" in result


def test_bash_exec_nonzero_exit(workspace: Path) -> None:
    result = execute_tool("bash_exec", {"command": "exit 1"}, workspace)
    assert "[exit 1]" in result


def test_bash_exec_blocked_pattern(workspace: Path) -> None:
    result = execute_tool("bash_exec", {"command": "rm -rf /"}, workspace)
    assert result.startswith("ERROR: Command blocked")


def test_bash_exec_empty_command(workspace: Path) -> None:
    result = execute_tool("bash_exec", {"command": ""}, workspace)
    assert result == "ERROR: Empty command"


def test_bash_exec_timeout(workspace: Path) -> None:
    result = execute_tool("bash_exec", {"command": "sleep 10", "timeout": 1}, workspace)
    assert "timed out" in result


def test_read_file_existing(workspace: Path) -> None:
    (workspace / "hello.txt").write_text("world")
    result = execute_tool("read_file", {"path": "hello.txt"}, workspace)
    assert result == "world"


def test_read_file_missing(workspace: Path) -> None:
    result = execute_tool("read_file", {"path": "nope.txt"}, workspace)
    assert "File not found" in result


def test_read_file_path_escape(workspace: Path) -> None:
    result = execute_tool("read_file", {"path": "../../etc/passwd"}, workspace)
    assert "Path escapes workspace" in result


def test_read_file_no_path(workspace: Path) -> None:
    result = execute_tool("read_file", {}, workspace)
    assert "No path provided" in result


def test_write_file_creates_file(workspace: Path) -> None:
    result = execute_tool("write_file", {"path": "out.txt", "content": "data"}, workspace)
    assert "OK" in result
    assert (workspace / "out.txt").read_text() == "data"


def test_write_file_creates_parents(workspace: Path) -> None:
    result = execute_tool("write_file", {"path": "a/b/c.txt", "content": "x"}, workspace)
    assert "OK" in result
    assert (workspace / "a" / "b" / "c.txt").exists()


def test_write_file_path_escape(workspace: Path) -> None:
    result = execute_tool("write_file", {"path": "../../evil.txt", "content": "bad"}, workspace)
    assert "Path escapes workspace" in result


def test_write_file_no_path(workspace: Path) -> None:
    result = execute_tool("write_file", {"content": "data"}, workspace)
    assert "No path provided" in result


def test_list_dir_returns_entries(workspace: Path) -> None:
    (workspace / "file.py").write_text("")
    (workspace / "subdir").mkdir()
    result = execute_tool("list_dir", {"path": "."}, workspace)
    assert "[f] file.py" in result
    assert "[d] subdir" in result


def test_list_dir_empty(workspace: Path) -> None:
    sub = workspace / "empty"
    sub.mkdir()
    result = execute_tool("list_dir", {"path": "empty"}, workspace)
    assert result == "(empty directory)"


def test_list_dir_path_escape(workspace: Path) -> None:
    result = execute_tool("list_dir", {"path": "../../"}, workspace)
    assert "Path escapes workspace" in result


def test_list_dir_not_a_directory(workspace: Path) -> None:
    (workspace / "file.txt").write_text("")
    result = execute_tool("list_dir", {"path": "file.txt"}, workspace)
    assert "Not a directory" in result


def test_execute_tool_unknown_name(workspace: Path) -> None:
    result = execute_tool("nonexistent_tool", {}, workspace)
    assert "Unknown tool" in result


def test_is_blocked_fork_bomb() -> None:
    assert _is_blocked(":(){ :|:& };:")


def test_is_blocked_safe_command() -> None:
    assert not _is_blocked("ls -la")
