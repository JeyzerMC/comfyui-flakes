"""Tests for variant output-stem combination (#347).

A variant choice's ``output_stem`` must combine with the flake's base stem as a
filename segment (``style_a`` + ``variant_b`` -> ``style_a_variant_b``), not a
folder (``style_a/variant_b``). ``flake_io`` is loaded under a synthetic package
with its external imports stubbed (same approach as test_filename_prefix.py).

Run directly (``python tests/test_variant_stem.py``) or via pytest.
"""
import importlib.util
import os
import sys
import types


def _load_flake_io():
    here = os.path.dirname(os.path.abspath(__file__))
    src = os.path.join(os.path.dirname(here), "flake_io.py")

    # Stub external imports used at module import time.
    sys.modules.setdefault("folder_paths", types.ModuleType("folder_paths"))
    if "yaml" not in sys.modules:
        try:
            import yaml  # noqa: F401
        except Exception:
            yaml_stub = types.ModuleType("yaml")
            yaml_stub.safe_load = lambda *a, **k: {}
            sys.modules["yaml"] = yaml_stub

    pkg = types.ModuleType("_flakepkg2")
    pkg.__path__ = []
    sys.modules["_flakepkg2"] = pkg
    spec = importlib.util.spec_from_file_location("_flakepkg2.flake_io", src)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["_flakepkg2.flake_io"] = mod
    spec.loader.exec_module(mod)
    return mod


_io = _load_flake_io()
_combine = _io._combine_variant_stem


def test_file_prefix_base_appends_with_underscore():
    # The reported bug: a file-prefix base must NOT become a folder.
    assert _combine("style_a", "variant_b") == "style_a_variant_b"


def test_folder_base_nests_variant():
    # An explicit folder base keeps the variant inside the folder.
    assert _combine("musashi/", "variant_b") == "musashi/variant_b"


def test_no_base_uses_variant_only():
    assert _combine(None, "variant_b") == "variant_b"
    assert _combine("", "variant_b") == "variant_b"


def test_variant_leading_slash_stripped():
    assert _combine("style_a", "/variant_b") == "style_a_variant_b"


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
