"""Tests for Flake Generate Animation (#434): video size and frame count per
family, and the core node pipeline each family runs. The core nodes are stubs
that record their calls; flake_anim_nodes and full_flake_node are the real
modules, loaded like test_anim_preset_nodes.py."""
import importlib.util
import os
import sys
import types

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PKG = "_fpkg_anim_generate"


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
    mm = sys.modules["comfy.model_management"]
    mm.EXTRA_RESERVED_VRAM = 100
    sys.modules["comfy"].model_management = mm
    sys.modules["comfy_api.latest"].io = types.SimpleNamespace(
        Hidden=types.SimpleNamespace(prompt="PROMPT", extra_pnginfo="EXTRA_PNGINFO"))

    nodes = types.ModuleType("nodes")
    for attr in ("CLIPTextEncode", "EmptyLatentImage", "ControlNetApplyAdvanced", "ControlNetLoader", "LoraLoader"):
        setattr(nodes, attr, object)
    sys.modules["nodes"] = nodes

    pkg = types.ModuleType(PKG)
    pkg.__path__ = [ROOT]
    sys.modules[PKG] = pkg
    compose = types.ModuleType(f"{PKG}.flake_compose")
    compose._load_lora = compose._load_cn_image = None
    sys.modules[f"{PKG}.flake_compose"] = compose

    _load("flake_io")
    _load("full_flake_node")
    return nodes, mm, _load("flake_anim_nodes")


nodes, mm, anim = _setup()
CALLS = []


class _Out:
    def __init__(self, *result, ui=None):
        self.result, self.ui = result, ui


def _v1(name, method):
    """A legacy node: instance method returning a 1-tuple of its name."""
    def run(*args, **kwargs):
        CALLS.append((name, args, kwargs, mm.EXTRA_RESERVED_VRAM))
        return (name,)
    return lambda: types.SimpleNamespace(**{method: run})


def _v3(name, outputs=1):
    """A V3 node: ``execute`` returning a NodeOutput-like result."""
    def execute(*args, **kwargs):
        CALLS.append((name, args, kwargs, mm.EXTRA_RESERVED_VRAM))
        return _Out(*([name] if outputs == 1 else [f"{name}{i}" for i in range(outputs)]))
    return types.SimpleNamespace(execute=execute)


def _save_video():
    def prepare(v3_data):
        def execute(*args):
            CALLS.append(("SaveVideo", args, v3_data["hidden_inputs"], mm.EXTRA_RESERVED_VRAM))
            return _Out(ui=types.SimpleNamespace(as_dict=lambda: {
                "images": [{"filename": "clip_00001_.mp4", "subfolder": "anim", "type": "output"}]}))
        return types.SimpleNamespace(execute=execute)
    return types.SimpleNamespace(PREPARE_CLASS_CLONE=prepare)


nodes.NODE_CLASS_MAPPINGS = {
    "ModelSamplingSD3": _v1("ModelSamplingSD3", "patch"),
    "CLIPTextEncode": _v1("CLIPTextEncode", "encode"),
    "KSamplerAdvanced": _v1("KSamplerAdvanced", "sample"),
    "KSampler": _v1("KSampler", "sample"),
    "VAEDecode": _v1("VAEDecode", "decode"),
    "WanImageToVideo": _v3("WanImageToVideo", 3),
    "MiniMaxH3SigmaShift": _v3("MiniMaxH3SigmaShift"),
    "MiniMaxH3ImageToVideo": _v3("MiniMaxH3ImageToVideo", 2),
    "VAEDecodeAudio": _v3("VAEDecodeAudio"),
    "UpscaleModelLoader": _v3("UpscaleModelLoader"),
    "ImageUpscaleWithModel": _v3("ImageUpscaleWithModel"),
    "FrameInterpolationModelLoader": _v3("FrameInterpolationModelLoader"),
    "FrameInterpolate": _v3("FrameInterpolate"),
    "CreateVideo": _v3("CreateVideo"),
    "SaveVideo": _save_video(),
}

IMAGE = types.SimpleNamespace(shape=(1, 600, 800, 3))


def _data(family, **preset):
    base = dict(steps=4, cfg=1.0, sampler="euler", scheduler="simple", fps=16, duration=5.0, resolution="720p",
                shift_high=5.0, shift_low=3.0, refiner_step=2, shift_video=10.0, shift_audio=3.0)
    models = {"high": "high", "low": "low"} if family == "wan22" else {"model": "model"}
    return {
        "family": family, "preset": {**base, **preset}, "models": models,
        "clip": "clip", "vae": "vae", "audio_vae": "audio_vae" if family == "mh3" else None,
        "image": IMAGE, "pos_text": "fennec ears twitch", "neg_text": "blurry",
        "filename_state": {"preset": "", "stems": [f"anim/{family}/", "fennec"]},
    }


def _run(data, **kw):
    CALLS.clear()
    return anim.FlakeGenerateAnimation().execute(data, 7, prompt={"1": {}}, extra_pnginfo={"workflow": {}}, **kw)


def _call(name):
    return [c for c in CALLS if c[0] == name]


def test_video_size_keeps_aspect_at_the_preset_short_edge():
    assert anim._video_size(IMAGE, "720p", 16) == (960, 720)
    assert anim._video_size(IMAGE, "720p", 32) == (960, 704)
    assert anim._video_size(IMAGE, "580p", 32) == (768, 576)
    assert anim._video_size(types.SimpleNamespace(shape=(1, 1920, 1080, 3)), "480p", 16) == (480, 848)


def test_timing_per_family():
    assert anim._timing("wan22", {"duration": 5.0, "fps": 16}) == (81, 16)
    assert anim._timing("wan22", {"duration": 3.0, "fps": 24}) == (73, 24)
    assert anim._timing("mh3", {"duration": 5.0, "fps": 30}) == (120, 24)


def test_wan22_pipeline():
    out = _run(_data("wan22"))
    assert [c[1][1] for c in _call("ModelSamplingSD3")] == [5.0, 3.0]
    assert [c[1][1] for c in _call("CLIPTextEncode")] == ["fennec ears twitch", "blurry"]
    (_, args, kwargs, _), = _call("WanImageToVideo")
    assert args[2:] == ("vae", 960, 720, 81, 1) and kwargs == {"start_image": IMAGE}
    high, low = _call("KSamplerAdvanced")
    assert high[1] == ("ModelSamplingSD3", "enable", 7, 4, 1.0, "euler", "simple",
                       "WanImageToVideo0", "WanImageToVideo1", "WanImageToVideo2", 0, 2, "enable")
    assert low[1][1:3] == ("disable", 7) and low[1][9:] == ("KSamplerAdvanced", 2, 10000, "disable")
    (_, args, _, _), = _call("CreateVideo")
    assert args == ("VAEDecode", 16, None)
    (_, args, hidden, _), = _call("SaveVideo")
    assert args[0] == "CreateVideo" and args[1].startswith("anim/wan22/") and args[1].endswith("_fennec")
    assert args[2] == "mp4" and hidden == {"PROMPT": {"1": {}}, "EXTRA_PNGINFO": {"workflow": {}}}
    assert out["ui"] == {"flake_videos": [{"filename": "clip_00001_.mp4", "subfolder": "anim", "type": "output"}],
                         "seed": [7]}


def test_mh3_pipeline_decodes_audio():
    _run(_data("mh3", fps=30))
    (_, args, _, _), = _call("MiniMaxH3SigmaShift")
    assert args == ("model", 10.0, 3.0)
    (_, args, kwargs, _), = _call("MiniMaxH3ImageToVideo")
    assert args == ("clip", "vae", "fennec ears twitch", 960, 704, 120) and kwargs == {"first_frame": IMAGE}
    (_, args, kwargs, _), = _call("KSampler")
    assert args[:3] == ("MiniMaxH3SigmaShift", 7, 4) and args[6:] == ("MiniMaxH3ImageToVideo0", "CLIPTextEncode", "MiniMaxH3ImageToVideo1")
    assert _call("VAEDecodeAudio")[0][2] == {"vae": "audio_vae", "samples": "KSampler"}
    assert _call("CreateVideo")[0][1] == ("VAEDecode", 24, "VAEDecodeAudio")


def test_headroom_applies_only_while_sampling():
    _run(_data("mh3"), use_headroom=True, headroom=2.0, upscale=True, upscale_model="4x.pth")
    assert _call("KSampler")[0][3] == 100 + 2 * 1024 ** 3
    assert _call("VAEDecodeAudio")[0][3] == 100 + 2 * 1024 ** 3
    assert _call("ImageUpscaleWithModel")[0][3] == 100
    assert mm.EXTRA_RESERVED_VRAM == 100


def test_upscale_and_interpolation_double_the_fps():
    _run(_data("wan22"), upscale=True, upscale_model="4x.pth", interpolate=True, interpolation_model="rife.pth")
    assert _call("UpscaleModelLoader")[0][1] == ("4x.pth",)
    assert _call("ImageUpscaleWithModel")[0][1] == ("UpscaleModelLoader", "VAEDecode")
    assert _call("FrameInterpolate")[0][1] == ("FrameInterpolationModelLoader", "ImageUpscaleWithModel", 2)
    assert _call("CreateVideo")[0][1] == ("FrameInterpolate", 32, None)


def test_toggles_off_ignore_their_models_and_headroom():
    _run(_data("wan22"), upscale_model="4x.pth", interpolation_model="rife.pth", headroom=2.0)
    assert _call("KSamplerAdvanced")[0][3] == 100
    assert not _call("UpscaleModelLoader") and not _call("FrameInterpolationModelLoader")
    assert _call("CreateVideo")[0][1] == ("VAEDecode", 16, None)


@pytest.mark.parametrize("toggle", ["upscale", "interpolate"])
def test_toggle_on_without_a_model_is_a_clear_error(toggle):
    with pytest.raises(ValueError, match="is on but no"):
        _run(_data("wan22"), **{toggle: True})
    assert CALLS == []


def test_missing_image_is_a_clear_error():
    data = _data("wan22")
    data["image"] = None
    with pytest.raises(ValueError, match="Flake Animate Stack/Combo grid item"):
        _run(data)
    assert CALLS == []
