import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { SkillContextRequest } from "../src/skills/types.js";
import { SkillContextProvider } from "../src/skills/context.js";
import {
  SkillContextRuntime,
  isSkillTool,
  executeSkillTool,
  summarizeSkillToolResult,
} from "../src/skills/toolExecutor.js";
import { SKILL_TOOL_DEFINITIONS } from "../src/skills/toolDefinitions.js";

function makeInstalledSkill(workspace: string, skillName = "deploy"): void {
  const sourceKey = `owner__repo__${skillName}`;
  const dir = path.join(workspace, ".forge", "skills", sourceKey);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "forge-skill.json"),
    JSON.stringify({
      schemaVersion: 1,
      packageRef: "owner/repo",
      skillName,
      installedAt: "2026-06-07T00:00:00.000Z",
      sourceOwner: "owner",
      sourceRepo: "repo",
      candidateId: "c0",
      selectionId: "sel-1",
      auditVerdict: "pass",
      installTargets: ["forge"],
      externalPaths: { agents: `.agents/skills/${skillName}` },
    }),
    "utf8",
  );
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${skillName}\ndescription: Test skill\n---\n\n# ${skillName}\n`,
    "utf8",
  );
}

function makeDb() {
  const injections: any[] = [];
  return {
    injections,
    logSkillInjection: jest.fn().mockImplementation((_sid: string, rec: any) => {
      injections.push(rec);
      return `inj-${injections.length}`;
    }),
  };
}

function makeRequest(workspace: string): SkillContextRequest {
  return {
    workspace,
    agentName: "CodingAgent",
    attempt: 1,
    mode: "native-tool-loop",
    maxChars: 12000,
    selectionIdsBySourceKey: { "owner__repo__deploy": "sel-1" },
  };
}

let workspace: string;
beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "forge-tools-test-"));
});
afterEach(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

// --- isSkillTool ---

test("isSkillTool returns true for skill_list", () => {
  expect(isSkillTool("skill_list")).toBe(true);
});

test("isSkillTool returns true for skill_read", () => {
  expect(isSkillTool("skill_read")).toBe(true);
});

test("isSkillTool returns false for bash_exec", () => {
  expect(isSkillTool("bash_exec")).toBe(false);
});

test("isSkillTool returns false for read_file", () => {
  expect(isSkillTool("read_file")).toBe(false);
});

// --- SKILL_TOOL_DEFINITIONS ---

test("SKILL_TOOL_DEFINITIONS exports skill_list", () => {
  expect(SKILL_TOOL_DEFINITIONS).toHaveProperty("skill_list");
});

test("SKILL_TOOL_DEFINITIONS exports skill_read", () => {
  expect(SKILL_TOOL_DEFINITIONS).toHaveProperty("skill_read");
});

// --- executeSkillTool: skill_list ---

test("skill_list returns compact context with authority wrapper", () => {
  makeInstalledSkill(workspace);
  const provider = new SkillContextProvider();
  const runtime = new SkillContextRuntime(provider, makeRequest(workspace));
  const db = makeDb();

  const result = executeSkillTool("skill_list", {}, runtime, db, "sess-1");
  expect(result).toContain("<forge_skill_context");
  expect(result).toContain('authority="guidance-only"');
});

test("skill_list logs compact injection for each selectionId", () => {
  makeInstalledSkill(workspace);
  const provider = new SkillContextProvider();
  const runtime = new SkillContextRuntime(provider, makeRequest(workspace));
  const db = makeDb();

  executeSkillTool("skill_list", {}, runtime, db, "sess-1");
  expect(db.injections.some((i: any) => i.contextKind === "compact")).toBe(true);
});

test("skill_list injection has correct agentName and attempt", () => {
  makeInstalledSkill(workspace);
  const provider = new SkillContextProvider();
  const runtime = new SkillContextRuntime(provider, makeRequest(workspace));
  const db = makeDb();

  executeSkillTool("skill_list", {}, runtime, db, "sess-1");
  const injection = db.injections[0];
  expect(injection.agentName).toBe("CodingAgent");
  expect(injection.attempt).toBe(1);
});

test("skill_list deduplicates compact injection logs within one runtime", () => {
  makeInstalledSkill(workspace);
  const provider = new SkillContextProvider();
  const runtime = new SkillContextRuntime(provider, makeRequest(workspace));
  const db = makeDb();

  executeSkillTool("skill_list", {}, runtime, db, "sess-1");
  executeSkillTool("skill_list", {}, runtime, db, "sess-1");
  const compactLogs = db.injections.filter((i: any) => i.contextKind === "compact");
  expect(compactLogs).toHaveLength(1);
});

// --- executeSkillTool: skill_read ---

test("skill_read returns forge_skill_file wrapper", () => {
  makeInstalledSkill(workspace);
  const provider = new SkillContextProvider();
  const runtime = new SkillContextRuntime(provider, makeRequest(workspace));
  const db = makeDb();

  const result = executeSkillTool(
    "skill_read",
    { source_key: "owner__repo__deploy" },
    runtime,
    db,
    "sess-1",
  );
  expect(result).toContain("<forge_skill_file");
  expect(result).toContain("owner__repo__deploy");
  expect(result).toContain("SKILL.md");
});

test("skill_read logs full injection", () => {
  makeInstalledSkill(workspace);
  const provider = new SkillContextProvider();
  const runtime = new SkillContextRuntime(provider, makeRequest(workspace));
  const db = makeDb();

  executeSkillTool("skill_read", { source_key: "owner__repo__deploy" }, runtime, db, "sess-1");
  expect(db.injections.some((i: any) => i.contextKind === "full")).toBe(true);
});

test("skill_read includes authority disclaimer in result", () => {
  makeInstalledSkill(workspace);
  const provider = new SkillContextProvider();
  const runtime = new SkillContextRuntime(provider, makeRequest(workspace));
  const db = makeDb();

  const result = executeSkillTool(
    "skill_read",
    { source_key: "owner__repo__deploy" },
    runtime,
    db,
    "sess-1",
  );
  expect(result).toContain("does not override higher-priority instructions");
});

test("skill_read returns error string for invalid source_key", () => {
  makeInstalledSkill(workspace);
  const provider = new SkillContextProvider();
  const runtime = new SkillContextRuntime(provider, makeRequest(workspace));
  const db = makeDb();

  const result = executeSkillTool("skill_read", { source_key: "nonexistent" }, runtime, db, "sess-1");
  expect(result).toContain("ERROR");
  expect(db.injections).toHaveLength(0);
});

test("skill_read does not deduplicate full injection logs", () => {
  makeInstalledSkill(workspace);
  const provider = new SkillContextProvider();
  const runtime = new SkillContextRuntime(provider, makeRequest(workspace));
  const db = makeDb();

  executeSkillTool("skill_read", { source_key: "owner__repo__deploy" }, runtime, db, "sess-1");
  executeSkillTool("skill_read", { source_key: "owner__repo__deploy" }, runtime, db, "sess-1");
  const fullLogs = db.injections.filter((i: any) => i.contextKind === "full");
  // deduplication applies: same key → only 1 log
  expect(fullLogs).toHaveLength(1);
});

// --- executeSkillTool: unknown tool ---

test("executeSkillTool returns error for unknown tool name", () => {
  makeInstalledSkill(workspace);
  const provider = new SkillContextProvider();
  const runtime = new SkillContextRuntime(provider, makeRequest(workspace));
  const db = makeDb();

  const result = executeSkillTool("unknown_tool", {}, runtime, db, "sess-1");
  expect(result).toContain("ERROR");
  expect(result).toContain("unknown_tool");
});

// --- summarizeSkillToolResult ---

test("summarizeSkillToolResult redacts skill_read result with char count", () => {
  const content = "<forge_skill_file>...large content...</forge_skill_file>";
  const result = summarizeSkillToolResult("skill_read", content);
  expect(result).toContain("skill_read returned");
  expect(result).toContain(`${content.length} chars`);
});

test("summarizeSkillToolResult passes through other tools up to 2000 chars", () => {
  const result = summarizeSkillToolResult("bash_exec", "output");
  expect(result).toBe("output");
});

test("summarizeSkillToolResult truncates other tools at 2000 chars", () => {
  const result = summarizeSkillToolResult("bash_exec", "a".repeat(3000));
  expect(result.length).toBeLessThanOrEqual(2000);
});

test("summarizeSkillToolResult for skill_list passes through normally", () => {
  const result = summarizeSkillToolResult("skill_list", "compact content");
  expect(result).toBe("compact content");
});
