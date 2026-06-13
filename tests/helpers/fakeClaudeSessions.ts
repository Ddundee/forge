/** Fake ClaudeSessionManager for agent/overseer tests. Cast to `any` at the call site. */
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
