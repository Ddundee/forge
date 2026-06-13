// src/safety.ts
export const BLOCKED_PATTERNS = [
  "rm -rf /", "rm -rf ~", ":(){ :|:& };:", "dd if=/dev/zero",
  "mkfs", "> /dev/sda", "chmod 777 /", "chown -R", "sudo rm", "sudo dd",
];

export function isBlockedCommand(command: string): boolean {
  const lower = command.toLowerCase();
  return BLOCKED_PATTERNS.some(p => lower.includes(p));
}
