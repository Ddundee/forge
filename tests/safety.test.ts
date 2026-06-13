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

test("empty string is not blocked", () => {
  expect(isBlockedCommand("")).toBe(false);
});

test("whitespace-only string is not blocked", () => {
  expect(isBlockedCommand("   \t\n  ")).toBe(false);
});

test("rm -rf /home is blocked because it contains the pattern rm -rf /", () => {
  expect(isBlockedCommand("rm -rf /home/user/myproject")).toBe(true);
});

test("mkfs with filesystem type suffix is blocked", () => {
  expect(isBlockedCommand("mkfs.ext4 /dev/sdb")).toBe(true);
  expect(isBlockedCommand("mkfs.vfat /dev/sdc1")).toBe(true);
});

test("> /dev/sda with partition suffix is blocked", () => {
  expect(isBlockedCommand("> /dev/sda1")).toBe(true);
  expect(isBlockedCommand("cat /dev/zero > /dev/sda2")).toBe(true);
});

test("chown -R with any arguments is blocked", () => {
  expect(isBlockedCommand("chown -R user:group /var/www")).toBe(true);
});

test("chmod 777 / with path suffix is blocked", () => {
  expect(isBlockedCommand("chmod 777 /tmp")).toBe(true);
  expect(isBlockedCommand("chmod 777 /etc")).toBe(true);
});

test("fork bomb pattern is blocked", () => {
  expect(isBlockedCommand(":(){ :|:& };: # this is a fork bomb")).toBe(true);
});

test("safe rm commands are not blocked", () => {
  // Note: "rm -rf /tmp/..." WOULD be blocked because it contains "rm -rf /".
  // These commands use relative paths and do not match any blocked pattern.
  expect(isBlockedCommand("rm -rf ./dist")).toBe(false);
  expect(isBlockedCommand("rm -rf node_modules")).toBe(false);
  expect(isBlockedCommand("rm file.txt")).toBe(false);
  expect(isBlockedCommand("rm -r build/")).toBe(false);
});

test("each pattern in BLOCKED_PATTERNS individually matches itself", () => {
  for (const pattern of BLOCKED_PATTERNS) {
    expect(isBlockedCommand(pattern)).toBe(true);
  }
});

test("each pattern in BLOCKED_PATTERNS matches in uppercase", () => {
  for (const pattern of BLOCKED_PATTERNS) {
    expect(isBlockedCommand(pattern.toUpperCase())).toBe(true);
  }
});

test("command embedded in echo call can still be blocked", () => {
  expect(isBlockedCommand("echo 'running' && sudo dd if=/dev/zero of=/dev/sda")).toBe(true);
});

test("safe mkfs-like word that does not contain the pattern is not blocked", () => {
  // "mkfs" is the pattern, so any word starting with mkfs would be blocked — confirm not confused with safe commands
  expect(isBlockedCommand("ls -la /dev")).toBe(false);
  expect(isBlockedCommand("df -h")).toBe(false);
});
