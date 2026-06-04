import { LLMRouter, ModelTier, DEFAULT_MODELS } from "../src-ts/router.js";

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
