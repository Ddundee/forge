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

/**
 * Trim whitespace and remove a single matching pair of surrounding single or double quotes.
 *
 * @param value - The input string to normalize; may contain surrounding quotes and surrounding whitespace
 * @returns The input trimmed of leading/trailing whitespace and with one matching surrounding quote pair removed if present
 */
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

/**
 * Parses a restricted YAML-like text block into a plain object of fields.
 *
 * Supports three patterns:
 * - Top-level key/value lines `key: value` produce `key: string` (values are trimmed and unquoted if wrapped in quotes).
 * - Top-level empty key lines `key:` create an empty object `key: Record<string, unknown>` that can receive nested entries.
 * - Indented nested lines (one or more leading spaces) `  nestedKey: value` placed beneath the most recent empty top-level key populate that object's properties.
 *
 * Lines that do not match these patterns are ignored. Nested entries are only captured while their parent object has been opened.
 *
 * @param raw - The raw YAML-like text to parse (typically the frontmatter body).
 * @returns An object whose top-level properties are either strings for simple key/value pairs or objects for keys that had nested entries.
 */
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

/**
 * Parses markdown for a leading YAML-like frontmatter block and returns the extracted frontmatter and the remaining body.
 *
 * @param markdown - The markdown text which may start with a frontmatter block delimited by `---` on its own lines.
 * @returns An object with:
 *  - `frontmatter`: parsed fields (`name`, `description`, optional `metadata`) and `raw` containing the extracted frontmatter text (empty string if none found).
 *  - `body`: the markdown content after the frontmatter block (or the original `markdown` if no frontmatter was present).
 */
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

/**
 * Extracts fenced triple-backtick code blocks from a Markdown string.
 *
 * Recognizes opening fences of the form ```{language} where `language` matches
 * `[a-zA-Z0-9_-]*` and a closing fence that is a line whose trimmed value is
 * exactly ``````. The returned blocks contain the detected language token
 * (empty string if none), the block content without the surrounding fences,
 * and `startLine` as the 1-based line number where the code block content begins.
 *
 * @param markdown - The Markdown source to scan for code fences
 * @returns An array of `MarkdownCodeBlock` objects describing each found code block
 */
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

/**
 * Identify the content kind for a file based on its extension.
 *
 * @param filePath - File path or name whose extension is used to determine the kind
 * @returns One of `"markdown"`, `"shell"`, `"javascript"`, `"json"`, `"text"`, or `"unknown"` indicating the inferred file kind
 */
function classifyFile(filePath: string): SkillBundleFile["kind"] {
  const ext = path.extname(filePath).toLowerCase();
  if ([".md", ".markdown"].includes(ext)) return "markdown";
  if ([".sh", ".bash", ".zsh"].includes(ext)) return "shell";
  if ([".js", ".mjs", ".cjs", ".ts", ".mts"].includes(ext)) return "javascript";
  if ([".json", ".jsonc"].includes(ext)) return "json";
  if ([".txt", ".yaml", ".yml", ".toml", ".env"].includes(ext)) return "text";
  return "unknown";
}

/**
 * Detects whether a buffer likely contains binary (non-text) data by scanning its initial bytes.
 *
 * @param buf - The buffer to inspect; only the first 512 bytes are examined.
 * @returns `true` if a control-like byte is found within the scanned range (indicative of binary data), `false` otherwise.
 */
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

/**
 * Load files under a support directory into `SkillBundleFile` records, applying safety and size limits.
 *
 * Resolves `supportDir` to a real path and recursively walks files beneath it. If the directory cannot be resolved,
 * returns an empty list. Symbolic links or files whose resolved real path escape the resolved root produce a placeholder
 * entry with `bytes: 0`, `kind: "unknown"`, and `content: "SYMLINK_OR_PATH_ESCAPE"`. For regular files, the function
 * records `relativePath`, `absolutePath`, `bytes`, and a `kind` inferred from the file extension; when a file is read
 * (subject to the per-file and cumulative byte limits), text files are UTF-8 decoded into `content` and binary files
 * are marked with `kind: "binary"` (no `content`).
 *
 * @param supportDir - Path to the support directory to load.
 * @param maxFileBytes - Maximum file size (in bytes) allowed for reading and decoding a single file. Files larger than
 *   this will still be listed but not read into `content`.
 * @param maxTotalBytes - Maximum cumulative bytes (in bytes) allowed for reading and decoding across all files. Once
 *   the cumulative total would exceed this limit, subsequent files are listed but not read into `content`.
 * @returns An array of `SkillBundleFile` entries for every discovered path; placeholder entries are used for symlinks or
 *   paths that resolve outside the support root.
 */
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

/**
 * Load a skill bundle from the given input by parsing the skill markdown and optionally loading support files.
 *
 * @param input - Input options containing `source`, `skillName`, `skillMarkdown`, optional `supportDir`, and optional file size limits
 * @returns A `SkillBundle` with parsed `frontmatter` and `body`, the original markdown and metadata, and any loaded `supportFiles`
 */
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
