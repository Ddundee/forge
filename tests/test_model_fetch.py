import urllib.error
import pytest
from unittest.mock import patch, MagicMock
from forge.model_fetch import (
    _should_skip,
    _fetch_anthropic,
    _fetch_openai,
    _fetch_google,
    _fetch_groq,
    _fetch_mistral,
    _litellm_fallback,
    fetch_models_for_provider,
)


def test_should_skip_embed_model() -> None:
    assert _should_skip("text-embedding-ada-002")


def test_should_skip_tts_model() -> None:
    assert _should_skip("tts-1-hd")


def test_should_skip_image_model() -> None:
    assert _should_skip("dall-e-3")


def test_should_skip_guard_model() -> None:
    assert _should_skip("groq/meta-llama/llama-guard-4-12b")


def test_should_skip_chat_model() -> None:
    assert not _should_skip("claude-opus-4-8")
    assert not _should_skip("gpt-4o")
    assert not _should_skip("gemini/gemini-2.0-flash")


def _mock_http(return_value: dict):
    return patch("forge.model_fetch._http_get_json", return_value=return_value)


def test_fetch_anthropic_parses_response() -> None:
    payload = {
        "data": [
            {"id": "claude-opus-4-8"},
            {"id": "text-embedding-3-large"},
            {"id": "claude-haiku-4-5-20251001"},
        ]
    }
    with _mock_http(payload):
        result = _fetch_anthropic("key")
    assert "claude-opus-4-8" in result
    assert "claude-haiku-4-5-20251001" in result
    assert "text-embedding-3-large" not in result


def test_fetch_openai_filters_non_chat() -> None:
    payload = {
        "data": [
            {"id": "gpt-4o"},
            {"id": "gpt-5"},
            {"id": "gpt-5.5"},
            {"id": "dall-e-3"},
            {"id": "whisper-1"},
            {"id": "o3-mini"},
            {"id": "text-embedding-3-large"},
        ]
    }
    with _mock_http(payload):
        result = _fetch_openai("key")
    assert "gpt-4o" in result
    assert "gpt-5" in result
    assert "gpt-5.5" in result
    assert "o3-mini" in result
    assert "dall-e-3" not in result
    assert "whisper-1" not in result
    assert "text-embedding-3-large" not in result


def test_fetch_google_formats_prefix() -> None:
    payload = {
        "models": [
            {"name": "models/gemini-2.0-flash"},
            {"name": "models/text-bison-001"},
            {"name": "models/gemini-2.5-flash-lite"},
        ]
    }
    with _mock_http(payload):
        result = _fetch_google("key")
    assert "gemini/gemini-2.0-flash" in result
    assert "gemini/gemini-2.5-flash-lite" in result
    assert "gemini/text-bison-001" not in result


def test_fetch_groq_adds_prefix() -> None:
    payload = {
        "data": [
            {"id": "llama-3.3-70b-versatile"},
            {"id": "groq/llama-3.1-8b-instant"},
        ]
    }
    with _mock_http(payload):
        result = _fetch_groq("key")
    assert "groq/llama-3.3-70b-versatile" in result
    assert "groq/llama-3.1-8b-instant" in result


def test_fetch_mistral_adds_prefix() -> None:
    payload = {
        "data": [
            {"id": "mistral-large-latest"},
            {"id": "mistral/codestral-latest"},
        ]
    }
    with _mock_http(payload):
        result = _fetch_mistral("key")
    assert "mistral/mistral-large-latest" in result
    assert "mistral/codestral-latest" in result


def test_fetch_mistral_skips_embed() -> None:
    payload = {"data": [{"id": "mistral-embed"}, {"id": "mistral-large-latest"}]}
    with _mock_http(payload):
        result = _fetch_mistral("key")
    assert "mistral/mistral-large-latest" in result
    assert not any("embed" in m for m in result)


def test_fetch_models_falls_back_on_url_error() -> None:
    with patch("forge.model_fetch._fetch_anthropic", side_effect=urllib.error.URLError("timeout")):
        result = fetch_models_for_provider("Anthropic (Claude)", "bad-key")
    assert len(result) > 0
    assert all("claude" in m for m in result)


def test_fetch_models_falls_back_on_generic_exception() -> None:
    with patch("forge.model_fetch._fetch_openai", side_effect=Exception("503")):
        result = fetch_models_for_provider("OpenAI", "bad-key")
    assert len(result) > 0


def test_fetch_models_falls_back_when_empty_result() -> None:
    with patch("forge.model_fetch._fetch_anthropic", return_value=[]):
        result = fetch_models_for_provider("Anthropic (Claude)", "key")
    assert len(result) > 0


def test_litellm_fallback_anthropic() -> None:
    result = _litellm_fallback("Anthropic (Claude)")
    assert len(result) > 0
    assert all("claude" in m for m in result)


def test_litellm_fallback_openai() -> None:
    result = _litellm_fallback("OpenAI")
    assert len(result) > 0
    assert not any("dall-e" in m for m in result)
    assert not any("embed" in m for m in result)


def test_litellm_fallback_google() -> None:
    result = _litellm_fallback("Google (Gemini)")
    assert len(result) > 0
    assert all("gemini" in m for m in result)


def test_litellm_fallback_groq() -> None:
    result = _litellm_fallback("Groq")
    assert len(result) > 0
    assert all(m.startswith("groq/") for m in result)


def test_litellm_fallback_mistral() -> None:
    result = _litellm_fallback("Mistral")
    assert len(result) > 0
    assert all(m.startswith("mistral/") for m in result)
    assert not any("embed" in m for m in result)


def test_fetch_models_no_api_key_uses_fallback() -> None:
    result = fetch_models_for_provider("Anthropic (Claude)", "")
    assert len(result) > 0
