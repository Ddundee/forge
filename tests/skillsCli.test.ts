import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { EventEmitter } from "events";

jest.mock("child_process", () => ({ spawn: jest.fn() }));

import { spawn } from "child_process";
import {
  SkillsCli,
  SkillsCliError,
  parseFindOutput,
  parseAvailableSkillsOutput,
  parseUseOutput,
  parseListJson,
  parseInstallCount,
} from "../src/skills/cli.js";

const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;

const fixtures = path.join(__dirname, "fixtures", "skills-cli");

function makeChild(stdout: string, stderr: string, exitCode: number) {
  const child = new EventEmitter() as any;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = jest.fn();
  setImmediate(() => {
    if (stdout) child.stdout.emit("data", Buffer.from(stdout));
    if (stderr) child.stderr.emit("data", Buffer.from(stderr));
    child.emit("close", exitCode);
  });
  return child;
}

let tmpDir: string;
let findFixture: string;
let listJsonFixture: string;

beforeAll(() => {
  findFixture = fs.readFileSync(path.join(fixtures, "find-react.txt"), "utf8");
  listJsonFixture = fs.readFileSync(path.join(fixtures, "list-json.json"), "utf8");
});

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-skills-test-"));
  jest.clearAllMocks();
});

afterEach(() => fs.rmSync(tmpDir, { recursive: true }));

// Parser tests

test("parseFindOutput parses source, skill name, installs, and URL", () => {
  const fixture = fs.readFileSync(path.join(fixtures, "find-react.txt"), "utf8");
  const result = parseFindOutput("react frontend", fixture);
  expect(result.candidates[0]).toMatchObject({
    packageRef: "vtex/skills",
    skillName: "vtex-io-react-apps",
    installCount: 415,
    url: "https://skills.sh/vtex/skills/vtex-io-react-apps",
  });
});

test("parseFindOutput returns empty candidates for no results", () => {
  const fixture = fs.readFileSync(path.join(fixtures, "find-empty.txt"), "utf8");
  expect(parseFindOutput("zzz", fixture).candidates).toEqual([]);
});

test("parseUseOutput extracts SKILL.md and support directory", () => {
  const fixture = fs.readFileSync(path.join(fixtures, "use-obsidian-markdown.txt"), "utf8");
  const result = parseUseOutput("kepano/obsidian-skills", "obsidian-markdown", fixture);
  expect(result.skillMarkdown).toContain("name: obsidian-markdown");
  expect(result.supportDir).toContain("skills-use-");
});

test("parseListJson returns installed project skills", () => {
  const fixture = fs.readFileSync(path.join(fixtures, "list-json.json"), "utf8");
  const result = parseListJson(fixture);
  expect(result[0]).toMatchObject({
    name: "obsidian-markdown",
    scope: "project",
  });
  expect(result[0].agents).toContain("Codex");
});

test("parseAvailableSkillsOutput parses skill names and descriptions from add --list output", () => {
  const fixture = fs.readFileSync(path.join(fixtures, "add-list-obsidian.txt"), "utf8");
  const result = parseAvailableSkillsOutput(fixture);
  const names = result.map((s) => s.name);
  expect(names).toContain("obsidian-markdown");
  expect(names).toContain("defuddle");
  const md = result.find((s) => s.name === "obsidian-markdown");
  expect(md?.description).toContain("Obsidian Flavored Markdown");
});

test("parseInstallCount parses plain numbers", () => {
  expect(parseInstallCount("415 installs")).toBe(415);
});

test("parseInstallCount parses K suffix", () => {
  expect(parseInstallCount("1.5K installs")).toBe(1500);
});

test("parseInstallCount returns undefined for empty input", () => {
  expect(parseInstallCount(undefined)).toBeUndefined();
});

// Command (spawn-mocked) tests

test("find runs npx skills find with telemetry disabled", async () => {
  mockSpawn.mockReturnValueOnce(makeChild(findFixture, "", 0));
  const cli = new SkillsCli();
  await cli.find("react frontend", tmpDir);
  expect(mockSpawn).toHaveBeenCalledWith(
    "npx",
    ["--yes", "skills", "find", "react frontend"],
    expect.objectContaining({
      cwd: tmpDir,
      env: expect.objectContaining({
        DISABLE_TELEMETRY: "1",
        DO_NOT_TRACK: "1",
      }),
    }),
  );
});

test("install runs project scoped add with copy yes and requested agents", async () => {
  mockSpawn
    .mockReturnValueOnce(makeChild("installed", "", 0))
    .mockReturnValueOnce(makeChild(listJsonFixture, "", 0));
  const cli = new SkillsCli();
  await cli.install({
    source: "kepano/obsidian-skills",
    skillName: "obsidian-markdown",
    workspace: tmpDir,
    agents: ["codex"],
    copy: true,
  });
  expect(mockSpawn).toHaveBeenNthCalledWith(
    1,
    "npx",
    ["--yes", "skills", "add", "kepano/obsidian-skills", "--skill", "obsidian-markdown", "--copy", "--yes", "--agent", "codex"],
    expect.objectContaining({ cwd: tmpDir }),
  );
});

test("non-zero skills command rejects with stdout and stderr detail", async () => {
  mockSpawn.mockReturnValueOnce(makeChild("No matching skill found", "", 1));
  const cli = new SkillsCli();
  await expect(cli.use("kepano/obsidian-skills", "missing", tmpDir)).rejects.toThrow("No matching skill found");
});

test("timeout kills child and rejects", async () => {
  const child = new EventEmitter() as any;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = jest.fn();
  // never emits close
  mockSpawn.mockReturnValueOnce(child);
  const cli = new SkillsCli({ timeoutMs: 50 });
  await expect(cli.version(tmpDir)).rejects.toThrow("timed out");
  expect(child.kill).toHaveBeenCalledWith("SIGTERM");
}, 1000);
