// tests/claudeSdk.probe.test.ts
import { spawnSync } from "child_process";

// The SDK is ESM-only; jest's CJS transform cannot import it directly.
// Probe it in a real node ESM context instead.
test("claude-agent-sdk is installed and exposes query()", () => {
  const res = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "const m = await import('@anthropic-ai/claude-agent-sdk'); process.exit(typeof m.query === 'function' ? 0 : 1);",
    ],
    { encoding: "utf8" },
  );
  expect(res.status).toBe(0);
});
