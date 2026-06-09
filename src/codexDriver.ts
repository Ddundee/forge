import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";

export class CodexDriver {
  async runTask(
    prompt: string,
    workdir: string,
    timeoutMs = 300_000,
  ): Promise<string> {
    fs.mkdirSync(workdir, { recursive: true });

    let taskArg: string;
    if (prompt.length > 8_192) {
      const taskFile = path.join(workdir, ".forge-task.md");
      fs.writeFileSync(taskFile, prompt, "utf8");
      taskArg = `Read the file .forge-task.md and follow its instructions exactly. Delete the file when done.`;
    } else {
      taskArg = prompt;
    }

    return new Promise((resolve, reject) => {
      const child = spawn(
        "codex",
        ["exec", "--dangerously-bypass-approvals-and-sandbox", taskArg],
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
        finish(() => reject(new Error(`Codex timed out after ${timeoutMs / 1000}s`)));
      }, timeoutMs);

      child.on("error", (err) => {
        finish(() => {
          if ((err as NodeJS.ErrnoException).code === "ENOENT") {
            reject(new Error("codex CLI not found — install it with: npm install -g @openai/codex"));
          } else {
            reject(err);
          }
        });
      });

      child.on("close", (code) => {
        finish(() => {
          if (code !== 0) {
            reject(new Error(`codex exited ${code}: ${stderr.slice(0, 500)}`));
          } else {
            resolve(stdout);
          }
        });
      });
    });
  }
}

export async function checkCodexInstalled(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("codex", ["--version"], { stdio: "ignore" });
    child.on("close", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}
