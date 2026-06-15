"""Extra Flake nodes that wrap optional, soft-dependency features:
IPAdapter FaceID (#289) and Inpaint (#291).

These operate on the FLAKE_DATA bundle (model_bundle, generation_data,
sampling_preset) produced by FlakeModelPreset / FlakeStack.
"""
from __future__ import annotations


class FlakeIPAdapter:
    """Apply IPAdapter FaceID to the model inside a FLAKE_DATA bundle for
    consistent-face generation, then pass the bundle through (#289).

    Soft-depends on ComfyUI_IPAdapter_plus (+ FaceID models + insightface).
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "flake_data": ("FLAKE_DATA",),
                "image": ("IMAGE",),
            },
            "optional": {
                "weight": ("FLOAT", {"default": 0.8, "min": -1.0, "max": 3.0, "step": 0.05}),
                "preset": ("STRING", {"default": "FACEID PLUS V2"}),
            },
        }

    RETURN_TYPES = ("FLAKE_DATA",)
    RETURN_NAMES = ("flake_data",)
    FUNCTION = "execute"
    CATEGORY = "flakes"
    DESCRIPTION = (
        "Apply IPAdapter FaceID to the model in a FLAKE_DATA bundle for consistent "
        "faces, passing the bundle through. Requires ComfyUI_IPAdapter_plus."
    )

    def execute(self, flake_data, image, weight=0.8, preset="FACEID PLUS V2"):
        from .flake_postprocess import apply_ipadapter_faceid

        model_bundle, generation_data, sampling_preset = flake_data
        model, clip, vae = model_bundle
        new_model = apply_ipadapter_faceid(model, image, weight=weight, preset=preset)
        return (((new_model, clip, vae), generation_data, sampling_preset),)
