from __future__ import annotations

try:
    from comfy.samplers import KSampler as _KSampler
    _SAMPLER_TYPES = (_KSampler.SAMPLERS, _KSampler.SCHEDULERS)
except Exception:
    _SAMPLER_TYPES = ("STRING", "STRING")


class FlakesModel:
    """Unpacks a FLAKES_MODEL bundle into model / clip / vae."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model_bundle": ("FLAKES_MODEL",),
            },
        }

    RETURN_TYPES = ("MODEL", "CLIP", "VAE")
    RETURN_NAMES = ("model", "clip", "vae")
    FUNCTION = "execute"
    CATEGORY = "flakes"
    DESCRIPTION = "Unpack a Full Flakes model bundle into individual outputs."

    def execute(self, model_bundle):
        model, clip, vae = model_bundle
        return (model, clip, vae)


class FlakesCond:
    """Unpacks a FLAKES_COND (generation_data) bundle into positive / negative / latent / resolution."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "generation_data": ("FLAKES_COND",),
            },
        }

    RETURN_TYPES = ("CONDITIONING", "CONDITIONING", "LATENT", "INT", "INT")
    RETURN_NAMES = ("positive", "negative", "latent", "width", "height")
    FUNCTION = "execute"
    CATEGORY = "flakes"
    DESCRIPTION = "Unpack a Full Flakes conditioning bundle into individual outputs."

    def execute(self, generation_data):
        # generation_data may contain extra prompt-text fields after the 5th element.
        positive, negative, latent, width, height = generation_data[:5]
        return (positive, negative, latent, width, height)


class FlakesSampler:
    """Unpacks a FLAKES_SAMPLER bundle into steps / cfg / sampler_name / scheduler."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "sampling_preset": ("FLAKES_SAMPLER",),
            },
        }

    RETURN_TYPES = ("INT", "FLOAT", _SAMPLER_TYPES[0], _SAMPLER_TYPES[1])
    RETURN_NAMES = ("steps", "cfg", "sampler_name", "scheduler")
    FUNCTION = "execute"
    CATEGORY = "flakes"
    DESCRIPTION = "Unpack a Full Flakes sampler bundle into individual outputs."

    def execute(self, sampling_preset):
        steps, cfg, sampler_name, scheduler = sampling_preset
        return (steps, cfg, sampler_name, scheduler)
