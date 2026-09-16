import * as fs from "fs";
import * as path from "path";
import chalk, { type ChalkInstance } from "chalk";
import { SESSIONS_DIR, Session } from "../session.js";
import { ForgeDb } from "../db.js";

const PHASE_COLORS: Record<string, ChalkInstance> = {
  IDEATION: chalk.magenta,
  ARCHITECTURE: chalk.blue,
  TASK_GRAPH: chalk.yellow,
  CODING: chalk.cyan,
  INTEGRATION: chalk.green,
  TESTING: chalk.yellowBright,
  VERIFICATION: chalk.greenBright,
  DEPLOY: chalk.blueBright,
  DONE: chalk.green,
  FAILED: chalk.red,
};

export async function showLogs(sessionId?: string): Promise<void> {
  let db: ForgeDb;
  let sid: string;
  if (sessionId) {
    sid = sessionId;
    const dbPath = path.join(SESSIONS_DIR, sessionId, "session.db");
    if (!fs.existsSync(dbPath)) {
      console.log(chalk.red(`Session not found: ${sessionId}`));
      return;
    }
    db = new ForgeDb(dbPath);
  } else {
    const s = Session.loadLast();
    sid = s.id;
    db = s.db;
  }

  const row = db.getSession(sid);
  if (row) {
    const cost = db.getTotalCost(sid);
    console.log(`\n${chalk.bold.cyan(String(row["id"]))}  ${String(row["idea"]).slice(0, 50)}  ${chalk.dim(String(row["phase"]))}  ${chalk.green(`$${cost.toFixed(4)}`)}\n`);
  }

  const events = db.getEvents(sid);
  for (const e of events) {
    const phase = String(e.phase);
    const color = PHASE_COLORS[phase] ?? chalk.white;
    console.log(`${chalk.dim(String(e.timestamp).slice(0, 19))} ${color(phase.padEnd(14))} ${String(e.message)}`);
  }
}
