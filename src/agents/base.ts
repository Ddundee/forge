import type { CoreMessage } from "ai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ForgeDb } from "../db.js";
import { LLMRouter, ModelTier } from "../router.js";
import { TOOL_DEFINITIONS } from "../tools/definitions.js";
import { executeTool } from "../tools/executor.js";
import { CodexDriver } from "../codexDriver.js";

export interface AgentResult {
  success: boolean;
  output: string;
  error?: string;
}

export type EventKind = "llm" | "tool" | "cmd";
export type LiveEventFn = (kind: EventKind, msg: string) => void;

const MAX_TURNS = 40;
const MAX_TOOL_CALLS = 80;

function fmtToolArgs(name: string, args: Record<string, unknown>): string {
  const p = args["path"] ?? args["file"] ?? args["directory"];
  if (p !== undefined) return `${name}(${String(p)})`;
  return `${name}(${JSON.stringify(args).slice(0, 50)})`;
}

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
  private codexDriver = new CodexDriver();

  constructor(
    protected router: LLMRouter,
    protected db: ForgeDb,
    protected sessionId: string,
    protected onLiveEvent?: LiveEventFn,
  ) {}

  abstract run(args: Record<string, unknown>): Promise<AgentResult>;

  private getRecentContext(): string {
    const events = this.db.getEvents(this.sessionId);
    return events.slice(-10).map(e => String(e["message"])).join(" | ").slice(-500);
  }

  protected async resolveAutoModel(): Promise<string | undefined> {
    if (!this.router.hasAutoSelector()) return undefined;
    return this.router.selectForAgent(this.constructor.name, this.getRecentContext());
  }

  protected isCodexMode(): boolean {
    return this.router.modelFor(this.tier) === "codex";
  }

  private messageContentToText(content: CoreMessage["content"]): string {
    if (typeof content === "string") return content;
    try {
      return JSON.stringify(content);
    } catch {
      return String(content);
    }
  }

  private promptFromMessages(messages: CoreMessage[]): string {
    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => this.messageContentToText(m.content))
      .join("\n\n");
    const body = messages
      .filter((m) => m.role !== "system")
      .map((m) => `${m.role.toUpperCase()}:\n${this.messageContentToText(m.content)}`)
      .join("\n\n");
    return system ? `${system}\n\n---\n\n${body}` : body;
  }

  private async runViaCodex(
    messages: CoreMessage[],
    workdir: string,
    taskId?: string,
  ): Promise<string> {
    const prompt = this.promptFromMessages(messages);
    this.db.logEvent(this.sessionId, "CODEX_CALL", `${this.constructor.name} -> codex`);
    this.onLiveEvent?.("llm", `${this.constructor.name} → codex`);
    const result = await this.codexDriver.runTask(prompt, workdir);
    this.db.logLlmCall(
      this.sessionId,
      { model: "codex", tokensIn: 0, tokensOut: 0, costUsd: 0, response: result },
      taskId,
    );
    return result;
  }

  protected async call(messages: CoreMessage[], taskId?: string): Promise<string> {
    if (this.isCodexMode()) {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-codex-"));
      try {
        return await this.runViaCodex(messages, tmpDir, taskId);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }

    const modelOverride = await this.resolveAutoModel();
    const model = modelOverride ?? this.router.modelFor(this.tier);
    this.db.logEvent(this.sessionId, "LLM_CALL", `${this.constructor.name} → ${model}`);
    this.onLiveEvent?.("llm", `${this.constructor.name} → ${model}`);
    const result = await this.router.complete(this.tier, messages, 120_000, modelOverride);
    this.db.logLlmCall(this.sessionId, { ...result, response: result.content }, taskId);
    return result.content;
  }

  protected async runAgenticLoop(
    messages: CoreMessage[],
    workspace: string,
    taskId?: string,
  ): Promise<string> {
    if (this.isCodexMode()) {
      return this.runViaCodex(messages, workspace, taskId);
    }

    const modelOverride = await this.resolveAutoModel();
    let totalToolCalls = 0;

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const model = modelOverride ?? this.router.modelFor(this.tier);
      this.db.logEvent(this.sessionId, "LLM_CALL", `${this.constructor.name} turn ${turn + 1} → ${model}`);
      this.onLiveEvent?.("llm", `${this.constructor.name} turn ${turn + 1} → ${model}`);
      const result = await this.router.completeWithTools(this.tier, messages, TOOL_DEFINITIONS, 120_000, modelOverride);
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

        if (tc.name === "bash_exec") {
          this.onLiveEvent?.("cmd", String(tc.arguments["command"] ?? "").slice(0, 80));
        } else {
          this.onLiveEvent?.("tool", fmtToolArgs(tc.name, tc.arguments));
        }

        this.db.logToolCall(this.sessionId, taskId, tc.name, tc.arguments, toolResult.slice(0, 2000));
        messages.push({
          role: "tool",
          content: [{ type: "tool-result" as const, toolCallId: tc.id, toolName: tc.name, result: toolResult }],
        });
      }
    }

    messages.push({ role: "user", content: "You have reached the turn limit. Summarize what you completed." });
    const final = await this.router.completeWithTools(this.tier, messages, {}, 120_000, modelOverride);
    this.db.logLlmCall(this.sessionId, { ...final, response: final.text ?? "" }, taskId);
    return final.text ?? "";
  }

  protected extractJson(text: string): string {
    return extractJson(text);
  }
}
