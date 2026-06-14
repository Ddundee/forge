/**
 * Creates a fake Claude session manager with mocked send and lifecycle methods for testing.
 *
 * @param text - The text to include in the mock response. Defaults to `"claude code output"`.
 * @returns An object with `sendMock`, a `session` object with mocked send, interrupt, and close methods, and a `manager` object with async main, worker, closeWorker, and closeAll methods.
 */
export function makeFakeClaudeSessions(text = "claude code output") {
  const sendMock = jest.fn().mockResolvedValue({
    text, model: "claude-code", tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0,
  });
  const session = { send: sendMock, interrupt: jest.fn(), close: jest.fn() };
  const manager = {
    main: jest.fn(async () => session),
    worker: jest.fn(async () => session),
    closeWorker: jest.fn(async () => {}),
    closeAll: jest.fn(async () => {}),
  };
  return { sendMock, session, manager: manager as any };
}
