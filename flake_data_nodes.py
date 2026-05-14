from __future__ import annotations

import json

try:
    from comfy.samplers import KSampler as _KSampler
    _SAMPLER_TYPES = (_KSampler.SAMPLERS, _KSampler.SCHEDULERS)
except Exception:
    _SAMPLER_TYPES = ("STRING", "STRING")

from .full_flake_node import _build_filename_prefix

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
    ("sampler_name", _SAMPLER_TYPES[0]),
    ("scheduler", _SAMPLER_TYPES[1]),
]


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
    Use the dropdown and +/- buttons on the node to add or remove output pins."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "flake_data": ("FLAKE_DATA",),
                "selected_pins": ("STRING", {"multiline": False, "default": '["model"]'}),
            },
        }

    RETURN_TYPES = tuple(t for _, t in _ALL_PINS)
    RETURN_NAMES = tuple(n for n, _ in _ALL_PINS)
    FUNCTION = "execute"
    CATEGORY = "flakes"
    DESCRIPTION = "Split FLAKE_DATA into individually selectable output pins. Use the dropdown and +/- buttons to add or remove pins."

    def execute(self, flake_data, selected_pins='["model"]'):
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
    Use the dropdown and +/- buttons to add or remove input pins.
    Only activated pins override the incoming data; all others pass through unchanged."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "flake_data": ("FLAKE_DATA",),
                "active_pins": ("STRING", {"multiline": False, "default": '["model"]'}),
            },
            "optional": {
                "model": ("MODEL",),
                "clip": ("CLIP",),
                "vae": ("VAE",),
                "positive": ("CONDITIONING",),
                "negative": ("CONDITIONING",),
                "latent": ("LATENT",),
                "filename_prefix": ("STRING", {"default": ""}),
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
    DESCRIPTION = "Override individual fields of an incoming FLAKE_DATA. Use the dropdown and +/- buttons to add/remove input pins. Only activated pins override the original data."

    def execute(self, flake_data, active_pins='["model"]', model=None, clip=None, vae=None,
                positive=None, negative=None, latent=None,
                filename_prefix="", width=1024, height=1024,
                steps=20, cfg=7.0, sampler_name="euler", scheduler="normal"):
        try:
            active = set(json.loads(active_pins)) if active_pins else set()
        except (json.JSONDecodeError, TypeError):
            active = set()

        orig_model_bundle, orig_generation_data, orig_sampling_preset = flake_data
        orig_model, orig_clip, orig_vae = orig_model_bundle
        orig_positive, orig_negative, orig_latent, orig_width, orig_height = orig_generation_data[:5]
        orig_pos_text, orig_neg_text = orig_generation_data[5:7]
        orig_filename_state = {}
        if len(orig_generation_data) > 7 and isinstance(orig_generation_data[7], dict):
            orig_filename_state = orig_generation_data[7]
        orig_steps, orig_cfg, orig_sampler, orig_scheduler = orig_sampling_preset

        new_model = model if ("model" in active and model is not None) else orig_model
        new_clip = clip if ("clip" in active and clip is not None) else orig_clip
        new_vae = vae if ("vae" in active and vae is not None) else orig_vae
        new_positive = positive if ("positive" in active and positive is not None) else orig_positive
        new_negative = negative if ("negative" in active and negative is not None) else orig_negative
        new_latent = latent if ("latent" in active and latent is not None) else orig_latent
        new_width = width if "width" in active else orig_width
        new_height = height if "height" in active else orig_height
        new_steps = steps if "steps" in active else orig_steps
        new_cfg = cfg if "cfg" in active else orig_cfg
        new_sampler = sampler_name if "sampler_name" in active else orig_sampler
        new_scheduler = scheduler if "scheduler" in active else orig_scheduler

        new_filename_state = dict(orig_filename_state)
        if "filename_prefix" in active and filename_prefix:
            new_filename_state["preset"] = filename_prefix

        new_model_bundle = (new_model, new_clip, new_vae)
        new_generation_data = (
            new_positive, new_negative, new_latent,
            new_width, new_height, orig_pos_text, orig_neg_text,
            new_filename_state,
        )
        new_sampling_preset = (new_steps, new_cfg, new_sampler, new_scheduler)

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
            "ui": {"preview_data": preview_data},
            "result": (flake_data,),
        }