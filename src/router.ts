import { generateText, CoreMessage } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { type MdCatalog, findModel, calcCost } from "./modelsdev.js";
import type { AutoSelector } from "./autoSelector.js";
import { externalAgentFor } from "./externalAgents.js";

export enum ModelTier {
  OVERSEER = "overseer",
  REASONING = "reasoning",
  STANDARD = "standard",
  FAST = "fast",
}

export const DEFAULT_MODELS: Record<ModelTier, string> = {
  [ModelTier.OVERSEER]: "claude-opus-4-8",
  [ModelTier.REASONING]: "claude-sonnet-4-6",
  [ModelTier.STANDARD]: "claude-haiku-4-5-20251001",
  [ModelTier.FAST]: "gemini/gemini-2.0-flash",
};

export interface CallResult {
  content: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LoopResult {
  text: string | null;
  toolCalls: ToolCall[];
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

export class LLMTimeoutError extends Error {
  constructor(timeoutSecs: number, model: string) {
    super(`LLM call timed out after ${timeoutSecs}s (model: ${model})`);
    this.name = "LLMTimeoutError";
  }
}

export class LLMRouter {
  private models: Record<ModelTier, string>;
  private catalog: MdCatalog | null;
  private autoSelector?: AutoSelector;

  constructor(tierModels?: Partial<Record<ModelTier, string>>, catalog?: MdCatalog) {
    this.models = { ...DEFAULT_MODELS, ...tierModels };
    this.catalog = catalog ?? null;
  }

  modelFor(tier: ModelTier): string {
    return this.models[tier];
  }

  override(tier: ModelTier, model: string): void {
    this.models[tier] = model;
  }

  setAutoSelector(selector: AutoSelector): void {
    this.autoSelector = selector;
  }

  hasAutoSelector(): boolean {
    return !!this.autoSelector;
  }

  async selectForAgent(agentName: string, recentContext: string): Promise<string> {
    return this.autoSelector!.selectModel(agentName, recentContext);
  }

  /**
   * Anthropic prompt caching: breakpoint after the system prompt (also covers
   * tool definitions) and after the last message, so the next call in a
   * growing conversation re-reads the shared prefix at the cached-token rate
   * instead of full input price. No-op for other providers; prefixes under
   * Anthropic's minimum cacheable length are silently uncached.
   */
  private withAnthropicCache(messages: CoreMessage[], modelId: string): CoreMessage[] {
    if (!modelId.startsWith("claude")) return messages;
    const out = messages.map((m) => ({ ...m })) as CoreMessage[];
    const cacheOptions = { anthropic: { cacheControl: { type: "ephemeral" } } };
    for (let i = out.length - 1; i >= 0; i--) {
      if (out[i].role === "system") { (out[i] as any).providerOptions = cacheOptions; break; }
    }
    const last = out[out.length - 1];
    if (last && last.role !== "system") (last as any).providerOptions = cacheOptions;
    return out;
  }

  private usageFrom(result: { usage: { promptTokens: number; completionTokens: number } }, modelId: string) {
    const meta = ((result as any).providerMetadata?.anthropic ??
      (result as any).experimental_providerMetadata?.anthropic ?? {}) as Record<string, unknown>;
    const cacheWrite = Number(meta["cacheCreationInputTokens"] ?? 0) || 0;
    const cacheRead = Number(meta["cacheReadInputTokens"] ?? 0) || 0;
    const mdModel = this.catalog ? findModel(this.catalog, modelId) : undefined;
    return {
      tokensIn: result.usage.promptTokens + cacheWrite + cacheRead,
      tokensOut: result.usage.completionTokens,
      costUsd: calcCost(mdModel, result.usage.promptTokens, result.usage.completionTokens, cacheWrite, cacheRead),
    };
  }

  async complete(tier: ModelTier, messages: CoreMessage[], timeoutMs = 120_000, modelOverride?: string): Promise<CallResult> {
    const modelId = modelOverride ?? this.models[tier];
    const model = this.resolveModel(modelId);
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      const result = await generateText({
        model,
        messages: this.withAnthropicCache(messages, modelId),
        abortSignal: signal,
      });
      return { content: result.text, model: modelId, ...this.usageFrom(result, modelId) };
    } catch (err) {
      if (signal.aborted) throw new LLMTimeoutError(timeoutMs / 1000, modelId);
      throw err;
    }
  }

  async completeWithTools(
    tier: ModelTier,
    messages: CoreMessage[],
    tools: Record<string, unknown>,
    timeoutMs = 120_000,
    modelOverride?: string,
  ): Promise<LoopResult> {
    const modelId = modelOverride ?? this.models[tier];
    const model = this.resolveModel(modelId);
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      const result = await generateText({
        model,
        messages: this.withAnthropicCache(messages, modelId),
        tools: tools as any,
        toolChoice: "auto",
        abortSignal: signal,
      });
      const toolCalls: ToolCall[] = (result.toolCalls ?? []).map((tc: any) => ({
        id: tc.toolCallId,
        name: tc.toolName,
        arguments: tc.args ?? {},
      }));
      return {
        text: result.text || null,
        toolCalls,
        model: modelId,
        ...this.usageFrom(result, modelId),
      };
    } catch (err) {
      if (signal.aborted) throw new LLMTimeoutError(timeoutMs / 1000, modelId);
      throw err;
    }
  }

  private resolveModel(modelId: string) {
    if (externalAgentFor(modelId)) {
      throw new Error(
        `Model id "${modelId}" reached LLMRouter - use an external agent driver via BaseAgent`,
      );
    }
    if (modelId.startsWith("claude")) return createAnthropic()(modelId);
    if (modelId.startsWith("gpt") || modelId.startsWith("o3") || modelId.startsWith("o4")) {
      return createOpenAI()(modelId);
    }
    if (modelId.startsWith("gemini") || modelId.includes("gemini")) {
      const id = modelId.replace("gemini/", "");
      return createGoogleGenerativeAI()(id);
    }
    return createOpenAI()(modelId);
  }
}
