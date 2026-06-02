from __future__ import annotations
import threading
import time
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

PHASE_PIPELINE = [
    "IDEATION",
    "ARCHITECTURE",
    "TASK_GRAPH",
    "CODING",
    "INTEGRATION",
    "TESTING",
    "VERIFICATION",
]


@dataclass
class LiveFeed:
    session_id: str
    idea: str
    events: list[dict] = field(default_factory=list)
    tasks: dict[str, dict] = field(default_factory=dict)
    overseer_message: str = "Initializing..."
    current_phase: str = "IDEATION"
    cycle: int = 0
    total_cost: float = 0.0
    _start_time: float = field(default_factory=time.monotonic, repr=False)
    _live: Live | None = field(default=None, repr=False)
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def push_event(self, phase: Phase, message: str) -> None:
        with self._lock:
            self.current_phase = phase.value
            elapsed = time.monotonic() - self._start_time
            self.events.append({"phase": phase.value, "message": message, "elapsed": elapsed})
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

    def _build_phase_bar(self) -> Text:
        try:
            current_index = PHASE_PIPELINE.index(self.current_phase)
        except ValueError:
            current_index = 0

        bar = Text()
        for i, phase_name in enumerate(PHASE_PIPELINE):
            if i > 0:
                bar.append(" → ", style="dim")
            if i < current_index:
                bar.append(f"{phase_name} ✓", style="dim green")
            elif i == current_index:
                bar.append(f"[{phase_name}]", style="bold cyan")
            else:
                bar.append(phase_name, style="dim")
        return bar

    def _render(self) -> Layout:
        layout = Layout()
        layout.split_column(
            Layout(name="header", size=1),
            Layout(name="phase_bar", size=2),
            Layout(name="overseer", size=3),
            Layout(name="body"),
            Layout(name="footer", size=1),
        )

        # Header
        short_idea = self.idea[:40] + ("..." if len(self.idea) > 40 else "")
        elapsed = time.monotonic() - self._start_time
        mins = int(elapsed) // 60
        secs = int(elapsed) % 60
        elapsed_str = f"{mins}:{secs:02d}"
        cost_str = f"${self.total_cost:.3f}"
        layout["header"].update(
            Text(
                f" forge  ●  {short_idea}  ●  {self.current_phase}  ●  cycle {self.cycle}/5  ●  {elapsed_str}  ●  {cost_str}",
                style="bold",
            )
        )

        # Phase bar
        layout["phase_bar"].update(
            Panel(self._build_phase_bar(), border_style="dim", padding=(0, 1))
        )

        # Overseer panel
        layout["overseer"].update(
            Panel(self.overseer_message, title="Overseer", border_style="cyan")
        )

        # Body: 2 columns
        layout["body"].split_row(
            Layout(name="tasks", ratio=6),
            Layout(name="events", ratio=4),
        )

        # Tasks panel (left column)
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

        # Events panel (right column)
        events_table = Table.grid(padding=(0, 1))
        events_table.add_column()
        recent_events = self.events[-10:]
        for ev in recent_events:
            ev_elapsed = ev.get("elapsed", 0.0)
            ev_mins = int(ev_elapsed) // 60
            ev_secs = int(ev_elapsed) % 60
            phase_str = ev["phase"]
            msg = ev["message"][:35]
            line = f"{ev_mins}:{ev_secs:02d}  {phase_str:12}  {msg}"
            events_table.add_row(Text(line, style="dim"))
        layout["events"].update(Panel(events_table, title="Events"))

        # Footer
        layout["footer"].update(
            Text(" [i] interrupt   [s] session info   [q] quit & save", style="dim")
        )
        return layout

    def start(self) -> "LiveFeed":
        self._start_time = time.monotonic()
        self._live = Live(self._render(), refresh_per_second=4, screen=True)
        self._live.start()
        return self

    def stop(self) -> None:
        if self._live:
            self._live.stop()
            self._live = None
