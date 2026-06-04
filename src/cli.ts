#!/usr/bin/env node
import { Command } from "commander";
import { loadKeys } from "./config.js";
import { Session } from "./session.js";
import { Overseer } from "./overseer.js";
import { startLiveFeed } from "./ui/liveFeed.js";
import { Phase } from "./stateMachine.js";
import { getCatalog } from "./modelsdev.js";

const program = new Command("forgecli").description("Idea to product in one command.");

program
  .command("build <idea>")
  .option("-d, --deploy <target>", "Deploy target: vercel, railway, fly.io")
  .option("--max-cycles <n>", "Max fix iterations", "5")
  .action(async (idea: string, opts: { deploy?: string; maxCycles: string }) => {
    loadKeys();
    const catalog = await getCatalog().catch(() => undefined);
    const session = Session.create(idea, opts.deploy, undefined, process.cwd(), catalog);
    const feed = startLiveFeed(idea);

    const onEvent = (message: string) => {
      feed.setOverseer(message);
      feed.pushEvent(session.phase, message);
      feed.setCycle(session.cycle);
      feed.setTotalCost(session.db.getTotalCost(session.id));
      for (const task of session.db.getTasks(session.id)) {
        feed.updateTask(String(task["id"]), String(task["title"]), String(task["status"]));
      }
    };

    const overseer = new Overseer(session, onEvent);
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

  const feed = startLiveFeed(session.idea);

  const onEvent = (message: string) => {
    feed.setOverseer(message);
    feed.pushEvent(session.phase, message);
    feed.setCycle(session.cycle);
    feed.setTotalCost(session.db.getTotalCost(session.id));
    for (const task of session.db.getTasks(session.id)) {
      feed.updateTask(String(task["id"]), String(task["title"]), String(task["status"]));
    }
  };

  // Replay existing tasks into the feed so the pane isn't empty on resume
  for (const task of session.db.getTasks(session.id)) {
    feed.updateTask(String(task["id"]), String(task["title"]), String(task["status"]));
  }

  const overseer = new Overseer(session, onEvent);
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
