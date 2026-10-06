from __future__ import annotations

import logging
import os
from typing import Any

import numpy as np
import torch
from PIL import Image, ImageOps

import folder_paths
from nodes import (
    CLIPTextEncode,
    ControlNetApplyAdvanced,
    ControlNetLoader,
    EmptyLatentImage,
    LoraLoader,
)

from . import flake_io


def _resolve_lora_name(stem_or_name: str) -> str:
    result = flake_io._resolve_model_name("loras", stem_or_name)
    available = folder_paths.get_filename_list("loras")
    if result.replace("\\", "/") in {p.replace("\\", "/") for p in available}:
        return result
    raise FileNotFoundError(
        f"LoRA '{stem_or_name}' not found in models/loras/. "
        f"Provide the stem or full filename of an existing LoRA."
    )


def _load_cn_image(image_name: str) -> torch.Tensor:
    """Load an image tensor shaped [1, H, W, 3] (ComfyUI's IMAGE format) from ComfyUI/input/.

    `image_name` may be a stem ('standing_openpose') or a filename with extension.
    Subdirectories under input/ are allowed ('cnet/standing_openpose').
    """
    input_dir = folder_paths.get_input_directory()
    norm = image_name.replace("\\", "/")

    candidates: list[str] = []
    direct = os.path.join(input_dir, norm)
    if os.path.isfile(direct):
        candidates.append(direct)
    else:
        for ext in (".png", ".jpg", ".jpeg", ".webp"):
            alt = os.path.join(input_dir, f"{norm}{ext}")
            if os.path.isfile(alt):
                candidates.append(alt)
                break

    if not candidates:
        raise FileNotFoundError(
            f"ControlNet image '{image_name}' not found in {input_dir}. "
            f"Place the image there (any of .png/.jpg/.jpeg/.webp) or use a full filename."
        )

    img = Image.open(candidates[0])
    img = ImageOps.exif_transpose(img).convert("RGB")
    arr = np.array(img).astype(np.float32) / 255.0
    return torch.from_numpy(arr)[None,]


def _fit_cn_image(image: torch.Tensor, target_w: int, target_h: int) -> torch.Tensor:
    """Resize a ControlNet hint image (IMAGE tensor [B, H, W, 3]) to the
    generation resolution, cropping to the target aspect first (#255).

    ComfyUI otherwise stretches the hint to the latent size at sample time,
    which distorts the pose whenever the control image's aspect ratio differs
    from the generation resolution. Crop-and-resize (matching A1111's default)
    keeps the pose aligned with the generated frame.
    """
    import comfy.utils

    if target_w <= 0 or target_h <= 0:
        return image
    h, w = int(image.shape[1]), int(image.shape[2])
    if (w, h) == (target_w, target_h):
        return image
    samples = image.movedim(-1, 1)  # [B, 3, H, W]
    samples = comfy.utils.common_upscale(samples, target_w, target_h, "lanczos", "center")
    return samples.movedim(1, -1)  # back to [B, H, W, 3]


# Model-patch ControlNets (#365), most recently used last: {name: (mtime, MODEL_PATCH)}.
# Reusing the same MODEL_PATCH object across runs lets a Flake Combo batch skip
# re-reading the file and lets ComfyUI keep it resident. Bounded so a multi-GB
# Z-Image union patch isn't pinned once workflows stop using it.
_CN_PATCH_CACHE: dict[str, tuple[float, Any]] = {}
_CN_PATCH_CACHE_SIZE = 4


def load_cn_patch(name: str) -> Any:
    """Load a ControlNet model patch from models/model_patches/ (#365)."""
    from comfy_extras.nodes_model_patch import ModelPatchLoader

    mtime = os.path.getmtime(folder_paths.get_full_path_or_raise("model_patches", name))
    hit = _CN_PATCH_CACHE.pop(name, None)
    if hit is None or hit[0] != mtime:
        hit = (mtime, ModelPatchLoader().load_model_patch(name)[0])
    _CN_PATCH_CACHE[name] = hit
    while len(_CN_PATCH_CACHE) > _CN_PATCH_CACHE_SIZE:
        del _CN_PATCH_CACHE[next(iter(_CN_PATCH_CACHE))]
    return hit[1]


def apply_model_patch_cn(cn_kind: str, model: Any, vae: Any, model_patch: Any, image: torch.Tensor,
                         strength: float, start_percent: float, end_percent: float) -> Any:
    """Apply an Anima LLLite or Z-Image Fun ControlNet by patching the model (#365).

    These hook the diffusion model's blocks rather than the conditioning. The
    returned model is a clone sharing the base weights, so swapping the patch
    between runs does not reload the diffusion model.
    """
    from comfy_extras.nodes_model_patch import AnimaLLLiteApply, ZImageFunControlnet

    if cn_kind == "anima_lllite":
        return AnimaLLLiteApply().apply_patch(model, model_patch, image, strength, start_percent, end_percent)[0]
    if (start_percent, end_percent) != (0.0, 1.0):
        logging.warning("[flakes] Z-Image Fun ControlNet has no start/end; applying it to every step")
    return ZImageFunControlnet().diffsynth_controlnet(model, model_patch, vae, image=image, strength=strength)[0]


def maybe_zero_out_negative(negative: Any, cfg: float) -> Any:
    """Zero out the negative conditioning when sampling at cfg <= 1 (#359).

    Distilled/turbo models (Z-Image Turbo, Krea2 Turbo, Anima with the turbo
    LoRA) run at cfg 1.0, where the negative branch is never evaluated — the
    workflow templates ComfyUI ships all feed those samplers a
    ``ConditioningZeroOut`` instead of encoded text.

    Keying this off the *effective* cfg rather than the model family is what
    makes it correct for free: Anima base at cfg 4 keeps its real negative,
    Anima + turbo LoRA at cfg 1 does not, and no per-family flag can get out of
    step with the value the user actually sampled at.
    """
    if negative is None or cfg is None or cfg > 1.0:
        return negative
    from nodes import ConditioningZeroOut

    return ConditioningZeroOut().zero_out(negative)[0]


def compose(
    model: Any,
    clip: Any,
    entries: list[dict[str, Any]],
) -> tuple:
    flakes = [flake_io.resolve(e) for e in entries]

    lora_loader = LoraLoader()
    for f in flakes:
        if not f.lora_path:
            continue
        lora_name = _resolve_lora_name(f.lora_path)
        model, clip = lora_loader.load_lora(model, clip, lora_name, f.strength, f.strength)

    pos_text = " BREAK ".join(f.positive.strip() for f in flakes if f.positive and f.positive.strip())
    neg_text = ", ".join(f.negative.strip() for f in flakes if f.negative and f.negative.strip())

    encoder = CLIPTextEncode()
    positive = encoder.encode(clip, pos_text)[0]
    negative = encoder.encode(clip, neg_text)[0]

    cn_model_cache: dict[str, Any] = {}
    cn_loader = ControlNetLoader()
    cn_apply = ControlNetApplyAdvanced()
    for f in flakes:
        for cn in f.controlnets:
            if cn.strength == 0:
                continue
            if not cn.model_name.strip():
                print(f"[flakes] skipping controlnet entry with empty model_name")
                continue
            if not cn.image_name.strip():
                print(f"[flakes] skipping controlnet entry with empty image_name (type={cn.type})")
                continue
            cn_resolved = flake_io._resolve_model_name("controlnet", cn.model_name)
            if cn_resolved not in cn_model_cache:
                cn_model_cache[cn_resolved] = cn_loader.load_controlnet(cn_resolved)[0]
            cn_model = cn_model_cache[cn_resolved]
            image = _load_cn_image(cn.image_name)
            positive, negative = cn_apply.apply_controlnet(
                positive, negative, cn_model, image,
                cn.strength, cn.start_percent, cn.end_percent,
            )
            logging.info(
                "[flakes] applied CN model=%s image=%s strength=%.2f start=%.2f end=%.2f",
                cn_resolved, cn.image_name, cn.strength, cn.start_percent, cn.end_percent,
            )

    width, height = 1024, 1024
    for f in flakes:
        if f.resolution is not None:
            width, height = f.resolution
            break

    latent = EmptyLatentImage().generate(width, height, 1)[0]

    logging.info(
        "[FlakeStack] composed %d flake(s), resolution %dx%d, %d controlnet(s)",
        len(flakes), width, height,
        sum(len(f.controlnets) for f in flakes),
    )

    return model, clip, positive, negative, latent, width, height
