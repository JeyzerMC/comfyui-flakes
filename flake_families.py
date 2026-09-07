"""Single source of truth for model families (#355).

A "model family" is the axis that routes almost everything in this nodepack: the
``img/<folder>/`` output prefix, which LoRAs and flakes a preset may use, which
ControlNet file to infer, and (from #356) how the checkpoint is loaded and
sampled.

Before this module the same eight facts were copy-pasted across
``flake_io.py``, ``full_flake_node.py``, ``web/utils.js``, ``web/flake-modal.js``
and ``web/preset-modal.js``. Adding one family meant eight edits and the copies
drifted. Everything is now derived from :data:`FAMILIES`; the old module-level
dicts still exist with their original names and shapes, they are just built
rather than typed out.
"""

from __future__ import annotations

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

    ``label`` is what the user picks in the ``model_family`` dropdown; ``folder``
    is the on-disk segment used under ``models/flakes/img/``,
    ``models/flakes/model_presets/img/`` and ``output/img/``. Changing either of
    those for an existing family moves the user's files, so don't.
    """

    label: str
    folder: str

    # ControlNet routing. ``cn_suffix`` completes ``controlnet_<type>_<suffix>``;
    # ``cn_subfolder`` is the directory under ``models/controlnet/`` searched
    # first (#254). Families that share an architecture share both, which is why
    # illustrious/pony resolve SDXL controlnets and zit reuses zib's.
    cn_suffix: str
    cn_subfolder: str

    # Compat tags beyond the implicit {"common", folder} — only the SDXL
    # derivatives need this, so illustrious/pony can consume plain sdxl flakes.
    extra_compat: tuple[str, ...] = ()

    # "Common" is a real family folder for shared flakes but must never appear in
    # the model_family dropdown.
    selectable: bool = True

    @property
    def compat(self) -> set[str]:
        return {"common", *self.extra_compat, self.folder}

    @property
    def cn_models(self) -> dict[str, str]:
        return {t: f"controlnet_{t}_{self.cn_suffix}" for t in CN_TYPES}


FAMILIES: tuple[FamilySpec, ...] = (
    FamilySpec("SDXL/Base", "sdxl", cn_suffix="sdxl", cn_subfolder="sdxl"),
    FamilySpec("SDXL/Illustrious", "illustrious", cn_suffix="sdxl", cn_subfolder="sdxl",
               extra_compat=("sdxl",)),
    FamilySpec("SDXL/Pony", "pony", cn_suffix="sdxl", cn_subfolder="sdxl",
               extra_compat=("sdxl",)),
    FamilySpec("ZImage/Base", "zib", cn_suffix="zib", cn_subfolder="zimage"),
    # zit deliberately reuses zib's controlnet files — same architecture.
    FamilySpec("ZImage/Turbo", "zit", cn_suffix="zib", cn_subfolder="zimage"),
    FamilySpec("Anima/Base", "anima", cn_suffix="anima", cn_subfolder="anima"),
    FamilySpec("Flux/Klein", "flux_klein", cn_suffix="flux", cn_subfolder="flux"),
    FamilySpec("Common", "common", cn_suffix="sdxl", cn_subfolder="sdxl", selectable=False),
)


def _check_unique() -> None:
    """Folders back a reverse map (``_FAMILY_FROM_FOLDER``), so a duplicate would
    silently shadow a family."""
    labels = [f.label for f in FAMILIES]
    folders = [f.folder for f in FAMILIES]
    for name, values in (("label", labels), ("folder", folders)):
        dupes = {v for v in values if values.count(v) > 1}
        if dupes:
            raise ValueError(f"duplicate family {name}(s): {sorted(dupes)}")


_check_unique()


BY_LABEL: dict[str, FamilySpec] = {f.label: f for f in FAMILIES}
BY_FOLDER: dict[str, FamilySpec] = {f.folder: f for f in FAMILIES}


def get(label: str | None) -> FamilySpec | None:
    return BY_LABEL.get(label) if label else None


def from_folder(folder: str | None) -> FamilySpec | None:
    return BY_FOLDER.get(folder) if folder else None


# --- Derived maps -----------------------------------------------------------
# These keep the exact names, shapes and contents they had when they were
# hand-written, so every existing call site is untouched. tests/test_families.py
# pins them against the pre-refactor literals.

FAMILY_MAP: dict[str, str] = {f.label: f.folder for f in FAMILIES}

FAMILY_COMPAT: dict[str, set[str]] = {f.label: f.compat for f in FAMILIES if f.selectable}

CN_MODEL_MAP: dict[str, dict[str, str]] = {f.folder: f.cn_models for f in FAMILIES}

CN_SUBFOLDER: dict[str, str] = {f.folder: f.cn_subfolder for f in FAMILIES}

MODEL_FAMILIES: list[str] = [f.label for f in FAMILIES if f.selectable]
