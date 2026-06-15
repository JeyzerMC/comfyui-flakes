"""Tests for filename-prefix building, including the ``**`` suffix syntax (#290).

``full_flake_node`` imports ComfyUI runtime modules at import time and uses
package-relative imports, and the package directory name contains a hyphen
(``comfyui-flakes``) which is not a valid module name. So we stub the external
modules and load the file under a synthetic package so its relative imports
resolve to stubs.

Run directly (``python tests/test_filename_prefix.py``) or via pytest.
"""
import datetime as _dt
import importlib.util
import os
import sys
import types


def _load_module():
    here = os.path.dirname(os.path.abspath(__file__))
    src = os.path.join(os.path.dirname(here), "full_flake_node.py")

    for name in ("folder_paths", "comfy", "comfy.sd", "comfy.utils"):
        sys.modules.setdefault(name, types.ModuleType(name))

    nodes = types.ModuleType("nodes")
    for attr in ("CLIPTextEncode", "EmptyLatentImage", "ControlNetApplyAdvanced",
                 "ControlNetLoader", "LoraLoader"):
        setattr(nodes, attr, object)
    sys.modules["nodes"] = nodes

    pkg = types.ModuleType("_flakepkg")
    pkg.__path__ = []
    sys.modules["_flakepkg"] = pkg
    flake_io = types.ModuleType("_flakepkg.flake_io")
    flake_io._resolve_model_name = lambda *a, **k: ""
    sys.modules["_flakepkg.flake_io"] = flake_io

    spec = importlib.util.spec_from_file_location("_flakepkg.full_flake_node", src)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["_flakepkg.full_flake_node"] = mod
    spec.loader.exec_module(mod)
    return mod


_mod = _load_module()


class _FixedClock:
    @staticmethod
    def now():
        return _dt.datetime(2026, 6, 15, 12, 30, 45)


def _build(preset, stems):
    # Patch the module-level datetime so output is deterministic.
    orig = _mod.datetime
    _mod.datetime = _FixedClock
    try:
        return _mod._build_filename_prefix(preset, stems)
    finally:
        _mod.datetime = orig


def test_split_plain_folder_and_file():
    # test/ok -> folder "test/", file prefix "ok"
    assert _mod._split_stem_for_filename("test/ok") == ("test/", "", "ok", "")


def test_split_file_suffix_only():
    # **ok -> file suffix "ok"
    assert _mod._split_stem_for_filename("**ok") == ("", "", "", "ok")


def test_split_file_prefix_and_suffix():
    # test/ok**abc -> folder prefix "test/", file prefix "ok", file suffix "abc"
    assert _mod._split_stem_for_filename("test/ok**abc") == ("test/", "", "ok", "abc")


def test_split_folder_suffix_and_file_prefix_suffix():
    # **test/ok**abc -> folder SUFFIX "test/", file prefix "ok", file suffix "abc"
    assert _mod._split_stem_for_filename("**test/ok**abc") == ("", "test/", "ok", "abc")


def test_split_plain_file():
    assert _mod._split_stem_for_filename("musashi") == ("", "", "musashi", "")


def test_split_plain_folder_only():
    assert _mod._split_stem_for_filename("characters/") == ("characters/", "", "", "")


def test_build_plain():
    assert _build("", ["test/ok"]) == "test/260615/123045_ok"


def test_build_file_suffix_orders_after_other_prefixes():
    # ok (prefix) from flake A, **zz (suffix) from flake B -> ok before zz.
    assert _build("", ["ok", "**zz"]) == "260615/123045_ok_zz"


def test_build_full_example():
    # test/ok (prefix) then **abc (suffix) -> time_ok_..._abc
    assert _build("", ["test/ok", "other", "**abc"]) == "test/260615/123045_ok_other_abc"


def test_build_folder_suffix_after_folder_prefix():
    # img/sdxl/ structural prefix + **series/ folder suffix -> img/sdxl/series/
    assert _build("", ["img/sdxl/", "**series/", "name"]) == "img/sdxl/series/260615/123045_name"


def test_build_no_double_star_regression():
    # No ** anywhere: identical structure to the legacy builder.
    assert _build("", ["img/sdxl/", "characters/", "musashi"]) == "img/sdxl/characters/260615/123045_musashi"


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
    print(f"\n{('ALL PASSED' if not failures else str(failures) + ' FAILED')}")
    sys.exit(1 if failures else 0)
