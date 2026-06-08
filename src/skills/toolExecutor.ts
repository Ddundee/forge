import type { ForgeDb } from "../db.js";
import type { SkillContextRequest, SkillInjectionRecord } from "./types.js";
import type { SkillContextProvider } from "./context.js";
import { renderFullSkillReadResult } from "./render.js";

export class SkillContextRuntime {
  private logged = new Set<string>();

  constructor(
    public readonly provider: SkillContextProvider,
    public readonly request: SkillContextRequest,
  ) {}

  logOnce(
    db: Pick<ForgeDb, "logSkillInjection">,
    sessionId: string,
    record: SkillInjectionRecord,
  ): void {
    const key = [
      record.selectionId,
      record.agentName,
      record.taskId ?? "",
      record.contextKind,
    ].join("\0");
    if (this.logged.has(key)) return;
    this.logged.add(key);
    db.logSkillInjection(sessionId, record);
  }
}

export function isSkillTool(name: string): boolean {
  return name === "skill_list" || name === "skill_read";
}

export function executeSkillTool(
  name: string,
  args: Record<string, unknown>,
  runtime: SkillContextRuntime,
  db: Pick<ForgeDb, "logSkillInjection">,
  sessionId: string,
): string {
  if (name === "skill_list") {
    const rendered = runtime.provider.renderCompact(runtime.request);
    for (const [, selectionId] of Object.entries(runtime.request.selectionIdsBySourceKey)) {
      runtime.logOnce(db, sessionId, {
        selectionId,
        attempt: runtime.request.attempt,
        agentName: runtime.request.agentName,
        taskId: runtime.request.taskId,
        contextKind: "compact",
        charCount: rendered.charCount,
      });
    }
    return rendered.content;
  }

  if (name === "skill_read") {
    const sourceKey = String(args["source_key"] ?? "");
    const file = args["file"] === undefined ? undefined : String(args["file"]);
    const maxChars = args["max_chars"] === undefined ? undefined : Number(args["max_chars"]);
    try {
      const result = runtime.provider.readSkill(runtime.request, { sourceKey, file, maxChars });
      const selectionId = runtime.request.selectionIdsBySourceKey[sourceKey];
      if (selectionId) {
        runtime.logOnce(db, sessionId, {
          selectionId,
          attempt: runtime.request.attempt,
          agentName: runtime.request.agentName,
          taskId: runtime.request.taskId,
          contextKind: "full",
          charCount: result.charCount,
        });
      }
      return renderFullSkillReadResult(result);
    } catch (err) {
      return `ERROR: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  return `ERROR: Unknown skill tool '${name}'`;
}

export function summarizeSkillToolResult(name: string, result: string): string {
  if (name === "skill_read") {
    const firstLine = result.split("\n").find(Boolean) ?? "";
    return `[skill_read returned ${result.length} chars] ${firstLine}`.slice(0, 2000);
  }
  return result.slice(0, 2000);
}
