# Skills

## Status

Skills support is **alpha** and disabled by default. You must explicitly opt in per build or through setup.

---

## What Forge Does When Skills Are Enabled

1. Builds a small set of search queries from the current task and project signals.
2. Runs the skills CLI (`npx skills`) with telemetry-disabling environment variables.
3. Scores search results for task relevance and trust policy.
4. Fetches selected skill prompt bundles (`npx skills use`) for audit.
5. Skips skills with risky, irrelevant, or low-quality instructions.
6. Installs approved skills into project-local Forge and agent paths.
7. Injects bounded skill guidance into agent prompts for the session.

All of this runs only for the session it was started for. Skills are not installed globally.

---

## Safety Model

Forge treats third-party skills as untrusted operational prompt text:

- Skills do **not** override system, developer, user, or project instructions.
- Forge audits skill content before installation and prompt injection.
- Skills that attempt to bypass prompt hierarchy, access secrets, or execute destructive commands are blocked.
- Only skills that pass the full audit are installed and injected.

Treat skills like code. Review their source, especially bundled scripts, before enabling auto mode in sensitive projects.

---

## Privacy

Enabling skills may cause Forge to run `npx skills find` queries derived from your task description and project signals.

- Forge sets `DISABLE_TELEMETRY=1`, `DO_NOT_TRACK=1`, and `NO_COLOR=1` for all automatic skills CLI calls.
- The upstream skills CLI and skills.sh registry behavior may change independently. Review the [skills.sh documentation](https://www.skills.sh/docs) before enabling skills for sensitive projects.
- Forge does not add new telemetry for this feature.
- If you run `npx skills` manually outside Forge, that command follows the upstream skills CLI telemetry behavior.

---

## Project Files

When skills are enabled and a skill is approved, Forge may write:

| Path | Contents |
|---|---|
| `.forge/skills/<owner>__<repo>__<skill>/SKILL.md` | Approved skill instructions |
| `.forge/skills/<owner>__<repo>__<skill>/forge-skill.json` | Installation manifest |
| `.agents/skills/<skill>/SKILL.md` | Shared agent path (if `agents` in install targets) |
| `.claude/skills/<skill>/SKILL.md` | Claude Code path (if `claude` in install targets) |
| `skills-lock.json` | Install lock file |

These files are project-local. They can be committed if your team wants deterministic skill behavior across environments. Review them before committing — they are third-party content.

To remove all installed skills: `rm -rf .forge/skills .agents/skills .claude/skills skills-lock.json`

---

## Config Reference

```toml
[skills]
mode = "auto"              # "auto" enables the pipeline; "off" disables it
max_skills = 3             # maximum skills to select per build
prompt_char_budget = 12000 # maximum characters of skill context per agent prompt
min_install_count = 100    # minimum install count to consider a skill (popularity filter)
trusted_sources = ["vercel-labs", "anthropics", "openai", "microsoft"]  # sources that get a trust bonus in scoring
install_targets = ["forge", "agents"]  # where to install approved skills
```

| Field | Default | Notes |
|---|---|---|
| `mode` | `"off"` | Must be `"auto"` to enable |
| `max_skills` | `3` | Higher values increase discovery time and prompt size |
| `prompt_char_budget` | `12000` | Per-agent cap; skills are trimmed to fit |
| `min_install_count` | `100` | Set to `0` to allow any skill; higher values reduce noise |
| `trusted_sources` | `["vercel-labs", "anthropics", "openai", "microsoft"]` | Source owners/repos that score higher in ranking |
| `install_targets` | `["forge", "agents"]` | `"claude"` adds `.claude/skills` for Claude Code agents |

---

## Build Flags

```bash
# Enable for one build (overrides global config, does not save to config.toml)
forgecli build "idea" --skills auto

# Disable for one build
forgecli build "idea" --skills off

# Cap skills selection for one build
forgecli build "idea" --skills auto --skills-max 1
```

`--skills-max` without `--skills auto` is accepted but has no effect if the effective mode is `off`.

---

## Rollout Status

| Stage | Status | Condition |
|---|---|---|
| Alpha (disabled by default) | Active | Requires explicit opt-in via `--skills auto` or setup |
| Opt-in beta | Not started | Requires dogfood evidence across 20+ real builds |
| Default-on | Not started | Requires safety review, performance evidence, and explicit maintainer approval |

Skills will not become default-on automatically. That is an explicit release decision.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `npx not found` | Node/npm is missing from PATH | Install Node.js/npm, or run with `--skills off` |
| Skills search is slow | First `npx skills` run is downloading the CLI package | Retry, or disable skills for time-sensitive runs |
| No skills selected | Query had no relevant results, install counts were low, or mode is off | Lower `min_install_count`, adjust `trusted_sources`, or run without `--skills` |
| Skill skipped after audit | Skill contained risky instructions or unsupported files | Inspect session logs; choose a safer skill or source |
| Skill installed but not injected | Prompt budget or relevance gate excluded it | Lower `max_skills` or increase `prompt_char_budget` |
| Resume did not search again | Session reused stored skill selections from creation time | Start a new build, or clear session state if re-discovery is needed |
| External agent cannot see skill files | Isolated task workspace did not receive the skill copy | Check `install_targets` includes `"agents"` or `"claude"` |
| `skills list --json` parse failed | Upstream CLI output changed | File an issue with captured Forge debug output |

### Disable or Roll Back

Per build:
```bash
forgecli build "idea" --skills off
```

In config:
```toml
[skills]
mode = "off"
```

Remove installed skill files:
```bash
rm -rf .forge/skills .agents/skills .claude/skills skills-lock.json
```
