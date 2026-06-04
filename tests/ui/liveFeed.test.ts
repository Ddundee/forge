import { startLiveFeed } from "../../src-ts/ui/liveFeed.js";

// ink renders to a virtual terminal — mock render to avoid tty dependency
jest.mock("ink", () => ({
  render: jest.fn(() => ({ unmount: jest.fn() })),
  Box: "Box",
  Text: "Text",
  useApp: () => ({ exit: jest.fn() }),
  useInput: jest.fn(),
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

test("handle methods do not throw", () => {
  const handle = startLiveFeed("idea");
  expect(() => handle.setOverseer("Starting...")).not.toThrow();
  expect(() => handle.updateTask("t1", "Task one", "in_progress")).not.toThrow();
  expect(() => handle.pushEvent("CODING", "Coding task")).not.toThrow();
  expect(() => handle.setCycle(1)).not.toThrow();
  expect(() => handle.setTotalCost(0.05)).not.toThrow();
  expect(() => handle.stop()).not.toThrow();
});
