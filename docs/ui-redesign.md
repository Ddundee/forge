# Forge UI/UX Redesign

## Pain points addressed
- Setup wizard: no step progress, no validation, flat model list
- Live dashboard: no cost/elapsed tracking, no event log column, sparse layout
- Interrupt: no session info key, no quit confirmation
- Sessions/logs: basic tables, no time-ago, no status emoji
- First-run: no guard if setup hasn't been run

---

## 1. Setup Wizard

```
╭────────────────────────────────────────────────╮
│   ⚒  FORGE  —  idea to product in one command  │
╰────────────────────────────────────────────────╯

Step 1 of 4 — Priority
  What matters most?
  > Quality — best output, most capable models
    Speed   — fastest responses
    Cost    — minimize spend

Step 2 of 4 — Providers
  Which APIs do you have keys for?
  [x] Anthropic (Claude)
  [ ] OpenAI
  [ ] Google (Gemini)
  [ ] Groq
  [ ] Mistral

Step 3 of 4 — API Keys
  Anthropic API key: [hidden]
  ✓ Key saved

Step 4 of 4 — Models  (live list fetched from API)
  Overseer — architecture & planning:
  > claude-opus-4-8
    claude-sonnet-4-6
    ...

╭──────────────────────────────────────────────╮
│  ✓ Setup complete!                           │
│  Config → ~/.forge/config.toml              │
│  Run:    forgecli build "your idea"          │
╰──────────────────────────────────────────────╯
```

Changes:
- FORGE banner at top of wizard
- "Step N of 4" heading before each section
- Completion summary panel with next-step hint

---

## 2. Live Dashboard

```
 forge  ●  sticky notes app  ●  CODING  ●  cycle 1/5  ●  0:42  ●  $0.023

 Ideation ✓ → Architecture ✓ → TaskGraph ✓ → [Coding] → Integration → Testing → Verify

╭─ Overseer ────────────────────────────────────────────────────────────────────╮
│  Dispatching 4 coding tasks (2 parallel). Next: integration phase.            │
╰────────────────────────────────────────────────────────────────────────────────╯

 Tasks                                         │  Events
 ─────────────────────────────────────────────   ──────────────────────────────────
 [✓] Setup project structure      done         │  0:38  CODING  Coding: Setup struct
 [✓] Database models              done         │  0:39  CODING  Task done: Setup
 [~] Auth endpoints (JWT)         writing      │  0:40  CODING  Coding: DB models
 [~] Bookmark CRUD API            writing      │  0:41  CODING  Task done: DB models
 [ ] Wire auth into routes        waiting      │  0:42  CODING  Coding: Auth (JWT)

 [i] interrupt   [s] session info   [q] quit & save
```

Changes:
- Header: elapsed time + running cost (`$0.023`)
- Phase progress row: all phases shown, current one highlighted in cyan, done ones with ✓
- Body: 2-column — tasks (left) | recent events (right)
- Events column: last ~10 events, elapsed-relative timestamps
- Cost pulled from DB `SUM(llm_calls.cost_usd)` on each render cycle

New `LiveFeed` fields:
- `total_cost: float = 0.0` — set by `on_event` in cli.py
- `_start_time: float` — set in `start()`

---

## 3. Interrupt Handler

New keybindings (added alongside existing `i` and `q`):
- `i` — pause, prompt for redirect message (existing, keep)
- `s` — show session overlay (ID, elapsed, cost, phase, cycle)
- `q` — confirm before quitting: "Save and quit? [y/N]"

Session info overlay (shown inline, no extra screen):
```
╭─ Session Info ────────────────────╮
│  ID:      abc123                  │
│  Phase:   CODING                  │
│  Cycle:   1 / 5                   │
│  Cost:    $0.023                  │
│  Elapsed: 0:42                    │
╰───────────────────────────────────╯
Press any key to continue...
```

---

## 4. CLI Commands

### `forgecli build`
- First-run guard: if `~/.forge/keys.env` missing → print helpful message and exit cleanly

### `forgecli sessions`
```
         Forge Sessions
 ──────────────────────────────────────────────────────────
 ID       Status    Idea                      Cost   When
 abc123   ✓ done    bookmarks manager...     $0.23   2h ago
 def456   ⟳ CODING  markdown to PDF...       $0.09   3h ago
 ghi789   ✗ FAILED  weather dashboard...     $0.01   1d ago
```

### `forgecli logs`
- Show session header (ID, idea, phase, cost) before entries
- Color entries by phase
- Show time-relative elapsed (0:00, 0:01...) not absolute UTC

### `forgecli resume`
- Print session summary (idea, phase, cycle, cost so far) before resuming

---

## 5. Database

New method: `Database.get_total_cost(session_id: str) -> float`
```python
SELECT COALESCE(SUM(cost_usd), 0) FROM llm_calls WHERE session_id = ?
```
Used by `on_event` in cli.py to update `feed.total_cost`.

---

## Todo

### Agent A — Setup wizard (config.py)
- [ ] Add `_print_banner()` with styled FORGE header using Rich Panel
- [ ] Add step heading before each wizard section (Step N of 4 — Label)
- [ ] Add success panel at end with config path + next-step hint
- [ ] Wrap existing questionary calls — no logic changes, purely cosmetic

### Agent B — Live dashboard (live_feed.py)
- [ ] Add `_start_time: float` field (set in `start()` via `time.monotonic()`)
- [ ] Add `total_cost: float = 0.0` field (updated externally)
- [ ] Refactor `_render()` into sub-methods: `_header()`, `_phase_bar()`, `_body()`
- [ ] `_header()`: include elapsed (M:SS) and cost
- [ ] `_phase_bar()`: render phase pipeline row, current phase highlighted
- [ ] `_body()`: split into tasks (left) + events (right) using Layout columns
- [ ] Events panel: show last 10 events from `self.events` with elapsed timestamps

### Agent C — CLI + interrupt + DB (cli.py, interrupt.py, db.py)
- [ ] db.py: add `get_total_cost(session_id)` method
- [ ] cli.py `on_event`: add `feed.total_cost = session.db.get_total_cost(session.id)`
- [ ] cli.py `build`: first-run guard if keys.env missing
- [ ] cli.py `sessions`: time-ago helper, emoji status column
- [ ] cli.py `logs`: session header + phase-colored rows + relative timestamps
- [ ] cli.py `resume`: print session summary before resuming
- [ ] interrupt.py: add `s` key handler (session info overlay via callback)
- [ ] interrupt.py: `q` key — ask confirm before raising KeyboardInterrupt
