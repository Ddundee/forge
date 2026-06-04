import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { randomUUID } from "crypto";
import { ForgeDb } from "./db.js";
import { LLMRouter } from "./router.js";
import { ForgeConfig, loadConfig } from "./config.js";
import { Phase, transition } from "./stateMachine.js";

export const SESSIONS_DIR = path.join(os.homedir(), ".forge", "sessions");

export class Session {
  constructor(
    public id: string,
    public idea: string,
    public phase: Phase,
    public cycle: number,
    public maxCycles: number,
    public deployTarget: string | undefined,
    public workspace: string,
    public db: ForgeDb,
    public router: LLMRouter,
    public config: ForgeConfig,
  ) {}

  static create(idea: string, deployTarget?: string, sessionsDir = SESSIONS_DIR): Session {
    const id = randomUUID().slice(0, 8);
    const sessionDir = path.join(sessionsDir, id);
    fs.mkdirSync(path.join(sessionDir, "workspace"), { recursive: true });
    fs.mkdirSync(path.join(sessionDir, "logs"), { recursive: true });
    const cfg = loadConfig();
    const db = new ForgeDb(path.join(sessionDir, "session.db"));
    db.createSession(idea, id);
    if (deployTarget) db.updateSession(id, { deploy_target: deployTarget });
    return new Session(
      id, idea, Phase.IDEATION, 0, cfg.maxCycles, deployTarget,
      path.join(sessionDir, "workspace"),
      db, new LLMRouter(cfg.tierModels()), cfg,
    );
  }

  static load(sessionId: string, sessionsDir = SESSIONS_DIR): Session {
    const sessionDir = path.join(sessionsDir, sessionId);
    if (!fs.existsSync(sessionDir)) throw new Error(`Session ${sessionId} not found`);
    const cfg = loadConfig();
    const db = new ForgeDb(path.join(sessionDir, "session.db"));
    const row = db.getSession(sessionId);
    if (!row) throw new Error(`Session ${sessionId} not in database`);
    return new Session(
      sessionId, String(row["idea"]), row["phase"] as Phase,
      Number(row["cycle"]), Number(row["max_cycles"]),
      row["deploy_target"] as string | undefined,
      path.join(sessionDir, "workspace"),
      db, new LLMRouter(cfg.tierModels()), cfg,
    );
  }

  static loadLast(sessionsDir = SESSIONS_DIR): Session {
    if (!fs.existsSync(sessionsDir)) throw new Error("No sessions found");
    const dirs = fs.readdirSync(sessionsDir)
      .filter(name => fs.statSync(path.join(sessionsDir, name)).isDirectory())
      .map(name => ({ name, mtime: fs.statSync(path.join(sessionsDir, name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    if (!dirs.length) throw new Error("No sessions found");
    return Session.load(dirs[0].name, sessionsDir);
  }

  advancePhase(next: Phase): void {
    transition(this.phase, next);
    this.phase = next;
    this.db.updateSession(this.id, { phase: next });
  }

  incrementCycle(): void {
    this.cycle++;
    this.db.updateSession(this.id, { cycle: this.cycle });
  }
}
