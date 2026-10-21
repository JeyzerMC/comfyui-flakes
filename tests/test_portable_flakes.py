"""Tests for `./` paths relative to the flake yaml, the owned cover
location (#391) and taking ownership of external data on save (#392). Same loading approach as test_variant_extras.py, with the
stub `folder_paths` pointing the flakes root at a temp dir."""
import contextlib
import importlib.util
import json
import os
import sys
import tempfile
import types


def _load_flake_io():
    fp = types.ModuleType("folder_paths")
    fp.get_filename_list = lambda category: []
    fp.get_full_path = lambda category, name: None
    fp.get_folder_paths = lambda category: []
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


def test_lora_dot_path_resolves_to_absolute_path():
    with _flakes_root() as root:
        flake = fio.resolve({"name": "chars/musashi", "variant": {"outfit": "armor"}})
        assert [lr.path for lr in flake.loras] == [
            os.path.join(root, "chars", "musashi", "musashi_hero.safetensors"),
            "chars/other.safetensors",
            os.path.join(root, "chars", "musashi", "armor.safetensors"),
        ]


def test_lora_dot_path_at_root_level():
    with _flakes_root() as root:
        _write(os.path.join(root, "solo.yaml"), b"loras: [{path: ./solo/x.safetensors}]")
        assert fio.load_flake("solo").loras[0].path == os.path.join(root, "solo", "x.safetensors")


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


def test_list_flake_favorites():
    with _flakes_root() as root:
        _write(os.path.join(root, "chars", "fennec.yaml"), b"favorite: true\npositive: fluffy tail\n")
        _write(os.path.join(root, "solo.yml"), b"favorite: false\n")
        assert fio.list_flake_favorites() == ["chars/fennec"]


def _get_full_path(loras):
    def get_full_path(category, name):
        # Like ComfyUI: names only; an absolute path on another drive raises.
        if os.path.isabs(name):
            raise ValueError("path is on mount 'D:', start on mount 'C:'")
        full = os.path.join(loras, name)
        return full if category == "loras" and os.path.isfile(full) else None
    return get_full_path


@contextlib.contextmanager
def _save_env():
    """Flakes root plus temp `input/` and LoRA dirs for the ownership pass (#392)."""
    with _flakes_root() as root, tempfile.TemporaryDirectory() as ext:
        inp, loras = os.path.join(ext, "input"), os.path.join(ext, "loras")
        fp.get_input_directory = lambda: inp
        fp.get_full_path = _get_full_path(loras)
        fp.get_output_directory = lambda: os.path.join(ext, "output")
        fp.models_dir = os.path.join(ext, "models")
        fp.folder_names_and_paths["loras"] = ([loras], set())
        fp.get_folder_paths = lambda c: fp.folder_names_and_paths.get(c, ([],))[0]
        try:
            yield root, inp, loras, ext
        finally:
            fp.get_full_path = lambda category, name: None
            fp.folder_names_and_paths.pop("loras", None)


def _exists(*parts):
    return os.path.isfile(os.path.join(*parts))


def test_cn_batch_detection():
    with tempfile.TemporaryDirectory() as tmp:
        for fn in ("001_x_1_hed.png", "001_x_2_depth.png", "001_x_3_cover.png", "001_x_4_notes.txt", "001_x_extra.png", "002_x_1_hed.png", "plain.png"):
            _write(os.path.join(tmp, fn), PNG)
        batch = sorted(os.path.basename(p) for p in fio._cn_batch(os.path.join(tmp, "001_x_2_depth.png")))
        assert batch == ["001_x_1_hed.png", "001_x_2_depth.png", "001_x_3_cover.png"], batch
        assert fio._cn_batch(os.path.join(tmp, "001_x_extra.png")) == [os.path.join(tmp, "001_x_extra.png")]
        assert fio._cn_batch(os.path.join(tmp, "plain.png")) == [os.path.join(tmp, "plain.png")]


def test_save_moves_loras_with_sidecars():
    with _save_env() as (root, _, loras, _ext):
        for fn in ("hero.safetensors", "hero.preview.png", "hero.civitai.info", "hero.v2.safetensors", "b.safetensors"):
            _write(os.path.join(loras, "chars", fn), b"w")
        data = {
            "loras": [
                {"name": "Hero!", "path": "chars/hero.safetensors"},
                {"name": "Hero", "path": "chars/b.safetensors"},
                {"path": "./musashi/kept.safetensors"},
                {"path": "missing.safetensors"},
            ],
            "variants": {"outfit": {"armor": {"loras": [{"name": "x", "path": "chars/hero.safetensors"}]}}},
        }
        fio.save_flake("chars/musashi", data)
        raw = fio.read_flake_raw("chars/musashi")
        assert [lr["path"] for lr in raw["loras"]] == [
            "./musashi/musashi_Hero.safetensors",
            "./musashi/musashi_Hero_2.safetensors",
            "./musashi/kept.safetensors",
            "missing.safetensors",
        ], raw["loras"]
        assert raw["variants"]["outfit"]["armor"]["loras"][0]["path"] == "./musashi/musashi_Hero.safetensors"
        owned = os.path.join(root, "chars", "musashi")
        for fn in ("musashi_Hero.safetensors", "musashi_Hero.preview.png", "musashi_Hero.civitai.info", "musashi_Hero_2.safetensors"):
            assert _exists(owned, fn), fn
        assert not _exists(loras, "chars", "hero.safetensors")
        assert _exists(loras, "chars", "hero.v2.safetensors")


def test_save_moves_low_lora_file():
    with _save_env() as (root, _, loras, _ext):
        for fn in ("swish_high.safetensors", "swish_low.safetensors", "swish_low.preview.png"):
            _write(os.path.join(loras, "wan", fn), b"w")
        name = fio.save_flake("fennec", {"loras": [
            {"name": "Swish", "path": "wan/swish_high.safetensors", "path_low": "wan/swish_low.safetensors"},
        ]}, family="Wan 2.2", kind="anim")
        lora = fio.read_flake_raw(name)["loras"][0]
        assert (lora["path"], lora["path_low"]) == ("./fennec/fennec_Swish.safetensors", "./fennec/fennec_Swish_low.safetensors")
        owned = os.path.join(root, "anim", "wan22", "fennec")
        for fn in ("fennec_Swish.safetensors", "fennec_Swish_low.safetensors", "fennec_Swish_low.preview.png"):
            assert _exists(owned, fn), fn
        assert not _exists(loras, "wan", "swish_low.safetensors")
        assert fio.load_flake(name).loras[0].path_low == os.path.join(owned, "fennec_Swish_low.safetensors")


def test_save_unnamed_legacy_lora_path():
    with _save_env() as (root, _, loras, _ext):
        _write(os.path.join(loras, "solo.safetensors"), b"w")
        fio.save_flake("chars/musashi", {"path": "solo.safetensors", "strength": 0.5})
        assert fio.read_flake_raw("chars/musashi")["path"] == "./musashi/musashi.safetensors"
        assert _exists(root, "chars", "musashi", "musashi.safetensors")


def test_save_moves_cn_batches_and_variant_images():
    with _save_env() as (root, inp, _, _ext):
        for fn in ("001_x_1_hed.png", "001_x_2_depth.png", "other.png", "unrelated.png"):
            _write(os.path.join(inp, "poses", fn), PNG)
        data = {
            "controlnets": [{"type": "openpose", "image": "poses/001_x_1_hed"}],
            "variants": {"outfit": {
                "Red Armor": {"image": "poses/other.png", "controlnets": [{"type": "depth", "image": "poses/001_x_2_depth.png"}]},
                "plain": {"image": "poses/001_x_1_hed.png"},
            }},
        }
        fio.save_flake("chars/musashi", data)
        raw = fio.read_flake_raw("chars/musashi")
        outfit = raw["variants"]["outfit"]
        assert raw["controlnets"][0]["image"] == "./musashi/cnets/001_x_1_hed.png"
        assert outfit["Red Armor"]["controlnets"][0]["image"] == "./musashi/cnets/001_x_2_depth.png"
        assert outfit["Red Armor"]["image"] == "./musashi/musashi_outfit_Red_Armor.png"
        assert outfit["plain"]["image"] == "./musashi/cnets/001_x_1_hed.png"
        assert _exists(root, "chars", "musashi", "cnets", "001_x_2_depth.png")
        assert _exists(root, "chars", "musashi", "musashi_outfit_Red_Armor.png")
        assert _exists(inp, "poses", "unrelated.png")
        assert not _exists(inp, "poses", "001_x_1_hed.png")


def test_save_moves_whole_batch_from_input_subfolder():
    batch = ("000_my_pose_0_cover.png", "000_my_pose_1_base.png", "000_my_pose_2_prep.png", "000_my_pose_3_densepose.png",
             "000_my_pose_3_depthanythingv2.png", "000_my_pose_3_dwpose.png", "000_my_pose_3_hed.png")
    with _save_env() as (root, inp, _, _ext):
        folder = os.path.join(inp, "cnets", "poses", "fam")
        for fn in (*batch, "001_my_pose_0_cover.png"):
            _write(os.path.join(folder, fn), PNG)
        fio.save_flake("poses/jojo", {"controlnets": [{"type": "depth", "image": "cnets/poses/fam/000_my_pose_3_depthanythingv2.png"}]})
        assert fio.read_flake_raw("poses/jojo")["controlnets"][0]["image"] == "./jojo/cnets/000_my_pose_3_depthanythingv2.png"
        assert sorted(os.listdir(os.path.join(root, "poses", "jojo", "cnets"))) == sorted(batch)
        assert os.listdir(folder) == ["001_my_pose_0_cover.png"]


def test_save_moves_external_cover():
    with _save_env() as (root, _, _l, ext):
        source = os.path.join(_l, "pics", "c.JPG")
        _write(source, b"jpg")
        _write(os.path.join(root, "chars", "musashi.png"), PNG)
        fio.save_flake("chars/musashi", {"cover_image": source})
        assert "cover_image" not in fio.read_flake_raw("chars/musashi")
        assert not os.path.exists(source)
        assert not _exists(root, "chars", "musashi.png")
        assert fio.read_cover("chars/musashi") == (b"jpg", "image/jpeg")


def test_save_leaves_cover_outside_input_and_loras():
    with _save_env() as (root, _, _l, ext):
        source = os.path.join(ext, "elsewhere", "c.png")
        _write(source, PNG)
        fio.save_flake("chars/musashi", {"cover_image": source})
        assert fio.read_flake_raw("chars/musashi")["cover_image"] == source
        assert os.path.isfile(source)
        assert not os.path.isdir(os.path.join(root, "chars", "musashi"))


def test_save_references_cover_already_owned_in_place():
    with _save_env() as (root, inp, _, _ext):
        _write(os.path.join(inp, "001_x_1_hed.png"), b"hed")
        _write(os.path.join(inp, "001_x_2_cover.png"), PNG)
        _write(os.path.join(root, "chars", "musashi", "musashi.jpg"), b"old")
        fio.save_flake("chars/musashi", {"controlnets": [{"type": "openpose", "image": "001_x_1_hed.png"}], "cover_image": "001_x_2_cover.png"})
        assert fio.read_flake_raw("chars/musashi")["cover_image"] == "./musashi/cnets/001_x_2_cover.png"
        assert not _exists(root, "chars", "musashi", "musashi.jpg")
        assert fio.read_cover("chars/musashi") == (PNG, "image/png")


def test_save_keeps_owned_images_in_place():
    with _save_env() as (root, _, _l, _ext):
        cnets = os.path.join(root, "chars", "musashi", "cnets")
        for fn in ("000_p_0_cover.png", "000_p_3_hed.png", "000_p_3_dwpose.png"):
            _write(os.path.join(cnets, fn), PNG)
        data = {
            "controlnets": [{"type": "openpose", "image": os.path.join(cnets, "000_p_3_dwpose.png")}],
            "variants": {"pose": {"a": {"image": os.path.join(cnets, "000_p_3_hed.png")}}},
            "cover_image": os.path.join(cnets, "000_p_0_cover.png"),
        }
        fio.save_flake("chars/musashi", data)
        raw = fio.read_flake_raw("chars/musashi")
        assert raw["controlnets"][0]["image"] == "./musashi/cnets/000_p_3_dwpose.png"
        assert raw["variants"]["pose"]["a"]["image"] == "./musashi/cnets/000_p_3_hed.png"
        assert raw["cover_image"] == "./musashi/cnets/000_p_0_cover.png"
        assert sorted(os.listdir(cnets)) == ["000_p_0_cover.png", "000_p_3_dwpose.png", "000_p_3_hed.png"]
        assert sorted(os.listdir(os.path.join(root, "chars", "musashi"))) == ["cnets"]


def test_save_moves_image_from_extra_model_path():
    with _save_env() as (root, _, _l, ext):
        source = os.path.join(ext, "extra_drive", "upscale_models", "sample.png")
        _write(source, PNG)
        fp.folder_names_and_paths["upscale_models"] = ([os.path.dirname(source)], set())
        try:
            fio.save_flake("chars/musashi", {"cover_image": source})
        finally:
            fp.folder_names_and_paths.pop("upscale_models")
        assert not os.path.exists(source)
        assert fio.read_cover("chars/musashi") == (PNG, "image/png")


def test_save_in_place_through_junctioned_flakes_root():
    # The flakes root is reached through a junction while the picked image
    # comes as its real path; on another drive this used to fail the save.
    if sys.platform != "win32":
        return
    import _winapi
    with _save_env() as (_, _i, _l, ext):
        real, link = os.path.join(ext, "real_flakes"), os.path.join(ext, "linked_flakes")
        os.makedirs(real)
        _winapi.CreateJunction(real, link)
        fp.folder_names_and_paths["flakes"] = ([link], {".yaml", ".yml"})
        _write(os.path.join(link, "chars", "musashi.yaml"), b"{}")
        cover = os.path.join(real, "chars", "musashi", "cnets", "000_p_0_cover.png")
        _write(cover, PNG)
        fio.save_flake("chars/musashi", {"cover_image": cover})
        assert fio.read_flake_raw("chars/musashi")["cover_image"] == "./musashi/cnets/000_p_0_cover.png"


def test_save_variant_cover_from_its_cn_batch():
    # #397: picking a CN in a choice sets the choice image (and the flake cover)
    # to the batch's _0_cover; both end up referencing the moved cnets/ file.
    with _save_env() as (root, inp, _l, _ext):
        for fn in ("001_x_0_cover.png", "001_x_3_depthanythingv2.png", "001_x_3_hed.png"):
            _write(os.path.join(inp, "poses", fn), PNG)
        data = {
            "cover_image": "poses/001_x_0_cover.png",
            "variants": {"pose": {"stand": {
                "image": "poses/001_x_0_cover.png",
                "controlnets": [{"type": "depth", "image": "poses/001_x_3_depthanythingv2.png"}],
            }}},
        }
        fio.save_flake("chars/musashi", data)
        raw = fio.read_flake_raw("chars/musashi")
        assert raw["variants"]["pose"]["stand"]["image"] == "./musashi/cnets/001_x_0_cover.png"
        assert raw["cover_image"] == "./musashi/cnets/001_x_0_cover.png"
        assert sorted(os.listdir(os.path.join(root, "chars", "musashi"))) == ["cnets"]
        assert os.listdir(os.path.join(inp, "poses")) == []


def test_save_moves_image_from_output():
    with _save_env() as (root, _, _l, ext):
        source = os.path.join(ext, "output", "run", "001_q_3_hed.png")
        _write(source, PNG)
        fio.save_flake("chars/musashi", {"controlnets": [{"type": "softedge", "image": source}]})
        assert fio.read_flake_raw("chars/musashi")["controlnets"][0]["image"] == "./musashi/cnets/001_q_3_hed.png"
        assert not os.path.exists(source)


def test_save_moves_legacy_sibling_cover():
    with _save_env() as (root, _, _l, _ext):
        _write(os.path.join(root, "chars", "musashi.png"), PNG)
        fio.save_flake("chars/musashi", {})
        assert not _exists(root, "chars", "musashi.png")
        assert _exists(root, "chars", "musashi", "musashi.png")


def test_rename_moves_owned_folder():
    with _save_env() as (root, _, _l, _ext):
        _write(os.path.join(root, "chars", "musashi", "musashi_hero.safetensors"), b"w")
        _write(os.path.join(root, "chars", "musashi", "musashi.png"), PNG)
        data = {"loras": [{"name": "hero", "path": "./musashi/musashi_hero.safetensors"}], "flake_links": [{"target": "chars/other"}]}
        assert fio.save_flake("solo/miyamoto", data, old_name="chars/musashi") == "solo/miyamoto"
        assert not os.path.exists(os.path.join(root, "chars", "musashi.yaml"))
        assert not os.path.exists(os.path.join(root, "chars", "musashi"))
        raw = fio.read_flake_raw("solo/miyamoto")
        assert raw["loras"][0]["path"] == "./miyamoto/musashi_hero.safetensors"
        assert raw["flake_links"] == [{"target": "chars/other"}]
        assert _exists(root, "solo", "miyamoto", "musashi_hero.safetensors")
        assert fio.read_cover("solo/miyamoto") == (PNG, "image/png")


# Portable bundles (#427): a source machine's flakes travel inside the image.
BUNDLE_MUSASHI = """loras:
- {name: hero, path: ./musashi/musashi_hero.safetensors}
controlnets:
- {type: openpose, model: op.safetensors, image: ./musashi/cnets/pose.png}
flake_links:
- {target: chars/horse}
"""
BUNDLE_HORSE = "prompt: {positive: horse}\n"
BUNDLE_PRESET = "checkpoint: base.safetensors\nflake_links:\n- {target: chars/horse}\n"


@contextlib.contextmanager
def _machine():
    with tempfile.TemporaryDirectory() as tmp:
        presets = os.path.join(tmp, "model_presets")
        os.makedirs(presets)
        fp.folder_names_and_paths["flakes"] = ([tmp], {".yaml", ".yml"})
        fp.folder_names_and_paths["model_presets"] = ([presets], {".yaml", ".yml"})
        yield tmp


def _source_bundle():
    with _machine() as root:
        _write(os.path.join(root, "chars", "musashi.yaml"), BUNDLE_MUSASHI.encode())
        _write(os.path.join(root, "chars", "musashi", "musashi.png"), PNG)
        _write(os.path.join(root, "chars", "musashi", "cnets", "pose.png"), b"pose")
        _write(os.path.join(root, "chars", "musashi", "musashi_hero.safetensors"), b"weights")
        _write(os.path.join(root, "chars", "musashi", "musashi_hero.civitai.info"), b"{}")
        _write(os.path.join(root, "chars", "horse.yaml"), BUNDLE_HORSE.encode())
        _write(os.path.join(root, "chars", "horse", "horse.png"), PNG)
        _write(os.path.join(root, "model_presets", "img", "sdxl", "base.yaml"), BUNDLE_PRESET.encode())
        _write(os.path.join(root, "model_presets", "img", "sdxl", "base.png"), b"preset cover")
        bundle = fio.collect_bundle(["chars/musashi"], ["img/sdxl/base"])
        # Installing on the machine that made it changes nothing.
        assert fio.install_bundle(bundle) == {"installed": [], "flakes": {}, "presets": {}}
    return json.loads(json.dumps(bundle))


def test_bundle_round_trip():
    bundle = _source_bundle()
    assert list(bundle["flakes"]) == ["chars/musashi", "chars/horse"]
    assert sorted(bundle["flakes"]["chars/musashi"]["files"]) == [
        "musashi/cnets/pose.png", "musashi/musashi.png", "musashi/musashi_hero.civitai.info"]
    assert list(bundle["presets"]["img/sdxl/base"]["files"]) == ["base.png"]
    # The two flakes' identical covers are stored once.
    assert len(bundle["files"]) == 4
    with _machine() as root:
        result = fio.install_bundle(bundle)
        assert sorted(result["installed"]) == ["chars/horse", "chars/musashi", "img/sdxl/base"]
        assert result["flakes"] == result["presets"] == {}
        with open(os.path.join(root, "chars", "musashi.yaml"), encoding="utf-8") as f:
            assert f.read() == BUNDLE_MUSASHI
        assert fio.read_cover("chars/musashi") == (PNG, "image/png")
        assert fio.read_cover("chars/horse") == (PNG, "image/png")
        assert fio.read_preset_cover("img/sdxl/base") == (b"preset cover", "image/png")
        assert fio.resolve({"name": "chars/musashi"}).controlnets[0].image_name ==os.path.join(root, "chars", "musashi", "cnets", "pose.png")
        assert not _exists(root, "chars", "musashi", "musashi_hero.safetensors")
        assert fio.install_bundle(bundle) == {"installed": [], "flakes": {}, "presets": {}}


def test_bundle_collision_installs_imported_copy():
    bundle = _source_bundle()
    with _machine() as root:
        _write(os.path.join(root, "chars", "horse.yaml"), b"prompt: {positive: pony}\n")
        result = fio.install_bundle(bundle)
        renamed = {"chars/horse": "chars/horse (imported)"}
        assert result["flakes"] == renamed and result["presets"] == {}
        assert sorted(result["installed"]) == ["chars/horse (imported)", "chars/musashi", "img/sdxl/base"]
        assert fio.read_flake_raw("chars/horse")["prompt"] == {"positive": "pony"}
        assert fio.read_flake_raw("chars/horse (imported)")["prompt"] == {"positive": "horse"}
        assert fio.read_cover("chars/horse (imported)") == (PNG, "image/png")
        # Links follow the rename, in flakes and presets.
        assert fio.read_flake_raw("chars/musashi")["flake_links"] == [{"target": "chars/horse (imported)"}]
        assert fio.read_preset_raw("img/sdxl/base")["flake_links"] == [{"target": "chars/horse (imported)"}]
        # A second drop of the same image reuses the imported copy.
        assert fio.install_bundle(bundle) == {"installed": [], "flakes": renamed, "presets": {}}


def test_bundle_rejects_paths_outside_the_flake():
    bundle = _source_bundle()
    blob = next(iter(bundle["files"]))
    for rel in ("../evil.png", "musashi/../../evil.png", "/evil.png", "C:/evil.png", "horse/evil.png",
                "musashi\\evil.png", "musashi/evil.safetensors"):
        bad = json.loads(json.dumps(bundle))
        bad["flakes"]["chars/musashi"]["files"][rel] = blob
        with _machine() as root:
            assert _raises_value_error(lambda: fio.install_bundle(bad)), rel
            assert os.listdir(root) == ["model_presets"]
    for name in ("../evil", "/evil", "chars/../../evil"):
        bad = json.loads(json.dumps(bundle))
        bad["flakes"][name] = bad["flakes"].pop("chars/horse")
        with _machine() as root:
            assert _raises_value_error(lambda: fio.install_bundle(bad)), name


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
