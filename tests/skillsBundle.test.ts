import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseSkillMarkdown, loadSkillBundle, extractCodeBlocks } from "../src/skills/bundle.js";

test("parseSkillMarkdown extracts frontmatter name and description", () => {
  const parsed = parseSkillMarkdown(`---
name: docs-helper
description: Help write docs
---

# Docs Helper
Body`);
  expect(parsed.frontmatter.name).toBe("docs-helper");
  expect(parsed.frontmatter.description).toBe("Help write docs");
  expect(parsed.body).toContain("# Docs Helper");
});

test("parseSkillMarkdown handles missing frontmatter gracefully", () => {
  const parsed = parseSkillMarkdown("# Just a body\nNo frontmatter");
  expect(parsed.frontmatter.name).toBeUndefined();
  expect(parsed.body).toContain("# Just a body");
});

test("parseSkillMarkdown handles nested metadata block", () => {
  const parsed = parseSkillMarkdown(`---
name: test-skill
description: Test
metadata:
  author: someone
  version: "1.0.0"
---
body`);
  expect(parsed.frontmatter.metadata).toEqual({ author: "someone", version: "1.0.0" });
});

test("extractCodeBlocks finds bash blocks with start line", () => {
  const blocks = extractCodeBlocks("# Skill\n```bash\necho hello\n```");
  expect(blocks).toHaveLength(1);
  expect(blocks[0]!.language).toBe("bash");
  expect(blocks[0]!.content).toBe("echo hello");
  expect(blocks[0]!.startLine).toBeGreaterThan(0);
});

test("extractCodeBlocks handles multiple code blocks", () => {
  const md = "```ts\nconst x = 1;\n```\n\nText\n\n```bash\necho hi\n```";
  const blocks = extractCodeBlocks(md);
  expect(blocks).toHaveLength(2);
  expect(blocks[0]!.language).toBe("ts");
  expect(blocks[1]!.language).toBe("bash");
});

test("loadSkillBundle with no supportDir returns empty supportFiles", () => {
  const bundle = loadSkillBundle({
    source: "owner/repo",
    skillName: "my-skill",
    skillMarkdown: "---\nname: my-skill\ndescription: Test\n---\n# Skill",
  });
  expect(bundle.supportFiles).toHaveLength(0);
  expect(bundle.frontmatter.name).toBe("my-skill");
  expect(bundle.body).toContain("# Skill");
});

test("loadSkillBundle inventories support files with correct kind", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "forge-skill-bundle-"));
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(root, "scripts", "run.sh"), "#!/bin/bash\necho ok\n");
  const bundle = loadSkillBundle({
    source: "owner/repo",
    skillName: "safe",
    skillMarkdown: "---\nname: safe\ndescription: Safe\n---\n# Safe",
    supportDir: root,
  });
  expect(bundle.supportFiles.map((f) => f.relativePath)).toContain("scripts/run.sh");
  expect(bundle.supportFiles.find((f) => f.relativePath === "scripts/run.sh")?.kind).toBe("shell");
  expect(bundle.supportFiles.find((f) => f.relativePath === "scripts/run.sh")?.content).toContain("echo ok");
});

test("loadSkillBundle marks symlink as SYMLINK_OR_PATH_ESCAPE", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "forge-skill-bundle-"));
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "forge-skill-target-"));
  fs.writeFileSync(path.join(target, "secret.txt"), "secret");
  fs.symlinkSync(path.join(target, "secret.txt"), path.join(root, "escape-link.txt"));

  const bundle = loadSkillBundle({
    source: "owner/repo",
    skillName: "escape",
    skillMarkdown: "---\nname: escape\ndescription: Escape test\n---\n# Escape",
    supportDir: root,
  });
  const escapedFile = bundle.supportFiles.find((f) => f.relativePath === "escape-link.txt");
  expect(escapedFile).toBeDefined();
  expect(escapedFile?.content).toBe("SYMLINK_OR_PATH_ESCAPE");
});
