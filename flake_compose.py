from __future__ import annotations

import importlib.util
import json
import logging
import os
from typing import Any

import numpy as np
import torch
from PIL import Image, ImageOps

import comfy.hooks
import comfy.sd
import comfy.utils
import folder_paths
import node_helpers
from nodes import (
    CLIPTextEncode,
    ControlNetApplyAdvanced,
    ControlNetLoader,
    EmptyLatentImage,
    LoraLoader,
    NODE_CLASS_MAPPINGS,
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


def _lora_file(path: str) -> str:
    """Full path of a flake LoRA: a LoRA the flake owns arrives as an absolute
    path (#391), anything else is a name under models/loras/."""
    return path if os.path.isabs(path) else folder_paths.get_full_path_or_raise("loras", _resolve_lora_name(path))


def _load_lora(model: Any, clip: Any, path: str, strength_model: float, strength_clip: float) -> tuple[Any, Any]:
    """LoraLoader for a flake LoRA; an owned LoRA lives outside models/loras/,
    so it is loaded from its path the way LoraLoader does."""
    if not os.path.isabs(path):
        return LoraLoader().load_lora(model, clip, _resolve_lora_name(path), strength_model, strength_clip)
    if strength_model == 0 and strength_clip == 0:
        return model, clip
    lora, metadata = comfy.utils.load_torch_file(path, safe_load=True, return_metadata=True)
    return comfy.sd.load_lora_for_models(model, clip, lora, strength_model, strength_clip, lora_metadata=metadata)


def _load_cn_image(image_name: str) -> torch.Tensor:
    """Load an image tensor shaped [1, H, W, 3] (ComfyUI's IMAGE format) from ComfyUI/input/.

    `image_name` may be a stem ('standing_openpose') or a filename with extension.
    Subdirectories under input/ are allowed ('cnet/standing_openpose').
    Absolute paths (a flake's resolved `./` images) are loaded directly.
    """
    input_dir = folder_paths.get_input_directory()
    norm = image_name.replace("\\", "/")

    candidates: list[str] = []
    direct = image_name if os.path.isabs(image_name) else os.path.join(input_dir, norm)
    if os.path.isfile(direct):
        candidates.append(direct)
    else:
        for ext in (".png", ".jpg", ".jpeg", ".webp"):
            alt = f"{direct}{ext}"
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


def _in_anima_folder(name: str, category: str) -> bool:
    return name.replace("\\", "/").lower().startswith("anima/") and name in folder_paths.get_filename_list(category)


def _is_anima_vace(name: str) -> bool:
    """Anima VACE ControlNets carry ``control_blocks.*.after_proj`` keys (#378)."""
    header = comfy.utils.safetensors_header(folder_paths.get_full_path_or_raise("controlnet", name))
    return bool(header) and any("control_blocks" in k and "after_proj" in k for k in json.loads(header))


def anima_cn_choice(model_name: str) -> tuple[str, str] | None:
    """The Anima ControlNet an explicit ``model_name`` picks, as ``(file, kind)``:
    a VACE file in models/controlnet/anima/ (kind "vace", #378) or any patch in
    models/model_patches/anima/ (kind "lllite"). None when it resolves to
    neither, so the type-inferred LLLite file applies (#381)."""
    name = flake_io.resolve_cn_model_name(model_name, "anima", "controlnet")
    if _in_anima_folder(name, "controlnet") and _is_anima_vace(name):
        return name, "vace"
    name = flake_io.resolve_cn_model_name(model_name, "anima", "model_patches")
    if _in_anima_folder(name, "model_patches"):
        return name, "lllite"
    return None


def anima_cn_files() -> list[dict[str, str]]:
    """Files selectable as an Anima ControlNet ``model`` (#381)."""
    files = [{"name": n, "kind": "lllite"} for n in folder_paths.get_filename_list("model_patches")
             if n.replace("\\", "/").lower().startswith("anima/")]
    files += [{"name": n, "kind": "vace"} for n in folder_paths.get_filename_list("controlnet")
              if n.replace("\\", "/").lower().startswith("anima/") and n.endswith(".safetensors") and _is_anima_vace(n)]
    return files


def apply_anima_vace(positive: Any, negative: Any, name: str, vae: Any, image: torch.Tensor,
                     strength: float, start_percent: float, end_percent: float) -> tuple[Any, Any]:
    """Apply an Anima VACE ControlNet through the nodes of the
    ComfyUI-Advanced-ControlNet-Anima fork (#378); core ComfyUI can't load it."""
    loader = NODE_CLASS_MAPPINGS.get("ACN_ControlNetLoaderAdvanced")
    apply = NODE_CLASS_MAPPINGS.get("ACN_AdvancedControlNetApply_v2")
    # Upstream Advanced-ControlNet registers the same nodes without VACE support.
    if loader is None or apply is None or importlib.util.find_spec(
            loader.__module__.rsplit(".", 1)[0] + ".control_anima_vace") is None:
        raise RuntimeError(
            f"Anima VACE ControlNet '{name}' needs the ComfyUI-Advanced-ControlNet-Anima custom nodes "
            f"(github.com/TaihoC/ComfyUI-Advanced-ControlNet-Anima, branch feat/anima-vace-controlnet)."
        )
    control_net = loader().load_controlnet(name)[0]
    return apply().apply_controlnet(positive, negative, control_net, image, strength, start_percent, end_percent,
                                    vae_optional=vae)


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


def schedule_segments(schedule: list[flake_io.ScheduleKeyframe]) -> list[tuple[float, float, float]]:
    """``(start, end, strength)`` spans covering [0, 1] for a hook schedule (#370)."""
    segments = []
    start, strength = 0.0, 1.0
    for kf in schedule:
        if kf.start > start:
            segments.append((start, kf.start, strength))
        start, strength = kf.start, kf.strength
    if start < 1.0:
        segments.append((start, 1.0, strength))
    return segments


def scheduled_lora_hooks(lora_path: str, strength: float, schedule: list[flake_io.ScheduleKeyframe]) -> Any:
    """Hook group applying a LoRA's model weights under ``schedule`` (#370).

    Hooked weights only act on conds that carry the hooks, so the caller
    attaches the group to both positive and negative.
    """
    lora = comfy.utils.load_torch_file(_lora_file(lora_path), safe_load=True)
    hooks = comfy.hooks.create_hook_lora(lora, strength, 0.0)
    keyframes = comfy.hooks.HookKeyframeGroup()
    for kf in schedule:
        keyframes.add(comfy.hooks.HookKeyframe(strength=kf.strength, start_percent=kf.start))
    hooks.set_keyframes_on_hooks(keyframes)
    return hooks


def apply_loras(model: Any, clip: Any, flakes: list[flake_io.Flake]) -> tuple[Any, Any, list[dict], list]:
    """Apply the flakes' LoRAs, returning ``(model, clip, lora_entries, hook_groups)``.

    A scheduled LoRA's model weights become hooks on the conds (#370); its
    text-encoder part is applied statically so trigger words encode.
    """
    lora_entries = []
    hook_groups = []
    for f in flakes:
        for lr in f.loras:
            if not lr.path:
                continue
            if lr.schedule:
                if all(s == 0 for _, _, s in schedule_segments(lr.schedule)):
                    continue
                model, clip = _load_lora(model, clip, lr.path, 0, lr.strength)
                hook_groups.append(scheduled_lora_hooks(lr.path, lr.strength, lr.schedule))
            else:
                model, clip = _load_lora(model, clip, lr.path, lr.strength, lr.strength)
            lora_entries.append({"name": lr.name or lr.path, "path": lr.path, "strength": lr.strength})
        # Legacy single LoRA fallback
        if f.lora_path:
            model, clip = _load_lora(model, clip, f.lora_path, f.strength, f.strength)
            lora_entries.append({"name": f.lora_path, "path": f.lora_path, "strength": f.strength})
    return model, clip, lora_entries, hook_groups


def encode_scheduled_prompts(clip: Any, flakes: list[flake_io.Flake]) -> tuple[list, list]:
    """Time-ranged positive and negative entries for the flakes' scheduled prompts (#370)."""
    pos_ranged, neg_ranged = [], []
    for f in flakes:
        for p in f.scheduled_prompts:
            if p.positive.strip():
                pos_ranged += encode_scheduled(clip, p.positive.strip(), p.schedule)
            if p.negative.strip():
                neg_ranged += encode_scheduled(clip, p.negative.strip(), p.schedule)
    return pos_ranged, neg_ranged


def encode_scheduled(clip: Any, text: str, schedule: list[flake_io.ScheduleKeyframe]) -> list:
    """Encode ``text`` as one cond entry per schedule segment with strength > 0,
    to be appended after the base cond (#370)."""
    cond = CLIPTextEncode().encode(clip, text)[0]
    out = []
    for start, end, strength in schedule_segments(schedule):
        if strength > 0:
            out += node_helpers.conditioning_set_values(
                cond, {"start_percent": start, "end_percent": end, "strength": strength})
    return out


def carry_schedules(src_cond: list, dst_cond: list, ranged: list, hook_groups: list) -> list:
    """Append upstream and new time-ranged prompt entries to freshly encoded
    ``dst_cond`` and attach upstream and new LoRA hooks to every entry (#370).

    A chained Flake node re-encodes the accumulated text, which drops what
    upstream nodes attached (like ``control``, see ``_carry_controlnets``).
    """
    upstream_ranged = [t for t in src_cond if "start_percent" in t[1]]
    hooks = comfy.hooks.HookGroup.combine_all_hooks([src_cond[0][1].get("hooks")] + hook_groups)
    return comfy.hooks.set_hooks_for_conditioning(dst_cond + upstream_ranged + ranged, hooks, append_hooks=False)


def compose(
    model: Any,
    clip: Any,
    entries: list[dict[str, Any]],
) -> tuple:
    flakes = [flake_io.resolve(e) for e in entries]

    for f in flakes:
        if not f.lora_path:
            continue
        model, clip = _load_lora(model, clip, f.lora_path, f.strength, f.strength)

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
