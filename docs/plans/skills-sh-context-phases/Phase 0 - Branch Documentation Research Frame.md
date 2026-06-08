---
title: Phase 0 - Branch Documentation Research Frame
aliases:
  - Skills.sh Context Phase 0
  - Phase 0 Research Frame
tags:
  - forgecli/skills-sh-context
  - forgecli/planning/phase
  - status/complete
status: complete
phase: 0
research_gate: closed
parent: "[[Skills.sh Context System Master Plan]]"
next_action: "Use the reviewed Phase 0 planning rules for the remaining phase notes."
created: 2026-06-06
updated: 2026-06-07
---

# Phase 0 - Branch Documentation Research Frame

> [!warning] Planning Boundary
> Phase 0 is documentation and research infrastructure only. It must not add feature runtime code, CLI behavior, database schema, config fields, or skills.sh adapter code.
> [!abstract] Outcome
> At the end of Phase 0, the feature has a clean branch, a master plan, an Obsidian-readable planning vault structure, a phase tracker, and a documented research process that every later phase must follow before code edits.

## Research Summary

### Current Repo State

Research command:

```bash
git status --short --branch
```

Observed state:

```text
## feature/skills-sh-context
 M src/config.ts
 M src/db.ts
 M src/session.ts
 M tests/config.test.ts
 M tests/db.test.ts
 M tests/session.test.ts
?? .env
?? docs/plans/2026-06-06-skills-sh-context.md
?? "docs/plans/Skills.sh Context System Phases.base"
?? docs/plans/skills-sh-context-phases/
?? pyproject.toml
?? src/skills/
?? tests/fixtures/
?? tests/skillsAudit.test.ts
?? tests/skillsAuditRules.test.ts
?? tests/skillsBundle.test.ts
?? tests/skillsCli.test.ts
?? tests/skillsDiscovery.test.ts
?? tests/skillsPaths.test.ts
?? tests/skillsPlanner.test.ts
?? tests/skillsScoring.test.ts
?? tests/test_cli.py
```

Interpretation:

- The feature branch exists: `feature/skills-sh-context`.
- Phase 0 planning docs are currently untracked and should be committed only when the user requests a commit.
- Existing unrelated files and later-phase implementation work must remain untouched by Phase 0:
  - `.env`
  - `pyproject.toml`
  - `src/config.ts`
  - `src/db.ts`
  - `src/session.ts`
  - `src/skills/`
  - `tests/config.test.ts`
  - `tests/db.test.ts`
  - `tests/session.test.ts`
  - `tests/fixtures/`
  - `tests/skills*.test.ts`
  - `tests/test_cli.py`
- A Phase 0-only commit should stage documentation artifacts only, not source or test implementation files.

### Existing Forge Plan Style

Local references inspected:

- `docs/plans/2026-06-04-codex-subagent.md`
- `docs/plans/2026-06-03-python-to-typescript-migration.md`

Findings:

- Detailed implementation plans use checkbox tasks.
- Plans include exact files, commands, expected command outcomes, and code snippets.
- Plans are written so another agent can execute them without inventing missing decisions.
- Phase 0 should follow that style for documentation workflow, but it should not include feature implementation code.

### Obsidian Skill Research

Installed skills used:

- `obsidian-markdown`: `<VAULT_ROOT>/.codex/skills/obsidian-markdown/SKILL.md`
- `obsidian-bases`: `<VAULT_ROOT>/.codex/skills/obsidian-bases/SKILL.md`

Relevant conventions from `obsidian-markdown`:

- Use YAML frontmatter properties at the top of notes.
- Use wikilinks for vault-internal links, for example `[[Skills.sh Context System Master Plan]]`.
- Use callouts for important workflow boundaries.
- Use Mermaid diagrams for visual relationships.

Relevant conventions from `obsidian-bases`:

- `.base` files are YAML.
- Use global filters to select notes by folder and tag.
- Use table/card views to visualize note status.
- Validate that every displayed property exists on the target notes.

### Vault State

Vault target:

```text
<VAULT_ROOT>/forgecli
```

Phase 0 vault files:

```text
forgecli/
  Skills.sh Context System Master Plan.md
  Skills.sh Context System Phases.base
  skills-sh-context-phases/
    Phase 0 - Branch Documentation Research Frame.md
    Phase 1 - Skill Model Config Session Persistence.md
    Phase 2 - Vercel Skills CLI Adapter.md
    Phase 3 - Query Planning Ranking Selection.md
    Phase 4 - Skill Audit Trust Policy.md
    Phase 5 - Project Installation Workspace Layout.md
    Phase 6 - Prompt Injection Progressive Disclosure.md
    Phase 7 - Pipeline Timing Agent Behavior.md
    Phase 8 - CLI UX Setup User Controls.md
    Phase 9 - Test Matrix Documentation Rollout.md
```

## File Map

| File | Action | Responsibility |
|---|---|---|
| `docs/plans/2026-06-06-skills-sh-context.md` | Update | Master plan, feature decisions, phase map, research links, Obsidian frontmatter |
| `docs/plans/Skills.sh Context System Phases.base` | Create/update | Obsidian Bases tracker for phase notes |
| `docs/plans/skills-sh-context-phases/Phase 0 - Branch Documentation Research Frame.md` | Update | This detailed Phase 0 document |
| `docs/plans/skills-sh-context-phases/Phase 1 ... Phase 9.md` | Maintain canonical phase plans | One Obsidian-readable phase note per phase; expand the note itself into the implementation-ready plan after research |
| `~/home/vault/forgecli/Skills.sh Context System Master Plan.md` | Sync | Obsidian vault copy of master plan |
| `~/home/vault/forgecli/Skills.sh Context System Phases.base` | Sync | Obsidian vault phase tracker |
| `~/home/vault/forgecli/skills-sh-context-phases/*.md` | Sync | Obsidian vault phase notes |

## Non-Goals

- Do not implement the skills CLI adapter.
- Do not add TypeScript skill models.
- Do not add database tables or migrations.
- Do not add Forge CLI flags.
- Do not install project-level skills into generated workspaces.
- Do not change runtime prompt behavior.
- Do not clean, stage, commit, or delete unrelated user files unless explicitly requested.

## Desired End State

Phase 0 is complete when:

- The branch is `feature/skills-sh-context`.
- The repo contains the master plan and all phase tracker notes.
- The vault contains synchronized Obsidian copies.
- The phase tracker Base can discover all phase notes by folder and tag.
- Each phase note links back to the master plan.
- The master plan tells future implementers not to write code until the relevant phase note has been expanded into an implementation-ready plan.
- This Phase 0 document contains the exact research workflow, sync workflow, and acceptance checks for future planning work.

## Detailed Task Plan

## Subphases

- 0.1 Branch setup
- 0.2 Master documentation
- 0.3 Research discipline

### 0.1 Branch Setup

- [x] **0.1.1 Create feature branch**

Command:

```bash
git switch -c feature/skills-sh-context
```

Expected result:

```text
Switched to a new branch 'feature/skills-sh-context'
```

Current verification command:

```bash
git status --short --branch
```

Expected current branch line:

```text
## feature/skills-sh-context
```

- [x] **0.1.2 Preserve unrelated working tree changes**

Known unrelated untracked files:

```text
.env
pyproject.toml
tests/test_cli.py
```

Rules:

- Do not stage these files for a Phase 0-only commit.
- Do not edit these files.
- Do not delete these files.
- Do not run destructive cleanup commands.

Safe status command:

```bash
git status --short --branch
```

Unsafe commands for this phase:

```bash
git reset --hard
git checkout -- .
git clean -fd
rm -rf .env pyproject.toml tests/test_cli.py
```

### 0.2 Master Documentation

- [x] **0.2.1 Capture feature decisions**

Master plan target:

```text
docs/plans/2026-06-06-skills-sh-context.md
```

Required decisions in the master plan:

- Discovery source: CLI-only first, using `npx skills`.
- Usage mode: mixed project install plus prompt injection.
- Selection policy: automatic with audit.
- Install scope: project only.
- Install method: copied skill files preferred.
- Prompt authority: skill text is guidance only.
- Runtime shape: progressive disclosure where possible.

Required frontmatter shape:

```yaml
---
title: Skills.sh Context System Master Plan
aliases:
  - Skills.sh Context System
  - Forge Skills.sh Context
tags:
  - forgecli/skills-sh-context
  - forgecli/planning
  - status/research
status: research
branch: feature/skills-sh-context
project: Forge CLI
feature: skills-sh-context
plan_level: master
phase: all
research_gate: open
created: 2026-06-06
updated: 2026-06-07
---
```

Required warning callout:

```markdown
> [!warning] Research Gate
> This note is the master map only. Do not implement from it directly. Each phase note must be expanded with targeted research and implementation-ready detail before code edits.
```

- [x] **0.2.2 Capture research sources**

Master plan must include durable links for later research:

```markdown
- https://github.com/vercel-labs/skills
- https://www.skills.sh/docs/cli
- https://www.skills.sh/docs/api
- https://dev.opencode.ai/docs/skills
- https://hermes-agent.nousresearch.com/docs/developer-guide/creating-skills
- https://github.com/NousResearch/hermes-agent/blob/main/website/docs/guides/work-with-skills.md
```

Phase 0 must also record local skill sources:

```markdown
- `/Users/dhanushchilakala/.codex/skills/obsidian-markdown/SKILL.md`
- `/Users/dhanushchilakala/.codex/skills/obsidian-bases/SKILL.md`
```

- [x] **0.2.3 Establish phase-note naming and supporting-plan rules**

Phase note folder:

```text
docs/plans/skills-sh-context-phases/
```

Phase note naming template:

```text
Phase N - Short Human Title.md
```

Optional supporting-plan naming template:

```text
docs/plans/skills-sh-context-phase-N-<short-area>.md
```

Rules:

- Phase notes are the canonical planning surface.
- Initial phase notes may start as lightweight trackers, but after research they should be expanded in place into detailed implementation plans.
- Optional supporting docs are allowed only when a phase note becomes too large or when a decision spans multiple phases.
- The phase note must be implementation-ready before code edits begin for its phase.
- A subsubplan should resolve one decision cluster, not an entire subsystem.

### 0.3 Research Discipline

- [x] **0.3.1 Define research questions before each phase note is implemented**

Each later implementation-ready phase note must begin with this section:

```markdown
## Research Questions

- What behavior must be proven before implementation?
- Which repo files define the current integration point?
- Which external commands or docs must be verified?
- What are the failure modes?
- What decisions are still open?
```

Each question must be answerable by one of:

- local repo inspection
- local command output
- upstream documentation
- controlled experiment in `/tmp`

- [x] **0.3.2 Record external behavior with citations or local command output**

For local behavior, use this evidence format:

````markdown
### Evidence: <short name>

Command:

```bash
<command>
```

Observed:

```text
<relevant output>
```

Interpretation:

- <what this proves>
- <what it does not prove>
````

For web/documentation behavior, use this evidence format:

```markdown
### Evidence: <short name>

Source:

- <url>

Finding:

- <short paraphrased finding>

Plan impact:

- <how the finding changes implementation>
```

- [x] **0.3.3 Require an implementation-ready phase note before code edits**

Every implementation-ready phase note must include:

- scope boundary and outcome callouts
- research questions
- researched facts
- state ownership or design decision table where ownership is unclear
- file map
- public interfaces/types
- exact implementation tasks
- code snippets where they remove ambiguity
- focused tests and validation commands
- failure modes and expected handling
- acceptance criteria
- rollback or recovery notes
- explicit non-goals
- research gate checklist

Template:

````markdown
---
title: Phase N - <Area>
aliases:
  - Skills.sh Context Phase N
tags:
  - forgecli/skills-sh-context
  - forgecli/planning/phase
status: planned
phase: N
research_gate: closed
parent: "[[Skills.sh Context System Master Plan]]"
next_action: "<single next action>"
---

# Phase N - <Area>

> [!warning] Scope Boundary
> <clear boundary>

> [!abstract] Outcome
> <expected end state>

## Research Questions

## Researched Facts

## State Ownership Decision

| State | Owner | Reason |
|---|---|---|

## Design Decisions

| Decision | Rationale |
|---|---|

## File Map

| File | Action | Responsibility |
|---|---|---|

## Public Interfaces

```typescript
// Include only planned public shapes or signatures that are needed
// to make the implementation decision-complete.
```

## Implementation Tasks

- [ ] **N.1 Write failing tests**
- [ ] **N.2 Implement**
- [ ] **N.3 Run targeted tests**
- [ ] **N.4 Update docs**

## Failure Modes And Handling

| Failure | Expected Handling |
|---|---|

## Validation Commands

```bash
npm test -- <targeted-test>
npm run build
```

## Acceptance Criteria

- [ ] <observable completion criterion>

## Rollback Notes

- <exact files or commands to reverse this phase if needed>

## Research Gate

- [ ] <research decision that must be closed before implementation>

## Non-Goals
````

## Obsidian Structure Plan

### Master Plan Note

Vault path:

```text
~/home/vault/forgecli/Skills.sh Context System Master Plan.md
```

Repo source:

```text
docs/plans/2026-06-06-skills-sh-context.md
```

The repo copy is the source of truth. The vault copy is a synchronized reading/planning surface.

### Phase Tracker Base

Vault path:

```text
~/home/vault/forgecli/Skills.sh Context System Phases.base
```

Repo source:

```text
docs/plans/Skills.sh Context System Phases.base
```

Required YAML:

```yaml
filters:
  and:
    - file.inFolder("forgecli/skills-sh-context-phases")
    - file.hasTag("forgecli/skills-sh-context")

properties:
  phase:
    displayName: Phase
  status:
    displayName: Status
  research_gate:
    displayName: Research Gate
  next_action:
    displayName: Next Action
  parent:
    displayName: Parent

views:
  - type: table
    name: Phase Tracker
    order:
      - file.name
      - phase
      - status
      - research_gate
      - next_action
      - parent
  - type: cards
    name: Research Board
    order:
      - file.name
      - status
      - research_gate
      - next_action
```

Base note:

- `file.inFolder("forgecli/skills-sh-context-phases")` is vault-relative. This Base is meant to run inside Obsidian, not from the repo checkout.

### Phase Note Template

All phase notes start with this lightweight shape. After targeted research begins, expand the same phase note in place using the implementation-ready template from `0.3.3`; do not create a separate detailed subplan by default.

```markdown
---
title: Phase N - <Title>
aliases:
  - Skills.sh Context Phase N
tags:
  - forgecli/skills-sh-context
  - forgecli/planning/phase
status: planned
phase: N
research_gate: open
parent: "[[Skills.sh Context System Master Plan]]"
next_action: "<single next action>"
created: <YYYY-MM-DD>
updated: <YYYY-MM-DD>
---

# Phase N - <Title>

> [!warning] Planning Boundary
> This phase has not yet passed its research gate.

## Subphases

## Subsubphases

## Research Gate
```

## Sync Workflow

The repo copy is the source of truth after vault annotations have been reconciled. The vault copy is a live review and visualization surface, so do not bulk-overwrite phase notes without first checking whether the vault copy has reviewer edits.

Safe sync policy:

- Before overwriting a vault note, compare the repo and vault copies.
- If the vault copy has review comments or newer edits, fold those changes into the repo note first.
- After the repo note has the reconciled content, copy that one note back to the vault.
- Avoid blanket `cp docs/plans/skills-sh-context-phases/*.md ...` after reviews begin. It can silently destroy vault-side annotations.
- Bulk sync is only acceptable for brand-new files or after every changed vault note has been diffed and reconciled.

Single-note compare command:

```bash
diff -u \
  'docs/plans/skills-sh-context-phases/Phase N - Title.md' \
  '/Users/dhanushchilakala/home/vault/forgecli/skills-sh-context-phases/Phase N - Title.md'
```

Single-note sync command after reconciliation:

```bash
mkdir -p /Users/dhanushchilakala/home/vault/forgecli/skills-sh-context-phases
cp 'docs/plans/skills-sh-context-phases/Phase N - Title.md' \
  '/Users/dhanushchilakala/home/vault/forgecli/skills-sh-context-phases/Phase N - Title.md'
```

## Commit Boundary

Phase 0 is commit-ready when the documentation artifacts are reviewed and the commit excludes unrelated source, test, environment, and generated files.

Canonical Phase 0 planning artifacts:

```text
docs/plans/2026-06-06-skills-sh-context.md
docs/plans/Skills.sh Context System Phases.base
docs/plans/skills-sh-context-phases/Phase 0 - Branch Documentation Research Frame.md
docs/plans/skills-sh-context-phases/Phase 1 - Skill Model Config Session Persistence.md
docs/plans/skills-sh-context-phases/Phase 2 - Vercel Skills CLI Adapter.md
docs/plans/skills-sh-context-phases/Phase 3 - Query Planning Ranking Selection.md
docs/plans/skills-sh-context-phases/Phase 4 - Skill Audit Trust Policy.md
docs/plans/skills-sh-context-phases/Phase 5 - Project Installation Workspace Layout.md
docs/plans/skills-sh-context-phases/Phase 6 - Prompt Injection Progressive Disclosure.md
docs/plans/skills-sh-context-phases/Phase 7 - Pipeline Timing Agent Behavior.md
docs/plans/skills-sh-context-phases/Phase 8 - CLI UX Setup User Controls.md
docs/plans/skills-sh-context-phases/Phase 9 - Test Matrix Documentation Rollout.md
```

Safe staging command for a docs-only Phase 0 commit:

```bash
git add \
  docs/plans/2026-06-06-skills-sh-context.md \
  'docs/plans/Skills.sh Context System Phases.base' \
  docs/plans/skills-sh-context-phases/
```

Files that must not be included in a Phase 0-only commit unless the user separately expands the commit scope:

```text
.env
pyproject.toml
src/
tests/
```

Verification command:

```bash
find /Users/dhanushchilakala/home/vault/forgecli -maxdepth 2 -type f -print | sort
```

Expected files:

```text
/Users/dhanushchilakala/home/vault/forgecli/Skills.sh Context System Master Plan.md
/Users/dhanushchilakala/home/vault/forgecli/Skills.sh Context System Phases.base
/Users/dhanushchilakala/home/vault/forgecli/skills-sh-context-phases/Phase 0 - Branch Documentation Research Frame.md
/Users/dhanushchilakala/home/vault/forgecli/skills-sh-context-phases/Phase 1 - Skill Model Config Session Persistence.md
/Users/dhanushchilakala/home/vault/forgecli/skills-sh-context-phases/Phase 2 - Vercel Skills CLI Adapter.md
/Users/dhanushchilakala/home/vault/forgecli/skills-sh-context-phases/Phase 3 - Query Planning Ranking Selection.md
/Users/dhanushchilakala/home/vault/forgecli/skills-sh-context-phases/Phase 4 - Skill Audit Trust Policy.md
/Users/dhanushchilakala/home/vault/forgecli/skills-sh-context-phases/Phase 5 - Project Installation Workspace Layout.md
/Users/dhanushchilakala/home/vault/forgecli/skills-sh-context-phases/Phase 6 - Prompt Injection Progressive Disclosure.md
/Users/dhanushchilakala/home/vault/forgecli/skills-sh-context-phases/Phase 7 - Pipeline Timing Agent Behavior.md
/Users/dhanushchilakala/home/vault/forgecli/skills-sh-context-phases/Phase 8 - CLI UX Setup User Controls.md
/Users/dhanushchilakala/home/vault/forgecli/skills-sh-context-phases/Phase 9 - Test Matrix Documentation Rollout.md
```

## Validation Plan

### Markdown Validation

Manual checks:

- Frontmatter starts and ends with `---`.
- Tags are valid nested tags.
- Internal links use wikilinks.
- External links use Markdown URL links.
- Callouts use valid Obsidian syntax.
- Code fences have language labels where useful.

Optional shell check:

```bash
sed -n '1,40p' docs/plans/skills-sh-context-phases/Phase\ 0\ -\ Branch\ Documentation\ Research\ Frame.md
```

### Base YAML Validation

Use Node if a YAML parser is available through project dependencies or a future dev dependency. For now, validate structurally by opening in Obsidian and by inspecting the file:

```bash
sed -n '1,140p' docs/plans/Skills.sh\ Context\ System\ Phases.base
```

Expected:

- `filters` exists.
- `properties` exists.
- `views` has a table view and card view.
- Displayed properties exist on phase notes.

### Link Validation

Expected internal links:

```markdown
[[Skills.sh Context System Master Plan]]
[[Skills.sh Context System Phases|the phase tracker]]
```

Expected behavior:

- Master plan opens from phase notes.
- Phase tracker Base lists Phase 0 through Phase 9.

### Git Hygiene Validation

Command:

```bash
git status --short --branch
```

Expected Phase 0-relevant entries:

```text
## feature/skills-sh-context
?? docs/plans/2026-06-06-skills-sh-context.md
?? "docs/plans/Skills.sh Context System Phases.base"
?? docs/plans/skills-sh-context-phases/
```

Other unrelated files may appear, including modified `src/` and `tests/` files from later-phase implementation work. They should not be staged as part of Phase 0 unless the user later expands the commit scope.

## Phase 0 Completion Review

Completion pass date: 2026-06-07.

Checks performed:

- Re-read the Phase 0 note, master plan, and Obsidian Base tracker.
- Re-read `obsidian-markdown` and `obsidian-bases` skill instructions relevant to frontmatter, wikilinks, callouts, and `.base` YAML.
- Verified the branch line is `## feature/skills-sh-context`.
- Verified the repo has Phase 0 through Phase 9 phase notes in `docs/plans/skills-sh-context-phases/`.
- Verified the Base tracker references properties that exist on phase notes: `phase`, `status`, `research_gate`, `next_action`, and `parent`.
- Normalized the repo `.base` file to the same YAML style currently written by the Obsidian vault copy.
- Confirmed Phase 0 does not require source code, test code, runtime config, database schema, CLI behavior, or generated workspace changes.
- Did not run network commands during this completion pass.

Out-of-scope observation:

- `docs/plans/skills-sh-context-phases/Phase 4 - Skill Audit Trust Policy.md` currently has `tags: status/ready` but `status: complete`. That is a later-phase metadata cleanup item unless the main agent decides to include a tracker-wide metadata consistency pass.

## Acceptance Criteria

- [x] Branch is `feature/skills-sh-context`.
- [x] Master plan exists in repo.
- [x] Master plan exists in vault.
- [x] Phase 0 document exists in repo.
- [x] Phase 0 document exists in vault.
- [x] Phase 1 through Phase 9 tracker notes exist in repo and vault.
- [x] Phase tracker `.base` exists in repo and vault.
- [x] Phase tracker filters by `forgecli/skills-sh-context`.
- [x] Every phase note has `parent: "[[Skills.sh Context System Master Plan]]"`.
- [x] Every phase note has `status`, `phase`, `research_gate`, and `next_action`.
- [x] This document records research findings and the safe vault sync workflow.
- [x] Phase 0 requires no feature runtime code changes, and source/test implementation files are excluded from the Phase 0 commit boundary.
- [x] No unrelated user files have been edited or deleted.

## Structural Verification

- [x] Confirm all planning notes link back to [[Skills.sh Context System Master Plan]].
- [x] Confirm the Obsidian Base shows Phase 0 through Phase 9.
- [x] Keep the vault copy and repo copy aligned after annotations are reconciled.
- [x] Confirm every phase note has `status`, `phase`, `research_gate`, and `next_action`.

## Research Gate

- [x] Decide that phase notes are the canonical implementation plans after research, not separate tracker-only files.
- [x] Define when optional supporting docs are allowed.
- [x] Define the evidence format for local commands and external documentation.
- [x] Define the required implementation-ready phase note template.
- [x] Define the safe vault sync workflow that preserves reviewer annotations.
- [x] Confirm Obsidian Base folder filters are vault-relative and belong to the vault view.
