import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { CoreMessage } from "ai";

const SESSIONS_DIR = path.join(os.homedir(), ".forge", "sessions");

export function logPath(sessionId: string, sessionsDir = SESSIONS_DIR): string {
  return path.join(sessionsDir, sessionId, "logs", "prompts.log");
}

interface LogEntry {
  agent: string;
  tier: string;
  model: string;
  messages: CoreMessage[];
  response: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  toolsCalled?: string[];
}

export class PromptLogger {
  private filePath: string;

  constructor(sessionId: string, sessionsDir = SESSIONS_DIR) {
    this.filePath = logPath(sessionId, sessionsDir);
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
  }

  log(entry: LogEntry): void {
    let userPrompt = "";
    for (let i = entry.messages.length - 1; i >= 0; i--) {
      const m = entry.messages[i];
      if (m.role === "user" && typeof m.content === "string") {
        userPrompt = m.content;
        break;
      }
    }
    const record: Record<string, unknown> = {
      ts: new Date().toISOString(),
      agent: entry.agent,
      tier: entry.tier,
      model: entry.model,
      tokens_in: entry.tokensIn,
      tokens_out: entry.tokensOut,
      cost_usd: entry.costUsd,
      user_prompt: userPrompt,
      response: entry.response,
    };
    if (entry.toolsCalled?.length) record["tools_called"] = entry.toolsCalled;
    fs.appendFileSync(this.filePath, JSON.stringify(record) + "\n");
  }
}
