"""Tests for resolving ControlNet files per family (#254, #364).

Anima and Z-Image ControlNets are model patches living in
``models/model_patches/<subfolder>/``; SDXL ones stay in ``models/controlnet/``.
Stubs ``folder_paths`` with a per-category file list and loads ``flake_io``
under a synthetic package (same approach as the other tests).
"""
import importlib.util
import os
import sys
import types

FILES = {
    "controlnet": [
        "sdxl/controlnet_depth_sdxl.safetensors",
        "sdxl/controlnet-scribble-sdxl-1.0.safetensors",
    ],
    "model_patches": [
        "anima/anima-lllite-depth-1.safetensors",
        "anima/anima-lllite-pose-1.safetensors",
        "zimage/Z-Image-Turbo-Fun-Controlnet-Union-2.1.safetensors",
        "flat-anima-lllite-lineart-1.safetensors",
    ],
}


def _load_flake_io():
    fp = types.ModuleType("folder_paths")
    fp.get_filename_list = lambda category: list(FILES.get(category, []))
    fp.base_path = os.getcwd()
    sys.modules["folder_paths"] = fp

    pkg = types.ModuleType("_fpkg_cnres")
    pkg.__path__ = [os.path.dirname(os.path.dirname(os.path.abspath(__file__)))]
    sys.modules["_fpkg_cnres"] = pkg

    here = os.path.dirname(os.path.abspath(__file__))
    src = os.path.join(os.path.dirname(here), "flake_io.py")
    spec = importlib.util.spec_from_file_location("_fpkg_cnres.flake_io", src)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["_fpkg_cnres.flake_io"] = mod
    spec.loader.exec_module(mod)
    return mod


fio = _load_flake_io()


def _resolve(cn_type, folder, category):
    return fio.resolve_cn_model_name(fio.infer_cn_model(cn_type, folder), folder, category)


def test_sdxl_still_resolves_in_controlnet():
    assert _resolve("depth", "illustrious", "controlnet") == "sdxl/controlnet_depth_sdxl.safetensors"
    assert _resolve("scribble", "sdxl", "controlnet") == "sdxl/controlnet-scribble-sdxl-1.0.safetensors"


def test_default_category_is_controlnet():
    assert fio.resolve_cn_model_name("controlnet_depth_sdxl", "sdxl") == "sdxl/controlnet_depth_sdxl.safetensors"


def test_anima_resolves_versioned_lllite_in_model_patches():
    assert _resolve("depth", "anima", "model_patches") == "anima/anima-lllite-depth-1.safetensors"
    assert _resolve("openpose", "anima", "model_patches") == "anima/anima-lllite-pose-1.safetensors"


def test_zimage_types_resolve_to_union_file():
    for folder in ("zib", "zit"):
        for cn_type in ("depth", "openpose", "canny"):
            assert _resolve(cn_type, folder, "model_patches") == \
                "zimage/Z-Image-Turbo-Fun-Controlnet-Union-2.1.safetensors"


def test_explicit_name_outside_subfolder_falls_back_to_global():
    got = fio.resolve_cn_model_name("flat-anima-lllite-lineart-1", "anima", "model_patches")
    assert got == "flat-anima-lllite-lineart-1.safetensors"


def test_patch_family_does_not_pick_up_controlnet_folder():
    # A missing LLLite file must not silently resolve to an SDXL controlnet.
    assert _resolve("lineart", "anima", "model_patches") == "anima-lllite-lineart"


if __name__ == "__main__":
    for fname, fn in sorted(globals().items()):
        if fname.startswith("test_") and callable(fn):
            fn()
            print(f"PASS {fname}")
    print("\nALL PASSED")
