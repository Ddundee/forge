import pytest
from pathlib import Path
from forge.config import ForgeConfig, load_config, save_config, PROVIDER_PROFILES
from forge.router import ModelTier


def test_default_config() -> None:
    cfg = ForgeConfig()
    assert cfg.profile == "claude-primary"
    assert cfg.max_cycles == 5


def test_tier_models_from_profile() -> None:
    cfg = ForgeConfig(profile="openai-primary")
    models = cfg.tier_models()
    assert models[ModelTier.OVERSEER] == "gpt-4o"


def test_tier_models_override() -> None:
    cfg = ForgeConfig(profile="claude-primary", models={"overseer": "gpt-4o"})
    models = cfg.tier_models()
    assert models[ModelTier.OVERSEER] == "gpt-4o"
    # Other tiers still from profile
    assert "haiku" in models[ModelTier.STANDARD]


def test_save_and_load_config(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("forge.config.CONFIG_FILE", tmp_path / "config.toml")
    monkeypatch.setattr("forge.config.CONFIG_DIR", tmp_path)
    cfg = ForgeConfig(profile="openai-primary", max_cycles=3)
    save_config(cfg)
    loaded = load_config()
    assert loaded.profile == "openai-primary"
    assert loaded.max_cycles == 3


def test_load_config_returns_default_when_missing(tmp_path: Path,
                                                   monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("forge.config.CONFIG_FILE", tmp_path / "nonexistent.toml")
    cfg = load_config()
    assert cfg.profile == "claude-primary"


def test_provider_choices_no_gpt4_label() -> None:
    from forge.config import _PROVIDER_CHOICES
    assert "OpenAI" in _PROVIDER_CHOICES
    assert not any("GPT-4" in c for c in _PROVIDER_CHOICES)


def test_smart_default_quality_picks_capable_model() -> None:
    from forge.config import _smart_default
    models = ["gpt-4o-mini", "gpt-4o", "o3"]
    assert _smart_default(models, "quality") != "gpt-4o-mini"


def test_smart_default_cost_picks_fast_model() -> None:
    from forge.config import _smart_default
    models = ["gpt-4o", "gpt-4o-mini", "o3"]
    result = _smart_default(models, "cost")
    assert "mini" in result


def test_smart_default_returns_first_when_no_match() -> None:
    from forge.config import _smart_default
    models = ["model-a", "model-b"]
    assert _smart_default(models, "quality") == "model-a"


def test_models_saved_to_config(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("forge.config.CONFIG_FILE", tmp_path / "config.toml")
    monkeypatch.setattr("forge.config.CONFIG_DIR", tmp_path)
    cfg = ForgeConfig(
        profile="claude-primary",
        models={"overseer": "claude-opus-4-8", "reasoning": "claude-sonnet-4-6"},
    )
    save_config(cfg)
    loaded = load_config()
    assert loaded.models["overseer"] == "claude-opus-4-8"
    assert loaded.models["reasoning"] == "claude-sonnet-4-6"
