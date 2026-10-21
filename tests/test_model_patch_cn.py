"""Tests for model-patch ControlNets: Anima LLLite and Z-Image Fun (#365), and
Anima VACE routed to the ComfyUI-Advanced-ControlNet-Anima fork (#378).

Stubs the ComfyUI runtime (including ``comfy_extras.nodes_model_patch``) and
loads the sources under a synthetic package, matching test_preset_loader.py.
Runs ``FlakeStack.execute`` end to end and records what reaches the core
ControlNet / model-patch nodes.

Run directly (``python tests/test_model_patch_cn.py``) or via pytest.
"""
import importlib.machinery
import importlib.util
import json
import logging
import os
import sys
import types


PKG = "flakes_under_test_patch_cn"

FILES = {"controlnet": [], "model_patches": []}
MTIMES = {}
HEADERS = {}
NODE_MAPPINGS = {}
CALLS = {"patch_load": [], "lllite": [], "zimage": [], "cn_load": [], "cn_apply": [],
         "acn_load": [], "acn_apply": []}

ACN_PKG = "fake_acn.adv_control"


class FakeModel(str):
    """A MODEL stand-in that compares by name; flow-model sigmas = 1 - percent."""

    def get_model_object(self, name):
        assert name == "model_sampling"
        return types.SimpleNamespace(percent_to_sigma=lambda p: 1.0 - p)


class ACNLoader:
    def load_controlnet(self, cnet, _tk_opt=None):
        CALLS["acn_load"].append(cnet)
        return (f"ACN({cnet})",)


class ACNApply:
    def apply_controlnet(self, positive, negative, control_net, image, strength, start_percent, end_percent,
                         mask_optional=None, vae_optional=None):
        CALLS["acn_apply"].append((control_net, image, strength, start_percent, end_percent, vae_optional))
        return (positive + [["VACE", {}]], negative)


ACNLoader.__module__ = ACNApply.__module__ = f"{ACN_PKG}.nodes_main"


def _install_acn(with_vace):
    for name in ("fake_acn", ACN_PKG):
        mod = types.ModuleType(name)
        mod.__path__ = []
        sys.modules[name] = mod
    sys.modules.pop(f"{ACN_PKG}.control_anima_vace", None)
    if with_vace:
        vace = types.ModuleType(f"{ACN_PKG}.control_anima_vace")
        vace.__spec__ = importlib.machinery.ModuleSpec(vace.__name__, None)
        sys.modules[vace.__name__] = vace
    NODE_MAPPINGS["ACN_ControlNetLoaderAdvanced"] = ACNLoader
    NODE_MAPPINGS["ACN_AdvancedControlNetApply_v2"] = ACNApply


def _stub_externals():
    fp = types.ModuleType("folder_paths")
    fp.get_filename_list = lambda cat: list(FILES.get(cat, []))
    fp.get_full_path_or_raise = lambda cat, name: f"/fake/{cat}/{name}"
    fp.get_input_directory = lambda: "/fake/input"
    fp.base_path = "/fake"
    sys.modules["folder_paths"] = fp

    for name in ("numpy", "torch"):
        if name not in sys.modules:
            sys.modules[name] = types.ModuleType(name)
    if "PIL" not in sys.modules:
        pil = types.ModuleType("PIL")
        pil.Image = types.SimpleNamespace(open=None)
        pil.ImageOps = types.SimpleNamespace(exif_transpose=None)
        sys.modules["PIL"] = pil
        sys.modules["PIL.Image"] = pil.Image
        sys.modules["PIL.ImageOps"] = pil.ImageOps

    comfy = types.ModuleType("comfy")
    comfy.sd = types.ModuleType("comfy.sd")
    comfy.utils = types.ModuleType("comfy.utils")
    sys.modules["comfy"] = comfy
    sys.modules["comfy.sd"] = comfy.sd
    sys.modules["comfy.utils"] = comfy.utils
    comfy.utils.safetensors_header = lambda path: HEADERS.get(path)
    # No scheduled LoRAs here, so carry_schedules sees no hooks.
    comfy.hooks = types.ModuleType("comfy.hooks")
    comfy.hooks.HookGroup = types.SimpleNamespace(combine_all_hooks=lambda groups: None)
    comfy.hooks.set_hooks_for_conditioning = lambda cond, hooks, append_hooks=True: cond
    sys.modules["comfy.hooks"] = comfy.hooks
    sys.modules["node_helpers"] = types.ModuleType("node_helpers")

    class CLIPTextEncode:
        def encode(self, clip, text):
            return ([[f"COND({text})", {}]],)

    class EmptyLatentImage:
        def generate(self, w, h, b):
            return ({"samples": f"latent{w}x{h}"},)

    class ControlNetLoader:
        def load_controlnet(self, name):
            CALLS["cn_load"].append(name)
            return (f"CN({name})",)

    class ControlNetApplyAdvanced:
        def apply_controlnet(self, pos, neg, cn, image, strength, start, end):
            CALLS["cn_apply"].append((cn, strength, start, end))
            return pos + [["CTRL", {}]], neg

    nodes = types.ModuleType("nodes")
    nodes.CLIPTextEncode = CLIPTextEncode
    nodes.EmptyLatentImage = EmptyLatentImage
    nodes.ControlNetLoader = ControlNetLoader
    nodes.ControlNetApplyAdvanced = ControlNetApplyAdvanced
    nodes.LoraLoader = type("LoraLoader", (), {})
    nodes.NODE_CLASS_MAPPINGS = NODE_MAPPINGS
    sys.modules["nodes"] = nodes

    class ModelPatchLoader:
        def load_model_patch(self, name):
            CALLS["patch_load"].append(name)
            return (object(),)

    class AnimaLLLiteApply:
        def apply_patch(self, model, model_patch, image, strength, start_percent, end_percent):
            CALLS["lllite"].append((model, model_patch, image, strength, start_percent, end_percent))
            return (FakeModel(f"{model}+lllite"),)

    class ZImageFunControlnet:
        def diffsynth_controlnet(self, model, model_patch, vae, image=None, strength=1.0):
            CALLS["zimage"].append((model, model_patch, vae, image, strength))
            return (f"{model}+zfun",)

    extras = types.ModuleType("comfy_extras")
    nmp = types.ModuleType("comfy_extras.nodes_model_patch")
    nmp.ModelPatchLoader = ModelPatchLoader
    nmp.AnimaLLLiteApply = AnimaLLLiteApply
    nmp.ZImageFunControlnet = ZImageFunControlnet
    extras.nodes_model_patch = nmp
    sys.modules["comfy_extras"] = extras
    sys.modules["comfy_extras.nodes_model_patch"] = nmp


_stub_externals()


def _load(name):
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if PKG not in sys.modules:
        pkg = types.ModuleType(PKG)
        pkg.__path__ = [root]
        sys.modules[PKG] = pkg
    full = f"{PKG}.{name}"
    if full in sys.modules:
        return sys.modules[full]
    spec = importlib.util.spec_from_file_location(full, os.path.join(root, f"{name}.py"))
    mod = importlib.util.module_from_spec(spec)
    sys.modules[full] = mod
    spec.loader.exec_module(mod)
    return mod


flake_io = _load("flake_io")
flake_compose = _load("flake_compose")
full_flake_node = _load("full_flake_node")

flake_compose._load_cn_image = lambda name: f"IMG({name})"
flake_compose._fit_cn_image = lambda image, w, h: f"{image}@{w}x{h}"
flake_compose.os = types.SimpleNamespace(path=types.SimpleNamespace(
    getmtime=lambda p: MTIMES.get(p.rsplit("/", 1)[-1], 1.0)))


def _reset():
    for v in CALLS.values():
        v.clear()
    for v in FILES.values():
        v.clear()
    MTIMES.clear()
    HEADERS.clear()
    NODE_MAPPINGS.clear()
    flake_compose._CN_PATCH_CACHE.clear()


def _cn(cn_type="depth", **kw):
    base = dict(type=cn_type, model_name="", image_name="pose_a", strength=0.8,
                start_percent=0.1, end_percent=0.9)
    base.update(kw)
    return flake_io.ControlNetEntry(**base)


def _run(model_family, *flake_cns, upstream_family=None):
    flakes = {f"f{i}": flake_io.Flake(name=f"f{i}", controlnets=list(cns)) for i, cns in enumerate(flake_cns)}
    flake_io.resolve = lambda e: flakes[e["name"]]
    flake_data = (
        (FakeModel("BASE_MODEL"), "CLIP", "VAE"),
        ([["P", {}]], [["N", {}]], {"samples": "l"}, 1024, 1024, "", "", {"stems": [], "model_family": upstream_family}),
        (30, 4.0, "euler", "simple", 1.0),
    )
    entries = [{"name": n} for n in flakes]
    import json
    return full_flake_node.FlakeStack().execute(model_family, flake_data, json.dumps(entries))[0]


def test_anima_depth_patches_model_with_lllite():
    _reset()
    FILES["model_patches"].append("anima/anima-lllite-depth-1.safetensors")
    out = _run("Anima/Base", [_cn("depth")])
    (model, _clip, _vae), gen, _ = out
    assert model == "BASE_MODEL+lllite"
    assert CALLS["patch_load"] == ["anima/anima-lllite-depth-1.safetensors"]
    m, _patch, image, strength, start, end = CALLS["lllite"][0]
    assert (m, image, strength, start, end) == ("BASE_MODEL", "IMG(pose_a)@1024x1024", 0.8, 0.1, 0.9)
    # Conditioning is untouched — no SDXL ControlNet involved.
    assert not CALLS["cn_load"] and not CALLS["cn_apply"]
    assert gen[0] == [["COND()", {}]]


def test_multiple_anima_cns_chain_on_the_model():
    _reset()
    FILES["model_patches"] += ["anima/anima-lllite-depth-1.safetensors", "anima/anima-lllite-pose-1.safetensors"]
    out = _run("Anima/Base", [_cn("depth")], [_cn("openpose", image_name="pose_b")])
    assert out[0][0] == "BASE_MODEL+lllite+lllite"
    assert [c[0] for c in CALLS["lllite"]] == ["BASE_MODEL", "BASE_MODEL+lllite"]


def test_zimage_passes_vae_and_strength():
    _reset()
    FILES["model_patches"].append("zimage/Z-Image-Turbo-Fun-Controlnet-Union-2.1.safetensors")
    out = _run("ZImage/Turbo", [_cn("canny", start_percent=0.0, end_percent=1.0)])
    assert out[0][0] == "BASE_MODEL+zfun"
    m, _patch, vae, image, strength = CALLS["zimage"][0]
    assert (m, vae, image, strength) == ("BASE_MODEL", "VAE", "IMG(pose_a)@1024x1024", 0.8)


def test_preset_family_wins_over_stale_widget():
    # A reroute/subgraph leaves the widget on SDXL/Base; the family recorded by
    # the preset loader must still route Anima CNs to LLLite (#382).
    _reset()
    FILES["model_patches"].append("anima/anima-lllite-depth-1.safetensors")
    out = _run("SDXL/Base", [_cn("depth")], upstream_family="Anima/Base")
    assert out[0][0] == "BASE_MODEL+lllite"
    assert not CALLS["cn_load"] and not CALLS["cn_apply"]


def test_sdxl_path_unchanged():
    _reset()
    FILES["controlnet"].append("sdxl/controlnet_depth_sdxl.safetensors")
    out = _run("SDXL/Illustrious", [_cn("depth")])
    assert out[0][0] == "BASE_MODEL"
    assert CALLS["cn_load"] == ["sdxl/controlnet_depth_sdxl.safetensors"]
    assert CALLS["cn_apply"][0][1:] == (0.8, 0.1, 0.9)
    assert not CALLS["patch_load"] and not CALLS["lllite"]


def test_zero_strength_and_missing_image_are_skipped():
    _reset()
    FILES["model_patches"].append("anima/anima-lllite-depth-1.safetensors")
    out = _run("Anima/Base", [_cn("depth", strength=0), _cn("depth", image_name=" ")])
    assert out[0][0] == "BASE_MODEL"
    assert not CALLS["patch_load"]


def test_patch_reused_across_combo_runs():
    _reset()
    FILES["model_patches"].append("anima/anima-lllite-depth-1.safetensors")
    _run("Anima/Base", [_cn("depth", image_name="pose_a")])
    _run("Anima/Base", [_cn("depth", image_name="pose_b")])
    _run("Anima/Base", [_cn("depth", image_name="pose_c")])
    assert CALLS["patch_load"] == ["anima/anima-lllite-depth-1.safetensors"]
    patches = {c[1] for c in CALLS["lllite"]}
    assert len(patches) == 1


def test_patch_reloads_when_file_changes():
    _reset()
    name = "anima/anima-lllite-depth-1.safetensors"
    flake_compose.load_cn_patch(name)
    MTIMES["anima-lllite-depth-1.safetensors"] = 2.0
    flake_compose.load_cn_patch(name)
    assert CALLS["patch_load"] == [name, name]


def test_patch_cache_is_bounded_lru():
    _reset()
    names = [f"p{i}.safetensors" for i in range(flake_compose._CN_PATCH_CACHE_SIZE + 1)]
    for n in names:
        flake_compose.load_cn_patch(n)
    assert names[0] not in flake_compose._CN_PATCH_CACHE
    assert list(flake_compose._CN_PATCH_CACHE) == names[1:]
    # Touching the oldest survivor makes it most recent.
    flake_compose.load_cn_patch(names[1])
    assert list(flake_compose._CN_PATCH_CACHE)[-1] == names[1]


VACE_FILE = "anima/Anima-ControlNet-VACE-Depth.safetensors"


def _add_vace_file(keys=("control_blocks.0.after_proj.weight", "control_blocks.0.attn.weight")):
    FILES["controlnet"].append(VACE_FILE)
    HEADERS[f"/fake/controlnet/{VACE_FILE}"] = json.dumps({k: {} for k in keys}).encode()


def test_anima_vace_routes_to_fork_with_vae():
    _reset()
    _install_acn(with_vace=True)
    _add_vace_file()
    FILES["model_patches"].append("anima/anima-lllite-depth-1.safetensors")
    out = _run("Anima/Base", [_cn("depth", model_name="Anima-ControlNet-VACE-Depth")])
    (model, _clip, _vae), gen, _ = out
    assert CALLS["acn_load"] == [VACE_FILE]
    assert CALLS["acn_apply"] == [(f"ACN({VACE_FILE})", "IMG(pose_a)@1024x1024", 0.8, 0.1, 0.9, "VAE")]
    assert gen[0][-1] == ["VACE", {}]
    # Conditioning-level control: the model is not patched.
    assert model == "BASE_MODEL"
    assert not CALLS["patch_load"] and not CALLS["lllite"]


def test_anima_lllite_stays_default_when_vace_file_present():
    _reset()
    _install_acn(with_vace=True)
    _add_vace_file()
    FILES["model_patches"].append("anima/anima-lllite-depth-1.safetensors")
    out = _run("Anima/Base", [_cn("depth")])
    assert out[0][0] == "BASE_MODEL+lllite"
    assert not CALLS["acn_load"]


def test_anima_controlnet_file_without_vace_keys_uses_lllite():
    _reset()
    _install_acn(with_vace=True)
    _add_vace_file(keys=("lllite_unet.weight",))
    FILES["model_patches"].append("anima/anima-lllite-depth-1.safetensors")
    out = _run("Anima/Base", [_cn("depth", model_name="Anima-ControlNet-VACE-Depth")])
    assert out[0][0] == "BASE_MODEL+lllite"
    assert not CALLS["acn_load"]


def _vace_error():
    try:
        _run("Anima/Base", [_cn("depth", model_name="Anima-ControlNet-VACE-Depth")])
    except RuntimeError as exc:
        return str(exc)
    return None


def test_anima_vace_without_fork_errors():
    _reset()
    _add_vace_file()
    assert "ComfyUI-Advanced-ControlNet-Anima" in (_vace_error() or "")


def test_anima_vace_with_upstream_acn_errors():
    _reset()
    _install_acn(with_vace=False)
    _add_vace_file()
    assert "ComfyUI-Advanced-ControlNet-Anima" in (_vace_error() or "")
    assert not CALLS["acn_load"]


LLLITE_FILES = ["anima/anima-lllite-depth-1.safetensors", "anima/anima-lllite-any-test-like-v2.safetensors"]


def test_anima_explicit_lllite_file_wins_over_type():
    _reset()
    FILES["model_patches"] += LLLITE_FILES
    out = _run("Anima/Base", [_cn("depth", model_name="anima/anima-lllite-any-test-like-v2.safetensors")])
    assert out[0][0] == "BASE_MODEL+lllite"
    assert CALLS["patch_load"] == ["anima/anima-lllite-any-test-like-v2.safetensors"]


def test_anima_explicit_vace_wins_over_type():
    _reset()
    _install_acn(with_vace=True)
    _add_vace_file()
    FILES["model_patches"] += LLLITE_FILES
    out = _run("Anima/Base", [_cn("depth", model_name=VACE_FILE)])
    assert out[0][0] == "BASE_MODEL"
    assert CALLS["acn_load"] == [VACE_FILE]
    assert not CALLS["patch_load"]


def test_anima_stale_model_falls_back_to_type():
    _reset()
    FILES["model_patches"] += LLLITE_FILES + ["zimage/Z-Image-Turbo-Fun-Controlnet-Union-2.1.safetensors"]
    FILES["controlnet"].append("sdxl/controlnet_depth_sdxl.safetensors")
    for stale in ("controlnet_depth_sdxl", "Z-Image-Turbo-Fun-Controlnet-Union-2.1", "anima/deleted.safetensors"):
        CALLS["patch_load"].clear()
        flake_compose._CN_PATCH_CACHE.clear()
        out = _run("Anima/Base", [_cn("depth", model_name=stale)])
        assert out[0][0] == "BASE_MODEL+lllite"
        assert CALLS["patch_load"] == ["anima/anima-lllite-depth-1.safetensors"], stale


def test_explicit_model_ignored_with_type_outside_anima():
    _reset()
    FILES["controlnet"] += ["sdxl/controlnet_depth_sdxl.safetensors", "sdxl/other_depth.safetensors"]
    _run("SDXL/Base", [_cn("depth", model_name="other_depth")])
    assert CALLS["cn_load"] == ["sdxl/controlnet_depth_sdxl.safetensors"]


def test_anima_cn_files_lists_lllite_and_vace():
    _reset()
    _add_vace_file()
    FILES["controlnet"] += ["anima/not-vace.safetensors", "sdxl/controlnet_depth_sdxl.safetensors"]
    HEADERS["/fake/controlnet/anima/not-vace.safetensors"] = json.dumps({"x.weight": {}}).encode()
    FILES["model_patches"] += LLLITE_FILES + ["zimage/Z-Image-Turbo-Fun-Controlnet-Union-2.1.safetensors"]
    assert flake_compose.anima_cn_files() == [{"name": n, "kind": "lllite"} for n in LLLITE_FILES] + [
        {"name": VACE_FILE, "kind": "vace"}]


def _logged_run(*args):
    records = []
    handler = logging.Handler()
    handler.emit = records.append
    logger = logging.getLogger()
    level = logger.level
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    try:
        _run(*args)
    finally:
        logger.removeHandler(handler)
        logger.setLevel(level)
    return [r.getMessage() for r in records if r.getMessage().startswith("[flakes] Anima")]


def test_anima_patch_logs_file_kind_and_sigma_range():
    _reset()
    _install_acn(with_vace=True)
    _add_vace_file()
    FILES["model_patches"] += LLLITE_FILES
    lines = _logged_run("Anima/Base", [_cn("depth"), _cn("depth", model_name=VACE_FILE)])
    assert lines == [
        "[flakes] Anima lllite anima/anima-lllite-depth-1.safetensors image=pose_a fit=1024x1024 "
        "strength=0.80 start=0.10 end=0.90 sigma=0.900..0.100",
        f"[flakes] Anima vace {VACE_FILE} image=pose_a fit=1024x1024 "
        "strength=0.80 start=0.10 end=0.90 sigma=0.900..0.100",
    ]


if __name__ == "__main__":
    for fname, fn in sorted(globals().items()):
        if fname.startswith("test_") and callable(fn):
            fn()
            print(f"PASS {fname}")
    print("\nALL PASSED")
