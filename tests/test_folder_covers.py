"""Tests for the Load picker's folder cover thumbnails (#424).

A folder shows its first favorited flake's cover, else its first flake's,
else its first subfolder's; flakes without a cover are skipped. Same loading
approach as test_variant_defaults.py.
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

    pkg = types.ModuleType("_fpkg_fc")
    pkg.__path__ = [os.path.dirname(os.path.dirname(os.path.abspath(__file__)))]
    sys.modules["_fpkg_fc"] = pkg

    here = os.path.dirname(os.path.abspath(__file__))
    src = os.path.join(os.path.dirname(here), "flake_io.py")
    spec = importlib.util.spec_from_file_location("_fpkg_fc.flake_io", src)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["_fpkg_fc.flake_io"] = mod
    spec.loader.exec_module(mod)
    return mod


fio = _load_flake_io()


def _covers(names, dirs, favorites=(), covered=None):
    covered = set(names) if covered is None else set(covered)
    fio.read_cover = lambda name: (b"img", "image/png") if name in covered else None
    return fio.list_folder_covers(names, dirs, list(favorites))


def test_first_flake_in_folder():
    assert _covers(["a/zed", "a/Bob", "a/carl"], ["a"]) == {"a": "a/Bob"}


def test_favorite_wins():
    assert _covers(["a/bob", "a/carl"], ["a"], favorites=["a/carl"]) == {"a": "a/carl"}


def test_flakes_without_cover_are_skipped():
    assert _covers(["a/bob", "a/carl"], ["a"], favorites=["a/bob"], covered=["a/carl"]) == {"a": "a/carl"}


def test_falls_back_to_first_subfolder_recursively():
    names = ["a/y/deep/eve", "a/z/zoe"]
    dirs = ["a", "a/y", "a/y/deep", "a/z"]
    assert _covers(names, dirs) == {"a": "a/y/deep/eve", "a/y": "a/y/deep/eve", "a/y/deep": "a/y/deep/eve", "a/z": "a/z/zoe"}


def test_direct_flake_beats_subfolder():
    assert _covers(["a/b/bob", "a/zed"], ["a", "a/b"])["a"] == "a/zed"


def test_empty_folders_have_no_cover():
    assert _covers(["a/bob"], ["a", "empty", "a/nocover"], covered=[]) == {}
