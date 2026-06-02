import subprocess
from pathlib import Path

_BLOCKED_PATTERNS: list[str] = [
    "rm -rf /",
    "rm -rf ~",
    ":(){ :|:& };:",
    "dd if=/dev/zero",
    "mkfs",
    "> /dev/sda",
    "chmod 777 /",
    "chown -R",
    "sudo rm",
    "sudo dd",
]


def _is_blocked(command: str) -> bool:
    lowered = command.lower()
    return any(pattern in lowered for pattern in _BLOCKED_PATTERNS)


def _bash_exec(args: dict[str, object], workspace: Path) -> str:
    command = str(args.get("command", ""))
    timeout = int(args.get("timeout", 60))

    if not command.strip():
        return "ERROR: Empty command"

    if _is_blocked(command):
        return f"ERROR: Command blocked for safety: {command!r}"

    try:
        result = subprocess.run(
            command,
            shell=True,
            cwd=workspace,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        output = result.stdout
        if result.stderr:
            output += f"\n[stderr]\n{result.stderr}"
        output += f"\n[exit {result.returncode}]"
        if len(output) > 8000:
            output = output[:4000] + "\n... [truncated] ...\n" + output[-4000:]
        return output.strip()
    except subprocess.TimeoutExpired:
        return f"ERROR: Command timed out after {timeout}s"
    except Exception as exc:
        return f"ERROR: {exc}"


def _read_file(args: dict[str, object], workspace: Path) -> str:
    rel_path = str(args.get("path", ""))
    if not rel_path:
        return "ERROR: No path provided"

    target = (workspace / rel_path).resolve()

    try:
        target.relative_to(workspace.resolve())
    except ValueError:
        return f"ERROR: Path escapes workspace: {rel_path}"

    if not target.exists():
        return f"ERROR: File not found: {rel_path}"

    if not target.is_file():
        return f"ERROR: Not a file: {rel_path}"

    try:
        content = target.read_text(encoding="utf-8", errors="replace")
        if len(content) > 16000:
            content = content[:8000] + "\n... [truncated] ...\n" + content[-8000:]
        return content
    except Exception as exc:
        return f"ERROR reading {rel_path}: {exc}"


def _write_file(args: dict[str, object], workspace: Path) -> str:
    rel_path = str(args.get("path", ""))
    content = str(args.get("content", ""))

    if not rel_path:
        return "ERROR: No path provided"

    target = (workspace / rel_path).resolve()

    try:
        target.relative_to(workspace.resolve())
    except ValueError:
        return f"ERROR: Path escapes workspace: {rel_path}"

    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        return f"OK: Wrote {len(content)} chars to {rel_path}"
    except Exception as exc:
        return f"ERROR writing {rel_path}: {exc}"


def _list_dir(args: dict[str, object], workspace: Path) -> str:
    rel_path = str(args.get("path", "."))
    target = (workspace / rel_path).resolve()

    try:
        target.relative_to(workspace.resolve())
    except ValueError:
        return f"ERROR: Path escapes workspace: {rel_path}"

    if not target.exists():
        return f"ERROR: Path not found: {rel_path}"

    if not target.is_dir():
        return f"ERROR: Not a directory: {rel_path}"

    lines = []
    for item in sorted(target.iterdir()):
        prefix = "d" if item.is_dir() else "f"
        lines.append(f"[{prefix}] {item.name}")

    return "\n".join(lines) if lines else "(empty directory)"


def execute_tool(name: str, args: dict[str, object], workspace: Path) -> str:
    if name == "bash_exec":
        return _bash_exec(args, workspace)
    elif name == "read_file":
        return _read_file(args, workspace)
    elif name == "write_file":
        return _write_file(args, workspace)
    elif name == "list_dir":
        return _list_dir(args, workspace)
    else:
        return f"ERROR: Unknown tool '{name}'"
