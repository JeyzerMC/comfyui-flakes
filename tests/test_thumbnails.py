"""Tests for the cached cover thumbnails (#451): downscaled WebP files in the
temp dir, reused until the cover changes. Needs Pillow (a ComfyUI dependency)."""
import importlib.util
import os
import sys
import tempfile
import types

import pytest

Image = pytest.importorskip("PIL.Image")


def _load_flake_thumbs(temp_dir):
    fp = types.ModuleType("folder_paths")
    fp.get_temp_directory = lambda: temp_dir
    sys.modules["folder_paths"] = fp

    here = os.path.dirname(os.path.abspath(__file__))
    spec = importlib.util.spec_from_file_location("_flake_thumbs", os.path.join(os.path.dirname(here), "flake_thumbs.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_thumbnail_is_cached_until_the_cover_changes():
    with tempfile.TemporaryDirectory() as tmp:
        thumbs = _load_flake_thumbs(os.path.join(tmp, "temp"))
        cover = os.path.join(tmp, "fennec.png")
        Image.new("RGBA", (800, 400), (240, 200, 90, 255)).save(cover)

        first = thumbs.thumbnail(cover, 256)
        assert os.path.dirname(first) == os.path.join(tmp, "temp", "flakes_thumbs")
        with Image.open(first) as img:
            assert (img.format, img.size) == ("WEBP", (256, 128))
        mtime = os.path.getmtime(first)
        assert thumbs.thumbnail(cover, 256) == first
        assert os.path.getmtime(first) == mtime
        assert thumbs.thumbnail(cover, 128) != first

        Image.new("RGB", (300, 600), (90, 140, 240)).save(cover)
        changed = thumbs.thumbnail(cover, 256)
        assert changed != first
        with Image.open(changed) as img:
            assert img.size == (128, 256)
        assert not [f for f in os.listdir(os.path.dirname(first)) if f.endswith(".tmp")]
