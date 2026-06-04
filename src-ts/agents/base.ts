import type { CoreMessage } from "ai";
import { ForgeDb } from "../db.js";
import { LLMRouter, ModelTier } from "../router.js";
import { TOOL_DEFINITIONS } from "../tools/definitions.js";
import { executeTool } from "../tools/executor.js";

export interface AgentResult {
  success: boolean;
  output: string;
  error?: string;
}

const MAX_TURNS = 40;
const MAX_TOOL_CALLS = 80;

function extractJson(text: string): string {
  const trimmed = text.trim();
  try { JSON.parse(trimmed); return trimmed; } catch {}
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  for (const [open, close] of [["{", "}"], ["[", "]"]]) {
    const s = trimmed.indexOf(open);
    const e = trimmed.lastIndexOf(close);
    if (s !== -1 && e > s) {
      const candidate = trimmed.slice(s, e + 1);
      try { JSON.parse(candidate); return candidate; } catch {}
    }
  }
  return text;
}

export abstract class BaseAgent {
  protected tier: ModelTier = ModelTier.STANDARD;

  constructor(
    protected router: LLMRouter,
    protected db: ForgeDb,
    protected sessionId: string,
  ) {}

  abstract run(args: Record<string, unknown>): Promise<AgentResult>;

  protected async call(messages: CoreMessage[], taskId?: string): Promise<string> {
    const model = this.router.modelFor(this.tier);
    this.db.logEvent(this.sessionId, "LLM_CALL", `${this.constructor.name} → ${model}`);
    const result = await this.router.complete(this.tier, messages);
    this.db.logLlmCall(this.sessionId, { ...result, response: result.content }, taskId);
    return result.content;
  }

  protected async runAgenticLoop(
    messages: CoreMessage[],
    workspace: string,
    taskId?: string,
  ): Promise<string> {
    let totalToolCalls = 0;

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const model = this.router.modelFor(this.tier);
      this.db.logEvent(this.sessionId, "LLM_CALL", `${this.constructor.name} turn ${turn + 1} → ${model}`);
      const result = await this.router.completeWithTools(this.tier, messages, TOOL_DEFINITIONS);
      this.db.logLlmCall(this.sessionId, { ...result, response: result.text ?? "" }, taskId);

      if (!result.toolCalls.length) return result.text ?? "";

      messages.push({
        role: "assistant",
        content: [
          ...(result.text ? [{ type: "text" as const, text: result.text }] : []),
          ...result.toolCalls.map(tc => ({
            type: "tool-call" as const,
            toolCallId: tc.id,
            toolName: tc.name,
            args: tc.arguments,
          })),
        ],
      });

      for (const tc of result.toolCalls) {
        totalToolCalls++;
        const toolResult = totalToolCalls > MAX_TOOL_CALLS
          ? "ERROR: Tool call limit reached. Stop and report what you have."
          : executeTool(tc.name, tc.arguments, workspace);

        this.db.logToolCall(this.sessionId, taskId, tc.name, tc.arguments, toolResult.slice(0, 2000));
        messages.push({
          role: "tool",
          content: [{ type: "tool-result" as const, toolCallId: tc.id, toolName: tc.name, result: toolResult }],
        });
      }
    }

    messages.push({ role: "user", content: "You have reached the turn limit. Summarize what you completed." });
    const final = await this.router.completeWithTools(this.tier, messages, {});
    this.db.logLlmCall(this.sessionId, { ...final, response: final.text ?? "" }, taskId);
    return final.text ?? "";
  }

  protected extractJson(text: string): string {
    return extractJson(text);
  }
}
