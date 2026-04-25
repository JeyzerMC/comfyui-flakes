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
    """Accept either a full filename under models/loras/ or a stem; return the filename that LoraLoader expects."""
    available = folder_paths.get_filename_list("loras")
    available_set = set(available)

    norm = stem_or_name.replace("\\", "/")
    if norm in available_set:
        return norm

    for candidate in available:
        cand_norm = candidate.replace("\\", "/")
        stem, _ = os.path.splitext(cand_norm)
        if stem == norm:
            return candidate

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
            if cn.model_name not in cn_model_cache:
                cn_model_cache[cn.model_name] = cn_loader.load_controlnet(cn.model_name)[0]
            cn_model = cn_model_cache[cn.model_name]
            image = _load_cn_image(cn.image_name)
            positive, negative = cn_apply.apply_controlnet(
                positive, negative, cn_model, image,
                cn.strength, cn.start_percent, cn.end_percent,
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
