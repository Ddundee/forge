import { BaseAgent, AgentResult } from "./base.js";
import { ModelTier } from "../router.js";

const SYSTEM = `You are a test engineer. Write tests for this project and make them pass.

You have tools available:
- bash_exec: run the test suite and see results
- read_file: read source files to understand what to test
- write_file: write test files
- list_dir: list directory contents

Workflow:
1. Use list_dir and read_file to understand the source code structure
2. Write tests using write_file — import only from files that actually exist
3. Run the tests with bash_exec to see results
4. Fix any failing tests by writing corrected files
5. Repeat until tests pass or you have exhausted reasonable fixes
6. Write a summary of what you tested and the final result

Critical rules:
- ONLY import from files that ACTUALLY EXIST (verify with read_file first)
- Do NOT invent utility functions that don't exist in the source
- Keep tests simple — test one behaviour per test`;

export class TestAgent extends BaseAgent {
  protected tier = ModelTier.REASONING;

  async run(args: Record<string, unknown>): Promise<AgentResult> {
    const architecture = args["architecture"] as string;
    let arch: Record<string, unknown> = {};
    try { arch = typeof architecture === "string" ? JSON.parse(architecture) : architecture; } catch {}
    const framework = String(arch["test_framework"] ?? "jest");
    const workspace = String(args["workspace"] ?? "");
    const messages: any[] = [
      { role: "system", content: SYSTEM },
      { role: "user", content: `Test framework: ${framework}\nWorkspace root: ${workspace}` },
    ];
    const summary = await this.runAgenticLoop(messages, workspace);
    const lower = summary.toLowerCase();
    const passed = lower.includes("pass") || summary.includes("✓") || lower.includes("success") || lower.includes("all tests");
    return { success: passed, output: summary, error: passed ? undefined : "tests_failed" };
  }
}
