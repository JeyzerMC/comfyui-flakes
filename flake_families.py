"""Single source of truth for model families (#355).

A "model family" is the axis that routes almost everything in this nodepack: the
``img/<folder>/`` output prefix, which LoRAs and flakes a preset may use, which
ControlNet file to infer, and (from #356) how the checkpoint is loaded and
sampled.

Before this module the same eight facts were copy-pasted across
``flake_io.py``, ``full_flake_node.py``, ``web/utils.js``, ``web/flake-modal.js``
and ``web/preset-modal.js``. Adding one family meant eight edits and the copies
drifted. Everything is now derived from :data:`FAMILIES`, and a
``model_family`` value that names no registered family is a new family with
the default fields (:func:`get`, #470).
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# The ControlNet hint types this pack knows how to infer a model name for. The
# inferred name is ``controlnet_<type>_<family.cn_suffix>``; whether it resolves
# depends on the user actually having a matching file (see
# ``flake_io.resolve_cn_model_name``).
CN_TYPES: tuple[str, ...] = (
    "openpose",
    "depth",
    "canny",
    "lineart",
    "lineart_anime",
    "softedge",
    "scribble",
    "normalbae",
    "seg",
    "tile",
    "ip2p",
)


@dataclass(frozen=True)
class FamilySpec:
    """One model family.

    ``label`` is what the ``model_family`` field shows; ``folder`` is the
    on-disk segment used under ``models/flakes/img/``,
    ``models/flakes/model_presets/img/`` and ``output/img/``. Changing either of
    those for a registered family breaks the user's workflows or moves their
    files, so don't. Unregistered families get the defaults below (#470).
    """

    label: str
    folder: str

    # ControlNet routing. ``cn_suffix`` completes ``controlnet_<type>_<suffix>``;
    # ``cn_subfolder`` is the directory under ``models/controlnet/`` searched
    # first (#254). Families that share an architecture share both, which is why
    # illustrious/pony resolve SDXL controlnets and zit reuses zib's.
    cn_suffix: str
    cn_subfolder: str

    # How a flake's ControlNet is applied. "controlnet" goes through core
    # ControlNetLoader/ControlNetApplyAdvanced on the conditioning. The other
    # kinds are model patches loaded from models/model_patches/ that hook the
    # MODEL instead: "anima_lllite" (ControlNet-LLLite, AnimaLLLiteApply) and
    # "zimage_fun" (Fun ControlNet Union, ZImageFunControlnet).
    cn_kind: str = "controlnet"

    # Per-type filename stems that replace the ``controlnet_<type>_<suffix>``
    # convention. When set, only these types are offered for the family.
    cn_names: tuple[tuple[str, str], ...] = ()

    # Compat tags beyond the implicit {"common", folder} — only the SDXL
    # derivatives need this, so illustrious/pony can consume plain sdxl flakes.
    extra_compat: tuple[str, ...] = ()

    # "Common" is a real family folder for shared flakes but is never suggested
    # in the model_family field.
    selectable: bool = True

    # --- Generation metadata (#356) ----------------------------------------
    # Name of the ``comfy.sd.CLIPType`` member used when the preset loads its
    # text encoder from a standalone file. Looked up by name, never by value —
    # the enum gets renumbered upstream.
    clip_type: str = "STABLE_DIFFUSION"

    # Defaults seeded into a newly created preset. Existing presets keep
    # whatever is on disk; these only fill the editor's blank form.
    steps: int = 31
    cfg: float = 4.7
    sampler: str = "dpmpp_2m"
    scheduler: str = "karras"
    width: int = 853
    height: int = 1440

    # ``clip.clip_layer()`` is a CLIP-ism. On the Qwen3 / Qwen3-VL encoders the
    # newer families use it is meaningless and can raise, so it must be skipped.
    supports_clip_skip: bool = True

    # ModelSamplingAuraFlow shift, or None for families that don't use it.
    default_shift: float | None = None

    @property
    def compat(self) -> set[str]:
        return {"common", *self.extra_compat, self.folder}

    @property
    def cn_models(self) -> dict[str, str]:
        if self.cn_names:
            return dict(self.cn_names)
        return {t: f"controlnet_{t}_{self.cn_suffix}" for t in CN_TYPES}

    @property
    def cn_category(self) -> str:
        """``folder_paths`` category the family's ControlNet files live in."""
        return "controlnet" if self.cn_kind == "controlnet" else "model_patches"


# Generation metadata for the non-SDXL families is taken from the workflow
# templates ComfyUI ships (comfyui_workflow_templates_json): image_anima_base_v1,
# image_krea2_turbo_t2i and image_z_image_turbo. They are the reference graphs —
# if a default here disagrees with a template, the template wins.
_ZIMAGE_FUN_UNION = "Z-Image-Turbo-Fun-Controlnet-Union"

FAMILIES: tuple[FamilySpec, ...] = (
    FamilySpec("SDXL/Base", "sdxl", cn_suffix="sdxl", cn_subfolder="sdxl"),
    FamilySpec("SDXL/Illustrious", "illustrious", cn_suffix="sdxl", cn_subfolder="sdxl",
               extra_compat=("sdxl",)),
    FamilySpec("SDXL/Pony", "pony", cn_suffix="sdxl", cn_subfolder="sdxl",
               extra_compat=("sdxl",)),
    # Z-Image: Lumina2 architecture, Qwen3-4B text encoder, ae.safetensors VAE.
    # Both variants are distilled and run at cfg 1 with res_multistep. One Fun
    # ControlNet Union file serves every control type.
    FamilySpec("ZImage/Base", "zib", cn_suffix="zib", cn_subfolder="zimage",
               cn_kind="zimage_fun",
               cn_names=tuple((t, _ZIMAGE_FUN_UNION) for t in ("openpose", "depth", "canny", "softedge")),
               clip_type="LUMINA2", steps=8, cfg=1.0, sampler="res_multistep",
               scheduler="simple", width=1024, height=1024,
               supports_clip_skip=False, default_shift=3.0),
    # zit deliberately reuses zib's controlnet files — same architecture.
    FamilySpec("ZImage/Turbo", "zit", cn_suffix="zib", cn_subfolder="zimage",
               cn_kind="zimage_fun",
               cn_names=tuple((t, _ZIMAGE_FUN_UNION) for t in ("openpose", "depth", "canny", "softedge")),
               clip_type="LUMINA2", steps=8, cfg=1.0, sampler="res_multistep",
               scheduler="simple", width=1024, height=1024,
               supports_clip_skip=False, default_shift=3.0),
    # Anima: Qwen3-0.6B encoder loaded as QWEN_IMAGE (core picks the model by file contents), qwen
    # image VAE. Base is undistilled — 30 steps at cfg 4 with a real negative.
    # ControlNets are kohya's ControlNet-LLLite (anima-lllite-<type>-1). An entry
    # whose model names a VACE file in models/controlnet/anima/ goes through the
    # ComfyUI-Advanced-ControlNet-Anima fork instead (#378).
    FamilySpec("Anima/Base", "anima", cn_suffix="anima", cn_subfolder="anima",
               cn_kind="anima_lllite",
               cn_names=(("openpose", "anima-lllite-pose"), ("depth", "anima-lllite-depth"),
                         ("lineart", "anima-lllite-lineart"), ("scribble", "anima-lllite-scribble")),
               clip_type="QWEN_IMAGE", steps=30, cfg=4.0, sampler="euler_ancestral",
               scheduler="normal", width=1024, height=1024,
               supports_clip_skip=False, default_shift=3.0),
    # Krea2: Qwen3-VL-4B encoder (CLIPType.KREA2), qwen image VAE. The public
    # weights are the distilled turbo variant — 8 steps at cfg 1.
    FamilySpec("Krea2/Turbo", "krea2", cn_suffix="krea2", cn_subfolder="krea2",
               clip_type="KREA2", steps=8, cfg=1.0, sampler="euler",
               scheduler="simple", width=1024, height=1024,
               supports_clip_skip=False, default_shift=1.15),
    FamilySpec("Flux/Klein", "flux_klein", cn_suffix="flux", cn_subfolder="flux"),
    FamilySpec("Common", "common", cn_suffix="sdxl", cn_subfolder="sdxl", selectable=False),
)


def _check_unique() -> None:
    """Labels and folders back the lookups in :func:`get` and
    :func:`from_folder`, so a duplicate would silently shadow a family."""
    labels = [f.label for f in FAMILIES]
    folders = [f.folder for f in FAMILIES]
    for name, values in (("label", labels), ("folder", folders)):
        dupes = {v for v in values if values.count(v) > 1}
        if dupes:
            raise ValueError(f"duplicate family {name}(s): {sorted(dupes)}")


_check_unique()


BY_FOLDER: dict[str, FamilySpec] = {f.folder: f for f in FAMILIES}
_BY_NAME: dict[str, FamilySpec] = {k: f for f in FAMILIES for k in (f.label.lower(), f.folder)}


def folder_slug(value: str) -> str:
    """Folder of an unregistered family: ``Moss/Base`` -> ``moss_base``.
    Mirrored by ``familyFolder`` in web/utils.js."""
    return re.sub(r"[^a-z0-9_]+", "_", value.strip().lower()).strip("_")


def from_folder(folder: str | None, label: str | None = None) -> FamilySpec | None:
    """The family whose files live in ``img/<folder>/``; an unregistered folder
    is a family with the default fields, labelled *label* or the folder."""
    if not folder:
        return None
    return BY_FOLDER.get(folder) or FamilySpec(label or folder, folder, cn_suffix=folder, cn_subfolder=folder)


def get(value: str | None) -> FamilySpec | None:
    """The family a ``model_family`` value names (#470): the registered family
    whose label or folder equals it in any case (``anima`` -> ``Anima/Base``),
    else a new family in folder :func:`folder_slug`. None for an empty value."""
    if not value or not value.strip():
        return None
    spec = _BY_NAME.get(value.strip().lower())
    if spec:
        return spec
    folder = folder_slug(value)
    if not folder:
        raise ValueError(f"model family {value!r} has no usable folder name")
    return from_folder(folder, value.strip())


# --- Animate (image-to-video) families --------------------------------------
# Kept apart from FAMILIES so they never reach the image dropdowns or the
# routing maps above. ``folder`` is the segment under ``models/flakes/video/``
# and ``models/flakes/model_presets/video/``.

ANIM_RESOLUTIONS: tuple[str, ...] = ("480p", "580p", "720p")


@dataclass(frozen=True)
class AnimFamilySpec:
    """One animate family; the numbers seed a new animate preset. Fields a
    family doesn't use stay None: Wan 2.2 splits sampling between a high- and a
    low-noise model at ``refiner_step``, MiniMax H3 shifts video and audio
    separately."""

    label: str
    folder: str
    clip_type: str
    steps: int
    cfg: float
    sampler: str
    scheduler: str
    fps: int
    duration: float
    resolution: str = "720p"
    shift_high: float | None = None
    shift_low: float | None = None
    refiner_step: int | None = None
    shift_video: float | None = None
    shift_audio: float | None = None


ANIM_FAMILIES: tuple[AnimFamilySpec, ...] = (
    AnimFamilySpec("Wan 2.2", "wan22", clip_type="WAN", steps=4, cfg=1.0, sampler="euler",
                   scheduler="linear_quadratic", fps=16, duration=5.0,
                   shift_high=5.0, shift_low=5.0, refiner_step=2),
    AnimFamilySpec("MiniMax H3", "mh3", clip_type="MINIMAX", steps=4, cfg=1.0, sampler="euler",
                   scheduler="simple", fps=24, duration=5.0,
                   shift_video=10.0, shift_audio=3.0),
)

ANIM_BY_LABEL: dict[str, AnimFamilySpec] = {f.label: f for f in ANIM_FAMILIES}
ANIM_BY_FOLDER: dict[str, AnimFamilySpec] = {f.folder: f for f in ANIM_FAMILIES}
