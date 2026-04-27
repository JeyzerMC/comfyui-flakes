from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from typing import Any

import yaml

import folder_paths


_NAME_SEGMENT_RE = re.compile(r"^[A-Za-z0-9_\- ]+$")

# ---------------------------------------------------------------------------
# Preset dataclass
# ---------------------------------------------------------------------------

@dataclass
class ModelPreset:
    name: str
    checkpoint: str = ""
    clip_skip: int = -2
    vae: str | None = None
    steps: int = 20
    cfg: float = 7.0
    sampler: str = "euler"
    scheduler: str = "karras"
    width: int = 1024
    height: int = 1024
    positive: str = ""
    negative: str = ""
    embeddings: list[str] = field(default_factory=list)

# ---------------------------------------------------------------------------
# Flake dataclass + ControlNetEntry
# ---------------------------------------------------------------------------

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

# ---------------------------------------------------------------------------
# Directory helpers
# ---------------------------------------------------------------------------

def _flakes_roots() -> list[str]:
    roots, _ = folder_paths.folder_names_and_paths.get("flakes", ([], set()))
    return list(roots)


def _primary_root() -> str:
    roots = _flakes_roots()
    if not roots:
        raise RuntimeError("no flakes roots configured")
    return roots[0]


def _presets_roots() -> list[str]:
    roots, _ = folder_paths.folder_names_and_paths.get("model_presets", ([], set()))
    return list(roots)


def _primary_presets_root() -> str:
    roots = _presets_roots()
    if not roots:
        raise RuntimeError("no model_presets roots configured")
    return roots[0]


def _validate_name(name: str) -> None:
    if not isinstance(name, str) or not name:
        raise ValueError("flake name is required")
    if len(name) > 200:
        raise ValueError("flake name too long (max 200 chars)")
    if "\\" in name:
        raise ValueError("backslashes are not allowed; use '/' as the separator")
    if name.startswith("/") or name.endswith("/"):
        raise ValueError("flake name cannot start or end with '/'")
    for segment in name.split("/"):
        if segment in ("", ".", ".."):
            raise ValueError(f"invalid path segment: {segment!r}")
        if not _NAME_SEGMENT_RE.match(segment):
            raise ValueError(f"segment {segment!r} contains disallowed characters")


def _ensure_inside(path: str, root: str) -> None:
    real_path = os.path.realpath(path)
    real_root = os.path.realpath(root)
    if os.path.commonpath([real_path, real_root]) != real_root:
        raise ValueError("path resolves outside the flakes root")

# ---------------------------------------------------------------------------
# Flake file resolution
# ---------------------------------------------------------------------------

def _resolve_file(name: str) -> str:
    _validate_name(name)
    for root in _flakes_roots():
        for ext in (".yaml", ".yml"):
            candidate = os.path.join(root, f"{name}{ext}")
            if os.path.isfile(candidate):
                _ensure_inside(candidate, root)
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


def list_dirs() -> list[str]:
    dirs: set[str] = set()
    for root in _flakes_roots():
        if not os.path.isdir(root):
            continue
        for dirpath, dirnames, _ in os.walk(root):
            for d in dirnames:
                full = os.path.join(dirpath, d)
                rel = os.path.relpath(full, root).replace(os.sep, "/")
                dirs.add(rel)
    return sorted(dirs)

# ---------------------------------------------------------------------------
# Flake CRUD
# ---------------------------------------------------------------------------

def read_flake_raw(name: str) -> dict[str, Any]:
    path = _resolve_file(name)
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def save_flake(name: str, data: dict[str, Any]) -> None:
    if not isinstance(data, dict):
        raise ValueError("flake data must be an object")
    _validate_name(name)

    try:
        path = _resolve_file(name)
    except FileNotFoundError:
        root = _primary_root()
        path = os.path.join(root, f"{name}.yaml")
        _ensure_inside(path, root)

    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        yaml.safe_dump(data, f, sort_keys=False, allow_unicode=True)


def delete_flake(name: str) -> None:
    path = _resolve_file(name)
    os.remove(path)
    _delete_cover(name)


def _flake_from_raw(name: str, raw: dict[str, Any]) -> Flake:
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


def load_flake(name: str) -> Flake:
    path = _resolve_file(name)
    with open(path, encoding="utf-8") as f:
        raw: dict[str, Any] = yaml.safe_load(f) or {}
    return _flake_from_raw(name, raw)


def resolve(entry: dict[str, Any]) -> Flake:
    if entry.get("inline"):
        flake = _flake_from_raw("__inline__", entry.get("content") or {})
    else:
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
    flake = load_flake(name)
    return {group: list(choices.keys()) for group, choices in flake.options.items()}

# ---------------------------------------------------------------------------
# Cover image helpers
# ---------------------------------------------------------------------------

_COVER_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp", ".gif")


def _cover_path(name: str, ext: str | None = None) -> str | None:
    """Find the cover file for a given flake name. If *ext* is given, return
    the exact path for that extension; otherwise scan for any supported ext."""
    for root in _flakes_roots():
        if ext:
            candidate = os.path.join(root, f"{name}{ext}")
            try:
                _ensure_inside(candidate, root)
            except ValueError:
                continue
            if os.path.isfile(candidate):
                return candidate
        else:
            for e in _COVER_EXTENSIONS:
                candidate = os.path.join(root, f"{name}{e}")
                try:
                    _ensure_inside(candidate, root)
                except ValueError:
                    continue
                if os.path.isfile(candidate):
                    return candidate
    return None


def _delete_cover(name: str) -> None:
    path = _cover_path(name)
    if path:
        os.remove(path)


def save_cover(name: str, ext: str, data: bytes) -> None:
    """Save a cover image alongside the flake YAML."""
    _validate_name(name)
    ext_lower = ext.lower()
    if ext_lower not in _COVER_EXTENSIONS:
        raise ValueError(f"unsupported cover extension: {ext}")

    # Remove any existing cover with a different extension
    _delete_cover(name)

    # Place in primary root
    root = _primary_root()
    path = os.path.join(root, f"{name}{ext_lower}")
    _ensure_inside(path, root)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)


def read_cover(name: str) -> tuple[bytes, str] | None:
    """Return (data, mime_type) or None if no cover exists."""
    path = _cover_path(name)
    if not path:
        return None
    ext = os.path.splitext(path)[1].lower()
    mime_map = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".gif": "image/gif",
    }
    mime = mime_map.get(ext, "application/octet-stream")
    with open(path, "rb") as f:
        return f.read(), mime

# ---------------------------------------------------------------------------
# Preset helpers
# ---------------------------------------------------------------------------

def _resolve_preset_file(name: str) -> str:
    _validate_name(name)
    for root in _presets_roots():
        for ext in (".yaml", ".yml"):
            candidate = os.path.join(root, f"{name}{ext}")
            if os.path.isfile(candidate):
                _ensure_inside(candidate, root)
                return candidate
    raise FileNotFoundError(f"Preset '{name}' not found under any registered model_presets/ directory")


def list_presets() -> list[str]:
    names: set[str] = set()
    for root in _presets_roots():
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


def read_preset_raw(name: str) -> dict[str, Any]:
    path = _resolve_preset_file(name)
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def save_preset(name: str, data: dict[str, Any]) -> None:
    if not isinstance(data, dict):
        raise ValueError("preset data must be an object")
    _validate_name(name)

    try:
        path = _resolve_preset_file(name)
    except FileNotFoundError:
        root = _primary_presets_root()
        path = os.path.join(root, f"{name}.yaml")
        _ensure_inside(path, root)

    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        yaml.safe_dump(data, f, sort_keys=False, allow_unicode=True)


def delete_preset(name: str) -> None:
    path = _resolve_preset_file(name)
    os.remove(path)


def load_preset(name: str) -> ModelPreset:
    raw = read_preset_raw(name)
    prompt = raw.get("prompt") or {}
    return ModelPreset(
        name=name,
        checkpoint=str(raw.get("checkpoint", "")),
        clip_skip=int(raw.get("clip_skip", -2)),
        vae=raw.get("vae") or None,
        steps=int(raw.get("steps", 20)),
        cfg=float(raw.get("cfg", 7.0)),
        sampler=str(raw.get("sampler", "euler")),
        scheduler=str(raw.get("scheduler", "karras")),
        width=int(raw.get("width", 1024)),
        height=int(raw.get("height", 1024)),
        positive=str(prompt.get("positive", "") or ""),
        negative=str(prompt.get("negative", "") or ""),
        embeddings=list(raw.get("embeddings") or []),
    )
