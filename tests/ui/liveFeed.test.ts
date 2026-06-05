import { startLiveFeed } from "../../src/ui/liveFeed.js";

jest.mock("ink", () => ({
  render: jest.fn(() => ({ unmount: jest.fn() })),
  Box: "Box",
  Text: "Text",
  useApp: () => ({ exit: jest.fn() }),
  useInput: jest.fn(),
  useStdout: jest.fn(() => ({ stdout: { columns: 120, rows: 36 } })),
}));
jest.mock("react", () => ({
  createElement: jest.fn(),
  useState: jest.fn(() => [0, jest.fn()]),
  useEffect: jest.fn(),
  useCallback: jest.fn((fn: any) => fn),
}));

test("startLiveFeed returns handle with all methods", () => {
  const handle = startLiveFeed("build a todo app");
  expect(typeof handle.setOverseer).toBe("function");
  expect(typeof handle.updateTask).toBe("function");
  expect(typeof handle.pushEvent).toBe("function");
  expect(typeof handle.setCycle).toBe("function");
  expect(typeof handle.setTotalCost).toBe("function");
  expect(typeof handle.stop).toBe("function");
});

test("pushEvent with kind 'phase' does not throw", () => {
  const handle = startLiveFeed("idea");
  expect(() => handle.pushEvent("CODING", "phase", "Starting phase")).not.toThrow();
});

test("pushEvent with kind 'llm' does not throw", () => {
  const handle = startLiveFeed("idea");
  expect(() => handle.pushEvent("CODING", "llm", "CodingAgent → claude-sonnet-4-6 turn 1")).not.toThrow();
});

test("pushEvent with kind 'cmd' does not throw", () => {
  const handle = startLiveFeed("idea");
  expect(() => handle.pushEvent("CODING", "cmd", "npm run build")).not.toThrow();
});

test("pushEvent with kind 'tool' does not throw", () => {
  const handle = startLiveFeed("idea");
  expect(() => handle.pushEvent("CODING", "tool", "write_file(src/index.ts)")).not.toThrow();
});

test("handle methods do not throw", () => {
  const handle = startLiveFeed("idea");
  expect(() => handle.setOverseer("Starting...")).not.toThrow();
  expect(() => handle.updateTask("t1", "Task one", "in_progress")).not.toThrow();
  expect(() => handle.setCycle(1)).not.toThrow();
  expect(() => handle.setTotalCost(0.05)).not.toThrow();
  expect(() => handle.stop()).not.toThrow();
});
