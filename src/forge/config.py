import tomllib
import tomli_w
from dataclasses import dataclass, field
from pathlib import Path
from forge.router import ModelTier, DEFAULT_MODELS

CONFIG_DIR = Path.home() / ".forge"
CONFIG_FILE = CONFIG_DIR / "config.toml"

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


def run_setup_wizard() -> ForgeConfig:
    from rich.console import Console
    from rich.prompt import Prompt

    console = Console()
    console.print("\n[bold cyan]Forge Setup[/bold cyan]\n")
    console.print("What matters most? (comma-separated: speed, cost, quality)")
    priorities_raw = Prompt.ask("Priorities", default="quality")
    priorities = {p.strip().lower() for p in priorities_raw.split(",")}

    console.print("\nWhich API providers do you have keys for? (comma-separated)")
    console.print("  anthropic, openai, google, groq, mistral")
    keys_raw = Prompt.ask("Providers", default="anthropic")
    has_keys = {k.strip().lower() for k in keys_raw.split(",")}

    if "quality" in priorities:
        profile = "claude-primary" if "anthropic" in has_keys else "openai-primary"
    elif "cost" in priorities:
        profile = "mixed-cost-optimized"
    else:
        profile = "claude-primary" if "anthropic" in has_keys else "openai-primary"

    cfg = ForgeConfig(profile=profile)
    save_config(cfg)
    console.print(f"\n[green]✓[/green] Profile: [bold]{profile}[/bold]")
    console.print(f"Saved to {CONFIG_FILE}\n")
    return cfg
