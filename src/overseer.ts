import * as fs from "fs";
import * as path from "path";
import { Session } from "./session.js";
import { Phase } from "./stateMachine.js";
import { ModelTier } from "./router.js";
import { IdeationAgent } from "./agents/ideation.js";
import { ArchitectureAgent } from "./agents/architecture.js";
import { TaskGraphAgent } from "./agents/taskGraph.js";
import { CodingAgent } from "./agents/coding.js";
import { ReviewAgent } from "./agents/review.js";
import { IntegrationAgent } from "./agents/integration.js";
import { TestAgent } from "./agents/testAgent.js";
import { VerificationAgent } from "./agents/verification.js";
import { DeployAgent } from "./agents/deploy.js";
import { LiveEventFn } from "./agents/base.js";
import { externalAgentFor } from "./externalAgents.js";

type AskUser = (question: string) => Promise<string | undefined>;

export class Overseer {
  private emit: (msg: string) => void;
  private liveEvent?: LiveEventFn;

  constructor(
    private session: Session,
    eventCallback?: (msg: string) => void,
    liveEvent?: LiveEventFn,
  ) {
    this.emit = (msg) => {
      this.session.db.logEvent(this.session.id, this.session.phase, msg);
      eventCallback?.(msg);
    };
    this.liveEvent = liveEvent;
  }

  async run(askUser?: AskUser): Promise<void> {
    while (this.session.phase !== Phase.DONE && this.session.phase !== Phase.FAILED) {
      await this.runPhase(askUser);
    }
  }

  private agent<T>(Cls: new (...args: any[]) => T): T {
    return new Cls(this.session.router, this.session.db, this.session.id, this.liveEvent);
  }

  private spec(): string { return String(this.session.db.getSession(this.session.id)?.["spec"] ?? "{}"); }
  private arch(): string { return String(this.session.db.getSession(this.session.id)?.["architecture"] ?? "{}"); }

  private async runPhase(askUser?: AskUser): Promise<void> {
    const p = this.session.phase;
    this.emit(`Starting phase: ${p}`);
    switch (p) {
      case Phase.IDEATION: return this.ideation(askUser);
      case Phase.ARCHITECTURE: return this.architecture();
      case Phase.TASK_GRAPH: return this.taskGraph();
      case Phase.CODING: return this.coding();
      case Phase.INTEGRATION: return this.integration();
      case Phase.TESTING: return this.testing();
      case Phase.VERIFICATION: return this.verification();
      case Phase.DEPLOY: return this.deploy();
    }
  }

  private async ideation(askUser?: AskUser): Promise<void> {
    const agent = this.agent(IdeationAgent);
    const conversation: { role: string; content: string }[] = [];
    for (let i = 0; i < 4; i++) {
      const result = await agent.run({ idea: this.session.idea, conversation });
      if (result.error === "question") {
        const answer = askUser ? await askUser(result.output) : "skip";
        conversation.push({ role: "question", content: result.output }, { role: "answer", content: answer ?? "skip" });
      } else {
        this.session.db.updateSession(this.session.id, { spec: result.output });
        try {
          this.emit(`Spec: ${JSON.parse(result.output).name ?? "unnamed"}`);
        } catch {
          this.emit(`Spec: IDEATION complete`);
        }
        this.session.advancePhase(Phase.ARCHITECTURE);
        return;
      }
    }
    this.session.advancePhase(Phase.ARCHITECTURE);
  }

  private async architecture(): Promise<void> {
    this.emit("Picking stack & file structure…");
    const result = await this.agent(ArchitectureAgent).run({ spec: this.spec() });
    if (result.success) {
      this.session.db.updateSession(this.session.id, { architecture: result.output });
      try {
        const arch = JSON.parse(result.output);
        this.emit(`Architecture: ${arch.stack?.language ?? "?"}, ${arch.test_framework ?? "?"} tests`);
      } catch { this.emit("Architecture decided"); }
    }
    this.session.advancePhase(Phase.TASK_GRAPH);
  }

  private async taskGraph(): Promise<void> {
    this.emit("Building task dependency graph…");
    const result = await this.agent(TaskGraphAgent).run({ spec: this.spec(), architecture: this.arch() });
    if (result.success) {
      const tasks = JSON.parse(result.output) as { title: string; type: string; deps?: string[] }[];
      for (const t of tasks) this.session.db.createTask(this.session.id, t.title, t.type, t.deps);
      this.emit(`Task graph ready — ${tasks.length} tasks planned`);
    }
    this.session.advancePhase(Phase.CODING);
  }

  private async coding(): Promise<void> {
    const pending = this.session.db.getTasks(this.session.id, "pending");
    if (!pending.length) { this.session.advancePhase(Phase.INTEGRATION); return; }
    this.emit(`Coding ${pending.length} tasks in parallel…`);

    const useIsolation =
      externalAgentFor(this.session.router.modelFor(ModelTier.REASONING)) !== undefined;
    const tasksDir = path.join(this.session.workspace, "tasks");
    if (useIsolation) {
      if (fs.existsSync(tasksDir)) fs.rmSync(tasksDir, { recursive: true, force: true });
      try {
        await Promise.all(pending.map(t => {
          const taskWorkspace = path.join(tasksDir, String(t["id"]));
          fs.mkdirSync(taskWorkspace, { recursive: true });
          return this.codeTask(t, taskWorkspace);
        }));
        this.mergeTaskDirs(tasksDir, this.session.workspace);
      } finally {
        fs.rmSync(tasksDir, { recursive: true, force: true });
      }
    } else {
      await Promise.all(pending.map(t => this.codeTask(t)));
    }

    const done = this.session.db.getTasks(this.session.id, "completed").length;
    this.emit(`Coding complete — ${done} tasks done`);
    this.session.advancePhase(Phase.INTEGRATION);
  }

  private async codeTask(task: Record<string, unknown>, workspaceOverride?: string): Promise<void> {
    const id = String(task["id"]);
    const title = String(task["title"]);
    const workspace = workspaceOverride ?? this.session.workspace;
    this.emit(`Coding: ${title}`);
    this.session.db.updateTask(id, { status: "in_progress" });
    const result = await this.agent(CodingAgent).run({
      taskTitle: title, spec: this.spec(), architecture: this.arch(),
      workspace, taskId: id,
    });
    this.session.db.updateTask(id, { status: result.success ? "completed" : "failed", output: result.output });
    this.emit(`${result.success ? "✓" : "✗"} ${title}`);
    const review = await this.agent(ReviewAgent).run({ taskTitle: title, diff: result.output });
    if (review.success) {
      try {
        const rv = JSON.parse(review.output);
        if (!rv.approved && rv.issues?.length) this.emit(`Review: ${rv.issues[0]}`);
        else this.emit(`Review approved: ${title}`);
      } catch {}
    }
  }

  private async integration(): Promise<void> {
    this.emit("Wiring modules together…");
    const result = await this.agent(IntegrationAgent).run({ workspace: this.session.workspace, spec: this.spec(), architecture: this.arch() });
    this.emit(`Integration: ${result.success ? "all imports resolved" : "failed"}`);
    this.session.advancePhase(Phase.TESTING);
  }

  private async testing(): Promise<void> {
    this.emit("Writing and running tests…");
    const result = await this.agent(TestAgent).run({ workspace: this.session.workspace, architecture: this.arch() });
    this.emit(`Tests: ${result.success ? "passed" : "some failures — continuing"}`);
    this.session.advancePhase(Phase.VERIFICATION);
  }

  private async verification(): Promise<void> {
    this.emit("Building app and running full suite…");
    const result = await this.agent(VerificationAgent).run({ workspace: this.session.workspace, architecture: this.arch(), spec: this.spec() });
    if (result.success) {
      const next = this.session.deployTarget ? Phase.DEPLOY : Phase.DONE;
      this.session.advancePhase(next);
      this.emit("✓ Build passed — all checks green");
      return;
    }
    if (this.session.cycle >= this.session.maxCycles) {
      this.emit(`Max cycles (${this.session.maxCycles}) reached — build incomplete`);
      this.session.db.updateSession(this.session.id, { phase: Phase.FAILED });
      this.session.phase = Phase.FAILED;
      return;
    }
    this.session.incrementCycle();
    let report: Record<string, unknown[]> = { failed: [], errors: [] };
    try { report = JSON.parse(result.output); } catch {}
    const failures = (report["failed"] as string[]) ?? [];
    for (const failure of failures) {
      this.session.db.createTask(this.session.id, `Fix: ${failure}`, "coding");
    }
    this.emit(`Verification failed: ${failures.length} issue(s). Cycle ${this.session.cycle}/${this.session.maxCycles}`);
    this.session.advancePhase(Phase.CODING);
  }

  private async deploy(): Promise<void> {
    this.emit("Deploying…");
    const result = await this.agent(DeployAgent).run({ workspace: this.session.workspace, architecture: this.arch(), target: this.session.deployTarget ?? "none" });
    this.emit(`Deploy: ${result.success ? "live" : "failed"} — ${result.output.slice(0, 80)}`);
    this.session.advancePhase(Phase.DONE);
  }

  private mergeTaskDirs(tasksDir: string, dst: string): void {
    if (!fs.existsSync(tasksDir)) return;
    for (const taskId of fs.readdirSync(tasksDir)) {
      const taskDir = path.join(tasksDir, taskId);
      if (!fs.statSync(taskDir).isDirectory()) continue;
      this.copyDir(taskDir, dst);
    }
  }

  private copyDir(src: string, dst: string): void {
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const srcPath = path.join(src, entry.name);
      const dstPath = path.join(dst, entry.name);
      if (entry.isDirectory()) {
        fs.mkdirSync(dstPath, { recursive: true });
        this.copyDir(srcPath, dstPath);
      } else {
        fs.mkdirSync(path.dirname(dstPath), { recursive: true });
        fs.copyFileSync(srcPath, dstPath);
      }
    }
  }
}
