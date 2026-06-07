import { BaseAgent, AgentResult, type AgentRunOptions } from "./base.js";
import { ModelTier } from "../router.js";

const SYSTEM = `You are a senior engineer responsible for wiring a project together after all tasks are coded.

You have tools available:
- bash_exec: run shell commands (build, import checks, linting)
- read_file: read any file in the workspace
- write_file: write or overwrite a file in the workspace
- list_dir: list directory contents

Workflow:
1. Use list_dir to get the project structure
2. Read key entry points and configuration files to find integration issues: broken imports, missing wiring, interface mismatches, wrong file paths
3. Fix each issue by writing the corrected file with write_file
4. Run a build or import check after your fixes to confirm they work
5. When everything is wired correctly, stop calling tools and write a brief summary

If nothing needs fixing, say so immediately without calling any tools.`;

export class IntegrationAgent extends BaseAgent {
  protected tier = ModelTier.REASONING;

  async run(args: Record<string, unknown>): Promise<AgentResult> {
    const messages: any[] = [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: `Spec:\n${args["spec"]}\n\nArchitecture:\n${args["architecture"]}\n\nWorkspace root: ${args["workspace"]}`,
      },
    ];
    const opts: AgentRunOptions = { skillContext: args["skillContext"] as AgentRunOptions["skillContext"] };
    const summary = await this.runAgenticLoop(messages, String(args["workspace"] ?? ""), undefined, opts);
    return { success: true, output: summary || "Integration complete" };
  }
}
