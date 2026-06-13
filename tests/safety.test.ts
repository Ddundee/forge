// tests/safety.test.ts
import { isBlockedCommand, BLOCKED_PATTERNS } from "../src/safety.js";

test("blocks dangerous commands case-insensitively", () => {
  expect(isBlockedCommand("rm -rf /")).toBe(true);
  expect(isBlockedCommand("RM -RF /")).toBe(true);
  expect(isBlockedCommand("echo hi && sudo rm -rf /tmp/x")).toBe(true);
  expect(isBlockedCommand("dd if=/dev/zero of=/dev/disk0")).toBe(true);
});

test("allows ordinary commands", () => {
  expect(isBlockedCommand("npm test")).toBe(false);
  expect(isBlockedCommand("rm -rf node_modules")).toBe(false);
  expect(isBlockedCommand("git status")).toBe(false);
});

test("pattern list is non-empty", () => {
  expect(BLOCKED_PATTERNS.length).toBeGreaterThan(0);
});

test("all blocked patterns remain blocked under case changes", () => {
  for (const pattern of BLOCKED_PATTERNS) {
    expect(isBlockedCommand(pattern.toLowerCase())).toBe(true);
    expect(isBlockedCommand(pattern.toUpperCase())).toBe(true);
  }
});
