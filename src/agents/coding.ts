import * as fs from "fs";
import * as path from "path";
import { BaseAgent, AgentResult, type AgentRunOptions } from "./base.js";
import { ModelTier } from "../router.js";

const SYSTEM = `You are a senior software engineer implementing one focused coding task.

You have tools available:
- bash_exec: run shell commands (build, lint, syntax check, install packages)
- read_file: read any file in the workspace
- write_file: write or overwrite a file in the workspace
- list_dir: list directory contents

Workflow:
1. Use list_dir and read_file to understand the existing codebase and conventions
2. Write the files needed for this task using write_file
3. Run a quick sanity check (e.g. npx tsc --noEmit) if useful
4. When the task is complete, output a brief summary of what you wrote

Rules:
- Write complete, working code — no placeholders or TODOs
- Match the existing code style you observe in the workspace
- Follow the architecture and stack decisions exactly`;

// Dependency/build dirs are huge and not authored by the agent — snapshotting
// them would write tens of thousands of artifact rows per task.
const SKIP_DIRS = new Set([
  "node_modules", "dist", "build", "coverage", "__pycache__", "venv", "target", "vendor",
]);
const MAX_ARTIFACT_BYTES = 256 * 1024;

export class CodingAgent extends BaseAgent {
  protected tier = ModelTier.REASONING;

  async run(args: Record<string, unknown>): Promise<AgentResult> {
    const taskTitle = String(args["taskTitle"] ?? "");
    const spec = String(args["spec"] ?? "");
    const architecture = String(args["architecture"] ?? "");
    const workspace = String(args["workspace"] ?? "");
    const context = args["context"] ? String(args["context"]) : undefined;
    const taskId = args["taskId"] ? String(args["taskId"]) : undefined;

    const messages: any[] = [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: `Task: ${taskTitle}\n\nSpec:\n${spec}\n\nArchitecture:\n${architecture}${context ? `\n\nContext from prior tasks:\n${context}` : ""}\n\nWorkspace root: ${workspace}`,
      },
    ];
    const opts: AgentRunOptions = { skillContext: args["skillContext"] as AgentRunOptions["skillContext"] };
    const summary = await this.runAgenticLoop(messages, workspace, taskId, opts);
    const written: string[] = [];
    for (const entry of this.walkWorkspace(workspace)) {
      try {
        const content = fs.readFileSync(entry.full, "utf8");
        this.db.saveArtifact(this.sessionId, entry.rel, content);
        written.push(entry.rel);
      } catch {}
    }
    return { success: true, output: summary || `Wrote ${written.length} files` };
  }

  private walkWorkspace(workspace: string): { full: string; rel: string }[] {
    const result: { full: string; rel: string }[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const name = entry.name;
        if (name.startsWith(".")) continue;
        const full = path.join(dir, name);
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(name)) walk(full);
        } else if (entry.isFile()) {
          if (fs.statSync(full).size <= MAX_ARTIFACT_BYTES) {
            result.push({ full, rel: path.relative(workspace, full) });
          }
        }
      }
    };
    if (fs.existsSync(workspace)) walk(workspace);
    return result;
  }
}
