import * as fs from "node:fs";
import * as path from "node:path";

export interface SkillFrontmatter {
  name?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  raw: string;
}

export interface SkillBundleFile {
  relativePath: string;
  absolutePath: string;
  bytes: number;
  kind: "markdown" | "shell" | "javascript" | "json" | "text" | "binary" | "unknown";
  content?: string;
}

export interface SkillBundle {
  source: string;
  skillName: string;
  skillMarkdown: string;
  frontmatter: SkillFrontmatter;
  body: string;
  supportDir?: string;
  supportFiles: SkillBundleFile[];
}

export interface MarkdownCodeBlock {
  language: string;
  content: string;
  startLine: number;
}

export interface LoadSkillBundleInput {
  source: string;
  skillName: string;
  skillMarkdown: string;
  supportDir?: string;
  maxSupportFileBytes?: number;
  maxTotalSupportBytes?: number;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseSimpleYamlFields(raw: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let currentObject: string | undefined;

  for (const line of raw.split(/\r?\n/)) {
    const objectMatch = line.match(/^([a-zA-Z0-9_-]+):\s*$/);
    if (objectMatch) {
      currentObject = objectMatch[1]!;
      result[currentObject] = {};
      continue;
    }
    const nested = line.match(/^\s+([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (nested && currentObject && typeof result[currentObject] === "object") {
      (result[currentObject] as Record<string, unknown>)[nested[1]!] = unquote(nested[2]!);
      continue;
    }
    const field = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (field) {
      currentObject = undefined;
      result[field[1]!] = unquote(field[2]!);
    }
  }

  return result;
}

export function parseSkillMarkdown(markdown: string): { frontmatter: SkillFrontmatter; body: string } {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return { frontmatter: { raw: "" }, body: markdown };
  }
  const raw = match[1]!;
  const fields = parseSimpleYamlFields(raw);
  return {
    frontmatter: {
      name: typeof fields["name"] === "string" ? fields["name"] : undefined,
      description: typeof fields["description"] === "string" ? fields["description"] : undefined,
      metadata:
        typeof fields["metadata"] === "object" && fields["metadata"] !== null
          ? (fields["metadata"] as Record<string, unknown>)
          : undefined,
      raw,
    },
    body: markdown.slice(match[0].length),
  };
}

export function extractCodeBlocks(markdown: string): MarkdownCodeBlock[] {
  const blocks: MarkdownCodeBlock[] = [];
  const lines = markdown.split(/\r?\n/);
  let open: { language: string; startLine: number; lines: string[] } | undefined;

  lines.forEach((line, index) => {
    const fence = line.match(/^```([a-zA-Z0-9_-]*)\s*$/);
    if (fence && !open) {
      open = { language: fence[1] ?? "", startLine: index + 2, lines: [] };
      return;
    }
    if (line.trim() === "```" && open) {
      blocks.push({
        language: open.language,
        content: open.lines.join("\n"),
        startLine: open.startLine,
      });
      open = undefined;
      return;
    }
    if (open) open.lines.push(line);
  });

  return blocks;
}

function classifyFile(filePath: string): SkillBundleFile["kind"] {
  const ext = path.extname(filePath).toLowerCase();
  if ([".md", ".markdown"].includes(ext)) return "markdown";
  if ([".sh", ".bash", ".zsh"].includes(ext)) return "shell";
  if ([".js", ".mjs", ".cjs", ".ts", ".mts"].includes(ext)) return "javascript";
  if ([".json", ".jsonc"].includes(ext)) return "json";
  if ([".txt", ".yaml", ".yml", ".toml", ".env"].includes(ext)) return "text";
  return "unknown";
}

function hasBinaryContent(buf: Buffer): boolean {
  for (let i = 0; i < Math.min(buf.length, 512); i++) {
    const byte = buf[i]!;
    if (byte < 9 || (byte > 13 && byte < 32)) return true;
  }
  return false;
}

function* walkDir(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const lstat = fs.lstatSync(full);
    if (lstat.isDirectory()) {
      yield* walkDir(full);
    } else {
      yield full;
    }
  }
}

const DEFAULT_MAX_SUPPORT_FILE_BYTES = 256_000;
const DEFAULT_MAX_TOTAL_SUPPORT_BYTES = 1_000_000;

function loadSupportFiles(
  supportDir: string,
  maxFileBytes = DEFAULT_MAX_SUPPORT_FILE_BYTES,
  maxTotalBytes = DEFAULT_MAX_TOTAL_SUPPORT_BYTES,
): SkillBundleFile[] {
  let root: string;
  try {
    root = fs.realpathSync(supportDir);
  } catch {
    return [];
  }

  const files: SkillBundleFile[] = [];
  let total = 0;

  for (const filePath of walkDir(root)) {
    const lstat = fs.lstatSync(filePath);

    if (lstat.isSymbolicLink()) {
      files.push({
        relativePath: path.relative(root, filePath),
        absolutePath: filePath,
        bytes: 0,
        kind: "unknown",
        content: "SYMLINK_OR_PATH_ESCAPE",
      });
      continue;
    }

    let real: string;
    try {
      real = fs.realpathSync(filePath);
    } catch {
      files.push({
        relativePath: path.relative(root, filePath),
        absolutePath: filePath,
        bytes: 0,
        kind: "unknown",
        content: "SYMLINK_OR_PATH_ESCAPE",
      });
      continue;
    }

    if (!real.startsWith(root + path.sep) && real !== root) {
      files.push({
        relativePath: path.relative(root, filePath),
        absolutePath: filePath,
        bytes: 0,
        kind: "unknown",
        content: "SYMLINK_OR_PATH_ESCAPE",
      });
      continue;
    }

    const stat = fs.statSync(real);
    total += stat.size;
    const kind = classifyFile(real);

    let content: string | undefined;
    let effectiveKind = kind;
    if (stat.size <= maxFileBytes && total <= maxTotalBytes) {
      const buf = fs.readFileSync(real);
      if (!hasBinaryContent(buf)) {
        content = buf.toString("utf8");
      } else {
        effectiveKind = "binary";
      }
    }

    files.push({
      relativePath: path.relative(root, real),
      absolutePath: real,
      bytes: stat.size,
      kind: effectiveKind,
      content,
    });
  }

  return files;
}

export function loadSkillBundle(input: LoadSkillBundleInput): SkillBundle {
  const { frontmatter, body } = parseSkillMarkdown(input.skillMarkdown);
  const supportFiles = input.supportDir
    ? loadSupportFiles(input.supportDir, input.maxSupportFileBytes, input.maxTotalSupportBytes)
    : [];

  return {
    source: input.source,
    skillName: input.skillName,
    skillMarkdown: input.skillMarkdown,
    frontmatter,
    body,
    supportDir: input.supportDir,
    supportFiles,
  };
}
