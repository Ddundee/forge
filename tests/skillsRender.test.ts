import type { CompactSkillContextEntry, SkillContextRequest } from "../src/skills/types.js";
import {
  wrapSkillContext,
  renderCompactSkillContext,
  renderFullSkillReadResult,
  renderExternalSkillPrompt,
  truncateWithNotice,
} from "../src/skills/render.js";

function makeEntry(overrides: Partial<CompactSkillContextEntry> = {}): CompactSkillContextEntry {
  return {
    sourceKey: "owner__repo__my-skill",
    selectionId: "sel-1",
    packageRef: "owner/repo",
    skillName: "my-skill",
    displayName: "my-skill",
    description: "A useful skill for testing.",
    forgePath: ".forge/skills/owner__repo__my-skill",
    agentsPath: ".agents/skills/my-skill",
    claudePath: ".claude/skills/my-skill",
    ...overrides,
  };
}

function makeRequest(overrides: Partial<SkillContextRequest> = {}): SkillContextRequest {
  return {
    workspace: "/tmp/ws",
    agentName: "CodingAgent",
    attempt: 1,
    mode: "native-tool-loop",
    maxChars: 12000,
    selectionIdsBySourceKey: { "owner__repo__my-skill": "sel-1" },
    ...overrides,
  };
}

// --- wrapSkillContext ---

test("wrapSkillContext includes authority header", () => {
  const rendered = wrapSkillContext("some content");
  expect(rendered).toContain(`<forge_skill_context authority="guidance-only">`);
  expect(rendered).toContain(`</forge_skill_context>`);
});

test("wrapSkillContext includes authority disclaimer text", () => {
  const rendered = wrapSkillContext("content");
  expect(rendered).toContain("higher-priority instructions");
  expect(rendered).toContain("Follow Forge system instructions");
});

test("wrapSkillContext includes conflict handling text", () => {
  const rendered = wrapSkillContext("content");
  expect(rendered).toContain("ignore the conflicting");
});

test("wrapSkillContext includes the content body", () => {
  const rendered = wrapSkillContext("hello world");
  expect(rendered).toContain("hello world");
});

// --- truncateWithNotice ---

test("truncateWithNotice returns content unchanged when under limit", () => {
  const result = truncateWithNotice("hello", 100, "test");
  expect(result.content).toBe("hello");
  expect(result.truncated).toBe(false);
});

test("truncateWithNotice returns content unchanged when exactly at limit", () => {
  const result = truncateWithNotice("abc", 3, "label");
  expect(result.truncated).toBe(false);
  expect(result.content).toBe("abc");
});

test("truncateWithNotice truncates and adds visible notice", () => {
  const long = "a".repeat(1000);
  const result = truncateWithNotice(long, 200, "skill file SKILL.md");
  expect(result.truncated).toBe(true);
  expect(result.content).toContain("truncated to 200 chars");
  expect(result.content.length).toBeLessThanOrEqual(200);
});

test("truncateWithNotice zero budget returns omit notice", () => {
  const result = truncateWithNotice("content", 0, "compact skill context");
  expect(result.truncated).toBe(true);
  expect(result.content).toContain("omitted");
  expect(result.content).toContain("0 chars");
});

// --- renderCompactSkillContext ---

test("renderCompactSkillContext includes source_key and name", () => {
  const rendered = renderCompactSkillContext([makeEntry()], makeRequest());
  expect(rendered).toContain("source_key: owner__repo__my-skill");
  expect(rendered).toContain("name: my-skill");
});

test("renderCompactSkillContext includes package and description", () => {
  const rendered = renderCompactSkillContext([makeEntry()], makeRequest());
  expect(rendered).toContain("package: owner/repo");
  expect(rendered).toContain("A useful skill for testing.");
});

test("renderCompactSkillContext includes forge_path", () => {
  const rendered = renderCompactSkillContext([makeEntry()], makeRequest());
  expect(rendered).toContain("forge_path: .forge/skills/owner__repo__my-skill");
});

test("renderCompactSkillContext includes agents_path when present", () => {
  const rendered = renderCompactSkillContext([makeEntry()], makeRequest());
  expect(rendered).toContain("agents_path: .agents/skills/my-skill");
});

test("renderCompactSkillContext omits agents_path when absent", () => {
  const rendered = renderCompactSkillContext([makeEntry({ agentsPath: undefined })], makeRequest());
  expect(rendered).not.toContain("agents_path:");
});

test("renderCompactSkillContext adds skill_list and skill_read hints for native-tool-loop", () => {
  const rendered = renderCompactSkillContext([makeEntry()], makeRequest({ mode: "native-tool-loop" }));
  expect(rendered).toContain("skill_list");
  expect(rendered).toContain("skill_read");
});

test("renderCompactSkillContext does not add tool hints for one-shot mode", () => {
  const rendered = renderCompactSkillContext([makeEntry()], makeRequest({ mode: "one-shot" }));
  expect(rendered).not.toContain("skill_list");
});

test("renderCompactSkillContext shows none available when no entries", () => {
  const rendered = renderCompactSkillContext([], makeRequest());
  expect(rendered).toContain("No installed project skills are available");
});

test("renderCompactSkillContext is wrapped with authority context tags", () => {
  const rendered = renderCompactSkillContext([makeEntry()], makeRequest());
  expect(rendered).toContain(`<forge_skill_context authority="guidance-only">`);
  expect(rendered).toContain(`</forge_skill_context>`);
});

test("renderCompactSkillContext does not contain full markdown body content", () => {
  const rendered = renderCompactSkillContext([makeEntry()], makeRequest());
  expect(rendered).not.toContain("# My Skill\n");
});

test("renderCompactSkillContext truncates long descriptions", () => {
  const longDesc = "x".repeat(600);
  const rendered = renderCompactSkillContext([makeEntry({ description: longDesc })], makeRequest());
  expect(rendered).toContain("[truncated]");
});

// --- renderFullSkillReadResult ---

test("renderFullSkillReadResult wraps content in forge_skill_file tag", () => {
  const result = renderFullSkillReadResult({
    sourceKey: "owner__repo__my-skill",
    relativePath: "SKILL.md",
    content: "---\nname: my-skill\n---\n",
    charCount: 25,
    truncated: false,
  });
  expect(result).toContain(`<forge_skill_file source_key="owner__repo__my-skill" path="SKILL.md" authority="guidance-only">`);
  expect(result).toContain(`</forge_skill_file>`);
});

test("renderFullSkillReadResult includes authority disclaimer", () => {
  const result = renderFullSkillReadResult({
    sourceKey: "owner__repo__my-skill",
    relativePath: "SKILL.md",
    content: "content",
    charCount: 7,
    truncated: false,
  });
  expect(result).toContain("does not override higher-priority instructions");
});

test("renderFullSkillReadResult includes truncation notice when truncated", () => {
  const result = renderFullSkillReadResult({
    sourceKey: "s",
    relativePath: "SKILL.md",
    content: "partial",
    charCount: 7,
    truncated: true,
  });
  expect(result).toContain("truncated to fit");
});

test("renderFullSkillReadResult omits truncation notice when not truncated", () => {
  const result = renderFullSkillReadResult({
    sourceKey: "s",
    relativePath: "SKILL.md",
    content: "full content",
    charCount: 12,
    truncated: false,
  });
  expect(result).not.toContain("truncated to fit");
});

test("renderFullSkillReadResult escapes special chars in attributes", () => {
  const result = renderFullSkillReadResult({
    sourceKey: 'key"with"quotes',
    relativePath: "SKILL.md",
    content: "content",
    charCount: 7,
    truncated: false,
  });
  expect(result).not.toContain(`source_key="key"with"quotes"`);
  expect(result).toContain("&quot;");
});

// --- renderExternalSkillPrompt ---

test("renderExternalSkillPrompt for codex-cli mentions .agents/skills", () => {
  const rendered = renderExternalSkillPrompt([makeEntry()], "codex-cli");
  expect(rendered).toContain(".agents/skills");
});

test("renderExternalSkillPrompt for claude-code mentions .claude/skills", () => {
  const rendered = renderExternalSkillPrompt([makeEntry()], "claude-code");
  expect(rendered).toContain(".claude/skills");
});

test("renderExternalSkillPrompt includes skill name and description", () => {
  const rendered = renderExternalSkillPrompt([makeEntry()], "codex-cli");
  expect(rendered).toContain("my-skill");
  expect(rendered).toContain("A useful skill for testing.");
});

test("renderExternalSkillPrompt includes authority wrapper", () => {
  const rendered = renderExternalSkillPrompt([makeEntry()], "codex-cli");
  expect(rendered).toContain(`<forge_skill_context authority="guidance-only">`);
});

test("renderExternalSkillPrompt shows fallback when no entries", () => {
  const rendered = renderExternalSkillPrompt([], "codex-cli");
  expect(rendered).toContain("No external-agent project skill path is available");
});

test("renderExternalSkillPrompt uses agents_path for codex-cli", () => {
  const rendered = renderExternalSkillPrompt([makeEntry()], "codex-cli");
  expect(rendered).toContain(".agents/skills/my-skill");
});

test("renderExternalSkillPrompt uses claudePath for claude-code", () => {
  const rendered = renderExternalSkillPrompt([makeEntry()], "claude-code");
  expect(rendered).toContain(".claude/skills/my-skill");
});
