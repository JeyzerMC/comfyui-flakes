"""Tests for the animate families, preset storage (#429), flake storage
(#431) and importing image flakes (#433). Same loading
approach as test_portable_flakes.py, with the stub `folder_paths` pointing the
flakes and model_presets roots at temp dirs."""
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
    fp.get_folder_paths = lambda category: []
    fp.base_path = os.getcwd()
    fp.folder_names_and_paths = {}
    sys.modules["folder_paths"] = fp

    pkg = types.ModuleType("_fpkg_anim")
    pkg.__path__ = [os.path.dirname(os.path.dirname(os.path.abspath(__file__)))]
    sys.modules["_fpkg_anim"] = pkg

    here = os.path.dirname(os.path.abspath(__file__))
    src = os.path.join(os.path.dirname(here), "flake_io.py")
    spec = importlib.util.spec_from_file_location("_fpkg_anim.flake_io", src)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["_fpkg_anim.flake_io"] = mod
    spec.loader.exec_module(mod)
    return mod, fp


fio, fp = _load_flake_io()
families = fio.flake_families


@contextlib.contextmanager
def _roots():
    with tempfile.TemporaryDirectory() as tmp:
        presets = os.path.join(tmp, "model_presets")
        fp.folder_names_and_paths["flakes"] = ([tmp], {".yaml", ".yml"})
        fp.folder_names_and_paths["model_presets"] = ([presets], {".yaml", ".yml"})
        yield tmp, presets


def _write(path, data=b""):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)


def _read(path):
    with open(path, "rb") as f:
        return f.read()


def _raises_value_error(fn):
    try:
        fn()
    except ValueError:
        return True
    return False


def test_anim_families_stay_out_of_image_families():
    anim = {f.label for f in families.ANIM_FAMILIES}
    assert anim == {"Wan 2.2", "MiniMax H3"}
    assert not anim & set(families.MODEL_FAMILIES)
    assert not {f.folder for f in families.ANIM_FAMILIES} & set(families.BY_FOLDER)


def test_wan22_preset_round_trip():
    with _roots() as (_, presets):
        name = fio.save_preset("", {
            "display_name": "Wan fennec",
            "diffusion_model_high": "wan/high.safetensors",
            "diffusion_model_low": "wan/low.safetensors",
            "text_encoder": "umt5_xxl_fp8.safetensors",
            "vae": "wan_2.1_vae.safetensors",
            "shift_high": 8,
            "resolution": "720p",
            "prompt": {"positive": "a fennec girl waves her fluffy tail", "negative": "blurry"},
            "loras": [{"name": "lightx2v", "path": "wan/lightx2v.safetensors", "strength": 0.8}],
        }, family="Wan 2.2", output_path="chars/fennec", kind="anim")
        assert name == "video/wan22/chars/fennec"
        assert os.path.isfile(os.path.join(presets, "video", "wan22", "chars", "fennec.yaml"))

        p = fio.load_anim_preset(name)
        assert p.family == "wan22"
        assert p.display_name == "Wan fennec"
        assert (p.diffusion_model_high, p.diffusion_model_low) == ("wan/high.safetensors", "wan/low.safetensors")
        assert p.diffusion_model is None
        assert p.text_encoder == "umt5_xxl_fp8.safetensors"
        assert p.vae == "wan_2.1_vae.safetensors"
        assert p.positive == "a fennec girl waves her fluffy tail"
        assert p.negative == "blurry"
        assert [(lr.path, lr.strength) for lr in p.loras] == [("wan/lightx2v.safetensors", 0.8)]
        # Saved values win, the rest come from the family.
        assert (p.shift_high, p.resolution) == (8.0, "720p")
        assert (p.shift_low, p.refiner_step) == (5.0, 2)
        assert (p.steps, p.cfg, p.sampler, p.scheduler) == (4, 1.0, "euler", "linear_quadratic")
        assert (p.fps, p.duration, p.clip_type) == (16, 5.0, "WAN")
        assert (p.shift_video, p.shift_audio, p.audio_vae) == (None, None, None)


def test_mh3_preset_round_trip():
    with _roots():
        name = fio.save_preset("clip", {
            "diffusion_model": "mh3.safetensors",
            "vae": "mh3_video_vae.safetensors",
            "audio_vae": "mh3_audio_vae.safetensors",
            "steps": 6,
        }, family="MiniMax H3", kind="anim")
        assert name == "video/mh3/clip"

        p = fio.load_anim_preset(name)
        assert p.family == "mh3"
        assert (p.diffusion_model, p.audio_vae) == ("mh3.safetensors", "mh3_audio_vae.safetensors")
        assert p.steps == 6
        assert (p.shift_video, p.shift_audio) == (10.0, 3.0)
        assert (p.fps, p.scheduler, p.clip_type, p.resolution) == (24, "simple", "MINIMAX", "720p")
        assert (p.shift_high, p.shift_low, p.refiner_step) == (None, None, None)


def test_anim_preset_save_rejects_unknown_family():
    with _roots():
        assert _raises_value_error(lambda: fio.save_preset("x", {}, family="SDXL/Base", kind="anim"))
        assert _raises_value_error(lambda: fio.save_preset("x", {}, kind="anim"))


def test_load_anim_preset_rejects_image_preset():
    with _roots():
        name = fio.save_preset("base", {"checkpoint": "a.safetensors"}, family="SDXL/Base")
        assert _raises_value_error(lambda: fio.load_anim_preset(name))


def test_preset_lists_split_by_kind():
    with _roots():
        img = fio.save_preset("base", {"display_name": "Base"}, family="SDXL/Base")
        wan = fio.save_preset("w", {"display_name": "W"}, family="Wan 2.2", kind="anim")
        mh3 = fio.save_preset("m", {}, family="MiniMax H3", kind="anim")

        assert fio.list_presets() == [img]
        assert fio.list_presets(family="SDXL/Base") == [img]
        assert fio.list_presets(kind="anim") == [mh3, wan]
        assert fio.list_presets(family="Wan 2.2", kind="anim") == [wan]
        assert fio.list_preset_display_names(kind="anim") == {wan: "W"}
        assert fio.list_preset_display_names() == {img: "Base"}


def test_anim_preset_cover_and_delete():
    with _roots() as (_, presets):
        name = fio.save_preset("w", {}, family="Wan 2.2", kind="anim")
        fio.save_preset_cover(name, ".png", b"png")
        assert _read(fio.preset_cover_file(name)) == b"png"
        fio.delete_preset(name)
        assert fio.list_presets(kind="anim") == []
        assert not os.path.exists(os.path.join(presets, "video", "wan22", "w.png"))


def test_image_flake_lists_exclude_anim():
    with _roots() as (root, _):
        _write(os.path.join(root, "img", "sdxl", "hero.yaml"), b"loras: []")
        _write(os.path.join(root, "video", "wan22", "wave.yaml"), b"loras: []")
        _write(os.path.join(root, "model_presets", "img", "sdxl", "base.yaml"), b"{}")
        assert fio.list_flakes() == ["img/sdxl/hero"]
        assert fio.list_dirs() == ["img", "img/sdxl"]


def test_anim_flake_round_trip_with_low_lora():
    with _roots() as (root, _):
        name = fio.save_flake("chars/fennec", {
            "name": "Fennec",
            "prompt": {"positive": "a fennec girl swishes her fluffy tail"},
            "loras": [{"name": "swish", "path": "wan/swish_high.safetensors",
                       "name_low": "swish low", "path_low": "wan/swish_low.safetensors", "strength": 0.7}],
        }, family="Wan 2.2", kind="anim")
        assert name == "video/wan22/chars/fennec"
        assert os.path.isfile(os.path.join(root, "video", "wan22", "chars", "fennec.yaml"))
        assert fio.read_flake_raw(name)["loras"][0]["path_low"] == "wan/swish_low.safetensors"

        flake = fio.resolve({"name": name})
        assert flake.positive == "a fennec girl swishes her fluffy tail"
        lora = flake.loras[0]
        assert (lora.path, lora.path_low, lora.name_low, lora.strength) == (
            "wan/swish_high.safetensors", "wan/swish_low.safetensors", "swish low", 0.7)
        # Image flakes keep an empty LOW file.
        img = fio.save_flake("hero", {"loras": [{"path": "hero.safetensors"}]}, family="SDXL/Base")
        assert (fio.load_flake(img).loras[0].path_low, fio.load_flake(img).loras[0].name_low) == ("", "")


def test_anim_flake_lists_cover_and_delete():
    with _roots() as (root, _):
        img = fio.save_flake("hero", {"favorite": True, "serie": "Heroes"}, family="SDXL/Base")
        wan = fio.save_flake("chars/wave", {"name": "Wave", "favorite": True, "serie": "Fennec"}, family="Wan 2.2", kind="anim")
        mh3 = fio.save_flake("clip", {}, family="MiniMax H3", kind="anim")

        assert fio.list_flakes() == [img]
        assert fio.list_dirs() == ["img", "img/sdxl"]
        assert fio.list_flake_info()["favorites"] == [img]
        assert fio.list_series() == ["Heroes"]
        assert fio.list_flakes(kind="anim") == [mh3, wan]
        assert fio.list_flakes(family="Wan 2.2", kind="anim") == [wan]
        assert fio.list_dirs(kind="anim") == ["video", "video/mh3", "video/wan22", "video/wan22/chars"]
        assert fio.list_dirs(family="MiniMax H3", kind="anim") == ["video/mh3"]
        assert fio.list_flake_info(kind="anim")["display_names"] == {wan: "Wave"}
        assert fio.list_flake_info(kind="anim")["favorites"] == [wan]
        assert fio.list_series(kind="anim") == ["Fennec"]
        assert _raises_value_error(lambda: fio.list_flakes(family="SDXL/Base", kind="anim"))

        _write(os.path.join(root, "video", "wan22", "chars", "wave", "wave.png"), b"png")
        assert _read(fio.cover_file(wan)) == b"png"
        fio.delete_flake(wan)
        assert fio.list_flakes(kind="anim") == [mh3]


def test_lora_names_cover_both_kinds_and_variants():
    with _roots() as (root, _):
        _write(os.path.join(root, "img", "sdxl", "hero", "hero.yaml"), b"""
loras:
  - {name: " Fennec Ears ", path: a.safetensors}
  - {name: "", path: b.safetensors}
  - just a string
variants:
  outfit:
    maid: {loras: [{name: Maid Outfit}]}
    plain: {}
""")
        _write(os.path.join(root, "img", "sdxl", "odd", "odd.yaml"), b"loras: {name: Not A List}\n")
        _write(os.path.join(root, "video", "wan22", "wave", "wave.yaml"),
               b"loras:\n  - {name: Tail Swish, name_low: Tail Swish low}\n  - {name: Fennec Ears}\n")
        assert fio.list_lora_names() == ["Fennec Ears", "Maid Outfit", "Tail Swish", "Tail Swish low"]


def test_list_option_names_spans_kinds_and_variant_choices():
    with _roots() as (root, _):
        _write(os.path.join(root, "img", "sdxl", "ahri", "ahri.yaml"), b"""
prompt_options: [{name: " face ", positive: golden eyes}, {name: ""}, just a string]
variants:
  skin:
    classic: {prompt_options: [{name: tails}]}
    plain: {}
""")
        _write(os.path.join(root, "video", "wan22", "wave", "wave.yaml"), b"prompt_options: [{name: tails}, {name: ears}]\n")
        assert fio.list_option_names() == ["ears", "face", "tails"]


HERO = b"""
name: Fennec Hero
flake_type: character
serie: Fennec
output_stem: hero/
resolution: [832, 1216]
prompt: {positive: a fennec girl with a big fluffy tail, negative: blurry}
loras:
  - {name: hero, path: ./hero/hero_hero.safetensors, strength: 0.8}
controlnets:
  - {type: openpose, model: op.safetensors, image: ./hero/cnets/pose.png}
flake_links:
  - {target: img/sdxl/style}
variants:
  outfit:
    armor:
      positive: shiny armor
      negative: rust
      output_stem: armor
      default: true
      image: ./hero/hero_outfit_armor.png
      loras: [{name: armor, path: ./hero/armor.safetensors}]
      controlnets: [{type: depth, model: d.safetensors, image: ./hero/cnets/depth.png}]
      flake_links: [{target: img/sdxl/style}]
    dress: {positive: blue dress}
"""


def test_import_anim_flake_copies_prompts_and_files():
    with _roots() as (root, _):
        src_dir = os.path.join(root, "img", "sdxl", "chars")
        _write(os.path.join(src_dir, "hero.yaml"), HERO)
        _write(os.path.join(src_dir, "hero", "hero.png"), b"cover")
        _write(os.path.join(src_dir, "hero", "hero_outfit_armor.png"), b"armor")
        before = sorted(os.path.join(d, f) for d, _, fs in os.walk(src_dir) for f in fs)

        name = fio.import_anim_flake("img/sdxl/chars/hero", "Wan 2.2")
        assert name == "video/wan22/chars/hero"
        assert fio.read_flake_raw(name) == {
            "name": "Fennec Hero",
            "prompt": {"positive": "a fennec girl with a big fluffy tail", "negative": "blurry"},
            "output_stem": "hero/",
            "flake_type": "character",
            "serie": "Fennec",
            "variants": {"outfit": {
                "armor": {"positive": "shiny armor", "negative": "rust", "output_stem": "armor", "default": True,
                          "image": "./hero/hero_outfit_armor.png"},
                "dress": {"positive": "blue dress"},
            }},
        }
        assert _read(fio.cover_file(name)) == b"cover"
        assert _read(fio.variant_image_file(name, "outfit", "armor")) == b"armor"
        assert fio.list_flakes(kind="anim") == [name]
        # The source flake and its files are untouched.
        assert sorted(os.path.join(d, f) for d, _, fs in os.walk(src_dir) for f in fs) == before
        with open(os.path.join(src_dir, "hero.yaml"), "rb") as f:
            assert f.read() == HERO


def test_import_anim_flake_collision_naming():
    with _roots() as (root, _):
        _write(os.path.join(root, "img", "sdxl", "hero.yaml"), b"name: Hero")
        _write(os.path.join(root, "img", "pony", "hero.yaml"), b"name: Pony Hero")
        assert fio.import_anim_flake("img/sdxl/hero", "Wan 2.2") == "video/wan22/hero"
        assert fio.import_anim_flake("img/pony/hero", "Wan 2.2") == "video/wan22/hero (2)"
        # A deleted flake's kept owned folder still takes the name.
        _write(os.path.join(root, "video", "wan22", "hero (3)", "hero (3).png"), b"old")
        assert fio.import_anim_flake("img/sdxl/hero", "Wan 2.2") == "video/wan22/hero (4)"
        assert fio.import_anim_flake("img/sdxl/hero", "MiniMax H3") == "video/mh3/hero"
        assert fio.read_flake_raw("video/wan22/hero (2)") == {"name": "Pony Hero"}
        assert _raises_value_error(lambda: fio.import_anim_flake("img/sdxl/hero", "SDXL/Base"))
