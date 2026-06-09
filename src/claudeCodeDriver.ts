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
    const result = extractClaudeResult(JSON.parse(stdout.trim()));
    if (result !== undefined) return result;
  } catch {}
  return stdout;
}

function extractClaudeResult(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (let i = value.length - 1; i >= 0; i--) {
      const result = extractClaudeResult(value[i]);
      if (result !== undefined) return result;
    }
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(record, "result")) {
    return typeof record["result"] === "string" ? record["result"] : JSON.stringify(record["result"]);
  }
  const message = record["message"];
  if (typeof message === "object" && message !== null) {
    const content = (message as Record<string, unknown>)["content"];
    if (Array.isArray(content)) {
      const text = content
        .map((part) => typeof part === "object" && part !== null ? (part as Record<string, unknown>)["text"] : undefined)
        .filter((text): text is string => typeof text === "string" && text.trim().length > 0)
        .join("\n");
      if (text) return text;
    }
  }
  return undefined;
}

function nonZeroErrorMessage(code: number | null, stdout: string, stderr: string): string {
  const detail = stderr.trim() || resultFromStdout(stdout).trim() || stdout.trim();
  if (/not logged in|authentication_failed|run \/login/i.test(detail)) {
    return `Claude Code is not authenticated: ${detail}\nRun: claude auth login`;
  }
  return `claude exited ${code}: ${detail.slice(0, 500)}`;
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
        { cwd: workdir, env: process.env, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" },
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
        try {
          if (process.platform !== "win32" && child.pid) {
            process.kill(-child.pid, "SIGTERM");
          } else {
            child.kill("SIGTERM");
          }
        } catch {}
        setTimeout(() => {
          try {
            if (process.platform !== "win32" && child.pid) {
              process.kill(-child.pid, "SIGKILL");
            } else {
              child.kill("SIGKILL");
            }
          } catch {}
        }, 3000);
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
            reject(new Error(nonZeroErrorMessage(code, stdout, stderr)));
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
