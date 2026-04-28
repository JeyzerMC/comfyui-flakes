from __future__ import annotations

import json
import logging
import os
from datetime import datetime

import folder_paths
import comfy.sd
import comfy.utils
from nodes import CLIPTextEncode, EmptyLatentImage, ControlNetApplyAdvanced, ControlNetLoader, LoraLoader

from . import flake_io


def _build_filename_prefix(preset_name: str, stems: list[str]) -> str:
    """Build a filename prefix from preset name and flake stems."""
    folder_parts = []
    file_parts = []
    for stem in stems:
        if "/" in stem:
            folder_parts.append(stem)
        else:
            file_parts.append(stem)
    path = (preset_name + "/") if preset_name else ""
    if folder_parts:
        path += "".join(folder_parts)
    now = datetime.now()
    path += now.strftime("%Y-%m-%d") + "/"
    filename = now.strftime("%H-%M-%S")
    if file_parts:
        filename += "_" + "_".join(file_parts)
    return path + filename


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


def _load_preset_bundle(preset_name: str):
    """Load a model preset and return (model_bundle, generation_data, sampling_preset)."""
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

    # --- Encode prompts -----------------------------------------------------
    encoder = CLIPTextEncode()
    pos_text = preset_data.positive.strip()
    neg_text = preset_data.negative.strip()
    positive = encoder.encode(clip, pos_text)[0] if pos_text else encoder.encode(clip, "")[0]
    negative = encoder.encode(clip, neg_text)[0] if neg_text else encoder.encode(clip, "")[0]

    # --- Latent -------------------------------------------------------------
    width, height = preset_data.width, preset_data.height
    latent = EmptyLatentImage().generate(width, height, 1)[0]

    model_bundle = (model, clip, vae)
    filename_state = {"preset": preset_name, "stems": []}
    generation_data = (positive, negative, latent, width, height, pos_text, neg_text, filename_state)
    sampling_preset = (preset_data.steps, preset_data.cfg, preset_data.sampler, preset_data.scheduler)

    return model_bundle, generation_data, sampling_preset


class FlakeModelPreset:
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
            },
        }

    RETURN_TYPES = (
        "FLAKES_MODEL", "FLAKES_COND", "FLAKES_SAMPLER",
    )
    RETURN_NAMES = (
        "model_bundle", "generation_data", "sampling_preset",
    )
    FUNCTION = "execute"
    CATEGORY = "flakes"
    DESCRIPTION = (
        "Load a model preset (checkpoint, VAE, prompts, resolution, sampler settings). "
        "Outputs are bundled for wiring into FlakeStack / FlakeCombo nodes."
    )

    def execute(self, preset: str):
        preset_name = preset.strip() if preset else ""
        if not preset_name or preset_name in ("Select a preset...", "No model preset is selected"):
            raise ValueError("No model preset is selected — pick one from the dropdown.")

        return _load_preset_bundle(preset_name)


class FlakeStack:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model_bundle": ("FLAKES_MODEL",),
                "generation_data": ("FLAKES_COND",),
                "sampling_preset": ("FLAKES_SAMPLER",),
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
        "model_bundle", "generation_data", "sampling_preset",
    )
    FUNCTION = "execute"
    CATEGORY = "flakes"
    DESCRIPTION = (
        "Compose flakes on top of an incoming model/generation/sampler bundle. "
        "Applies LoRAs, merges prompts, resolution overrides and ControlNets. "
        "Outputs updated bundles for chaining into downstream nodes."
    )

    def execute(self, model_bundle, generation_data, sampling_preset, flakes_json: str):
        model, clip, vae = model_bundle
        positive_cond, negative_cond, latent, width, height, pos_text, neg_text = generation_data[:7]
        steps, cfg, sampler, scheduler = sampling_preset

        # --- Filename prefix state ----------------------------------------------
        if len(generation_data) > 7:
            filename_state = generation_data[7]
        else:
            filename_state = {"preset": "", "stems": []}

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
            # New multi-LoRA format
            for lr in f.loras:
                if not lr.path:
                    continue
                lora_name = _resolve_lora_name(lr.path)
                model, clip = lora_loader.load_lora(model, clip, lora_name, lr.strength, lr.strength)
            # Legacy single LoRA fallback
            if f.lora_path:
                lora_name = _resolve_lora_name(f.lora_path)
                model, clip = lora_loader.load_lora(model, clip, lora_name, f.strength, f.strength)

        # --- Build prompt text (existing → flakes) ------------------------------
        pos_parts: list[str] = []
        neg_parts: list[str] = []

        if pos_text and pos_text.strip():
            pos_parts.append(pos_text.strip())
        if neg_text and neg_text.strip():
            neg_parts.append(neg_text.strip())

        for f in flakes:
            if f.positive and f.positive.strip():
                pos_parts.append(f.positive.strip())
            if f.negative and f.negative.strip():
                neg_parts.append(f.negative.strip())

        new_pos_text = " BREAK ".join(pos_parts) if pos_parts else ""
        new_neg_text = ", ".join(neg_parts) if neg_parts else ""

        # --- Re-encode prompts --------------------------------------------------
        encoder = CLIPTextEncode()
        positive_cond = encoder.encode(clip, new_pos_text)[0] if new_pos_text else encoder.encode(clip, "")[0]
        negative_cond = encoder.encode(clip, new_neg_text)[0] if new_neg_text else encoder.encode(clip, "")[0]

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
                positive_cond, negative_cond = cn_apply.apply_controlnet(
                    positive_cond, negative_cond, cn_model, image,
                    cn.strength, cn.start_percent, cn.end_percent,
                )

        # --- Resolution ---------------------------------------------------------
        new_width, new_height = width, height
        for f in flakes:
            if f.resolution is not None:
                new_width, new_height = f.resolution
                break

        if (new_width, new_height) != (width, height):
            latent = EmptyLatentImage().generate(new_width, new_height, 1)[0]

        # --- Filename prefix ----------------------------------------------------
        for f in flakes:
            if f.output_stem:
                filename_state["stems"].append(f.output_stem)

        logging.info(
            "[FlakeStack] %dx%s steps=%s cfg=%s flakes=%d",
            new_width, new_height, steps, cfg, len(flakes),
        )

        out_model_bundle = (model, clip, vae)
        out_generation_data = (positive_cond, negative_cond, latent, new_width, new_height, new_pos_text, new_neg_text, filename_state)
        out_sampling_preset = (steps, cfg, sampler, scheduler)

        return (
            out_model_bundle, out_generation_data, out_sampling_preset,
        )


class FlakeCombo(FlakeStack):
    """Mutually-exclusive flake stack.

    The backend behavior is identical to FlakeStack — it receives a
    ``flakes_json`` list and applies whatever entries are inside.
    The frontend widget ensures that ``flakes_json`` contains exactly
    one active flake at a time, and the JavaScript extension hooks
    ``app.queuePrompt`` to queue every combination across all
    FlakeCombo / FlakeModelCombo nodes in the graph.
    """
    pass


class FlakeModelCombo(FlakeModelPreset):
    """Multiple model preset selector.

    The backend behavior is identical to FlakeModelPreset — it loads
    a single preset from the ``preset`` dropdown.  The frontend widget
    manages a list of selected presets in ``node.properties`` and the
    JavaScript extension cycles the ``preset`` widget value for each
    combination when queueing.
    """
    pass
