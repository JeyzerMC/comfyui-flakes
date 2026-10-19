"""Tests for default variant choices (#387).

A group with no selection applies its first choice when that choice has
`default: true`; "__none__" opts out. Same loading approach as
test_variant_extras.py.
"""
import importlib.util
import os
import sys
import types


def _load_flake_io():
    fp = types.ModuleType("folder_paths")
    fp.get_filename_list = lambda category: []
    fp.base_path = os.getcwd()
    sys.modules["folder_paths"] = fp

    pkg = types.ModuleType("_fpkg_vd")
    pkg.__path__ = [os.path.dirname(os.path.dirname(os.path.abspath(__file__)))]
    sys.modules["_fpkg_vd"] = pkg

    here = os.path.dirname(os.path.abspath(__file__))
    src = os.path.join(os.path.dirname(here), "flake_io.py")
    spec = importlib.util.spec_from_file_location("_fpkg_vd.flake_io", src)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["_fpkg_vd.flake_io"] = mod
    spec.loader.exec_module(mod)
    return mod


fio = _load_flake_io()


def _with_flakes(raw_map):
    fio.load_flake = lambda name: fio._flake_from_raw(name, raw_map[name])


POSE = {
    "name": "Pose",
    "prompt": {"positive": "base"},
    "variants": {
        "light": {"soft": {"positive": "soft light", "default": True}, "hard": {"positive": "hard light"}},
        "mood": {"calm": {"positive": "calm"}, "angry": {"positive": "angry", "default": True}},
    },
}


def test_default_applied_when_absent():
    _with_flakes({"pose": POSE})
    flake = fio.resolve({"name": "pose"})
    assert "soft light" in flake.positive
    assert "calm" not in flake.positive and "angry" not in flake.positive


def test_default_applied_when_empty():
    _with_flakes({"pose": POSE})
    flake = fio.resolve({"name": "pose", "variant": {"light": ""}})
    assert "soft light" in flake.positive


def test_explicit_choice_wins():
    _with_flakes({"pose": POSE})
    flake = fio.resolve({"name": "pose", "variant": {"light": "hard"}})
    assert "hard light" in flake.positive and "soft light" not in flake.positive


def test_none_skips_default():
    _with_flakes({"pose": POSE})
    flake = fio.resolve({"name": "pose", "variant": {"light": "__none__"}})
    assert flake.positive == "base"


def test_variant_defaults_only_first_choice():
    flake = fio._flake_from_raw("pose", POSE)
    assert fio.variant_defaults(flake) == {"light": "soft"}


def test_link_variant_beats_default():
    _with_flakes({
        "pose": POSE,
        "host": {"name": "Host", "flake_links": [{"target": "pose", "variant": {"light": "hard"}}]},
    })
    flake = fio.resolve({"name": "host"})
    assert "hard light" in flake.positive and "soft light" not in flake.positive


def test_link_gets_default():
    _with_flakes({"pose": POSE, "host": {"name": "Host", "flake_links": [{"target": "pose"}]}})
    flake = fio.resolve({"name": "host"})
    assert "soft light" in flake.positive


def test_link_empty_variant_gets_default():
    _with_flakes({"pose": POSE, "host": {"name": "Host", "flake_links": [{"target": "pose", "variant": {"light": ""}}]}})
    flake = fio.resolve({"name": "host"})
    assert "soft light" in flake.positive


def test_link_none_skips_default():
    # A link saved with "None" picked in the editor opts out of the target default (#419).
    _with_flakes({"pose": POSE, "host": {"name": "Host", "flake_links": [{"target": "pose", "variant": {"light": "__none__"}}]}})
    flake = fio.resolve({"name": "host"})
    assert flake.positive == "base"


def test_grid_override_beats_link_variant():
    _with_flakes({
        "pose": POSE,
        "host": {"name": "Host", "flake_links": [{"target": "pose", "variant": {"light": "hard"}}]},
    })
    flake = fio.resolve({"name": "host", "flake_link_overrides": [{"variant": {"light": "__none__"}}]})
    assert "light" not in flake.positive


if __name__ == "__main__":
    failures = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"PASS {name}")
            except AssertionError as exc:
                failures += 1
                print(f"FAIL {name}: {exc}")
            except Exception as exc:  # noqa: BLE001
                failures += 1
                print(f"ERROR {name}: {type(exc).__name__}: {exc}")
    print(f"\n{('ALL PASSED' if not failures else str(failures) + ' FAILED')}")
    sys.exit(1 if failures else 0)
