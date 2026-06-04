import React, { useState, useEffect } from "react";
import { render, Box, Text, useStdout } from "ink";

interface Task { id: string; title: string; status: string; }
interface LogLine { ts: number; phase: string; text: string; }

interface FeedRef {
  idea: string;
  overseerMsg: string;
  tasks: Task[];
  logs: LogLine[];
  phase: string;
  cycle: number;
  cost: number;
  startTime: number;
}

const PHASE_COLOR: Record<string, string> = {
  IDEATION: "magenta", ARCHITECTURE: "blue", TASK_GRAPH: "yellow",
  CODING: "cyan", INTEGRATION: "green", TESTING: "yellowBright",
  VERIFICATION: "greenBright", DEPLOY: "blue", DONE: "green", FAILED: "red",
};

function fmtElapsed(secs: number) {
  const m = Math.floor(secs / 60).toString().padStart(2, "0");
  const s = Math.floor(secs % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function taskIcon(status: string) {
  if (status === "completed") return "✓";
  if (status === "in_progress") return "▶";
  return "○";
}

function taskColor(status: string): string {
  if (status === "completed") return "green";
  if (status === "in_progress") return "cyan";
  return "white";
}

const TUI: React.FC<{ r: FeedRef }> = ({ r }) => {
  const [, tick] = useState(0);
  const { stdout } = useStdout();

  useEffect(() => {
    const t = setInterval(() => tick(n => n + 1), 300);
    return () => clearInterval(t);
  }, []);

  const cols = stdout?.columns ?? 120;
  const rows = stdout?.rows ?? 36;
  const elapsed = (Date.now() - r.startTime) / 1000;

  // Fixed row budget
  const HEADER = 1;
  const DIVIDER = 1;
  const OVERSEER = 3; // border top + text + border bottom
  const KEYS = 1;
  const contentRows = Math.max(6, rows - HEADER - DIVIDER - OVERSEER - KEYS);

  // Column split: 40% tasks, 60% logs
  const leftW = Math.floor(cols * 0.40);
  const rightW = cols - leftW - 1; // -1 for divider

  // How many items fit (minus pane header row)
  const taskSlots = contentRows - 1;
  const logSlots = contentRows - 1;

  const visibleTasks = r.tasks.slice(-taskSlots);
  const visibleLogs = r.logs.slice(-logSlots);

  const phaseColor = (PHASE_COLOR[r.phase] ?? "white") as any;
  const done = r.tasks.filter(t => t.status === "completed").length;
  const total = r.tasks.length;

  return (
    <Box flexDirection="column" width={cols}>

      {/* ── Header ── */}
      <Box width={cols}>
        <Text bold color="cyan"> forge </Text>
        <Text color="dim">│ </Text>
        <Text>{r.idea.length > 32 ? r.idea.slice(0, 31) + "…" : r.idea} </Text>
        <Text color="dim">│ </Text>
        <Text bold color={phaseColor}>{r.phase} </Text>
        <Text color="dim">│ </Text>
        <Text>cycle {r.cycle}/5 </Text>
        <Text color="dim">│ </Text>
        <Text color="green">${r.cost.toFixed(4)} </Text>
        <Text color="dim">│ </Text>
        <Text color="dim">{fmtElapsed(elapsed)}</Text>
      </Box>

      {/* ── Divider ── */}
      <Text color="dim">{"─".repeat(cols)}</Text>

      {/* ── Main panes ── */}
      <Box flexDirection="row" height={contentRows}>

        {/* Left: Tasks */}
        <Box flexDirection="column" width={leftW}>
          <Text bold color="cyan">{" "}Tasks {total > 0 ? `${done}/${total}` : ""}</Text>
          {visibleTasks.map(t => {
            const maxLen = leftW - 4;
            const label = t.title.length > maxLen ? t.title.slice(0, maxLen - 1) + "…" : t.title;
            return (
              <Text key={t.id} color={taskColor(t.status) as any}>
                {" "}{taskIcon(t.status)} {label}
              </Text>
            );
          })}
        </Box>

        {/* Vertical divider */}
        <Box flexDirection="column" width={1}>
          {Array.from({ length: contentRows }).map((_, i) => (
            <Text key={i} color="dim">│</Text>
          ))}
        </Box>

        {/* Right: Logs */}
        <Box flexDirection="column" width={rightW}>
          <Text bold color="yellow">{" "}Logs</Text>
          {visibleLogs.map((l, i) => {
            const maxText = rightW - 20;
            const text = l.text.length > maxText ? l.text.slice(0, maxText - 1) + "…" : l.text;
            const pc = (PHASE_COLOR[l.phase] ?? "white") as any;
            return (
              <Box key={i}>
                <Text color="dim"> {fmtElapsed(l.ts)} </Text>
                <Text color={pc}>{l.phase.slice(0, 7).padEnd(7, " ")} </Text>
                <Text>{text}</Text>
              </Box>
            );
          })}
        </Box>
      </Box>

      {/* ── Overseer message ── */}
      <Box borderStyle="round" borderColor="cyan" width={cols}>
        <Text bold color="cyan">▶ </Text>
        <Text>{r.overseerMsg.length > cols - 8 ? r.overseerMsg.slice(0, cols - 9) + "…" : r.overseerMsg}</Text>
      </Box>

      {/* ── Keybindings ── */}
      <Text color="dim">{"  [i] interrupt   [s] session info   [q] quit & save"}</Text>

    </Box>
  );
};

export interface LiveFeedHandle {
  setOverseer(message: string): void;
  updateTask(id: string, title: string, status: string): void;
  pushEvent(phase: string, message: string): void;
  setCycle(n: number): void;
  setTotalCost(cost: number): void;
  stop(): void;
}

export function startLiveFeed(idea: string): LiveFeedHandle {
  const startTime = Date.now();

  const r: FeedRef = {
    idea, overseerMsg: "Initializing…",
    tasks: [], logs: [],
    phase: "IDEATION", cycle: 0, cost: 0, startTime,
  };

  // Switch to alternate screen buffer so the TUI doesn't scroll the shell history
  if (process.stdout.isTTY) process.stdout.write("\x1b[?1049h\x1b[2J\x1b[H");

  const { unmount } = render(<TUI r={r} />, { exitOnCtrlC: false, stdout: process.stdout });

  return {
    setOverseer(msg) { r.overseerMsg = msg; },

    updateTask(id, title, status) {
      const idx = r.tasks.findIndex(t => t.id === id);
      if (idx >= 0) r.tasks = r.tasks.map((t, i) => i === idx ? { id, title, status } : t);
      else r.tasks = [...r.tasks, { id, title, status }];
    },

    pushEvent(phase, message) {
      r.phase = phase;
      r.logs = [...r.logs, { ts: (Date.now() - startTime) / 1000, phase, text: message }];
    },

    setCycle(n) { r.cycle = n; },
    setTotalCost(cost) { r.cost = cost; },

    stop() {
      unmount();
      if (process.stdout.isTTY) process.stdout.write("\x1b[?1049l");
    },
  };
}
