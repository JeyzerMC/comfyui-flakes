from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from typing import Any

import yaml

import folder_paths


_NAME_SEGMENT_RE = re.compile(r"^[A-Za-z0-9_\- ]+$")

_FAMILY_MAP = {
    "SDXL/Base": "sdxl",
    "SDXL/Illustrious": "illustrious",
    "SDXL/Pony": "pony",
    "ZImage/Base": "zib",
    "ZImage/Turbo": "zit",
    "Common": "common",
}

_FAMILY_COMPAT = {
    "SDXL/Base": {"common", "sdxl"},
    "SDXL/Illustrious": {"common", "sdxl", "illustrious"},
    "SDXL/Pony": {"common", "sdxl", "pony"},
    "ZImage/Base": {"common", "zib"},
    "ZImage/Turbo": {"common", "zit"},
}


# ---------------------------------------------------------------------------
# Preset dataclass
# ---------------------------------------------------------------------------

@dataclass
class ModelPreset:
    name: str
    checkpoint: str = ""
    checkpoint_url: str = ""
    clip_skip: int = -2
    vae: str | None = None
    steps: int = 20
    cfg: float = 4.0
    sampler: str = "dpmpp_2m"
    scheduler: str = "karras"
    width: int = 832
    height: int = 1216
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
class LoraEntry:
    name: str = ""
    url: str = ""
    path: str = ""
    strength: float = 1.0


@dataclass
class Flake:
    name: str
    positive: str = ""
    negative: str = ""
    loras: list[LoraEntry] = field(default_factory=list)
    lora_path: str | None = None  # legacy single LoRA
    strength: float = 1.0  # legacy single LoRA strength
    resolution: tuple[int, int] | None = None
    controlnets: list[ControlNetEntry] = field(default_factory=list)
    options: dict[str, dict[str, dict[str, str]]] = field(default_factory=dict)
    output_stem: str | None = None

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


def _family_folder(family: str | None) -> str | None:
    return _FAMILY_MAP.get(family) if family else None


def _is_flake_compatible(path: str, family: str | None) -> bool:
    if not family:
        return True
    compat = _FAMILY_COMPAT.get(family)
    if not compat:
        return True
    parts = path.replace("\\", "/").split("/")
    if parts[0] != "img":
        # Legacy paths (no img/ prefix) are compatible with all SDXL families
        return family.startswith("SDXL")
    if len(parts) >= 2 and parts[1] in compat:
        return True
    return False


def _is_preset_compatible(path: str, family: str | None) -> bool:
    if not family:
        return True
    compat = _FAMILY_COMPAT.get(family)
    if not compat:
        return True
    parts = path.replace("\\", "/").split("/")
    if not parts or parts[0] == "":
        return True
    if parts[0] in compat:
        return True
    return False

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


def list_flakes(family: str | None = None) -> list[str]:
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
                rel_norm = rel.replace(os.sep, "/")
                # Exclude model_presets from flake listings
                if rel_norm.startswith("model_presets/") or rel_norm == "model_presets":
                    continue
                if family is None or _is_flake_compatible(rel_norm, family):
                    names.add(rel_norm)
    return sorted(names)


def list_dirs(family: str | None = None) -> list[str]:
    dirs: set[str] = set()
    for root in _flakes_roots():
        if not os.path.isdir(root):
            continue
        for dirpath, dirnames, _ in os.walk(root):
            for d in dirnames:
                full = os.path.join(dirpath, d)
                rel = os.path.relpath(full, root).replace(os.sep, "/")
                # Exclude model_presets from flake directory listings
                if rel.startswith("model_presets/") or rel == "model_presets":
                    continue
                if family is None or _is_flake_compatible(rel + "/dummy", family):
                    dirs.add(rel)
    return sorted(dirs)

# ---------------------------------------------------------------------------
# Flake CRUD
# ---------------------------------------------------------------------------

def read_flake_raw(name: str) -> dict[str, Any]:
    path = _resolve_file(name)
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def save_flake(name: str, data: dict[str, Any], family: str | None = None) -> None:
    if not isinstance(data, dict):
        raise ValueError("flake data must be an object")
    _validate_name(name)

    folder = _family_folder(family)
    if folder:
        name = f"img/{folder}/{name}"

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

    # Parse LoRAs: new multi-LoRA format takes precedence
    loras: list[LoraEntry] = []
    if raw.get("loras"):
        for lr in raw["loras"]:
            loras.append(
                LoraEntry(
                    name=str(lr.get("name", "")),
                    url=str(lr.get("url", "")),
                    path=str(lr.get("path", "")),
                    strength=float(lr.get("strength", 1.0)),
                )
            )
    elif raw.get("path"):
        # Legacy single LoRA
        loras.append(
            LoraEntry(
                name="",
                url="",
                path=str(raw["path"]),
                strength=float(raw.get("strength", 1.0)),
            )
        )

    return Flake(
        name=name,
        positive=str(prompt.get("positive", "") or ""),
        negative=str(prompt.get("negative", "") or ""),
        loras=loras,
        lora_path=raw.get("path") or None,
        strength=float(raw.get("strength", 1.0)),
        resolution=resolution,
        controlnets=cns,
        options=raw.get("options") or {},
        output_stem=raw.get("output_stem") or None,
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

    # Legacy single LoRA strength override
    if "strength" in entry and entry["strength"] is not None:
        flake.strength = float(entry["strength"])
        if flake.loras:
            flake.loras[0].strength = flake.strength

    # Multi-LoRA strength overrides
    entry_loras = entry.get("loras")
    if isinstance(entry_loras, list):
        for i, override in enumerate(entry_loras):
            if i < len(flake.loras) and override is not None:
                flake.loras[i].strength = float(override)

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


def list_presets(family: str | None = None) -> list[str]:
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
                rel_norm = rel.replace(os.sep, "/")
                if family is None or _is_preset_compatible(rel_norm, family):
                    names.add(rel_norm)
    return sorted(names)


def read_preset_raw(name: str) -> dict[str, Any]:
    path = _resolve_preset_file(name)
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def save_preset(name: str, data: dict[str, Any], family: str | None = None) -> None:
    if not isinstance(data, dict):
        raise ValueError("preset data must be an object")
    _validate_name(name)

    folder = _family_folder(family)
    if folder:
        name = f"{folder}/{name}"

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
    _delete_preset_cover(name)


def _preset_cover_path(name: str, ext: str | None = None) -> str | None:
    """Find the cover file for a given preset name."""
    for root in _presets_roots():
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


def _delete_preset_cover(name: str) -> None:
    path = _preset_cover_path(name)
    if path:
        os.remove(path)


def save_preset_cover(name: str, ext: str, data: bytes) -> None:
    """Save a cover image alongside the preset YAML."""
    _validate_name(name)
    ext_lower = ext.lower()
    if ext_lower not in _COVER_EXTENSIONS:
        raise ValueError(f"unsupported cover extension: {ext}")
    _delete_preset_cover(name)
    root = _primary_presets_root()
    path = os.path.join(root, f"{name}{ext_lower}")
    _ensure_inside(path, root)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)


def read_preset_cover(name: str) -> tuple[bytes, str] | None:
    """Return (data, mime_type) or None if no cover exists."""
    path = _preset_cover_path(name)
    if not path:
        # Fallback: use the sibling image next to the preset's checkpoint
        try:
            preset = load_preset(name)
            if preset.checkpoint:
                ckpt_path = folder_paths.get_full_path("checkpoints", preset.checkpoint)
                if ckpt_path and os.path.isfile(ckpt_path):
                    dir_path = os.path.dirname(ckpt_path)
                    basename = os.path.splitext(os.path.basename(ckpt_path))[0]
                    mime_map = {
                        ".png": "image/png",
                        ".jpg": "image/jpeg",
                        ".jpeg": "image/jpeg",
                        ".webp": "image/webp",
                        ".gif": "image/gif",
                    }
                    for ext in _COVER_EXTENSIONS:
                        sibling = os.path.join(dir_path, basename + ext)
                        if os.path.isfile(sibling):
                            mime = mime_map.get(ext, "application/octet-stream")
                            with open(sibling, "rb") as f:
                                return f.read(), mime
        except Exception:
            pass
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


def load_preset(name: str) -> ModelPreset:
    raw = read_preset_raw(name)
    prompt = raw.get("prompt") or {}
    return ModelPreset(
        name=name,
        checkpoint=str(raw.get("checkpoint", "")),
        checkpoint_url=str(raw.get("checkpoint_url", "")),
        clip_skip=int(raw.get("clip_skip", -2)),
        vae=raw.get("vae") or None,
        steps=int(raw.get("steps", 20)),
        cfg=float(raw.get("cfg", 4.0)),
        sampler=str(raw.get("sampler", "dpmpp_2m")),
        scheduler=str(raw.get("scheduler", "karras")),
        width=int(raw.get("width", 832)),
        height=int(raw.get("height", 1216)),
        positive=str(prompt.get("positive", "") or ""),
        negative=str(prompt.get("negative", "") or ""),
        embeddings=list(raw.get("embeddings") or []),
    )
