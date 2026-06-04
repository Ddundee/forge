const SKIP_PATTERNS = [
  "embed", "tts", "whisper", "dall-e", "-audio", "native-audio", "-image",
  "gpt-image", "chatgpt-image", "guard", "-instruct", "babbage", "davinci",
  "curie", "-ada-", "-live-", "deep-research", "computer-use",
  "256-x-", "512-x-", "1024-x-", "1536-x-",
];

function shouldSkip(id: string): boolean {
  const lower = id.toLowerCase();
  return SKIP_PATTERNS.some(p => lower.includes(p));
}

async function httpGetJson(url: string, headers: Record<string, string>): Promise<any> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchAnthropic(apiKey: string): Promise<string[]> {
  const data = await httpGetJson("https://api.anthropic.com/v1/models", {
    "x-api-key": apiKey, "anthropic-version": "2023-06-01",
  });
  return (data.data ?? [])
    .map((m: any) => m.id as string)
    .filter((id: string) => id.startsWith("claude") && !shouldSkip(id))
    .sort()
    .reverse();
}

async function fetchOpenAI(apiKey: string): Promise<string[]> {
  const data = await httpGetJson("https://api.openai.com/v1/models", { Authorization: `Bearer ${apiKey}` });
  return (data.data ?? []).map((m: any) => m.id as string).filter((id: string) => !shouldSkip(id)).sort().reverse();
}

async function fetchGoogle(apiKey: string): Promise<string[]> {
  const data = await httpGetJson(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`, {});
  return (data.models ?? [])
    .map((m: any) => m.name as string)
    .filter((n: string) => n.startsWith("models/gemini"))
    .map((n: string) => "gemini/" + n.replace("models/", ""))
    .filter((id: string) => !shouldSkip(id))
    .sort().reverse();
}

async function fetchGroq(apiKey: string): Promise<string[]> {
  const data = await httpGetJson("https://api.groq.com/openai/v1/models", { Authorization: `Bearer ${apiKey}` });
  return (data.data ?? [])
    .map((m: any) => m.id as string)
    .filter((id: string) => !shouldSkip(id))
    .map((id: string) => id.startsWith("groq/") ? id : `groq/${id}`)
    .sort().reverse();
}

async function fetchMistral(apiKey: string): Promise<string[]> {
  const data = await httpGetJson("https://api.mistral.ai/v1/models", { Authorization: `Bearer ${apiKey}` });
  return (data.data ?? [])
    .map((m: any) => m.id as string)
    .filter((id: string) => !shouldSkip(id))
    .map((id: string) => id.startsWith("mistral/") ? id : `mistral/${id}`)
    .sort().reverse();
}

const FETCHERS: Record<string, (key: string) => Promise<string[]>> = {
  "Anthropic (Claude)": fetchAnthropic,
  "OpenAI": fetchOpenAI,
  "Google (Gemini)": fetchGoogle,
  "Groq": fetchGroq,
  "Mistral": fetchMistral,
};

export async function fetchModelsForProvider(providerLabel: string, apiKey: string): Promise<string[]> {
  if (!apiKey) return [];
  const fetcher = FETCHERS[providerLabel];
  if (!fetcher) return [];
  try {
    const result = await fetcher(apiKey);
    return result.length ? result : [];
  } catch {
    return [];
  }
}
