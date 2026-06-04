import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const BLOCKED_PATTERNS = [
  "rm -rf /", "rm -rf ~", ":(){ :|:& };:", "dd if=/dev/zero",
  "mkfs", "> /dev/sda", "chmod 777 /", "chown -R", "sudo rm", "sudo dd",
];

function isBlocked(command: string): boolean {
  const lower = command.toLowerCase();
  return BLOCKED_PATTERNS.some(p => lower.includes(p));
}

function bashExec(args: Record<string, unknown>, workspace: string): string {
  const command = String(args["command"] ?? "");
  const timeout = Number(args["timeout"] ?? 60) * 1000;
  if (!command.trim()) return "ERROR: Empty command";
  if (isBlocked(command)) return `ERROR: Command blocked for safety: ${command}`;
  try {
    const stdout = execSync(command, { cwd: workspace, timeout, encoding: "utf8", stdio: "pipe" });
    const out = stdout.length > 8000
      ? stdout.slice(0, 4000) + "\n... [truncated] ...\n" + stdout.slice(-4000)
      : stdout;
    return out + "\n[exit 0]";
  } catch (e: any) {
    const out = (e.stdout ?? "") + (e.stderr ? `\n[stderr]\n${e.stderr}` : "");
    return out + `\n[exit ${e.status ?? 1}]`;
  }
}

function resolveInWorkspace(relPath: string, workspace: string): string | null {
  const resolved = path.resolve(workspace, relPath);
  if (!resolved.startsWith(path.resolve(workspace) + path.sep) && resolved !== path.resolve(workspace)) return null;
  return resolved;
}

function readFile(args: Record<string, unknown>, workspace: string): string {
  const relPath = String(args["path"] ?? "");
  if (!relPath) return "ERROR: No path provided";
  const target = resolveInWorkspace(relPath, workspace);
  if (!target) return `ERROR: Path escapes workspace: ${relPath}`;
  if (!fs.existsSync(target)) return `ERROR: File not found: ${relPath}`;
  if (!fs.statSync(target).isFile()) return `ERROR: Not a file: ${relPath}`;
  try {
    let content = fs.readFileSync(target, "utf8");
    if (content.length > 16000) content = content.slice(0, 8000) + "\n... [truncated] ...\n" + content.slice(-8000);
    return content;
  } catch (e: any) {
    return `ERROR reading ${relPath}: ${e.message}`;
  }
}

function writeFile(args: Record<string, unknown>, workspace: string): string {
  const relPath = String(args["path"] ?? "");
  const content = String(args["content"] ?? "");
  if (!relPath) return "ERROR: No path provided";
  const target = resolveInWorkspace(relPath, workspace);
  if (!target) return `ERROR: Path escapes workspace: ${relPath}`;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, "utf8");
    return `OK: Wrote ${content.length} chars to ${relPath}`;
  } catch (e: any) {
    return `ERROR writing ${relPath}: ${e.message}`;
  }
}

function listDir(args: Record<string, unknown>, workspace: string): string {
  const relPath = String(args["path"] ?? ".");
  const target = resolveInWorkspace(relPath, workspace);
  if (!target) return `ERROR: Path escapes workspace: ${relPath}`;
  if (!fs.existsSync(target)) return `ERROR: Path not found: ${relPath}`;
  if (!fs.statSync(target).isDirectory()) return `ERROR: Not a directory: ${relPath}`;
  const items = fs.readdirSync(target).sort().map(name => {
    const isDir = fs.statSync(path.join(target, name)).isDirectory();
    return `[${isDir ? "d" : "f"}] ${name}`;
  });
  return items.length ? items.join("\n") : "(empty directory)";
}

export function executeTool(name: string, args: Record<string, unknown>, workspace: string): string {
  if (name === "bash_exec") return bashExec(args, workspace);
  if (name === "read_file") return readFile(args, workspace);
  if (name === "write_file") return writeFile(args, workspace);
  if (name === "list_dir") return listDir(args, workspace);
  return `ERROR: Unknown tool '${name}'`;
}
