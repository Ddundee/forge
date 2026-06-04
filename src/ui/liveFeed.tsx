import React, { useState, useEffect } from "react";
import { render, Box, Text } from "ink";

interface Task { id: string; title: string; status: string; }

interface LiveFeedState {
  overseerMsg: string;
  tasks: Task[];
  phase: string;
  cycle: number;
  totalCost: number;
  events: { phase: string; message: string; elapsed: number }[];
  startTime: number;
}

const LiveFeedApp: React.FC<{ idea: string; state: { current: LiveFeedState } }> = ({ idea, state }) => {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => forceUpdate(n => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const s = state.current;
  const elapsed = Math.floor((Date.now() - s.startTime) / 1000);

  return (
    <Box flexDirection="column" width={120}>
      <Text bold>{` forge  ●  ${idea.slice(0, 40)}  ●  ${s.phase}  ●  cycle ${s.cycle}/5  ●  $${s.totalCost.toFixed(3)}  ●  ${elapsed}s`}</Text>
      <Box borderStyle="round" borderColor="cyan" marginTop={1}>
        <Text>{s.overseerMsg}</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        {s.tasks.slice(-20).map(t => (
          <Box key={t.id}>
            <Text color={t.status === "completed" ? "green" : t.status === "in_progress" ? "cyan" : "white"}>
              {`${t.status === "completed" ? "[✓]" : t.status === "in_progress" ? "[~]" : "[ ]"} ${t.title}`}
            </Text>
          </Box>
        ))}
      </Box>
      <Text dimColor>{" [i] interrupt   [s] session info   [q] quit & save"}</Text>
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
  const state = {
    current: {
      overseerMsg: "Initializing...",
      tasks: [] as Task[],
      phase: "IDEATION",
      cycle: 0,
      totalCost: 0,
      events: [] as any[],
      startTime,
    }
  };

  const { unmount } = render(<LiveFeedApp idea={idea} state={state} />);

  return {
    setOverseer(message) { state.current = { ...state.current, overseerMsg: message }; },
    updateTask(id, title, status) {
      const tasks = [...state.current.tasks];
      const idx = tasks.findIndex(t => t.id === id);
      if (idx >= 0) tasks[idx] = { id, title, status };
      else tasks.push({ id, title, status });
      state.current = { ...state.current, tasks };
    },
    pushEvent(phase, message) {
      const elapsed = (Date.now() - startTime) / 1000;
      const events = [...state.current.events, { phase, message, elapsed }];
      state.current = { ...state.current, phase, events };
    },
    setCycle(n) { state.current = { ...state.current, cycle: n }; },
    setTotalCost(cost) { state.current = { ...state.current, totalCost: cost }; },
    stop() { unmount(); },
  };
}
