// src/safety.ts
export const BLOCKED_PATTERNS = [
  "rm -rf /", "rm -rf ~", ":(){ :|:& };:", "dd if=/dev/zero",
  "mkfs", "> /dev/sda", "chmod 777 /", "chown -r", "sudo rm", "sudo dd",
];

/**
 * Determines whether a command contains a blocked pattern.
 *
 * @param command - The command text to check
 * @returns `true` if the command contains any blocked pattern, `false` otherwise
 */
export function isBlockedCommand(command: string): boolean {
  const lower = command.toLowerCase();
  return BLOCKED_PATTERNS.some((p) => lower.includes(p.toLowerCase()));
}
