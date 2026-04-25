from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any

import yaml

import folder_paths


@dataclass
class ControlNetEntry:
    type: str
    model_name: str
    image_name: str
    strength: float = 1.0
    start_percent: float = 0.0
    end_percent: float = 1.0


@dataclass
class Flake:
    name: str
    positive: str = ""
    negative: str = ""
    lora_path: str | None = None
    strength: float = 1.0
    resolution: tuple[int, int] | None = None
    controlnets: list[ControlNetEntry] = field(default_factory=list)
    options: dict[str, dict[str, dict[str, str]]] = field(default_factory=dict)


def _flakes_roots() -> list[str]:
    roots, _ = folder_paths.folder_names_and_paths.get("flakes", ([], set()))
    return list(roots)


def _resolve_file(name: str) -> str:
    for root in _flakes_roots():
        for ext in (".yaml", ".yml"):
            candidate = os.path.join(root, f"{name}{ext}")
            if os.path.isfile(candidate):
                return candidate
    raise FileNotFoundError(f"Flake '{name}' not found under any registered flakes/ directory")


def list_flakes() -> list[str]:
    names: set[str] = set()
    for root in _flakes_roots():
        if not os.path.isdir(root):
            continue
        for dirpath, _, filenames in os.walk(root):
            for fn in filenames:
                stem, ext = os.path.splitext(fn)
                if ext.lower() not in (".yaml", ".yml"):
                    continue
                rel_dir = os.path.relpath(dirpath, root)
                rel = stem if rel_dir in ("", ".") else os.path.join(rel_dir, stem)
                names.add(rel.replace(os.sep, "/"))
    return sorted(names)


def load_flake(name: str) -> Flake:
    path = _resolve_file(name)
    with open(path, encoding="utf-8") as f:
        raw: dict[str, Any] = yaml.safe_load(f) or {}

    prompt = raw.get("prompt") or {}
    resolution = raw.get("resolution")
    if resolution is not None:
        resolution = (int(resolution[0]), int(resolution[1]))

    cns: list[ControlNetEntry] = []
    for cn in raw.get("controlnets") or []:
        cns.append(
            ControlNetEntry(
                type=str(cn.get("type", "")),
                model_name=str(cn["model"]),
                image_name=str(cn["image"]),
                strength=float(cn.get("strength", 1.0)),
                start_percent=float(cn.get("start_percent", 0.0)),
                end_percent=float(cn.get("end_percent", 1.0)),
            )
        )

    return Flake(
        name=name,
        positive=str(prompt.get("positive", "") or ""),
        negative=str(prompt.get("negative", "") or ""),
        lora_path=raw.get("path") or None,
        strength=float(raw.get("strength", 1.0)),
        resolution=resolution,
        controlnets=cns,
        options=raw.get("options") or {},
    )


def resolve(entry: dict[str, Any]) -> Flake:
    """Apply per-entry overrides (strength, option) onto a loaded flake."""
    flake = load_flake(entry["name"])

    if "strength" in entry and entry["strength"] is not None:
        flake.strength = float(entry["strength"])

    selected = entry.get("option") or {}
    for group, choice in selected.items():
        variant = flake.options.get(group, {}).get(choice)
        if not variant:
            continue
        extra_pos = str(variant.get("positive", "") or "")
        extra_neg = str(variant.get("negative", "") or "")
        if extra_pos:
            flake.positive = f"{flake.positive}, {extra_pos}" if flake.positive else extra_pos
        if extra_neg:
            flake.negative = f"{flake.negative}, {extra_neg}" if flake.negative else extra_neg

    return flake


def flake_options(name: str) -> dict[str, list[str]]:
    """Return {option_group: [choice_name, ...]} for the named flake."""
    flake = load_flake(name)
    return {group: list(choices.keys()) for group, choices in flake.options.items()}
