import type { CoreMessage } from "ai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ForgeDb } from "../db.js";
import { LLMRouter, ModelTier } from "../router.js";
import { TOOL_DEFINITIONS } from "../tools/definitions.js";
import { executeTool } from "../tools/executor.js";
import { CodexDriver } from "../codexDriver.js";
import type { ClaudeSessionManager } from "../claudeSession.js";
import { type ExternalAgentId, externalAgentFor } from "../externalAgents.js";
import { SKILL_TOOL_DEFINITIONS } from "../skills/toolDefinitions.js";
import {
  type SkillContextRuntime,
  isSkillTool,
  executeSkillTool,
  summarizeSkillToolResult,
} from "../skills/toolExecutor.js";

export interface AgentRunOptions {
  skillContext?: SkillContextRuntime;
}

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
    protected claudeSessions?: ClaudeSessionManager,
  ) {}

  abstract run(args: Record<string, unknown>): Promise<AgentResult>;

  private getRecentContext(): string {
    const events = this.db.getRecentEvents(this.sessionId, 10);
    return events.map(e => String(e["message"])).join(" | ").slice(-500);
  }

  protected async resolveAutoModel(): Promise<string | undefined> {
    if (!this.router.hasAutoSelector()) return undefined;
    return this.router.selectForAgent(this.constructor.name, this.getRecentContext());
  }

  protected externalAgentMode(): ExternalAgentId | undefined {
    return externalAgentFor(this.router.modelFor(this.tier));
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

  private prepareMessagesWithSkillContext(
    messages: CoreMessage[],
    skillContext: SkillContextRuntime | undefined,
  ): CoreMessage[] {
    if (!skillContext) return messages;
    const rendered = skillContext.provider.renderCompact(skillContext.request);
    if (rendered.charCount === 0) return messages;
    const skillMessage = { role: "system" as const, content: rendered.content };
    const firstNonSystemIdx = messages.findIndex((m) => m.role !== "system");
    const insertAt = firstNonSystemIdx === -1 ? messages.length : firstNonSystemIdx;
    return [...messages.slice(0, insertAt), skillMessage, ...messages.slice(insertAt)];
  }

  private async runViaCodex(messages: CoreMessage[], workdir: string, taskId?: string): Promise<string> {
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

  private async runViaClaudeSession(messages: CoreMessage[], taskId?: string, workerCwd?: string): Promise<string> {
    if (!this.claudeSessions) {
      throw new Error("claude-code profile requires a Claude session manager (agents must be constructed by the Overseer)");
    }
    const prompt = this.promptFromMessages(messages);
    this.db.logEvent(this.sessionId, "CLAUDE_CODE_CALL", `${this.constructor.name} -> claude-code`);
    this.onLiveEvent?.("llm", `${this.constructor.name} → claude-code`);
    const session = workerCwd !== undefined && taskId !== undefined
      ? await this.claudeSessions.worker(taskId, workerCwd)
      : await this.claudeSessions.main();
    const result = await session.send(prompt, { taskId });
    return result.text;
  }

  protected async call(
    messages: CoreMessage[],
    taskId?: string,
    options: AgentRunOptions = {},
  ): Promise<string> {
    const prepared = this.prepareMessagesWithSkillContext(messages, options.skillContext);
    const externalAgent = this.externalAgentMode();
    if (externalAgent === "claude-code") {
      return this.runViaClaudeSession(prepared, taskId);
    }
    if (externalAgent === "codex") {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-codex-"));
      try {
        return await this.runViaCodex(prepared, tmpDir, taskId);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }

    const modelOverride = await this.resolveAutoModel();
    const model = modelOverride ?? this.router.modelFor(this.tier);
    this.db.logEvent(this.sessionId, "LLM_CALL", `${this.constructor.name} → ${model}`);
    this.onLiveEvent?.("llm", `${this.constructor.name} → ${model}`);
    const result = await this.router.complete(this.tier, prepared, 120_000, modelOverride);
    this.db.logLlmCall(this.sessionId, { ...result, response: result.content }, taskId);
    return result.content;
  }

  protected async runAgenticLoop(
    messages: CoreMessage[],
    workspace: string,
    taskId?: string,
    options: AgentRunOptions = {},
  ): Promise<string> {
    const prepared = this.prepareMessagesWithSkillContext(messages, options.skillContext);
    const externalAgent = this.externalAgentMode();
    if (externalAgent === "claude-code") {
      return this.runViaClaudeSession(prepared, taskId, taskId ? workspace : undefined);
    }
    if (externalAgent === "codex") {
      return this.runViaCodex(prepared, workspace, taskId);
    }

    const toolDefs = options.skillContext
      ? { ...TOOL_DEFINITIONS, ...SKILL_TOOL_DEFINITIONS }
      : TOOL_DEFINITIONS;

    const modelOverride = await this.resolveAutoModel();
    let totalToolCalls = 0;

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const model = modelOverride ?? this.router.modelFor(this.tier);
      this.db.logEvent(this.sessionId, "LLM_CALL", `${this.constructor.name} turn ${turn + 1} → ${model}`);
      this.onLiveEvent?.("llm", `${this.constructor.name} turn ${turn + 1} → ${model}`);
      const result = await this.router.completeWithTools(this.tier, prepared, toolDefs, 120_000, modelOverride);
      this.db.logLlmCall(this.sessionId, { ...result, response: result.text ?? "" }, taskId);

      if (!result.toolCalls.length) return result.text ?? "";

      prepared.push({
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
        let toolResult: string;
        if (totalToolCalls > MAX_TOOL_CALLS) {
          toolResult = "ERROR: Tool call limit reached. Stop and report what you have.";
        } else if (options.skillContext && isSkillTool(tc.name)) {
          toolResult = executeSkillTool(tc.name, tc.arguments, options.skillContext, this.db, this.sessionId);
        } else {
          toolResult = await executeTool(tc.name, tc.arguments, workspace);
        }

        if (tc.name === "bash_exec") {
          this.onLiveEvent?.("cmd", String(tc.arguments["command"] ?? "").slice(0, 80));
        } else {
          this.onLiveEvent?.("tool", fmtToolArgs(tc.name, tc.arguments));
        }

        const logResult = summarizeSkillToolResult(tc.name, toolResult);
        this.db.logToolCall(this.sessionId, taskId, tc.name, tc.arguments, logResult);
        prepared.push({
          role: "tool",
          content: [{ type: "tool-result" as const, toolCallId: tc.id, toolName: tc.name, result: toolResult }],
        });
      }
    }

    prepared.push({ role: "user", content: "You have reached the turn limit. Summarize what you completed." });
    const final = await this.router.completeWithTools(this.tier, prepared, {}, 120_000, modelOverride);
    this.db.logLlmCall(this.sessionId, { ...final, response: final.text ?? "" }, taskId);
    return final.text ?? "";
  }

  protected extractJson(text: string): string {
    return extractJson(text);
  }
}
