import { BaseAgent, AgentResult } from "./base.js";
import { ModelTier } from "../router.js";

const SYSTEM = `You are a software architect. Given a product spec, choose the ideal tech stack and project structure.

Output ONLY valid JSON:
{
  "stack": {"language": "...", "framework": "...", "database": "...", "extras": []},
  "structure": ["list of key file paths / dirs"],
  "deploy_platforms": ["vercel|railway|fly.io|none"],
  "test_framework": "pytest|vitest|go-test|jest|...",
  "verification_method": "web|api|cli"
}

Important: For React frontend apps, prefer Vite (framework: "Vite+React") over Create React App.`;

export class ArchitectureAgent extends BaseAgent {
  protected tier = ModelTier.OVERSEER;

  async run(args: Record<string, unknown>): Promise<AgentResult> {
    const messages: any[] = [
      { role: "system", content: SYSTEM },
      { role: "user", content: `Spec:\n${args["spec"]}` },
    ];
    const response = await this.call(messages);
    try {
      const cleaned = this.extractJson(response);
      JSON.parse(cleaned);
      return { success: true, output: cleaned };
    } catch {
      return { success: false, output: response, error: "invalid_json" };
    }
  }
}
