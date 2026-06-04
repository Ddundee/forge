import { execSync } from "child_process";
import { BaseAgent, AgentResult } from "./base.js";
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
    try {
      const output = execSync(cmd.join(" "), { cwd: workspace, encoding: "utf8", stdio: "pipe" });
      return { success: true, output };
    } catch (e: any) {
      return { success: false, output: (e.stdout ?? "") + (e.stderr ?? ""), error: "deploy_failed" };
    }
  }
}
