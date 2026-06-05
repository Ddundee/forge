import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface MdModel {
  id: string;
  name: string;
  tool_call?: boolean;
  reasoning?: boolean;
  cost?: { input: number; output: number; cache_read?: number; cache_write?: number };
  limit?: { context: number; output: number };
}

export interface MdProvider {
  id: string;
  name: string;
  npm: string;
  env: string[];
  models: Record<string, MdModel>;
}

export type MdCatalog = Record<string, MdProvider>;

const CACHE_PATH = path.join(os.homedir(), ".forge", "models-cache.json");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

let _cached: MdCatalog | null = null;

export async function getCatalog(refresh = false): Promise<MdCatalog> {
  if (_cached && !refresh) return _cached;

  if (!refresh && fs.existsSync(CACHE_PATH)) {
    const age = Date.now() - fs.statSync(CACHE_PATH).mtimeMs;
    if (age < CACHE_TTL_MS) {
      _cached = JSON.parse(fs.readFileSync(CACHE_PATH, "utf8")) as MdCatalog;
      return _cached;
    }
  }

  const res = await fetch("https://models.dev/api.json", { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`models.dev returned ${res.status}`);
  const data = await res.json() as MdCatalog;

  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(data));
  _cached = data;
  return _cached;
}

export const SUPPORTED_PROVIDERS = ["anthropic", "openai", "google", "groq", "mistral"];

// Current and previous generation models per provider.
// These are the IDs forge exposes in setup; older/experimental variants are hidden.
export const GENERATION_FILTERS: Record<string, RegExp> = {
  anthropic: /^claude-(opus|sonnet|haiku)-4/,
  openai:    /^(gpt-5\.[45]|o[34])(?!.*(pro|deep-research))/,
  google:    /^gemini-2\./,
  groq:      /^(llama-3\.3|meta-llama\/llama-4|moonshotai\/kimi-k2|groq\/compound)/,
  mistral:   /^(mistral-(large|medium|small)-latest|codestral-latest|devstral-latest|magistral)/,
};

export function listToolCallModels(
  catalog: MdCatalog,
  providerIds = SUPPORTED_PROVIDERS,
  currentGenOnly = false,
): Array<{ providerId: string; providerName: string; model: MdModel }> {
  return providerIds.flatMap(pid => {
    const prov = catalog[pid];
    if (!prov) return [];
    const genFilter = currentGenOnly ? GENERATION_FILTERS[pid] : null;
    return Object.values(prov.models)
      .filter(m => m.tool_call && (!genFilter || genFilter.test(m.id)))
      .map(m => ({ providerId: pid, providerName: prov.name, model: m }));
  });
}

export function findModel(catalog: MdCatalog, modelId: string): MdModel | undefined {
  for (const prov of Object.values(catalog)) {
    const m = prov.models?.[modelId];
    if (m) return m;
  }
  return undefined;
}

export function calcCost(model: MdModel | undefined, tokensIn: number, tokensOut: number): number {
  if (!model?.cost) return 0;
  return (model.cost.input * tokensIn + model.cost.output * tokensOut) / 1_000_000;
}

export function fmtCost(model: MdModel | undefined): string {
  if (!model?.cost) return "?";
  return `$${model.cost.input}/$${model.cost.output} per M`;
}
