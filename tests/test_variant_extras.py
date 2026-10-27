"""Tests for variant choices carrying LoRAs / ControlNets / flake links (#299).

Selecting a variant choice must merge that choice's `loras`, `controlnets`, and
`flake_links` on top of the flake's base. Stubs `folder_paths` and loads
`flake_io` under a synthetic package (same approach as the other tests), then
monkeypatches `load_flake` to serve flakes from an in-memory yaml map.
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

    pkg = types.ModuleType("_fpkg2")
    # Point at the repo root so `from . import flake_families` resolves to the
    # real module (it has no ComfyUI dependencies, so it imports cleanly).
    pkg.__path__ = [os.path.dirname(os.path.dirname(os.path.abspath(__file__)))]
    sys.modules["_fpkg2"] = pkg

    here = os.path.dirname(os.path.abspath(__file__))
    src = os.path.join(os.path.dirname(here), "flake_io.py")
    spec = importlib.util.spec_from_file_location("_fpkg2.flake_io", src)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["_fpkg2.flake_io"] = mod
    spec.loader.exec_module(mod)
    return mod


fio = _load_flake_io()


def _with_flakes(raw_map):
    fio.load_flake = lambda name: fio._flake_from_raw(name, raw_map[name])


def _strength_of(flake, path):
    for lr in flake.loras:
        if lr.path == path:
            return lr.strength
    return None


def test_choice_loras_applied_when_selected():
    _with_flakes({
        "pose": {
            "name": "Pose",
            "variants": {"style": {"dramatic": {
                "loras": [{"name": "drama", "path": "drama.safetensors", "strength": 0.7}],
            }}},
        },
    })
    flake = fio.resolve({"name": "pose", "variant": {"style": "dramatic"}})
    assert _strength_of(flake, "drama.safetensors") == 0.7


def test_choice_loras_absent_when_unselected():
    _with_flakes({
        "pose": {
            "name": "Pose",
            "variants": {"style": {"dramatic": {
                "loras": [{"name": "drama", "path": "drama.safetensors", "strength": 0.7}],
            }}},
        },
    })
    flake = fio.resolve({"name": "pose"})
    assert _strength_of(flake, "drama.safetensors") is None


def test_choice_controlnets_applied():
    _with_flakes({
        "pose": {
            "name": "Pose",
            "variants": {"style": {"dramatic": {
                "controlnets": [{"type": "openpose", "model": "openpose.safetensors", "image": "pose.png", "strength": 0.9}],
            }}},
        },
    })
    flake = fio.resolve({"name": "pose", "variant": {"style": "dramatic"}})
    assert any(cn.model_name == "openpose.safetensors" and cn.strength == 0.9 for cn in flake.controlnets)


def test_choice_flake_links_applied_with_override():
    _with_flakes({
        "dramatic_lighting": {
            "name": "Dramatic Lighting",
            "loras": [{"name": "drama", "path": "drama.safetensors", "strength": 0.5}],
        },
        "pose": {
            "name": "Pose",
            "variants": {"style": {"dramatic": {
                "flake_links": [{"target": "dramatic_lighting", "lora_strengths": [0.9]}],
            }}},
        },
    })
    flake = fio.resolve({"name": "pose", "variant": {"style": "dramatic"}})
    # The linked flake's LoRA comes in at the choice's overridden strength.
    assert _strength_of(flake, "drama.safetensors") == 0.9


def _host_and_choice_links():
    _with_flakes({
        "light": {
            "name": "Light",
            "loras": [{"name": "light", "path": "light.safetensors", "strength": 0.5}],
            "variants": {"tone": {"warm": {"default": True, "positive": "warm"}, "cold": {"positive": "cold"}}},
        },
        "ink": {"name": "Ink", "loras": [{"name": "ink", "path": "ink.safetensors", "strength": 0.4}]},
        "pose": {
            "name": "Pose",
            "flake_links": [{"target": "ink"}],
            "variants": {"style": {
                "calm": {"default": True},
                "dramatic": {"flake_links": [{"target": "light", "lora_strengths": [0.9]}]},
            }},
        },
    })


def test_variant_link_overrides_apply_to_choice_links():
    """`variant_link_overrides[group][choice][i]` overrides the choice's link i (#420)."""
    _host_and_choice_links()
    flake = fio.resolve({
        "name": "pose",
        "variant": {"style": "dramatic"},
        "variant_link_overrides": {"style": {"dramatic": [{"variant": {"tone": "cold"}, "lora_strengths": [1.3]}]}},
    })
    assert _strength_of(flake, "light.safetensors") == 1.3
    assert "cold" in flake.positive and "warm" not in flake.positive
    assert _strength_of(flake, "ink.safetensors") == 0.4


def test_host_link_overrides_keep_their_index():
    """Host links keep `flake_link_overrides[i]`; choice links never read it (#420)."""
    _host_and_choice_links()
    flake = fio.resolve({
        "name": "pose",
        "variant": {"style": "dramatic"},
        "flake_link_overrides": [{"lora_strengths": [0.2]}, {"lora_strengths": [2.0]}],
    })
    assert _strength_of(flake, "ink.safetensors") == 0.2
    assert _strength_of(flake, "light.safetensors") == 0.9


def test_variant_link_overrides_of_other_choice_ignored():
    _host_and_choice_links()
    for ovr in ({"style": {"calm": [{"lora_strengths": [1.3]}]}}, "x", {"style": "x"}, {"style": {"dramatic": "x"}}, {"style": {"dramatic": ["x"]}}):
        flake = fio.resolve({"name": "pose", "variant": {"style": "dramatic"}, "variant_link_overrides": ovr})
        assert _strength_of(flake, "light.safetensors") == 0.9


def test_choice_prompt_still_works():
    _with_flakes({
        "pose": {
            "name": "Pose",
            "prompt": {"positive": "base"},
            "variants": {"style": {"dramatic": {"positive": "moody lighting"}}},
        },
    })
    flake = fio.resolve({"name": "pose", "variant": {"style": "dramatic"}})
    assert "base" in flake.positive and "moody lighting" in flake.positive


def _two_choice_pose():
    _with_flakes({
        "pose": {
            "name": "Pose",
            "variants": {"style": {
                "calm": {"default": True, "loras": [{"name": "calm", "path": "calm.safetensors", "strength": 0.5}]},
                "dramatic": {"loras": [
                    {"name": "drama", "path": "drama.safetensors", "strength": 0.7},
                    {"name": "light", "path": "light.safetensors", "strength": 0.3},
                ]},
            }},
        },
    })


def test_variant_loras_override_selected_choice():
    """`variant_loras[group][choice][i]` overrides the choice's LoRA strengths (#413)."""
    _two_choice_pose()
    flake = fio.resolve({
        "name": "pose",
        "variant": {"style": "dramatic"},
        "variant_loras": {"style": {"dramatic": [None, 1.2], "calm": [2.0]}},
    })
    assert _strength_of(flake, "drama.safetensors") == 0.7
    assert _strength_of(flake, "light.safetensors") == 1.2
    assert _strength_of(flake, "calm.safetensors") is None


def test_variant_loras_override_default_choice():
    _two_choice_pose()
    flake = fio.resolve({"name": "pose", "variant_loras": {"style": {"calm": [0.9]}}})
    assert _strength_of(flake, "calm.safetensors") == 0.9


def test_variant_loras_extra_slots_and_malformed_ignored():
    _two_choice_pose()
    flake = fio.resolve({"name": "pose", "variant_loras": {"style": {"calm": [0.9, 1.5, 2.0]}}})
    assert [lr.strength for lr in flake.loras] == [0.9]
    for bad in ("x", ["x"], {"style": "x"}, {"style": {"calm": "x"}}, {"style": {"calm": ["x"]}}):
        flake = fio.resolve({"name": "pose", "variant_loras": bad})
        assert _strength_of(flake, "calm.safetensors") == 0.5


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


def test_choice_flat_prompt_and_prompt_list():
    # One prompt stays flat; several (or a scheduled one) live in `prompts:` (#468).
    _with_flakes({
        "ahri": {
            "prompt": {"positive": "ahri", "negative": "bad"},
            "variants": {"skin": {
                "classic": {"positive": "classic", "negative": ""},
                "arcade": {"positive": "ignored", "prompts": [
                    {"positive": "arcade", "negative": "plain"},
                    {"positive": "visor"},
                    {"positive": "glow", "schedule": [{"start": 0.5, "strength": 1.0}]},
                ]},
            }},
        },
    })
    classic = fio.resolve({"name": "ahri", "variant": {"skin": "classic"}})
    assert (classic.positive, classic.negative, classic.scheduled_prompts) == ("ahri, classic", "bad", [])
    arcade = fio.resolve({"name": "ahri", "variant": {"skin": "arcade"}})
    assert (arcade.positive, arcade.negative) == ("ahri, arcade, visor", "bad, plain")
    assert [p.positive for p in arcade.scheduled_prompts] == ["glow"]
