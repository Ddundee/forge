import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";
import chalk from "chalk";
import { SESSIONS_DIR } from "../session.js";
import { ForgeDb } from "../db.js";

export interface AttachTarget {
  forgeSessionId: string;
  claudeSessionId: string;
  cwd: string;
  role: string;
  active: boolean;
}

function latestForgeSessionId(sessionsDir: string): string | undefined {
  if (!fs.existsSync(sessionsDir)) return undefined;
  const dirs = fs.readdirSync(sessionsDir)
    .filter((name) => fs.existsSync(path.join(sessionsDir, name, "session.db")))
    .map((name) => ({ name, mtime: fs.statSync(path.join(sessionsDir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return dirs[0]?.name;
}

/** Pure resolution logic, unit-testable without spawning anything. */
export function resolveAttachTarget(
  sessionsDir: string,
  taskId: string | undefined,
  forgeSessionId: string | undefined,
): AttachTarget | undefined {
  const forgeId = forgeSessionId ?? latestForgeSessionId(sessionsDir);
  if (!forgeId) return undefined;
  const dbPath = path.join(sessionsDir, forgeId, "session.db");
  if (!fs.existsSync(dbPath)) return undefined;
  const db = new ForgeDb(dbPath);
  try {
    const role = taskId ? `worker:${taskId}` : "main";
    const row = db.findClaudeSession(forgeId, role);
    const claudeSessionId = row?.["claude_session_id"];
    if (!claudeSessionId) return undefined;
    const phase = String(db.getSession(forgeId)?.["phase"] ?? "");
    return {
      forgeSessionId: forgeId,
      claudeSessionId: String(claudeSessionId),
      cwd: String(row?.["cwd"] ?? process.cwd()),
      role,
      active: phase !== "DONE" && phase !== "FAILED",
    };
  } finally {
    db.close();
  }
}

export async function attachSession(taskId?: string, opts: { session?: string } = {}): Promise<void> {
  const target = resolveAttachTarget(SESSIONS_DIR, taskId, opts.session);
  if (!target) {
    console.log(taskId
      ? `No Claude session recorded for task "${taskId}". Run forgecli sessions --claude to list sessions.`
      : "No Claude sessions recorded yet. Run a build with the claude-code profile first.");
    return;
  }
  if (target.active) {
    console.log(chalk.yellow(
      "Warning: this build is still active. Attaching now interleaves your messages into the live transcript.",
    ));
  }
  console.log(`Resuming Claude session ${target.claudeSessionId} (${target.role}) in ${target.cwd}…`);
  const child = spawn("claude", ["--resume", target.claudeSessionId], { cwd: target.cwd, stdio: "inherit" });
  await new Promise<void>((resolve, reject) => {
    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        reject(new Error("claude CLI not found. Install it to attach:\n  curl -fsSL https://claude.ai/install.sh | bash"));
      } else {
        reject(err);
      }
    });
    child.on("close", () => resolve());
  });
}
