"""Flake Animate (image-to-video) nodes. They pass a ``FLAKE_ANIM_DATA`` dict
down the chain; encoding and sampling happen once in Flake Generate Animation."""
from __future__ import annotations

import dataclasses
import os

import nodes

from . import flake_families, flake_io
from .flake_compose import _load_lora
from .flake_io import _resolve_model_name
from .full_flake_node import _apply_preset_overrides

_PLACEHOLDERS = ("Select a preset...", "No model preset is selected")

# FLAKE_ANIM_DATA["models"] key -> AnimPreset field, per family folder.
_MODEL_FIELDS = {
    "wan22": {"high": "diffusion_model_high", "low": "diffusion_model_low"},
    "mh3": {"model": "diffusion_model"},
}


def _model_file(category: str, preset, field: str) -> str:
    ref = getattr(preset, field)
    if not ref:
        raise ValueError(f"Animate preset '{preset.name}' has no '{field}' set — pick one in the preset editor.")
    return _resolve_model_name(category, ref)


def _load_anim_preset_data(preset_name: str) -> dict:
    """Load an animate preset's models, text encoder and VAEs with the core
    loaders and apply its LoRAs: on Wan 2.2 ``path`` patches the high-noise
    model and ``path_low`` the low-noise one."""
    p = flake_io.load_anim_preset(preset_name)
    spec = flake_families.ANIM_BY_FOLDER[p.family]
    loaders = nodes.NODE_CLASS_MAPPINGS
    unet = loaders["UNETLoader"]()
    models = {
        key: unet.load_unet(_model_file("diffusion_models", p, field), "default")[0]
        for key, field in _MODEL_FIELDS[p.family].items()
    }
    clip = loaders["CLIPLoader"]().load_clip(_model_file("text_encoders", p, "text_encoder"), p.clip_type.lower())[0]
    vae_loader = loaders["VAELoader"]()
    vae = vae_loader.load_vae(_model_file("vae", p, "vae"))[0]
    audio_vae = vae_loader.load_vae(_model_file("vae", p, "audio_vae"))[0] if p.family == "mh3" else None

    lora_entries = []
    for lr in p.loras:
        targets = {"high": lr.path, "low": lr.path_low} if "high" in models else {"model": lr.path}
        applied = {key: path for key, path in targets.items() if path}
        for key, path in applied.items():
            models[key] = _load_lora(models[key], None, path, lr.strength, 0)[0]
        if applied:
            lora_entries.append({"name": lr.name or lr.path or lr.path_low, "path": lr.path, "path_low": lr.path_low, "strength": lr.strength})

    stems = [f"anim/{p.family}/"]
    if p.filename_prefix.strip():
        stems.append(p.filename_prefix.strip())
    return {
        "family": p.family,
        "preset": dataclasses.asdict(p),
        "models": models,
        "clip": clip,
        "vae": vae,
        "audio_vae": audio_vae,
        "image": None,
        "pos_text": p.positive.strip(),
        "neg_text": p.negative.strip(),
        "filename_state": {
            "preset": "",
            "stems": stems,
            "checkpoint": p.diffusion_model or p.diffusion_model_high,
            "vae": p.vae,
            "text_encoder": p.text_encoder,
            "loras": lora_entries,
            "model_family": spec.label,
        },
    }


def _apply_anim_overrides(overrides_json: str, data: dict) -> dict:
    """Per-instance steps/cfg/sampler/scheduler/filename_prefix overrides, read
    the same way as the image presets' (``_apply_preset_overrides``)."""
    preset = data["preset"]
    _, generation_data, sampling = _apply_preset_overrides(
        overrides_json, None, (None,) * 7 + (data["filename_state"],),
        (preset["steps"], preset["cfg"], preset["sampler"], preset["scheduler"], 1.0),
    )
    steps, cfg, sampler, scheduler, _ = sampling
    return {
        **data,
        "preset": {**preset, "steps": steps, "cfg": cfg, "sampler": sampler, "scheduler": scheduler},
        "filename_state": generation_data[7],
    }


class FlakeAnimPreset:
    @classmethod
    def INPUT_TYPES(cls):
        try:
            preset_names = flake_io.list_presets(kind="anim")
        except Exception:
            preset_names = []
        if not preset_names:
            preset_names = ["No model preset is selected"]
        return {
            "required": {
                "family": ([f.label for f in flake_families.ANIM_FAMILIES],),
                "preset": (["Select a preset..."] + preset_names,),
            },
            "optional": {
                "overrides_json": ("STRING", {
                    "default": "",
                    "multiline": True,
                    "tooltip": "JSON override of steps/cfg/sampler/scheduler/filename_prefix. Managed by the Flake widget.",
                }),
            },
        }

    RETURN_TYPES = ("FLAKE_ANIM_DATA",)
    RETURN_NAMES = ("flake_anim_data",)
    FUNCTION = "execute"
    CATEGORY = "flakes"
    DESCRIPTION = (
        "Load an animate preset (diffusion models, text encoder, VAEs, LoRAs, prompts, sampling and "
        "video settings) into a flake_anim_data pin for the Flake Animate nodes."
    )

    @classmethod
    def IS_CHANGED(cls, family: str, preset: str, overrides_json: str = ""):
        # Re-run when the preset file changes on disk, like FlakeModelPreset.
        preset_name = preset.strip() if preset else ""
        if not preset_name or preset_name in _PLACEHOLDERS:
            return f"{preset_name}:{overrides_json}"
        try:
            path = flake_io._resolve_preset_file(preset_name)
            st = os.stat(path)
            return f"{path}:{st.st_mtime_ns}:{st.st_size}:{overrides_json}"
        except Exception:
            return float("nan")

    def execute(self, family: str, preset: str, overrides_json: str = ""):
        preset_name = preset.strip() if preset else ""
        if not preset_name or preset_name in _PLACEHOLDERS:
            raise ValueError("No animate preset is selected — pick one from the dropdown.")
        return (_apply_anim_overrides(overrides_json, _load_anim_preset_data(preset_name)),)


class FlakeAnimPresetCombo(FlakeAnimPreset):
    """Same backend as FlakeAnimPreset; the frontend rotates the ``preset``
    widget over its list when queueing, like FlakeModelCombo."""
    pass
