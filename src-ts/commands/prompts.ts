import * as fs from "fs";
import chalk from "chalk";
import { logPath } from "../promptLog.js";
import { Session } from "../session.js";

const TIER_COLORS: Record<string, chalk.Chalk> = {
  overseer: chalk.magenta,
  reasoning: chalk.blue,
  standard: chalk.cyan,
  fast: chalk.green,
};

function renderEntry(raw: string, verbose: boolean): void {
  let e: any;
  try { e = JSON.parse(raw); } catch { return; }
  const tier = e.tier ?? "";
  const color = TIER_COLORS[tier] ?? chalk.white;
  const model = String(e.model ?? "?").split("/").pop();
  const ts = String(e.ts ?? "").slice(0, 19).replace("T", " ");
  const header = `${color.bold((tier.toUpperCase() + " ").slice(0, 8))}  ${chalk.bold(e.agent ?? "?")}  ${chalk.dim(model)}  ${chalk.dim(ts)}  ${chalk.cyan(`↑${e.tokens_in ?? 0} ↓${e.tokens_out ?? 0}`)}  ${chalk.green(`$${(e.cost_usd ?? 0).toFixed(4)}`)}`;
  console.log(header);
  if (e.tools_called?.length) console.log(`  ${chalk.yellow("Tools:")} ${e.tools_called.join(" → ")}`);
  const limit = verbose ? undefined : 200;
  if (e.user_prompt) {
    const text = limit ? String(e.user_prompt).slice(0, limit) + (String(e.user_prompt).length > limit ? "…" : "") : e.user_prompt;
    console.log(`  ${chalk.dim("Prompt:")} ${text}`);
  }
  if (e.response) {
    const text = limit ? String(e.response).slice(0, limit) + (String(e.response).length > limit ? "…" : "") : e.response;
    console.log(`  ${chalk.dim("Reply :")} ${text}`);
  }
  console.log(chalk.dim("─".repeat(80)));
}

export async function showPrompts(sessionId?: string, opts?: { follow?: boolean; verbose?: boolean }): Promise<void> {
  const sid = sessionId ?? Session.loadLast().id;
  const lp = logPath(sid);
  console.log(chalk.dim(`Session ${sid}  →  ${lp}\n`));

  if (!fs.existsSync(lp)) {
    if (!opts?.follow) { console.log(chalk.dim("No prompts logged yet.")); return; }
    console.log(chalk.dim("Waiting for first prompt…"));
  }

  let pos = 0;
  const tick = () => {
    if (!fs.existsSync(lp)) return;
    const content = fs.readFileSync(lp, "utf8");
    const lines = content.slice(pos).split("\n");
    pos = content.length;
    for (const line of lines) { if (line.trim()) renderEntry(line, opts?.verbose ?? false); }
  };

  tick();
  if (opts?.follow) {
    setInterval(tick, 500);
    await new Promise(() => {});
  }
}
