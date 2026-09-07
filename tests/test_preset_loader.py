"""Tests for the preset schema and the reworked model loader (#357, #358, #359, #361).

``full_flake_node`` imports ComfyUI runtime modules at import time and uses
package-relative imports, and the package directory name contains a hyphen
(``comfyui-flakes``) which is not a valid module name. So we stub the external
modules and load the sources under a synthetic package, matching
tests/test_filename_prefix.py.

No real model weights are touched: everything is faked at the ``comfy.sd``
boundary.

Run directly (``python tests/test_preset_loader.py``) or via pytest.
"""
import importlib.util
import os
import sys
import types


PKG = "flakes_under_test"


def _stub_externals():
    """Minimal stand-ins for the ComfyUI modules the sources import."""
    files = {"checkpoints": [], "diffusion_models": [], "vae": [], "text_encoders": [], "loras": []}

    fp = types.ModuleType("folder_paths")
    fp.get_filename_list = lambda cat: files.get(cat, [])
    fp.get_full_path = lambda cat, name: (
        os.path.abspath(__file__) if name in files.get(cat, []) else None
    )
    fp.get_folder_paths = lambda cat: ["/fake/embeddings"]
    fp.get_input_directory = lambda: "/fake/input"
    fp.base_path = "/fake"
    sys.modules["folder_paths"] = fp

    class CLIPType:
        STABLE_DIFFUSION = "STABLE_DIFFUSION"
        LUMINA2 = "LUMINA2"
        KREA2 = "KREA2"

        def __class_getitem__(cls, key):
            if not hasattr(cls, key) or key.startswith("_"):
                raise KeyError(key)
            return getattr(cls, key)

        @classmethod
        def __iter__(cls):
            return iter([])

    # Enum-ish: `for m in CLIPType` is only used to build an error message.
    class _CLIPTypeMeta(type):
        def __iter__(cls):
            return iter([types.SimpleNamespace(name=n) for n in
                         ("STABLE_DIFFUSION", "LUMINA2", "KREA2")])

        def __getitem__(cls, key):
            if key not in ("STABLE_DIFFUSION", "LUMINA2", "KREA2"):
                raise KeyError(key)
            return key

    CLIPType = _CLIPTypeMeta("CLIPType", (), {})

    calls = {"load_checkpoint": [], "load_diffusion_model": [], "load_clip": [], "vae": []}

    sd = types.ModuleType("comfy.sd")
    sd.CLIPType = CLIPType
    sd.calls = calls
    sd.checkpoint_result = None       # set per-test: (model, clip, vae, extra)
    sd.checkpoint_raises = None

    def load_checkpoint_guess_config(path, **kw):
        calls["load_checkpoint"].append(path)
        if sd.checkpoint_raises:
            raise sd.checkpoint_raises
        return sd.checkpoint_result

    def load_diffusion_model(path, **kw):
        calls["load_diffusion_model"].append(path)
        return "MODEL_FROM_UNET"

    def load_clip(ckpt_paths=None, embedding_directory=None, clip_type=None, **kw):
        calls["load_clip"].append({"paths": ckpt_paths, "clip_type": clip_type})
        return f"CLIP({clip_type})"

    class VAE:
        def __init__(self, sd=None):
            calls["vae"].append(sd)

        def __repr__(self):
            return "VAE_FROM_PRESET"

    sd.load_checkpoint_guess_config = load_checkpoint_guess_config
    sd.load_diffusion_model = load_diffusion_model
    sd.load_clip = load_clip
    sd.VAE = VAE

    utils = types.ModuleType("comfy.utils")
    utils.load_torch_file = lambda p, **kw: {"fake": "state_dict"}

    comfy = types.ModuleType("comfy")
    comfy.sd = sd
    comfy.utils = utils
    sys.modules["comfy"] = comfy
    sys.modules["comfy.sd"] = sd
    sys.modules["comfy.utils"] = utils

    class _Clip:
        def __init__(self, tag="CLIP"):
            self.tag = tag
            self.layers = []

        def clone(self):
            c = _Clip(self.tag)
            c.layers = list(self.layers)
            return c

        def clip_layer(self, n):
            self.layers.append(n)

    class CLIPTextEncode:
        def encode(self, clip, text):
            return ([[f"COND({text})", {}]],)

    class EmptyLatentImage:
        def generate(self, w, h, b):
            return ({"samples": f"latent{w}x{h}"},)

    class ConditioningZeroOut:
        def zero_out(self, conditioning):
            return ([["ZEROED", dict(t[1])] for t in conditioning],)

    # flake_compose imports these at module scope; only maybe_zero_out_negative
    # is under test here, and it touches none of them.
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

    nodes = types.ModuleType("nodes")
    nodes.CLIPTextEncode = CLIPTextEncode
    nodes.EmptyLatentImage = EmptyLatentImage
    nodes.ConditioningZeroOut = ConditioningZeroOut
    for extra in ("ControlNetApplyAdvanced", "ControlNetLoader", "LoraLoader",
                  "KSampler", "VAEDecode", "SaveImage"):
        setattr(nodes, extra, type(extra, (), {}))
    sys.modules["nodes"] = nodes

    return files, sd, _Clip


FILES, SD, FakeClip = _stub_externals()


def _load(name):
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.dirname(here)
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


flake_families = _load("flake_families")
flake_io = _load("flake_io")
full_flake_node = _load("full_flake_node")


# _install() monkeypatches load_preset; keep the real one so the schema tests
# (which run after the loader tests alphabetically) still exercise it.
_REAL_LOAD_PRESET = flake_io.load_preset


def _restore_load_preset():
    flake_io.load_preset = _REAL_LOAD_PRESET
    full_flake_node.flake_io.load_preset = _REAL_LOAD_PRESET


def _reset():
    for k in SD.calls:
        SD.calls[k].clear()
    SD.checkpoint_raises = None
    for k in FILES:
        FILES[k].clear()


def _preset(**kw):
    """A ModelPreset with sane required bits, overridable per test."""
    base = dict(name="t", checkpoint="", steps=8, cfg=1.0, width=1024, height=1024,
                positive="hello", negative="bad")
    base.update(kw)
    return flake_io.ModelPreset(**base)


def _install(preset):
    flake_io.load_preset = lambda n: preset
    full_flake_node.flake_io.load_preset = lambda n: preset


# --- Schema (#357) ----------------------------------------------------------

def test_new_fields_default_to_none():
    p = flake_io.ModelPreset(name="t", checkpoint="a.safetensors")
    assert p.diffusion_model is None
    assert p.clip_type is None
    assert p.shift is None


def test_model_source_prefers_diffusion_model():
    p = flake_io.ModelPreset(name="t", checkpoint="a.safetensors",
                             diffusion_model="b.safetensors")
    assert p.model_source == ("diffusion_models", "b.safetensors")


def test_model_source_falls_back_to_checkpoint():
    p = flake_io.ModelPreset(name="t", checkpoint="a.safetensors")
    assert p.model_source == ("checkpoints", "a.safetensors")


def test_model_source_errors_when_neither_set():
    p = flake_io.ModelPreset(name="lonely")
    try:
        p.model_source
    except ValueError as exc:
        assert "lonely" in str(exc)
        assert "diffusion_model" in str(exc)
    else:
        raise AssertionError("expected a ValueError")


def test_load_preset_reads_new_keys():
    _restore_load_preset()
    raw = {
        "checkpoint": "", "diffusion_model": "z.safetensors",
        "clip_type": "lumina2", "shift": 3.0,
        "prompt": {"positive": "p", "negative": "n"},
    }
    flake_io.read_preset_raw = lambda n: raw
    p = flake_io.load_preset("x")
    assert p.diffusion_model == "z.safetensors"
    assert p.clip_type == "LUMINA2"   # normalised to the CLIPType member name
    assert p.shift == 3.0


def test_load_preset_back_compat_without_new_keys():
    _restore_load_preset()
    """An existing SDXL preset yaml has none of the new keys."""
    raw = {
        "display_name": "Wai Illustrious V17",
        "checkpoint": "img/illustrious/wai/waiIllustriousSDXL_v170.safetensors",
        "clip_skip": -2, "vae": None, "text_encoder": None,
        "steps": 20, "cfg": 4, "sampler": "euler_ancestral", "scheduler": "normal",
        "width": 832, "height": 1216,
        "prompt": {"positive": "masterpiece", "negative": "bad quality"},
    }
    flake_io.read_preset_raw = lambda n: raw
    p = flake_io.load_preset("wai")
    assert (p.diffusion_model, p.clip_type, p.shift) == (None, None, None)
    assert p.clip_skip == -2
    assert (p.steps, p.cfg, p.sampler, p.scheduler) == (20, 4.0, "euler_ancestral", "normal")
    assert p.model_source[0] == "checkpoints"


# --- CLIPType resolution (#358) --------------------------------------------

def test_clip_type_from_preset_wins():
    fam = flake_families.BY_LABEL["Anima/Base"]           # declares STABLE_DIFFUSION
    assert full_flake_node._resolve_clip_type("lumina2", fam) == "LUMINA2"


def test_clip_type_falls_back_to_family():
    fam = flake_families.BY_LABEL["Krea2/Turbo"]
    assert full_flake_node._resolve_clip_type(None, fam) == "KREA2"


def test_clip_type_defaults_to_stable_diffusion():
    assert full_flake_node._resolve_clip_type(None, None) == "STABLE_DIFFUSION"


def test_unknown_clip_type_names_the_available_ones():
    try:
        full_flake_node._resolve_clip_type("nonsense", None)
    except ValueError as exc:
        assert "NONSENSE" in str(exc)
        assert "LUMINA2" in str(exc)
    else:
        raise AssertionError("expected a ValueError")


# --- Loader strategy (#358) -------------------------------------------------

def test_all_in_one_checkpoint_uses_checkpoint_path():
    _reset()
    FILES["checkpoints"].append("sdxl.safetensors")
    SD.checkpoint_result = ("MODEL", FakeClip(), "VAE_BAKED", None)
    _install(_preset(checkpoint="sdxl.safetensors", cfg=4.0))
    bundle, _gen, _samp = full_flake_node._load_preset_bundle("p", "SDXL/Illustrious")
    assert SD.calls["load_checkpoint"] and not SD.calls["load_diffusion_model"]
    assert not SD.calls["load_clip"]           # no external encoder needed
    assert bundle[0] == "MODEL" and bundle[2] == "VAE_BAKED"


def test_diffusion_model_field_uses_component_path():
    _reset()
    FILES["diffusion_models"].append("z_image_turbo.safetensors")
    FILES["text_encoders"].append("qwen_3_4b.safetensors")
    FILES["vae"].append("ae.safetensors")
    _install(_preset(diffusion_model="z_image_turbo.safetensors",
                     text_encoder="qwen_3_4b.safetensors", vae="ae.safetensors"))
    bundle, _gen, _samp = full_flake_node._load_preset_bundle("p", "ZImage/Turbo")
    assert SD.calls["load_diffusion_model"] and not SD.calls["load_checkpoint"]
    assert SD.calls["load_clip"][0]["clip_type"] == "LUMINA2"
    assert bundle[0] == "MODEL_FROM_UNET"


def test_unet_only_checkpoint_falls_back_to_preset_components():
    """The reported bug: a UNET-only file sitting in models/checkpoints/."""
    _reset()
    FILES["checkpoints"].append("cyberrealisticZImage_v40.safetensors")
    FILES["text_encoders"].append("qwen_3_4b_fp8.safetensors")
    FILES["vae"].append("ae.safetensors")
    # load_checkpoint_guess_config builds the model but has no clip/vae to give.
    SD.checkpoint_result = ("MODEL_FROM_CKPT", None, None, None)
    _install(_preset(checkpoint="cyberrealisticZImage_v40.safetensors",
                     text_encoder="qwen_3_4b_fp8.safetensors", vae="ae.safetensors"))
    bundle, _gen, _samp = full_flake_node._load_preset_bundle("p", "ZImage/Turbo")
    # The model built by the checkpoint call is kept — no second full load.
    assert bundle[0] == "MODEL_FROM_CKPT"
    assert not SD.calls["load_diffusion_model"]
    assert SD.calls["load_clip"][0]["clip_type"] == "LUMINA2"
    assert repr(bundle[2]) == "VAE_FROM_PRESET"


def test_unet_only_checkpoint_without_text_encoder_is_actionable():
    _reset()
    FILES["checkpoints"].append("bare.safetensors")
    SD.checkpoint_result = ("MODEL", None, None, None)
    _install(_preset(checkpoint="bare.safetensors"))
    try:
        full_flake_node._load_preset_bundle("p", "ZImage/Turbo")
    except ValueError as exc:
        assert "text_encoder" in str(exc)
    else:
        raise AssertionError("expected a ValueError naming the missing field")


def test_checkpoint_load_failure_is_not_masked_by_the_fallback():
    _reset()
    FILES["checkpoints"].append("corrupt.safetensors")
    SD.checkpoint_raises = RuntimeError("header too small")
    _install(_preset(checkpoint="corrupt.safetensors"))
    try:
        full_flake_node._load_preset_bundle("p", "ZImage/Turbo")
    except RuntimeError as exc:
        assert "header too small" in str(exc)
    else:
        raise AssertionError("a real load failure must propagate, not fall back")
    assert not SD.calls["load_diffusion_model"]


def test_missing_file_named_by_preset_fails_loudly():
    _reset()
    FILES["checkpoints"].append("ok.safetensors")
    SD.checkpoint_result = ("MODEL", FakeClip(), "VAE", None)
    _install(_preset(checkpoint="ok.safetensors", vae="gone.safetensors"))
    try:
        full_flake_node._load_preset_bundle("p", "SDXL/Base")
    except FileNotFoundError as exc:
        assert "gone.safetensors" in str(exc)
    else:
        raise AssertionError("a missing VAE must not be silently ignored")


# --- clip_skip gating (#359) ------------------------------------------------

def test_clip_skip_applied_for_sdxl():
    _reset()
    FILES["checkpoints"].append("sdxl.safetensors")
    clip = FakeClip()
    SD.checkpoint_result = ("MODEL", clip, "VAE", None)
    _install(_preset(checkpoint="sdxl.safetensors", clip_skip=-2, cfg=4.0))
    bundle, _gen, _samp = full_flake_node._load_preset_bundle("p", "SDXL/Illustrious")
    assert bundle[1].layers == [-2]


def test_clip_skip_skipped_for_qwen_families():
    _reset()
    FILES["checkpoints"].append("zit.safetensors")
    clip = FakeClip()
    SD.checkpoint_result = ("MODEL", clip, "VAE", None)
    # Presets carry clip_skip: -2 by default whether or not the family can use it.
    _install(_preset(checkpoint="zit.safetensors", clip_skip=-2))
    bundle, _gen, _samp = full_flake_node._load_preset_bundle("p", "ZImage/Turbo")
    assert bundle[1].layers == []


# --- cfg-driven negative zero-out (#359) ------------------------------------

flake_compose = _load("flake_compose")


def test_negative_kept_above_cfg_one():
    cond = [["COND", {"control": "CN"}]]
    assert flake_compose.maybe_zero_out_negative(cond, 4.0) is cond


def test_negative_zeroed_at_cfg_one():
    cond = [["COND", {"control": "CN"}]]
    out = flake_compose.maybe_zero_out_negative(cond, 1.0)
    assert out[0][0] == "ZEROED"


def test_zero_out_preserves_controlnet_key():
    cond = [["COND", {"control": "CN_OBJ", "control_apply_to_uncond": True}]]
    out = flake_compose.maybe_zero_out_negative(cond, 1.0)
    assert out[0][1]["control"] == "CN_OBJ"
    assert out[0][1]["control_apply_to_uncond"] is True


def test_zero_out_handles_none():
    assert flake_compose.maybe_zero_out_negative(None, 1.0) is None
    assert flake_compose.maybe_zero_out_negative([["C", {}]], None) is not None


def test_override_cfg_drives_the_decision_not_the_preset():
    """cfg can still change via overrides_json (#279), so the zero-out must read
    the post-override value."""
    bundle = ("M", "C", "V")
    gen = ("POS", [["COND", {}]], "LAT", 1024, 1024, "p", "n", {"stems": []})
    samp = (30, 4.0, "euler", "simple")          # preset says cfg 4
    _b, _g, samp2 = full_flake_node._apply_preset_overrides(
        '{"cfg": 1.0}', bundle, gen, samp)
    assert samp2[1] == 1.0
    out = flake_compose.maybe_zero_out_negative(gen[1], samp2[1])
    assert out[0][0] == "ZEROED"


if __name__ == "__main__":
    failures = 0
    for fname, fn in sorted(globals().items()):
        if fname.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"PASS {fname}")
            except Exception as exc:
                failures += 1
                print(f"FAIL {fname}: {type(exc).__name__}: {exc}")
    print(f"\n{failures} failure(s)")
    sys.exit(1 if failures else 0)
