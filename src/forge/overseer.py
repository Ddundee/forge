import asyncio
import json
from pathlib import Path
from typing import Callable, Awaitable

from forge.agents.architecture import ArchitectureAgent
from forge.agents.coding import CodingAgent
from forge.agents.deploy import DeployAgent
from forge.agents.ideation import IdeationAgent
from forge.agents.integration import IntegrationAgent
from forge.agents.review import ReviewAgent
from forge.agents.task_graph import TaskGraphAgent
from forge.agents.test_agent import TestAgent
from forge.agents.verification import VerificationAgent
from forge.session import Session
from forge.state_machine import Phase


AskUser = Callable[[str], Awaitable[str | None]]


class Overseer:
    def __init__(self, session: Session,
                 event_callback: Callable[[str], None] | None = None) -> None:
        self.session = session
        self._emit = event_callback or (lambda _: None)
        # Flag set by _coding() when a RuntimeError wrapping StopIteration is
        # caught from a task (e.g. a test sentinel).  run() checks it and returns
        # early instead of trying to re-raise (PEP 479 would wrap StopIteration
        # back to RuntimeError if raised from inside an async frame).
        self._stop_requested: bool = False

    def emit(self, message: str) -> None:
        self.session.db.log_event(self.session.id, self.session.phase.value, message)
        self._emit(message)

    async def run(self, ask_user: AskUser | None = None) -> None:
        while self.session.phase not in (Phase.DONE, Phase.FAILED):
            await self._run_phase(ask_user)
            if self._stop_requested:
                # A phase (e.g. _coding) caught a RuntimeError wrapping
                # StopIteration and set this flag.  We return here rather than
                # re-raising because PEP 479 would wrap StopIteration into
                # RuntimeError again if raised from inside an async frame.
                self._stop_requested = False
                return

    async def _run_phase(self, ask_user: AskUser | None) -> None:
        p = self.session.phase
        self.emit(f"Starting phase: {p.value}")
        if p == Phase.IDEATION:
            await self._ideation(ask_user)
        elif p == Phase.ARCHITECTURE:
            await self._architecture()
        elif p == Phase.TASK_GRAPH:
            await self._task_graph()
        elif p == Phase.CODING:
            await self._coding()
        elif p == Phase.INTEGRATION:
            await self._integration()
        elif p == Phase.TESTING:
            await self._testing()
        elif p == Phase.VERIFICATION:
            await self._verification()
        elif p == Phase.DEPLOY:
            await self._deploy()

    def _agent(self, cls):
        return cls(self.session.router, self.session.db, self.session.id)

    def _spec(self) -> str:
        row = self.session.db.get_session(self.session.id)
        return row["spec"] or "{}"

    def _arch(self) -> str:
        row = self.session.db.get_session(self.session.id)
        return row["architecture"] or "{}"

    async def _ideation(self, ask_user: AskUser | None) -> None:
        agent = self._agent(IdeationAgent)
        conversation: list[dict] = []
        for _ in range(4):
            result = await agent.run(idea=self.session.idea, conversation=conversation)
            if result.error == "question":
                answer = (await ask_user(result.output)) if ask_user else "skip"
                conversation += [
                    {"role": "question", "content": result.output},
                    {"role": "answer", "content": answer or "skip"},
                ]
            else:
                self.session.db.update_session(self.session.id, spec=result.output)
                self.emit(f"Spec: {json.loads(result.output).get('name', 'unnamed')}")
                self.session.advance_phase(Phase.ARCHITECTURE)
                return
        self.session.advance_phase(Phase.ARCHITECTURE)

    async def _architecture(self) -> None:
        result = await self._agent(ArchitectureAgent).run(spec=self._spec())
        if result.success:
            self.session.db.update_session(self.session.id, architecture=result.output)
            self.emit("Architecture decided")
        self.session.advance_phase(Phase.TASK_GRAPH)

    async def _task_graph(self) -> None:
        result = await self._agent(TaskGraphAgent).run(
            spec=self._spec(), architecture=self._arch()
        )
        if result.success:
            tasks = json.loads(result.output)
            for t in tasks:
                self.session.db.create_task(self.session.id, t["title"], t["type"], t.get("deps"))
            self.emit(f"Task graph: {len(tasks)} tasks")
        self.session.advance_phase(Phase.CODING)

    async def _coding(self) -> None:
        pending = self.session.db.get_tasks(self.session.id, status="pending")
        if not pending:
            self.session.advance_phase(Phase.INTEGRATION)
            return
        try:
            await asyncio.gather(*[self._code_task(t) for t in pending])
        except RuntimeError as exc:
            # PEP 479: StopIteration raised inside a coroutine is converted to
            # RuntimeError.  Store the original exception so run() can re-raise
            # it via _sync_raise() (a plain function frame), which bypasses the
            # wrapping and lets callers catch the original StopIteration.
            if isinstance(exc.__cause__, StopIteration):
                self._stop_requested = True
                return  # don't advance phase; run() will exit cleanly
            raise
        self.session.advance_phase(Phase.INTEGRATION)

    async def _code_task(self, task) -> None:
        self.emit(f"Coding: {task['title']}")
        self.session.db.update_task(task["id"], status="in_progress")
        result = await self._agent(CodingAgent).run(
            task_title=task["title"], spec=self._spec(),
            architecture=self._arch(), workspace=self.session.workspace,
            task_id=task["id"],
        )
        status = "completed" if result.success else "failed"
        self.session.db.update_task(task["id"], status=status, output=result.output)

        review = await self._agent(ReviewAgent).run(
            task_title=task["title"], diff=result.output
        )
        if review.success:
            rv = json.loads(review.output)
            if not rv.get("approved") and rv.get("issues"):
                self.emit(f"Review issues for '{task['title']}': {rv['issues']}")

    async def _integration(self) -> None:
        result = await self._agent(IntegrationAgent).run(
            workspace=self.session.workspace, spec=self._spec(), architecture=self._arch()
        )
        self.emit(f"Integration: {len(json.loads(result.output)) if result.success else 0} patches")
        self.session.advance_phase(Phase.TESTING)

    async def _testing(self) -> None:
        result = await self._agent(TestAgent).run(
            workspace=self.session.workspace, architecture=self._arch()
        )
        self.emit(f"Tests: {'passed' if result.success else 'failed'}")
        self.session.advance_phase(Phase.VERIFICATION)

    async def _verification(self) -> None:
        result = await self._agent(VerificationAgent).run(
            workspace=self.session.workspace,
            architecture=self._arch(),
            spec=self._spec(),
        )
        if result.success:
            next_phase = Phase.DEPLOY if self.session.deploy_target else Phase.DONE
            self.session.advance_phase(next_phase)
            self.emit("Verification passed")
        else:
            if self.session.cycle >= self.session.max_cycles:
                self.emit(f"Max cycles ({self.session.max_cycles}) reached. Build incomplete.")
                self.session.db.update_session(self.session.id, phase=Phase.FAILED.value)
                self.session.phase = Phase.FAILED
                return
            self.session.increment_cycle()
            try:
                report = json.loads(result.output)
            except (json.JSONDecodeError, ValueError):
                report = {"failed": [result.output[:200]], "errors": []}
            for failure in report.get("failed", []):
                self.session.db.create_task(
                    self.session.id, f"Fix: {failure}", "coding"
                )
            self.emit(f"Verification failed. Cycle {self.session.cycle}/{self.session.max_cycles}")
            self.session.advance_phase(Phase.CODING)

    async def _deploy(self) -> None:
        result = await self._agent(DeployAgent).run(
            workspace=self.session.workspace,
            architecture=self._arch(),
            target=self.session.deploy_target or "none",
        )
        self.emit(f"Deploy: {'success' if result.success else 'failed'} — {result.output[:100]}")
        self.session.advance_phase(Phase.DONE)
