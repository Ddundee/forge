import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";

const AGENT_ROLES: Record<string, string> = {
  IdeationAgent:    "Explore requirements and clarify the user's idea — high creativity, open-ended reasoning",
  ArchitectureAgent:"Design system architecture and choose the tech stack — deep multi-step reasoning",
  TaskGraphAgent:   "Decompose architecture into a dependency graph of tasks — structured, precise output",
  CodingAgent:      "Implement individual tasks by writing code and running shell commands — speed + correctness",
  ReviewAgent:      "Review code for bugs and quality — moderate capability sufficient",
  IntegrationAgent: "Combine components and resolve integration issues — moderate reasoning",
  TestAgent:        "Write and execute tests — moderate capability sufficient",
  VerificationAgent:"Verify the product meets requirements — moderate capability sufficient",
  DeployAgent:      "Package and deploy the product — straightforward execution",
};

function resolveModel(modelId: string) {
  if (modelId.startsWith("claude")) return createAnthropic()(modelId);
  if (modelId.startsWith("gpt") || modelId.startsWith("o3") || modelId.startsWith("o4"))
    return createOpenAI()(modelId);
  if (modelId.includes("gemini"))
    return createGoogleGenerativeAI()(modelId.replace("gemini/", ""));
  return createOpenAI()(modelId);
}

export class AutoSelector {
  constructor(
    private overseerModel: string,
    private priority: "quality" | "speed" | "cost",
    private availableModels: string[],
    private logFn: (msg: string) => void = () => {},
  ) {}

  async selectModel(agentName: string, recentContext: string): Promise<string> {
    if (!this.availableModels.length) return this.overseerModel;
    try {
      const role = AGENT_ROLES[agentName] ?? "General LLM task in a software build pipeline";
      const prompt = `You are a model router for a multi-agent software build pipeline. Pick the optimal LLM for the current task.

User priority: ${this.priority}
  quality — use the most capable model regardless of cost
  speed   — use the fastest adequate model
  cost    — use the cheapest adequate model

Current agent: ${agentName}
Agent role: ${role}

Recent session context:
${recentContext || "Session just started."}

Available models:
${this.availableModels.join("\n")}

Reply with ONLY the exact model ID from the list above. Nothing else.`;

      const result = await generateText({
        model: resolveModel(this.overseerModel),
        messages: [{ role: "user", content: prompt }],
      });
      const chosen = result.text.trim();
      const valid = this.availableModels.includes(chosen) ? chosen : this.availableModels[0];
      this.logFn(`AutoSelector: ${agentName} → ${valid}`);
      return valid;
    } catch {
      const fallback = this.availableModels[0];
      this.logFn(`AutoSelector: ${agentName} → ${fallback} (fallback)`);
      return fallback;
    }
  }
}
