import os
import tomllib
import tomli_w
from dataclasses import dataclass, field
from pathlib import Path
from forge.router import ModelTier, DEFAULT_MODELS

CONFIG_DIR = Path.home() / ".forge"
CONFIG_FILE = CONFIG_DIR / "config.toml"
KEYS_FILE = CONFIG_DIR / "keys.env"

PROVIDER_PROFILES: dict[str, dict[ModelTier, str]] = {
    "claude-primary": {
        ModelTier.OVERSEER: "claude-opus-4-8",
        ModelTier.REASONING: "claude-sonnet-4-6",
        ModelTier.STANDARD: "claude-haiku-4-5-20251001",
        ModelTier.FAST: "claude-haiku-4-5-20251001",
    },
    "openai-primary": {
        ModelTier.OVERSEER: "gpt-4o",
        ModelTier.REASONING: "o3-mini",
        ModelTier.STANDARD: "gpt-4o-mini",
        ModelTier.FAST: "gpt-4o-mini",
    },
    "mixed-cost-optimized": {
        ModelTier.OVERSEER: "claude-sonnet-4-6",
        ModelTier.REASONING: "claude-sonnet-4-6",
        ModelTier.STANDARD: "gemini/gemini-2.0-flash",
        ModelTier.FAST: "gemini/gemini-2.0-flash",
    },
}

_PROVIDER_CHOICES = [
    "Anthropic (Claude)",
    "OpenAI (GPT-4)",
    "Google (Gemini)",
    "Groq",
    "Mistral",
]

_PROVIDER_KEY_MAP: dict[str, tuple[str, str]] = {
    "Anthropic (Claude)": ("ANTHROPIC_API_KEY", "Anthropic API key"),
    "OpenAI (GPT-4)":     ("OPENAI_API_KEY",    "OpenAI API key"),
    "Google (Gemini)":    ("GOOGLE_API_KEY",     "Google API key"),
    "Groq":               ("GROQ_API_KEY",       "Groq API key"),
    "Mistral":            ("MISTRAL_API_KEY",     "Mistral API key"),
}


@dataclass
class ForgeConfig:
    profile: str = "claude-primary"
    models: dict[str, str] = field(default_factory=dict)
    max_cycles: int = 5

    def tier_models(self) -> dict[ModelTier, str]:
        base = dict(PROVIDER_PROFILES.get(self.profile, PROVIDER_PROFILES["claude-primary"]))
        for tier_name, model in self.models.items():
            try:
                base[ModelTier(tier_name)] = model
            except ValueError:
                pass
        return base


def load_config() -> ForgeConfig:
    if not CONFIG_FILE.exists():
        return ForgeConfig()
    with CONFIG_FILE.open("rb") as f:
        data = tomllib.load(f)
    return ForgeConfig(
        profile=data.get("profile", "claude-primary"),
        models=data.get("models", {}),
        max_cycles=data.get("max_cycles", 5),
    )


def save_config(cfg: ForgeConfig) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    with CONFIG_FILE.open("wb") as f:
        tomli_w.dump(
            {"profile": cfg.profile, "models": cfg.models, "max_cycles": cfg.max_cycles}, f
        )


def save_keys(keys: dict[str, str]) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    with KEYS_FILE.open("w") as f:
        for k, v in keys.items():
            f.write(f"{k}={v}\n")
    KEYS_FILE.chmod(0o600)


def load_keys() -> None:
    """Inject saved API keys into os.environ (skips keys already set)."""
    if not KEYS_FILE.exists():
        return
    with KEYS_FILE.open() as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            if key not in os.environ:
                os.environ[key] = value


def run_setup_wizard() -> ForgeConfig:
    import questionary
    from rich.console import Console

    console = Console()
    console.print("\n[bold cyan]Forge Setup[/bold cyan]\n")

    # Priority — single radio select
    priority_choice = questionary.select(
        "What matters most to you?",
        choices=[
            questionary.Choice("Quality  — best output, higher cost", value="quality"),
            questionary.Choice("Speed    — fastest responses",         value="speed"),
            questionary.Choice("Cost     — minimize spend",            value="cost"),
        ],
    ).ask()

    if priority_choice is None:
        raise SystemExit(0)

    # Providers — multi-select checkboxes
    selected_providers: list[str] = questionary.checkbox(
        "Which API providers do you have keys for?",
        choices=_PROVIDER_CHOICES,
    ).ask()

    if selected_providers is None:
        raise SystemExit(0)

    # API keys — password prompt per selected provider
    console.print()
    keys: dict[str, str] = {}
    for provider in selected_providers:
        env_var, label = _PROVIDER_KEY_MAP[provider]
        existing = os.environ.get(env_var, "")
        placeholder = f"(already set, press Enter to keep)" if existing else ""
        entered = questionary.password(
            f"{label} [{env_var}]{' ' + placeholder if placeholder else ''}:"
        ).ask()
        if entered is None:
            raise SystemExit(0)
        if entered:
            keys[env_var] = entered
        elif existing:
            keys[env_var] = existing

    # Recommend a profile
    has_anthropic = "Anthropic (Claude)" in selected_providers
    has_openai    = "OpenAI (GPT-4)"     in selected_providers

    if priority_choice == "cost" and (has_anthropic or "Google (Gemini)" in selected_providers):
        profile = "mixed-cost-optimized"
    elif has_anthropic:
        profile = "claude-primary"
    elif has_openai:
        profile = "openai-primary"
    else:
        profile = "claude-primary"

    cfg = ForgeConfig(profile=profile)
    save_config(cfg)
    if keys:
        save_keys(keys)

    console.print(f"\n[green]✓[/green] Profile: [bold]{profile}[/bold]")
    console.print(f"[dim]Config → {CONFIG_FILE}[/dim]")
    if keys:
        console.print(f"[dim]Keys   → {KEYS_FILE} (mode 600)[/dim]")
    console.print()
    return cfg
