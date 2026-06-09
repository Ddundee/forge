import { AutoSelector } from "../src/autoSelector.js";

jest.mock("ai", () => ({ generateText: jest.fn() }));
import { generateText } from "ai";
const mockGenerate = generateText as jest.MockedFunction<typeof generateText>;

const MODELS = ["claude-opus-4-8", "claude-sonnet-4-6", "gpt-4o-mini"];

function fakeResponse(text: string) {
  return { text, usage: { promptTokens: 5, completionTokens: 2, totalTokens: 7 }, toolCalls: [] } as any;
}

beforeEach(() => jest.clearAllMocks());

test("returns a valid model from the available list", async () => {
  mockGenerate.mockResolvedValue(fakeResponse("claude-sonnet-4-6"));
  const selector = new AutoSelector("claude-opus-4-8", "quality", MODELS);
  expect(await selector.selectModel("CodingAgent", "")).toBe("claude-sonnet-4-6");
});

test("falls back to first model when LLM returns unknown model ID", async () => {
  mockGenerate.mockResolvedValue(fakeResponse("nonexistent-model-xyz"));
  const selector = new AutoSelector("claude-opus-4-8", "quality", MODELS);
  expect(await selector.selectModel("CodingAgent", "")).toBe(MODELS[0]);
});

test("falls back to first model when generateText throws", async () => {
  mockGenerate.mockRejectedValue(new Error("API error"));
  const selector = new AutoSelector("claude-opus-4-8", "quality", MODELS);
  expect(await selector.selectModel("CodingAgent", "")).toBe(MODELS[0]);
});

test("falls back to overseerModel when availableModels is empty", async () => {
  const selector = new AutoSelector("claude-opus-4-8", "quality", []);
  expect(await selector.selectModel("CodingAgent", "")).toBe("claude-opus-4-8");
});

test("calls logFn with agent name and chosen model", async () => {
  mockGenerate.mockResolvedValue(fakeResponse("gpt-4o-mini"));
  const logFn = jest.fn();
  const selector = new AutoSelector("claude-opus-4-8", "speed", MODELS, logFn);
  await selector.selectModel("ReviewAgent", "");
  expect(logFn).toHaveBeenCalledWith(expect.stringContaining("ReviewAgent"));
  expect(logFn).toHaveBeenCalledWith(expect.stringContaining("gpt-4o-mini"));
});

test("prompt includes priority, agent name, and available models", async () => {
  mockGenerate.mockResolvedValue(fakeResponse(MODELS[0]));
  const selector = new AutoSelector("claude-opus-4-8", "speed", MODELS);
  await selector.selectModel("IdeationAgent", "some context");
  const call = mockGenerate.mock.calls[0][0] as any;
  const prompt = JSON.stringify(call.messages);
  expect(prompt).toContain("speed");
  expect(prompt).toContain("IdeationAgent");
  expect(prompt).toContain("claude-opus-4-8");
  expect(prompt).toContain("gpt-4o-mini");
});

test("prompt includes recent context when provided", async () => {
  mockGenerate.mockResolvedValue(fakeResponse(MODELS[0]));
  const selector = new AutoSelector("claude-opus-4-8", "quality", MODELS);
  await selector.selectModel("CodingAgent", "task: build login page");
  const call = mockGenerate.mock.calls[0][0] as any;
  expect(JSON.stringify(call.messages)).toContain("task: build login page");
});

test("unknown agent name falls back to generic role description without throwing", async () => {
  mockGenerate.mockResolvedValue(fakeResponse(MODELS[0]));
  const selector = new AutoSelector("claude-opus-4-8", "quality", MODELS);
  await expect(selector.selectModel("UnknownAgent", "")).resolves.toBe(MODELS[0]);
});

test("caches the selection per agent and only asks the overseer once", async () => {
  mockGenerate.mockResolvedValue(fakeResponse("claude-sonnet-4-6"));
  const selector = new AutoSelector("claude-opus-4-8", "quality", MODELS);
  await selector.selectModel("CodingAgent", "ctx1");
  await selector.selectModel("CodingAgent", "ctx2");
  expect(mockGenerate).toHaveBeenCalledTimes(1);
  await selector.selectModel("ReviewAgent", "");
  expect(mockGenerate).toHaveBeenCalledTimes(2);
});

test("does not cache the fallback after a failed selection", async () => {
  mockGenerate.mockRejectedValueOnce(new Error("API error"));
  mockGenerate.mockResolvedValueOnce(fakeResponse("claude-sonnet-4-6"));
  const selector = new AutoSelector("claude-opus-4-8", "quality", MODELS);
  expect(await selector.selectModel("CodingAgent", "")).toBe(MODELS[0]);
  expect(await selector.selectModel("CodingAgent", "")).toBe("claude-sonnet-4-6");
  expect(mockGenerate).toHaveBeenCalledTimes(2);
});
