import { execFileSync } from "child_process";
import * as path from "path";

const cliPath = path.join(__dirname, "..", "dist", "cli.js");

test("built CLI responds to --help with all commands", () => {
  const output = execFileSync(process.execPath, [...process.execArgv, cliPath, "--help"], { encoding: "utf8" });
  expect(output).toContain("build");
  expect(output).toContain("setup");
  expect(output).toContain("sessions");
  expect(output).toContain("resume");
  expect(output).toContain("logs");
  expect(output).toContain("prompts");
});
