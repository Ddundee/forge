import { execSync } from "child_process";
import { BaseAgent, AgentResult, type AgentRunOptions } from "./base.js";
import { ModelTier } from "../router.js";

const DEPLOY_CMDS: Record<string, string[]> = {
  vercel: ["vercel", "--yes"],
  railway: ["railway", "up"],
  "fly.io": ["fly", "deploy"],
};

export class DeployAgent extends BaseAgent {
  protected tier = ModelTier.STANDARD;

  async run(args: Record<string, unknown>): Promise<AgentResult> {
    const target = String(args["target"] ?? "");
    const workspace = String(args["workspace"] ?? "");
    const cmd = DEPLOY_CMDS[target];
    if (!cmd) return { success: false, output: "", error: `Unknown deploy target: ${target}` };

    if (this.externalAgentMode()) {
      const messages: any[] = [
        {
          role: "system",
          content: "You are a release engineer. Deploy the project from the workspace using the requested target. Run the necessary CLI command, inspect failures, fix only deployment-blocking issues, and summarize the result.",
        },
        {
          role: "user",
          content: `Deploy target: ${target}\nSuggested command: ${cmd.join(" ")}\nArchitecture:\n${args["architecture"]}\n\nWorkspace root: ${workspace}`,
        },
      ];
      const opts: AgentRunOptions = { skillContext: args["skillContext"] as AgentRunOptions["skillContext"] };
      const output = await this.runAgenticLoop(messages, workspace, undefined, opts);
      return { success: true, output: output || `Deploy attempted for ${target}` };
    }

    try {
      const output = execSync(cmd.join(" "), { cwd: workspace, encoding: "utf8", stdio: "pipe" });
      return { success: true, output };
    } catch (e: any) {
      return { success: false, output: (e.stdout ?? "") + (e.stderr ?? ""), error: "deploy_failed" };
    }
  }
}
