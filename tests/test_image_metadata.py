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
    ffn._attention_options = lambda: ["default"]
    ffn._apply_attention = lambda model, attention: model
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
    assert wf["properties"] == {"Node name for S&R": "FlakeModelPreset", "_overrides": {"steps": 30, "cfg": 5}, "_fit_size": True}


def test_combo_becomes_stack_with_used_entry():
    prompt, extra = _mod._used_only_metadata(*_fixture())
    entry = {"name": "Characters/alice", "loras": [0.8], "variant": {"outfit": "red", "hair": "long"}}
    assert prompt["2"]["class_type"] == "FlakeStack"
    assert json.loads(prompt["2"]["inputs"]["flakes_json"]) == [DEFAULT, entry]
    wf = _wf(extra, "2")
    assert wf["type"] == "FlakeStack"
    assert wf["widgets_values"] == ["SDXL/Base", prompt["2"]["inputs"]["flakes_json"]]
    assert wf["properties"] == {"Node name for S&R": "FlakeStack", "_fit_size": True}


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
    assert "_fit_size" not in _wf(extra, "4")["properties"]


def _chain(*stacks, extra_consumer=None):
    """Root-level preset 1 -> stacks 2, 3, ... -> Flake Generate 99, as
    (class_type, entries) pairs; link i+1 feeds node i+2."""
    ids = [str(i + 2) for i in range(len(stacks))]
    prompt = {"1": {"class_type": "FlakeModelPreset", "inputs": {"preset": "SDXL/p"}}}
    nodes = [{"id": 1, "type": "FlakeModelPreset", "outputs": [{"links": [1]}]}]
    links = []
    for i, (nid, (cls, entries)) in enumerate(zip(ids, stacks)):
        raw = json.dumps(entries)
        prompt[nid] = {"class_type": cls, "inputs": {"model_family": "SDXL/Base", "flake_data": [str(i + 1), 0], "flakes_json": raw}}
        nodes.append({"id": int(nid), "type": cls, "widgets_values": ["SDXL/Base", raw], "outputs": [{"links": [i + 2]}],
                      "properties": {"Node name for S&R": cls}})
        links.append([i + 1, i + 1, 0, int(nid), 0, "FLAKE_DATA"])
    prompt["99"] = {"class_type": "FlakeGenerate", "inputs": {"flake_data": [ids[-1], 0], "seed": 1}}
    nodes.append({"id": 99, "type": "FlakeGenerate", "inputs": [{"link": len(stacks) + 1}]})
    links.append([len(stacks) + 1, int(ids[-1]), 0, 99, 0, "FLAKE_DATA"])
    if extra_consumer:
        nid = str(extra_consumer)
        prompt["98"] = {"class_type": "PreviewFlakeData", "inputs": {"flake_data": [nid, 0]}}
        nodes.append({"id": 98, "type": "PreviewFlakeData"})
        next(n for n in nodes if str(n["id"]) == nid)["outputs"][0]["links"].append(50)
        links.append([50, int(nid), 0, 98, 0, "FLAKE_DATA"])
    return prompt, {"workflow": {"nodes": nodes, "links": links}}


def _fake_flakes(monkeypatch):
    sizes = {"Sizes/portrait": (832, 1216)}
    monkeypatch.setattr(_mod.flake_io, "load_flake", lambda name: _mod.flake_io.Flake(name=name, resolution=sizes.get(name)))


SITTING = {"name": "Poses/sitting", "loras": [1.0], "variant": {}}
PORTRAIT = {"name": "Sizes/portrait"}
PROMPTED = {**DEFAULT, "content": {"prompt": {"positive": "masterpiece"}}}


def _stack_ids(prompt):
    return sorted(k for k, v in prompt.items() if v["class_type"] == "FlakeStack")


def test_chained_stacks_merge_into_first(monkeypatch):
    _fake_flakes(monkeypatch)
    prompt, extra = _mod._used_only_metadata(*_chain(
        ("FlakeCombo", [COMBO_A_ITEM]), ("FlakeCombo", [COMBO_B_ITEM]), ("FlakeStack", [DEFAULT, SITTING])))
    alice = {"name": "Characters/alice", "loras": [0.8], "variant": {"outfit": "red", "hair": "long"}}
    ink = {"name": "Styles/ink", "loras": [1.0], "variant": {"mood": "calm"}, "_output_stem_override": "ink"}
    assert _stack_ids(prompt) == ["2"]
    assert json.loads(prompt["2"]["inputs"]["flakes_json"]) == [DEFAULT, alice, ink, SITTING]
    assert prompt["2"]["inputs"]["flake_data"] == ["1", 0]
    assert prompt["99"]["inputs"]["flake_data"] == ["2", 0]

    wf = extra["workflow"]
    assert [n["id"] for n in wf["nodes"]] == [1, 2, 99]
    assert wf["links"] == [[1, 1, 0, 2, 0, "FLAKE_DATA"], [4, 2, 0, 99, 0, "FLAKE_DATA"]]
    node = _wf(extra, "2")
    assert node["outputs"][0]["links"] == [4]
    assert node["widgets_values"] == ["SDXL/Base", prompt["2"]["inputs"]["flakes_json"]]
    assert node["properties"]["_fit_size"] is True


def test_plain_stacks_merge_and_get_fitted(monkeypatch):
    _fake_flakes(monkeypatch)
    prompt, extra = _mod._used_only_metadata(*_chain(("FlakeStack", [PROMPTED, PORTRAIT]), ("FlakeStack", [DEFAULT, SITTING])))
    assert _stack_ids(prompt) == ["2"]
    assert json.loads(prompt["2"]["inputs"]["flakes_json"]) == [PROMPTED, PORTRAIT, SITTING]
    assert _wf(extra, "2")["properties"]["_fit_size"] is True


def test_prompted_default_splits_the_run(monkeypatch):
    _fake_flakes(monkeypatch)
    prompt, extra = _mod._used_only_metadata(*_chain(
        ("FlakeStack", [DEFAULT, SITTING]), ("FlakeStack", [PROMPTED]), ("FlakeStack", [DEFAULT, SITTING])))
    assert _stack_ids(prompt) == ["2", "3"]
    assert json.loads(prompt["3"]["inputs"]["flakes_json"]) == [PROMPTED, SITTING]
    assert prompt["3"]["inputs"]["flake_data"] == ["2", 0]
    assert prompt["99"]["inputs"]["flake_data"] == ["3", 0]
    assert "_fit_size" not in _wf(extra, "2")["properties"]


def test_sizing_stack_starts_a_new_run(monkeypatch):
    _fake_flakes(monkeypatch)
    prompt, _ = _mod._used_only_metadata(*_chain(
        ("FlakeStack", [DEFAULT, PORTRAIT]), ("FlakeStack", [DEFAULT, SITTING]), ("FlakeStack", [DEFAULT, PORTRAIT])))
    assert _stack_ids(prompt) == ["2", "4"]
    assert json.loads(prompt["2"]["inputs"]["flakes_json"]) == [DEFAULT, PORTRAIT, SITTING]
    assert prompt["4"]["inputs"]["flake_data"] == ["2", 0]


def test_stack_with_two_consumers_is_not_merged(monkeypatch):
    _fake_flakes(monkeypatch)
    prompt, extra = _mod._used_only_metadata(*_chain(
        ("FlakeStack", [DEFAULT, SITTING]), ("FlakeStack", [DEFAULT, SITTING]), extra_consumer=2))
    assert _stack_ids(prompt) == ["2", "3"]
    assert len(extra["workflow"]["links"]) == 4


def test_generate_points_at_saved_image():
    _, extra = _mod._used_only_metadata(*_fixture())
    image = {"filename": "SDXL/alice_ad_00007.png", "subfolder": "", "type": "output"}
    _mod._set_generate_image(extra, "5", 1234, image)
    wf = _wf(extra, "5")
    assert wf["widgets_values"][:3] == [1234, "fixed", "A/B"]
    assert wf["properties"] == {"_images_by_combo": {"": image}, "_images_by_combo_ad": {}, "_adetailer_ab": False, "_last_image": image}


def test_bundle_holds_flakes_and_preset_feeding_generate(monkeypatch):
    prompt, _ = _mod._used_only_metadata(*_fixture())
    prompt["6"] = {"class_type": "FlakeStack", "inputs": {"flake_data": ["1", 0], "flakes_json": json.dumps([{"name": "Other/unused"}])}}
    monkeypatch.setattr(_mod.flake_io, "collect_bundle", lambda flakes, presets: (sorted(flakes), presets))
    assert _mod._flake_bundle(prompt, "5") == (
        ["Characters/alice", "Places/beach", "Poses/sitting", "Styles/ink"], ["SDXL/preset2"])


def test_without_workflow():
    prompt, extra = _fixture()
    meta_prompt, meta_extra = _mod._used_only_metadata(prompt, None)
    assert meta_extra is None
    assert meta_prompt["1"]["class_type"] == "FlakeModelPreset"
    _mod._set_generate_image(meta_extra, "5", 1234, {})
