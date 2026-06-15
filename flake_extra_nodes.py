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


class FlakeInpaint:
    """Inpaint a masked region of an image using a FLAKE_DATA bundle's model,
    conditioning, and sampler settings (#291).

    Takes an input image + mask (wire a Load Image / mask source) and the
    generation parameters from FLAKE_DATA. Optional prompt overrides re-encode
    using the bundle's CLIP. Outputs the inpainted IMAGE.

    NOTE: the draft's on-node image preview with Mask/Inputs/Remove hover
    buttons (canvas mask editor) is a frontend follow-up; this node provides the
    working inpaint backend via input pins in the meantime.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "flake_data": ("FLAKE_DATA",),
                "image": ("IMAGE",),
                "mask": ("MASK",),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff, "control_after_generate": True}),
            },
            "optional": {
                "denoise": ("FLOAT", {"default": 0.7, "min": 0.0, "max": 1.0, "step": 0.05}),
                "grow_mask": ("INT", {"default": 6, "min": 0, "max": 256}),
                "positive_prompt": ("STRING", {"default": "", "multiline": True}),
                "negative_prompt": ("STRING", {"default": "", "multiline": True}),
            },
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    FUNCTION = "execute"
    CATEGORY = "flakes"
    DESCRIPTION = (
        "Inpaint a masked region using the model, conditioning, and sampler "
        "settings from a FLAKE_DATA bundle. Optional prompt overrides."
    )

    def execute(self, flake_data, image, mask, seed, denoise=0.7, grow_mask=6,
                positive_prompt="", negative_prompt=""):
        from nodes import VAEEncodeForInpaint, KSampler, VAEDecode, CLIPTextEncode

        model_bundle, generation_data, sampling_preset = flake_data
        model, clip, vae = model_bundle
        positive, negative = generation_data[0], generation_data[1]
        steps, cfg, sampler_name, scheduler = sampling_preset

        # Optional prompt overrides — re-encode with the bundle's CLIP.
        if positive_prompt.strip() or negative_prompt.strip():
            encoder = CLIPTextEncode()
            if positive_prompt.strip():
                positive = encoder.encode(clip, positive_prompt)[0]
            if negative_prompt.strip():
                negative = encoder.encode(clip, negative_prompt)[0]

        latent = VAEEncodeForInpaint().encode(vae, image, mask, grow_mask_by=grow_mask)[0]
        sampled = KSampler().sample(
            model, seed, steps, cfg, sampler_name, scheduler,
            positive, negative, latent, denoise=denoise,
        )[0]
        out_image = VAEDecode().decode(vae, sampled)[0]
        return (out_image,)
