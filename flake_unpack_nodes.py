from __future__ import annotations


class FlakesModel:
    """Unpacks a FLAKES_MODEL bundle into model / clip / vae."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "bundle": ("FLAKES_MODEL",),
            },
        }

    RETURN_TYPES = ("MODEL", "CLIP", "VAE")
    RETURN_NAMES = ("model", "clip", "vae")
    FUNCTION = "execute"
    CATEGORY = "flakes"
    DESCRIPTION = "Unpack a Full Flakes model bundle into individual outputs."

    def execute(self, bundle):
        model, clip, vae = bundle
        return (model, clip, vae)


class FlakesCond:
    """Unpacks a FLAKES_COND bundle into positive / negative / latent / resolution."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "bundle": ("FLAKES_COND",),
            },
        }

    RETURN_TYPES = ("CONDITIONING", "CONDITIONING", "LATENT", "INT", "INT")
    RETURN_NAMES = ("positive", "negative", "latent", "width", "height")
    FUNCTION = "execute"
    CATEGORY = "flakes"
    DESCRIPTION = "Unpack a Full Flakes conditioning bundle into individual outputs."

    def execute(self, bundle):
        positive, negative, latent, width, height = bundle
        return (positive, negative, latent, width, height)


class FlakesSampler:
    """Unpacks a FLAKES_SAMPLER bundle into steps / cfg / sampler_name / scheduler."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "bundle": ("FLAKES_SAMPLER",),
            },
        }

    RETURN_TYPES = ("INT", "FLOAT", "STRING", "STRING")
    RETURN_NAMES = ("steps", "cfg", "sampler_name", "scheduler")
    FUNCTION = "execute"
    CATEGORY = "flakes"
    DESCRIPTION = "Unpack a Full Flakes sampler bundle into individual outputs."

    def execute(self, bundle):
        steps, cfg, sampler_name, scheduler = bundle
        return (steps, cfg, sampler_name, scheduler)
