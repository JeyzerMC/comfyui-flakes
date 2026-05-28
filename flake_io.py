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

_FAMILY_FROM_FOLDER = {v: k for k, v in _FAMILY_MAP.items()}


# ---------------------------------------------------------------------------
# Preset dataclass
# ---------------------------------------------------------------------------

@dataclass
class ModelPreset:
    name: str
    display_name: str = ""
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
    text_encoder: str | None = None
    positive: str = ""
    negative: str = ""
    embeddings: list[str] = field(default_factory=list)
    filename_prefix: str = ""

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
class FlakeLink:
    """Reference to another flake with optional default overrides (#232).

    Persisted on a flake yaml as ``flake_link``. When the host flake is
    applied to a stack/combo, the linked flake's loras + prompts + variant
    contributions are also applied (after the host's). Each grid placement
    of the host can further override the linked flake's variant choices and
    lora strengths via the entry's ``flake_link_override`` payload.
    """
    target: str
    variant: dict[str, str] = field(default_factory=dict)
    lora_strengths: list[float | None] = field(default_factory=list)


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
    variants: dict[str, dict[str, dict[str, str]]] = field(default_factory=dict)
    output_stem: str | None = None
    flake_link: FlakeLink | None = None

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


def infer_preset_family(path: str) -> str | None:
    parts = path.replace("\\", "/").split("/")
    if parts[0] == "img" and len(parts) >= 2 and parts[1] in _FAMILY_FROM_FOLDER:
        return _FAMILY_FROM_FOLDER[parts[1]]
    if len(parts) >= 2 and parts[0] in _FAMILY_FROM_FOLDER:
        return _FAMILY_FROM_FOLDER[parts[0]]
    return None


def strip_preset_prefix(path: str) -> str:
    parts = path.replace("\\", "/").split("/")
    if parts[0] == "img" and len(parts) >= 3 and parts[1] in _FAMILY_FROM_FOLDER:
        return "/".join(parts[2:])
    if len(parts) >= 2 and parts[0] in _FAMILY_FROM_FOLDER:
        return "/".join(parts[1:])
    return path


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
    if parts[0] == "img" and len(parts) >= 2:
        return parts[1] in compat
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


def list_flake_display_names(family: str | None = None) -> dict[str, str]:
    names = list_flakes(family=family)
    display_names: dict[str, str] = {}
    for name in names:
        try:
            raw = read_flake_raw(name)
            dn = raw.get("name") or ""
            if dn:
                display_names[name] = dn
        except Exception:
            pass
    return display_names


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
        data = yaml.safe_load(f) or {}
    # Hide stray top-level `path` / `strength` from callers when the modern
    # `loras:` list is present; they are leftover from an old save bug.
    if isinstance(data, dict) and "loras" in data:
        data.pop("path", None)
        data.pop("strength", None)
    return data


def save_flake(
    name: str,
    data: dict[str, Any],
    family: str | None = None,
    base_root_index: int | None = None,
    output_path: str | None = None,
    old_name: str | None = None,
) -> str:
    """Persist ``data`` to ``<root>/<name>.yaml`` and return the resolved name
    that callers should use to reference the flake.

    See :func:`save_preset` for the role of ``base_root_index`` /
    ``output_path`` / ``old_name``.
    """
    if not isinstance(data, dict):
        raise ValueError("flake data must be an object")

    # Drop stray top-level `path` / `strength` keys that leaked from a previous
    # single-LoRA representation. They are redundant with `loras[].path/strength`.
    if "loras" in data:
        data.pop("path", None)
        data.pop("strength", None)

    # Migrate legacy `options:` key to `variants:` (one-way; reads remain
    # backwards compatible via _flake_from_raw).
    if "options" in data and "variants" not in data:
        data["variants"] = data.pop("options")

    roots = _flakes_roots()
    if base_root_index is not None:
        if base_root_index < 0 or base_root_index >= len(roots):
            raise ValueError(f"invalid base_root_index: {base_root_index}")
        root = roots[base_root_index]
    else:
        root = _primary_root()

    if output_path:
        canonical = output_path.replace("\\", "/").strip("/")
        _validate_name(canonical)
    else:
        _validate_name(name)
        folder = _family_folder(family)
        if folder and not name.replace("\\", "/").startswith(f"img/{folder}/"):
            canonical = f"img/{folder}/{name}"
        else:
            canonical = name

    target = os.path.join(root, f"{canonical}.yaml")
    _ensure_inside(target, root)
    os.makedirs(os.path.dirname(target), exist_ok=True)

    # Move existing files if the location changed
    if old_name and old_name != canonical:
        try:
            old_yaml = _resolve_file(old_name)
        except (FileNotFoundError, ValueError):
            old_yaml = None
        if old_yaml and os.path.realpath(old_yaml) != os.path.realpath(target):
            try:
                os.remove(old_yaml)
            except OSError:
                pass
            old_cover = _cover_path(old_name)
            if old_cover:
                cover_ext = os.path.splitext(old_cover)[1].lower()
                new_cover_dir = os.path.dirname(target)
                new_cover = os.path.join(new_cover_dir, f"{os.path.basename(canonical)}{cover_ext}")
                try:
                    os.replace(old_cover, new_cover)
                except OSError:
                    pass

    with open(target, "w", encoding="utf-8") as f:
        yaml.safe_dump(data, f, sort_keys=False, allow_unicode=True)
    return canonical


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
        model_name = str(cn.get("model", ""))
        if not model_name.strip():
            print(f"[flakes] skipping controlnet entry with empty model_name")
            continue
        cns.append(
            ControlNetEntry(
                type=str(cn.get("type", "")),
                model_name=model_name,
                image_name=str(cn.get("image", "")),
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

    # Parse flake_link (#232) — defaults stored on the host yaml. Optional.
    link_obj = None
    link_raw = raw.get("flake_link")
    if isinstance(link_raw, dict) and link_raw.get("target"):
        link_obj = FlakeLink(
            target=str(link_raw["target"]),
            variant={str(g): str(c) for g, c in (link_raw.get("variant") or {}).items() if c},
            lora_strengths=[
                (float(s) if isinstance(s, (int, float)) else None)
                for s in (link_raw.get("lora_strengths") or [])
            ],
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
        variants=raw.get("variants") or raw.get("options") or {},
        output_stem=raw.get("output_stem") or None,
        flake_link=link_obj,
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

    selected = entry.get("variant") or entry.get("option") or {}
    for group, choice in selected.items():
        variant = flake.variants.get(group, {}).get(choice)
        if not variant:
            continue
        extra_pos = str(variant.get("positive", "") or "")
        extra_neg = str(variant.get("negative", "") or "")
        if extra_pos:
            flake.positive = f"{flake.positive}, {extra_pos}" if flake.positive else extra_pos
        if extra_neg:
            flake.negative = f"{flake.negative}, {extra_neg}" if flake.negative else extra_neg
        variant_stem = variant.get("output_stem")
        if variant_stem:
            if flake.output_stem:
                flake.output_stem = f"{flake.output_stem.rstrip('/')}/{variant_stem.lstrip('/')}"
            else:
                flake.output_stem = variant_stem

    # Runtime output_stem override from the option panel (not persisted to disk)
    if "_output_stem_override" in entry:
        flake.output_stem = entry["_output_stem_override"] or None

    # ── Flake link resolution (#232) ──────────────────────────────────────
    # If this flake declares a flake_link, also apply the linked flake's
    # contributions (loras + prompts + variant prompts) after the host's.
    # Cycle protection: pass a visited set so a chain can't loop forever.
    _apply_flake_link(flake, entry, _visited=None)

    return flake


def _apply_flake_link(host: "Flake", entry: dict[str, Any], _visited: set[str] | None = None) -> None:
    """Apply the host flake's ``flake_link`` (if any) by resolving the linked
    flake with merged overrides and appending its loras + prompts.

    Override precedence (highest wins):
      1. Per-grid placement override (entry["flake_link_override"])
      2. Host yaml flake_link.variant / .lora_strengths
      3. Linked flake's own defaults
    """
    link = host.flake_link
    if not link or not link.target:
        return

    _visited = set(_visited or [])
    if link.target in _visited:
        return  # cycle guard
    _visited.add(host.name)

    # Build the effective entry for the linked flake.
    grid_override = entry.get("flake_link_override") or {}
    link_variant = dict(link.variant)
    link_variant.update({str(k): str(v) for k, v in (grid_override.get("variant") or {}).items() if v})

    # Strengths: each override slot is either a number (override) or None (use link default).
    link_strengths = list(link.lora_strengths)
    for i, s in enumerate(grid_override.get("lora_strengths") or []):
        if s is None:
            continue
        if i >= len(link_strengths):
            link_strengths.extend([None] * (i - len(link_strengths) + 1))
        link_strengths[i] = float(s)

    linked_entry = {
        "name": link.target,
        "variant": link_variant,
    }
    # Translate the link's lora_strengths into the entry's `loras` override
    # (only set slots that have an explicit value; leave others None so they
    # fall back to the linked flake's own default).
    if link_strengths:
        linked_entry["loras"] = link_strengths

    try:
        linked = resolve(linked_entry)
    except FileNotFoundError:
        # Missing linked flake — log via a print so it surfaces in the server
        # log without taking a logging dep here.
        print(f"[flakes] flake_link target not found: {link.target} (host: {host.name})")
        return

    # Append linked flake's loras to host's list.
    for lr in linked.loras:
        host.loras.append(lr)

    # Append prompts (after host's, comma-joined like the existing variant logic).
    if linked.positive:
        host.positive = f"{host.positive}, {linked.positive}" if host.positive else linked.positive
    if linked.negative:
        host.negative = f"{host.negative}, {linked.negative}" if host.negative else linked.negative


def flake_variants(name: str) -> dict[str, list[str]]:
    flake = load_flake(name)
    return {group: list(choices.keys()) for group, choices in flake.variants.items()}


# Backwards-compatible alias
flake_options = flake_variants

# ---------------------------------------------------------------------------
# Cover image helpers
# ---------------------------------------------------------------------------

_COVER_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp", ".gif")

_COVER_MIME_MAP = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
}


def _resolve_cover_source(cover_source: str) -> tuple[bytes, str] | None:
    """Resolve a ``cover_image`` string from a flake/preset YAML to raw bytes.

    The value can either be a direct image path under the LoRA tree
    (preferred) or — for legacy flakes — a ``.safetensors`` path whose
    sibling image we fall back to.
    """
    direct = folder_paths.get_full_path("loras", cover_source)
    if direct and os.path.isfile(direct):
        ext = os.path.splitext(direct)[1].lower()
        if ext in _COVER_MIME_MAP:
            mime = _COVER_MIME_MAP[ext]
            with open(direct, "rb") as f:
                return f.read(), mime
        # Legacy: path points at the weight file; find a sibling image.
        dir_path = os.path.dirname(direct)
        basename = os.path.splitext(os.path.basename(direct))[0]
        for ext in _COVER_EXTENSIONS:
            sibling = os.path.join(dir_path, basename + ext)
            if os.path.isfile(sibling):
                mime = _COVER_MIME_MAP.get(ext, "application/octet-stream")
                with open(sibling, "rb") as f:
                    return f.read(), mime
    return None


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
        # Fallback: check if flake YAML has cover_image referencing an image
        # under the LoRA tree (path may end with .png/.jpg/etc., or with
        # .safetensors for legacy flakes — in which case we look for a sibling).
        try:
            raw = read_flake_raw(name)
            cover_source = raw.get("cover_image")
            if cover_source:
                resolved = _resolve_cover_source(cover_source)
                if resolved:
                    return resolved
        except Exception:
            pass
        return None
    ext = os.path.splitext(path)[1].lower()
    mime = _COVER_MIME_MAP.get(ext, "application/octet-stream")
    with open(path, "rb") as f:
        return f.read(), mime


def _resolve_input_image(image_source: str) -> tuple[bytes, str] | None:
    """Resolve an image path relative to the ComfyUI input directory."""
    input_dir = folder_paths.get_input_directory()
    if not input_dir:
        return None
    candidate = os.path.normpath(os.path.join(input_dir, image_source))
    try:
        _ensure_inside(candidate, input_dir)
    except ValueError:
        return None
    if not os.path.isfile(candidate):
        return None
    ext = os.path.splitext(candidate)[1].lower()
    mime = _COVER_MIME_MAP.get(ext)
    if not mime:
        return None
    with open(candidate, "rb") as f:
        return f.read(), mime


def read_variant_image(name: str, group: str, choice: str) -> tuple[bytes, str] | None:
    """Return (data, mime_type) for a variant choice's ``image`` path, or None.

    The ``image`` value is resolved either as a path under the ComfyUI input
    directory (where the image picker sources from) or, like ``cover_image``,
    a path under the LoRA tree (or a legacy weight path with a sibling image)."""
    try:
        raw = read_flake_raw(name)
    except Exception:
        return None
    variants = raw.get("variants") or raw.get("options") or {}
    choice_data = (variants.get(group) or {}).get(choice)
    if not isinstance(choice_data, dict):
        return None
    image_source = choice_data.get("image")
    if not image_source:
        return None
    return _resolve_input_image(image_source) or _resolve_cover_source(image_source)


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


def list_preset_display_names(family: str | None = None) -> dict[str, str]:
    names = list_presets(family=family)
    display_names: dict[str, str] = {}
    for name in names:
        try:
            raw = read_preset_raw(name)
            dn = raw.get("display_name") or ""
            if dn:
                display_names[name] = dn
        except Exception:
            pass
    return display_names


def read_preset_raw(name: str) -> dict[str, Any]:
    path = _resolve_preset_file(name)
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def save_preset(
    name: str,
    data: dict[str, Any],
    family: str | None = None,
    base_root_index: int | None = None,
    output_path: str | None = None,
    old_name: str | None = None,
) -> str:
    """Persist a model preset to disk and return the canonical name the
    caller should now use.

    Parameters
    ----------
    name
        Display-only fallback; ignored when ``output_path`` is provided.
    data
        Preset payload (YAML keys).
    family
        Used to prefix the output path with the family folder when
        ``output_path`` is not given.
    base_root_index
        Index into the registered ``model_presets`` roots. When set, the
        preset is written under that specific root rather than the primary.
    output_path
        Path relative to the chosen root (without the ``.yaml`` extension).
        Takes precedence over ``name`` / ``family`` prefixing.
    old_name
        When editing, the previously-stored canonical name. If the new
        location differs, the old YAML (and its cover) are moved to the
        new destination.
    """
    if not isinstance(data, dict):
        raise ValueError("preset data must be an object")

    roots = _presets_roots()
    if base_root_index is not None:
        if base_root_index < 0 or base_root_index >= len(roots):
            raise ValueError(f"invalid base_root_index: {base_root_index}")
        root = roots[base_root_index]
    else:
        root = _primary_presets_root()

    if output_path:
        canonical = output_path.replace("\\", "/").strip("/")
        _validate_name(canonical)
        folder = _family_folder(family)
        if folder:
            canonical = f"img/{folder}/{canonical}"
    else:
        _validate_name(name)
        folder = _family_folder(family)
        canonical = f"img/{folder}/{name}" if folder else name

    target = os.path.join(root, f"{canonical}.yaml")
    _ensure_inside(target, root)
    os.makedirs(os.path.dirname(target), exist_ok=True)

    # Move existing files if the location changed
    if old_name and old_name != canonical:
        try:
            old_yaml = _resolve_preset_file(old_name)
        except (FileNotFoundError, ValueError):
            old_yaml = None
        if old_yaml and os.path.realpath(old_yaml) != os.path.realpath(target):
            try:
                os.remove(old_yaml)
            except OSError:
                pass
            old_cover = _preset_cover_path(old_name)
            if old_cover:
                cover_ext = os.path.splitext(old_cover)[1].lower()
                new_cover_dir = os.path.dirname(target)
                new_cover = os.path.join(new_cover_dir, f"{os.path.basename(canonical)}{cover_ext}")
                try:
                    os.replace(old_cover, new_cover)
                except OSError:
                    pass

    with open(target, "w", encoding="utf-8") as f:
        yaml.safe_dump(data, f, sort_keys=False, allow_unicode=True)
    return canonical


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
                    for ext in _COVER_EXTENSIONS:
                        sibling = os.path.join(dir_path, basename + ext)
                        if os.path.isfile(sibling):
                            mime = _COVER_MIME_MAP.get(ext, "application/octet-stream")
                            with open(sibling, "rb") as f:
                                return f.read(), mime
        except Exception:
            pass
        return None
    ext = os.path.splitext(path)[1].lower()
    mime = _COVER_MIME_MAP.get(ext, "application/octet-stream")
    with open(path, "rb") as f:
        return f.read(), mime


def load_preset(name: str) -> ModelPreset:
    raw = read_preset_raw(name)
    prompt = raw.get("prompt") or {}
    return ModelPreset(
        name=name,
        display_name=str(raw.get("display_name", "") or ""),
        checkpoint=str(raw.get("checkpoint", "")),
        checkpoint_url=str(raw.get("checkpoint_url", "")),
        clip_skip=int(raw.get("clip_skip", -2)),
        vae=raw.get("vae") or None,
        text_encoder=raw.get("text_encoder") or None,
        steps=int(raw.get("steps", 20)),
        cfg=float(raw.get("cfg", 4.0)),
        sampler=str(raw.get("sampler", "dpmpp_2m")),
        scheduler=str(raw.get("scheduler", "karras")),
        width=int(raw.get("width", 832)),
        height=int(raw.get("height", 1216)),
        positive=str(prompt.get("positive", "") or ""),
        negative=str(prompt.get("negative", "") or ""),
        embeddings=list(raw.get("embeddings") or []),
        filename_prefix=str(raw.get("filename_prefix", "") or ""),
    )
