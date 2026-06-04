import { getCatalog, listToolCallModels, fmtCost, SUPPORTED_PROVIDERS } from "./modelsdev.js";

const LABEL_TO_PROVIDER_ID: Record<string, string> = {
  "Anthropic (Claude)": "anthropic",
  "OpenAI": "openai",
  "Google (Gemini)": "google",
  "Groq": "groq",
  "Mistral": "mistral",
};

export async function fetchModelsForProvider(providerLabel: string): Promise<string[]> {
  const pid = LABEL_TO_PROVIDER_ID[providerLabel];
  if (!pid) return [];
  try {
    const catalog = await getCatalog();
    return listToolCallModels(catalog, [pid]).map(({ model }) => model.id);
  } catch {
    return [];
  }
}

export async function fetchAllToolCallModels(): Promise<
  Array<{ value: string; name: string }>
> {
  const catalog = await getCatalog();
  return listToolCallModels(catalog, SUPPORTED_PROVIDERS).map(({ providerName, model }) => ({
    value: model.id,
    name: `${providerName}  ${model.name}  (${fmtCost(model)})`,
  }));
}
