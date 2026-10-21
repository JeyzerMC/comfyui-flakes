"""Extra Flake nodes that wrap optional, soft-dependency features:
IPAdapter FaceID (#289) and Inpaint (#291, #428).

These operate on the FLAKE_DATA bundle (model_bundle, generation_data,
sampling_preset) produced by FlakeModelPreset / FlakeStack.
"""
from __future__ import annotations

from nodes import CLIPTextEncode, LoadImage, SetLatentNoiseMask, VAEEncode, VAEEncodeForInpaint

from .flake_compose import carry_schedules
from .full_flake_node import _carry_controlnets


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


def _reencode(clip, cond, text):
    """Encode ``text`` and carry the hooks, scheduled prompts and ControlNets
    of ``cond`` onto it, like FlakeStack does."""
    new_cond = CLIPTextEncode().encode(clip, text)[0]
    return _carry_controlnets(cond, carry_schedules(cond, new_cond, [], []))


class FlakeInpaint:
    """Put an image into a FLAKE_DATA bundle so Flake Generate inpaints it
    (#291, #428).

    The mask is the image's alpha channel, painted with ComfyUI's mask editor
    on the node. Without a mask the whole image is redrawn at ``denoise``.
    Optional prompts are appended to the chain prompt.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "flake_data": ("FLAKE_DATA",),
                "image": LoadImage.INPUT_TYPES()["required"]["image"],
                "denoise": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.01}),
                "grow_mask": ("INT", {"default": 6, "min": 0, "max": 64,
                                      "tooltip": "Grow the mask by this many pixels. Used at denoise 1."}),
            },
            "optional": {
                "positive_prompt": ("STRING", {"default": "", "multiline": True}),
                "negative_prompt": ("STRING", {"default": "", "multiline": True}),
            },
        }

    RETURN_TYPES = ("FLAKE_DATA",)
    RETURN_NAMES = ("flake_data",)
    FUNCTION = "execute"
    CATEGORY = "flakes"
    DESCRIPTION = (
        "Inpaint the masked area of an image: insert before Flake Generate. Paint "
        "the mask with the mask editor; without one the whole image is redrawn at denoise."
    )

    def execute(self, flake_data, image, denoise=1.0, grow_mask=6,
                positive_prompt="", negative_prompt=""):
        model_bundle, generation_data, sampling_preset = flake_data
        _, clip, vae = model_bundle
        positive, negative, _, _, _, pos_text, neg_text = generation_data[:7]

        pixels, mask = LoadImage().load_image(image)
        if not mask.any():
            latent = VAEEncode().encode(vae, pixels)[0]
        elif denoise < 1.0:
            latent = SetLatentNoiseMask().set_mask(VAEEncode().encode(vae, pixels)[0], mask)[0]
        else:
            latent = VAEEncodeForInpaint().encode(vae, pixels, mask, grow_mask_by=grow_mask)[0]

        if positive_prompt.strip():
            pos_text = " BREAK ".join(t for t in (pos_text.strip(), positive_prompt.strip()) if t)
            positive = _reencode(clip, positive, pos_text)
        if negative_prompt.strip():
            neg_text = ", ".join(t for t in (neg_text.strip(), negative_prompt.strip()) if t)
            negative = _reencode(clip, negative, neg_text)

        generation_data = (positive, negative, latent, pixels.shape[2], pixels.shape[1],
                           pos_text, neg_text) + tuple(generation_data[7:])
        return ((model_bundle, generation_data, sampling_preset[:4] + (denoise,)),)

    @classmethod
    def IS_CHANGED(cls, image, **kwargs):
        return LoadImage.IS_CHANGED(image)

    @classmethod
    def VALIDATE_INPUTS(cls, image):
        return LoadImage.VALIDATE_INPUTS(image)
