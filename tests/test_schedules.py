"""Tests for hook schedules and multiple prompts in flake files (#369).

Stubs `folder_paths` and loads `flake_io` under a synthetic package (same
approach as test_variant_extras.py), then serves flakes from an in-memory map.
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

    pkg = types.ModuleType("_fpkg_sched")
    pkg.__path__ = [os.path.dirname(os.path.dirname(os.path.abspath(__file__)))]
    sys.modules["_fpkg_sched"] = pkg

    here = os.path.dirname(os.path.abspath(__file__))
    src = os.path.join(os.path.dirname(here), "flake_io.py")
    spec = importlib.util.spec_from_file_location("_fpkg_sched.flake_io", src)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["_fpkg_sched.flake_io"] = mod
    spec.loader.exec_module(mod)
    return mod


fio = _load_flake_io()
KF = fio.ScheduleKeyframe


def _with_flakes(raw_map):
    fio.load_flake = lambda name: fio._flake_from_raw(name, raw_map[name])


def _lora(flake, path):
    return next(lr for lr in flake.loras if lr.path == path)


def test_schedule_sorted_clamped_last_duplicate_wins():
    sched = fio._parse_schedule([
        {"start": 0.6, "strength": 0.0},
        {"start": -0.2, "strength": 0.5},
        {"start": 1.5, "strength": 2.0},
        {"start": 0.6, "strength": 0.3},
    ])
    assert sched == [KF(0.0, 0.5), KF(0.6, 0.3), KF(1.0, 2.0)]


def test_empty_or_missing_schedule_is_no_schedule():
    assert fio._parse_schedule([]) == []
    assert fio._parse_schedule(None) == []
    flake = fio._flake_from_raw("f", {"loras": [{"path": "a.safetensors", "schedule": []}]})
    assert flake.loras[0].schedule == []


def test_strength_is_one_before_first_keyframe():
    sched = [KF(0.3, 0.0), KF(0.7, 0.5)]
    assert fio.schedule_strength(sched, 0.0) == 1.0
    assert fio.schedule_strength(sched, 0.3) == 0.0
    assert fio.schedule_strength(sched, 0.9) == 0.5


def test_multiply_schedules_piecewise_product():
    a = [KF(0.0, 1.0), KF(0.5, 0.0)]
    b = [KF(0.25, 0.5)]
    assert fio.multiply_schedules(a, b) == [KF(0.0, 1.0), KF(0.25, 0.5), KF(0.5, 0.0)]
    assert fio.multiply_schedules([], b) == b
    assert fio.multiply_schedules(a, []) == a


def test_legacy_prompt_still_read():
    flake = fio._flake_from_raw("f", {"prompt": {"positive": "a cat", "negative": "blurry"}})
    assert (flake.positive, flake.negative) == ("a cat", "blurry")
    assert flake.scheduled_prompts == []


def test_prompts_list_splits_unscheduled_and_scheduled():
    flake = fio._flake_from_raw("f", {"prompts": [
        {"positive": "a cat", "negative": "blurry"},
        {"positive": "sunset", "schedule": [{"start": 0.5, "strength": 0.0}]},
        {"positive": "red hat"},
    ]})
    assert flake.positive == "a cat, red hat"
    assert flake.negative == "blurry"
    assert len(flake.scheduled_prompts) == 1
    assert flake.scheduled_prompts[0].positive == "sunset"
    assert flake.scheduled_prompts[0].schedule == [KF(0.5, 0.0)]


def test_lora_and_link_schedules_parsed():
    flake = fio._flake_from_raw("f", {
        "loras": [{"path": "a.safetensors", "schedule": [{"start": 0.0, "strength": 1.0}, {"start": 0.6, "strength": 0.0}]}],
        "flake_links": [{"target": "g", "schedule": [{"start": 0.2, "strength": 0.5}]}],
    })
    assert flake.loras[0].schedule == [KF(0.0, 1.0), KF(0.6, 0.0)]
    assert flake.flake_links[0].schedule == [KF(0.2, 0.5)]


def test_link_schedule_multiplies_into_linked_loras_and_prompts():
    _with_flakes({
        "light": {
            "prompt": {"positive": "rim light", "negative": "flat"},
            "loras": [
                {"path": "plain.safetensors"},
                {"path": "sched.safetensors", "schedule": [{"start": 0.25, "strength": 0.5}]},
            ],
        },
        "host": {
            "prompt": {"positive": "portrait"},
            "loras": [{"path": "host.safetensors"}],
            "flake_links": [{"target": "light", "schedule": [{"start": 0.5, "strength": 0.0}]}],
        },
    })
    flake = fio.resolve({"name": "host"})
    assert _lora(flake, "host.safetensors").schedule == []
    assert _lora(flake, "plain.safetensors").schedule == [KF(0.5, 0.0)]
    assert _lora(flake, "sched.safetensors").schedule == [KF(0.25, 0.5), KF(0.5, 0.0)]
    # The linked text moves out of the host's unscheduled prompt.
    assert flake.positive == "portrait"
    assert len(flake.scheduled_prompts) == 1
    p = flake.scheduled_prompts[0]
    assert (p.positive, p.negative, p.schedule) == ("rim light", "flat", [KF(0.5, 0.0)])


def test_unscheduled_link_keeps_text_join_and_carries_scheduled_prompts():
    _with_flakes({
        "light": {"prompts": [
            {"positive": "rim light"},
            {"positive": "glow", "schedule": [{"start": 0.7, "strength": 0.0}]},
        ]},
        "host": {"prompt": {"positive": "portrait"}, "flake_links": [{"target": "light"}]},
    })
    flake = fio.resolve({"name": "host"})
    assert flake.positive == "portrait, rim light"
    assert [p.positive for p in flake.scheduled_prompts] == ["glow"]


def test_variant_choice_lora_keeps_own_schedule_and_text_appends():
    _with_flakes({
        "pose": {
            "prompt": {"positive": "base"},
            "variants": {"style": {"dramatic": {
                "positive": "moody",
                "loras": [{"path": "drama.safetensors", "schedule": [{"start": 0.4, "strength": 0.0}]}],
            }}},
        },
    })
    flake = fio.resolve({"name": "pose", "variant": {"style": "dramatic"}})
    assert flake.positive == "base, moody"
    assert _lora(flake, "drama.safetensors").schedule == [KF(0.4, 0.0)]


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
