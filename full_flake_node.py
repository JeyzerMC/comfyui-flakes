from __future__ import annotations

import json
import logging
import os

import folder_paths
import comfy.sd
import comfy.utils
from nodes import CLIPTextEncode, EmptyLatentImage, ControlNetApplyAdvanced, ControlNetLoader, LoraLoader

from . import flake_io


def _resolve_lora_name(stem_or_name: str) -> str:
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

    raise FileNotFoundError(f"LoRA '{stem_or_name}' not found in models/loras/")


class FullFlakes:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "preset_json": ("STRING", {
                    "multiline": False,
                    "default": "{}",
                    "tooltip": "JSON-encoded preset selection + config. Managed by the Full Flakes widget.",
                }),
                "flakes_json": ("STRING", {
                    "multiline": True,
                    "default": "[]",
                    "tooltip": "JSON-encoded list of flake entries. Managed by the Flake Stack widget.",
                }),
            },
        }

    RETURN_TYPES = (
        "MODEL", "CLIP", "VAE",
        "CONDITIONING", "CONDITIONING", "LATENT",
        "INT", "INT", "INT", "FLOAT",
    )
    RETURN_NAMES = (
        "model", "clip", "vae",
        "positive", "negative", "latent",
        "width", "height", "steps", "cfg",
    )
    FUNCTION = "execute"
    CATEGORY = "flakes"
    DESCRIPTION = (
        "Self-contained flake-stack node. Select a model preset to load the "
        "checkpoint automatically. The preset sets the checkpoint, clip-skip, "
        "VAE, steps, CFG, sampler, scheduler, prompts, and embeddings. "
        "Flakes are composed on top of the preset prompts."
    )

    def execute(self, preset_json: str, flakes_json: str):
        # --- Load preset --------------------------------------------------------
        try:
            preset_raw = json.loads(preset_json) if preset_json else {}
        except json.JSONDecodeError as exc:
            raise ValueError(f"preset_json is not valid JSON: {exc}") from exc

        preset_name = (preset_raw.get("name") or "").strip()
        if not preset_name:
            raise ValueError("No preset selected in FullFlakes — pick one from the dropdown.")

        preset = flake_io.load_preset(preset_name)

        # --- Load checkpoint ----------------------------------------------------
        ckpt_path = folder_paths.get_full_path("checkpoints", preset.checkpoint)
        if not ckpt_path or not os.path.isfile(ckpt_path):
            raise FileNotFoundError(
                f"Checkpoint '{preset.checkpoint}' not found in models/checkpoints/"
            )

        embedding_dir = folder_paths.get_folder_paths("embeddings")
        model, clip, vae = comfy.sd.load_checkpoint_guess_config(
            ckpt_path,
            output_vae=True,
            output_clip=True,
            embedding_directory=embedding_dir,
        )

        # --- Clip skip ----------------------------------------------------------
        if preset.clip_skip:
            clip = clip.clone()
            clip.clip_layer(preset.clip_skip)

        # --- Optional VAE override ----------------------------------------------
        if preset.vae:
            vae_path = folder_paths.get_full_path("vae", preset.vae)
            if vae_path and os.path.isfile(vae_path):
                vae_sd = comfy.utils.load_torch_file(vae_path)
                vae = comfy.sd.VAE(sd=vae_sd)

        # --- Parse flakes_json --------------------------------------------------
        try:
            entries = json.loads(flakes_json) if flakes_json else []
        except json.JSONDecodeError as exc:
            raise ValueError(f"flakes_json is not valid JSON: {exc}") from exc

        if not isinstance(entries, list):
            raise ValueError("flakes_json must be a JSON list")

        normalized: list[dict] = []
        for i, entry in enumerate(entries):
            if not isinstance(entry, dict):
                logging.warning("[FullFlakes] skipping non-object entry %d: %r", i, entry)
                continue
            if entry.get("inline") or entry.get("name"):
                normalized.append(entry)
            else:
                logging.warning("[FullFlakes] skipping entry %d (needs 'name' or 'inline')", i)

        # --- Resolve flakes -----------------------------------------------------
        flakes = [flake_io.resolve(e) for e in normalized]

        # --- Apply LoRAs --------------------------------------------------------
        lora_loader = LoraLoader()
        for f in flakes:
            if not f.lora_path:
                continue
            lora_name = _resolve_lora_name(f.lora_path)
            model, clip = lora_loader.load_lora(model, clip, lora_name, f.strength, f.strength)

        # --- Build prompt text (preset → flakes → default) ---------------------
        pos_parts: list[str] = []
        neg_parts: list[str] = []

        if preset.positive.strip():
            pos_parts.append(preset.positive.strip())
        if preset.negative.strip():
            neg_parts.append(preset.negative.strip())

        for f in flakes:
            if f.positive and f.positive.strip():
                pos_parts.append(f.positive.strip())
            if f.negative and f.negative.strip():
                neg_parts.append(f.negative.strip())

        pos_text = " BREAK ".join(pos_parts) if pos_parts else ""
        neg_text = ", ".join(neg_parts) if neg_parts else ""

        # --- Encode prompts -----------------------------------------------------
        encoder = CLIPTextEncode()
        positive = encoder.encode(clip, pos_text)[0] if pos_text else encoder.encode(clip, "")[0]
        negative = encoder.encode(clip, neg_text)[0] if neg_text else encoder.encode(clip, "")[0]

        # --- Apply ControlNets (from flakes) ------------------------------------
        from .flake_compose import _load_cn_image

        cn_model_cache = {}
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

        # --- Resolution ---------------------------------------------------------
        width, height = preset.width, preset.height
        for f in flakes:
            if f.resolution is not None:
                width, height = f.resolution
                break

        # --- Latent -------------------------------------------------------------
        latent = EmptyLatentImage().generate(width, height, 1)[0]

        logging.info(
            "[FullFlakes] preset=%s checkpoint=%s %sx%s steps=%s cfg=%s flakes=%d",
            preset_name, preset.checkpoint, width, height,
            preset.steps, preset.cfg, len(flakes),
        )

        return (
            model, clip, vae,
            positive, negative, latent,
            width, height,
            preset.steps, preset.cfg,
        )
