export type ExternalAgentId = "codex" | "claude-code";

export function externalAgentFor(modelId: string): ExternalAgentId | undefined {
  return modelId === "codex" || modelId === "claude-code" ? modelId : undefined;
}

export function isExternalAgentModel(modelId: string): boolean {
  return externalAgentFor(modelId) !== undefined;
}

export function externalAgentLabel(id: ExternalAgentId): string {
  return id === "codex" ? "codex" : "claude-code";
}

export function externalAgentEventPhase(id: ExternalAgentId): "CODEX_CALL" | "CLAUDE_CODE_CALL" {
  return id === "codex" ? "CODEX_CALL" : "CLAUDE_CODE_CALL";
}
