import { BaseAgent, AgentResult } from "./base.js";
import { ModelTier } from "../router.js";

const SYSTEM = `You are a code reviewer. Review the diff for a specific task.

Output ONLY valid JSON:
{
  "approved": true|false,
  "issues": ["blocking issue description", ...],
  "suggestions": ["non-blocking improvement", ...]
}

Approve if there are no blocking correctness issues. Flag: missing error handling at boundaries, broken imports, logic bugs, security holes.`;

export class ReviewAgent extends BaseAgent {
  protected tier = ModelTier.STANDARD;

  async run(args: Record<string, unknown>): Promise<AgentResult> {
    const messages: any[] = [
      { role: "system", content: SYSTEM },
      { role: "user", content: `Task: ${args["taskTitle"]}\n\nDiff:\n${args["diff"]}` },
    ];
    const response = await this.call(messages);
    try {
      const cleaned = this.extractJson(response);
      JSON.parse(cleaned);
      return { success: true, output: cleaned };
    } catch {
      return { success: false, output: response, error: "invalid_json" };
    }
  }
}
