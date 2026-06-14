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

test("empty or whitespace-only commands are not blocked", () => {
  expect(isBlockedCommand("")).toBe(false);
  expect(isBlockedCommand("   \t\n  ")).toBe(false);
});

test("dangerous path suffix variants are blocked", () => {
  expect(isBlockedCommand("rm -rf /home/user/myproject")).toBe(true);
  expect(isBlockedCommand("mkfs.ext4 /dev/sdb")).toBe(true);
  expect(isBlockedCommand("mkfs.vfat /dev/sdc1")).toBe(true);
  expect(isBlockedCommand("> /dev/sda1")).toBe(true);
  expect(isBlockedCommand("cat /dev/zero > /dev/sda2")).toBe(true);
  expect(isBlockedCommand("chmod 777 /tmp")).toBe(true);
  expect(isBlockedCommand("chmod 777 /etc")).toBe(true);
});

test("recursive chown and fork bombs are blocked", () => {
  expect(isBlockedCommand("chown -R user:group /var/www")).toBe(true);
  expect(isBlockedCommand(":(){ :|:& };: # fork bomb")).toBe(true);
});

test("safe relative rm commands are not blocked", () => {
  expect(isBlockedCommand("rm -rf ./dist")).toBe(false);
  expect(isBlockedCommand("rm -rf node_modules")).toBe(false);
  expect(isBlockedCommand("rm file.txt")).toBe(false);
  expect(isBlockedCommand("rm -r build/")).toBe(false);
});

test("embedded dangerous commands are still blocked", () => {
  expect(isBlockedCommand("echo 'running' && sudo dd if=/dev/zero of=/dev/sda")).toBe(true);
});

test("all blocked patterns remain blocked under case changes", () => {
  for (const pattern of BLOCKED_PATTERNS) {
    expect(isBlockedCommand(pattern.toLowerCase())).toBe(true);
    expect(isBlockedCommand(pattern.toUpperCase())).toBe(true);
  }
});
