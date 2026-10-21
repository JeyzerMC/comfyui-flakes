"""Flake Animate (image-to-video) nodes. They pass a ``FLAKE_ANIM_DATA`` dict
down the chain; encoding and sampling happen once in Flake Generate Animation."""
from __future__ import annotations

import dataclasses
import os

import nodes

from . import flake_families, flake_io
from .flake_compose import _load_lora
from .flake_io import _resolve_model_name
from .full_flake_node import _apply_preset_overrides, _join_prompts, _resolve_flakes

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


def _apply_anim_loras(models: dict, loras: list[flake_io.LoraEntry]) -> tuple[dict, list[dict]]:
    """Patch a copy of ``models`` with ``loras``, model-only: on Wan 2.2
    ``path`` goes to the high-noise model and ``path_low`` to the low-noise
    one; a single-model family takes ``path``. Also returns the applied
    LoRAs' filename_state entries."""
    models = dict(models)
    lora_entries = []
    for lr in loras:
        targets = {"high": lr.path, "low": lr.path_low} if "high" in models else {"model": lr.path}
        applied = {key: path for key, path in targets.items() if path}
        for key, path in applied.items():
            models[key] = _load_lora(models[key], None, path, lr.strength, 0)[0]
        if applied:
            lora_entries.append({"name": lr.name or lr.path or lr.path_low, "path": lr.path, "path_low": lr.path_low, "strength": lr.strength})
    return models, lora_entries


def _load_anim_preset_data(preset_name: str) -> dict:
    """Load an animate preset's models, text encoder and VAEs with the core
    loaders and apply its LoRAs (``_apply_anim_loras``)."""
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

    models, lora_entries = _apply_anim_loras(models, p.loras)

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


class FlakeAnimStack:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "family": ([f.label for f in flake_families.ANIM_FAMILIES],),
                "flake_anim_data": ("FLAKE_ANIM_DATA",),
                "flakes_json": ("STRING", {
                    "multiline": True,
                    "default": "[]",
                    "tooltip": "JSON-encoded list of animate flake entries. Managed by the Flake widget.",
                }),
            },
            "optional": {
                "image": ("IMAGE", {"tooltip": "Start image; replaces the one set upstream."}),
            },
        }

    RETURN_TYPES = ("FLAKE_ANIM_DATA",)
    RETURN_NAMES = ("flake_anim_data",)
    FUNCTION = "execute"
    CATEGORY = "flakes"
    DESCRIPTION = (
        "Compose animate flakes on top of an incoming flake_anim_data: applies their LoRAs to the "
        "diffusion model(s) and appends their prompts. Prompts are encoded in Flake Generate Animation."
    )

    def execute(self, family: str, flake_anim_data: dict, flakes_json: str, image=None):
        flakes = _resolve_flakes(flakes_json)
        # LoRA schedules are cond hooks and nothing is encoded here, so
        # animate flake LoRAs apply at their plain strength.
        models, lora_entries = _apply_anim_loras(flake_anim_data["models"], [lr for f in flakes for lr in f.loras])
        pos_text, neg_text = _join_prompts(flake_anim_data["pos_text"], flake_anim_data["neg_text"], flakes)
        filename_state = flake_anim_data["filename_state"]
        return ({
            **flake_anim_data,
            "models": models,
            "image": flake_anim_data["image"] if image is None else image,
            "pos_text": pos_text,
            "neg_text": neg_text,
            "filename_state": {
                **filename_state,
                "stems": filename_state["stems"] + [f.output_stem for f in flakes if f.output_stem],
                "loras": filename_state["loras"] + lora_entries,
            },
        },)


class FlakeAnimCombo(FlakeAnimStack):
    """Same backend as FlakeAnimStack; the frontend keeps one active flake in
    ``flakes_json`` per queued combination, like FlakeCombo."""
    pass
