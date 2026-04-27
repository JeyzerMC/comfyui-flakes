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
    # Map normalized (forward-slash) paths back to original paths
    available_norm = {p.replace("\\", "/"): p for p in available}

    norm = stem_or_name.replace("\\", "/")
    if norm in available_norm:
        return available_norm[norm]

    norm_stem, _ = os.path.splitext(norm)
    for cand_norm, candidate in available_norm.items():
        stem, _ = os.path.splitext(cand_norm)
        if stem == norm_stem:
            return candidate

    raise FileNotFoundError(f"LoRA '{stem_or_name}' not found in models/loras/")


class FlakeStack:
    @classmethod
    def INPUT_TYPES(cls):
        try:
            preset_names = flake_io.list_presets()
        except Exception:
            preset_names = []
        if not preset_names:
            preset_names = ["No model preset is selected"]
        return {
            "required": {
                "preset": (["Select a preset..."] + preset_names,),
                "flakes_json": ("STRING", {
                    "multiline": True,
                    "default": "[]",
                    "tooltip": "JSON-encoded list of flake entries. Managed by the Full Flakes widget.",
                }),
            },
        }

    RETURN_TYPES = (
        "FLAKES_MODEL", "FLAKES_COND", "FLAKES_SAMPLER",
    )
    RETURN_NAMES = (
        "model", "conditioning", "sampler",
    )
    FUNCTION = "execute"
    CATEGORY = "flakes"
    DESCRIPTION = (
        "Self-contained flake-stack node. Select a model preset from the "
        "dropdown to load checkpoint + settings automatically. "
        "Flakes are composed on top of the preset prompts. "
        "Outputs are bundled — use FlakesModel / FlakesCond / FlakesSampler "
        "to unpack them for wiring into downstream nodes."
    )

    def execute(self, preset: str, flakes_json: str):
        # --- Load preset --------------------------------------------------------
        preset_name = preset.strip() if preset else ""
        if not preset_name or preset_name in ("Select a preset...", "No model preset is selected"):
            raise ValueError("No model preset is selected — pick one from the dropdown.")

        preset_data = flake_io.load_preset(preset_name)

        # --- Load checkpoint ----------------------------------------------------
        ckpt_path = folder_paths.get_full_path("checkpoints", preset_data.checkpoint)
        if not ckpt_path or not os.path.isfile(ckpt_path):
            raise FileNotFoundError(
                f"Checkpoint '{preset_data.checkpoint}' not found in models/checkpoints/"
            )

        embedding_dir = folder_paths.get_folder_paths("embeddings")
        model, clip, vae, _ = comfy.sd.load_checkpoint_guess_config(
            ckpt_path,
            output_vae=True,
            output_clip=True,
            embedding_directory=embedding_dir,
        )

        # --- Clip skip ----------------------------------------------------------
        if preset_data.clip_skip:
            clip = clip.clone()
            clip.clip_layer(preset_data.clip_skip)

        # --- Optional VAE override ----------------------------------------------
        if preset_data.vae:
            vae_path = folder_paths.get_full_path("vae", preset_data.vae)
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
                logging.warning("[FlakeStack] skipping non-object entry %d: %r", i, entry)
                continue
            if entry.get("inline") or entry.get("name"):
                normalized.append(entry)
            else:
                logging.warning("[FlakeStack] skipping entry %d (needs 'name' or 'inline')", i)

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

        if preset_data.positive.strip():
            pos_parts.append(preset_data.positive.strip())
        if preset_data.negative.strip():
            neg_parts.append(preset_data.negative.strip())

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
        width, height = preset_data.width, preset_data.height
        for f in flakes:
            if f.resolution is not None:
                width, height = f.resolution
                break

        # --- Latent -------------------------------------------------------------
        latent = EmptyLatentImage().generate(width, height, 1)[0]

        logging.info(
            "[FlakeStack] preset=%s checkpoint=%s %sx%s steps=%s cfg=%s flakes=%d",
            preset_name, preset_data.checkpoint, width, height,
            preset_data.steps, preset_data.cfg, len(flakes),
        )

        model_bundle = (model, clip, vae)
        cond_bundle = (positive, negative, latent, width, height)
        sampler_bundle = (preset_data.steps, preset_data.cfg, preset_data.sampler, preset_data.scheduler)

        return (
            model_bundle, cond_bundle, sampler_bundle,
        )
