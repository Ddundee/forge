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
