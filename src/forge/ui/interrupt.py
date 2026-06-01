from __future__ import annotations
import asyncio
import sys
import termios
import tty
from typing import Callable, Awaitable


class InterruptHandler:
    def __init__(self, on_interrupt: Callable[[str], Awaitable[None]]) -> None:
        self._on_interrupt = on_interrupt
        self._task: asyncio.Task | None = None

    def start(self) -> None:
        if not sys.stdin.isatty():
            return
        self._task = asyncio.create_task(self._listen())

    def stop(self) -> None:
        if self._task:
            self._task.cancel()

    async def _listen(self) -> None:
        loop = asyncio.get_event_loop()
        fd = sys.stdin.fileno()
        old = termios.tcgetattr(fd)
        try:
            tty.setraw(fd)
            while True:
                char = await loop.run_in_executor(None, sys.stdin.read, 1)
                if char == "i":
                    termios.tcsetattr(fd, termios.TCSADRAIN, old)
                    redirect = input("\nRedirect (or Enter to skip): ").strip()
                    tty.setraw(fd)
                    if redirect:
                        await self._on_interrupt(redirect)
                elif char in ("q", "Q"):
                    termios.tcsetattr(fd, termios.TCSADRAIN, old)
                    raise KeyboardInterrupt
        finally:
            termios.tcsetattr(fd, termios.TCSADRAIN, old)
