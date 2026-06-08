import { redactSnippet } from "./redact.js";

export type SkillAuditSeverity = "info" | "warn" | "block";

export type SkillAuditCategory =
  | "prompt_injection"
  | "hidden_behavior"
  | "secret_access"
  | "exfiltration"
  | "destructive_command"
  | "privilege_escalation"
  | "remote_code_execution"
  | "dependency_install"
  | "network"
  | "git_mutation"
  | "deployment"
  | "support_file"
  | "metadata"
  | "size"
  | "source_trust";

export interface SkillAuditFinding {
  id: string;
  category: SkillAuditCategory;
  severity: SkillAuditSeverity;
  message: string;
  location: string;
  snippet?: string;
}

export interface SkillAuditRule {
  id: string;
  category: SkillAuditCategory;
  severity: SkillAuditSeverity;
  message: string;
  patterns: RegExp[];
  appliesTo: Array<"markdown" | "code" | "support">;
}

const PROMPT_INJECTION_RULES: SkillAuditRule[] = [
  {
    id: "prompt.ignore-higher-instructions",
    category: "prompt_injection",
    severity: "block",
    message: "Skill attempts to bypass higher-priority instructions.",
    appliesTo: ["markdown", "code", "support"],
    patterns: [
      /\bignore\b[^\n]{0,60}(system|developer|previous|prior|above)\s+instructions\b/i,
      /\boverride\b[^\n]{0,40}(system|developer|user)\s+(prompt|instructions)\b/i,
      /\bdo not follow\b[^\n]{0,40}(system|developer|user)\s+instructions\b/i,
    ],
  },
  {
    id: "prompt.reveal-system-prompt",
    category: "prompt_injection",
    severity: "block",
    message: "Skill asks the agent to reveal hidden prompts or internal instructions.",
    appliesTo: ["markdown", "code", "support"],
    patterns: [
      /\b(reveal|print|dump|show).{0,40}(system prompt|developer message|hidden instructions)\b/i,
      /\bwhat (were|are) your (system|developer) instructions\b/i,
    ],
  },
];

const HIDDEN_BEHAVIOR_RULES: SkillAuditRule[] = [
  {
    id: "hidden.do-not-tell-user",
    category: "hidden_behavior",
    severity: "block",
    message: "Skill instructs the agent to hide actions from the user.",
    appliesTo: ["markdown", "code", "support"],
    patterns: [
      /\b(do not|don't|never) (tell|inform|notify) (the )?user\b/i,
      /\bhide (this|the) (action|command|step|output)\b/i,
      /\bpretend (that )?(you|the agent) (did|completed|ran)\b/i,
    ],
  },
];

const SECRET_ACCESS_RULES: SkillAuditRule[] = [
  {
    id: "secret.forge-keys",
    category: "secret_access",
    severity: "block",
    message: "Skill references Forge key storage.",
    appliesTo: ["markdown", "code", "support"],
    patterns: [
      /~\/\.forge\/keys\.env/i,
      /\$HOME\/\.forge\/keys\.env/i,
      /\.forge\/keys\.env/i,
    ],
  },
  {
    id: "secret.env-file",
    category: "secret_access",
    severity: "block",
    message: "Skill attempts to read environment files.",
    appliesTo: ["markdown", "code", "support"],
    patterns: [
      /\b(cat|less|more|grep|sed|awk)\s+([^\n;&|]*\/)?\.env(\.[a-z0-9_-]+)?\b/i,
      /\bread_file\b.{0,80}\.env\b/i,
    ],
  },
  {
    id: "secret.ssh-or-cloud-creds",
    category: "secret_access",
    severity: "block",
    message: "Skill references SSH or cloud credential files.",
    appliesTo: ["markdown", "code", "support"],
    patterns: [
      /~\/\.ssh\/(id_rsa|id_ed25519|config)/i,
      /~\/\.aws\/credentials/i,
      /~\/\.config\/gcloud/i,
      /~\/\.netrc/i,
    ],
  },
  {
    id: "secret.process-env-dump",
    category: "secret_access",
    severity: "block",
    message: "Skill attempts to dump process environment.",
    appliesTo: ["markdown", "code", "support"],
    patterns: [
      /\b(printenv|env)\b.{0,40}(\|\s*curl|>\s*\/tmp|>\s*[^\s]+)/i,
      /process\.env\b.{0,80}(JSON\.stringify|forEach|Object\.entries)/i,
    ],
  },
];

const EXFILTRATION_RULES: SkillAuditRule[] = [
  {
    id: "exfil.post-secret-file",
    category: "exfiltration",
    severity: "block",
    message: "Skill uploads local secrets or credential files.",
    appliesTo: ["markdown", "code", "support"],
    patterns: [
      /\bcurl\b[^\n]*(--data|--data-binary|-d|-F)[^\n]*(\.env|keys\.env|id_rsa|id_ed25519|credentials)/i,
      /\b(wget|curl)\b[^\n]*(\.env|keys\.env|id_rsa|id_ed25519|credentials)[^\n]*(https?:\/\/)/i,
      /\b(nc|netcat)\b[^\n]*(\.env|id_rsa|keys\.env)/i,
    ],
  },
  {
    id: "exfil.archive-home-hidden",
    category: "exfiltration",
    severity: "block",
    message: "Skill appears to archive or upload sensitive hidden directories.",
    appliesTo: ["markdown", "code", "support"],
    patterns: [
      /\btar\b[^\n]*(~|\/Users\/|\/home\/)[^\n]*(\.ssh|\.aws|\.forge|\.config)/i,
      /\bzip\b[^\n]*(~|\/Users\/|\/home\/)[^\n]*(\.ssh|\.aws|\.forge|\.config)/i,
    ],
  },
];

const DESTRUCTIVE_COMMAND_RULES: SkillAuditRule[] = [
  {
    id: "destructive.broad-rm",
    category: "destructive_command",
    severity: "block",
    message: "Skill contains broad destructive removal command.",
    appliesTo: ["markdown", "code", "support"],
    patterns: [
      /\brm\s+-rf\s+(\/|~|\$HOME|\.\.|\*)/i,
      /\brm\s+-rf\s+\$[A-Z_]*(HOME|WORKSPACE|PROJECT|PWD)[A-Z_]*/i,
    ],
  },
  {
    id: "destructive.disk-or-permission",
    category: "destructive_command",
    severity: "block",
    message: "Skill contains disk format or broad permission mutation.",
    appliesTo: ["markdown", "code", "support"],
    patterns: [
      /\bmkfs(\.| |$)/i,
      /\bdd\s+if=\/dev\/zero/i,
      /\bchmod\s+-R\s+777\s+(\/|~|\$HOME|\.)/i,
      /\bchown\s+-R\b/i,
    ],
  },
];

const PRIVILEGE_AND_RCE_RULES: SkillAuditRule[] = [
  {
    id: "privilege.sudo-system-change",
    category: "privilege_escalation",
    severity: "block",
    message: "Skill asks for privileged system-level mutation.",
    appliesTo: ["markdown", "code", "support"],
    patterns: [
      /\bsudo\s+(rm|dd|mkfs|chmod|chown|visudo|launchctl|systemctl)\b/i,
      /\b(write|append).{0,40}(\/etc\/sudoers|\/etc\/hosts|\/Library\/LaunchAgents)/i,
    ],
  },
  {
    id: "rce.remote-shell-pipe",
    category: "remote_code_execution",
    severity: "warn",
    message: "Skill pipes remote content into a shell.",
    appliesTo: ["markdown", "code", "support"],
    patterns: [
      /\b(curl|wget)\b[^\n|]*\|\s*(bash|sh|zsh|python|node)\b/i,
    ],
  },
  {
    id: "rce.shell-profile-persistence",
    category: "remote_code_execution",
    severity: "block",
    message: "Skill modifies shell startup files or persistent hooks.",
    appliesTo: ["markdown", "code", "support"],
    patterns: [
      /(>>|>)\s*~\/\.(zshrc|bashrc|bash_profile|profile)/i,
      /\.git\/hooks\/(pre-commit|post-commit|pre-push|post-checkout)/i,
      /\b(crontab|launchctl)\b/i,
    ],
  },
];

const OPERATIONAL_WARNING_RULES: SkillAuditRule[] = [
  {
    id: "dependency.global-install",
    category: "dependency_install",
    severity: "warn",
    message: "Skill recommends a global dependency install.",
    appliesTo: ["markdown", "code", "support"],
    patterns: [
      /\bnpm\s+install\s+-g\b/i,
      /\bpipx?\s+install\b/i,
      /\bbrew\s+install\b/i,
    ],
  },
  {
    id: "git.push-or-release",
    category: "git_mutation",
    severity: "warn",
    message: "Skill mutates git or publishes release state.",
    appliesTo: ["markdown", "code", "support"],
    patterns: [
      /\bgit\s+push\b/i,
      /\bgit\s+tag\b/i,
      /\bgh\s+release\s+create\b/i,
      /\bnpm\s+publish\b/i,
    ],
  },
  {
    id: "network.post-upload",
    category: "network",
    severity: "warn",
    message: "Skill posts or uploads data over the network.",
    appliesTo: ["markdown", "code", "support"],
    patterns: [
      /\bcurl\b[^\n]*(--data|--data-binary|-d|-F)\b/i,
      /\bfetch\([^\n]+method:\s*["']POST["']/i,
    ],
  },
];

export const ALL_AUDIT_RULES: SkillAuditRule[] = [
  ...PROMPT_INJECTION_RULES,
  ...HIDDEN_BEHAVIOR_RULES,
  ...SECRET_ACCESS_RULES,
  ...EXFILTRATION_RULES,
  ...DESTRUCTIVE_COMMAND_RULES,
  ...PRIVILEGE_AND_RCE_RULES,
  ...OPERATIONAL_WARNING_RULES,
];

/**
 * Run a set of audit rules against provided text and collect any matching findings.
 *
 * @param rules - The audit rules to evaluate.
 * @param location - A location identifier to attach to each finding (e.g., file path or section).
 * @param text - The content to scan for rule pattern matches.
 * @param appliesTo - The content category to filter rules by (`"markdown" | "code" | "support"`).
 * @returns An array of findings for rules that matched the text; each finding includes the rule id, category, severity, message, the provided location, and a redacted snippet of the first match. Each rule contributes at most one finding.
 */
export function runAuditRules(
  rules: SkillAuditRule[],
  location: string,
  text: string,
  appliesTo: SkillAuditRule["appliesTo"][number],
): SkillAuditFinding[] {
  const findings: SkillAuditFinding[] = [];

  for (const rule of rules) {
    if (!rule.appliesTo.includes(appliesTo)) continue;
    for (const pattern of rule.patterns) {
      const match = text.match(pattern);
      if (!match) continue;
      findings.push({
        id: rule.id,
        category: rule.category,
        severity: rule.severity,
        message: rule.message,
        location,
        snippet: redactSnippet(match[0]),
      });
      break;
    }
  }

  return findings;
}
