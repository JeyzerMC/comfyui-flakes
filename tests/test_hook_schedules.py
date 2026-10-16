"""Tests for applying LoRA and prompt hook schedules at sampling (#370).

Stubs the ComfyUI runtime (including ``comfy.hooks`` and ``node_helpers``) and
loads the sources under a synthetic package, matching test_model_patch_cn.py.
Runs ``FlakeStack.execute`` end to end, including two chained nodes.
"""
import importlib.util
import json
import os
import sys
import types


PKG = "flakes_under_test_hook_schedules"

LORAS = ["a.safetensors", "b.safetensors"]
CALLS = {"lora": [], "cn_apply": []}


class HookKeyframe:
    def __init__(self, strength, start_percent=0.0, guarantee_steps=1):
        self.strength = strength
        self.start_percent = start_percent


class HookKeyframeGroup:
    def __init__(self):
        self.keyframes = []

    def add(self, keyframe):
        self.keyframes.append(keyframe)


class Hook:
    def __init__(self, lora, strength_model, strength_clip):
        self.lora = lora
        self.strength_model = strength_model
        self.strength_clip = strength_clip
        self.keyframes = None


class HookGroup:
    def __init__(self):
        self.hooks = []

    def add(self, hook):
        if hook not in self.hooks:
            self.hooks.append(hook)

    def set_keyframes_on_hooks(self, hook_kf):
        for hook in self.hooks:
            hook.keyframes = hook_kf

    @staticmethod
    def combine_all_hooks(hooks_list):
        actual = [g for g in hooks_list if g is not None]
        if not actual:
            return None
        combined = HookGroup()
        for group in actual:
            for hook in group.hooks:
                combined.add(hook)
        return combined


def _create_hook_lora(lora, strength_model, strength_clip):
    group = HookGroup()
    group.add(Hook(lora, strength_model, strength_clip))
    return group


def _set_hooks_for_conditioning(cond, hooks, append_hooks=True):
    if hooks is None:
        return cond
    return [[t[0], {**t[1], "hooks": hooks}] for t in cond]


def _stub_externals():
    fp = types.ModuleType("folder_paths")
    fp.get_filename_list = lambda cat: list(LORAS) if cat == "loras" else []
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
    comfy.utils.load_torch_file = lambda path, safe_load=False: {"sd": path}
    comfy.hooks = types.ModuleType("comfy.hooks")
    comfy.hooks.HookKeyframe = HookKeyframe
    comfy.hooks.HookKeyframeGroup = HookKeyframeGroup
    comfy.hooks.HookGroup = HookGroup
    comfy.hooks.create_hook_lora = _create_hook_lora
    comfy.hooks.set_hooks_for_conditioning = _set_hooks_for_conditioning
    sys.modules["comfy"] = comfy
    sys.modules["comfy.sd"] = comfy.sd
    sys.modules["comfy.utils"] = comfy.utils
    sys.modules["comfy.hooks"] = comfy.hooks

    nh = types.ModuleType("node_helpers")
    nh.conditioning_set_values = lambda cond, values={}, append=False: [[t[0], {**t[1], **values}] for t in cond]
    sys.modules["node_helpers"] = nh

    class CLIPTextEncode:
        def encode(self, clip, text):
            return ([[f"COND({text})", {}]],)

    class EmptyLatentImage:
        def generate(self, w, h, b):
            return ({"samples": f"latent{w}x{h}"},)

    class LoraLoader:
        def load_lora(self, model, clip, name, strength_model, strength_clip):
            CALLS["lora"].append((name, strength_model, strength_clip))
            return (f"{model}+{name}", f"{clip}+{name}")

    class ControlNetLoader:
        def load_controlnet(self, name):
            return (f"CN({name})",)

    class ControlNetApplyAdvanced:
        def apply_controlnet(self, pos, neg, cn, image, strength, start, end):
            CALLS["cn_apply"].append(cn)
            return ([[t[0], {**t[1], "control": cn}] for t in pos],
                    [[t[0], {**t[1], "control": cn}] for t in neg])

    nodes = types.ModuleType("nodes")
    nodes.CLIPTextEncode = CLIPTextEncode
    nodes.EmptyLatentImage = EmptyLatentImage
    nodes.LoraLoader = LoraLoader
    nodes.ControlNetLoader = ControlNetLoader
    nodes.ControlNetApplyAdvanced = ControlNetApplyAdvanced
    sys.modules["nodes"] = nodes


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
flake_compose._fit_cn_image = lambda image, w, h: image

KF = flake_io.ScheduleKeyframe
HALF = [KF(0.0, 1.0), KF(0.5, 0.0)]

BASE_DATA = (
    ("MODEL", "CLIP", "VAE"),
    ([["P", {}]], [["N", {}]], {"samples": "l"}, 1024, 1024, "", "", {"stems": []}),
    (30, 4.0, "euler", "simple"),
)


def _run(flakes, flake_data=BASE_DATA, family="SDXL/Illustrious"):
    by_name = {f.name: f for f in flakes}
    flake_io.resolve = lambda e: by_name[e["name"]]
    entries = [{"name": f.name} for f in flakes]
    return full_flake_node.FlakeStack().execute(family, flake_data, json.dumps(entries))[0]


def _reset():
    for v in CALLS.values():
        v.clear()


def _hooks(cond):
    return [t[1].get("hooks") for t in cond]


def test_schedule_segments():
    seg = flake_compose.schedule_segments
    assert seg([]) == [(0.0, 1.0, 1.0)]
    assert seg(HALF) == [(0.0, 0.5, 1.0), (0.5, 1.0, 0.0)]
    # Strength is 1.0 before the first keyframe.
    assert seg([KF(0.3, 0.5)]) == [(0.0, 0.3, 1.0), (0.3, 1.0, 0.5)]
    assert seg([KF(0.2, 0.0), KF(1.0, 1.0)]) == [(0.0, 0.2, 1.0), (0.2, 1.0, 0.0)]


def test_unscheduled_lora_stays_static():
    _reset()
    out = _run([flake_io.Flake(name="f", loras=[flake_io.LoraEntry(path="a", strength=0.7)])])
    (model, clip, _vae), gen, _ = out
    assert CALLS["lora"] == [("a.safetensors", 0.7, 0.7)]
    assert (model, clip) == ("MODEL+a.safetensors", "CLIP+a.safetensors")
    assert _hooks(gen[0]) == [None] and _hooks(gen[1]) == [None]


def test_scheduled_lora_hooks_model_and_applies_clip_statically():
    _reset()
    out = _run([flake_io.Flake(name="f", loras=[flake_io.LoraEntry(path="a", strength=0.8, schedule=HALF)])])
    _bundle, gen, _ = out
    assert CALLS["lora"] == [("a.safetensors", 0, 0.8)]
    pos_hooks, neg_hooks = _hooks(gen[0]), _hooks(gen[1])
    (hook,) = pos_hooks[0].hooks
    assert neg_hooks[0].hooks == [hook]
    assert hook.lora == {"sd": "/fake/loras/a.safetensors"}
    assert (hook.strength_model, hook.strength_clip) == (0.8, 0.0)
    assert [(k.start_percent, k.strength) for k in hook.keyframes.keyframes] == [(0.0, 1.0), (0.5, 0.0)]
    assert gen[7]["loras"] == [{"name": "a", "path": "a", "strength": 0.8}]


def test_lora_scheduled_off_everywhere_is_skipped():
    _reset()
    out = _run([flake_io.Flake(name="f", loras=[flake_io.LoraEntry(path="a", schedule=[KF(0.0, 0.0)])])])
    _bundle, gen, _ = out
    assert CALLS["lora"] == []
    assert _hooks(gen[0]) == [None]
    assert gen[7]["loras"] == []


def test_scheduled_prompt_becomes_ranged_entries():
    _reset()
    flake = flake_io.Flake(name="f", positive="cat", scheduled_prompts=[
        flake_io.PromptEntry(positive="sunset", negative="day", schedule=[KF(0.3, 0.5), KF(0.8, 0.0)]),
    ])
    _bundle, gen, _ = _run([flake])
    assert gen[0] == [
        ["COND(cat)", {}],
        ["COND(sunset)", {"start_percent": 0.0, "end_percent": 0.3, "strength": 1.0}],
        ["COND(sunset)", {"start_percent": 0.3, "end_percent": 0.8, "strength": 0.5}],
    ]
    assert [t[0] for t in gen[1]] == ["COND()", "COND(day)", "COND(day)"]
    # Scheduled text is not folded into the plain prompt text.
    assert gen[5] == "cat"


def test_controlnet_reaches_ranged_entries():
    _reset()
    flake = flake_io.Flake(
        name="f",
        scheduled_prompts=[flake_io.PromptEntry(positive="sunset", schedule=HALF)],
        controlnets=[flake_io.ControlNetEntry(type="", model_name="cn_depth", image_name="img")],
    )
    _bundle, gen, _ = _run([flake])
    assert len(gen[0]) == 2
    assert all(t[1]["control"] == "CN(cn_depth)" for t in gen[0])


def test_chained_nodes_keep_upstream_ranged_entries_and_hooks():
    _reset()
    first = flake_io.Flake(
        name="first", positive="cat",
        loras=[flake_io.LoraEntry(path="a", schedule=HALF)],
        scheduled_prompts=[flake_io.PromptEntry(positive="sunset", schedule=HALF)],
    )
    second = flake_io.Flake(
        name="second", positive="hat",
        loras=[flake_io.LoraEntry(path="b", schedule=[KF(0.5, 1.0)])],
    )
    upstream = _run([first])
    _bundle, gen, _ = _run([second], flake_data=upstream)

    assert [t[0] for t in gen[0]] == ["COND(cat BREAK hat)", "COND(sunset)"]
    assert gen[0][1][1]["end_percent"] == 0.5
    for cond in (gen[0], gen[1]):
        for hooks in _hooks(cond):
            assert sorted(h.lora["sd"] for h in hooks.hooks) == ["/fake/loras/a.safetensors", "/fake/loras/b.safetensors"]


def test_chain_without_schedules_unchanged():
    _reset()
    upstream = _run([flake_io.Flake(name="first", positive="cat")])
    _bundle, gen, _ = _run([flake_io.Flake(name="second", positive="hat")], flake_data=upstream)
    assert gen[0] == [["COND(cat BREAK hat)", {}]]
    assert gen[1] == [["COND()", {}]]


if __name__ == "__main__":
    failures = 0
    for fname, fn in sorted(globals().items()):
        if fname.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"PASS {fname}")
            except Exception as exc:  # noqa: BLE001
                failures += 1
                print(f"FAIL {fname}: {type(exc).__name__}: {exc}")
    print(f"\n{('ALL PASSED' if not failures else str(failures) + ' FAILED')}")
    sys.exit(1 if failures else 0)
