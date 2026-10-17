from __future__ import annotations

import logging
import os
import re
import shutil
from dataclasses import dataclass, field
from typing import Any

import yaml

import folder_paths

from . import flake_families


def _resolve_model_name(category: str, stem_or_name: str) -> str:
    available = folder_paths.get_filename_list(category)
    available_norm = {p.replace("\\", "/"): p for p in available}

    norm = stem_or_name.replace("\\", "/")
    if norm in available_norm:
        return available_norm[norm]

    norm_stem = os.path.basename(os.path.splitext(norm)[0])
    for cand_norm, candidate in available_norm.items():
        cand_stem = os.path.basename(os.path.splitext(cand_norm)[0])
        if cand_stem == norm_stem:
            return candidate

    return stem_or_name


_NAME_SEGMENT_RE = re.compile(r"^[A-Za-z0-9_\- ]+$")

# Family routing tables. All derived from the flake_families registry (#355) —
# add a family there, not here.
_FAMILY_MAP = flake_families.FAMILY_MAP

_FAMILY_COMPAT = flake_families.FAMILY_COMPAT

_FAMILY_FROM_FOLDER = {v: k for k, v in _FAMILY_MAP.items()}

# Controlnet model names follow the `controlnet_<type>_<family>` convention;
# they resolve only if the user has matching files (LoRA support is family-
# agnostic and works regardless). Adjust flake_families.CN_TYPES if your models
# are named otherwise.
_CN_MODEL_MAP = flake_families.CN_MODEL_MAP


def infer_cn_model(cn_type: str, family_folder: str) -> str:
    family_models = _CN_MODEL_MAP.get(family_folder, {})
    return family_models.get(cn_type, "")


# Family folder (sdxl / illustrious / pony / common / zib / zit) → the
# subfolder under models/controlnet/ where that family's controlnets live.
# All SDXL-based families share the `sdxl/` folder; ZImage families share
# `zimage/`.
_CN_SUBFOLDER = flake_families.CN_SUBFOLDER


def _cn_norm(value: str) -> str:
    """Collapse a controlnet name to alphanumerics for fuzzy matching, so
    ``controlnet_scribble_sdxl`` and ``controlnet-scribble-sdxl-1.0`` compare
    equal up to the version suffix."""
    return re.sub(r"[^a-z0-9]", "", value.lower())


def resolve_cn_model_name(model_name: str, family_folder: str | None, category: str = "controlnet") -> str:
    """Resolve an inferred/explicit controlnet model name to an entry in
    ``folder_paths.get_filename_list(category)``, preferring the family's
    controlnet subfolder (``models/controlnet/sdxl/`` for SDXL families).

    Families whose ControlNets are model patches pass
    ``category="model_patches"`` (#364), so Anima resolves under
    ``models/model_patches/anima/`` and Z-Image under ``.../zimage/``.

    Resolution order (#254):
      1. Exact-stem or normalized match inside the target subfolder.
      2. Fuzzy match inside the subfolder (handles dash/version-named files
         such as ``controlnet-scribble-sdxl-1.0.safetensors``).
      3. The generic global resolver (back-compat with flat layouts).
    """
    if not model_name:
        return model_name

    available = folder_paths.get_filename_list(category)
    subfolder = _CN_SUBFOLDER.get(family_folder or "")

    if subfolder:
        target_stem = os.path.basename(os.path.splitext(model_name)[0])
        target_norm = _cn_norm(target_stem)
        prefix = f"{subfolder}/"

        exact: str | None = None
        norm_eq: str | None = None
        startswith: str | None = None
        contains: str | None = None
        for candidate in available:
            cand_fwd = candidate.replace("\\", "/")
            if not cand_fwd.lower().startswith(prefix):
                continue
            cand_stem = os.path.basename(os.path.splitext(cand_fwd)[0])
            if cand_stem == target_stem and exact is None:
                exact = candidate
                break
            cand_norm = _cn_norm(cand_stem)
            if cand_norm == target_norm and norm_eq is None:
                norm_eq = candidate
            elif cand_norm.startswith(target_norm) and startswith is None:
                startswith = candidate
            elif target_norm and target_norm in cand_norm and contains is None:
                contains = candidate

        match = exact or norm_eq or startswith or contains
        if match:
            return match

    # Fall back to the generic resolver (exact / global stem match) so flat
    # `models/controlnet/` layouts keep working.
    return _resolve_model_name(category, model_name)


# ---------------------------------------------------------------------------
# Preset dataclass
# ---------------------------------------------------------------------------

@dataclass
class ModelPreset:
    name: str
    display_name: str = ""
    checkpoint: str = ""
    checkpoint_url: str = ""
    # Anima, Krea2 and Z-Image ship as a bare diffusion model plus a separate
    # text encoder and VAE rather than an all-in-one checkpoint (#357). Set this
    # instead of ``checkpoint`` and the loader takes the component path; both
    # ``text_encoder`` and ``vae`` then become required.
    diffusion_model: str | None = None
    clip_skip: int = -2
    vae: str | None = None
    steps: int = 20
    cfg: float = 4.0
    sampler: str = "dpmpp_2m"
    scheduler: str = "karras"
    width: int = 832
    height: int = 1216
    text_encoder: str | None = None
    # ``comfy.sd.CLIPType`` member name for a standalone text encoder, e.g.
    # "LUMINA2" (Z-Image) or "KREA2". None falls back to the family's default.
    clip_type: str | None = None
    # ModelSamplingAuraFlow shift. None falls back to the family's default.
    shift: float | None = None
    positive: str = ""
    negative: str = ""
    embeddings: list[str] = field(default_factory=list)
    filename_prefix: str = ""
    # Applied whenever the preset is used, like a flake's own LoRAs and links.
    loras: list[LoraEntry] = field(default_factory=list)
    flake_links: list[FlakeLink] = field(default_factory=list)

    @property
    def model_source(self) -> tuple[str, str]:
        """``(category, path)`` for the model file this preset loads.

        ``diffusion_model`` wins over ``checkpoint`` when both are set. Raises a
        readable error rather than letting an empty path reach the loader and
        surface as a confusing FileNotFoundError (#357).
        """
        if self.diffusion_model:
            return "diffusion_models", self.diffusion_model
        if self.checkpoint:
            return "checkpoints", self.checkpoint
        raise ValueError(
            f"Preset '{self.name}' has neither a 'checkpoint' nor a "
            f"'diffusion_model' set — pick a model file in the preset editor."
        )

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
    resolution_from_image: bool = False


@dataclass
class ScheduleKeyframe:
    """Hook keyframe: ``strength`` multiplies from ``start`` (fraction of
    denoising) until the next keyframe; 1.0 before the first one, as in core
    ``comfy.hooks.HookKeyframeGroup``."""
    start: float
    strength: float


@dataclass
class LoraEntry:
    name: str = ""
    url: str = ""
    path: str = ""
    strength: float = 1.0
    schedule: list[ScheduleKeyframe] = field(default_factory=list)


@dataclass
class PromptEntry:
    positive: str = ""
    negative: str = ""
    schedule: list[ScheduleKeyframe] = field(default_factory=list)


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
    # Multiplies into every LoRA and prompt the linked flake contributes.
    schedule: list[ScheduleKeyframe] = field(default_factory=list)


@dataclass
class Flake:
    name: str
    # Joined text of the unscheduled prompts; scheduled ones are kept apart.
    positive: str = ""
    negative: str = ""
    scheduled_prompts: list[PromptEntry] = field(default_factory=list)
    loras: list[LoraEntry] = field(default_factory=list)
    lora_path: str | None = None  # legacy single LoRA
    strength: float = 1.0  # legacy single LoRA strength
    resolution: tuple[int, int] | None = None
    controlnets: list[ControlNetEntry] = field(default_factory=list)
    variants: dict[str, dict[str, dict[str, str]]] = field(default_factory=dict)
    output_stem: str | None = None
    # Multiple flake links (#234). `flake_link` is kept as a convenience alias
    # for the first link so older readers keep working.
    flake_links: list[FlakeLink] = field(default_factory=list)
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


def _family_folder_from_name(name: str) -> str:
    parts = name.replace("\\", "/").split("/")
    if parts[0] == "img" and len(parts) >= 2 and parts[1] in _FAMILY_FROM_FOLDER:
        return parts[1]
    return "sdxl"


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


def list_flake_tag_names(family: str | None = None) -> dict[str, list[str]]:
    """Map of flake name -> tag-name LoRA names to surface on the flake item.

    Lets the Load picker show the same tag line as the grid (#297) without each
    item fetching its full flake. Only flakes with at least one tag-name LoRA
    appear in the result.
    """
    result: dict[str, list[str]] = {}
    for name in list_flakes(family=family):
        try:
            raw = read_flake_raw(name)
        except Exception:
            continue
        loras = raw.get("loras")
        if not isinstance(loras, list):
            continue
        tags = [
            str(lora.get("name")).strip()
            for lora in loras
            if isinstance(lora, dict) and lora.get("tag_name") and str(lora.get("name") or "").strip()
        ]
        if tags:
            result[name] = tags
    return result


def list_series(family: str | None = None) -> list[str]:
    """Distinct, non-empty `serie` values across flakes (sorted)."""
    series: set[str] = set()
    for name in list_flakes(family=family):
        try:
            raw = read_flake_raw(name)
        except Exception:
            continue
        value = raw.get("serie")
        if isinstance(value, str) and value.strip():
            series.add(value.strip())
    return sorted(series)


def list_dirs(family: str | None = None) -> list[str]:
    dirs: set[str] = set()
    for root in _flakes_roots():
        if not os.path.isdir(root):
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            # Skip folders owned by a sibling flake yaml (`X/` next to `X.yaml`).
            dirnames[:] = [d for d in dirnames if f"{d}.yaml" not in filenames and f"{d}.yml" not in filenames]
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

def _find_flake_root_index(name: str) -> int:
    _validate_name(name)
    roots = _flakes_roots()
    for idx, root in enumerate(roots):
        for ext in (".yaml", ".yml"):
            candidate = os.path.join(root, f"{name}{ext}")
            if os.path.isfile(candidate):
                _ensure_inside(candidate, root)
                return idx
    raise FileNotFoundError(f"Flake '{name}' not found under any registered flakes/ directory")


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
    target_real = os.path.realpath(target)
    os.makedirs(os.path.dirname(target), exist_ok=True)

    # Clean up any copies of the same canonical name in other roots to prevent
    # double-save (both base and extra path) and edits-lost-on-reload bugs (#242).
    for other_root in roots:
        other_path = os.path.realpath(os.path.join(other_root, f"{canonical}.yaml"))
        if other_path == target_real:
            continue
        if os.path.isfile(other_path):
            try:
                os.remove(other_path)
                print(f"[flakes] removed duplicate yaml: {other_path}")
            except OSError:
                pass
            for ext in _COVER_EXTENSIONS:
                cover_path = os.path.realpath(os.path.join(other_root, f"{canonical}{ext}"))
                if cover_path != target_real and os.path.isfile(cover_path):
                    try:
                        os.remove(cover_path)
                    except OSError:
                        pass

    # Move existing files if the location changed (old_name handles renames
    # or moves between roots — canonical stays the same but root may differ).
    if old_name:
        try:
            old_yaml = _resolve_file(old_name)
        except (FileNotFoundError, ValueError):
            old_yaml = None
        if old_yaml and os.path.realpath(old_yaml) != target_real:
            try:
                os.remove(old_yaml)
            except OSError:
                pass
            old_cover = _cover_path(old_name, legacy_only=True)
            if old_cover:
                cover_ext = os.path.splitext(old_cover)[1].lower()
                new_cover_dir = os.path.dirname(target)
                new_cover = os.path.join(new_cover_dir, f"{os.path.basename(canonical)}{cover_ext}")
                try:
                    os.replace(old_cover, new_cover)
                except OSError:
                    pass
            # The owned folder follows the yaml; its `./<old_base>/` references
            # and owned cover take the new base name.
            old_base = old_name.rsplit("/", 1)[-1]
            new_base = os.path.basename(canonical)
            old_owned = os.path.join(os.path.dirname(old_yaml), old_base)
            owned = os.path.join(os.path.dirname(target), new_base)
            if os.path.isdir(old_owned) and not os.path.exists(owned):
                try:
                    _move_file(old_owned, owned)
                    data = _rewrite_prefix(data, f"./{old_base}/", f"./{new_base}/")
                    for ext in _COVER_EXTENSIONS:
                        if old_base != new_base and os.path.isfile(os.path.join(owned, old_base + ext)):
                            os.replace(os.path.join(owned, old_base + ext), os.path.join(owned, new_base + ext))
                except OSError as exc:
                    logging.warning("[flakes] could not move %s to %s: %s", old_owned, owned, exc)

    _take_ownership(data, target)

    with open(target, "w", encoding="utf-8") as f:
        yaml.safe_dump(data, f, sort_keys=False, allow_unicode=True)
    return canonical


_CN_BATCH_RE = re.compile(r"^(.+)_\d+_[^_]+$")


def _file_safe(value: Any) -> str:
    return re.sub(r"[^A-Za-z0-9_\-]+", "_", str(value or "")).strip("_")


def _move_file(src: str, dest: str) -> None:
    """Move *src* (file or folder) to *dest*; copy it, keeping the origin, when
    *dest* is on another device."""
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    if os.stat(src).st_dev == os.stat(os.path.dirname(dest)).st_dev:
        os.replace(src, dest)
    elif os.path.isdir(src):
        shutil.copytree(src, dest)
    else:
        shutil.copy2(src, dest)


def _rewrite_prefix(value: Any, old: str, new: str) -> Any:
    if isinstance(value, dict):
        return {k: _rewrite_prefix(v, old, new) for k, v in value.items()}
    if isinstance(value, list):
        return [_rewrite_prefix(v, old, new) for v in value]
    if isinstance(value, str) and value.startswith(old):
        return new + value[len(old):]
    return value


def _cn_batch(path: str) -> list[str]:
    """*path* plus the files beside it from the same ControlNet batch: stems
    ``<prefix>_<n>_<token>`` sharing the selected image's ``<prefix>``."""
    match = _CN_BATCH_RE.match(os.path.splitext(os.path.basename(path))[0])
    if not match:
        return [path]
    folder = os.path.dirname(path)
    batch = []
    for fn in os.listdir(folder):
        stem, ext = os.path.splitext(fn)
        other = _CN_BATCH_RE.match(stem)
        if other and other.group(1) == match.group(1) and ext.lower() in _COVER_MIME_MAP and os.path.isfile(os.path.join(folder, fn)):
            batch.append(os.path.join(folder, fn))
    return batch


def _external_image(value: Any, moved: dict[str, str]) -> str | None:
    """Absolute path of the image a non-``./`` *value* refers to: input-relative
    (extension optional, like ``_load_cn_image``), absolute, or under the LoRA
    tree. Files already in *moved* count as existing. Only files inside the
    folders the editor's picker browses qualify (input, output, models, flakes
    and LoRA folders), since *value* comes from the client and the file gets
    moved."""
    if not isinstance(value, str) or not value or value.startswith("./"):
        return None
    input_dir = folder_paths.get_input_directory()
    roots = picker_roots()
    direct = os.path.join(input_dir, value)
    for path in (direct, *(direct + e for e in (".png", ".jpg", ".jpeg", ".webp")), folder_paths.get_full_path("loras", value)):
        if not path or os.path.splitext(path)[1].lower() not in _COVER_MIME_MAP:
            continue
        path = os.path.abspath(path)
        if not any(_is_inside(path, root) for root in roots):
            continue
        if os.path.isfile(path) or os.path.normcase(path) in moved:
            return path
    return None


def picker_roots() -> list[str]:
    """Folders the editor's file picker browses: input, output and every model
    folder, extra model paths included."""
    roots = [folder_paths.get_input_directory(), folder_paths.get_output_directory(), folder_paths.models_dir]
    for category in folder_paths.folder_names_and_paths:
        if category != "custom_nodes":
            roots += folder_paths.get_folder_paths(category)
    return roots


def _is_inside(path: str, root: str) -> bool:
    try:
        _ensure_inside(path, root)
    except ValueError:  # outside, or on another drive
        return False
    return True


def _take_ownership(data: dict[str, Any], target: str) -> None:
    """Move the external files *data* references (LoRAs + sidecars, ControlNet
    image batches, variant images, the cover) into the flake's owned folder
    ``<dirname(target)>/<base>`` and rewrite them to ``./<base>/...`` (#392).
    Files already inside the owned folder are referenced in place (#396).
    Flake links, ``./`` values and missing files are left alone."""
    flake_dir = os.path.dirname(target)
    base = os.path.splitext(os.path.basename(target))[0]
    owned = os.path.join(flake_dir, base)

    def dot_ref(path: str) -> str:
        # Resolved on both sides: a picked path may reach the flakes folder
        # through a junction or another drive letter than flake_dir.
        return "./" + os.path.relpath(os.path.realpath(path), os.path.realpath(flake_dir)).replace(os.sep, "/")
    moved: dict[str, str] = {}
    lora_refs: dict[str, str] = {}
    lora_stems: set[str] = set()

    def own(src: str, dest: str) -> str | None:
        """Move *src* to *dest* once; its ``./`` reference, or None on failure."""
        key = os.path.normcase(src)
        if key not in moved and _is_inside(src, owned):
            moved[key] = src
        if key not in moved:
            try:
                _move_file(src, dest)
            except OSError as exc:
                logging.warning("[flakes] could not move %s into %s: %s", src, owned, exc)
                return None
            moved[key] = dest
        return dot_ref(moved[key])

    def own_lora(path: Any, display: Any) -> Any:
        if not isinstance(path, str) or not path or path.startswith("./"):
            return path
        if path in lora_refs:
            return lora_refs[path]
        src = folder_paths.get_full_path("loras", _resolve_model_name("loras", path))
        if not src or not os.path.isfile(src):
            return path
        src = os.path.abspath(src)
        src_dir, src_name = os.path.split(src)
        src_stem, ext = os.path.splitext(src_name)
        stem = f"{base}_{_file_safe(display)}" if _file_safe(display) else base
        new_stem, n = stem, 1
        while new_stem in lora_stems or os.path.exists(os.path.join(owned, new_stem + ext)):
            n += 1
            new_stem = f"{stem}_{n}"
        lora_stems.add(new_stem)
        # Sidecars (previews, .civitai.info, .json) follow under the new stem.
        for fn in os.listdir(src_dir):
            if fn.startswith(src_stem + ".") and not fn.endswith(ext):
                own(os.path.join(src_dir, fn), os.path.join(owned, new_stem + fn[len(src_stem):]))
        ref = own(src, os.path.join(owned, new_stem + ext))
        if ref:
            lora_refs[path] = ref
        return ref or path

    def own_entries(loras: Any, cns: Any) -> None:
        for lora in loras if isinstance(loras, list) else ():
            if isinstance(lora, dict):
                lora["path"] = own_lora(lora.get("path"), lora.get("name"))
        for cn in cns if isinstance(cns, list) else ():
            src = _external_image(cn.get("image"), moved) if isinstance(cn, dict) else None
            if not src:
                continue
            if os.path.isfile(src):
                for f in _cn_batch(src):
                    if f != src:
                        own(f, os.path.join(owned, "cnets", os.path.basename(f)))
            cn["image"] = own(src, os.path.join(owned, "cnets", os.path.basename(src))) or cn["image"]

    # Resolved before anything moves: the cover may be a LoRA preview or a CN
    # batch image that is about to land in the owned folder.
    cover_src = _external_image(data.get("cover_image"), moved)
    if "cover_image" not in data and not any(os.path.isfile(os.path.join(owned, base + e)) for e in _COVER_EXTENSIONS):
        cover_src = next((p for e in _COVER_EXTENSIONS if os.path.isfile(p := os.path.join(flake_dir, base + e))), None)

    own_entries(data.get("loras"), data.get("controlnets"))
    if "loras" not in data and data.get("path"):
        data["path"] = own_lora(data["path"], None)
    variants = data.get("variants")
    for group, choices in variants.items() if isinstance(variants, dict) else ():
        for choice, choice_data in choices.items() if isinstance(choices, dict) else ():
            if not isinstance(choice_data, dict):
                continue
            own_entries(choice_data.get("loras"), choice_data.get("controlnets"))
            src = _external_image(choice_data.get("image"), moved)
            if src:
                dest = os.path.join(owned, f"{base}_{_file_safe(group)}_{_file_safe(choice)}{os.path.splitext(src)[1]}")
                choice_data["image"] = own(src, dest) or choice_data["image"]

    # A cover already in the owned folder (e.g. a moved CN batch's `_cover`
    # image) stays where it is and is referenced; others become <base><ext>.
    if cover_src:
        src = moved.get(os.path.normcase(cover_src), cover_src)
        in_place = _is_inside(src, owned)
        dest = src if in_place else os.path.join(owned, base + os.path.splitext(src)[1].lower())
        try:
            if in_place:
                data["cover_image"] = dot_ref(src)
            else:
                _move_file(src, dest)
                data.pop("cover_image", None)
            for e in _COVER_EXTENSIONS:
                for old in (os.path.join(owned, base + e), os.path.join(flake_dir, base + e)):
                    if os.path.normcase(old) != os.path.normcase(dest) and os.path.isfile(old):
                        os.remove(old)
        except OSError as exc:
            logging.warning("[flakes] could not move cover %s into %s: %s", src, owned, exc)


def delete_flake(name: str) -> None:
    path = _resolve_file(name)
    os.remove(path)
    # The owned `<name>/` folder (and the cover inside it) is kept.
    _delete_cover(name, legacy_only=True)


def _parse_schedule(raw: Any) -> list[ScheduleKeyframe]:
    """Parse a `schedule:` keyframe list, sorted by start with start clamped to
    [0, 1]. A repeated start keeps the last keyframe."""
    by_start: dict[float, float] = {}
    if isinstance(raw, list):
        for kf in raw:
            if isinstance(kf, dict):
                start = min(max(float(kf.get("start", 0.0)), 0.0), 1.0)
                by_start[start] = float(kf.get("strength", 1.0))
    return [ScheduleKeyframe(start, by_start[start]) for start in sorted(by_start)]


def schedule_strength(schedule: list[ScheduleKeyframe], t: float) -> float:
    strength = 1.0
    for kf in schedule:
        if kf.start > t:
            break
        strength = kf.strength
    return strength


def multiply_schedules(a: list[ScheduleKeyframe], b: list[ScheduleKeyframe]) -> list[ScheduleKeyframe]:
    """Piecewise product of two schedules; an empty schedule is the identity."""
    if not a or not b:
        return list(a or b)
    starts = sorted({kf.start for kf in a} | {kf.start for kf in b})
    return [ScheduleKeyframe(t, schedule_strength(a, t) * schedule_strength(b, t)) for t in starts]


def _join_prompt_text(parts) -> str:
    return ", ".join(p for p in parts if p)


def _parse_prompt_list(raw: dict[str, Any]) -> list["PromptEntry"]:
    """Parse `prompts:` (list) or legacy `prompt:` (dict) from a flake body."""
    raw_prompts = raw.get("prompts")
    if not isinstance(raw_prompts, list):
        raw_prompts = [raw.get("prompt") or {}]
    return [
        PromptEntry(
            positive=str(p.get("positive", "") or ""),
            negative=str(p.get("negative", "") or ""),
            schedule=_parse_schedule(p.get("schedule")),
        )
        for p in raw_prompts if isinstance(p, dict)
    ]


def _owned_file_path(value: str, name: str | None) -> str:
    """A ``./x`` value of flake *name* → absolute path under the yaml's
    directory. Other values, presets (no name) and inline flakes are unchanged."""
    if not name or name == "__inline__" or not value.startswith("./"):
        return value
    return os.path.normpath(os.path.join(os.path.dirname(_resolve_file(name)), value[2:]))


def _parse_lora_list(raw_loras: Any, name: str | None = None) -> list["LoraEntry"]:
    """Parse a `loras:` list into LoraEntry objects. Shared by the flake body and
    by variant-choice contributions (#299)."""
    out: list[LoraEntry] = []
    if isinstance(raw_loras, list):
        for lr in raw_loras:
            if not isinstance(lr, dict):
                continue
            out.append(LoraEntry(
                name=str(lr.get("name", "")),
                url=str(lr.get("url", "")),
                path=_owned_file_path(str(lr.get("path", "")), name),
                strength=float(lr.get("strength", 1.0)),
                schedule=_parse_schedule(lr.get("schedule")),
            ))
    return out


def _parse_cn_list(raw_cns: Any, name: str) -> list["ControlNetEntry"]:
    """Parse a `controlnets:` list into ControlNetEntry objects, inferring the
    model from the type when omitted. Shared by the flake body and variant
    choices (#299)."""
    out: list[ControlNetEntry] = []
    for cn in raw_cns or []:
        if not isinstance(cn, dict):
            continue
        model_name = str(cn.get("model", ""))
        cn_type = str(cn.get("type", ""))
        if not model_name.strip() and cn_type:
            model_name = infer_cn_model(cn_type, _family_folder_from_name(name)) or ""
        if not model_name.strip():
            print(f"[flakes] skipping controlnet entry with empty model_name (type={cn_type})")
            continue
        out.append(ControlNetEntry(
            type=cn_type,
            model_name=model_name,
            image_name=_owned_file_path(str(cn.get("image", "")), name),
            strength=float(cn.get("strength", 1.0)),
            start_percent=float(cn.get("start_percent", 0.0)),
            end_percent=float(cn.get("end_percent", 1.0)),
            resolution_from_image=bool(cn.get("resolution_from_image", False)),
        ))
    return out


def _parse_link_list(raw: dict[str, Any]) -> list["FlakeLink"]:
    """Parse `flake_links:` (list) or legacy `flake_link:` (dict) from any mapping
    — the flake body or a variant choice (#234/#299)."""
    def _one(d: dict[str, Any]) -> FlakeLink:
        return FlakeLink(
            target=str(d["target"]),
            variant={str(g): str(c) for g, c in (d.get("variant") or {}).items() if c},
            lora_strengths=[
                (float(s) if isinstance(s, (int, float)) else None)
                for s in (d.get("lora_strengths") or [])
            ],
            schedule=_parse_schedule(d.get("schedule")),
        )

    out: list[FlakeLink] = []
    raw_links = raw.get("flake_links")
    if isinstance(raw_links, list):
        for lr in raw_links:
            if isinstance(lr, dict) and lr.get("target"):
                out.append(_one(lr))
    else:
        link_raw = raw.get("flake_link")
        if isinstance(link_raw, dict) and link_raw.get("target"):
            out.append(_one(link_raw))
    return out


def _flake_from_raw(name: str, raw: dict[str, Any]) -> Flake:
    prompts = _parse_prompt_list(raw)
    unscheduled = [p for p in prompts if not p.schedule]
    resolution = raw.get("resolution")
    if resolution is not None:
        resolution = (int(resolution[0]), int(resolution[1]))

    cns = _parse_cn_list(raw.get("controlnets"), name)

    # Parse LoRAs: new multi-LoRA format takes precedence; fall back to a legacy
    # single LoRA stored as `path`/`strength`.
    loras = _parse_lora_list(raw.get("loras"), name)
    if not loras and raw.get("path"):
        loras.append(LoraEntry(
            name="", url="", path=_owned_file_path(str(raw["path"]), name), strength=float(raw.get("strength", 1.0)),
        ))

    # Parse flake links (#232/#234) — defaults stored on the host yaml. Optional.
    links = _parse_link_list(raw)

    return Flake(
        name=name,
        positive=_join_prompt_text(p.positive for p in unscheduled),
        negative=_join_prompt_text(p.negative for p in unscheduled),
        scheduled_prompts=[p for p in prompts if p.schedule],
        loras=loras,
        lora_path=raw.get("path") or None,
        strength=float(raw.get("strength", 1.0)),
        resolution=resolution,
        controlnets=cns,
        variants=raw.get("variants") or raw.get("options") or {},
        output_stem=raw.get("output_stem") or None,
        flake_links=links,
        flake_link=(links[0] if links else None),
    )


def _combine_variant_stem(base: str | None, variant_stem: str) -> str:
    """Combine a flake's base ``output_stem`` with a variant choice's stem.

    A base ending in ``/`` is an explicit folder, so the variant nests inside it;
    otherwise the base is a filename prefix and the variant is appended as a
    filename segment with ``_`` — NOT ``/``, which would wrongly fold the base
    into a directory (``style_a`` + ``variant_b`` -> ``style_a_variant_b``,
    not ``style_a/variant_b``) (#347).
    """
    if not base:
        return variant_stem
    if base.endswith("/"):
        return f"{base}{variant_stem.lstrip('/')}"
    return f"{base}_{variant_stem.lstrip('/')}"


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

    # A group with no selection falls back to its default choice (#387);
    # "__none__" is an explicit "no choice" that skips the default.
    selected = dict(entry.get("variant") or entry.get("option") or {})
    for group, default in variant_defaults(flake).items():
        if not selected.get(group):
            selected[group] = default
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
            flake.output_stem = _combine_variant_stem(flake.output_stem, variant_stem)

        # A variant choice can also contribute LoRAs, ControlNets, and flake links
        # (#299) — merged on top of the flake's base. Choice links are appended to
        # flake_links so the shared _apply_flake_link below resolves them (with its
        # cycle guard) alongside any host links.
        flake.loras.extend(_parse_lora_list(variant.get("loras"), flake.name))
        flake.controlnets.extend(_parse_cn_list(variant.get("controlnets"), flake.name))
        flake.flake_links.extend(_parse_link_list(variant))

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
    """Apply each of the host flake's links (#232/#234) by resolving the linked
    flakes with merged overrides and appending their loras + prompts.

    Override precedence (highest wins):
      1. Per-grid placement override (entry["flake_link_overrides"][i], or the
         legacy single entry["flake_link_override"] applied to the first link)
      2. Host yaml flake_links[i].variant / .lora_strengths
      3. Linked flake's own defaults
    """
    links = host.flake_links or ([host.flake_link] if host.flake_link else [])
    if not links:
        return

    overrides = entry.get("flake_link_overrides")
    legacy_override = entry.get("flake_link_override") or {}

    _visited = set(_visited or [])
    _visited.add(host.name)

    for i, link in enumerate(links):
        if not link or not link.target or link.target in _visited:
            continue  # cycle guard / empty slot
        if isinstance(overrides, list):
            grid_override = overrides[i] if (i < len(overrides) and isinstance(overrides[i], dict)) else {}
        else:
            grid_override = legacy_override if i == 0 else {}
        _apply_single_link(host, link, grid_override)


def _apply_single_link(host: "Flake", link: "FlakeLink", grid_override: dict[str, Any]) -> None:
    # Build the effective entry for the linked flake.
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

    # Append linked flake's loras to host's list, under the link's schedule.
    for lr in linked.loras:
        lr.schedule = multiply_schedules(link.schedule, lr.schedule)
        host.loras.append(lr)

    # A scheduled link turns the linked unscheduled text into a scheduled
    # prompt; otherwise it is appended after the host's, comma-joined.
    if link.schedule:
        if linked.positive or linked.negative:
            linked.scheduled_prompts.insert(0, PromptEntry(linked.positive, linked.negative))
        for p in linked.scheduled_prompts:
            p.schedule = multiply_schedules(link.schedule, p.schedule)
    else:
        host.positive = _join_prompt_text([host.positive, linked.positive])
        host.negative = _join_prompt_text([host.negative, linked.negative])
    host.scheduled_prompts.extend(linked.scheduled_prompts)


def variant_defaults(flake: Flake) -> dict[str, str]:
    """{group: choice} for groups whose first choice has ``default: true`` (#387)."""
    defaults = {}
    for group, choices in flake.variants.items():
        first = next(iter((choices or {}).items()), None)
        if first and (first[1] or {}).get("default"):
            defaults[group] = first[0]
    return defaults

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

    The value can either be an absolute path to an image anywhere on disk
    (#259 — manually added covers are stored by reference, never copied), a
    direct image path under the LoRA tree, or — for legacy flakes — a
    ``.safetensors`` path whose sibling image we fall back to.
    """
    # Absolute-path reference: read the file directly (image extensions only).
    if os.path.isabs(cover_source):
        if os.path.isfile(cover_source):
            ext = os.path.splitext(cover_source)[1].lower()
            if ext in _COVER_MIME_MAP:
                with open(cover_source, "rb") as f:
                    return f.read(), _COVER_MIME_MAP[ext]
        return None

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


def _owned_cover_stem(name: str) -> str:
    """``<name>/<base>``: the cover stem inside the flake's owned folder."""
    return f"{name}/{name.rsplit('/', 1)[-1]}"


def _cover_path(name: str, legacy_only: bool = False) -> str | None:
    """Find the cover file for a given flake name: the owned
    ``<name>/<base><ext>`` first, then the legacy sibling ``<name><ext>``."""
    stems = (name,) if legacy_only else (_owned_cover_stem(name), name)
    for stem in stems:
        for root in _flakes_roots():
            for e in _COVER_EXTENSIONS:
                candidate = os.path.join(root, f"{stem}{e}")
                try:
                    _ensure_inside(candidate, root)
                except ValueError:
                    continue
                if os.path.isfile(candidate):
                    return candidate
    return None


def _delete_cover(name: str, legacy_only: bool = False) -> None:
    while path := _cover_path(name, legacy_only):
        os.remove(path)


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
                resolved = _resolve_cover_source(_owned_file_path(cover_source, name))
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
    if image_source.startswith("./"):
        return read_flake_asset(name, image_source)
    return _resolve_input_image(image_source) or _resolve_cover_source(image_source)


def read_flake_asset(name: str, path: str) -> tuple[bytes, str] | None:
    """Return (data, mime_type) for a ``./`` image path relative to the flake
    yaml's directory, or None when it is missing or not an image."""
    if not path.startswith("./"):
        raise ValueError("asset path must start with './'")
    flake_dir = os.path.dirname(_resolve_file(name))
    full = os.path.normpath(os.path.join(flake_dir, path[2:]))
    _ensure_inside(full, flake_dir)
    return _resolve_cover_source(full)


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


def _find_preset_root_index(name: str) -> int:
    """Index into ``_presets_roots()`` of the root that holds the preset's
    YAML, so the editor can preselect the correct base path on edit (mirrors
    ``_find_flake_root_index``)."""
    _validate_name(name)
    roots = _presets_roots()
    for idx, root in enumerate(roots):
        for ext in (".yaml", ".yml"):
            candidate = os.path.join(root, f"{name}{ext}")
            if os.path.isfile(candidate):
                _ensure_inside(candidate, root)
                return idx
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
    target_real = os.path.realpath(target)
    os.makedirs(os.path.dirname(target), exist_ok=True)

    # Remove same-name copies in other preset roots so a stale duplicate in
    # another root can't shadow this save on the next read (edits-lost-on-reopen,
    # #262 — mirrors the flake fix in #242).
    for other_root in roots:
        other_path = os.path.realpath(os.path.join(other_root, f"{canonical}.yaml"))
        if other_path == target_real:
            continue
        if os.path.isfile(other_path):
            try:
                os.remove(other_path)
                print(f"[flakes] removed duplicate preset yaml: {other_path}")
            except OSError:
                pass
            for ext in _COVER_EXTENSIONS:
                cover_path = os.path.realpath(os.path.join(other_root, f"{canonical}{ext}"))
                if cover_path != target_real and os.path.isfile(cover_path):
                    try:
                        os.remove(cover_path)
                    except OSError:
                        pass

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
        diffusion_model=raw.get("diffusion_model") or None,
        clip_skip=int(raw.get("clip_skip", -2)),
        vae=raw.get("vae") or None,
        text_encoder=raw.get("text_encoder") or None,
        clip_type=(str(raw["clip_type"]).strip().upper() or None) if raw.get("clip_type") else None,
        shift=float(raw["shift"]) if raw.get("shift") not in (None, "") else None,
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
        loras=_parse_lora_list(raw.get("loras")),
        flake_links=_parse_link_list(raw),
    )
