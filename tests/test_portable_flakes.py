"""Tests for `./` paths relative to the flake yaml and the owned cover
location (#391). Same loading approach as test_variant_extras.py, with the
stub `folder_paths` pointing the flakes root at a temp dir."""
import contextlib
import importlib.util
import os
import sys
import tempfile
import types


def _load_flake_io():
    fp = types.ModuleType("folder_paths")
    fp.get_filename_list = lambda category: []
    fp.get_full_path = lambda category, name: None
    fp.base_path = os.getcwd()
    fp.folder_names_and_paths = {}
    sys.modules["folder_paths"] = fp

    pkg = types.ModuleType("_fpkg_pf")
    pkg.__path__ = [os.path.dirname(os.path.dirname(os.path.abspath(__file__)))]
    sys.modules["_fpkg_pf"] = pkg

    here = os.path.dirname(os.path.abspath(__file__))
    src = os.path.join(os.path.dirname(here), "flake_io.py")
    spec = importlib.util.spec_from_file_location("_fpkg_pf.flake_io", src)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["_fpkg_pf.flake_io"] = mod
    spec.loader.exec_module(mod)
    return mod, fp


fio, fp = _load_flake_io()

PNG = b"\x89PNG\r\n\x1a\nfennec"

MUSASHI = """
loras:
  - {name: hero, path: ./musashi/musashi_hero.safetensors}
  - {name: other, path: chars/other.safetensors}
controlnets:
  - {type: openpose, model: op.safetensors, image: ./musashi/cnets/001_x_3_hed.png}
  - {type: openpose, model: op.safetensors, image: poses/stand.png}
variants:
  outfit:
    armor:
      image: ./musashi/musashi_outfit_armor.png
      loras: [{name: armor, path: ./musashi/armor.safetensors}]
      controlnets: [{type: depth, model: d.safetensors, image: ./musashi/cnets/depth.png}]
"""


@contextlib.contextmanager
def _flakes_root():
    with tempfile.TemporaryDirectory() as tmp:
        fp.folder_names_and_paths["flakes"] = ([tmp], {".yaml", ".yml"})
        _write(os.path.join(tmp, "chars", "musashi.yaml"), MUSASHI.encode())
        yield tmp


def _write(path, data=b""):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)


def _raises_value_error(fn):
    try:
        fn()
    except ValueError:
        return True
    return False


def test_lora_dot_path_resolves_to_flakes_relative_name():
    with _flakes_root():
        flake = fio.resolve({"name": "chars/musashi", "variant": {"outfit": "armor"}})
        assert [lr.path for lr in flake.loras] == [
            "chars/musashi/musashi_hero.safetensors",
            "chars/other.safetensors",
            "chars/musashi/armor.safetensors",
        ]


def test_lora_dot_path_at_root_level():
    with _flakes_root() as root:
        _write(os.path.join(root, "solo.yaml"), b"loras: [{path: ./solo/x.safetensors}]")
        assert fio.load_flake("solo").loras[0].path == "solo/x.safetensors"


def test_cn_dot_image_resolves_to_absolute_path():
    with _flakes_root() as root:
        flake = fio.resolve({"name": "chars/musashi", "variant": {"outfit": "armor"}})
        images = [cn.image_name for cn in flake.controlnets]
        assert images[0] == os.path.normpath(os.path.join(root, "chars", "musashi", "cnets", "001_x_3_hed.png"))
        assert images[1] == "poses/stand.png"
        assert images[2] == os.path.normpath(os.path.join(root, "chars", "musashi", "cnets", "depth.png"))


def test_inline_flake_keeps_dot_paths():
    with _flakes_root():
        flake = fio.resolve({"inline": True, "content": {
            "loras": [{"path": "./a.safetensors"}],
            "controlnets": [{"type": "openpose", "model": "op.safetensors", "image": "./a.png"}],
        }})
        assert flake.loras[0].path == "./a.safetensors"
        assert flake.controlnets[0].image_name == "./a.png"


def test_variant_image_dot_path():
    with _flakes_root() as root:
        _write(os.path.join(root, "chars", "musashi", "musashi_outfit_armor.png"), PNG)
        assert fio.read_variant_image("chars/musashi", "outfit", "armor") == (PNG, "image/png")


def test_asset_served_under_yaml_dir():
    with _flakes_root() as root:
        _write(os.path.join(root, "chars", "musashi", "cnets", "001_x_3_hed.png"), PNG)
        assert fio.read_flake_asset("chars/musashi", "./musashi/cnets/001_x_3_hed.png") == (PNG, "image/png")
        assert fio.read_flake_asset("chars/musashi", "./musashi/missing.png") is None


def test_asset_rejects_non_image_and_bad_paths():
    with _flakes_root() as root:
        _write(os.path.join(root, "chars", "musashi", "musashi_hero.safetensors"), b"weights")
        _write(os.path.join(root, "secret.png"), PNG)
        assert fio.read_flake_asset("chars/musashi", "./musashi/musashi_hero.safetensors") is None
        assert _raises_value_error(lambda: fio.read_flake_asset("chars/musashi", "musashi/cnets/x.png"))
        assert _raises_value_error(lambda: fio.read_flake_asset("chars/musashi", "./../secret.png"))


def test_cover_prefers_owned_location():
    with _flakes_root() as root:
        _write(os.path.join(root, "chars", "musashi.jpg"), b"legacy")
        assert fio.read_cover("chars/musashi") == (b"legacy", "image/jpeg")
        _write(os.path.join(root, "chars", "musashi", "musashi.png"), PNG)
        assert fio.read_cover("chars/musashi") == (PNG, "image/png")


def test_save_cover_writes_owned_and_removes_legacy():
    with _flakes_root() as root:
        legacy = os.path.join(root, "chars", "musashi.jpg")
        _write(legacy, b"legacy")
        fio.save_cover("chars/musashi", ".png", PNG)
        assert not os.path.exists(legacy)
        assert os.path.isfile(os.path.join(root, "chars", "musashi", "musashi.png"))
        assert fio.read_cover("chars/musashi") == (PNG, "image/png")


def test_delete_flake_keeps_owned_folder():
    with _flakes_root() as root:
        legacy = os.path.join(root, "chars", "musashi.jpg")
        owned_cover = os.path.join(root, "chars", "musashi", "musashi.png")
        _write(legacy, b"legacy")
        _write(owned_cover, PNG)
        fio.delete_flake("chars/musashi")
        assert not os.path.exists(os.path.join(root, "chars", "musashi.yaml"))
        assert not os.path.exists(legacy)
        assert os.path.isfile(owned_cover)


def test_list_dirs_skips_owned_folders():
    with _flakes_root() as root:
        os.makedirs(os.path.join(root, "chars", "musashi", "cnets"))
        os.makedirs(os.path.join(root, "chars", "loose"))
        _write(os.path.join(root, "solo.yml"), b"{}")
        os.makedirs(os.path.join(root, "solo"))
        assert fio.list_dirs() == ["chars", "chars/loose"]


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
