from __future__ import annotations

try:
    from comfy.samplers import KSampler as _KSampler
    _SAMPLER_TYPES = (_KSampler.SAMPLERS, _KSampler.SCHEDULERS)
except Exception:
    _SAMPLER_TYPES = ("STRING", "STRING")


class FlakeDataSplitAll:
    """Splits a FLAKE_DATA bundle into model_bundle, generation_data, and sampling_preset."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "flake_data": ("FLAKE_DATA",),
            },
        }

    RETURN_TYPES = ("FLAKES_MODEL", "FLAKES_COND", "FLAKES_SAMPLER")
    RETURN_NAMES = ("model_bundle", "generation_data", "sampling_preset")
    FUNCTION = "execute"
    CATEGORY = "flakes"
    DESCRIPTION = "Split a Flake Data bundle into model, generation, and sampler bundles."

    def execute(self, flake_data):
        model_bundle, generation_data, sampling_preset = flake_data
        return (model_bundle, generation_data, sampling_preset)


class FlakeDataSplitSelect:
    """Splits a FLAKE_DATA bundle into selectable output pins.

    Always outputs model; optional generation_data and sampling_preset pins are
    enabled via boolean widgets.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "flake_data": ("FLAKE_DATA",),
                "output_generation": ([("yes", "yes"), ("no", "no")], {"default": "yes"}),
                "output_sampling": ([("yes", "yes"), ("no", "no")], {"default": "yes"}),
            },
        }

    RETURN_TYPES = ("FLAKES_MODEL", "FLAKES_COND", "FLAKES_SAMPLER")
    RETURN_NAMES = ("model_bundle", "generation_data", "sampling_preset")
    FUNCTION = "execute"
    CATEGORY = "flakes"
    DESCRIPTION = "Selectively split a Flake Data bundle into the bundles you need."
    OUTPUT_NODE = True

    def execute(self, flake_data, output_generation="yes", output_sampling="yes"):
        model_bundle, generation_data, sampling_preset = flake_data
        return (
            model_bundle,
            generation_data if output_generation == "yes" else None,
            sampling_preset if output_sampling == "yes" else None,
        )


class IntoFlakeDataAll:
    """Combines model_bundle, generation_data, and sampling_preset into a single FLAKE_DATA pin."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model_bundle": ("FLAKES_MODEL",),
                "generation_data": ("FLAKES_COND",),
                "sampling_preset": ("FLAKES_SAMPLER",),
            },
        }

    RETURN_TYPES = ("FLAKE_DATA",)
    RETURN_NAMES = ("flake_data",)
    FUNCTION = "execute"
    CATEGORY = "flakes"
    DESCRIPTION = "Combine model, generation, and sampler bundles into a single Flake Data pin."

    def execute(self, model_bundle, generation_data, sampling_preset):
        return ((model_bundle, generation_data, sampling_preset),)


class IntoFlakeDataSelect:
    """Combines available bundles into a FLAKE_DATA pin. Missing bundles are left
    as None in the tuple so downstream nodes can handle partial data."""

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
    DESCRIPTION = "Optionally combine model, generation, and/or sampler bundles into a Flake Data pin. Only connect the bundles you want to include."

    def execute(self, model_bundle=None, generation_data=None, sampling_preset=None):
        return ((model_bundle, generation_data, sampling_preset),)