"""Tests for flake options and togglers (#462): `prompt_options` on flakes and
variant choices resolve into `Flake.options`, grid items override them with
`option_overrides`, and `_join_prompts` lets a downstream flake's `toggler`
switch the options of every flake before it, across chained nodes. flake_io
and full_flake_node are the real modules, loaded like test_anim_preset_nodes.py."""
import importlib.util
import os
import sys
import types

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PKG = "_fpkg_prompt_options"


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
    for name in ("comfy", "comfy.sd", "comfy.utils", "comfy.model_management",
                 "comfy.ldm", "comfy.ldm.modules", "comfy.ldm.modules.attention"):
        sys.modules.setdefault(name, types.ModuleType(name))
    # Other test modules stub `nodes` too; only add what is missing.
    nodes = sys.modules.setdefault("nodes", types.ModuleType("nodes"))
    for attr in ("CLIPTextEncode", "EmptyLatentImage", "ControlNetApplyAdvanced", "ControlNetLoader", "LoraLoader"):
        if not hasattr(nodes, attr):
            setattr(nodes, attr, object)
    pkg = types.ModuleType(PKG)
    pkg.__path__ = [ROOT]
    sys.modules[PKG] = pkg
    return _load("flake_io"), _load("full_flake_node")


fio, ffn = _setup()

AHRI = {
    "prompt": {"positive": "ahri, fox ears"},
    "prompt_options": [{"name": "face", "positive": "golden eyes", "default": True}],
    "variants": {"skin": {"classic": {
        "default": True,
        "positive": "classic skin",
        "prompt_options": [
            {"name": "tails", "positive": "nine tails", "default": True},
            {"name": "front", "positive": "chest bow"},
        ],
    }, "arcade": {"positive": "arcade skin"}}},
}


def _with_flakes(raw_map):
    fio.load_flake = lambda name: fio._flake_from_raw(name, raw_map[name])


def _states(flake):
    return {n: o.on for n, o in flake.options.items()}


def _join(*stacks):
    """Chain `_join_prompts` over stacks of resolved flakes, like FlakeStack nodes."""
    pos, parts = "masterpiece", None
    for flakes in stacks:
        pos, _, parts = ffn._join_prompts(pos, "", flakes, parts)
    return pos


def test_toggler_parsing():
    assert fio._parse_toggler({"toggler": " -tails, face,, +front , -, abc"}) == [
        ("tails", False), ("face", True), ("front", True), ("abc", True)]
    assert fio._parse_toggler({}) == []


def test_flake_and_choice_options_resolve_with_defaults():
    _with_flakes({"ahri": AHRI})
    flake = fio.resolve({"name": "ahri"})
    assert _states(flake) == {"face": True, "tails": True, "front": False}
    assert flake.positive == "ahri, fox ears, classic skin"
    assert _states(fio.resolve({"name": "ahri", "variant": {"skin": "arcade"}})) == {"face": True}


def test_option_overrides_and_unknown_names():
    _with_flakes({"ahri": AHRI})
    flake = fio.resolve({"name": "ahri", "option_overrides": {"tails": False, "front": True, "abc": True}})
    assert _states(flake) == {"face": True, "tails": False, "front": True}


def test_linked_options_join_host_and_host_names_win():
    _with_flakes({
        "host": {"prompt_options": [{"name": "face", "positive": "host face"}],
                 "flake_links": [{"target": "ahri"}]},
        "ahri": AHRI,
    })
    flake = fio.resolve({"name": "host", "option_overrides": {"tails": False}})
    assert flake.options["face"].positive == "host face"
    assert _states(flake) == {"face": False, "tails": False, "front": False}


def test_no_options_keeps_the_joined_text():
    _with_flakes({"a": {"prompt": {"positive": " a "}}, "b": {"prompt": {"positive": "b", "negative": "n"}}})
    pos, neg, _ = ffn._join_prompts(" base ", "neg", [fio.resolve({"name": "a"}), fio.resolve({"name": "b"})], None)
    assert (pos, neg) == ("base BREAK a BREAK b", "neg, n")


def test_downstream_toggler_switches_upstream_options():
    _with_flakes({
        "ahri": AHRI,
        "pose": {"prompt": {"positive": "from behind"}, "variants": {"view": {
            "back": {"toggler": "-face, -front"},
            "front": {"positive": "facing viewer", "toggler": "-tails, +front, abc"},
        }}},
    })
    ahri = fio.resolve({"name": "ahri"})
    assert _join([ahri]) == "masterpiece BREAK ahri, fox ears, classic skin, golden eyes, nine tails"
    back = fio.resolve({"name": "pose", "variant": {"view": "back"}})
    assert _join([ahri], [back]) == "masterpiece BREAK ahri, fox ears, classic skin, nine tails BREAK from behind"
    front = fio.resolve({"name": "pose", "variant": {"view": "front"}})
    assert _join([ahri], [front]) == (
        "masterpiece BREAK ahri, fox ears, classic skin, golden eyes, chest bow BREAK from behind, facing viewer")
    # Same node: a later entry toggles an earlier one's options too.
    assert _join([ahri, back]) == _join([ahri], [back])


def test_toggler_does_not_touch_its_own_options():
    _with_flakes({"f": {"prompt_options": [{"name": "x", "positive": "xx", "default": True}], "toggler": "-x"}})
    assert _join([fio.resolve({"name": "f"})]) == "masterpiece BREAK xx"


def test_parts_reused_only_while_they_render_the_incoming_text():
    _with_flakes({"ahri": AHRI, "pose": {"toggler": "-face"}})
    pos, _, parts = ffn._join_prompts("", "", [fio.resolve({"name": "ahri"})], None)
    pose = fio.resolve({"name": "pose"})
    assert "golden eyes" not in ffn._join_prompts(pos, "", [pose], parts)[0]
    # A node in between rewrote the text: the options are frozen into it.
    rewritten = f"{pos} BREAK inpaint"
    assert ffn._join_prompts(rewritten, "", [pose], parts)[0] == rewritten


def test_upstream_parts_are_not_mutated():
    _with_flakes({"ahri": AHRI, "pose": {"toggler": "-face"}})
    pos, _, parts = ffn._join_prompts("", "", [fio.resolve({"name": "ahri"})], None)
    ffn._join_prompts(pos, "", [fio.resolve({"name": "pose"})], parts)
    assert parts[1][1]["face"] == ["golden eyes", True]
