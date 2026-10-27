from __future__ import annotations

import copy
import json
import logging
import os

try:
    from comfy.samplers import KSampler as _KSampler
    _SAMPLER_TYPES = (_KSampler.SAMPLERS, _KSampler.SCHEDULERS)
except Exception:
    _SAMPLER_TYPES = ("STRING", "STRING")

import folder_paths
from nodes import KSampler, VAEDecode, SaveImage

from . import flake_compose, flake_io
from .full_flake_node import _apply_attention, _attention_options, _build_filename_prefix

_ADETAILER_DEFAULT_BBOX = "bbox/face_yolov8m.pt"


def _list_adetailer_bbox() -> list[str]:
    """ADetailer bbox model choices (#306): Impact Pack's ultralytics_bbox plus a
    direct scan of models/adetailer/. Always includes the default so the COMBO is
    never empty."""
    names: list[str] = []
    try:
        names += folder_paths.get_filename_list("ultralytics_bbox")
    except Exception:
        pass
    base = os.path.join(folder_paths.base_path, "models", "adetailer")
    if os.path.isdir(base):
        for root, _dirs, files in os.walk(base):
            for f in files:
                if f.lower().endswith((".pt", ".pth", ".onnx", ".safetensors")):
                    rel = os.path.relpath(os.path.join(root, f), base).replace(os.sep, "/")
                    names.append(rel)
    out = sorted(set(names))
    if _ADETAILER_DEFAULT_BBOX not in out:
        out.append(_ADETAILER_DEFAULT_BBOX)
    return out


def _list_upscale_models() -> list[str]:
    """Upscale model choices (#306); "" = plain rescale to factor."""
    try:
        return [""] + folder_paths.get_filename_list("upscale_models")
    except Exception:
        return [""]

_ALL_PINS = [
    ("model", "MODEL"),
    ("clip", "CLIP"),
    ("vae", "VAE"),
    ("positive", "CONDITIONING"),
    ("negative", "CONDITIONING"),
    ("latent", "LATENT"),
    ("filename_prefix", "STRING"),
    ("width", "INT"),
    ("height", "INT"),
    ("steps", "INT"),
    ("cfg", "FLOAT"),
    # Use STRING for outputs — COMBO lists are input-only in ComfyUI and would
    # prevent node registration when used as RETURN_TYPES.
    ("sampler_name", "STRING"),
    ("scheduler", "STRING"),
]

# Separate pin definitions for input types (used by IntoFlakeDataSelect/IntoFlakeDataAll)
_ALL_INPUT_TYPES = {
    "sampler_name": _SAMPLER_TYPES[0],
    "scheduler": _SAMPLER_TYPES[1],
}


def _split_flake_data(flake_data):
    model_bundle, generation_data, sampling_preset = flake_data
    model, clip, vae = model_bundle
    positive, negative, latent, width, height = generation_data[:5]
    pos_text, neg_text = generation_data[5:7]
    if len(generation_data) > 7 and isinstance(generation_data[7], dict):
        filename_prefix = _build_filename_prefix(
            generation_data[7].get("preset", ""),
            generation_data[7].get("stems", []),
        )
    else:
        filename_prefix = ""
    steps, cfg, sampler_name, scheduler, denoise = sampling_preset
    return {
        "model": model,
        "clip": clip,
        "vae": vae,
        "positive": positive,
        "negative": negative,
        "latent": latent,
        "filename_prefix": filename_prefix,
        "width": width,
        "height": height,
        "steps": steps,
        "cfg": cfg,
        "sampler_name": sampler_name,
        "scheduler": scheduler,
        "denoise": denoise,
    }


class FlakeDataSplitAll:
    """Splits FLAKE_DATA into all individual outputs (replacing Flake Model Split,
    Flake Generation Data, and Flake Sampling Values)."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "flake_data": ("FLAKE_DATA",),
            },
        }

    RETURN_TYPES = tuple(t for _, t in _ALL_PINS)
    RETURN_NAMES = tuple(n for n, _ in _ALL_PINS)
    FUNCTION = "execute"
    CATEGORY = "flakes"
    DESCRIPTION = "Split FLAKE_DATA into all individual model, generation, and sampler outputs."

    def execute(self, flake_data):
        parts = _split_flake_data(flake_data)
        return tuple(parts[n] for n, _ in _ALL_PINS)


class FlakeDataSplitSelect:
    """Splits FLAKE_DATA into individually selectable output pins.
    Use the dropdown and [+] button on the node to add output pins."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "flake_data": ("FLAKE_DATA",),
            },
        }

    RETURN_TYPES = tuple(t for _, t in _ALL_PINS)
    RETURN_NAMES = tuple(n for n, _ in _ALL_PINS)
    FUNCTION = "execute"
    CATEGORY = "flakes"
    DESCRIPTION = "Split FLAKE_DATA into individually selectable output pins. Use the dropdown and +/- buttons to add or remove pins."

    def execute(self, flake_data):
        parts = _split_flake_data(flake_data)
        return tuple(parts[n] for n, _ in _ALL_PINS)


class IntoFlakeDataAll:
    """Combines model, clip, vae, conditioning, latent, and sampler values into FLAKE_DATA.
    All inputs are optional — connect only the ones you need."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": {
                "model": ("MODEL",),
                "clip": ("CLIP",),
                "vae": ("VAE",),
                "positive": ("CONDITIONING",),
                "negative": ("CONDITIONING",),
                "latent": ("LATENT",),
                "width": ("INT", {"default": 1024}),
                "height": ("INT", {"default": 1024}),
                "steps": ("INT", {"default": 20}),
                "cfg": ("FLOAT", {"default": 7.0}),
                "sampler_name": (_SAMPLER_TYPES[0], {"default": "euler"}),
                "scheduler": (_SAMPLER_TYPES[1], {"default": "normal"}),
            },
        }

    RETURN_TYPES = ("FLAKE_DATA",)
    RETURN_NAMES = ("flake_data",)
    FUNCTION = "execute"
    CATEGORY = "flakes"
    DESCRIPTION = "Combine individual model, generation, and sampler values into a single FLAKE_DATA pin. Only connect the inputs you need."

    def execute(self, model=None, clip=None, vae=None, positive=None, negative=None,
                latent=None, width=1024, height=1024, steps=20, cfg=7.0,
                sampler_name="euler", scheduler="normal"):
        if model is not None and clip is not None and vae is not None:
            model_bundle = (model, clip, vae)
        else:
            model_bundle = None

        filename_state = {"preset": "", "stems": []}
        pos_text = ""
        neg_text = ""
        if positive is not None and negative is not None:
            generation_data = (positive, negative, latent, width, height, pos_text, neg_text, filename_state)
        else:
            generation_data = None

        sampling_preset = (steps, cfg, sampler_name, scheduler, 1.0)

        return ((model_bundle, generation_data, sampling_preset),)


class IntoFlakeDataSelect:
    """Selectively override fields of an incoming FLAKE_DATA with individual values.
    Use the dropdown and [+] button to add input pins dynamically.
    Only connected pins override the incoming data; all others pass through unchanged."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "flake_data": ("FLAKE_DATA",),
            },
            "optional": {
                "model": ("MODEL",),
                "clip": ("CLIP",),
                "vae": ("VAE",),
                "positive": ("CONDITIONING",),
                "negative": ("CONDITIONING",),
                "latent": ("LATENT",),
                "filename_prefix": ("STRING",),
                "width": ("INT",),
                "height": ("INT",),
                "steps": ("INT",),
                "cfg": ("FLOAT",),
                "sampler_name": (_SAMPLER_TYPES[0],),
                "scheduler": (_SAMPLER_TYPES[1],),
            },
        }

    RETURN_TYPES = ("FLAKE_DATA",)
    RETURN_NAMES = ("flake_data",)
    FUNCTION = "execute"
    CATEGORY = "flakes"
    DESCRIPTION = "Override individual fields of an incoming FLAKE_DATA. Use the dropdown and [+] button to add input pins. Only connected pins override the original data."

    def execute(self, flake_data, model=None, clip=None, vae=None,
                positive=None, negative=None, latent=None,
                filename_prefix=None, width=None, height=None,
                steps=None, cfg=None, sampler_name=None, scheduler=None):
        orig_model_bundle, orig_generation_data, orig_sampling_preset = flake_data
        orig_model, orig_clip, orig_vae = orig_model_bundle
        orig_positive, orig_negative, orig_latent, orig_width, orig_height = orig_generation_data[:5]
        orig_pos_text, orig_neg_text = orig_generation_data[5:7]
        orig_filename_state = {}
        if len(orig_generation_data) > 7 and isinstance(orig_generation_data[7], dict):
            orig_filename_state = orig_generation_data[7]
        orig_steps, orig_cfg, orig_sampler, orig_scheduler, orig_denoise = orig_sampling_preset

        new_model_bundle = (
            model if model is not None else orig_model,
            clip if clip is not None else orig_clip,
            vae if vae is not None else orig_vae,
        )
        new_filename_state = dict(orig_filename_state)
        if filename_prefix is not None:
            new_filename_state["preset"] = filename_prefix

        new_generation_data = (
            positive if positive is not None else orig_positive,
            negative if negative is not None else orig_negative,
            latent if latent is not None else orig_latent,
            width if width is not None else orig_width,
            height if height is not None else orig_height,
            orig_pos_text,
            orig_neg_text,
            new_filename_state,
        )
        new_sampling_preset = (
            steps if steps is not None else orig_steps,
            cfg if cfg is not None else orig_cfg,
            sampler_name if sampler_name is not None else orig_sampler,
            scheduler if scheduler is not None else orig_scheduler,
            orig_denoise,
        )

        return ((new_model_bundle, new_generation_data, new_sampling_preset),)


class PreviewFlakeData:
    """Pass-through node that displays a preview of the data in a FLAKE_DATA pin.
    Shows Models, Prompts, Parameters, and Metadata in a grid overlay.
    The FLAKE_DATA passes through unchanged."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "flake_data": ("FLAKE_DATA",),
            },
        }

    RETURN_TYPES = ("FLAKE_DATA",)
    RETURN_NAMES = ("flake_data",)
    FUNCTION = "execute"
    CATEGORY = "flakes"
    DESCRIPTION = "Preview the contents of a FLAKE_DATA pin. Shows Models, Prompts, Parameters, and Metadata. The data passes through unchanged."
    OUTPUT_NODE = True

    def execute(self, flake_data):
        model_bundle, generation_data, sampling_preset = flake_data

        models_info = {}
        prompts_info = {}
        params_info = {}
        meta_info = {}

        meta = {}
        if generation_data is not None and len(generation_data) > 7 and isinstance(generation_data[7], dict):
            meta = generation_data[7]

        # --- Models ---
        if model_bundle is not None:
            model, clip, vae = model_bundle

            ckpt_name = meta.get("checkpoint", "")
            if ckpt_name:
                models_info["Checkpoint"] = ckpt_name
            elif model is not None:
                ckpt_attr = getattr(model, "sd_checkpoint_name", None)
                models_info["Checkpoint"] = ckpt_attr if ckpt_attr else "(loaded)"

            vae_name = meta.get("vae")
            if vae_name is not None:
                models_info["VAE"] = vae_name if vae_name != "baked-in" else "baked-in"
            else:
                models_info["VAE"] = "(loaded)" if vae is not None else "none"

            te_name = meta.get("text_encoder")
            if te_name is not None:
                models_info["Text Encoder"] = te_name if te_name != "baked-in" else "baked-in"
            else:
                models_info["Text Encoder"] = "(loaded)" if clip is not None else "none"

            loras = meta.get("loras", [])
            for i, lr in enumerate(loras):
                lr_display = lr.get("name", "") or lr.get("path", "") or f"LoRA #{i + 1}"
                lr_strength = lr.get("strength", 1.0)
                models_info[lr_display] = f"strength: {lr_strength}"

        # --- Prompts ---
        if generation_data is not None:
            pos_text = generation_data[5] if len(generation_data) > 5 else ""
            neg_text = generation_data[6] if len(generation_data) > 6 else ""
            if pos_text:
                prompts_info["Positive"] = str(pos_text)
            if neg_text:
                prompts_info["Negative"] = str(neg_text)

        # --- Parameters ---
        if sampling_preset is not None:
            steps, cfg, sampler_name, scheduler, denoise = sampling_preset
            params_info["Steps"] = str(steps)
            params_info["CFG"] = str(cfg)
            params_info["Sampler"] = str(sampler_name)
            params_info["Scheduler"] = str(scheduler)
            params_info["Denoise"] = str(denoise)

        # --- Metadata ---
        if generation_data is not None:
            width = generation_data[3] if len(generation_data) > 3 else None
            height = generation_data[4] if len(generation_data) > 4 else None
            if width is not None:
                meta_info["Width"] = str(width)
            if height is not None:
                meta_info["Height"] = str(height)

            preset = meta.get("preset", "")
            stems = meta.get("stems", [])
            fname_parts = []
            if preset:
                fname_parts.append(preset)
            if stems:
                fname_parts.append("/".join(stems))
            fname = "/".join(fname_parts) if fname_parts else ""
            if fname:
                meta_info["Filename Prefix"] = fname

        preview_data = {
            "Models": models_info,
            "Prompts": prompts_info,
            "Parameters": params_info,
            "Metadata": meta_info,
        }

        return {
            "ui": {"preview_data": [preview_data]},
            "result": (flake_data,),
        }


def _wf_node(extra_pnginfo, nid):
    """The workflow node of prompt node ``nid``, or None. Nodes inside subgraphs
    have path ids ("<instance id>:<inner id>") and live in the workflow's
    ``definitions.subgraphs``, keyed by the instance node's type."""
    workflow = extra_pnginfo.get("workflow") if isinstance(extra_pnginfo, dict) else None
    if not isinstance(workflow, dict):
        return None
    subgraphs = {sg.get("id"): sg for sg in (workflow.get("definitions") or {}).get("subgraphs") or []}
    nodes = workflow.get("nodes") or []
    *path, last = str(nid).split(":")
    for part in path:
        inst = next((n for n in nodes if str(n.get("id")) == part), None)
        sg = subgraphs.get(inst.get("type")) if inst else None
        if sg is None:
            return None
        nodes = sg.get("nodes") or []
    return next((n for n in nodes if str(n.get("id")) == last), None)


# The Flake Stack widget's index 0 (web/utils.js makeDefaultEntry).
_STACK_DEFAULT_ENTRY = {"inline": True, "content": {"prompt": {"positive": ""}}, "loras": [], "strength": 1.0, "option": {}}


def _used_entry(entry):
    """A stack entry as it ran: All Variants / Multiple collapsed to the variant
    queue.js queued, combo-only fields dropped, per-choice overrides kept for
    the used choices only, option toggles for the options it has only."""
    entry = {k: v for k, v in entry.items() if k not in ("_uid", "_all_variants")}
    if "variant" in entry:
        entry["variant"] = {g: c[0] if isinstance(c, list) else c for g, c in entry["variant"].items()}
    keys = [k for k in ("variant_loras", "variant_link_overrides") if isinstance(entry.get(k), dict)]
    toggles = entry.get("option_overrides")
    if (keys or isinstance(toggles, dict)) and not entry.get("inline"):
        try:
            flake = flake_io.resolve(entry)
        except FileNotFoundError:
            return entry
        if isinstance(toggles, dict):
            entry["option_overrides"] = {n: on for n, on in toggles.items() if n in flake.options}
            if not entry["option_overrides"]:
                del entry["option_overrides"]
        used = flake.used_variants.get(entry["name"], {})
        for k in keys:
            kept = {g: {c: v for c, v in choices.items() if c in used.get(g, ())}
                    for g, choices in entry[k].items() if isinstance(choices, dict)}
            entry[k] = {g: choices for g, choices in kept.items() if choices}
            if not entry[k]:
                del entry[k]
    return entry


def _mergeable_stack(entries):
    """Whether a stack's entries can join the end of the upstream stack without
    changing the image: no inline Default with content (the widget only keeps
    one, at index 0), and no new size (FlakeStack.execute fits every stack's
    ControlNet images to the size its first sizing flake sets)."""
    flakes = [flake_io.resolve(e) for e in entries]
    if entries and entries[0].get("inline") and flakes[0] != flake_io.resolve(_STACK_DEFAULT_ENTRY):
        return False
    return not any(f.resolution or any(cn.resolution_from_image for cn in f.controlnets) for f in flakes)


def _merge_stacks(prompt, workflow):
    """Fold each run of chained root-level Flake Stacks into its first node, so
    a saved image restores one compact stack (#436). A stack is folded into
    the one feeding it only when it is that stack's sole consumer; subgraph
    definitions are shared by every instance and stay untouched."""
    nodes = workflow.get("nodes") or []
    links = workflow.get("links") or []
    by_id = {str(n["id"]): n for n in nodes}
    removed = set()
    for a in nodes:
        aid = str(a["id"])
        if aid in removed or prompt.get(aid, {}).get("class_type") != "FlakeStack":
            continue
        while True:
            out = [l for l in links if str(l[1]) == aid]
            bid = str(out[0][3]) if len(out) == 1 else None
            if prompt.get(bid, {}).get("class_type") != "FlakeStack":
                break
            a_raw, b_raw = prompt[aid]["inputs"]["flakes_json"], prompt[bid]["inputs"]["flakes_json"]
            b_entries = json.loads(b_raw)
            if not _mergeable_stack(b_entries):
                break
            if b_entries and b_entries[0].get("inline"):
                b_entries = b_entries[1:]
            new_raw = json.dumps(json.loads(a_raw) + b_entries)
            prompt[aid]["inputs"]["flakes_json"] = new_raw
            a["widgets_values"] = [new_raw if v == a_raw else v for v in a.get("widgets_values") or []]
            a.setdefault("properties", {})["_fit_size"] = True

            # A takes over B's outgoing links; the A -> B link goes away with B.
            links.remove(out[0])
            for l in links:
                if str(l[1]) == bid:
                    l[1] = a["id"]
            a["outputs"][0]["links"] = by_id[bid]["outputs"][0]["links"]
            del prompt[bid]
            for node in prompt.values():
                for k, v in node["inputs"].items():
                    if isinstance(v, list) and len(v) == 2 and str(v[0]) == bid:
                        node["inputs"][k] = [aid, v[1]]
            removed.add(bid)
    workflow["nodes"] = [n for n in nodes if str(n["id"]) not in removed]


def _used_only_metadata(prompt, extra_pnginfo):
    """Deep copies of ``prompt`` and ``extra_pnginfo`` describing only what
    produced this run, so a drag-dropped image restores just that (#346, #426):
    Flake Model Combo -> Flake Model Preset with the used preset and overrides,
    Flake Combo -> Flake Stack holding the used entry, stacks minus bypassed
    entries, chained stacks folded into one (#436). queue.js sets every combo node to a single item per queued
    prompt, so the prompt inputs already hold the used ones.
    """
    if not prompt:
        return prompt, extra_pnginfo
    prompt = copy.deepcopy(prompt)
    extra_pnginfo = copy.deepcopy(extra_pnginfo) if extra_pnginfo else extra_pnginfo

    for nid, node in prompt.items():
        cls = node.get("class_type")
        if cls not in ("FlakeStack", "FlakeCombo", "FlakeModelCombo"):
            continue
        inputs = node["inputs"]
        wf = _wf_node(extra_pnginfo, nid)
        if cls != "FlakeStack":
            node["class_type"] = "FlakeStack" if cls == "FlakeCombo" else "FlakeModelPreset"
        if wf:
            wf["type"] = node["class_type"]
            props = {k: v for k, v in (wf.get("properties") or {}).items() if not k.startswith("_combo_")}
            if props.get("Node name for S&R") == cls:
                props["Node name for S&R"] = node["class_type"]
            if cls != "FlakeStack":
                # Fit the converted node to its content on load (web/flake_stack.js).
                props["_fit_size"] = True
            if cls == "FlakeModelCombo":
                # The Preset widget re-serialises overrides_json from _overrides.
                props["_overrides"] = json.loads(inputs.get("overrides_json") or "{}")
            wf["properties"] = props
        if cls == "FlakeModelCombo":
            continue
        raw = inputs["flakes_json"]
        entries = [_used_entry(e) for e in json.loads(raw) if not e.get("bypassed")]
        if cls == "FlakeCombo":
            entries.insert(0, dict(_STACK_DEFAULT_ENTRY))
        new_raw = json.dumps(entries)
        inputs["flakes_json"] = new_raw
        # Mirror into the workflow node's positional widgets_values by matching
        # the original flakes_json string (robust to widget ordering).
        if wf:
            wf["widgets_values"] = [new_raw if v == raw else v for v in wf.get("widgets_values") or []]

    workflow = extra_pnginfo.get("workflow") if isinstance(extra_pnginfo, dict) else None
    if isinstance(workflow, dict):
        _merge_stacks(prompt, workflow)
    return prompt, extra_pnginfo


def _set_generate_image(extra_pnginfo, node_id, seed, image):
    """Point the workflow's Flake Generate node at one saved image: its seed,
    control fixed, and an overlay showing only that image (#426)."""
    wf = _wf_node(extra_pnginfo, node_id)
    if wf is None:
        return
    wf["widgets_values"][:2] = [seed, "fixed"]
    props = wf.setdefault("properties", {})
    props.pop("_last_image_ad", None)
    props.update(_images_by_combo={"": image}, _images_by_combo_ad={}, _adetailer_ab=False, _last_image=image)


def _flake_bundle(prompt, node_id):
    """The portable bundle (#427) of the flakes and presets feeding prompt node
    ``node_id``, read from a ``_used_only_metadata`` prompt. Flakes keep only
    the variant choices this run applied."""
    flakes, presets, used = [], [], {}
    seen, todo = set(), [str(node_id)]
    while todo:
        nid = todo.pop()
        if nid in seen or nid not in prompt:
            continue
        seen.add(nid)
        inputs = prompt[nid]["inputs"]
        todo += [str(v[0]) for v in inputs.values() if isinstance(v, list)]
        cls = prompt[nid].get("class_type")
        if cls == "FlakeStack":
            entries = json.loads(inputs["flakes_json"])
            flakes += [e["name"] for e in entries if not e.get("inline") and e.get("name")]
            for e in entries:
                try:
                    flake_io.merge_used_variants(used, flake_io.resolve(e).used_variants)
                except FileNotFoundError:
                    pass
        elif cls == "FlakeModelPreset" and isinstance(inputs.get("preset"), str):
            presets.append(inputs["preset"])
            try:
                # Preset links resolve like full_flake_node's __preset__ flake.
                preset_flake = flake_io.Flake(name="__preset__", flake_links=flake_io.load_preset(inputs["preset"]).flake_links)
            except FileNotFoundError:
                continue
            flake_io._apply_flake_link(preset_flake, {})
            flake_io.merge_used_variants(used, preset_flake.used_variants)
    return flake_io.collect_bundle(flakes, presets, used)


class FlakeGenerate:
    """Takes a FLAKE_DATA input and runs KSampler + VAE Decode + Save Image
    internally. Displays a seed widget, a 2x2 preview grid, and the generated
    image. Has no output pins."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "flake_data": ("FLAKE_DATA",),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff, "control_after_generate": True}),
            },
            "optional": {
                # ADetailer post-process (#287, SDXL-first). Off / Face / A/B; A/B
                # generates each image twice — once without, once with ADetailer (#327).
                "adetailer": (["Off", "Face", "A/B"], {"default": "Off"}),
                "adetailer_denoise": ("FLOAT", {"default": 0.4, "min": 0.0, "max": 1.0, "step": 0.05}),
                # ADetailer sampling steps (#301). 0 = reuse the first-pass steps.
                "adetailer_steps": ("INT", {"default": 0, "min": 0, "max": 150, "step": 1, "tooltip": "ADetailer (Face Detailer) sampling steps. 0 = use the same steps as the first pass."}),
                # bbox model dropdown from ultralytics_bbox / models/adetailer (#306).
                "adetailer_bbox": (_list_adetailer_bbox(), {"default": _ADETAILER_DEFAULT_BBOX}),
                # Upscale post-process (#288). upscale_model is a filename under
                # models/upscale_models/ (blank = plain rescale to factor).
                "upscale": ("BOOLEAN", {"default": False, "label_on": "Upscale", "label_off": "Upscale off"}),
                "upscale_model": (_list_upscale_models(), {"default": ""}),
                "upscale_factor": ("FLOAT", {"default": 1.5, "min": 1.0, "max": 8.0, "step": 0.1}),
                "attention": (_attention_options(), {
                    "default": "default", "tooltip": "Attention backend for the model, ADetailer included; default is the one ComfyUI was launched with."}),
            },
            # Embed the workflow/prompt into saved PNGs so outputs can be
            # drag-dropped back into ComfyUI to restore the graph (#344).
            "hidden": {
                "prompt": "PROMPT",
                "extra_pnginfo": "EXTRA_PNGINFO",
                "unique_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = ()
    FUNCTION = "execute"
    CATEGORY = "flakes"
    DESCRIPTION = "Generate an image from FLAKE_DATA using KSampler, VAE Decode, and Save Image. Displays the result inline."
    OUTPUT_NODE = True

    def execute(self, flake_data, seed, adetailer="Off", adetailer_denoise=0.4,
                adetailer_steps=0, adetailer_bbox="bbox/face_yolov8m.pt",
                upscale=False, upscale_model="", upscale_factor=1.5, attention="default",
                prompt=None, extra_pnginfo=None, unique_id=None):
        parts = _split_flake_data(flake_data)
        model = _apply_attention(parts["model"], attention)
        clip = parts["clip"]
        vae = parts["vae"]
        positive = parts["positive"]
        negative = parts["negative"]
        latent = parts["latent"]
        filename_prefix = parts["filename_prefix"] or "ComfyUI"
        steps = parts["steps"]
        cfg = parts["cfg"]
        sampler_name = parts["sampler_name"]
        scheduler = parts["scheduler"]
        denoise = parts["denoise"]

        # Distilled models sample at cfg 1 with a zeroed negative (#359). Done
        # here rather than at preset-load time because this is the one place the
        # conditioning and the cfg are both final: upstream Flake nodes re-encode
        # the accumulated prompt on every hop, and cfg can still be changed by a
        # per-instance override (#279). ControlNets have already been applied by
        # this point, so the `control` key is carried through the zero-out.
        negative = flake_compose.maybe_zero_out_negative(negative, cfg)

        # Proves whether model-patch ControlNets (Anima LLLite: post_input,
        # attn1/attn2_patch, mlp_patch) reached the sampler (#382).
        patches = model.model_options["transformer_options"].get("patches", {})
        logging.info("[FlakeGenerate] model patches: %s",
                     ", ".join(f"{k}={len(v)}" for k, v in patches.items()) or "none")

        ks = KSampler()
        sampled = ks.sample(
            model, seed, steps, cfg, sampler_name, scheduler,
            positive, negative, latent, denoise=denoise,
        )
        sampled_latent = sampled[0]

        vae_dec = VAEDecode()
        images = vae_dec.decode(vae, sampled_latent)[0]

        base_images = images

        def _detail(imgs):
            from .flake_postprocess import run_face_detailer
            # 0 means "match the first pass"; otherwise use the explicit count (#301).
            ad_steps = adetailer_steps if adetailer_steps and adetailer_steps > 0 else steps
            return run_face_detailer(
                imgs, model, clip, vae, positive, negative,
                seed, ad_steps, cfg, sampler_name, scheduler,
                denoise=adetailer_denoise, bbox_model=adetailer_bbox,
            )

        # Build the output variant(s): Off/Face produce one image set; A/B produces
        # two — once without ADetailer, once with (#327). The ADetailer variant is
        # tagged so its stem gets the _ad_ marker (#326).
        if adetailer == "A/B":
            variants = [(base_images, False), (_detail(base_images), True)]
        elif adetailer == "Face":
            variants = [(_detail(base_images), True)]
        else:
            variants = [(base_images, False)]

        saver = SaveImage()
        output_dir = folder_paths.get_output_directory()

        # Embed only what produced this image in the saved metadata (#346, #426).
        meta_prompt, meta_extra = _used_only_metadata(prompt, extra_pnginfo)
        # Inside the workflow: the frontend only hands that to extensions on drop.
        if meta_prompt and isinstance((meta_extra or {}).get("workflow"), dict):
            meta_extra["workflow"].setdefault("extra", {})["flake_bundle"] = _flake_bundle(meta_prompt, unique_id)

        def _save(imgs, is_ad):
            # Stem markers before the increment: _ad_ for ADetailer (#326), _up_ for
            # Upscale (#325). Upscale (#288) applies to every variant when on.
            out_imgs, marker = imgs, ""
            if is_ad:
                marker += "_ad"
            if upscale:
                from .flake_postprocess import upscale_images
                out_imgs = upscale_images(imgs, upscale_model, upscale_factor)
                marker += "_up"
            # The name SaveImage will give the first image, after the rename below.
            _, name, counter, subfolder, _ = folder_paths.get_save_image_path(
                filename_prefix + marker, output_dir, out_imgs[0].shape[1], out_imgs[0].shape[0])
            _set_generate_image(meta_extra, unique_id, seed, {
                "filename": f"{name.replace('%batch_num%', '0')}_{counter:05}.png",
                "subfolder": subfolder, "type": "output"})
            res = saver.save_images(out_imgs, filename_prefix=filename_prefix + marker,
                                    prompt=meta_prompt, extra_pnginfo=meta_extra)
            ui_imgs = res.get("ui", {}).get("images", [])
            # Strip the trailing underscore ComfyUI's SaveImage hardcodes
            # (e.g. "..._00001_.png" -> "..._00001.png").
            for img_info in ui_imgs:
                old_name = img_info["filename"]
                if old_name.endswith("_.png"):
                    new_name = old_name[:-5] + ".png"
                    old_path = os.path.join(output_dir, img_info.get("subfolder", ""), old_name)
                    new_path = os.path.join(output_dir, img_info.get("subfolder", ""), new_name)
                    try:
                        if os.path.exists(old_path):
                            os.rename(old_path, new_path)
                            img_info["filename"] = new_name
                    except OSError:
                        pass
            return ui_imgs

        regular_ui, ad_ui = [], []
        for imgs, is_ad in variants:
            saved = _save(imgs, is_ad)
            if is_ad:
                ad_ui = saved
            else:
                regular_ui = saved

        model_bundle, generation_data, sampling_preset = flake_data
        meta = {}
        if generation_data is not None and len(generation_data) > 7 and isinstance(generation_data[7], dict):
            meta = generation_data[7]

        # ── Models overlay: checkpoint, vae, text encoder, loras, resolution, sampling ──
        models_info = {}

        if model_bundle is not None:
            m, c, v = model_bundle
            ckpt_name = meta.get("checkpoint", "")
            if ckpt_name:
                models_info["Checkpoint"] = ckpt_name
            elif m is not None:
                ckpt_attr = getattr(m, "sd_checkpoint_name", None)
                models_info["Checkpoint"] = ckpt_attr if ckpt_attr else "(loaded)"

            vae_name = meta.get("vae")
            if vae_name is not None:
                models_info["VAE"] = vae_name if vae_name != "baked-in" else "baked-in"
            else:
                models_info["VAE"] = "(loaded)" if v is not None else "none"

            te_name = meta.get("text_encoder")
            if te_name is not None and te_name != "baked-in":
                models_info["Text Encoder"] = te_name

            loras = meta.get("loras", [])
            for i, lr in enumerate(loras):
                lr_display = lr.get("name", "") or lr.get("path", "") or f"LoRA #{i + 1}"
                lr_strength = lr.get("strength", 1.0)
                models_info[f"LoRA: {lr_display}"] = f"strength: {lr_strength}"

        gen_width = generation_data[3] if generation_data and len(generation_data) > 3 else None
        gen_height = generation_data[4] if generation_data and len(generation_data) > 4 else None
        if gen_width is not None:
            models_info["Width"] = str(gen_width)
        if gen_height is not None:
            models_info["Height"] = str(gen_height)

        if sampling_preset is not None:
            models_info["Steps"] = str(steps)
            models_info["CFG"] = str(cfg)
            models_info["Sampler"] = str(sampler_name)
            models_info["Scheduler"] = str(scheduler)
            models_info["Denoise"] = str(denoise)

        # ── Inputs overlay: prompts (grouped by BREAK) + controlnet info ──
        inputs_info = {}
        if generation_data is not None:
            pos_text = generation_data[5] if len(generation_data) > 5 else ""
            neg_text = generation_data[6] if len(generation_data) > 6 else ""
            pos_segments = [s.strip() for s in pos_text.split(" BREAK ") if s.strip()] if pos_text else []
            neg_segments = [s.strip() for s in neg_text.split(", ") if s.strip()] if neg_text else []
            if pos_segments:
                for i, seg in enumerate(pos_segments):
                    label = f"Positive {i + 1}" if len(pos_segments) > 1 else "Positive"
                    inputs_info[label] = seg
            if neg_segments:
                inputs_info["Negative"] = ", ".join(neg_segments)

        preview_data = {
            "Models": models_info,
            "Inputs": inputs_info,
        }

        # Custom keys ("flake_images") so ComfyUI's default renderer doesn't show a
        # duplicate; the JS widget reads them. For A/B, flake_images is the regular
        # (non-ADetailer) output and flake_images_ad is the detailed one, with a flag
        # so the Generation Data overlay shows the ADetailer toggle (#327, #328).
        ui_data = {}
        ui_data["flake_images"] = regular_ui if regular_ui else ad_ui
        if adetailer == "A/B":
            ui_data["flake_images_ad"] = ad_ui
            ui_data["adetailer_ab"] = [True]
        ui_data["preview_data"] = [preview_data]
        ui_data["seed"] = [seed]

        return {"ui": ui_data}