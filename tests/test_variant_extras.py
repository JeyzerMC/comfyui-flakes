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
    pkg.__path__ = []
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
