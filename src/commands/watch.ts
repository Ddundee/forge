import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import chalk from "chalk";
import { SESSIONS_DIR } from "../session.js";
import { resolveAttachTarget } from "./attach.js";

const DEFAULT_PROJECTS_ROOT = path.join(os.homedir(), ".claude", "projects");

/**
 * Locates a session transcript under the Claude projects directory.
 *
 * @param claudeSessionId - The session identifier to match
 * @param projectsRoot - The root directory that contains Claude project subdirectories
 * @returns The first matching transcript path, or `undefined` if no match is found
 */
export function findTranscript(claudeSessionId: string, projectsRoot = DEFAULT_PROJECTS_ROOT): string | undefined {
  if (!fs.existsSync(projectsRoot)) return undefined;
  for (const dir of fs.readdirSync(projectsRoot)) {
    const candidate = path.join(projectsRoot, dir, `${claudeSessionId}.jsonl`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Parses and prints a formatted representation of a Claude session event.
 *
 * Assistant messages display text blocks in cyan and tool use blocks (with command or input preview) in yellow.
 * User messages display in green. Output is truncated to 200 characters for text and 120 characters for tool previews.
 * Invalid JSON input is silently ignored.
 */
function printEvent(line: string): void {
  let entry: Record<string, any>;
  try { entry = JSON.parse(line); } catch { return; }
  const msg = entry["message"];
  if (entry["type"] === "assistant" && Array.isArray(msg?.content)) {
    for (const block of msg.content) {
      if (block?.type === "text" && typeof block.text === "string" && block.text.trim()) {
        console.log(chalk.cyan(`claude> ${block.text.slice(0, 200)}`));
      } else if (block?.type === "tool_use") {
        const preview = block.name === "Bash"
          ? String(block.input?.command ?? "").slice(0, 120)
          : JSON.stringify(block.input ?? {}).slice(0, 120);
        console.log(chalk.yellow(`  ⚙ ${block.name}: ${preview}`));
      }
    }
  } else if (entry["type"] === "user" && typeof msg?.content === "string") {
    console.log(chalk.green(`user>  ${msg.content.slice(0, 200)}`));
  }
}

/**
 * Watches a Claude session transcript and prints new events as they are appended.
 *
 * If no session ID is provided, the active attach target is used. The watch ends only when the process is interrupted.
 *
 * @param claudeSessionId - The session ID to watch.
 */
export async function watchSession(claudeSessionId?: string): Promise<void> {
  const id = claudeSessionId
    ?? resolveAttachTarget(SESSIONS_DIR, undefined, undefined)?.claudeSessionId;
  if (!id) { console.log("No Claude session to watch."); return; }
  const transcript = findTranscript(id);
  if (!transcript) {
    console.log(`Transcript for ${id} not found under ~/.claude/projects (the session may not have started yet).`);
    return;
  }
  console.log(`Watching ${transcript} — Ctrl+C to stop.\n`);
  let offset = 0;
  const drain = () => {
    const size = fs.statSync(transcript).size;
    if (size <= offset) return;
    const fd = fs.openSync(transcript, "r");
    const buf = Buffer.alloc(size - offset);
    fs.readSync(fd, buf, 0, buf.length, offset);
    fs.closeSync(fd);
    offset = size;
    for (const line of buf.toString("utf8").split("\n")) {
      if (line.trim()) printEvent(line);
    }
  };
  drain();
  setInterval(drain, 500);
  await new Promise(() => {}); // read-only tail; runs until Ctrl+C
}
