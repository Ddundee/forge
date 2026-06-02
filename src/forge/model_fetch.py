import json
import urllib.error
import urllib.request
import litellm

_CHAT_SKIP_PATTERNS: tuple[str, ...] = (
    "embed",
    "tts",
    "whisper",
    "dall-e",
    "-audio",
    "native-audio",
    "-image",
    "gpt-image",
    "chatgpt-image",
    "guard",
    "-instruct",
    "babbage",
    "davinci",
    "curie",
    "-ada-",
    "-live-",
    "deep-research",
    "computer-use",
    "256-x-",
    "512-x-",
    "1024-x-",
    "1536-x-",
)

_PROVIDER_LABEL_TO_LITELLM: dict[str, str] = {
    "Anthropic (Claude)": "anthropic",
    "OpenAI": "openai",
    "Google (Gemini)": "gemini",
    "Groq": "groq",
    "Mistral": "mistral",
}

# Used only for the litellm fallback, which is noisy.
# Live API fetch uses _should_skip alone (the API is already curated).
_OPENAI_LITELLM_PREFIXES: tuple[str, ...] = (
    "gpt-",
    "o1",
    "o2",
    "o3",
    "o4",
    "o5",
    "chatgpt-",
)


def _should_skip(model_id: str) -> bool:
    lowered = model_id.lower()
    return any(pat in lowered for pat in _CHAT_SKIP_PATTERNS)


def _http_get_json(url: str, headers: dict[str, str]) -> dict:
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=8) as resp:
        return json.loads(resp.read().decode())


def _fetch_anthropic(api_key: str) -> list[str]:
    data = _http_get_json(
        "https://api.anthropic.com/v1/models",
        {"x-api-key": api_key, "anthropic-version": "2023-06-01"},
    )
    models = [
        item["id"]
        for item in data.get("data", [])
        if item.get("id", "").startswith("claude") and not _should_skip(item["id"])
    ]
    return sorted(set(models), reverse=True)


def _fetch_openai(api_key: str) -> list[str]:
    data = _http_get_json(
        "https://api.openai.com/v1/models",
        {"Authorization": f"Bearer {api_key}"},
    )
    models = [
        item["id"]
        for item in data.get("data", [])
        if not _should_skip(item.get("id", ""))
    ]
    return sorted(set(models), reverse=True)


def _fetch_google(api_key: str) -> list[str]:
    data = _http_get_json(
        f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}",
        {},
    )
    models = []
    for item in data.get("models", []):
        raw = item.get("name", "")
        if not raw.startswith("models/gemini"):
            continue
        name = "gemini/" + raw.removeprefix("models/")
        if not _should_skip(name):
            models.append(name)
    return sorted(set(models), reverse=True)


def _fetch_groq(api_key: str) -> list[str]:
    data = _http_get_json(
        "https://api.groq.com/openai/v1/models",
        {"Authorization": f"Bearer {api_key}"},
    )
    models = []
    for item in data.get("data", []):
        mid = item.get("id", "")
        if _should_skip(mid):
            continue
        prefixed = mid if mid.startswith("groq/") else f"groq/{mid}"
        models.append(prefixed)
    return sorted(set(models), reverse=True)


def _fetch_mistral(api_key: str) -> list[str]:
    data = _http_get_json(
        "https://api.mistral.ai/v1/models",
        {"Authorization": f"Bearer {api_key}"},
    )
    models = []
    for item in data.get("data", []):
        mid = item.get("id", "")
        if _should_skip(mid):
            continue
        prefixed = mid if mid.startswith("mistral/") else f"mistral/{mid}"
        models.append(prefixed)
    return sorted(set(models), reverse=True)


def _litellm_fallback(provider_label: str) -> list[str]:
    key = _PROVIDER_LABEL_TO_LITELLM.get(provider_label, "")
    raw: set[str] = litellm.models_by_provider.get(key, set())

    prefix_map: dict[str, str] = {
        "groq": "groq/",
        "mistral": "mistral/",
        "gemini": "gemini/",
    }
    prefix = prefix_map.get(key, "")

    models = []
    for mid in raw:
        if _should_skip(mid):
            continue
        if prefix and not mid.startswith(prefix):
            mid = prefix + mid
        if key == "openai" and not any(mid.startswith(p) for p in _OPENAI_LITELLM_PREFIXES):
            continue
        if key == "anthropic" and not mid.startswith("claude"):
            continue
        models.append(mid)

    return sorted(set(models), reverse=True)


_FETCHERS = {
    "Anthropic (Claude)": _fetch_anthropic,
    "OpenAI": _fetch_openai,
    "Google (Gemini)": _fetch_google,
    "Groq": _fetch_groq,
    "Mistral": _fetch_mistral,
}


def fetch_models_for_provider(provider_label: str, api_key: str) -> list[str]:
    fetcher = _FETCHERS.get(provider_label)
    if fetcher and api_key:
        try:
            result = fetcher(api_key)
            if result:
                return result
        except Exception:
            pass
    return _litellm_fallback(provider_label)
