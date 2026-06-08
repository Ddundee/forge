import { spawn } from "child_process";
import type { SkillCandidate } from "./types.js";

export interface SkillsCliOptions {
  command?: string;
  baseArgs?: string[];
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

export interface SkillsCliCommandResult {
  command: string;
  args: string[];
  cwd: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface SkillsFindResult {
  query: string;
  candidates: SkillCandidate[];
  rawOutput: string;
}

export interface SkillsUseResult {
  source: string;
  skillName: string;
  prompt: string;
  skillMarkdown?: string;
  supportDir?: string;
  rawOutput: string;
}

export interface SkillsAvailableSkill {
  name: string;
  description: string;
}

export interface SkillsListEntry {
  name: string;
  path: string;
  scope: "project" | "global" | string;
  agents: string[];
}

export interface SkillsInstallRequest {
  source: string;
  skillName: string;
  workspace: string;
  agents: string[];
  copy?: boolean;
}

export interface SkillsInstallResult {
  source: string;
  skillName: string;
  command: SkillsCliCommandResult;
  installed: SkillsListEntry[];
}

export class SkillsCliError extends Error {
  constructor(
    message: string,
    public readonly result?: SkillsCliCommandResult,
  ) {
    super(message);
    this.name = "SkillsCliError";
  }
}

const DEFAULT_COMMAND = "npx";
const DEFAULT_BASE_ARGS = ["--yes", "skills"];
const DEFAULT_TIMEOUT_MS = 120_000;

function makeSkillsEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...extra,
    DISABLE_TELEMETRY: "1",
    DO_NOT_TRACK: "1",
    NO_COLOR: "1",
  };
}

function formatSkillsError(result: SkillsCliCommandResult): string {
  const detail = stripAnsi(`${result.stderr}\n${result.stdout}`).trim();
  return `skills exited ${result.exitCode}: ${detail.slice(0, 1000)}`;
}

export function stripAnsi(text: string): string {
  return text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}

export function parseInstallCount(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const trimmed = text.trim().toUpperCase();
  const match = trimmed.match(/^(\d+(?:\.\d+)?)([KM])?/);
  if (!match) return undefined;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return undefined;
  if (match[2] === "M") return Math.round(value * 1_000_000);
  if (match[2] === "K") return Math.round(value * 1_000);
  return Math.round(value);
}

export function parseFindOutput(query: string, output: string): SkillsFindResult {
  const clean = stripAnsi(output);
  if (/No skills found/i.test(clean)) {
    return { query, candidates: [], rawOutput: output };
  }

  const lines = clean.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const candidates: SkillCandidate[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const match = line.match(/^([^/\s]+)\/([^@\s]+)@([^\s]+)(?:\s+(.+? installs?))?$/i);
    if (!match) continue;

    const sourceOwner = match[1]!;
    const sourceRepo = match[2]!;
    const skillName = match[3]!;
    const installText = match[4];
    const nextLine = lines[i + 1] ?? "";
    const url = nextLine.startsWith("└ ") ? nextLine.slice(2).trim() : undefined;

    candidates.push({
      packageRef: `${sourceOwner}/${sourceRepo}`,
      skillName,
      title: skillName,
      url,
      installCount: parseInstallCount(installText),
      raw: { query, line, urlLine: nextLine },
    });
  }

  return { query, candidates, rawOutput: output };
}

export function parseAvailableSkillsOutput(output: string): SkillsAvailableSkill[] {
  const clean = stripAnsi(output);
  const lines = clean.split(/\r?\n/);
  const skills: SkillsAvailableSkill[] = [];

  for (let i = 0; i < lines.length; i++) {
    const name = lines[i]?.trim() ?? "";
    const next = lines[i + 1]?.trim() ?? "";
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(name)) continue;
    if (!next || /^(Source|Repository|Found|Available|Use --skill)/i.test(next)) continue;
    skills.push({ name, description: next });
  }

  return skills;
}

export function parseUseOutput(source: string, skillName: string, output: string): SkillsUseResult {
  const skillMatch = output.match(/<SKILL\.md>\n([\s\S]*?)\n<\/SKILL\.md>/);
  const supportMatch = output.match(/Supporting files for this skill were downloaded to:\n(.+)\n/);
  return {
    source,
    skillName,
    prompt: output,
    skillMarkdown: skillMatch?.[1],
    supportDir: supportMatch?.[1]?.trim(),
    rawOutput: output,
  };
}

export function parseListJson(output: string): SkillsListEntry[] {
  const parsed = JSON.parse(output) as unknown;
  if (!Array.isArray(parsed)) {
    throw new SkillsCliError("skills list --json did not return an array");
  }
  return (parsed as Record<string, unknown>[])
    .map((item) => ({
      name: String(item["name"] ?? ""),
      path: String(item["path"] ?? ""),
      scope: String(item["scope"] ?? ""),
      agents: Array.isArray(item["agents"]) ? item["agents"].map(String) : [],
    }))
    .filter((row) => row.name && row.path);
}

export class SkillsCli {
  constructor(private readonly options: SkillsCliOptions = {}) {}

  private run(
    args: string[],
    cwd: string,
    timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  ): Promise<SkillsCliCommandResult> {
    const command = this.options.command ?? DEFAULT_COMMAND;
    const fullArgs = [...(this.options.baseArgs ?? DEFAULT_BASE_ARGS), ...args];
    const started = Date.now();

    return new Promise((resolve, reject) => {
      const child = spawn(command, fullArgs, {
        cwd,
        env: makeSkillsEnv(this.options.env),
        stdio: ["ignore", "pipe", "pipe"],
      });

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
        finish(() => reject(new SkillsCliError(`skills timed out after ${timeoutMs / 1000}s`)));
      }, timeoutMs);

      child.on("error", (err) => {
        finish(() => {
          if ((err as NodeJS.ErrnoException).code === "ENOENT") {
            reject(new SkillsCliError("npx not found; install Node.js/npm or provide a skills command override"));
          } else {
            reject(err);
          }
        });
      });

      child.on("close", (code) => {
        const result: SkillsCliCommandResult = {
          command,
          args: fullArgs,
          cwd,
          exitCode: code ?? 1,
          stdout,
          stderr,
          durationMs: Date.now() - started,
        };
        finish(() => {
          if (result.exitCode !== 0) {
            reject(new SkillsCliError(formatSkillsError(result), result));
          } else {
            resolve(result);
          }
        });
      });
    });
  }

  async version(workspace: string): Promise<string | undefined> {
    const result = await this.run(["--version"], workspace);
    return result.stdout.trim() || undefined;
  }

  async find(query: string, workspace: string): Promise<SkillsFindResult> {
    const result = await this.run(["find", query], workspace);
    return parseFindOutput(query, result.stdout);
  }

  async listAvailable(source: string, workspace: string): Promise<{
    source: string;
    skills: SkillsAvailableSkill[];
    rawOutput: string;
  }> {
    const result = await this.run(["add", source, "--list"], workspace);
    return {
      source,
      skills: parseAvailableSkillsOutput(result.stdout),
      rawOutput: result.stdout,
    };
  }

  async use(source: string, skillName: string, workspace: string): Promise<SkillsUseResult> {
    const result = await this.run(["use", source, "--skill", skillName], workspace);
    return parseUseOutput(source, skillName, result.stdout);
  }

  async install(request: SkillsInstallRequest): Promise<SkillsInstallResult> {
    const installArgs = [
      "add",
      request.source,
      "--skill",
      request.skillName,
      ...(request.copy ? ["--copy"] : []),
      "--yes",
      "--agent",
      ...request.agents,
    ];
    const commandResult = await this.run(installArgs, request.workspace);
    const installed = await this.listInstalled(request.workspace);
    return {
      source: request.source,
      skillName: request.skillName,
      command: commandResult,
      installed,
    };
  }

  async listInstalled(workspace: string, agent?: string): Promise<SkillsListEntry[]> {
    const args = agent
      ? ["list", "--json", "--agent", agent]
      : ["list", "--json"];
    const result = await this.run(args, workspace);
    return parseListJson(result.stdout);
  }
}
