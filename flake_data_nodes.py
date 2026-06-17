from __future__ import annotations

import json
import os

try:
    from comfy.samplers import KSampler as _KSampler
    _SAMPLER_TYPES = (_KSampler.SAMPLERS, _KSampler.SCHEDULERS)
except Exception:
    _SAMPLER_TYPES = ("STRING", "STRING")

import folder_paths
from nodes import KSampler, VAEDecode, SaveImage

from .full_flake_node import _build_filename_prefix

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
    steps, cfg, sampler_name, scheduler = sampling_preset
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

        sampling_preset = (steps, cfg, sampler_name, scheduler)

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
        orig_steps, orig_cfg, orig_sampler, orig_scheduler = orig_sampling_preset

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
            steps, cfg, sampler_name, scheduler = sampling_preset
            params_info["Steps"] = str(steps)
            params_info["CFG"] = str(cfg)
            params_info["Sampler"] = str(sampler_name)
            params_info["Scheduler"] = str(scheduler)

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
                # ADetailer / Face Detailer post-process (#287, SDXL-first).
                "adetailer": ("BOOLEAN", {"default": False, "label_on": "Face Detailer", "label_off": "ADetailer off"}),
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
            },
        }

    RETURN_TYPES = ()
    FUNCTION = "execute"
    CATEGORY = "flakes"
    DESCRIPTION = "Generate an image from FLAKE_DATA using KSampler, VAE Decode, and Save Image. Displays the result inline."
    OUTPUT_NODE = True

    def execute(self, flake_data, seed, adetailer=False, adetailer_denoise=0.4,
                adetailer_steps=0, adetailer_bbox="bbox/face_yolov8m.pt",
                upscale=False, upscale_model="", upscale_factor=1.5):
        parts = _split_flake_data(flake_data)
        model = parts["model"]
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

        ks = KSampler()
        sampled = ks.sample(
            model, seed, steps, cfg, sampler_name, scheduler,
            positive, negative, latent, denoise=1.0,
        )
        sampled_latent = sampled[0]

        vae_dec = VAEDecode()
        images = vae_dec.decode(vae, sampled_latent)[0]

        # Optional ADetailer (Face Detailer) post-process (#287).
        if adetailer:
            from .flake_postprocess import run_face_detailer
            # 0 means "match the first pass"; otherwise use the explicit count (#301).
            ad_steps = adetailer_steps if adetailer_steps and adetailer_steps > 0 else steps
            images = run_face_detailer(
                images, model, clip, vae, positive, negative,
                seed, ad_steps, cfg, sampler_name, scheduler,
                denoise=adetailer_denoise, bbox_model=adetailer_bbox,
            )

        # Optional upscale post-process (#288), after detailing.
        if upscale:
            from .flake_postprocess import upscale_images
            images = upscale_images(images, upscale_model, upscale_factor)

        saver = SaveImage()
        save_result = saver.save_images(images, filename_prefix=filename_prefix)

        # Remove the trailing underscore before the file extension that ComfyUI's
        # SaveImage hardcodes (e.g. "..._00001_.png" -> "..._00001.png").
        output_dir = folder_paths.get_output_directory()
        if "ui" in save_result and "images" in save_result["ui"]:
            for img_info in save_result["ui"]["images"]:
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

        ui_data = dict(save_result.get("ui", {}))
        # Rename "images" to "flake_images" so ComfyUI's default image renderer
        # doesn't display a duplicate; the custom JS widget reads "flake_images".
        if "images" in ui_data:
            ui_data["flake_images"] = ui_data.pop("images")
        ui_data["preview_data"] = [preview_data]
        ui_data["seed"] = [seed]

        return {"ui": ui_data}