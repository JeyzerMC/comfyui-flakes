from __future__ import annotations

try:
    from comfy.samplers import KSampler as _KSampler
    _SAMPLER_TYPES = (_KSampler.SAMPLERS, _KSampler.SCHEDULERS)
except Exception:
    _SAMPLER_TYPES = ("STRING", "STRING")

from .full_flake_node import _build_filename_prefix


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

    RETURN_TYPES = (
        "MODEL", "CLIP", "VAE",
        "CONDITIONING", "CONDITIONING", "LATENT", "STRING", "INT", "INT",
        "INT", "FLOAT", _SAMPLER_TYPES[0], _SAMPLER_TYPES[1],
    )
    RETURN_NAMES = (
        "model", "clip", "vae",
        "positive", "negative", "latent", "filename_prefix", "width", "height",
        "steps", "cfg", "sampler_name", "scheduler",
    )
    FUNCTION = "execute"
    CATEGORY = "flakes"
    DESCRIPTION = "Split FLAKE_DATA into all individual model, generation, and sampler outputs."

    def execute(self, flake_data):
        model_bundle, generation_data, sampling_preset = flake_data
        model, clip, vae = model_bundle
        positive, negative, latent, width, height, pos_text, neg_text = generation_data[:7]
        if len(generation_data) > 7 and isinstance(generation_data[7], dict):
            filename_prefix = _build_filename_prefix(
                generation_data[7].get("preset", ""),
                generation_data[7].get("stems", []),
            )
        else:
            filename_prefix = ""
        steps, cfg, sampler_name, scheduler = sampling_preset
        return (
            model, clip, vae,
            positive, negative, latent, filename_prefix, width, height,
            steps, cfg, sampler_name, scheduler,
        )


class FlakeDataSplitSelect:
    """Splits FLAKE_DATA into three group outputs that can be toggled on/off."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "flake_data": ("FLAKE_DATA",),
                "output_model": ([("yes", "yes"), ("no", "no")], {"default": "yes"}),
                "output_generation": ([("yes", "yes"), ("no", "no")], {"default": "yes"}),
                "output_sampling": ([("yes", "yes"), ("no", "no")], {"default": "yes"}),
            },
        }

    RETURN_TYPES = (
        "MODEL", "CLIP", "VAE",
        "CONDITIONING", "CONDITIONING", "LATENT", "STRING", "INT", "INT",
        "INT", "FLOAT", _SAMPLER_TYPES[0], _SAMPLER_TYPES[1],
    )
    RETURN_NAMES = (
        "model", "clip", "vae",
        "positive", "negative", "latent", "filename_prefix", "width", "height",
        "steps", "cfg", "sampler_name", "scheduler",
    )
    FUNCTION = "execute"
    CATEGORY = "flakes"
    DESCRIPTION = "Selectively split FLAKE_DATA — toggle model, generation, or sampler groups on/off."
    OUTPUT_NODE = True

    def execute(self, flake_data, output_model="yes", output_generation="yes", output_sampling="yes"):
        model_bundle, generation_data, sampling_preset = flake_data
        model, clip, vae = model_bundle
        positive, negative, latent, width, height, pos_text, neg_text = generation_data[:7]
        if len(generation_data) > 7 and isinstance(generation_data[7], dict):
            filename_prefix = _build_filename_prefix(
                generation_data[7].get("preset", ""),
                generation_data[7].get("stems", []),
            )
        else:
            filename_prefix = ""
        steps, cfg, sampler_name, scheduler = sampling_preset
        return (
            model if output_model == "yes" else None,
            clip if output_model == "yes" else None,
            vae if output_model == "yes" else None,
            positive if output_generation == "yes" else None,
            negative if output_generation == "yes" else None,
            latent if output_generation == "yes" else None,
            filename_prefix if output_generation == "yes" else None,
            width if output_generation == "yes" else None,
            height if output_generation == "yes" else None,
            steps if output_sampling == "yes" else None,
            cfg if output_sampling == "yes" else None,
            sampler_name if output_sampling == "yes" else None,
            scheduler if output_sampling == "yes" else None,
        )


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
    """Selectively combine available bundles into FLAKE_DATA.
    Missing bundles are kept as None in the tuple so downstream nodes can handle partial data."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": {
                "model_bundle": ("FLAKES_MODEL",),
                "generation_data": ("FLAKES_COND",),
                "sampling_preset": ("FLAKES_SAMPLER",),
            },
        }

    RETURN_TYPES = ("FLAKE_DATA",)
    RETURN_NAMES = ("flake_data",)
    FUNCTION = "execute"
    CATEGORY = "flakes"
    DESCRIPTION = "Optionally combine model, generation, and/or sampler bundles into a FLAKE_DATA pin. Only connect the bundles you want to include."

    def execute(self, model_bundle=None, generation_data=None, sampling_preset=None):
        return ((model_bundle, generation_data, sampling_preset),)