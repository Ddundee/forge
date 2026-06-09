import { exec } from "child_process";
import { BaseAgent, AgentResult, type AgentRunOptions } from "./base.js";
import { ModelTier } from "../router.js";

const DEPLOY_TIMEOUT_MS = 600_000;

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

    // Async with a hard timeout: execSync would block the event loop (and the
    // live UI) indefinitely if the deploy CLI hangs or prompts for input.
    return new Promise<AgentResult>((resolve) => {
      exec(
        cmd.join(" "),
        { cwd: workspace, encoding: "utf8", timeout: DEPLOY_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
        (err, stdout, stderr) => {
          if (!err) resolve({ success: true, output: stdout });
          else resolve({ success: false, output: (stdout ?? "") + (stderr ?? ""), error: "deploy_failed" });
        },
      );
    });
  }
}
