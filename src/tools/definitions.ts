import { tool } from "ai";
import { z } from "zod";

export const TOOL_DEFINITIONS = {
  bash_exec: tool({
    description: "Execute a bash command in the project workspace directory. Use for: running tests, building, checking syntax, installing packages, inspecting directory structure. stdout and stderr are captured.",
    parameters: z.object({
      command: z.string().describe("The bash command to run. Runs with cwd=workspace."),
      timeout: z.number().describe("Max seconds to wait (e.g. 60)."),
    }),
  }),
  read_file: tool({
    description: "Read the full contents of a file in the workspace. Path is relative to the workspace root.",
    parameters: z.object({
      path: z.string().describe("Relative path from workspace root, e.g. 'src/App.tsx'"),
    }),
  }),
  write_file: tool({
    description: "Write (or overwrite) a file in the workspace. Creates parent directories automatically. Path is relative to workspace root.",
    parameters: z.object({
      path: z.string().describe("Relative path from workspace root"),
      content: z.string().describe("Full file content to write"),
    }),
  }),
  list_dir: tool({
    description: "List files and directories at a given path in the workspace. Path is relative to workspace root.",
    parameters: z.object({
      path: z.string().describe("Relative path to list (e.g. '.' for workspace root)."),
    }),
  }),
};
