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

test("build help includes skill flags", () => {
  const output = execFileSync(
    process.execPath,
    [...process.execArgv, cliPath, "build", "--help"],
    { encoding: "utf8" },
  );
  expect(output).toContain("--skills");
  expect(output).toContain("--skills-max");
});

test("build rejects invalid skills mode", () => {
  expect(() =>
    execFileSync(
      process.execPath,
      [...process.execArgv, cliPath, "build", "idea", "--skills", "manual"],
      { encoding: "utf8", stdio: "pipe" },
    ),
  ).toThrow();
});

test("build rejects negative skills-max", () => {
  expect(() =>
    execFileSync(
      process.execPath,
      [...process.execArgv, cliPath, "build", "idea", "--skills-max", "-1"],
      { encoding: "utf8", stdio: "pipe" },
    ),
  ).toThrow();
});
