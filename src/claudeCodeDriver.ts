import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";

const INSTALL_GUIDANCE = [
  "claude CLI not found. Install Claude Code with one of:",
  "curl -fsSL https://claude.ai/install.sh | bash",
  "brew install --cask claude-code",
].join("\n");

function resultFromStdout(stdout: string): string {
  try {
    const parsed = JSON.parse(stdout.trim()) as { result?: unknown };
    if (Object.prototype.hasOwnProperty.call(parsed, "result")) {
      return typeof parsed.result === "string" ? parsed.result : JSON.stringify(parsed.result);
    }
  } catch {}
  return stdout;
}

function exitsZero(command: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: "ignore" });
    child.on("close", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}

export interface ClaudeCodeReadyStatus {
  installed: boolean;
  authenticated: boolean;
  ready: boolean;
}

export class ClaudeCodeDriver {
  async runTask(
    prompt: string,
    workdir: string,
    timeoutMs = 300_000,
  ): Promise<string> {
    fs.mkdirSync(workdir, { recursive: true });

    let taskArg: string;
    if (prompt.length > 8_192) {
      const taskFile = path.join(workdir, ".forge-claude-task.md");
      fs.writeFileSync(taskFile, prompt, "utf8");
      taskArg = "Read the file .forge-claude-task.md and follow its instructions exactly. Delete the file when done.";
    } else {
      taskArg = prompt;
    }

    const args = [
      "-p",
      taskArg,
      "--output-format",
      "json",
      "--permission-mode",
      process.env["FORGE_CLAUDE_CODE_PERMISSION_MODE"] ?? "auto",
      "--max-turns",
      process.env["FORGE_CLAUDE_CODE_MAX_TURNS"] ?? "40",
    ];

    return new Promise((resolve, reject) => {
      const child = spawn(
        "claude",
        args,
        { cwd: workdir, env: process.env, stdio: ["ignore", "pipe", "pipe"] },
      );

      let stdout = "";
      let stderr = "";
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
      child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        fn();
      };

      timer = setTimeout(() => {
        child.kill("SIGTERM");
        finish(() => reject(new Error(`Claude Code timed out after ${timeoutMs / 1000}s`)));
      }, timeoutMs);

      child.on("error", (err) => {
        finish(() => {
          if ((err as NodeJS.ErrnoException).code === "ENOENT") {
            reject(new Error(INSTALL_GUIDANCE));
          } else {
            reject(err);
          }
        });
      });

      child.on("close", (code) => {
        finish(() => {
          if (code !== 0) {
            reject(new Error(`claude exited ${code}: ${stderr.slice(0, 500)}`));
          } else {
            resolve(resultFromStdout(stdout));
          }
        });
      });
    });
  }
}

export async function checkClaudeCodeReady(): Promise<ClaudeCodeReadyStatus> {
  const installed = await exitsZero("claude", ["--version"]);
  if (!installed) return { installed, authenticated: false, ready: false };
  const authenticated = await exitsZero("claude", ["auth", "status"]);
  return { installed, authenticated, ready: authenticated };
}

export function claudeCodeInstallGuidance(): string {
  return INSTALL_GUIDANCE;
}
