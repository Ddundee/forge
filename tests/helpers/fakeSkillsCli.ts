import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface FakeSkillsInvocation {
  cwd: string;
  args: string[];
  env: Record<string, string | undefined>;
}

export interface FakeSkillsScenario {
  find?: Record<string, string>;
  use?: Record<string, string>;
  add?: Record<string, string>;
  listJson?: unknown[];
  failures?: Record<string, { code: number; stderr: string }>;
  delayMs?: number;
}

const FAKE_NPX_SCRIPT = `#!/usr/bin/env node
const fs = require("fs");
const args = process.argv.slice(2);
const callsPath = process.env.FORGE_FAKE_SKILLS_CALLS;
const scenario = JSON.parse(
  Buffer.from(process.env.FORGE_FAKE_SKILLS_SCENARIO || "e30=", "base64").toString("utf8"),
);

if (callsPath) {
  try {
    fs.appendFileSync(
      callsPath,
      JSON.stringify({
        cwd: process.cwd(),
        args,
        env: {
          DISABLE_TELEMETRY: process.env.DISABLE_TELEMETRY,
          DO_NOT_TRACK: process.env.DO_NOT_TRACK,
          NO_COLOR: process.env.NO_COLOR,
        },
      }) + "\\n",
    );
  } catch (_) {}
}

if (args[0] !== "--yes" || args[1] !== "skills") {
  process.stderr.write("expected npx --yes skills\\n");
  process.exit(64);
}

const command = args[2];
const rest = args.slice(3);

if (scenario.delayMs) {
  const end = Date.now() + scenario.delayMs;
  while (Date.now() < end) {}
}

const key = [command, ...rest].join(" ");
const failure = scenario.failures && scenario.failures[key];
if (failure) {
  process.stderr.write(failure.stderr + "\\n");
  process.exit(failure.code);
}

if (command === "find") {
  const q = rest.join(" ");
  const response = (scenario.find && scenario.find[q]) || "No skills found\\n";
  process.stdout.write(response);
  process.exit(0);
}

if (command === "use") {
  const source = rest[0] || "";
  const skillIndex = rest.indexOf("--skill");
  const skill = skillIndex >= 0 ? (rest[skillIndex + 1] || "") : "";
  const response = (scenario.use && scenario.use[source + "@" + skill]) || "";
  process.stdout.write(response);
  process.exit(0);
}

if (command === "add" && rest.includes("--list")) {
  const src = rest[0] || "";
  const response = (scenario.add && scenario.add[src]) || "Found 0 skills\\n";
  process.stdout.write(response);
  process.exit(0);
}

if (command === "add") {
  process.stdout.write("Added skill\\n");
  process.exit(0);
}

if (command === "list" && rest.includes("--json")) {
  process.stdout.write(JSON.stringify(scenario.listJson || []));
  process.exit(0);
}

process.stderr.write("unsupported fake skills command: " + command + "\\n");
process.exit(64);
`;

export async function withFakeSkillsCli<T>(
  scenario: FakeSkillsScenario,
  run: (ctx: { env: NodeJS.ProcessEnv; callsPath: string }) => Promise<T>,
): Promise<T> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "forge-fake-skills-"));
  const bin = path.join(root, "bin");
  const callsPath = path.join(root, "calls.jsonl");
  fs.mkdirSync(bin, { recursive: true });

  const fakeNpxPath = path.join(bin, "npx");
  fs.writeFileSync(fakeNpxPath, FAKE_NPX_SCRIPT, { mode: 0o755 });

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env["PATH"] ?? ""}`,
    FORGE_FAKE_SKILLS_SCENARIO: Buffer.from(JSON.stringify(scenario)).toString("base64"),
    FORGE_FAKE_SKILLS_CALLS: callsPath,
  };

  try {
    return await run({ env, callsPath });
  } finally {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch (_) {}
  }
}

export function readJsonLines<T>(filePath: string): T[] {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    return content
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as T);
  } catch {
    return [];
  }
}
