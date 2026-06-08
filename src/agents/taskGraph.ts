import { BaseAgent, AgentResult, type AgentRunOptions } from "./base.js";
import { ModelTier } from "../router.js";
import { normalizeTaskGraph } from "../taskGraphValidation.js";

const SYSTEM = `You are a senior engineer breaking a product into coding tasks.

Output ONLY a valid JSON array of tasks. Each task:
{
  "title": "imperative title",
  "type": "coding",
  "deps": ["list of titles this depends on"]
}

Rules:
- Each task writes one focused unit (one file or one endpoint group)
- Order deps correctly so parallelism is possible
- No task should be too large; max ~150 lines of code per task`;

export class TaskGraphAgent extends BaseAgent {
  protected tier = ModelTier.REASONING;

  async run(args: Record<string, unknown>): Promise<AgentResult> {
    const messages: any[] = [
      { role: "system", content: SYSTEM },
      { role: "user", content: `Spec:\n${args["spec"]}\n\nArchitecture:\n${args["architecture"]}` },
    ];
    const opts: AgentRunOptions = { skillContext: args["skillContext"] as AgentRunOptions["skillContext"] };
    const response = await this.call(messages, undefined, opts);
    let parsed: unknown;
    try {
      parsed = JSON.parse(this.extractJson(response));
    } catch {
      return { success: false, output: response, error: "invalid_json" };
    }
    try {
      const tasks = normalizeTaskGraph(parsed);
      return { success: true, output: JSON.stringify(tasks) };
    } catch (e: any) {
      return { success: false, output: response, error: e.message ?? "invalid_task_graph" };
    }
  }
}
