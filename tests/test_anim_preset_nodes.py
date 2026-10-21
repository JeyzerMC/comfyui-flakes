"""Tests for the Flake Animate Preset node's loading (#430): which file each
core loader gets, LoRA routing to the high/low models, and per-instance
overrides; and for the Flake Animate Stack composing animate flakes on top
(#432). The core loaders and the LoRA loader are stubbed to record calls;
flake_io and full_flake_node are the real modules, loaded like
test_anim_presets.py / test_filename_prefix.py."""
import contextlib
import importlib.util
import json
import os
import sys
import tempfile
import types

import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PKG = "_fpkg_anim_nodes"


def _load(modname):
    spec = importlib.util.spec_from_file_location(f"{PKG}.{modname}", os.path.join(ROOT, f"{modname}.py"))
    mod = importlib.util.module_from_spec(spec)
    sys.modules[f"{PKG}.{modname}"] = mod
    spec.loader.exec_module(mod)
    return mod


def _setup():
    fp = types.ModuleType("folder_paths")
    fp.get_filename_list = lambda category: []
    fp.get_full_path = lambda category, name: None
    fp.get_folder_paths = lambda category: []
    fp.base_path = os.getcwd()
    fp.folder_names_and_paths = {}
    sys.modules["folder_paths"] = fp
    for name in ("comfy", "comfy.sd", "comfy.utils", "comfy.model_management", "comfy_api", "comfy_api.latest"):
        sys.modules.setdefault(name, types.ModuleType(name))
    sys.modules["comfy_api.latest"].io = types.SimpleNamespace()

    nodes = types.ModuleType("nodes")
    for attr in ("CLIPTextEncode", "EmptyLatentImage", "ControlNetApplyAdvanced", "ControlNetLoader", "LoraLoader"):
        setattr(nodes, attr, object)
    sys.modules["nodes"] = nodes

    pkg = types.ModuleType(PKG)
    pkg.__path__ = [ROOT]
    sys.modules[PKG] = pkg
    compose = types.ModuleType(f"{PKG}.flake_compose")
    # Models are tuples of the file they were loaded from plus applied LoRAs.
    compose._load_lora = lambda model, clip, path, sm, sc: (model + ((path, sm),), clip)
    sys.modules[f"{PKG}.flake_compose"] = compose

    fio = _load("flake_io")
    _load("full_flake_node")
    return nodes, fio, _load("flake_anim_nodes")


nodes, fio, anim = _setup()


class _Loader:
    def __init__(self, method):
        setattr(self, method, lambda *args: ((method,) + args,))


nodes.NODE_CLASS_MAPPINGS = {
    "UNETLoader": lambda: _Loader("load_unet"),
    "CLIPLoader": lambda: _Loader("load_clip"),
    "VAELoader": lambda: _Loader("load_vae"),
}


def _preset(**kw):
    base = dict(steps=4, cfg=1.0, sampler="euler", scheduler="simple", fps=16, duration=5.0, resolution="720p")
    return fio.AnimPreset(**{**base, **kw})


def _data(preset, overrides=""):
    fio.load_anim_preset = lambda name: preset
    return anim.FlakeAnimPreset().execute(preset.family, preset.name, overrides)[0]


def test_wan22_loads_high_low_and_routes_loras():
    d = _data(_preset(
        name="anim/wan22/fennec", family="wan22", clip_type="WAN", filename_prefix="fennec/",
        diffusion_model_high="high.safetensors", diffusion_model_low="low.safetensors",
        text_encoder="umt5.safetensors", vae="wan_vae.safetensors", positive=" tail wag ",
        loras=[
            fio.LoraEntry(name="speed", path="hi_lora", path_low="lo_lora", strength=0.8),
            fio.LoraEntry(name="style", path="style_lora", strength=0.5),
        ],
    ))
    assert d["models"] == {
        "high": ("load_unet", "high.safetensors", "default", ("hi_lora", 0.8), ("style_lora", 0.5)),
        "low": ("load_unet", "low.safetensors", "default", ("lo_lora", 0.8)),
    }
    assert d["clip"] == ("load_clip", "umt5.safetensors", "wan")
    assert d["vae"] == ("load_vae", "wan_vae.safetensors")
    assert d["audio_vae"] is None and d["image"] is None
    assert (d["family"], d["pos_text"], d["neg_text"]) == ("wan22", "tail wag", "")
    assert d["preset"]["refiner_step"] is None and d["preset"]["steps"] == 4
    fs = d["filename_state"]
    assert fs["stems"] == ["anim/wan22/", "fennec/"]
    assert (fs["checkpoint"], fs["model_family"]) == ("high.safetensors", "Wan 2.2")
    assert [lr["name"] for lr in fs["loras"]] == ["speed", "style"]


def test_mh3_loads_audio_vae_and_single_model():
    d = _data(_preset(
        name="anim/mh3/clip", family="mh3", clip_type="MINIMAX", diffusion_model="mh3.safetensors",
        text_encoder="qwen3vl.safetensors", vae="video_vae.safetensors", audio_vae="audio_vae.safetensors",
        loras=[fio.LoraEntry(path="lora", path_low="ignored", strength=1.0)],
    ))
    assert d["models"] == {"model": ("load_unet", "mh3.safetensors", "default", ("lora", 1.0))}
    assert d["clip"] == ("load_clip", "qwen3vl.safetensors", "minimax")
    assert d["audio_vae"] == ("load_vae", "audio_vae.safetensors")
    assert d["filename_state"]["stems"] == ["anim/mh3/"]


def test_missing_model_field_is_a_clear_error():
    try:
        _data(_preset(name="anim/mh3/x", family="mh3", clip_type="MINIMAX", text_encoder="t", vae="v", audio_vae="a"))
    except ValueError as exc:
        assert "diffusion_model" in str(exc)
    else:
        raise AssertionError("expected ValueError")


def test_overrides_apply_to_preset_and_stems():
    p = _preset(name="anim/mh3/x", family="mh3", clip_type="MINIMAX", diffusion_model="m",
                text_encoder="t", vae="v", audio_vae="a")
    d = _data(p, json.dumps({"steps": 8, "cfg": "", "scheduler": "beta", "filename_prefix": "take2"}))
    assert (d["preset"]["steps"], d["preset"]["cfg"], d["preset"]["scheduler"]) == (8, 1.0, "beta")
    assert d["filename_state"]["stems"] == ["anim/mh3/", "take2"]
    assert _data(p)["preset"]["steps"] == 4


@contextlib.contextmanager
def _flakes(files):
    """Temp flakes root holding ``files`` ({name: yaml data})."""
    with tempfile.TemporaryDirectory() as tmp:
        fio.folder_paths.folder_names_and_paths["flakes"] = ([tmp], {".yaml", ".yml"})
        for name, data in files.items():
            path = os.path.join(tmp, f"{name}.yaml")
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w", encoding="utf-8") as f:
                yaml.safe_dump(data, f)
        yield


def _anim_data(models, stems):
    return {
        "family": "wan22", "preset": {}, "models": models, "clip": "clip", "vae": "vae", "audio_vae": None,
        "image": None, "pos_text": "a fennec girl", "neg_text": "blurry",
        "filename_state": {"preset": "", "stems": stems, "loras": [{"name": "speed"}], "model_family": "Wan 2.2"},
    }


def _stack(data, entries, image=None):
    return anim.FlakeAnimStack().execute("Wan 2.2", data, json.dumps(entries), image)[0]


def test_stack_routes_flake_loras_and_joins_prompts():
    files = {
        "anim/wan22/tail": {
            "prompt": {"positive": "swishing her fluffy tail", "negative": "static"},
            "output_stem": "tail",
            "loras": [{"name": "swish", "path": "swish_hi", "path_low": "swish_lo", "strength": 1.0}],
            "variants": {"mood": {"happy": {"positive": "smiling", "output_stem": "happy",
                                            "loras": [{"path": "smile_hi", "strength": 0.6}]}}},
        },
        "anim/wan22/off": {"prompt": {"positive": "never"}, "loras": [{"path": "never"}]},
    }
    data = _anim_data({"high": ("H",), "low": ("L",)}, ["anim/wan22/"])
    with _flakes(files):
        out = _stack(data, [
            {"inline": True, "content": {"prompt": {"positive": "blue eyes"}}},
            {"name": "anim/wan22/tail", "loras": [0.5], "variant": {"mood": "happy"}},
            {"name": "anim/wan22/off", "bypassed": True},
        ])
    assert out["models"] == {"high": ("H", ("swish_hi", 0.5), ("smile_hi", 0.6)), "low": ("L", ("swish_lo", 0.5))}
    assert out["pos_text"] == "a fennec girl BREAK blue eyes BREAK swishing her fluffy tail, smiling"
    assert out["neg_text"] == "blurry, static"
    fs = out["filename_state"]
    assert fs["stems"] == ["anim/wan22/", "tail_happy"]
    assert [lr["name"] for lr in fs["loras"]] == ["speed", "swish", "smile_hi"]
    assert (out["clip"], out["image"], fs["model_family"]) == ("clip", None, "Wan 2.2")
    # The incoming data is left as it was.
    assert data["models"] == {"high": ("H",), "low": ("L",)}
    assert (data["filename_state"]["stems"], len(data["filename_state"]["loras"])) == (["anim/wan22/"], 1)


def test_stack_single_model_follows_flake_links_and_replaces_image():
    files = {
        "anim/mh3/host": {"loras": [{"path": "host", "path_low": "ignored", "strength": 0.8}],
                          "flake_links": [{"target": "anim/mh3/style"}]},
        "anim/mh3/style": {"prompt": {"positive": "watercolor"}, "loras": [{"path": "style", "strength": 0.4}]},
    }
    data = {**_anim_data({"model": ("M",)}, []), "image": "upstream"}
    with _flakes(files):
        out = _stack(data, [{"name": "anim/mh3/host"}], image="start")
        kept = _stack(data, [])
    assert out["models"] == {"model": ("M", ("host", 0.8), ("style", 0.4))}
    assert out["pos_text"] == "a fennec girl BREAK watercolor"
    assert out["image"] == "start" and kept["image"] == "upstream"
    assert kept["models"] == data["models"] and kept["pos_text"] == "a fennec girl"
