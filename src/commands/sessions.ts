import * as fs from "fs";
import * as path from "path";
import chalk from "chalk";
import Table from "cli-table3";
import { SESSIONS_DIR } from "../session.js";
import { ForgeDb } from "../db.js";

/**
 * Formats an ISO timestamp as relative time.
 *
 * @param iso - The ISO timestamp to format
 * @returns A relative time string such as `"just now"`, `"5m ago"`, `"3h ago"`, or `"2d ago"`
 */
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

/**
 * Lists Forge sessions in a formatted table, or switches to Claude sessions when requested.
 *
 * @param opts - Configuration object. Set `claude` to true to list Claude sessions instead of Forge sessions.
 */
```
export async function listSessions(opts: { claude?: boolean } = {}): Promise<void> {
  if (!fs.existsSync(SESSIONS_DIR)) { console.log("No sessions yet."); return; }
  if (opts.claude) { listClaudeSessions(); return; }

  const table = new Table({ head: ["ID", "Idea", "Status", "Cycle", "Cost ($)", "Created"] });

  for (const entry of fs.readdirSync(SESSIONS_DIR).sort().reverse()) {
    const dbPath = path.join(SESSIONS_DIR, entry, "session.db");
    if (!fs.existsSync(dbPath)) continue;
    const db = new ForgeDb(dbPath);
    for (const row of db.listSessions()) {
      const phase = String(row["phase"]);
      const status = phase === "DONE" ? chalk.green("✓ done")
        : phase === "FAILED" ? chalk.red("✗ failed")
        : chalk.cyan(`⟳ ${phase.toLowerCase()}`);
      table.push([
        chalk.cyan(String(row["id"])),
        String(row["idea"]).slice(0, 50),
        status,
        String(row["cycle"]),
        `$${Number(row["total_cost"]).toFixed(4)}`,
        timeAgo(String(row["created_at"])),
      ]);
    }
    db.close();
  }
  console.log(table.toString());
}

/**
 * Displays Claude session information across all forge sessions, including attach commands for active sessions.
 */
function listClaudeSessions(): void {
  const table = new Table({ head: ["Forge", "Role", "Claude session", "Status", "Cwd"] });
  const attachLines: string[] = [];
  for (const entry of fs.readdirSync(SESSIONS_DIR).sort().reverse()) {
    const dbPath = path.join(SESSIONS_DIR, entry, "session.db");
    if (!fs.existsSync(dbPath)) continue;
    const db = new ForgeDb(dbPath);
    for (const row of db.listClaudeSessions()) {
      table.push([
        chalk.cyan(String(row["forge_session_id"])),
        String(row["role"]),
        String(row["claude_session_id"] ?? "(not started)"),
        String(row["status"]),
        String(row["cwd"]),
      ]);
      if (row["claude_session_id"]) {
        attachLines.push(`  cd ${row["cwd"]} && claude --resume ${row["claude_session_id"]}`);
      }
    }
    db.close();
  }
  console.log(table.toString());
  if (attachLines.length) {
    console.log("\nAttach with:");
    for (const line of attachLines) console.log(line);
  }
}
