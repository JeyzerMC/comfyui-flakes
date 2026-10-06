"""Tests for the model-family registry (#355, #356, #361).

``flake_families`` has no ComfyUI dependencies, so it loads directly — no
synthetic package needed, unlike the node modules.

Run directly (``python tests/test_families.py``) or via pytest.
"""
import importlib.util
import os
import sys


def _load_module():
    here = os.path.dirname(os.path.abspath(__file__))
    src = os.path.join(os.path.dirname(here), "flake_families.py")
    spec = importlib.util.spec_from_file_location("flake_families", src)
    mod = importlib.util.module_from_spec(spec)
    # Must be in sys.modules before exec: @dataclass resolves annotations
    # through sys.modules[cls.__module__].
    sys.modules["flake_families"] = mod
    spec.loader.exec_module(mod)
    return mod


F = _load_module()


# --- Refactor-equivalence pins ---------------------------------------------
# Literally what flake_io.py and full_flake_node.py contained before #355,
# minus the families added afterwards. This is what proves the registry did not
# quietly change the SDXL/Illustrious path everything else depends on.

_PRE_REFACTOR_FAMILY_MAP = {
    "SDXL/Base": "sdxl",
    "SDXL/Illustrious": "illustrious",
    "SDXL/Pony": "pony",
    "ZImage/Base": "zib",
    "ZImage/Turbo": "zit",
    "Anima/Base": "anima",
    "Flux/Klein": "flux_klein",
    "Common": "common",
}

_PRE_REFACTOR_FAMILY_COMPAT = {
    "SDXL/Base": {"common", "sdxl"},
    "SDXL/Illustrious": {"common", "sdxl", "illustrious"},
    "SDXL/Pony": {"common", "sdxl", "pony"},
    "ZImage/Base": {"common", "zib"},
    "ZImage/Turbo": {"common", "zit"},
    "Anima/Base": {"common", "anima"},
    "Flux/Klein": {"common", "flux_klein"},
}

_PRE_REFACTOR_CN_SUBFOLDER = {
    "sdxl": "sdxl",
    "illustrious": "sdxl",
    "pony": "sdxl",
    "common": "sdxl",
    "zib": "zimage",
    "zit": "zimage",
    "anima": "anima",
    "flux_klein": "flux",
}

_PRE_REFACTOR_CN_SUFFIX = {
    "sdxl": "sdxl",
    "illustrious": "sdxl",
    "pony": "sdxl",
    "common": "sdxl",
    "zib": "zib",
    "zit": "zib",
    "anima": "anima",
    "flux_klein": "flux",
}

_PRE_REFACTOR_MODEL_FAMILIES = [
    "SDXL/Base", "SDXL/Illustrious", "SDXL/Pony",
    "ZImage/Base", "ZImage/Turbo", "Anima/Base", "Flux/Klein",
]

# Families added after the refactor; excluded when comparing against the pins.
_ADDED_LABELS = {"Krea2/Turbo"}
_ADDED_FOLDERS = {"krea2"}

# Families whose ControlNets are model patches with their own names (#363).
_PATCH_CN_FOLDERS = {"zib", "zit", "anima"}


def _without_added(d, keys):
    return {k: v for k, v in d.items() if k not in keys}


def test_family_map_matches_pre_refactor():
    assert _without_added(F.FAMILY_MAP, _ADDED_LABELS) == _PRE_REFACTOR_FAMILY_MAP


def test_family_compat_matches_pre_refactor():
    assert _without_added(F.FAMILY_COMPAT, _ADDED_LABELS) == _PRE_REFACTOR_FAMILY_COMPAT


def test_cn_subfolder_matches_pre_refactor():
    assert _without_added(F.CN_SUBFOLDER, _ADDED_FOLDERS) == _PRE_REFACTOR_CN_SUBFOLDER


def test_cn_model_map_matches_pre_refactor():
    # Z-Image and Anima moved to model-patch ControlNets with their own file
    # names (#363); every other family keeps the original convention.
    expected = {
        folder: {t: f"controlnet_{t}_{suffix}" for t in F.CN_TYPES}
        for folder, suffix in _PRE_REFACTOR_CN_SUFFIX.items()
        if folder not in _PATCH_CN_FOLDERS
    }
    assert _without_added(F.CN_MODEL_MAP, _ADDED_FOLDERS | _PATCH_CN_FOLDERS) == expected


def test_model_families_matches_pre_refactor():
    assert [f for f in F.MODEL_FAMILIES if f not in _ADDED_LABELS] == _PRE_REFACTOR_MODEL_FAMILIES


# --- Registry invariants ----------------------------------------------------

def test_labels_and_folders_are_unique():
    labels = [f.label for f in F.FAMILIES]
    folders = [f.folder for f in F.FAMILIES]
    assert len(labels) == len(set(labels))
    # A duplicate folder would silently shadow a family in the reverse map.
    assert len(folders) == len(set(folders))


def test_label_folder_round_trip():
    for spec in F.FAMILIES:
        assert F.from_folder(spec.folder) is spec
        assert F.get(spec.label) is spec


def test_every_family_has_cn_coverage():
    for spec in F.FAMILIES:
        types = F.CN_MODEL_MAP[spec.folder].keys()
        if spec.cn_names:
            assert types == {t for t, _ in spec.cn_names}
            assert types <= set(F.CN_TYPES)
        else:
            assert types == set(F.CN_TYPES)
        assert F.CN_SUBFOLDER[spec.folder]


def test_cn_kind_and_category():
    for spec in F.FAMILIES:
        if spec.folder in _PATCH_CN_FOLDERS:
            assert spec.cn_category == "model_patches"
        else:
            assert spec.cn_kind == "controlnet"
            assert spec.cn_category == "controlnet"
    assert F.BY_LABEL["Anima/Base"].cn_kind == "anima_lllite"
    assert F.BY_LABEL["ZImage/Base"].cn_kind == "zimage_fun"
    assert F.BY_LABEL["ZImage/Turbo"].cn_kind == "zimage_fun"


def test_anima_cn_names_follow_kohya_lllite():
    assert F.CN_MODEL_MAP["anima"] == {
        "openpose": "anima-lllite-pose",
        "depth": "anima-lllite-depth",
        "lineart": "anima-lllite-lineart",
        "scribble": "anima-lllite-scribble",
    }


def test_zimage_types_share_the_union_file():
    for folder in ("zib", "zit"):
        assert set(F.CN_MODEL_MAP[folder].values()) == {"Z-Image-Turbo-Fun-Controlnet-Union"}


def test_common_is_not_selectable():
    # "Common" is a real folder for shared flakes but must never be offered as a
    # model_family choice.
    assert "Common" in F.FAMILY_MAP
    assert "Common" not in F.MODEL_FAMILIES
    assert "Common" not in F.FAMILY_COMPAT


def test_compat_always_includes_common_and_own_folder():
    for label, compat in F.FAMILY_COMPAT.items():
        assert "common" in compat
        assert F.FAMILY_MAP[label] in compat


def test_get_and_from_folder_handle_none():
    assert F.get(None) is None
    assert F.from_folder(None) is None
    assert F.get("Nope/Nope") is None


# --- Generation metadata (#356) --------------------------------------------

def test_sdxl_generation_defaults_unchanged():
    for label in ("SDXL/Base", "SDXL/Illustrious", "SDXL/Pony", "Flux/Klein", "Common"):
        spec = F.BY_LABEL[label]
        assert spec.clip_type == "STABLE_DIFFUSION"
        assert (spec.steps, spec.cfg) == (20, 4.0)
        assert (spec.sampler, spec.scheduler) == ("euler_ancestral", "normal")
        assert (spec.width, spec.height) == (832, 1216)
        assert spec.supports_clip_skip is True
        assert spec.default_shift is None


def test_new_families_match_shipped_templates():
    # From comfyui_workflow_templates_json: image_z_image_turbo,
    # image_krea2_turbo_t2i, image_anima_base_v1.
    expected = {
        "ZImage/Turbo": ("LUMINA2", 8, 1.0, "res_multistep", "simple", 3.0),
        "ZImage/Base": ("LUMINA2", 8, 1.0, "res_multistep", "simple", 3.0),
        "Krea2/Turbo": ("KREA2", 8, 1.0, "euler", "simple", 1.15),
        "Anima/Base": ("STABLE_DIFFUSION", 30, 4.0, "euler", "simple", 3.0),
    }
    for label, want in expected.items():
        spec = F.BY_LABEL[label]
        got = (spec.clip_type, spec.steps, spec.cfg, spec.sampler,
               spec.scheduler, spec.default_shift)
        assert got == want, f"{label}: {got} != {want}"
        # None of these encode with CLIP, so clip_layer() must never run.
        assert spec.supports_clip_skip is False
        assert (spec.width, spec.height) == (1024, 1024)


def test_krea2_is_registered_and_selectable():
    spec = F.BY_LABEL["Krea2/Turbo"]
    assert spec.folder == "krea2"
    assert spec.cn_subfolder == "krea2"
    assert F.CN_MODEL_MAP["krea2"]["depth"] == "controlnet_depth_krea2"
    assert "Krea2/Turbo" in F.MODEL_FAMILIES


def test_duplicate_folder_is_rejected():
    dupe = F.FamilySpec("Bogus/Dupe", "sdxl", cn_suffix="sdxl", cn_subfolder="sdxl")
    original = F.FAMILIES
    try:
        F.FAMILIES = original + (dupe,)
        try:
            F._check_unique()
        except ValueError as exc:
            assert "sdxl" in str(exc)
        else:
            raise AssertionError("_check_unique did not reject a duplicate folder")
    finally:
        F.FAMILIES = original


if __name__ == "__main__":
    failures = 0
    for fname, fn in sorted(globals().items()):
        if fname.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"PASS {fname}")
            except AssertionError as exc:
                failures += 1
                print(f"FAIL {fname}: {exc}")
    print(f"\n{failures} failure(s)")
    sys.exit(1 if failures else 0)
