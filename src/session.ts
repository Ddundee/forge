import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { randomUUID } from "crypto";
import { ForgeDb } from "./db.js";
import { LLMRouter } from "./router.js";
import { ForgeConfig, loadConfig, normalizeSkillConfig } from "./config.js";
import { Phase, transition } from "./stateMachine.js";
import { type MdCatalog, listToolCallModels, SUPPORTED_PROVIDERS } from "./modelsdev.js";
import { AutoSelector } from "./autoSelector.js";

export const SESSIONS_DIR = path.join(os.homedir(), ".forge", "sessions");

const PROVIDER_ENV_KEYS: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai:    "OPENAI_API_KEY",
  google:    "GOOGLE_API_KEY",
  groq:      "GROQ_API_KEY",
  mistral:   "MISTRAL_API_KEY",
};

function wireAutoSelector(
  router: LLMRouter,
  cfg: ForgeConfig,
  db: ForgeDb,
  sessionId: string,
  catalog?: MdCatalog,
): void {
  if (cfg.profile !== "auto" || !cfg.autoOverseer || !catalog) return;
  const activeProviders = SUPPORTED_PROVIDERS.filter(p => !!process.env[PROVIDER_ENV_KEYS[p]]);
  const providers = activeProviders.length ? activeProviders : SUPPORTED_PROVIDERS;
  const available = listToolCallModels(catalog, providers, true).map(({ model }) => model.id);
  const logFn = (msg: string) => db.logEvent(sessionId, "AUTO_SELECT", msg);
  router.setAutoSelector(new AutoSelector(cfg.autoOverseer, cfg.priority, available, logFn));
}

function applySessionSkillSnapshot(current: ForgeConfig, row: Record<string, unknown>): ForgeConfig {
  const raw = typeof row["config_json"] === "string" ? row["config_json"] : "{}";
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const skills = normalizeSkillConfig(parsed["skills"]);
    return current.withSkills(skills);
  } catch {
    return current;
  }
}

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

  static create(
    idea: string,
    deployTarget?: string,
    sessionsDir = SESSIONS_DIR,
    workspace?: string,
    catalog?: MdCatalog,
    configOverride?: ForgeConfig,
  ): Session {
    const id = randomUUID().slice(0, 8);
    const sessionDir = path.join(sessionsDir, id);
    fs.mkdirSync(path.join(sessionDir, "logs"), { recursive: true });
    const resolvedWorkspace = workspace ?? path.join(sessionDir, "workspace");
    fs.mkdirSync(resolvedWorkspace, { recursive: true });
    const cfg = configOverride ?? loadConfig();
    const db = new ForgeDb(path.join(sessionDir, "session.db"));
    db.createSession(idea, id, JSON.stringify(cfg.toJson()));
    db.updateSession(id, { workspace: resolvedWorkspace });
    if (deployTarget) db.updateSession(id, { deploy_target: deployTarget });
    const router = new LLMRouter(cfg.tierModels(), catalog);
    wireAutoSelector(router, cfg, db, id, catalog);
    return new Session(
      id, idea, Phase.IDEATION, 0, cfg.maxCycles, deployTarget,
      resolvedWorkspace,
      db, router, cfg,
    );
  }

  static load(sessionId: string, sessionsDir = SESSIONS_DIR, catalog?: MdCatalog): Session {
    const sessionDir = path.join(sessionsDir, sessionId);
    if (!fs.existsSync(sessionDir)) throw new Error(`Session ${sessionId} not found`);
    const db = new ForgeDb(path.join(sessionDir, "session.db"));
    const row = db.getSession(sessionId);
    if (!row) throw new Error(`Session ${sessionId} not in database`);
    const cfg = applySessionSkillSnapshot(loadConfig(), row);
    const workspace = row["workspace"]
      ? String(row["workspace"])
      : path.join(sessionDir, "workspace");
    const router = new LLMRouter(cfg.tierModels(), catalog);
    wireAutoSelector(router, cfg, db, sessionId, catalog);
    return new Session(
      sessionId, String(row["idea"]), row["phase"] as Phase,
      Number(row["cycle"]), Number(row["max_cycles"]),
      row["deploy_target"] as string | undefined,
      workspace,
      db, router, cfg,
    );
  }

  static loadLast(sessionsDir = SESSIONS_DIR, catalog?: MdCatalog): Session {
    if (!fs.existsSync(sessionsDir)) throw new Error("No sessions found");
    const dirs = fs.readdirSync(sessionsDir)
      .filter(name => fs.statSync(path.join(sessionsDir, name)).isDirectory())
      .map(name => ({ name, mtime: fs.statSync(path.join(sessionsDir, name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    if (!dirs.length) throw new Error("No sessions found");
    return Session.load(dirs[0].name, sessionsDir, catalog);
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
