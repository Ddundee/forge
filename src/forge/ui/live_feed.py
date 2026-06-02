from __future__ import annotations
import threading
from dataclasses import dataclass, field

from rich.console import Console
from rich.layout import Layout
from rich.live import Live
from rich.panel import Panel
from rich.table import Table
from rich.text import Text

from forge.state_machine import Phase

STATUS_ICONS = {
    "pending": "[ ]",
    "in_progress": "[~]",
    "completed": "[✓]",
    "failed": "[✗]",
}
STATUS_STYLES = {
    "pending": "dim",
    "in_progress": "cyan",
    "completed": "green",
    "failed": "red",
}


@dataclass
class LiveFeed:
    session_id: str
    idea: str
    events: list[dict] = field(default_factory=list)
    tasks: dict[str, dict] = field(default_factory=dict)
    overseer_message: str = "Initializing..."
    current_phase: str = "IDEATION"
    cycle: int = 0
    _live: Live | None = field(default=None, repr=False)
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def push_event(self, phase: Phase, message: str) -> None:
        with self._lock:
            self.current_phase = phase.value
            self.events.append({"phase": phase.value, "message": message})
            if self._live:
                self._live.update(self._render())

    def update_task(self, task_id: str, title: str, status: str,
                    agent: str | None) -> None:
        with self._lock:
            self.tasks[task_id] = {"title": title, "status": status, "agent": agent or "—"}
            if self._live:
                self._live.update(self._render())

    def set_overseer(self, message: str) -> None:
        with self._lock:
            self.overseer_message = message
            if self._live:
                self._live.update(self._render())

    def _render(self) -> Layout:
        layout = Layout()
        layout.split_column(
            Layout(name="header", size=1),
            Layout(name="overseer", size=3),
            Layout(name="tasks"),
            Layout(name="footer", size=1),
        )
        short_idea = self.idea[:40] + ("..." if len(self.idea) > 40 else "")
        layout["header"].update(
            Text(
                f" forge  ●  {short_idea}  ●  {self.current_phase}  ●  cycle {self.cycle}",
                style="bold",
            )
        )
        layout["overseer"].update(
            Panel(self.overseer_message, title="Overseer", border_style="cyan")
        )
        table = Table.grid(padding=(0, 1))
        table.add_column(width=4)
        table.add_column(width=40)
        table.add_column(width=16)
        table.add_column()
        for t in list(self.tasks.values())[-20:]:
            icon = STATUS_ICONS.get(t["status"], "[ ]")
            style = STATUS_STYLES.get(t["status"], "")
            table.add_row(icon, t["title"], t["agent"], t["status"], style=style)
        layout["tasks"].update(Panel(table, title="Tasks"))
        layout["footer"].update(
            Text(" [i] interrupt   [r] resume (after interrupt)   [s] session info   [q] quit & save", style="dim")
        )
        return layout

    def start(self) -> "LiveFeed":
        self._live = Live(self._render(), refresh_per_second=4, screen=True)
        self._live.start()
        return self

    def stop(self) -> None:
        if self._live:
            self._live.stop()
            self._live = None
