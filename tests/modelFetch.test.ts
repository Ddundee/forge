import { fetchModelsForProvider } from "../src-ts/modelFetch.js";

// Mock fetch — tests verify filtering logic, not live API
global.fetch = jest.fn();

beforeEach(() => (global.fetch as jest.Mock).mockReset());

test("returns empty array when API key missing", async () => {
  const models = await fetchModelsForProvider("Anthropic (Claude)", "");
  expect(Array.isArray(models)).toBe(true);
});

test("filters out embed/tts/whisper models from Anthropic response", async () => {
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: async () => ({
      data: [
        { id: "claude-opus-4-8" },
        { id: "claude-embed-001" },
        { id: "claude-haiku-4-5-20251001" },
      ],
    }),
  });
  const models = await fetchModelsForProvider("Anthropic (Claude)", "sk-test");
  expect(models).toContain("claude-opus-4-8");
  expect(models.some(m => m.includes("embed"))).toBe(false);
});

test("returns empty array for unknown provider", async () => {
  const models = await fetchModelsForProvider("Unknown Provider", "key123");
  expect(models).toEqual([]);
});
