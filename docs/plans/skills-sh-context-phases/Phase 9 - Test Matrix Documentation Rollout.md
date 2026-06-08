---
title: Phase 9 - Test Matrix Documentation Rollout
aliases:
  - Skills.sh Context Phase 9
  - Phase 9 Skill Rollout
tags:
  - forgecli/skills-sh-context
  - forgecli/planning/phase
  - status/ready
status: ready
phase: 9
research_gate: closed
parent: "[[Skills.sh Context System Master Plan]]"
next_action: "Run the full skills feature validation matrix, update public docs, and gate rollout after Phase 1 through Phase 8 land."
created: 2026-06-06
updated: 2026-06-07
---

# Phase 9 - Test Matrix Documentation Rollout

> [!warning] Planning Boundary
> Phase 9 validates and documents the skills feature after the behavior from [[Phase 1 - Skill Model Config Session Persistence]], [[Phase 2 - Vercel Skills CLI Adapter]], [[Phase 3 - Query Planning Ranking Selection]], [[Phase 4 - Skill Audit Trust Policy]], [[Phase 5 - Project Installation Workspace Layout]], [[Phase 6 - Prompt Injection Progressive Disclosure]], [[Phase 7 - Pipeline Timing Agent Behavior]], and [[Phase 8 - CLI UX Setup User Controls]] exists. It should not redesign discovery, ranking, audit policy, install layout, prompt rendering, pipeline timing, or user controls.

> [!abstract] Outcome
> At the end of Phase 9, Forge has a repeatable validation matrix for the full skills-backed context system, deterministic fake `skills` CLI integration tests, README coverage for setup and usage, safety and privacy notes, troubleshooting guidance, and explicit alpha, beta, and default-on rollout gates.

> [!danger] Release Safety
> Skills remain disabled by default for alpha. Default-on behavior is not allowed until the default-on criteria in this note are satisfied and reviewed against real dogfood evidence.

## Research Questions

- Which tests already exist from Phase 1 and Phase 2 work?
- Which tests are promised by Phase 3 through Phase 8 subplans?
- Which validation commands should every contributor run before enabling skills in a release?
- How should integration tests simulate `npx --yes skills` without hitting the network?
- How should the fake `skills` CLI model success, empty results, audit failures, timeouts, and malformed output?
- Which workflows need end-to-end tests across config, session persistence, discovery, audit, install, prompt rendering, resume, and external agents?
- Which README sections need updates so users can opt in without reading every phase note?
- What safety and privacy details must be documented before alpha?
- What troubleshooting entries will prevent common setup failures from becoming support churn?
- What objective gates separate disabled-by-default alpha, opt-in beta, and default-on readiness?

## Researched Facts

### Evidence: Current Branch And Dirty State

Command:

```bash
git status --short
```

Observed relevant state:

```text
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
?? tests/skillsCli.test.ts
?? tests/test_cli.py
```

Plan impact:

- Work is already on the feature branch and has phase implementation artifacts in progress.
- Phase 9 must not assume the dirty source/test changes are safe to edit during documentation planning.
- This note treats source files and tests as target surfaces for later implementation, not as files to change in this phase-documenting turn.

### Evidence: Master Phase Boundary

Master plan Phase 9 subphases:

| Subphase | Scope |
| --- | --- |
| 9.1 Unit tests | Adapter, scoring, audit, and prompt rendering coverage |
| 9.2 Integration tests | Fake CLI, pipeline, resume, and external-agent behavior |
| 9.3 Docs | README, safety/privacy notes, and troubleshooting |
| 9.4 Rollout | Disabled-by-default alpha, opt-in beta, and default-on criteria |

Plan impact:

- Phase 9 is the quality and rollout phase.
- Phase 9 must close the loop on every earlier phase's acceptance criteria.
- Phase 9 should produce enough evidence that the feature can be released without hidden network, prompt, or trust behavior.

### Evidence: Current Package Scripts

Current `package.json` scripts:

```json
{
  "scripts": {
    "build": "tsc",
    "test": "node --experimental-sqlite node_modules/.bin/jest"
  }
}
```

Plan impact:

- The full validation baseline is `npm run build` plus `npm test`.
- Test commands that call Jest directly must keep Node's SQLite flag.
- Focused test commands should use the same runtime path:

```bash
node --experimental-sqlite node_modules/.bin/jest tests/skillsCli.test.ts --no-coverage
```

### Evidence: Current Jest And TypeScript Setup

Current `jest.config.cjs`:

```javascript
module.exports = {
  testEnvironment: "node",
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          module: "CommonJS",
        },
      },
    ],
  },
  testMatch: ["**/tests/**/*.test.ts"],
  forceExit: true,
};
```

Current `tsconfig.json` uses strict TypeScript and NodeNext module resolution:

```json
{
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*"]
}
```

Plan impact:

- Production code should compile with NodeNext semantics.
- Tests currently transpile through `ts-jest` as CommonJS with mapper support for `.js` import specifiers.
- Phase 9 should not require a test framework migration.
- If ESM test issues appear, fix the local Jest config deliberately instead of working around the feature code.

### Evidence: Existing Phase 1 Tests

Current Phase 1-style test coverage exists in:

| File | Covered behavior |
| --- | --- |
| `tests/config.test.ts` | Skill config defaults, TOML round-trip, missing `[skills]` defaults |
| `tests/db.test.ts` | Skill candidate and install persistence |
| `tests/session.test.ts` | Session config snapshot includes skills |

Plan impact:

- Phase 9 should keep these as Tier 1 unit tests.
- Resume and rollout tests should build on the same session snapshot behavior instead of inventing a second persistence path.

### Evidence: Existing Phase 2 Adapter Tests

Current Phase 2-style test coverage exists in `tests/skillsCli.test.ts`.

Covered behavior includes:

| Area | Current example |
| --- | --- |
| Parser fixtures | `find-react.txt`, `find-empty.txt`, `add-list-obsidian.txt`, `use-obsidian-markdown.txt`, `list-json.json` |
| Command arguments | `npx --yes skills find ...` and `npx --yes skills add ...` |
| Environment | `DISABLE_TELEMETRY`, `DO_NOT_TRACK`, and `NO_COLOR` are set |
| Error handling | Non-zero output includes useful stdout/stderr detail |
| Timeout handling | Spawn timeout rejects with a `SkillsCliError` |

Plan impact:

- Phase 9 can reuse Phase 2 parser fixtures for regression tests.
- Integration tests still need a process-level fake CLI because mocked `spawn` does not exercise PATH, working directory, install layout, or full pipeline behavior.

### Evidence: Planned Phase 3 Through Phase 8 Tests

Earlier phase plans name these test surfaces:

| Phase | Planned tests |
| --- | --- |
| Phase 3 | `tests/skillsPlanner.test.ts`, `tests/skillsScoring.test.ts`, `tests/skillsDiscovery.test.ts` |
| Phase 4 | `tests/skillsBundle.test.ts`, `tests/skillsAuditRules.test.ts`, `tests/skillsAudit.test.ts`, `tests/fixtures/skills-audit/` |
| Phase 5 | `tests/skillsPaths.test.ts`, `tests/skillsInventory.test.ts`, `tests/skillsInstall.test.ts`, `tests/fixtures/skills-install/` |
| Phase 6 | `tests/skillsRender.test.ts`, `tests/skillsContext.test.ts`, `tests/skillsTools.test.ts`, `tests/agentsSkillContext.test.ts` |
| Phase 7 | `tests/skillsPipeline.test.ts`, `tests/skillsRelevance.test.ts`, `tests/overseerSkills.test.ts`, `tests/agentsSkillArgs.test.ts` |
| Phase 8 | `tests/skillsCliOptions.test.ts`, `tests/setupSkills.test.ts`, `tests/sessionSkillsConfig.test.ts`, `tests/cli.test.ts`, future `tests/skillsCommands.test.ts` |

Plan impact:

- Phase 9 should not create a second set of competing tests for the same module-level behavior.
- Phase 9 should add missing cross-phase coverage where module tests cannot prove the full workflow.

### Evidence: skills.sh And Agent Skills Behavior

Relevant external references:

| Source | Phase 9 use |
| --- | --- |
| [skills.sh docs](https://www.skills.sh/docs) | Confirms the CLI is installed through `npx skills add` and that skills.sh publishes telemetry statements users must understand. |
| [vercel-labs/skills README](https://github.com/vercel-labs/skills/blob/main/README.md) | Confirms `skills add`, `skills use`, `skills list`, `skills find`, `--agent`, `--skill`, `--copy`, `--yes`, and project/global install concepts. |
| [Vercel Agent Skills docs](https://vercel.com/docs/agent-resources/skills) | Confirms Vercel's framing of reusable agent skills and the official Vercel skill directory. |
| [OpenAI Codex Agent Skills docs](https://developers.openai.com/codex/skills) | Confirms progressive disclosure, `SKILL.md` structure, implicit/explicit activation, and skill search locations. |
| [Jest CLI docs](https://jestjs.io/docs/cli) | Confirms package manager argument passthrough, `--runInBand`, `--findRelatedTests`, and focused test paths. |
| [ts-jest ESM support docs](https://kulshekhar.github.io/ts-jest/docs/guides/esm-support) | Confirms NodeNext/ESM projects need deliberate Jest runtime and transform settings. |

Plan impact:

- README docs must mention skills.sh network and telemetry behavior before users opt in.
- Tests must exercise `npx --yes skills` command construction while avoiding live `npx` calls in CI.
- Prompt-rendering tests must verify progressive disclosure: selected skills are included as bounded guidance, not as unscoped authority.

## Phase Design Decisions

| Decision | Rationale |
| --- | --- |
| Keep Phase 9 documentation-first | The user explicitly wants research and plans before code. |
| Keep tests deterministic by default | CI and local contributor runs must not depend on skills.sh uptime, npm registry state, or live telemetry behavior. |
| Use a fake `npx` wrapper for integration tests | The adapter invokes `npx --yes skills`; faking only `skills` in PATH is not enough unless the adapter gains a command override. |
| Keep live skills.sh smoke tests opt-in | Live network tests are useful before release but should require an explicit environment variable. |
| Keep alpha disabled by default | Skills use third-party prompt text, write project dot-directories, and may involve networked discovery/install. |
| Gate rollout with evidence | Default-on should be a release decision backed by validation output, docs, safety review, and dogfood results. |

## Validation Tiers

| Tier | Name | Command class | Network | Purpose |
| --- | --- | --- | --- | --- |
| Tier 0 | Static and build | `npm run build` | No | Type-check production code and exported APIs |
| Tier 1 | Unit | `npm test` focused module tests | No | Prove parser, scoring, audit, render, config, and persistence behavior |
| Tier 2 | Integration | Jest with fake `npx`/`skills` CLI | No | Prove Forge coordinates multiple modules correctly |
| Tier 3 | Agent prompt integration | Jest with mocked external agents | No | Prove selected skills reach the right agent prompts and workspaces |
| Tier 4 | Manual live smoke | `FORGE_RUN_SKILLS_LIVE=1 ...` | Yes | Pre-release confidence against current upstream skills CLI behavior |

Default validation should stop at Tier 3. Tier 4 must never run in normal CI.

## Test Matrix

| ID | Phase | Layer | Required before alpha | Required before beta | Required before default-on |
| --- | --- | --- | --- | --- | --- |
| T0-BUILD | All | Build | Yes | Yes | Yes |
| T1-CONFIG | 1 | Unit | Yes | Yes | Yes |
| T1-DB | 1 | Unit | Yes | Yes | Yes |
| T1-SESSION | 1 | Unit | Yes | Yes | Yes |
| T1-CLI-PARSE | 2 | Unit | Yes | Yes | Yes |
| T1-CLI-SPAWN | 2 | Unit | Yes | Yes | Yes |
| T1-QUERY | 3 | Unit | Yes | Yes | Yes |
| T1-SCORING | 3 | Unit | Yes | Yes | Yes |
| T1-DISCOVERY | 3 | Unit | Yes | Yes | Yes |
| T1-BUNDLE | 4 | Unit | Yes | Yes | Yes |
| T1-AUDIT-RULES | 4 | Unit | Yes | Yes | Yes |
| T1-AUDIT-END | 4 | Unit | Yes | Yes | Yes |
| T1-PATHS | 5 | Unit | Yes | Yes | Yes |
| T1-INVENTORY | 5 | Unit | Yes | Yes | Yes |
| T1-INSTALL | 5 | Unit | Yes | Yes | Yes |
| T1-RENDER | 6 | Unit | Yes | Yes | Yes |
| T1-CONTEXT | 6 | Unit | Yes | Yes | Yes |
| T1-TOOLS | 6 | Unit | Yes | Yes | Yes |
| T1-PIPELINE | 7 | Unit | Yes | Yes | Yes |
| T1-RELEVANCE | 7 | Unit | Yes | Yes | Yes |
| T1-CLI-UX | 8 | Unit | Yes | Yes | Yes |
| T2-FAKE-CLI | 9 | Integration | Yes | Yes | Yes |
| T2-PIPELINE-SELECTED | 9 | Integration | Yes | Yes | Yes |
| T2-PIPELINE-NONE | 9 | Integration | Yes | Yes | Yes |
| T2-PIPELINE-AUDIT-FAIL | 9 | Integration | Yes | Yes | Yes |
| T2-RESUME | 9 | Integration | Yes | Yes | Yes |
| T3-EXTERNAL-AGENT | 9 | Integration | Yes | Yes | Yes |
| T3-PROMPT-BUDGET | 9 | Integration | Yes | Yes | Yes |
| T3-ROLLBACK-FLAG | 9 | Integration | Yes | Yes | Yes |
| T4-LIVE-SMOKE | 9 | Manual | No | Yes | Yes |
| T4-DOGFOOD | 9 | Manual | No | Yes | Yes |

## File Map

### Test Support Files

| File | Action | Purpose |
| --- | --- | --- |
| `tests/helpers/fakeSkillsCli.ts` | Create | Install a fake `npx` wrapper in a temporary `PATH` and record calls |
| `tests/helpers/skillTestWorkspace.ts` | Create | Build disposable project workspaces with config, SQLite DB, and fixture skills |
| `tests/helpers/skillAssertions.ts` | Create | Shared assertions for installed files, prompt snippets, DB rows, and live-feed events |
| `tests/fixtures/fake-skills-cli/` | Create | Deterministic fake CLI responses for find, use, add, list, malformed output, and timeout |
| `tests/fixtures/skills-e2e/` | Create | Multi-skill fixtures that span selection, audit, install, and prompt render |

### Phase 9 Test Files

| File | Action | Purpose |
| --- | --- | --- |
| `tests/skillsFakeCli.test.ts` | Create | Prove the fake CLI helper behaves like the adapter expects |
| `tests/skillsIntegration.test.ts` | Create | End-to-end skill pipeline tests with fake CLI and temporary workspace |
| `tests/skillsResumeIntegration.test.ts` | Create | Resume tests that verify stored selections and config snapshots |
| `tests/skillsExternalAgentIntegration.test.ts` | Create | External-agent workspace and prompt forwarding tests |
| `tests/skillsDocs.test.ts` | Optional | Markdown smoke tests for README anchors, commands, and safety copy |

### Documentation Files

| File | Action | Purpose |
| --- | --- | --- |
| `README.md` | Modify | Add user-facing feature section, config examples, and troubleshooting pointer |
| `docs/skills.md` | Create | Full skills feature guide for setup, commands, safety, privacy, and troubleshooting |
| `docs/plans/skills-sh-context-phases/Phase 9 - Test Matrix Documentation Rollout.md` | Maintain | This implementation-ready plan |

## Data Model For The Validation Matrix

Phase 9 can keep the human-facing matrix in Markdown, but the test suite benefits from a small typed representation for required release gates.

```typescript
export type SkillValidationTier = "build" | "unit" | "integration" | "manual";

export type SkillReleaseStage = "alpha" | "beta" | "default-on";

export interface SkillValidationCase {
  id: string;
  phase: number;
  tier: SkillValidationTier;
  command?: string;
  requiredFor: SkillReleaseStage[];
  evidencePath?: string;
  passCriteria: string;
}

export const SKILL_VALIDATION_CASES: SkillValidationCase[] = [
  {
    id: "T0-BUILD",
    phase: 9,
    tier: "build",
    command: "npm run build",
    requiredFor: ["alpha", "beta", "default-on"],
    passCriteria: "TypeScript compiles with no errors.",
  },
  {
    id: "T2-FAKE-CLI",
    phase: 9,
    tier: "integration",
    command: "node --experimental-sqlite node_modules/.bin/jest tests/skillsFakeCli.test.ts --no-coverage",
    requiredFor: ["alpha", "beta", "default-on"],
    passCriteria: "Fake npx wrapper records expected skills find/use/add/list invocations.",
  },
];
```

Do not block implementation on adding a machine-readable matrix if a Markdown checklist is enough for the first pass. The type above is useful if release checks become automated.

## Subphase 9.1 - Unit Tests

### Goal

Close unit-level coverage for every module created by Phase 1 through Phase 8.

### Non-Goals

- Do not run live `npx skills`.
- Do not install skills into real user or global agent directories.
- Do not test external coding agents by launching real `claude`, `codex`, `cursor`, or `opencode` binaries.
- Do not snapshot huge prompt output without stable redaction and normalization.

### Unit Test Command Set

Run the full unit suite:

```bash
node --experimental-sqlite node_modules/.bin/jest --no-coverage
```

Run only skills-related tests:

```bash
node --experimental-sqlite node_modules/.bin/jest tests/skillsCli.test.ts tests/skillsPlanner.test.ts tests/skillsScoring.test.ts tests/skillsDiscovery.test.ts tests/skillsBundle.test.ts tests/skillsAuditRules.test.ts tests/skillsAudit.test.ts tests/skillsPaths.test.ts tests/skillsInventory.test.ts tests/skillsInstall.test.ts tests/skillsRender.test.ts tests/skillsContext.test.ts tests/skillsTools.test.ts tests/skillsPipeline.test.ts tests/skillsRelevance.test.ts tests/skillsCliOptions.test.ts tests/setupSkills.test.ts tests/sessionSkillsConfig.test.ts --no-coverage
```

Use serial execution while debugging shared process state:

```bash
npm test -- --runInBand --no-coverage
```

Jest supports package manager argument passthrough with `npm test -- ...`, so this command shape should work with the existing `test` script.

### 9.1.1 Adapter Tests

Files:

- `src/skills/cli.ts`
- `tests/skillsCli.test.ts`
- `tests/fixtures/skills-cli/`

Required cases:

| Case | Expected behavior |
| --- | --- |
| `find` parses search results | Candidate fields include `packageRef`, `skillName`, source owner/repo, URL, and install count |
| `find` handles empty result | Returns an empty candidate array with no thrown error |
| `use` parses prompt output | Extracts generated prompt text and support directory path |
| `add --list` parses skills | Returns available skill names and descriptions |
| `list --json` parses installed inventory | Rejects non-array JSON and normalizes valid arrays |
| Command env disables telemetry | Sets `DISABLE_TELEMETRY=1`, `DO_NOT_TRACK=1`, and `NO_COLOR=1` |
| Missing `npx` is actionable | Error tells the user to install Node/npm or configure an override |
| Timeout is bounded | Rejects with timeout detail and cleans up the child process |
| Non-zero exit keeps useful detail | Includes stdout/stderr without flooding output |

Example test shape:

```typescript
test("find runs npx skills find with telemetry disabled", async () => {
  const spawn = jest.fn().mockImplementation(fakeSpawn({ stdout: findFixture }));
  const cli = new SkillsCli({ spawn });

  await cli.find("react frontend");

  expect(spawn).toHaveBeenCalledWith(
    "npx",
    ["--yes", "skills", "find", "react frontend"],
    expect.objectContaining({
      env: expect.objectContaining({
        DISABLE_TELEMETRY: "1",
        DO_NOT_TRACK: "1",
        NO_COLOR: "1",
      }),
    }),
  );
});
```

Acceptance criteria:

- [ ] All adapter parser fixtures are deterministic text or JSON files.
- [ ] Tests do not require network access.
- [ ] Errors are typed as `SkillsCliError` or an equivalent feature-specific error.
- [ ] Command construction stays compatible with Phase 2's CLI-only integration decision.

### 9.1.2 Scoring Tests

Files:

- `src/skills/planner.ts`
- `src/skills/scoring.ts`
- `src/skills/discovery.ts`
- `tests/skillsPlanner.test.ts`
- `tests/skillsScoring.test.ts`
- `tests/skillsDiscovery.test.ts`

Required cases:

| Case | Expected behavior |
| --- | --- |
| Website request generates frontend queries | Query plan includes domain and stack words when the task asks for a website |
| Known stack boosts relevance | React/Vite/Next/etc. stack evidence boosts matching skills |
| Trusted source boost is bounded | Trusted owner/repo is useful but cannot override an irrelevant skill |
| Minimum installs filter applies | Low-install candidates are skipped unless explicitly allowed |
| Duplicate candidates merge | Same package/skill from multiple queries becomes one candidate with combined evidence |
| Max skills cap applies | Higher-ranked candidates are selected and the rest receive a skip reason |
| Disabled mode short-circuits | `skills.mode = "off"` produces no queries and no CLI calls |
| Discovery failure degrades gracefully | CLI errors produce skipped events without failing the build |

Example scoring fixture:

```typescript
const candidates: SkillCandidate[] = [
  candidate({
    packageRef: "vercel-labs/agent-skills",
    skillName: "frontend-design",
    description: "Build polished frontend applications",
    installCount: 5000,
  }),
  candidate({
    packageRef: "random/repo",
    skillName: "terraform-deploy",
    description: "Provision infrastructure with Terraform",
    installCount: 9000,
  }),
];

test("ranks frontend skill above unrelated high-install skill for website tasks", () => {
  const scored = scoreSkillCandidates({
    task: "Create a marketing website for a coffee shop",
    projectSignals: { frameworks: ["react"], languages: ["typescript"] },
    candidates,
    config: skillConfig({ trustedSources: ["vercel-labs"] }),
  });

  expect(scored[0].candidate.skillName).toBe("frontend-design");
  expect(scored[1].skipReason).toContain("relevance");
});
```

Acceptance criteria:

- [ ] Query generation is deterministic for the same task and project signals.
- [ ] Ranking explains every selected and skipped candidate.
- [ ] Tests cover both "obvious match" and "high-install but irrelevant" cases.
- [ ] No test depends on live skills.sh ranking.

### 9.1.3 Audit Tests

Files:

- `src/skills/bundle.ts`
- `src/skills/auditRules.ts`
- `src/skills/audit.ts`
- `src/skills/redact.ts`
- `tests/skillsBundle.test.ts`
- `tests/skillsAuditRules.test.ts`
- `tests/skillsAudit.test.ts`
- `tests/fixtures/skills-audit/`

Required cases:

| Case | Expected behavior |
| --- | --- |
| Safe skill passes | Basic `SKILL.md` with normal instructions produces `pass` |
| Prompt hierarchy bypass fails | Instructions to ignore system/developer/user messages produce `fail` |
| Secret access fails | Instructions to read keys, env files, tokens, or credential stores produce `fail` |
| Destructive command fails | Dangerous shell guidance produces `fail` unless explicitly reviewed in a later manual path |
| Network upload warns or fails | Upload/deploy instructions are source-aware and explain the verdict |
| Support files are inspected | Risky scripts or references cannot hide behind a benign `SKILL.md` |
| Redaction protects persisted output | Secrets and long raw snippets are not stored in DB or test snapshots |
| All selected fail audit | Pipeline later continues without skills instead of blocking unrelated work |

Example audit assertion:

```typescript
test("fails prompt hierarchy bypass instructions", async () => {
  const bundle = await loadSkillBundle(
    fixturePath("skills-audit/fail-prompt-injection"),
  );

  const result = auditSkillBundle({
    candidate: candidate("untrusted/repo", "bad-skill", 120),
    bundle,
    config: skillConfig(),
  });

  expect(result.verdict).toBe("fail");
  expect(result.findings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        category: "prompt-injection",
        severity: "high",
      }),
    ]),
  );
});
```

Acceptance criteria:

- [ ] Audit tests include pass, warn, and fail outcomes.
- [ ] Audit snapshots are redacted and bounded.
- [ ] Tests cover `SKILL.md` and support-file risks.
- [ ] Trusted sources can reduce noise only within explicit rule boundaries.

### 9.1.4 Prompt Rendering Tests

Files:

- `src/skills/render.ts`
- `src/skills/context.ts`
- `src/skills/tools.ts`
- `src/agents.ts`
- `tests/skillsRender.test.ts`
- `tests/skillsContext.test.ts`
- `tests/skillsTools.test.ts`
- `tests/agentsSkillContext.test.ts`

Required cases:

| Case | Expected behavior |
| --- | --- |
| Selected pass skills render | Prompt section includes selected skill name, source, and bounded guidance |
| Failed skills do not render | Audit failures are excluded even if selected by ranking |
| Prompt budget is enforced | Renderer trims lower-priority content and records truncation |
| Boundaries are explicit | Skill text is framed as task-specific guidance, not authority over higher-priority instructions |
| Tools are referenced safely | Optional scripts/references are described without auto-executing them |
| Base agent receives relevant context | Forge's internal agent prompt gets the selected skill context |
| External agents receive isolated context | Prompt text references the workspace copy, not a root-only path |

Example render assertion:

```typescript
test("renders selected skill guidance inside the prompt budget", () => {
  const rendered = renderSkillContext({
    selections: [selectedSkill("frontend-design", "Use accessible responsive layout patterns.")],
    promptCharBudget: 200,
  });

  expect(rendered.text).toContain("frontend-design");
  expect(rendered.text).toContain("Use accessible responsive layout patterns.");
  expect(rendered.text.length).toBeLessThanOrEqual(200);
  expect(rendered.includedSkillIds).toEqual(["frontend-design"]);
});
```

Acceptance criteria:

- [ ] Renderer tests include budget, ordering, exclusion, and boundary behavior.
- [ ] Prompt tests use normalized whitespace to avoid brittle snapshots.
- [ ] Prompt text never says that third-party skills override Forge, system, developer, or user instructions.

## Subphase 9.2 - Integration Tests

### Goal

Prove the whole skills lifecycle works across the actual Forge modules with no live skills.sh dependency.

### Integration Boundaries

| Boundary | Test strategy |
| --- | --- |
| `npx --yes skills` | Fake `npx` wrapper in temporary `PATH` |
| Workspace writes | Temporary project directory under `os.tmpdir()` |
| SQLite | Temporary DB path or in-memory DB matching existing test helpers |
| Config | Temporary HOME or config path override |
| External agents | Mock command runners; do not launch real agent CLIs |
| Live feed | Capture events through a test sink |

### 9.2.1 Fake Skills CLI In PATH

The adapter currently invokes `npx --yes skills ...`. The fake CLI should therefore provide a fake `npx` executable that recognizes `--yes skills` and delegates to deterministic handlers.

Helper API:

```typescript
export interface FakeSkillsInvocation {
  cwd: string;
  args: string[];
  env: Record<string, string | undefined>;
}

export interface FakeSkillsScenario {
  find?: Record<string, string>;
  use?: Record<string, string>;
  add?: Record<string, string>;
  listJson?: unknown[];
  failures?: Record<string, { code: number; stderr: string }>;
  delayMs?: number;
}

export async function withFakeSkillsCli<T>(
  scenario: FakeSkillsScenario,
  run: (ctx: { env: NodeJS.ProcessEnv; callsPath: string }) => Promise<T>,
): Promise<T> {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "forge-fake-skills-"));
  const bin = path.join(root, "bin");
  const callsPath = path.join(root, "calls.jsonl");
  await fs.promises.mkdir(bin, { recursive: true });

  await writeExecutableFakeNpx({
    file: path.join(bin, "npx"),
    scenario,
    callsPath,
  });

  const env = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
    FORGE_FAKE_SKILLS_SCENARIO: Buffer.from(JSON.stringify(scenario)).toString("base64"),
    FORGE_FAKE_SKILLS_CALLS: callsPath,
  };

  return run({ env, callsPath });
}
```

Fake `npx` command behavior:

```javascript
#!/usr/bin/env node
const fs = require("fs");

const args = process.argv.slice(2);
const callsPath = process.env.FORGE_FAKE_SKILLS_CALLS;
const scenario = JSON.parse(
  Buffer.from(process.env.FORGE_FAKE_SKILLS_SCENARIO || "e30=", "base64").toString("utf8"),
);

fs.appendFileSync(
  callsPath,
  JSON.stringify({ cwd: process.cwd(), args, env: {
    DISABLE_TELEMETRY: process.env.DISABLE_TELEMETRY,
    DO_NOT_TRACK: process.env.DO_NOT_TRACK,
    NO_COLOR: process.env.NO_COLOR,
  } }) + "\n",
);

if (args[0] !== "--yes" || args[1] !== "skills") {
  console.error("expected npx --yes skills");
  process.exit(64);
}

const command = args[2];
const rest = args.slice(3);
const key = [command, ...rest].join(" ");
const failure = scenario.failures && scenario.failures[key];

if (failure) {
  console.error(failure.stderr);
  process.exit(failure.code);
}

if (command === "find") {
  process.stdout.write((scenario.find && scenario.find[rest.join(" ")]) || "No skills found\n");
  process.exit(0);
}

if (command === "use") {
  const source = rest[0];
  const skillIndex = rest.indexOf("--skill");
  const skill = skillIndex >= 0 ? rest[skillIndex + 1] : "";
  process.stdout.write((scenario.use && scenario.use[`${source}@${skill}`]) || "");
  process.exit(0);
}

if (command === "add" && rest.includes("--list")) {
  process.stdout.write((scenario.add && scenario.add[rest[0]]) || "Found 0 skills\n");
  process.exit(0);
}

if (command === "list" && rest.includes("--json")) {
  process.stdout.write(JSON.stringify(scenario.listJson || []));
  process.exit(0);
}

console.error(`unsupported fake skills command: ${command}`);
process.exit(64);
```

Implementation notes:

- The helper should create executable files with mode `0o755`.
- The fake command should write JSON Lines so tests can assert call order.
- Scenario data should live in environment variables or temp JSON files, not global module state.
- On Windows support later, executable extension handling may need a `.cmd` wrapper. This project currently targets the local Node/Jest environment first.

Fake helper tests:

```typescript
test("fake skills CLI records npx skills invocations", async () => {
  await withFakeSkillsCli(
    {
      find: {
        frontend: readFixture("skills-cli/find-react.txt"),
      },
    },
    async ({ env, callsPath }) => {
      const cli = new SkillsCli({ env });
      const result = await cli.find("frontend");

      expect(result.candidates.length).toBeGreaterThan(0);

      const calls = await readJsonLines<FakeSkillsInvocation>(callsPath);
      expect(calls[0].args).toEqual(["--yes", "skills", "find", "frontend"]);
      expect(calls[0].env.DISABLE_TELEMETRY).toBe("1");
    },
  );
});
```

Acceptance criteria:

- [ ] Fake `npx` supports `find`, `use`, `add --list`, `add --skill`, and `list --json`.
- [ ] Fake `npx` records cwd, args, and telemetry-related env.
- [ ] Fake `npx` can simulate non-zero exits, malformed JSON, empty results, and slow responses.
- [ ] Integration tests never reach the real npm registry or skills.sh by default.

### 9.2.2 Pipeline With Selected Skills

Files:

- `src/skills/pipeline.ts`
- `src/skills/discovery.ts`
- `src/skills/audit.ts`
- `src/skills/install.ts`
- `src/skills/render.ts`
- `src/session.ts`
- `tests/skillsIntegration.test.ts`
- `tests/fixtures/skills-e2e/`

Required end-to-end cases:

| Case | Expected behavior |
| --- | --- |
| Website task selects frontend skill | Query, candidate, audit, install, and injection records are persisted |
| No matching skill continues build | Pipeline emits skipped/no-candidate event and returns empty context |
| Audit fail excludes skill | Candidate and audit are persisted, but install and prompt injection are skipped |
| Install failure degrades gracefully | Prompt context is not injected from a missing install path |
| Max skills cap respected | Only top `maxSkills` pass-audited skills are installed/injected |
| Telemetry disabled in CLI env | Fake CLI call records prove env settings on every call |
| Live feed stays concise | Events include selected/skipped/installed/injected summaries without dumping full skill text |

Example integration test:

```typescript
test("runs the skills pipeline for a website task with selected skills", async () => {
  await withFakeSkillsCli(
    {
      find: {
        "website frontend react": readFixture("skills-cli/find-react.txt"),
      },
      use: {
        "vercel-labs/agent-skills@frontend-design": readFixture("skills-e2e/frontend-use.txt"),
      },
      listJson: [],
    },
    async ({ env }) => {
      const workspace = await createSkillTestWorkspace({
        env,
        config: skillConfig({ mode: "auto", maxSkills: 1 }),
      });

      const result = await runSkillPipeline({
        sessionId: workspace.sessionId,
        idea: "Create a React website for a bakery",
        workspaceRoot: workspace.root,
        config: workspace.config,
        env,
        phase: "planning",
      });

      expect(result.selectedSkills).toHaveLength(1);
      expect(result.selectedSkills[0].skillName).toBe("frontend-design");
      expect(result.promptContext.text).toContain("frontend-design");

      await expectSkillInstallRecorded(workspace.db, {
        sessionId: workspace.sessionId,
        skillName: "frontend-design",
      });
    },
  );
});
```

Acceptance criteria:

- [ ] At least one integration test crosses discovery, scoring, audit, install, render, and DB persistence.
- [ ] Empty, fail, and partial-failure cases are covered.
- [ ] Pipeline tests assert both returned context and persisted evidence.
- [ ] Tests prove no selected skill bypasses audit.

### 9.2.3 Resume Behavior

Files:

- `src/session.ts`
- `src/db.ts`
- `src/skills/pipeline.ts`
- `tests/skillsResumeIntegration.test.ts`

Required cases:

| Case | Expected behavior |
| --- | --- |
| Resume reuses selected skills | Previously selected and audited skills are reused when still valid |
| Resume does not re-search every time | No fake `skills find` call occurs when valid selections exist |
| Resume respects session snapshot | Later global config changes do not mutate existing session behavior unless explicitly overridden |
| Resume handles missing install | Missing workspace skill path triggers reinstall or safe exclusion based on Phase 5 design |
| Resume with disabled current config | Session snapshot determines behavior for existing session unless Phase 8 override says otherwise |
| Resume after audit version change | Stale audit results are recomputed before injection |

Example test:

```typescript
test("resume reuses stored selections without searching again", async () => {
  const workspace = await createSkillTestWorkspace({
    config: skillConfig({ mode: "auto", maxSkills: 1 }),
  });

  await seedSkillSelection(workspace.db, {
    sessionId: workspace.sessionId,
    packageRef: "vercel-labs/agent-skills",
    skillName: "frontend-design",
    auditVerdict: "pass",
    installedPath: ".forge/skills/frontend-design",
  });

  await withFakeSkillsCli({}, async ({ callsPath, env }) => {
    const result = await resumeSkillPipeline({
      sessionId: workspace.sessionId,
      workspaceRoot: workspace.root,
      env,
    });

    expect(result.promptContext.text).toContain("frontend-design");
    await expectNoFakeSkillCommand(callsPath, "find");
  });
});
```

Acceptance criteria:

- [ ] Resume tests prove session snapshots are stable.
- [ ] Resume tests prove unnecessary discovery is avoided.
- [ ] Resume tests cover missing or stale installed skill files.
- [ ] Resume tests cover current config changes after session creation.

### 9.2.4 External-Agent Prompt Behavior

Files:

- `src/agents.ts`
- `src/externalAgents.ts` or current external-agent runner module
- `src/skills/pipeline.ts`
- `src/skills/install.ts`
- `src/skills/render.ts`
- `tests/skillsExternalAgentIntegration.test.ts`

Required cases:

| Case | Expected behavior |
| --- | --- |
| Claude target receives prompt context | Prompt passed to the mocked Claude runner includes selected skill context |
| Codex target receives prompt context | Prompt passed to the mocked Codex runner includes selected skill context |
| Isolated workspace receives skill files | External task workspace has the expected `.agents/skills` or `.forge/skills` copy |
| Root-only install is insufficient | Test fails if external prompt references a path unavailable inside the task workspace |
| Prompt budget applies to external agents | Large skill context is trimmed before launching external agent |
| Disabled skills produce no prompt section | `--skills off` or config mode `off` leaves external-agent prompts unchanged |

Example prompt forwarding assertion:

```typescript
test("external Claude task receives selected skill context and workspace copy", async () => {
  const runner = createMockExternalAgentRunner();
  const workspace = await createSkillTestWorkspace({
    config: skillConfig({ mode: "auto", installTargets: ["forge", "agents"] }),
  });

  await seedInstalledSkill(workspace, {
    skillName: "frontend-design",
    prompt: "Use responsive layout and accessible form controls.",
  });

  await runExternalCodingTask({
    agent: "claude",
    workspaceRoot: workspace.root,
    prompt: "Build the homepage",
    skillContext: await loadSkillContextForSession(workspace.sessionId),
    runner,
  });

  expect(runner.calls[0].prompt).toContain("frontend-design");
  expect(runner.calls[0].prompt).toContain("responsive layout");
  await expectPathExists(path.join(runner.calls[0].cwd, ".agents", "skills", "frontend-design"));
});
```

Acceptance criteria:

- [ ] External-agent tests use mocked runners.
- [ ] Tests prove skill files and prompt context are available in isolated task workspaces.
- [ ] Tests cover at least one external agent path and one disabled-skills path.

## Subphase 9.3 - Docs

### Goal

Make the skills feature understandable and auditable for users who did not read the phase plans.

### Documentation Principles

- State that skills are off by default in alpha.
- State when Forge may call `npx skills`.
- State what gets installed into the project workspace.
- State that third-party skill text is audited and bounded before prompt injection.
- State that skills.sh has its own telemetry behavior, and Forge attempts to disable telemetry in CLI calls.
- Avoid presenting skills as a guarantee of better output.
- Give users a direct rollback path.

### 9.3.1 README Feature Section

Add a concise README section near usage/setup, with a link to full docs.

Suggested README text:

````markdown
## Skills

Forge can optionally use agent skills from the skills.sh ecosystem to add task-specific guidance to a build. Skills are disabled by default during alpha.

Enable skills for one build:

```bash
forgecli build "Create a React website for a local bakery" --skills auto --skills-max 2
```

Disable skills for one build:

```bash
forgecli build "Create a landing page" --skills off
```

Persist a default in `~/.forge/config.toml`:

```toml
[skills]
mode = "auto"
max_skills = 2
prompt_char_budget = 12000
min_install_count = 100
trusted_sources = ["vercel-labs"]
install_targets = ["forge", "agents"]
```

When enabled, Forge may search with `npx skills`, inspect selected skill bundles, install approved skills into the project workspace, and inject bounded guidance into agent prompts for the current session. Forge does not install skills globally by default.

Read `docs/skills.md` for safety, privacy, troubleshooting, and rollout status.
````

Implementation notes:

- Keep README short.
- Link to `docs/skills.md` for detailed behavior and troubleshooting.
- Avoid promising that all skills are safe; say Forge audits and skips risky skills.
- Mention project-local installation and rollback.

Acceptance criteria:

- [ ] README says skills are disabled by default in alpha.
- [ ] README shows `--skills auto`, `--skills off`, and `--skills-max`.
- [ ] README shows `[skills]` config.
- [ ] README links to full docs.

### 9.3.2 Safety And Privacy Notes

Create `docs/skills.md` with a dedicated safety/privacy section.

Suggested structure:

````markdown
# Skills

## Status

Skills support is alpha and disabled by default.

## What Forge Does When Skills Are Enabled

1. Builds a small set of search queries from the current task and project signals.
2. Runs the skills CLI with telemetry-disabling environment variables where supported.
3. Scores search results for task relevance and trust policy.
4. Fetches selected skill prompt bundles for audit.
5. Skips skills with risky or irrelevant instructions.
6. Installs approved skills into project-local Forge/agent paths.
7. Injects bounded skill guidance into agent prompts for the session.

## Safety Model

Forge treats third-party skills as untrusted operational prompt text. Skills do not override system, developer, user, or project instructions. Forge audits skill content before installation and prompt injection, and failed skills are skipped.

## Privacy

Enabling skills may cause Forge to run `npx skills` queries derived from your task. Forge sets telemetry-disabling environment variables for skills CLI calls, but the upstream skills CLI and registry behavior may change. Review the skills.sh documentation before enabling skills for sensitive projects.

## Project Files

Forge may write project-local skill files under `.forge/skills` and agent-facing skill directories such as `.agents/skills`, depending on config.

## Disable Or Roll Back

Use `--skills off` for one build, or set:

```toml
[skills]
mode = "off"
```
````

Safety details that must be included:

| Topic | Required wording |
| --- | --- |
| Trust | Skills are third-party content unless from local or explicitly trusted sources |
| Prompt hierarchy | Skills do not override higher-priority instructions |
| Audit | Forge may skip risky skills automatically |
| Telemetry | Forge sets telemetry-disabling env vars, but users should review upstream policy |
| Network | Enabling skills may involve registry/npm network access |
| Storage | Project-local skill copies and DB metadata may be created |
| Rollback | `--skills off` and `[skills].mode = "off"` |

Acceptance criteria:

- [ ] Safety model uses plain language.
- [ ] Privacy note mentions task-derived search queries.
- [ ] Docs explain project-local files.
- [ ] Docs give a rollback path.
- [ ] Docs avoid telling users to commit generated skill directories unless a later phase intentionally supports that workflow.

### 9.3.3 Troubleshooting

Add troubleshooting to `docs/skills.md` and link it from README.

Suggested table:

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `npx not found` | Node/npm is missing from PATH | Install Node/npm or disable skills with `--skills off` |
| Skills search is slow | First `npx skills` run is downloading CLI package | Retry, or keep skills disabled for time-sensitive runs |
| No skills selected | Query had no relevant results, install counts were low, or mode is off | Lower `min_install_count`, adjust trusted sources, or run without skills |
| Skill skipped after audit | Skill contained risky instructions or unsupported files | Inspect debug logs and choose a safer skill/source |
| Skill installed but not used | Prompt budget or relevance gate excluded it | Lower `--skills-max` pressure or increase prompt budget |
| Resume did not search again | Session reused stored skill selections | Start a new build or clear session state if re-discovery is needed |
| External agent cannot see skill files | Isolated task workspace did not receive the skill copy | Check install targets and workspace mirroring logs |
| `skills list --json` parse failed | Upstream CLI output changed | File an issue with captured Forge debug output |
| Live smoke test fails in CI | Tier 4 network tests ran accidentally | Remove `FORGE_RUN_SKILLS_LIVE=1` from CI env |

Acceptance criteria:

- [ ] Troubleshooting covers install, discovery, audit, prompt, resume, and external-agent issues.
- [ ] Every fix includes a safe disable path.
- [ ] No troubleshooting step asks users to run global installation unless explicitly needed.

## Subphase 9.4 - Rollout

### Goal

Ship the feature in stages with evidence-based gates.

### Rollout Gate Model

```typescript
export type RolloutGateStatus = "blocked" | "ready" | "passed";

export interface RolloutGate {
  id: string;
  stage: "alpha" | "beta" | "default-on";
  requiredEvidence: string[];
  status: RolloutGateStatus;
  notes?: string;
}

export const SKILLS_ROLLOUT_GATES: RolloutGate[] = [
  {
    id: "alpha-disabled-default",
    stage: "alpha",
    requiredEvidence: [
      "npm run build passes",
      "unit and integration matrix passes",
      "README and docs/skills.md explain opt-in behavior",
      "default config remains mode off",
    ],
    status: "blocked",
  },
];
```

This model can remain documentation-only unless release automation needs it.

### 9.4.1 Disabled-By-Default Alpha

Alpha default:

```toml
[skills]
mode = "off"
max_skills = 3
prompt_char_budget = 12000
min_install_count = 100
trusted_sources = ["vercel-labs"]
install_targets = ["forge", "agents"]
```

Alpha user controls:

```bash
forgecli build "Create a website for a dentist" --skills auto --skills-max 2
forgecli build "Create a website for a dentist" --skills off
```

Alpha release gates:

| Gate | Required evidence |
| --- | --- |
| Defaults | New config and missing config load with `skills.mode = "off"` |
| Build | `npm run build` passes |
| Tests | Tier 1, Tier 2, and Tier 3 required tests pass |
| Docs | README and `docs/skills.md` merged |
| No live network in CI | Fake CLI tests are the default; Tier 4 is opt-in |
| Rollback | `--skills off` and config `mode = "off"` verified |
| Safety | Audit fail cases block install and injection |
| Prompt boundary | Rendered skill context does not override higher-priority instructions |

Alpha acceptance criteria:

- [ ] Skills are disabled by default for new and existing users.
- [ ] `--skills auto` is required for a one-off enabled build unless setup config has opted in.
- [ ] Alpha release notes describe the feature as experimental.
- [ ] All required Tier 0 through Tier 3 tests pass.
- [ ] Tier 4 live smoke is either skipped with a documented reason or run manually with evidence.

### 9.4.2 Opt-In Beta

Beta default:

- Keep default `mode = "off"` unless alpha evidence strongly supports a different setup default.
- Setup may expose a clearer opt-in path, but the recommended option should remain conservative until dogfood is clean.

Beta gates:

| Gate | Required evidence |
| --- | --- |
| Dogfood | At least 20 real builds across website, CLI, API, and bug-fix tasks |
| Safety | No known high-severity prompt injection, secret access, destructive command, or install-path bug |
| Quality | Skills improve or do not materially degrade at least 70 percent of reviewed dogfood tasks |
| Performance | Median skills pipeline overhead stays under the configured budget |
| Observability | Logs/events explain selected, skipped, audited, installed, and injected skills |
| Docs | Troubleshooting entries reflect alpha issues seen in practice |
| User control | Users can disable skills at build time and in config |

Beta evidence template:

```markdown
## Skills Beta Evidence

- Date range:
- Forge version:
- Number of dogfood builds:
- Task categories:
- Pass/fail summary:
- Skills selected most often:
- Skills skipped most often:
- Safety incidents:
- Performance notes:
- Documentation updates made:
- Decision:
```

Beta acceptance criteria:

- [ ] Alpha dogfood evidence is recorded.
- [ ] Troubleshooting docs are updated from real failure modes.
- [ ] No known blocker remains in audit, install, prompt injection, or resume behavior.
- [ ] Live skills.sh smoke tests pass before beta release.

### 9.4.3 Default-On Criteria

Default-on is a future decision. It must not happen simply because alpha and beta exist.

Default-on gates:

| Gate | Required evidence |
| --- | --- |
| Stable defaults | Config default change has an explicit migration and rollback plan |
| Safety confidence | Audit false-negative review is complete for dogfood failures |
| Privacy confidence | Docs and setup clearly explain task-derived skills search |
| Cost/performance | Pipeline overhead is bounded and visible |
| User trust | Users can see why a skill was selected and how to disable it |
| Workspace cleanliness | Project-local skill files are predictable and documented |
| External agents | Isolated workspace behavior is proven for supported external agents |
| CI stability | Fake CLI tests are reliable across repeated runs |
| Upstream drift | Parser and fake fixtures are updated after comparing live CLI output |
| Release rollback | A config/env/flag path can immediately disable skills |

Default-on candidate default:

```toml
[skills]
mode = "auto"
max_skills = 2
prompt_char_budget = 8000
min_install_count = 250
trusted_sources = ["vercel-labs"]
install_targets = ["forge"]
```

The candidate default intentionally tightens `max_skills`, `prompt_char_budget`, and install targets. Default-on should start narrower than opt-in alpha/beta, not broader.

Default-on acceptance criteria:

- [ ] A maintainer explicitly approves changing the default.
- [ ] Rollback path is tested in a release candidate.
- [ ] Live smoke test output is compared against fake fixtures.
- [ ] Default-on docs are updated before release.
- [ ] Release notes include the default change and disable instructions.

## Implementation Order

1. Finish Phase 1 through Phase 8 implementation tests.
2. Add fake `npx`/`skills` helper and prove it records invocations.
3. Add cross-phase pipeline integration tests.
4. Add resume integration tests.
5. Add external-agent prompt/workspace integration tests.
6. Update README with the short feature section.
7. Create `docs/skills.md`.
8. Run Tier 0 through Tier 3 validation.
9. Optionally run Tier 4 live smoke with explicit environment opt-in.
10. Fill alpha rollout checklist before release.

## Detailed Task Checklist

### Task 9.1 - Close Unit Coverage

- [ ] Run the current unit suite and list missing skills test files.
- [ ] Confirm Phase 1 tests cover config defaults, TOML round-trip, DB persistence, and session snapshot.
- [ ] Confirm Phase 2 tests cover adapter parser and spawn behavior.
- [ ] Add or finish Phase 3 scoring/discovery unit tests.
- [ ] Add or finish Phase 4 audit/bundle/redaction unit tests.
- [ ] Add or finish Phase 5 install/path/inventory unit tests.
- [ ] Add or finish Phase 6 render/context/tool unit tests.
- [ ] Add or finish Phase 7 pipeline/relevance unit tests.
- [ ] Add or finish Phase 8 CLI/setup/session override unit tests.

Validation command:

```bash
node --experimental-sqlite node_modules/.bin/jest tests/skillsCli.test.ts tests/skillsPlanner.test.ts tests/skillsScoring.test.ts tests/skillsDiscovery.test.ts tests/skillsBundle.test.ts tests/skillsAuditRules.test.ts tests/skillsAudit.test.ts tests/skillsPaths.test.ts tests/skillsInventory.test.ts tests/skillsInstall.test.ts tests/skillsRender.test.ts tests/skillsContext.test.ts tests/skillsTools.test.ts tests/skillsPipeline.test.ts tests/skillsRelevance.test.ts tests/skillsCliOptions.test.ts tests/setupSkills.test.ts tests/sessionSkillsConfig.test.ts --no-coverage
```

### Task 9.2 - Build Fake CLI Harness

- [ ] Create `tests/helpers/fakeSkillsCli.ts`.
- [ ] Create fake `npx` executable writer.
- [ ] Add JSONL call recording.
- [ ] Add scenario support for `find`.
- [ ] Add scenario support for `use`.
- [ ] Add scenario support for `add --list`.
- [ ] Add scenario support for `add --skill`.
- [ ] Add scenario support for `list --json`.
- [ ] Add failure, malformed output, and delay support.
- [ ] Add cleanup for temporary directories.
- [ ] Add `tests/skillsFakeCli.test.ts`.

Validation command:

```bash
node --experimental-sqlite node_modules/.bin/jest tests/skillsFakeCli.test.ts --no-coverage
```

### Task 9.3 - Add Pipeline Integration Tests

- [ ] Create `tests/fixtures/skills-e2e/frontend-find.txt`.
- [ ] Create `tests/fixtures/skills-e2e/frontend-use.txt`.
- [ ] Create `tests/fixtures/skills-e2e/audit-fail-use.txt`.
- [ ] Create `tests/fixtures/skills-e2e/list-empty.json`.
- [ ] Create `tests/skillsIntegration.test.ts`.
- [ ] Test selected skill flow.
- [ ] Test empty result flow.
- [ ] Test audit fail flow.
- [ ] Test install failure flow.
- [ ] Assert persisted records.
- [ ] Assert live feed summaries.

Validation command:

```bash
node --experimental-sqlite node_modules/.bin/jest tests/skillsIntegration.test.ts --runInBand --no-coverage
```

### Task 9.4 - Add Resume Integration Tests

- [ ] Create `tests/skillsResumeIntegration.test.ts`.
- [ ] Seed session with selected skill records.
- [ ] Verify resume reuses selected skills.
- [ ] Verify resume avoids unnecessary search.
- [ ] Verify config snapshot stability.
- [ ] Verify missing install path behavior.
- [ ] Verify stale audit behavior.

Validation command:

```bash
node --experimental-sqlite node_modules/.bin/jest tests/skillsResumeIntegration.test.ts --runInBand --no-coverage
```

### Task 9.5 - Add External-Agent Integration Tests

- [ ] Create `tests/skillsExternalAgentIntegration.test.ts`.
- [ ] Mock external agent runner.
- [ ] Verify prompt context forwarding.
- [ ] Verify isolated workspace skill copy.
- [ ] Verify disabled-skills path.
- [ ] Verify prompt budget trimming.

Validation command:

```bash
node --experimental-sqlite node_modules/.bin/jest tests/skillsExternalAgentIntegration.test.ts --runInBand --no-coverage
```

### Task 9.6 - Update README

- [ ] Add short Skills section.
- [ ] Add one-build enable command.
- [ ] Add one-build disable command.
- [ ] Add `[skills]` TOML example.
- [ ] Link `docs/skills.md`.
- [ ] Keep alpha disabled-by-default wording.

Validation command:

```bash
rg -n "Skills|--skills auto|--skills off|docs/skills.md|mode = \"auto\"" README.md
```

### Task 9.7 - Create Full Skills Docs

- [ ] Create `docs/skills.md`.
- [ ] Add status section.
- [ ] Add what Forge does section.
- [ ] Add safety model.
- [ ] Add privacy section.
- [ ] Add project files section.
- [ ] Add config reference.
- [ ] Add troubleshooting table.
- [ ] Add rollout status.

Validation command:

```bash
rg -n "disabled by default|telemetry|--skills off|troubleshooting|project-local" docs/skills.md
```

### Task 9.8 - Fill Rollout Checklist

- [ ] Record Tier 0 command output.
- [ ] Record Tier 1 command output.
- [ ] Record Tier 2 command output.
- [ ] Record Tier 3 command output.
- [ ] Decide whether Tier 4 live smoke is needed before alpha.
- [ ] Record alpha release decision.
- [ ] Create beta evidence template.
- [ ] Leave default-on blocked until explicit future approval.

## Full Validation Commands

Static build:

```bash
npm run build
```

Full Jest suite:

```bash
node --experimental-sqlite node_modules/.bin/jest --no-coverage
```

Skills-focused suite:

```bash
node --experimental-sqlite node_modules/.bin/jest tests/skillsCli.test.ts tests/skillsPlanner.test.ts tests/skillsScoring.test.ts tests/skillsDiscovery.test.ts tests/skillsBundle.test.ts tests/skillsAuditRules.test.ts tests/skillsAudit.test.ts tests/skillsPaths.test.ts tests/skillsInventory.test.ts tests/skillsInstall.test.ts tests/skillsRender.test.ts tests/skillsContext.test.ts tests/skillsTools.test.ts tests/skillsPipeline.test.ts tests/skillsRelevance.test.ts tests/skillsCliOptions.test.ts tests/setupSkills.test.ts tests/sessionSkillsConfig.test.ts tests/skillsFakeCli.test.ts tests/skillsIntegration.test.ts tests/skillsResumeIntegration.test.ts tests/skillsExternalAgentIntegration.test.ts --runInBand --no-coverage
```

Docs smoke:

```bash
rg -n "skills|--skills auto|telemetry|disabled by default|troubleshooting" README.md docs/skills.md
```

Optional live smoke:

```bash
FORGE_RUN_SKILLS_LIVE=1 DISABLE_TELEMETRY=1 DO_NOT_TRACK=1 NO_COLOR=1 npx --yes skills find frontend
```

Live smoke rules:

- Run manually only.
- Do not run in normal CI.
- Do not run on sensitive project prompts.
- Capture only command status and high-level output shape.
- If output shape changed, update parser fixtures before release.

## CI Plan

Minimum CI before alpha:

```yaml
name: test

on:
  pull_request:
  push:
    branches:
      - main
      - feature/skills-sh-context

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run build
      - run: node --experimental-sqlite node_modules/.bin/jest --no-coverage
```

Do not add live skills.sh commands to this CI job. If live smoke is added later, make it a separate manual workflow with explicit environment opt-in.

## Release Notes Draft

Alpha release note:

````markdown
### Skills alpha

Forge can now optionally use skills from the skills.sh ecosystem to add task-specific guidance to a build. This is disabled by default.

Try it for one build:

```bash
forgecli build "Create a React website for a bakery" --skills auto --skills-max 2
```

Disable it for a build:

```bash
forgecli build "Create a React website for a bakery" --skills off
```

When enabled, Forge may run `npx skills`, audit selected skill content, install approved skills into project-local directories, and inject bounded guidance into agent prompts. See `docs/skills.md` for safety, privacy, and troubleshooting notes.
````

## Risks And Mitigations

| Risk | Mitigation |
| --- | --- |
| Upstream CLI output changes | Parser fixtures, fake CLI drift checks, optional live smoke |
| CI accidentally hits network | Fake `npx` in PATH, no live smoke unless `FORGE_RUN_SKILLS_LIVE=1` |
| Unsafe skill prompt enters agent context | Audit fail blocks install and injection; prompt renderer adds explicit boundaries |
| Resume reuses stale unsafe skill | Audit versioning and stale-audit tests |
| External agent cannot access skill files | Workspace mirroring tests |
| Docs understate telemetry/network behavior | Safety/privacy section and setup copy |
| Users cannot roll back | `--skills off`, config mode off, and release notes |
| Prompt context grows too large | Prompt budget tests and truncation metadata |

## Acceptance Criteria

- [ ] Phase 9 research gate is closed.
- [ ] Full test matrix maps every previous implementation phase to required tests.
- [ ] Fake `npx`/`skills` integration harness is planned and later implemented.
- [ ] Integration tests cover selected skill, no skill, audit fail, install fail, resume, and external-agent prompt behavior.
- [ ] README explains skills usage in alpha without requiring users to read planning notes.
- [ ] `docs/skills.md` explains safety, privacy, project files, config, troubleshooting, and rollout status.
- [ ] Alpha remains disabled by default.
- [ ] Beta and default-on gates are explicit and evidence-based.
- [ ] Validation commands are documented and runnable with the current Node/Jest setup.
- [ ] Tier 4 live smoke remains manual and opt-in.

## Open Questions For Implementation

- Should Phase 9 add a machine-readable validation matrix, or is the Markdown checklist enough for alpha?
- Should docs live only in `docs/skills.md`, or should the README include a larger feature section?
- Should fake CLI support be generic enough for other future external CLI integrations?
- Should live smoke results be recorded in a release checklist file under `docs/releases/`?
- Should default-on ever include non-`vercel-labs` trusted sources without explicit user configuration?

## Source Notes

- [skills.sh docs](https://www.skills.sh/docs)
- [vercel-labs/skills README](https://github.com/vercel-labs/skills/blob/main/README.md)
- [Vercel Agent Skills docs](https://vercel.com/docs/agent-resources/skills)
- [OpenAI Codex Agent Skills docs](https://developers.openai.com/codex/skills)
- [Jest CLI docs](https://jestjs.io/docs/cli)
- [ts-jest ESM support docs](https://kulshekhar.github.io/ts-jest/docs/guides/esm-support)
