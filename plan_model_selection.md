# Plan: Dynamic Model Selection in `forge setup`

## Problem

1. The provider label "OpenAI (GPT-4)" implies GPT-4 is the model, which is stale and misleading.
2. After picking providers and entering API keys, the wizard never asks the user which models to use — it auto-assigns a hardcoded profile.
3. The hardcoded `PROVIDER_PROFILES` can become stale between releases.

## Solution

After entering API keys, forge **fetches the live model list from each provider's API**, then presents a model picker for each of the four tiers (OVERSEER, REASONING, STANDARD, FAST). The selected models are saved to `config.toml` and used in every build.

Fallback: if an API call fails (offline, bad key, provider down) we fall back to litellm's built-in model registry, which is always present and reasonably up to date.

---

## Architecture

### New file: `src/forge/model_fetch.py`

Single public function: `fetch_models_for_provider(provider_label, api_key) -> list[str]`

Internally calls a provider-specific fetcher, filters noise (embeddings, image, tts, audio, guard models), then sorts by recency (newest model IDs first). Falls back to litellm's `models_by_provider` if the HTTP call fails.

Provider API endpoints:
| Provider | Endpoint | Auth header |
|---|---|---|
| Anthropic | `https://api.anthropic.com/v1/models` | `x-api-key: {key}` |
| OpenAI | `https://api.openai.com/v1/models` | `Authorization: Bearer {key}` |
| Google | `https://generativelanguage.googleapis.com/v1beta/models?key={key}` | (query param) |
| Groq | `https://api.groq.com/openai/v1/models` | `Authorization: Bearer {key}` |
| Mistral | `https://api.mistral.ai/v1/models` | `Authorization: Bearer {key}` |

### Changes to `src/forge/config.py`

1. Rename "OpenAI (GPT-4)" → "OpenAI" in `_PROVIDER_CHOICES` and `_PROVIDER_KEY_MAP`.
2. After collecting API keys, call `fetch_models_for_provider` for each selected provider (with a spinner).
3. Merge all fetched models into a single list, grouped by provider for display.
4. Show four `questionary.select` calls — one per tier — with smart defaults pre-selected.
5. Save the chosen models to `ForgeConfig.models` (already persisted to `config.toml`).

### Tier display names

```
OVERSEER  → "Overseer  — architecture & planning (most capable, most expensive)"
REASONING → "Reasoning — coding & integration (smart + fast)"
STANDARD  → "Standard  — review & task graph (balanced)"
FAST      → "Fast      — quick single-turn calls (cheapest)"
```

---

## Todo List

### Phase 1 — `model_fetch.py`: provider API calls + filtering

- [ ] **1.1** Create `src/forge/model_fetch.py`
  - [ ] Add `_CHAT_SKIP_PATTERNS` — tuple of substrings that identify non-chat models to exclude
    - `"embed"`, `"tts"`, `"whisper"`, `"dall-e"`, `"audio"`, `"image"`, `"vision"` (standalone), `"guard"`, `"instruct"`, `"babbage"`, `"davinci"`, `"curie"`, `"ada"`, `"live"`, `"native-audio"`, `"deep-research"`, `"computer-use"`
  - [ ] Add `_should_skip(model_id: str) -> bool` using `_CHAT_SKIP_PATTERNS`
  - [ ] Add `_http_get_json(url: str, headers: dict[str, str]) -> dict` using `urllib.request` (stdlib, no new deps)
    - 5-second timeout, raises `urllib.error.URLError` on failure
  - [ ] Add `_fetch_anthropic(api_key: str) -> list[str]`
    - GET `https://api.anthropic.com/v1/models` with `x-api-key` and `anthropic-version: 2023-06-01` headers
    - Extract `data[*].id`, filter with `_should_skip`, keep only `claude-*`
  - [ ] Add `_fetch_openai(api_key: str) -> list[str]`
    - GET `https://api.openai.com/v1/models` with Bearer auth
    - Extract `data[*].id`, filter with `_should_skip`, keep only `gpt-4*`, `o1*`, `o3*`, `o4*`, `chatgpt-4o*`
  - [ ] Add `_fetch_google(api_key: str) -> list[str]`
    - GET `https://generativelanguage.googleapis.com/v1beta/models?key={key}`
    - Extract `models[*].name`, strip `models/` prefix, format as `gemini/{name}`, filter with `_should_skip`
  - [ ] Add `_fetch_groq(api_key: str) -> list[str]`
    - GET `https://api.groq.com/openai/v1/models` with Bearer auth
    - Extract `data[*].id`, prefix each with `groq/` if not already prefixed, filter with `_should_skip`
  - [ ] Add `_fetch_mistral(api_key: str) -> list[str]`
    - GET `https://api.mistral.ai/v1/models` with Bearer auth
    - Extract `data[*].id`, prefix each with `mistral/` if not already prefixed, filter with `_should_skip`
  - [ ] Add `_litellm_fallback(provider_label: str) -> list[str]`
    - Map provider label → litellm provider key
    - Get `litellm.models_by_provider[key]` (a set), convert to sorted list, filter with `_should_skip`
    - Add `groq/` / `mistral/` / `gemini/` prefix where needed
  - [ ] Add `fetch_models_for_provider(provider_label: str, api_key: str) -> list[str]`
    - Dispatch to the correct `_fetch_*` function
    - Catch all exceptions → call `_litellm_fallback` instead
    - Return sorted list (reverse alpha — newest date suffixes float to top), deduplicated

- [ ] **1.2** Write `tests/test_model_fetch.py`
  - [ ] `test_should_skip_embed_model` — `_should_skip("text-embedding-ada-002")` → True
  - [ ] `test_should_skip_tts_model` → True
  - [ ] `test_should_skip_chat_model` — `_should_skip("claude-opus-4-8")` → False
  - [ ] `test_fetch_anthropic_parses_response` — mock `_http_get_json` returning `{"data": [{"id": "claude-opus-4-8"}, {"id": "text-embedding-3-large"}]}` → returns `["claude-opus-4-8"]` only
  - [ ] `test_fetch_openai_filters_non_chat` — response with gpt-4o + dall-e-3 → returns only gpt-4o
  - [ ] `test_fetch_google_formats_prefix` — response `{"models": [{"name": "models/gemini-2.0-flash"}]}` → returns `["gemini/gemini-2.0-flash"]`
  - [ ] `test_fetch_groq_adds_prefix` — response `{"data": [{"id": "llama-3.3-70b-versatile"}]}` → returns `["groq/llama-3.3-70b-versatile"]`
  - [ ] `test_fetch_mistral_adds_prefix` — similar
  - [ ] `test_fetch_models_falls_back_on_error` — patch `_fetch_anthropic` to raise `URLError` → `fetch_models_for_provider` returns non-empty list from fallback
  - [ ] `test_litellm_fallback_returns_filtered_list` — returns a non-empty list for each provider label

### Phase 2 — `config.py`: wire model selection into the wizard

- [ ] **2.1** Update provider labels
  - [ ] Rename `"OpenAI (GPT-4)"` → `"OpenAI"` in `_PROVIDER_CHOICES`
  - [ ] Rename the same in `_PROVIDER_KEY_MAP` (both key and display label)
  - [ ] Update `PROVIDER_PROFILES["openai-primary"]` description comment if any

- [ ] **2.2** Add fetching step to `run_setup_wizard()`
  - [ ] Import `fetch_models_for_provider` from `forge.model_fetch`
  - [ ] After collecting all `keys`, print `"\n[dim]Fetching available models…[/dim]"`
  - [ ] For each `provider` in `selected_providers`:
    - Get the API key from `keys` dict (fall back to `os.environ` if not re-entered)
    - Call `fetch_models_for_provider(provider, api_key)` with a try/except
    - Accumulate results in `all_models: list[str]` (deduplicated, preserve order)
  - [ ] If `all_models` is empty, fall back to DEFAULT_MODELS values and print a warning

- [ ] **2.3** Add per-tier model selection
  - [ ] Define `_TIER_PROMPTS: list[tuple[ModelTier, str]]` — ordered list of `(tier, description)` for the four tiers
  - [ ] For each tier in order (OVERSEER → REASONING → STANDARD → FAST):
    - Compute smart default: pick the first model from the provider that matches the priority (`quality` → highest capability model, `speed`/`cost` → smaller/faster model)
    - Call `questionary.select(description, choices=all_models, default=smart_default)`
    - Store result in `chosen: dict[str, str]` keyed by `tier.value`
  - [ ] Build `ForgeConfig(profile=profile, models=chosen)`

- [ ] **2.4** Update profile auto-selection
  - [ ] Keep the existing profile logic (it becomes just a label/fallback, not the source of models)
  - [ ] If user skips model selection (None returned), keep existing profile defaults

- [ ] **2.5** Update summary print
  - [ ] After saving, print a table showing each tier and its chosen model
  - [ ] Format: `[green]✓[/green] overseer  → claude-opus-4-8`

- [ ] **2.6** Update tests in `tests/test_config.py`
  - [ ] Mock `fetch_models_for_provider` to return a fixed list
  - [ ] Assert chosen models appear in the saved `config.toml`
  - [ ] Assert `"OpenAI"` (not `"OpenAI (GPT-4)"`) appears in `_PROVIDER_CHOICES`

### Phase 3 — validation and full test run

- [ ] **3.1** Run `pytest` — all tests pass
- [ ] **3.2** Run `forge setup` interactively in a terminal to verify the full flow:
  - Provider list shows `"OpenAI"` not `"OpenAI (GPT-4)"`
  - After key entry, spinner shows "Fetching available models…"
  - Four model selects appear, one per tier
  - Selected models appear in `~/.forge/config.toml` under `[models]`
  - `forge build "hello world script"` respects the chosen models

### Phase 4 — Homebrew release

- [ ] **4.1** Bump version in `pyproject.toml`: `0.1.0` → `0.1.1`
- [ ] **4.2** Commit all changes on `feat/dynamic-model-selection`
- [ ] **4.3** Open PR → merge to `main`
- [ ] **4.4** Create and push git tag `v0.1.1`
- [ ] **4.5** Wait for GitHub to publish the `v0.1.1` tarball
- [ ] **4.6** Download tarball, compute `sha256`
- [ ] **4.7** Update `Formula/forge.rb`: `url` → `v0.1.1.tar.gz`, `sha256` → new hash
- [ ] **4.8** Commit formula update, push to `main`
- [ ] **4.9** Run `brew upgrade ddundee/forge/forge` locally and confirm it picks up the new version
- [ ] **4.10** Run `brew test ddundee/forge/forge` — passes
- [ ] **4.11** Confirm `forge setup` flow works end-to-end via Homebrew install
