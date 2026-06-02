import asyncio
from typing import Optional

import typer
from rich.console import Console
from rich.table import Table

app = typer.Typer(name="forgecli", help="Idea to product in one command.")
console = Console()


@app.command()
def build(
    idea: str = typer.Argument(..., help="What to build"),
    deploy: Optional[str] = typer.Option(None, "--deploy", "-d",
                                          help="Deploy target: vercel, railway, fly.io"),
    max_cycles: int = typer.Option(5, "--max-cycles", help="Max fix iterations"),
) -> None:
    from pathlib import Path
    keys_file = Path.home() / ".forge" / "keys.env"
    if not keys_file.exists():
        console.print("[yellow]No API keys configured.[/yellow] Run [bold]forgecli setup[/bold] first.")
        raise typer.Exit(1)

    from forge.config import load_keys
    load_keys()

    from forge.session import Session
    from forge.overseer import Overseer
    from forge.ui.live_feed import LiveFeed
    from forge.ui.interrupt import InterruptHandler
    from forge.state_machine import Phase

    session = Session.create(idea, deploy_target=deploy)
    console.print(f"[cyan]Session:[/cyan] {session.id}  [dim]~/.forge/sessions/{session.id}[/dim]")

    feed = LiveFeed(session_id=session.id, idea=idea)

    def on_event(message: str) -> None:
        feed.set_overseer(message)
        feed.push_event(session.phase, message)
        feed.cycle = session.cycle
        for task in session.db.get_tasks(session.id):
            feed.update_task(task["id"], task["title"], task["status"], None)
        feed.total_cost = session.db.get_total_cost(session.id)

    async def ask_user(question: str) -> str | None:
        import sys
        if not sys.stdin.isatty():
            return None
        # Stop the interrupt handler first — it holds the terminal in raw mode
        # via tty.setraw(). Prompting while raw mode is active silently drops
        # all keystrokes. The handler's finally block restores the terminal,
        # but we must yield to the event loop so that cancellation propagates
        # before we call typer.prompt().
        handler.stop()
        await asyncio.sleep(0)
        feed.stop()
        answer = typer.prompt(f"\n{question} (Enter to skip)", default="", show_default=False)
        feed.start()
        handler.start()
        return answer or None

    async def on_interrupt(redirect: str) -> None:
        session.db.log_event(session.id, session.phase.value, f"User redirect: {redirect}")

    def session_info() -> None:
        from rich.panel import Panel
        cost = session.db.get_total_cost(session.id)
        console.print(Panel(
            f"[cyan]ID[/cyan]: {session.id}\n"
            f"[cyan]Phase[/cyan]: {session.phase.value}\n"
            f"[cyan]Cycle[/cyan]: {session.cycle}/{session.max_cycles}\n"
            f"[cyan]Cost[/cyan]: [green]${cost:.4f}[/green]",
            title="Session Info",
            border_style="cyan",
        ))

    overseer = Overseer(session, event_callback=on_event)
    handler = InterruptHandler(on_interrupt, on_session_info=session_info)

    async def run() -> None:
        feed.start()
        handler.start()
        try:
            await overseer.run(ask_user=ask_user)
        except KeyboardInterrupt:
            console.print("\n[yellow]Interrupted. Session saved.[/yellow]")
        finally:
            handler.stop()
            feed.stop()

        if session.phase == Phase.DONE:
            console.print(f"\n[green]✓ Done![/green] Workspace: {session.workspace}")
        else:
            console.print(f"\n[red]Stopped at phase: {session.phase.value}[/red]")

    asyncio.run(run())


@app.command()
def setup() -> None:
    from forge.config import run_setup_wizard
    run_setup_wizard()


def _time_ago(iso: str) -> str:
    from datetime import datetime, timezone
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        diff = datetime.now(timezone.utc) - dt
        secs = int(diff.total_seconds())
        if secs < 60: return "just now"
        if secs < 3600: return f"{secs // 60}m ago"
        if secs < 86400: return f"{secs // 3600}h ago"
        return f"{secs // 86400}d ago"
    except Exception:
        return iso[:10]


@app.command()
def sessions() -> None:
    from forge.session import SESSIONS_DIR
    from forge.db import Database

    if not SESSIONS_DIR.exists():
        console.print("No sessions yet.")
        return

    table = Table(title="Forge Sessions")
    table.add_column("ID", style="cyan")
    table.add_column("Idea")
    table.add_column("Status")
    table.add_column("Cycle")
    table.add_column("Cost")
    table.add_column("Created")

    for d in sorted(SESSIONS_DIR.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        db_path = d / "session.db"
        if not db_path.exists():
            continue
        db = Database(db_path)
        for row in db.list_sessions():
            phase = row["phase"]
            if phase == "DONE":
                status_cell = "[green]✓ done[/green]"
            elif phase == "FAILED":
                status_cell = "[red]✗ failed[/red]"
            else:
                status_cell = "[cyan]⟳ " + phase.lower() + "[/cyan]"
            table.add_row(
                row["id"], row["idea"][:50], status_cell,
                str(row["cycle"]), f"${row['total_cost']:.4f}", _time_ago(row["created_at"]),
            )
        db.close()

    console.print(table)


@app.command()
def resume(session_id: Optional[str] = typer.Argument(None)) -> None:
    from forge.config import load_keys
    load_keys()

    from forge.session import Session
    from forge.overseer import Overseer
    from forge.state_machine import Phase

    s = Session.load(session_id) if session_id else Session.load_last()
    cost = s.db.get_total_cost(s.id)
    console.print(f"\n[bold]{s.idea[:60]}[/bold]")
    console.print(f"  Phase: [cyan]{s.phase.value}[/cyan]  Cycle: {s.cycle}/{s.max_cycles}  Cost: [green]${cost:.4f}[/green]\n")
    console.print(f"[cyan]Resuming session:[/cyan] {s.id} ({s.phase.value})")

    overseer = Overseer(s, event_callback=lambda m: console.print(f"  {m}"))

    asyncio.run(overseer.run())


@app.command()
def logs(session_id: Optional[str] = typer.Argument(None)) -> None:
    from forge.session import Session, SESSIONS_DIR
    from forge.db import Database

    if session_id:
        s_id = session_id
        db = Database(SESSIONS_DIR / session_id / "session.db")
    else:
        s = Session.load_last()
        s_id = s.id
        db = s.db

    session_row = db.conn.execute("SELECT * FROM sessions WHERE id = ?", (s_id,)).fetchone()
    if session_row:
        cost = db.get_total_cost(s_id)
        console.print(f"\n[bold cyan]{session_row['id']}[/bold cyan]  {session_row['idea'][:50]}  "
                      f"[dim]{session_row['phase']}[/dim]  [green]${cost:.4f}[/green]\n")

    _phase_colors = {
        "IDEATION": "magenta",
        "ARCHITECTURE": "blue",
        "TASK_GRAPH": "yellow",
        "CODING": "cyan",
        "INTEGRATION": "green",
        "TESTING": "bright_yellow",
        "VERIFICATION": "bright_green",
        "FAILED": "red",
    }

    events = db.conn.execute(
        "SELECT timestamp, phase, message FROM events ORDER BY timestamp"
    ).fetchall()
    for e in events:
        color = _phase_colors.get(e['phase'], "white")
        console.print(f"[dim]{e['timestamp'][:19]}[/dim] [{color}]{e['phase']:14}[/{color}] {e['message']}")


if __name__ == "__main__":
    app()
