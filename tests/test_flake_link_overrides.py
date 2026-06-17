"""Round-trip tests for flake-link LoRA-strength / variant overrides (#300).

A host flake (``dim_room``) links a target flake (``dramatic_lighting``) and
overrides the target's default LoRA strength from its own yaml
(``flake_links[i].lora_strengths``). Resolving the host must apply that override
to the linked flake's LoRA — with no per-grid placement override present.

``flake_io`` only imports ``folder_paths``, so we stub it and load the module
under a synthetic package, then monkeypatch ``load_flake`` to serve flakes from
an in-memory yaml map. Run directly or via pytest.
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

    pkg = types.ModuleType("_fpkg")
    pkg.__path__ = []
    sys.modules["_fpkg"] = pkg

    here = os.path.dirname(os.path.abspath(__file__))
    src = os.path.join(os.path.dirname(here), "flake_io.py")
    spec = importlib.util.spec_from_file_location("_fpkg.flake_io", src)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["_fpkg.flake_io"] = mod
    spec.loader.exec_module(mod)
    return mod


fio = _load_flake_io()


def _with_flakes(raw_map):
    """Monkeypatch load_flake to build flakes from an in-memory raw-yaml map."""
    fio.load_flake = lambda name: fio._flake_from_raw(name, raw_map[name])


def _strength_of(flake, path):
    for lr in flake.loras:
        if lr.path == path:
            return lr.strength
    return None


def test_link_override_applies_modern_loras():
    _with_flakes({
        "dramatic_lighting": {
            "name": "Dramatic Lighting",
            "loras": [{"name": "drama", "path": "drama.safetensors", "strength": 0.5}],
        },
        "dim_room": {
            "name": "Dim Room",
            "flake_links": [{"target": "dramatic_lighting", "lora_strengths": [0.8]}],
        },
    })
    flake = fio.resolve({"name": "dim_room"})
    assert _strength_of(flake, "drama.safetensors") == 0.8


def test_link_override_applies_legacy_single_lora():
    # The target stores its LoRA the legacy way (path/strength, no `loras` list).
    _with_flakes({
        "dramatic_lighting": {
            "name": "Dramatic Lighting",
            "path": "drama.safetensors",
            "strength": 0.5,
        },
        "dim_room": {
            "name": "Dim Room",
            "flake_links": [{"target": "dramatic_lighting", "lora_strengths": [0.8]}],
        },
    })
    flake = fio.resolve({"name": "dim_room"})
    assert _strength_of(flake, "drama.safetensors") == 0.8


def test_link_no_override_uses_target_default():
    _with_flakes({
        "dramatic_lighting": {
            "name": "Dramatic Lighting",
            "loras": [{"name": "drama", "path": "drama.safetensors", "strength": 0.5}],
        },
        "dim_room": {
            "name": "Dim Room",
            "flake_links": [{"target": "dramatic_lighting"}],
        },
    })
    flake = fio.resolve({"name": "dim_room"})
    assert _strength_of(flake, "drama.safetensors") == 0.5


def test_grid_override_beats_yaml_override():
    # A per-placement grid override should win over the host yaml override.
    _with_flakes({
        "dramatic_lighting": {
            "name": "Dramatic Lighting",
            "loras": [{"name": "drama", "path": "drama.safetensors", "strength": 0.5}],
        },
        "dim_room": {
            "name": "Dim Room",
            "flake_links": [{"target": "dramatic_lighting", "lora_strengths": [0.8]}],
        },
    })
    flake = fio.resolve({"name": "dim_room", "flake_link_overrides": [{"lora_strengths": [0.3]}]})
    assert _strength_of(flake, "drama.safetensors") == 0.3


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
