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
        if not stem:
            continue
        if "/" in stem:
            folder_parts.append(stem)
        else:
            file_parts.append(stem)
    path = (preset_name + "/") if preset_name else ""
    if folder_parts:
        path += "".join(folder_parts)
    now = datetime.now()
    path += now.strftime("%y%m%d") + "/"
    filename = now.strftime("%H%M%S")
    if file_parts:
        filename += "_" + "_".join(file_parts)
    return path + filename


def _resolve_model_name(category: str, stem_or_name: str) -> str:
    available = folder_paths.get_filename_list(category)
    available_norm = {p.replace("\\", "/"): p for p in available}

    norm = stem_or_name.replace("\\", "/")
    if norm in available_norm:
        return available_norm[norm]

    norm_stem, _ = os.path.splitext(norm)
    for cand_norm, candidate in available_norm.items():
        stem, _ = os.path.splitext(cand_norm)
        if stem == norm_stem:
            return candidate

    return stem_or_name


def _resolve_lora_name(stem_or_name: str) -> str:
    result = _resolve_model_name("loras", stem_or_name)
    available = folder_paths.get_filename_list("loras")
    if result.replace("\\", "/") in {p.replace("\\", "/") for p in available}:
        return result
    raise FileNotFoundError(f"LoRA '{stem_or_name}' not found in models/loras/")


def _load_preset_bundle(preset_name: str, model_family: str | None = None):
    """Load a model preset and return (model_bundle, generation_data, sampling_preset).

    ``model_family`` is used to derive the ``img/<family>/`` output folder
    prefix (#240). It's optional for backwards compatibility but should be
    passed by the node so the structural prefix is present.
    """
    preset_data = flake_io.load_preset(preset_name)

    # --- Load checkpoint ----------------------------------------------------
    ckpt_name = _resolve_model_name("checkpoints", preset_data.checkpoint)
    ckpt_path = folder_paths.get_full_path("checkpoints", ckpt_name)
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
        vae_name = _resolve_model_name("vae", preset_data.vae)
        vae_path = folder_paths.get_full_path("vae", vae_name)
        if vae_path and os.path.isfile(vae_path):
            vae_sd = comfy.utils.load_torch_file(vae_path)
            vae = comfy.sd.VAE(sd=vae_sd)

    # --- Optional text encoder override ------------------------------------
    if preset_data.text_encoder:
        te_name = _resolve_model_name("text_encoders", preset_data.text_encoder)
        te_path = folder_paths.get_full_path("text_encoders", te_name)
        if te_path and os.path.isfile(te_path):
            te_sd = comfy.utils.load_torch_file(te_path)
            _, clip, _ = comfy.sd.load_checkpoint_guess_config(
                te_path,
                output_vae=False,
                output_clip=True,
                embedding_directory=embedding_dir,
            )
            if preset_data.clip_skip:
                clip = clip.clone()
                clip.clip_layer(preset_data.clip_skip)

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
    # Build the structural prefix `img/<family>/` (#240) plus the explicit
    # filename_prefix field. We do NOT inherit from the preset's yaml location
    # on disk (#217). The img/<family>/ segment is the project's output folder
    # convention; without it, outputs land at output/<rest>/... instead of
    # output/img/<family>/<rest>/...
    family_folder = flake_io._family_folder(model_family) if model_family else None
    structural = f"img/{family_folder}/" if family_folder else ""
    prefix_stem = (preset_data.filename_prefix or "").strip()
    stems = []
    if structural:
        # stems entries containing "/" land in folder_parts (see _build_filename_prefix).
        stems.append(structural)
    if prefix_stem:
        stems.append(prefix_stem)
    filename_state = {
        "preset": "",
        "stems": stems,
        "checkpoint": preset_data.checkpoint,
        "vae": preset_data.vae or "baked-in",
        "text_encoder": preset_data.text_encoder or "baked-in",
        "loras": [],
    }
    generation_data = (positive, negative, latent, width, height, pos_text, neg_text, filename_state)
    sampling_preset = (preset_data.steps, preset_data.cfg, preset_data.sampler, preset_data.scheduler)

    return model_bundle, generation_data, sampling_preset


_MODEL_FAMILIES = ["SDXL/Base", "SDXL/Illustrious", "SDXL/Pony", "ZImage/Base", "ZImage/Turbo"]


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
                "model_family": (_MODEL_FAMILIES, {"default": "SDXL/Base"}),
                "preset": (["Select a preset..."] + preset_names,),
            },
        }

    RETURN_TYPES = ("FLAKE_DATA",)
    RETURN_NAMES = ("flake_data",)
    FUNCTION = "execute"
    CATEGORY = "flakes"
    DESCRIPTION = (
        "Load a model preset (checkpoint, VAE, prompts, resolution, sampler settings). "
        "Outputs a single bundled flake_data pin for wiring into FlakeStack / FlakeCombo nodes."
    )

    @classmethod
    def IS_CHANGED(cls, model_family: str, preset: str):
        # Re-run whenever the preset file's contents change on disk, even if the
        # selected preset name (the node input) stays the same. Without this,
        # ComfyUI caches the output and edits to Steps/CFG/etc. are ignored.
        preset_name = preset.strip() if preset else ""
        if not preset_name or preset_name in ("Select a preset...", "No model preset is selected"):
            return preset_name
        try:
            path = flake_io._resolve_preset_file(preset_name)
            st = os.stat(path)
            return f"{path}:{st.st_mtime_ns}:{st.st_size}"
        except Exception:
            return float("nan")

    def execute(self, model_family: str, preset: str):
        preset_name = preset.strip() if preset else ""
        if not preset_name or preset_name in ("Select a preset...", "No model preset is selected"):
            raise ValueError("No model preset is selected — pick one from the dropdown.")

        model_bundle, generation_data, sampling_preset = _load_preset_bundle(preset_name, model_family)
        return ((model_bundle, generation_data, sampling_preset),)


class FlakeStack:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model_family": (_MODEL_FAMILIES, {"default": "SDXL/Base"}),
                "flake_data": ("FLAKE_DATA",),
                "flakes_json": ("STRING", {
                    "multiline": True,
                    "default": "[]",
                    "tooltip": "JSON-encoded list of flake entries. Managed by the Full Flakes widget.",
                }),
            },
        }

    RETURN_TYPES = ("FLAKE_DATA",)
    RETURN_NAMES = ("flake_data",)
    FUNCTION = "execute"
    CATEGORY = "flakes"
    DESCRIPTION = (
        "Compose flakes on top of an incoming flake_data bundle. "
        "Applies LoRAs, merges prompts, resolution overrides and ControlNets. "
        "Outputs updated flake_data for chaining into downstream nodes."
    )

    def execute(self, model_family: str, flake_data, flakes_json: str):
        model_bundle, generation_data, sampling_preset = flake_data
        model, clip, vae = model_bundle
        positive_cond, negative_cond, latent, width, height, pos_text, neg_text = generation_data[:7]
        steps, cfg, sampler, scheduler = sampling_preset

        # --- Filename prefix state ----------------------------------------------
        # Copy the incoming filename_state so we don't mutate the original tuple.
        # Preserve existing stems from upstream FlakeStack nodes so that stems
        # accumulate correctly across a chain of stacked nodes.
        if len(generation_data) > 7 and isinstance(generation_data[7], dict):
            filename_state = dict(generation_data[7])
            filename_state["stems"] = list(filename_state.get("stems", []))
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

        # --- Resolve flakes (skip bypassed) --------------------------------------
        active_entries = [e for i, e in enumerate(normalized) if not e.get("bypassed")]
        flakes = [flake_io.resolve(e) for e in active_entries]

        # --- Apply LoRAs --------------------------------------------------------
        lora_loader = LoraLoader()
        lora_entries = []
        for f in flakes:
            for lr in f.loras:
                if not lr.path:
                    continue
                lora_name = _resolve_lora_name(lr.path)
                model, clip = lora_loader.load_lora(model, clip, lora_name, lr.strength, lr.strength)
                lora_entries.append({"name": lr.name or lr.path, "path": lr.path, "strength": lr.strength})
            # Legacy single LoRA fallback
            if f.lora_path:
                lora_name = _resolve_lora_name(f.lora_path)
                model, clip = lora_loader.load_lora(model, clip, lora_name, f.strength, f.strength)
                lora_entries.append({"name": f.lora_path, "path": f.lora_path, "strength": f.strength})

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
                cn_resolved = _resolve_model_name("controlnet", cn.model_name)
                if cn_resolved not in cn_model_cache:
                    cn_model_cache[cn_resolved] = cn_loader.load_controlnet(cn_resolved)[0]
                cn_model = cn_model_cache[cn_resolved]
                image = _load_cn_image(cn.image_name)
                positive_cond, negative_cond = cn_apply.apply_controlnet(
                    positive_cond, negative_cond, cn_model, image,
                    cn.strength, cn.start_percent, cn.end_percent,
                )

        # --- Resolution (skip bypassed) ----------------------------------------
        new_width, new_height = width, height
        for f in flakes:
            if f.resolution is not None:
                new_width, new_height = f.resolution
                break

        if (new_width, new_height) != (width, height):
            latent = EmptyLatentImage().generate(new_width, new_height, 1)[0]

        # --- Lora metadata for Preview Flake Data ---------------------------------
        filename_state["loras"] = lora_entries

        # --- Filename prefix (skip bypassed) ------------------------------------
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
            (out_model_bundle, out_generation_data, out_sampling_preset),
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
