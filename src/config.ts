import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { ModelTier, DEFAULT_MODELS } from "./router.js";

export const CONFIG_DIR = path.join(os.homedir(), ".forge");
export const CONFIG_FILE = path.join(CONFIG_DIR, "config.toml");
export const KEYS_FILE = path.join(CONFIG_DIR, "keys.env");

export const PROVIDER_PROFILES: Record<string, Record<ModelTier, string>> = {
  "claude-primary": {
    [ModelTier.OVERSEER]: "claude-opus-4-8",
    [ModelTier.REASONING]: "claude-sonnet-4-6",
    [ModelTier.STANDARD]: "claude-haiku-4-5-20251001",
    [ModelTier.FAST]: "claude-haiku-4-5-20251001",
  },
  "openai-primary": {
    [ModelTier.OVERSEER]: "gpt-4o",
    [ModelTier.REASONING]: "o3-mini",
    [ModelTier.STANDARD]: "gpt-4o-mini",
    [ModelTier.FAST]: "gpt-4o-mini",
  },
  "mixed-cost-optimized": {
    [ModelTier.OVERSEER]: "claude-sonnet-4-6",
    [ModelTier.REASONING]: "claude-sonnet-4-6",
    [ModelTier.STANDARD]: "gemini/gemini-2.0-flash",
    [ModelTier.FAST]: "gemini/gemini-2.0-flash",
  },
  "codex": {
    [ModelTier.OVERSEER]: "codex",
    [ModelTier.REASONING]: "codex",
    [ModelTier.STANDARD]: "codex",
    [ModelTier.FAST]: "codex",
  },
  "claude-code": {
    [ModelTier.OVERSEER]: "claude-code",
    [ModelTier.REASONING]: "claude-code",
    [ModelTier.STANDARD]: "claude-code",
    [ModelTier.FAST]: "claude-code",
  },
};

export class ForgeConfig {
  constructor(
    public profile = "claude-primary",
    public models: Record<string, string> = {},
    public maxCycles = 5,
    public priority: "quality" | "speed" | "cost" = "quality",
    public autoOverseer = "",
  ) {}

  tierModels(): Record<ModelTier, string> {
    const base = { ...(PROVIDER_PROFILES[this.profile] ?? PROVIDER_PROFILES["claude-primary"]) };
    for (const [tierName, model] of Object.entries(this.models)) {
      if (Object.values(ModelTier).includes(tierName as ModelTier)) {
        base[tierName as ModelTier] = model;
      }
    }
    return base;
  }
}

export function loadConfig(configFile = CONFIG_FILE): ForgeConfig {
  if (!fs.existsSync(configFile)) return new ForgeConfig();
  const data = parseToml(fs.readFileSync(configFile, "utf8")) as any;
  return new ForgeConfig(
    data.profile ?? "claude-primary",
    data.models ?? {},
    data.max_cycles ?? 5,
    (data.priority as "quality" | "speed" | "cost") ?? "quality",
    data.auto_overseer ?? "",
  );
}

export function saveConfig(cfg: ForgeConfig, configFile = CONFIG_FILE): void {
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  fs.writeFileSync(configFile, stringifyToml({
    profile: cfg.profile,
    models: cfg.models,
    max_cycles: cfg.maxCycles,
    priority: cfg.priority,
    auto_overseer: cfg.autoOverseer,
  }));
}

export function saveKeys(keys: Record<string, string>, keysFile = KEYS_FILE): void {
  fs.mkdirSync(path.dirname(keysFile), { recursive: true });
  fs.writeFileSync(keysFile, Object.entries(keys).map(([k, v]) => `${k}=${v}`).join("\n") + "\n", { mode: 0o600 });
}

export function loadKeys(keysFile = KEYS_FILE): void {
  if (!fs.existsSync(keysFile)) return;
  for (const line of fs.readFileSync(keysFile, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...rest] = trimmed.split("=");
    if (!(key in process.env)) process.env[key] = rest.join("=");
  }
}

export async function runSetupWizard(): Promise<ForgeConfig> {
  const { select, checkbox, password } = await import("@inquirer/prompts");

  console.log("\n⚒  FORGE  —  idea to product in one command\n");

  const priority = await select({
    message: "What matters most to you?",
    choices: [
      { name: "Quality  — best output, higher cost", value: "quality" },
      { name: "Speed    — fastest responses", value: "speed" },
      { name: "Cost     — minimize spend", value: "cost" },
    ],
  }) as "quality" | "speed" | "cost";

  const codexCliLabel = "Codex CLI  (OpenAI Pro subscription - no API key needed)";
  const claudeCodeCliLabel = "Claude Code CLI (Claude subscription / Agent SDK credits - no Forge API key)";

  const providers = await checkbox({
    message: "Which API providers or local CLI agents do you want to use?",
    choices: [
      "Anthropic (Claude)",
      "OpenAI",
      "Google (Gemini)",
      "Groq",
      "Mistral",
      codexCliLabel,
      claudeCodeCliLabel,
    ].map(n => ({ name: n, value: n })),
  });

  const selectedExternalProfiles: string[] = [];

  if (providers.includes(codexCliLabel)) {
    const { checkCodexInstalled } = await import("./codexDriver.js");
    const installed = await checkCodexInstalled();
    if (!installed) {
      console.log("\nX  codex CLI not found. Install it with:\n\n    npm install -g @openai/codex\n");
      process.exit(1);
    }
    console.log("\nOK  codex CLI detected - no API key needed\n");
    selectedExternalProfiles.push("codex");
  }

  if (providers.includes(claudeCodeCliLabel)) {
    const { checkClaudeCodeReady, claudeCodeInstallGuidance } = await import("./claudeCodeDriver.js");
    const status = await checkClaudeCodeReady();
    if (!status.installed) {
      console.log(`\nX  ${claudeCodeInstallGuidance().replace(/\n/g, "\n    ")}\n`);
      process.exit(1);
    }
    if (!status.authenticated) {
      console.log("\nX  claude CLI is installed but not authenticated. Run:\n\n    claude auth login\n");
      process.exit(1);
    }
    console.log("\nOK  Claude Code CLI detected and authenticated - no Forge API key needed\n");
    selectedExternalProfiles.push("claude-code");
  }

  if (selectedExternalProfiles.length) {
    const profile = selectedExternalProfiles.length === 1
      ? selectedExternalProfiles[0]
      : await select({
        message: "Which local CLI agent should Forge use?",
        choices: [
          { name: "Codex CLI", value: "codex" },
          { name: "Claude Code CLI", value: "claude-code" },
        ],
      }) as string;
    const cfg = new ForgeConfig(profile, {}, 5, priority);
    saveConfig(cfg);
    console.log("OK  Configuration saved to ~/.forge/config.toml\n");
    return cfg;
  }

  const PROVIDER_KEY_MAP: Record<string, [string, string]> = {
    "Anthropic (Claude)": ["ANTHROPIC_API_KEY", "Anthropic API key"],
    "OpenAI": ["OPENAI_API_KEY", "OpenAI API key"],
    "Google (Gemini)": ["GOOGLE_API_KEY", "Google API key"],
    "Groq": ["GROQ_API_KEY", "Groq API key"],
    "Mistral": ["MISTRAL_API_KEY", "Mistral API key"],
  };

  const keys: Record<string, string> = {};
  for (const provider of providers) {
    const [envVar, label] = PROVIDER_KEY_MAP[provider];
    const existing = process.env[envVar] ?? "";
    const entered = await password({ message: `${label} [${envVar}]${existing ? " (already set, Enter to keep)" : ""}:` });
    if (entered) keys[envVar] = entered;
    else if (existing) keys[envVar] = existing;
  }

  console.log("\nFetching available models from models.dev…");
  const { fetchAllToolCallModels } = await import("./modelFetch.js");
  const LABEL_TO_PROVIDER: Record<string, string> = {
    "Anthropic (Claude)": "anthropic",
    "OpenAI": "openai",
    "Google (Gemini)": "google",
    "Groq": "groq",
    "Mistral": "mistral",
  };
  const selectedProviderIds = providers.map(p => LABEL_TO_PROVIDER[p]).filter(Boolean);
  // Force-refresh catalog so setup always sees the latest models
  const allModelChoices = await fetchAllToolCallModels(selectedProviderIds, true);

  const configMode = await select({
    message: "Model configuration:",
    choices: [
      { name: "Auto   — overseer AI picks the right model for each task", value: "auto" },
      { name: "Manual — choose a model for each tier yourself", value: "manual" },
    ],
  });

  if (configMode === "auto") {
    const overseer = await select({
      message: "Pick the overseer model (the AI that will decide all other models):",
      choices: allModelChoices,
    }) as string;
    const cfg = new ForgeConfig("auto", {}, 5, priority, overseer);
    saveConfig(cfg);
    if (Object.keys(keys).length) saveKeys(keys);
    console.log("\n✓ Configuration saved to ~/.forge/config.toml\n");
    return cfg;
  }

  const chosenModels: Record<string, string> = {};
  if (allModelChoices.length) {
    const tiers: [ModelTier, string][] = [
      [ModelTier.OVERSEER, "Overseer   — architecture & planning (most capable)"],
      [ModelTier.REASONING, "Reasoning  — coding & integration (smart + fast)"],
      [ModelTier.STANDARD, "Standard   — review & task graph (balanced)"],
      [ModelTier.FAST, "Fast       — quick single-turn calls (cheapest)"],
    ];
    for (const [tier, desc] of tiers) {
      chosenModels[tier] = await select({ message: desc, choices: allModelChoices });
    }
  }

  const profile = providers.includes("Anthropic (Claude)") ? "claude-primary"
    : providers.includes("OpenAI") ? "openai-primary" : "claude-primary";

  const cfg = new ForgeConfig(profile, chosenModels, 5, priority);
  saveConfig(cfg);
  if (Object.keys(keys).length) saveKeys(keys);
  console.log("\n✓ Configuration saved to ~/.forge/config.toml\n");
  return cfg;
}
