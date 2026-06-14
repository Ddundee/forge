// scripts/claude-session-smoke.mjs
// Usage: npm run build && FORGE_E2E_CLAUDE=1 node scripts/claude-session-smoke.mjs
// Verifies: a real SDK session starts, retains context across two turns, and records a session id.
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ForgeDb } from "../dist/db.js";
import { ClaudeSessionManager } from "../dist/claudeSession.js";

if (process.env.FORGE_E2E_CLAUDE !== "1") {
  console.log("Skipped. Set FORGE_E2E_CLAUDE=1 to run the real-SDK smoke test (uses Claude quota).");
  process.exit(0);
}

const dir = mkdtempSync(join(tmpdir(), "forge-smoke-"));
const db = new ForgeDb(":memory:");
const forgeId = db.createSession("smoke");
const manager = new ClaudeSessionManager(db, forgeId, dir);

try {
  const session = await manager.main();
  const first = await session.send(
    "Remember this marker: forge-session-proxy-smoke. Reply with OK and nothing else.",
    { timeoutMs: 120_000 },
  );
  console.log(`turn 1: ${first.text.slice(0, 80)} (cost $${first.costUsd.toFixed(4)})`);
  const second = await session.send(
    "What marker did I give you earlier? Reply with the marker and nothing else.",
    { timeoutMs: 120_000 },
  );
  console.log(`turn 2: ${second.text.slice(0, 80)} (cacheRead ${second.cacheRead} tokens)`);
  const recorded = db.listClaudeSessions(forgeId)[0]?.claude_session_id;
  if (!second.text.includes("forge-session-proxy-smoke")) {
    throw new Error(`context NOT retained across turns: "${second.text.slice(0, 200)}"`);
  }
  if (!recorded) throw new Error("no claude_session_id recorded");
  console.log(`PASS — session ${recorded} retained context. Attach with: claude --resume ${recorded}`);
} finally {
  await manager.closeAll();
  rmSync(dir, { recursive: true, force: true });
}
