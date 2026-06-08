import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SkillsCli } from "../src/skills/cli.js";
import {
  withFakeSkillsCli,
  readJsonLines,
  type FakeSkillsInvocation,
} from "./helpers/fakeSkillsCli.js";

const FIND_FIXTURE = fs.readFileSync(
  path.join(__dirname, "fixtures", "skills-e2e", "frontend-find.txt"),
  "utf8",
);
const USE_FIXTURE = fs.readFileSync(
  path.join(__dirname, "fixtures", "skills-e2e", "frontend-use.txt"),
  "utf8",
);

let workspace: string;
beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "forge-fake-cli-test-"));
});
afterEach(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

// --- fake CLI helper ---

test("withFakeSkillsCli creates a callable fake npx", async () => {
  await withFakeSkillsCli(
    { find: { frontend: FIND_FIXTURE } },
    async ({ env }) => {
      const cli = new SkillsCli({ env });
      const result = await cli.find("frontend", workspace);
      expect(result.candidates.length).toBeGreaterThan(0);
      expect(result.candidates[0].skillName).toBe("web-design-guidelines");
    },
  );
});

test("fake CLI records invocation args and telemetry env", async () => {
  await withFakeSkillsCli(
    { find: { frontend: FIND_FIXTURE } },
    async ({ env, callsPath }) => {
      const cli = new SkillsCli({ env });
      await cli.find("frontend", workspace);

      const calls = readJsonLines<FakeSkillsInvocation>(callsPath);
      expect(calls).toHaveLength(1);
      expect(calls[0].args).toEqual(["--yes", "skills", "find", "frontend"]);
      expect(calls[0].env.DISABLE_TELEMETRY).toBe("1");
      expect(calls[0].env.DO_NOT_TRACK).toBe("1");
      expect(calls[0].env.NO_COLOR).toBe("1");
    },
  );
});

test("fake CLI returns empty when no scenario key matches find query", async () => {
  await withFakeSkillsCli(
    { find: {} },
    async ({ env }) => {
      const cli = new SkillsCli({ env });
      const result = await cli.find("unrelated-query", workspace);
      expect(result.candidates).toHaveLength(0);
    },
  );
});

test("fake CLI supports use command and records call", async () => {
  await withFakeSkillsCli(
    {
      use: { "vercel-labs/agent-skills@web-design-guidelines": USE_FIXTURE },
    },
    async ({ env, callsPath }) => {
      const cli = new SkillsCli({ env });
      const result = await cli.use("vercel-labs/agent-skills", "web-design-guidelines", workspace);

      expect(result.skillMarkdown).toContain("web-design-guidelines");

      const calls = readJsonLines<FakeSkillsInvocation>(callsPath);
      expect(calls[0].args).toEqual([
        "--yes", "skills", "use", "vercel-labs/agent-skills", "--skill", "web-design-guidelines",
      ]);
    },
  );
});

test("fake CLI supports list --json command", async () => {
  await withFakeSkillsCli(
    { listJson: [{ name: "web-design-guidelines", path: ".agents/skills/web-design-guidelines", scope: "project", agents: [] }] },
    async ({ env }) => {
      const cli = new SkillsCli({ env });
      const result = await cli.listInstalled(workspace);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("web-design-guidelines");
    },
  );
});

test("fake CLI simulates failure with correct exit code", async () => {
  await withFakeSkillsCli(
    {
      failures: {
        "find network-error": { code: 1, stderr: "network timeout" },
      },
    },
    async ({ env }) => {
      const cli = new SkillsCli({ env });
      await expect(cli.find("network-error", workspace)).rejects.toThrow("network timeout");
    },
  );
});

test("readJsonLines returns empty array for missing file", () => {
  const result = readJsonLines("/nonexistent/path/calls.jsonl");
  expect(result).toEqual([]);
});

test("multiple fake CLI calls are all recorded", async () => {
  await withFakeSkillsCli(
    {
      find: {
        frontend: FIND_FIXTURE,
        backend: "No skills found\n",
      },
    },
    async ({ env, callsPath }) => {
      const cli = new SkillsCli({ env });
      await cli.find("frontend", workspace);
      await cli.find("backend", workspace);

      const calls = readJsonLines<FakeSkillsInvocation>(callsPath);
      expect(calls).toHaveLength(2);
      expect(calls[0].args[3]).toBe("frontend");
      expect(calls[1].args[3]).toBe("backend");
    },
  );
});
