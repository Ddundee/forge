#!/usr/bin/env node
import { Command, Option } from "commander";
import { loadKeys, loadConfig } from "./config.js";
import { applyBuildSkillOverrides, parseBuildSkillOptions, parseNonNegativeInt } from "./skills/cliOptions.js";
import { Session } from "./session.js";
import { Overseer } from "./overseer.js";
import { startLiveFeed } from "./ui/liveFeed.js";
import { Phase } from "./stateMachine.js";
import { getCatalog } from "./modelsdev.js";
import type { LiveEventFn } from "./agents/base.js";

function makeHandlers(session: Session, feed: ReturnType<typeof startLiveFeed>) {
  const onPhaseEvent = (message: string) => {
    feed.setOverseer(message);
    feed.pushEvent(session.phase, "phase", message);
    feed.setCycle(session.cycle);
    feed.setTotalCost(session.db.getTotalCost(session.id));
    for (const task of session.db.getTasks(session.id)) {
      feed.updateTask(String(task["id"]), String(task["title"]), String(task["status"]));
    }
  };

  const onAgentEvent: LiveEventFn = (kind, message) => {
    feed.pushEvent(session.phase, kind, message);
  };

  return { onPhaseEvent, onAgentEvent };
}

const program = new Command("forgecli").description("Idea to product in one command.");

interface BuildCommandOptions {
  deploy?: string;
  maxCycles: string;
  skills?: string;
  skillsMax?: number;
}

program
  .command("build <idea>")
  .option("-d, --deploy <target>", "Deploy target: vercel, railway, fly.io")
  .option("--max-cycles <n>", "Max fix iterations", "5")
  .addOption(new Option("--skills <mode>", "Skill usage for this build").choices(["auto", "off"]))
  .addOption(
    new Option("--skills-max <n>", "Maximum skills Forge may select for this build").argParser(
      (value) => parseNonNegativeInt(value, "--skills-max"),
    ),
  )
  .action(async (idea: string, opts: BuildCommandOptions, command: Command) => {
    loadKeys();
    const catalog = await getCatalog().catch(() => undefined);
    const baseConfig = loadConfig();
    const skillOverrides = parseBuildSkillOptions({ skills: opts.skills, skillsMax: opts.skillsMax });
    const effectiveConfig = applyBuildSkillOverrides(baseConfig, skillOverrides);
    // Only an explicit flag overrides config.toml — commander's default "5"
    // must not clobber a user-configured max_cycles.
    if (command.getOptionValueSource("maxCycles") !== "default") {
      const maxCycles = parseInt(opts.maxCycles, 10);
      if (Number.isFinite(maxCycles) && maxCycles > 0) effectiveConfig.maxCycles = maxCycles;
    }
    for (const warning of skillOverrides.warnings) console.warn(`Warning: ${warning}`);
    const session = Session.create(idea, opts.deploy, undefined, process.cwd(), catalog, effectiveConfig);
    const feed = startLiveFeed(idea, session.maxCycles);

    const { onPhaseEvent, onAgentEvent } = makeHandlers(session, feed);
    const overseer = new Overseer(session, onPhaseEvent, onAgentEvent);
    try {
      await overseer.run();
    } finally {
      feed.stop();
    }

    if (session.phase === Phase.DONE) {
      console.log(`\n✓ Done! Workspace: ${session.workspace}`);
    } else {
      console.log(`\nStopped at phase: ${session.phase}`);
    }
  });

program.command("setup").action(async () => {
  const { runSetupWizard } = await import("./config.js");
  await runSetupWizard();
});

program.command("sessions").action(async () => {
  const { listSessions } = await import("./commands/sessions.js");
  await listSessions();
});

program.command("resume [sessionId]").action(async (sessionId?: string) => {
  loadKeys();
  const catalog = await getCatalog().catch(() => undefined);
  const session = sessionId ? Session.load(sessionId, undefined, catalog) : Session.loadLast(undefined, catalog);

  if (session.phase === Phase.DONE || session.phase === Phase.FAILED) {
    const tasks = session.db.getTasks(session.id);
    const done = tasks.filter(t => t["status"] === "completed").length;
    console.log(`\nSession: ${session.id}`);
    console.log(`  Phase : ${session.phase}`);
    console.log(`  Idea  : ${session.idea}`);
    console.log(`  Tasks : ${done}/${tasks.length} completed`);
    console.log(`  Workspace: ${session.workspace}\n`);
    return;
  }

  const feed = startLiveFeed(session.idea, session.maxCycles);

  const { onPhaseEvent, onAgentEvent } = makeHandlers(session, feed);

  // Replay existing tasks into the feed so the pane isn't empty on resume
  for (const task of session.db.getTasks(session.id)) {
    feed.updateTask(String(task["id"]), String(task["title"]), String(task["status"]));
  }

  const overseer = new Overseer(session, onPhaseEvent, onAgentEvent);
  try {
    await overseer.run();
  } finally {
    feed.stop();
  }

  const finalPhase: string = session.phase;
  if (finalPhase === Phase.DONE) {
    console.log(`\n✓ Done! Workspace: ${session.workspace}`);
  } else {
    console.log(`\nStopped at phase: ${finalPhase}`);
  }
});

program.command("logs [sessionId]").action(async (sessionId?: string) => {
  const { showLogs } = await import("./commands/logs.js");
  await showLogs(sessionId);
});

program
  .command("prompts [sessionId]")
  .option("-f, --follow", "Stream new entries in real-time")
  .option("-v, --verbose", "Show full prompt and response text")
  .action(async (sessionId?: string, opts?: { follow?: boolean; verbose?: boolean }) => {
    const { showPrompts } = await import("./commands/prompts.js");
    await showPrompts(sessionId, opts);
  });

program.parseAsync(process.argv).catch(err => {
  console.error(`\nError: ${err.message}`);
  console.error("Session saved — resume with: forgecli resume");
  process.exit(1);
});
