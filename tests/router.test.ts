import { LLMRouter, ModelTier, DEFAULT_MODELS } from "../src/router.js";

jest.mock("ai", () => ({
  generateText: jest.fn(),
}));

import { generateText } from "ai";
const mockGenerateText = generateText as jest.MockedFunction<typeof generateText>;

beforeEach(() => jest.clearAllMocks());

test("modelFor returns default model for each tier", () => {
  const router = new LLMRouter();
  expect(router.modelFor(ModelTier.OVERSEER)).toBe(DEFAULT_MODELS[ModelTier.OVERSEER]);
  expect(router.modelFor(ModelTier.FAST)).toBe(DEFAULT_MODELS[ModelTier.FAST]);
});

test("override replaces a tier's model", () => {
  const router = new LLMRouter();
  router.override(ModelTier.OVERSEER, "gpt-4o");
  expect(router.modelFor(ModelTier.OVERSEER)).toBe("gpt-4o");
});

test("constructor accepts partial tier overrides", () => {
  const router = new LLMRouter({ [ModelTier.STANDARD]: "gemini/gemini-2.0-flash" });
  expect(router.modelFor(ModelTier.STANDARD)).toBe("gemini/gemini-2.0-flash");
  expect(router.modelFor(ModelTier.OVERSEER)).toBe(DEFAULT_MODELS[ModelTier.OVERSEER]);
});

test("complete returns CallResult with text and token counts", async () => {
  mockGenerateText.mockResolvedValue({
    text: "hello world",
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    toolCalls: [],
  } as any);

  const router = new LLMRouter();
  const result = await router.complete(ModelTier.FAST, [{ role: "user", content: "hi" }]);
  expect(result.content).toBe("hello world");
  expect(result.tokensIn).toBe(10);
  expect(result.tokensOut).toBe(5);
});

test("complete rejects after timeout", async () => {
  mockGenerateText.mockImplementation(() => new Promise(r => setTimeout(r, 10_000)));
  const router = new LLMRouter();
  await expect(
    router.complete(ModelTier.FAST, [{ role: "user", content: "hi" }], 50)
  ).rejects.toThrow("timed out");
}, 1000);

test("completeWithTools normalises toolCalls", async () => {
  mockGenerateText.mockResolvedValue({
    text: null,
    usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
    toolCalls: [{ toolCallId: "tc1", toolName: "bash_exec", args: { command: "ls" } }],
  } as any);

  const router = new LLMRouter();
  const result = await router.completeWithTools(ModelTier.FAST, [], {} as any);
  expect(result.toolCalls).toHaveLength(1);
  expect(result.toolCalls[0]).toEqual({ id: "tc1", name: "bash_exec", arguments: { command: "ls" } });
});

test("hasAutoSelector returns false by default", () => {
  const router = new LLMRouter();
  expect(router.hasAutoSelector()).toBe(false);
});

test("hasAutoSelector returns true after setAutoSelector", () => {
  const router = new LLMRouter();
  router.setAutoSelector({ selectModel: jest.fn() } as any);
  expect(router.hasAutoSelector()).toBe(true);
});

test("selectForAgent delegates to autoSelector.selectModel", async () => {
  const mockSelector = { selectModel: jest.fn().mockResolvedValue("gpt-4o") };
  const router = new LLMRouter();
  router.setAutoSelector(mockSelector as any);
  const result = await router.selectForAgent("CodingAgent", "some context");
  expect(result).toBe("gpt-4o");
  expect(mockSelector.selectModel).toHaveBeenCalledWith("CodingAgent", "some context");
});

test("complete uses modelOverride instead of tier model when provided", async () => {
  mockGenerateText.mockResolvedValue({
    text: "response",
    usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
    toolCalls: [],
  } as any);
  const router = new LLMRouter();
  const result = await router.complete(ModelTier.FAST, [], 120_000, "claude-sonnet-4-6");
  expect(result.model).toBe("claude-sonnet-4-6");
});

test("completeWithTools uses modelOverride when provided", async () => {
  mockGenerateText.mockResolvedValue({
    text: null,
    usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
    toolCalls: [],
  } as any);
  const router = new LLMRouter();
  const result = await router.completeWithTools(ModelTier.FAST, [], {} as any, 120_000, "gpt-4o");
  expect(result.model).toBe("gpt-4o");
});

test("resolveModel throws a clear error if 'codex' model id reaches it", () => {
  const router = new LLMRouter({ [ModelTier.FAST]: "codex" });
  return expect(
    router.complete(ModelTier.FAST, [{ role: "user", content: "hi" }]),
  ).rejects.toThrow('Model id "codex" reached LLMRouter');
});

test("resolveModel throws a clear error if 'claude-code' model id reaches it", () => {
  const router = new LLMRouter({ [ModelTier.FAST]: "claude-code" });
  return expect(
    router.complete(ModelTier.FAST, [{ role: "user", content: "hi" }]),
  ).rejects.toThrow('Model id "claude-code" reached LLMRouter');
});
