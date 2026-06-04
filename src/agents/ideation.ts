import { BaseAgent, AgentResult } from "./base.js";
import { ModelTier } from "../router.js";

const SYSTEM = `You are an expert product architect. Take a raw idea and produce a clear, buildable product spec.

Ask ONE clarifying question at a time (max 3 total). After 3 questions or when you have enough context, output a JSON spec:

{
  "name": "kebab-case-name",
  "description": "one paragraph",
  "tech_stack": ["list"],
  "features": ["list"],
  "out_of_scope": ["list"],
  "assumptions": ["list of assumptions made"]
}

Output ONLY the JSON when producing the spec. Output ONLY the question string when asking.`;

export class IdeationAgent extends BaseAgent {
  protected tier = ModelTier.OVERSEER;

  async run(args: Record<string, unknown>): Promise<AgentResult> {
    const idea = String(args["idea"] ?? "");
    const conversation = (args["conversation"] as { role: string; content: string }[]) ?? [];
    const messages: any[] = [
      { role: "system", content: SYSTEM },
      { role: "user", content: `Idea: ${idea}` },
    ];
    for (const turn of conversation) {
      messages.push({ role: turn.role === "question" ? "assistant" : "user", content: turn.content });
    }
    const response = await this.call(messages);
    try {
      const spec = JSON.parse(this.extractJson(response));
      return { success: true, output: JSON.stringify(spec) };
    } catch {
      return { success: true, output: response, error: "question" };
    }
  }
}
