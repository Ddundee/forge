import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from forge.config import ForgeConfig, load_config
from forge.db import Database
from forge.router import LLMRouter
from forge.state_machine import Phase, transition

SESSIONS_DIR = Path.home() / ".forge" / "sessions"


@dataclass
class Session:
    id: str
    idea: str
    phase: Phase
    cycle: int
    max_cycles: int
    deploy_target: str | None
    workspace: Path
    db: Database
    router: LLMRouter
    config: ForgeConfig

    @classmethod
    def create(cls, idea: str, deploy_target: str | None = None) -> "Session":
        sid = str(uuid.uuid4())[:8]
        session_dir = SESSIONS_DIR / sid
        (session_dir / "workspace").mkdir(parents=True)
        (session_dir / "logs").mkdir()
        cfg = load_config()
        db = Database(session_dir / "session.db")
        # Use the sid we created, not the one db.create_session returns
        now = datetime.now(timezone.utc).isoformat()
        db.conn.execute(
            "INSERT INTO sessions (id, idea, phase, cycle, created_at, config_json) VALUES (?, ?, 'IDEATION', 0, ?, ?)",
            (sid, idea, now, "{}"),
        )
        db.conn.commit()
        if deploy_target:
            db.update_session(sid, deploy_target=deploy_target)
        return cls(
            id=sid, idea=idea, phase=Phase.IDEATION,
            cycle=0, max_cycles=cfg.max_cycles, deploy_target=deploy_target,
            workspace=session_dir / "workspace",
            db=db, router=LLMRouter(cfg.tier_models()), config=cfg,
        )

    @classmethod
    def load(cls, session_id: str) -> "Session":
        session_dir = SESSIONS_DIR / session_id
        if not session_dir.exists():
            raise FileNotFoundError(f"Session {session_id!r} not found")
        cfg = load_config()
        db = Database(session_dir / "session.db")
        row = db.get_session(session_id)
        if row is None:
            raise ValueError(f"Session {session_id!r} not in database")
        return cls(
            id=session_id, idea=row["idea"], phase=Phase(row["phase"]),
            cycle=row["cycle"], max_cycles=row["max_cycles"],
            deploy_target=row["deploy_target"],
            workspace=session_dir / "workspace",
            db=db, router=LLMRouter(cfg.tier_models()), config=cfg,
        )

    @classmethod
    def load_last(cls) -> "Session":
        if not SESSIONS_DIR.exists():
            raise FileNotFoundError("No sessions found")
        dirs = sorted(SESSIONS_DIR.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True)
        if not dirs:
            raise FileNotFoundError("No sessions found")
        return cls.load(dirs[0].name)

    def advance_phase(self, next_phase: Phase) -> None:
        transition(self.phase, next_phase)
        self.phase = next_phase
        self.db.update_session(self.id, phase=next_phase.value)

    def increment_cycle(self) -> None:
        self.cycle += 1
        self.db.update_session(self.id, cycle=self.cycle)
