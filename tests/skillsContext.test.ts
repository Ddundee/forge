import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { SkillContextRequest } from "../src/skills/types.js";
import { SkillContextProvider } from "../src/skills/context.js";

function makeRequest(
  workspace: string,
  overrides: Partial<SkillContextRequest> = {},
): SkillContextRequest {
  return {
    workspace,
    agentName: "CodingAgent",
    attempt: 1,
    mode: "native-tool-loop",
    maxChars: 12000,
    selectionIdsBySourceKey: { "owner__repo__deploy": "sel-1" },
    ...overrides,
  };
}

function makeInstalledSkill(workspace: string, skillName = "deploy"): void {
  const sourceKey = `owner__repo__${skillName}`;
  const dir = path.join(workspace, ".forge", "skills", sourceKey);
  fs.mkdirSync(path.join(dir, "resources"), { recursive: true });
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
      installTargets: ["forge", "agents"],
      externalPaths: {
        agents: `.agents/skills/${skillName}`,
        claude: `.claude/skills/${skillName}`,
      },
    }),
    "utf8",
  );
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${skillName}\ndescription: Deploy safely\n---\n\n# ${skillName}\nBody content.\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(dir, "resources", "deploy.sh"),
    "#!/bin/bash\necho deploy\n",
    "utf8",
  );
}

let workspace: string;
beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "forge-ctx-test-"));
});
afterEach(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

// --- listCompact ---

test("listCompact returns empty array when no skills installed", () => {
  const provider = new SkillContextProvider();
  expect(provider.listCompact(makeRequest(workspace))).toHaveLength(0);
});

test("listCompact returns entries for installed selected skills", () => {
  makeInstalledSkill(workspace);
  const provider = new SkillContextProvider();
  const entries = provider.listCompact(makeRequest(workspace));
  expect(entries).toHaveLength(1);
  expect(entries[0].skillName).toBe("deploy");
  expect(entries[0].selectionId).toBe("sel-1");
});

test("listCompact skips entries with no matching selectionId", () => {
  makeInstalledSkill(workspace);
  const provider = new SkillContextProvider();
  const entries = provider.listCompact(makeRequest(workspace, { selectionIdsBySourceKey: {} }));
  expect(entries).toHaveLength(0);
});

test("listCompact filters to relevantSourceKeys when provided", () => {
  makeInstalledSkill(workspace, "deploy");
  makeInstalledSkill(workspace, "test-skill");
  const provider = new SkillContextProvider();
  const request = makeRequest(workspace, {
    selectionIdsBySourceKey: {
      "owner__repo__deploy": "sel-1",
      "owner__repo__test-skill": "sel-2",
    },
    relevantSourceKeys: ["owner__repo__deploy"],
  });
  const entries = provider.listCompact(request);
  expect(entries).toHaveLength(1);
  expect(entries[0].skillName).toBe("deploy");
});

test("listCompact returns all entries when relevantSourceKeys is undefined", () => {
  makeInstalledSkill(workspace, "deploy");
  makeInstalledSkill(workspace, "test-skill");
  const provider = new SkillContextProvider();
  const request = makeRequest(workspace, {
    selectionIdsBySourceKey: {
      "owner__repo__deploy": "sel-1",
      "owner__repo__test-skill": "sel-2",
    },
  });
  const entries = provider.listCompact(request);
  expect(entries).toHaveLength(2);
});

test("listCompact returns empty array when maxChars is 0", () => {
  makeInstalledSkill(workspace);
  const provider = new SkillContextProvider();
  const entries = provider.listCompact(makeRequest(workspace, { maxChars: 0 }));
  expect(entries).toHaveLength(0);
});

test("listCompact includes agents and claude paths", () => {
  makeInstalledSkill(workspace);
  const provider = new SkillContextProvider();
  const entries = provider.listCompact(makeRequest(workspace));
  expect(entries[0].agentsPath).toBe(".agents/skills/deploy");
  expect(entries[0].claudePath).toBe(".claude/skills/deploy");
});

test("listCompact includes forgePath", () => {
  makeInstalledSkill(workspace);
  const provider = new SkillContextProvider();
  const entries = provider.listCompact(makeRequest(workspace));
  expect(entries[0].forgePath).toContain(".forge/skills");
});

// --- renderCompact ---

test("renderCompact returns RenderedSkillContext with kind compact", () => {
  makeInstalledSkill(workspace);
  const provider = new SkillContextProvider();
  const rendered = provider.renderCompact(makeRequest(workspace));
  expect(rendered.kind).toBe("compact");
});

test("renderCompact content includes authority wrapper", () => {
  makeInstalledSkill(workspace);
  const provider = new SkillContextProvider();
  const rendered = provider.renderCompact(makeRequest(workspace));
  expect(rendered.content).toContain("<forge_skill_context");
});

test("renderCompact sourceKeys includes installed skill sourceKey", () => {
  makeInstalledSkill(workspace);
  const provider = new SkillContextProvider();
  const rendered = provider.renderCompact(makeRequest(workspace));
  expect(rendered.sourceKeys).toContain("owner__repo__deploy");
});

test("renderCompact returns empty when maxChars is 0", () => {
  makeInstalledSkill(workspace);
  const provider = new SkillContextProvider();
  const rendered = provider.renderCompact(makeRequest(workspace, { maxChars: 0 }));
  expect(rendered.charCount).toBe(0);
  expect(rendered.content).toBe("");
  expect(rendered.sourceKeys).toHaveLength(0);
});

test("renderCompact uses external renderer for codex-cli mode", () => {
  makeInstalledSkill(workspace);
  const provider = new SkillContextProvider();
  const rendered = provider.renderCompact(makeRequest(workspace, { mode: "codex-cli" }));
  expect(rendered.content).toContain(".agents/skills");
});

test("renderCompact uses external renderer for claude-code mode", () => {
  makeInstalledSkill(workspace);
  const provider = new SkillContextProvider();
  const rendered = provider.renderCompact(makeRequest(workspace, { mode: "claude-code" }));
  expect(rendered.content).toContain(".claude/skills");
});

test("renderCompact one-shot mode applies tighter cap", () => {
  makeInstalledSkill(workspace);
  const provider = new SkillContextProvider();
  const rendered = provider.renderCompact(makeRequest(workspace, { mode: "one-shot", maxChars: 12000 }));
  expect(rendered.charCount).toBeLessThanOrEqual(3000);
});

// --- readSkill ---

test("readSkill reads SKILL.md by default", () => {
  makeInstalledSkill(workspace);
  const provider = new SkillContextProvider();
  const result = provider.readSkill(makeRequest(workspace), { sourceKey: "owner__repo__deploy" });
  expect(result.relativePath).toBe("SKILL.md");
  expect(result.content).toContain("name: deploy");
});

test("readSkill reads a supporting file when specified", () => {
  makeInstalledSkill(workspace);
  const provider = new SkillContextProvider();
  const result = provider.readSkill(makeRequest(workspace), {
    sourceKey: "owner__repo__deploy",
    file: "resources/deploy.sh",
  });
  expect(result.relativePath).toBe("resources/deploy.sh");
  expect(result.content).toContain("echo deploy");
});

test("readSkill returns SkillReadResult with charCount", () => {
  makeInstalledSkill(workspace);
  const provider = new SkillContextProvider();
  const result = provider.readSkill(makeRequest(workspace), { sourceKey: "owner__repo__deploy" });
  expect(result.charCount).toBe(result.content.length);
  expect(result.charCount).toBeGreaterThan(0);
});

test("readSkill throws for unknown sourceKey", () => {
  makeInstalledSkill(workspace);
  const provider = new SkillContextProvider();
  expect(() =>
    provider.readSkill(makeRequest(workspace), { sourceKey: "nonexistent__key" }),
  ).toThrow();
});

test("readSkill throws for sourceKey not in selectionIdsBySourceKey", () => {
  makeInstalledSkill(workspace);
  const provider = new SkillContextProvider();
  expect(() =>
    provider.readSkill(makeRequest(workspace, { selectionIdsBySourceKey: {} }), {
      sourceKey: "owner__repo__deploy",
    }),
  ).toThrow();
});

test("readSkill throws for path escape attempt with ..", () => {
  makeInstalledSkill(workspace);
  const provider = new SkillContextProvider();
  expect(() =>
    provider.readSkill(makeRequest(workspace), {
      sourceKey: "owner__repo__deploy",
      file: "../../.env",
    }),
  ).toThrow(/escapes/);
});

test("readSkill throws for absolute path", () => {
  makeInstalledSkill(workspace);
  const provider = new SkillContextProvider();
  expect(() =>
    provider.readSkill(makeRequest(workspace), {
      sourceKey: "owner__repo__deploy",
      file: "/etc/passwd",
    }),
  ).toThrow(/escapes/);
});

test("readSkill throws for missing file", () => {
  makeInstalledSkill(workspace);
  const provider = new SkillContextProvider();
  expect(() =>
    provider.readSkill(makeRequest(workspace), {
      sourceKey: "owner__repo__deploy",
      file: "nonexistent.md",
    }),
  ).toThrow(/not found/);
});

test("readSkill respects caller maxChars", () => {
  makeInstalledSkill(workspace);
  const provider = new SkillContextProvider();
  const result = provider.readSkill(makeRequest(workspace), {
    sourceKey: "owner__repo__deploy",
    maxChars: 20,
  });
  expect(result.charCount).toBeLessThanOrEqual(20);
});

test("readSkill does not exceed request-level maxChars", () => {
  makeInstalledSkill(workspace);
  const provider = new SkillContextProvider();
  const result = provider.readSkill(makeRequest(workspace, { maxChars: 30 }), {
    sourceKey: "owner__repo__deploy",
    maxChars: 99999,
  });
  expect(result.charCount).toBeLessThanOrEqual(30);
});
