import { BaseAgent, AgentResult } from "./base.js";
import { ModelTier } from "../router.js";

const SYSTEM = `You are a QA engineer verifying that a project builds and its tests pass.

You have tools available:
- bash_exec: run build commands, test suites, linters
- read_file: read files to understand failures
- write_file: apply quick fixes for obvious issues
- list_dir: list directory contents

Workflow:
1. Use list_dir to understand the project structure
2. Run the build (e.g. \`npm run build\` or \`python -m pytest\`) with bash_exec
3. If it fails: read the relevant source files, understand the error, apply a targeted fix
4. Re-run to confirm the fix worked
5. Run the test suite after a successful build
6. When satisfied, output a JSON report:

{
  "passed": ["Build succeeded", "All 5 tests passed"],
  "failed": [],
  "errors": []
}

Output ONLY the JSON report as your final message. Do not wrap it in markdown.`;

export class VerificationAgent extends BaseAgent {
  protected tier = ModelTier.REASONING;

  async run(args: Record<string, unknown>): Promise<AgentResult> {
    const workspace = String(args["workspace"] ?? "");
    const messages: any[] = [
      { role: "system", content: SYSTEM },
      { role: "user", content: `Architecture:\n${args["architecture"]}\n\nSpec:\n${args["spec"]}\n\nWorkspace root: ${workspace}` },
    ];
    const response = await this.runAgenticLoop(messages, workspace);
    let report: Record<string, unknown[]>;
    try {
      report = JSON.parse(this.extractJson(response));
    } catch {
      report = { passed: [], failed: ["Verification agent returned malformed report"], errors: [response.slice(0, 300)] };
    }
    const success = (report["failed"] as unknown[]).length === 0 && (report["errors"] as unknown[]).length === 0;
    return { success, output: JSON.stringify(report), error: success ? undefined : "verification_failed" };
  }
}
