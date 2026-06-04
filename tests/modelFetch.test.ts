import { fetchModelsForProvider, fetchAllToolCallModels } from "../src/modelFetch.js";

// Minimal models.dev catalog stub
const MOCK_CATALOG = {
  anthropic: {
    id: "anthropic", name: "Anthropic", npm: "@ai-sdk/anthropic", env: ["ANTHROPIC_API_KEY"],
    models: {
      "claude-opus-4-8": { id: "claude-opus-4-8", name: "Claude Opus 4.8", tool_call: true, cost: { input: 15, output: 75 } },
      "claude-haiku-4-5-20251001": { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5", tool_call: true, cost: { input: 0.8, output: 4 } },
      "claude-embed-001": { id: "claude-embed-001", name: "Claude Embed", tool_call: false },
    },
  },
  openai: {
    id: "openai", name: "OpenAI", npm: "@ai-sdk/openai", env: ["OPENAI_API_KEY"],
    models: {
      "gpt-4o": { id: "gpt-4o", name: "GPT-4o", tool_call: true, cost: { input: 2.5, output: 10 } },
      "gpt-image-1": { id: "gpt-image-1", name: "GPT Image", tool_call: false },
    },
  },
};

global.fetch = jest.fn();

beforeEach(() => {
  (global.fetch as jest.Mock).mockReset();
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: async () => MOCK_CATALOG,
  });
  // Clear disk-cache side-effects by resetting the module's in-memory cache
  jest.resetModules();
});

test("returns only tool_call models for a provider", async () => {
  const { fetchModelsForProvider } = await import("../src/modelFetch.js");
  const models = await fetchModelsForProvider("Anthropic (Claude)");
  expect(models).toContain("claude-opus-4-8");
  expect(models).toContain("claude-haiku-4-5-20251001");
  expect(models.some(m => m.includes("embed"))).toBe(false);
});

test("returns empty array for unknown provider", async () => {
  const { fetchModelsForProvider } = await import("../src/modelFetch.js");
  const models = await fetchModelsForProvider("Unknown Provider");
  expect(models).toEqual([]);
});

test("fetchAllToolCallModels includes name with pricing info", async () => {
  const { fetchAllToolCallModels } = await import("../src/modelFetch.js");
  const all = await fetchAllToolCallModels();
  expect(all.length).toBeGreaterThan(0);
  const claude = all.find(m => m.value === "claude-opus-4-8");
  expect(claude).toBeDefined();
  expect(claude?.name).toMatch(/per M/);
  // non-tool-call models excluded
  expect(all.some(m => m.value === "claude-embed-001")).toBe(false);
  expect(all.some(m => m.value === "gpt-image-1")).toBe(false);
});
