"""
Ombre-Brain Configuration Loader

Loads ombre_config.yaml and provides typed access to settings.
"""

import os
import yaml
from pathlib import Path
from typing import Optional

# Default config path
DEFAULT_CONFIG_PATH = Path(__file__).parent.parent.parent / "config" / "ombre_config.yaml"


def load_ombre_config(config_path: Optional[str] = None) -> dict:
    """Load Ombre-Brain configuration from YAML file."""
    path = Path(config_path) if config_path else DEFAULT_CONFIG_PATH

    if not path.exists():
        raise FileNotFoundError(f"Ombre config not found: {path}")

    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


# Lazy-loaded config
_config: Optional[dict] = None


def get_ombre_config() -> dict:
    """Get cached Ombre-Brain configuration."""
    global _config
    if _config is None:
        _config = load_ombre_config()
    return _config


def get_storage_dir() -> str:
    """Get Ombre-Brain storage directory."""
    config = get_ombre_config()
    return config.get("storage_dir", "./ombre_brain_storage")


def get_decay_lambda() -> float:
    """Get decay lambda parameter."""
    config = get_ombre_config()
    return config.get("decay", {}).get("lambda", 0.06)


def get_decay_threshold() -> float:
    """Get decay archive threshold."""
    config = get_ombre_config()
    return config.get("decay", {}).get("threshold", 0.3)


def get_scoring_weights() -> dict:
    """Get 4D scoring weights."""
    config = get_ombre_config()
    return config.get("scoring_weights", {
        "topic_relevance": 4.0,
        "emotion_resonance": 2.0,
        "time_proximity": 1.5,
        "importance": 1.0
    })
