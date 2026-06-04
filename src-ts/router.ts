import { generateText, CoreMessage } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";

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

  constructor(tierModels?: Partial<Record<ModelTier, string>>) {
    this.models = { ...DEFAULT_MODELS, ...tierModels };
  }

  modelFor(tier: ModelTier): string {
    return this.models[tier];
  }

  override(tier: ModelTier, model: string): void {
    this.models[tier] = model;
  }

  async complete(tier: ModelTier, messages: CoreMessage[], timeoutMs = 120_000): Promise<CallResult> {
    const modelId = this.models[tier];
    const model = this.resolveModel(modelId);
    const call = generateText({ model, messages });
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new LLMTimeoutError(timeoutMs / 1000, modelId)), timeoutMs)
    );
    const result = await Promise.race([call, timeout]);
    return {
      content: result.text,
      model: modelId,
      tokensIn: result.usage.promptTokens,
      tokensOut: result.usage.completionTokens,
      costUsd: 0,
    };
  }

  async completeWithTools(
    tier: ModelTier,
    messages: CoreMessage[],
    tools: Record<string, unknown>,
    timeoutMs = 120_000,
  ): Promise<LoopResult> {
    const modelId = this.models[tier];
    const model = this.resolveModel(modelId);
    const call = generateText({ model, messages, tools: tools as any, toolChoice: "auto" });
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new LLMTimeoutError(timeoutMs / 1000, modelId)), timeoutMs)
    );
    const result = await Promise.race([call, timeout]);
    const toolCalls: ToolCall[] = (result.toolCalls ?? []).map((tc: any) => ({
      id: tc.toolCallId,
      name: tc.toolName,
      arguments: tc.args ?? {},
    }));
    return {
      text: result.text || null,
      toolCalls,
      model: modelId,
      tokensIn: result.usage.promptTokens,
      tokensOut: result.usage.completionTokens,
      costUsd: 0,
    };
  }

  private resolveModel(modelId: string) {
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
