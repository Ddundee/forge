from __future__ import annotations
import asyncio
import sys
import termios
import tty
from typing import Callable, Awaitable


class InterruptHandler:
    def __init__(self, on_interrupt: Callable[[str], Awaitable[None]],
                 on_session_info: Callable[[], None] | None = None) -> None:
        self._on_interrupt = on_interrupt
        self._on_session_info = on_session_info
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
                elif char == "s":
                    termios.tcsetattr(fd, termios.TCSADRAIN, old)
                    if self._on_session_info:
                        self._on_session_info()
                    input("\nPress Enter to continue...")
                    tty.setraw(fd)
                elif char in ("q", "Q"):
                    termios.tcsetattr(fd, termios.TCSADRAIN, old)
                    confirm = input("\nSave and quit? [y/N]: ").strip().lower()
                    if confirm == "y":
                        raise KeyboardInterrupt
                    else:
                        tty.setraw(fd)
        finally:
            termios.tcsetattr(fd, termios.TCSADRAIN, old)
