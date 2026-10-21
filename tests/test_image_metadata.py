"""Saved Flake Generate images only describe the combination that produced
them (#426): Model Combo -> Model Preset, Combo -> Stack with the used entry,
stack All Variants collapsed, Generate seed fixed with a single-image overlay.

``flake_data_nodes`` imports ComfyUI runtime modules and sibling modules with
relative imports, so those are stubbed and the file is loaded under a
synthetic package.
"""
import importlib.util
import json
import os
import sys
import types


def _load_module():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    sys.modules.setdefault("folder_paths", types.ModuleType("folder_paths"))
    nodes = sys.modules.setdefault("nodes", types.ModuleType("nodes"))
    for attr in ("KSampler", "VAEDecode", "SaveImage"):
        if not hasattr(nodes, attr):
            setattr(nodes, attr, object)

    pkg = types.ModuleType("_flakemeta")
    pkg.__path__ = [root]
    sys.modules["_flakemeta"] = pkg
    sys.modules["_flakemeta.flake_compose"] = types.ModuleType("_flakemeta.flake_compose")
    ffn = types.ModuleType("_flakemeta.full_flake_node")
    ffn._build_filename_prefix = lambda *a, **k: ""
    sys.modules["_flakemeta.full_flake_node"] = ffn

    spec = importlib.util.spec_from_file_location("_flakemeta.flake_data_nodes", os.path.join(root, "flake_data_nodes.py"))
    mod = importlib.util.module_from_spec(spec)
    sys.modules["_flakemeta.flake_data_nodes"] = mod
    spec.loader.exec_module(mod)
    return mod


_mod = _load_module()

DEFAULT = {"inline": True, "content": {"prompt": {"positive": ""}}, "loras": [], "strength": 1.0, "option": {}}

# What queue.js queues for preset 2 x item 5 of Combo A x item 3 of Combo B.
OVERRIDES = '{"steps":30,"cfg":5}'
COMBO_A_ITEM = {"name": "Characters/alice", "loras": [0.8], "variant": {"outfit": "red", "hair": "long"},
                "_uid": "a5", "_all_variants": True}
COMBO_B_ITEM = {"name": "Styles/ink", "loras": [1.0], "variant": {"mood": ["calm"]}, "_uid": "b3",
                "_output_stem_override": "ink"}
STACK = [
    {"inline": True, "content": {"prompt": {"positive": "masterpiece"}}, "loras": [], "strength": 1.0, "option": {}},
    {"name": "Poses/sitting", "loras": [1.0], "variant": {}},
    {"name": "Poses/standing", "loras": [1.0], "variant": {}, "bypassed": True},
    {"name": "Places/beach", "loras": [0.6], "variant": {"time": "dusk"}, "_all_variants": True},
]


def _fixture():
    a_raw = json.dumps([COMBO_A_ITEM])
    b_raw = json.dumps([COMBO_B_ITEM])
    stack_raw = json.dumps(STACK)
    prompt = {
        "1": {"class_type": "FlakeModelCombo", "inputs": {"model_family": "SDXL/Base", "preset": "SDXL/preset2", "overrides_json": OVERRIDES}},
        "2": {"class_type": "FlakeCombo", "inputs": {"model_family": "SDXL/Base", "flake_data": ["1", 0], "flakes_json": a_raw}},
        "10:3": {"class_type": "FlakeCombo", "inputs": {"model_family": "SDXL/Base", "flake_data": ["2", 0], "flakes_json": b_raw}},
        "4": {"class_type": "FlakeStack", "inputs": {"model_family": "SDXL/Base", "flake_data": ["10:3", 0], "flakes_json": stack_raw}},
        "5": {"class_type": "FlakeGenerate", "inputs": {"flake_data": ["4", 0], "seed": 1234, "adetailer": "A/B"}},
    }
    combo_props = {"Node name for S&R": "FlakeCombo", "_combo_active_index": 4}
    workflow = {
        "nodes": [
            {"id": 1, "type": "FlakeModelCombo", "widgets_values": ["SDXL/Base", "SDXL/preset2", OVERRIDES],
             "properties": {"Node name for S&R": "FlakeModelCombo", "_combo_presets": ["SDXL/preset1", "SDXL/preset2"],
                            "_combo_overrides": [{}, {"steps": 30, "cfg": 5}], "_combo_uids": ["p1", "p2"],
                            "_combo_bypassed": [], "_combo_display_names": {}, "_combo_active_index": 0}},
            {"id": 2, "type": "FlakeCombo", "widgets_values": ["SDXL/Base", a_raw],
             "properties": {**combo_props, "_combo_flakes": [{"name": "Characters/bob", "_uid": "a1"}, COMBO_A_ITEM]}},
            {"id": 10, "type": "sg-uuid", "widgets_values": []},
            {"id": 4, "type": "FlakeStack", "widgets_values": ["SDXL/Base", stack_raw], "properties": {"Node name for S&R": "FlakeStack"}},
            {"id": 5, "type": "FlakeGenerate",
             "widgets_values": [1234, "randomize", "A/B", 0.4, 0, "bbox/face_yolov8m.pt", False, "", 1.5],
             "properties": {"_images_by_combo": {"1:p1|2:a1": {"filename": "old.png"}}, "_images_by_combo_ad": {"1:p1|2:a1": {"filename": "old_ad.png"}},
                            "_adetailer_ab": True, "_last_image": {"filename": "old.png"}, "_last_image_ad": {"filename": "old_ad.png"}}},
        ],
        "definitions": {"subgraphs": [{
            "id": "sg-uuid",
            "nodes": [{"id": 3, "type": "FlakeCombo", "widgets_values": ["SDXL/Base", b_raw],
                       "properties": {**combo_props, "_combo_flakes": [COMBO_B_ITEM]}}],
        }]},
    }
    return prompt, {"workflow": workflow}


def _wf(extra, nid):
    return _mod._wf_node(extra, nid)


def test_originals_untouched():
    prompt, extra = _fixture()
    before = json.dumps([prompt, extra])
    _mod._used_only_metadata(prompt, extra)
    assert json.dumps([prompt, extra]) == before


def test_model_combo_becomes_preset():
    prompt, extra = _mod._used_only_metadata(*_fixture())
    assert prompt["1"] == {"class_type": "FlakeModelPreset", "inputs": {"model_family": "SDXL/Base", "preset": "SDXL/preset2", "overrides_json": OVERRIDES}}
    wf = _wf(extra, "1")
    assert wf["type"] == "FlakeModelPreset"
    assert wf["widgets_values"] == ["SDXL/Base", "SDXL/preset2", OVERRIDES]
    assert wf["properties"] == {"Node name for S&R": "FlakeModelPreset", "_overrides": {"steps": 30, "cfg": 5}}


def test_combo_becomes_stack_with_used_entry():
    prompt, extra = _mod._used_only_metadata(*_fixture())
    entry = {"name": "Characters/alice", "loras": [0.8], "variant": {"outfit": "red", "hair": "long"}}
    assert prompt["2"]["class_type"] == "FlakeStack"
    assert json.loads(prompt["2"]["inputs"]["flakes_json"]) == [DEFAULT, entry]
    wf = _wf(extra, "2")
    assert wf["type"] == "FlakeStack"
    assert wf["widgets_values"] == ["SDXL/Base", prompt["2"]["inputs"]["flakes_json"]]
    assert wf["properties"] == {"Node name for S&R": "FlakeStack"}


def test_combo_in_subgraph():
    prompt, extra = _mod._used_only_metadata(*_fixture())
    entry = {"name": "Styles/ink", "loras": [1.0], "variant": {"mood": "calm"}, "_output_stem_override": "ink"}
    assert prompt["10:3"]["class_type"] == "FlakeStack"
    assert json.loads(prompt["10:3"]["inputs"]["flakes_json"]) == [DEFAULT, entry]
    wf = extra["workflow"]["definitions"]["subgraphs"][0]["nodes"][0]
    assert wf["type"] == "FlakeStack"
    assert wf["widgets_values"][1] == prompt["10:3"]["inputs"]["flakes_json"]
    assert _wf(extra, "3") is None


def test_stack_drops_bypassed_and_collapses_all_variants():
    prompt, extra = _mod._used_only_metadata(*_fixture())
    used = json.loads(prompt["4"]["inputs"]["flakes_json"])
    assert used == [STACK[0], STACK[1], {"name": "Places/beach", "loras": [0.6], "variant": {"time": "dusk"}}]
    assert _wf(extra, "4")["widgets_values"][1] == prompt["4"]["inputs"]["flakes_json"]


def test_generate_points_at_saved_image():
    _, extra = _mod._used_only_metadata(*_fixture())
    image = {"filename": "SDXL/alice_ad_00007.png", "subfolder": "", "type": "output"}
    _mod._set_generate_image(extra, "5", 1234, image)
    wf = _wf(extra, "5")
    assert wf["widgets_values"][:3] == [1234, "fixed", "A/B"]
    assert wf["properties"] == {"_images_by_combo": {"": image}, "_images_by_combo_ad": {}, "_adetailer_ab": False, "_last_image": image}


def test_without_workflow():
    prompt, extra = _fixture()
    meta_prompt, meta_extra = _mod._used_only_metadata(prompt, None)
    assert meta_extra is None
    assert meta_prompt["1"]["class_type"] == "FlakeModelPreset"
    _mod._set_generate_image(meta_extra, "5", 1234, {})
