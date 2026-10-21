"""Flake Animate (image-to-video) nodes. They pass a ``FLAKE_ANIM_DATA`` dict
down the chain; encoding and sampling happen once in Flake Generate Animation."""
from __future__ import annotations

import dataclasses
import os

import comfy.model_management
import folder_paths
import nodes
from comfy_api.latest import io

from . import flake_families, flake_io
from .flake_compose import _load_lora
from .flake_io import _resolve_model_name
from .full_flake_node import _apply_preset_overrides, _build_filename_prefix, _join_prompts, _resolve_flakes

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


# MiniMax H3 renders at a fixed 24 fps (FPS in comfy_extras/nodes_minimax_h3.py).
_MH3_FPS = 24


def _video_size(image, resolution: str, multiple: int) -> tuple[int, int]:
    """The preset's short edge (480p/580p/720p) at the start image's aspect,
    both sides rounded to ``multiple`` (Wan 2.2 takes 16, MiniMax H3 32)."""
    h, w = image.shape[1], image.shape[2]
    scale = int(resolution.rstrip("p")) / min(w, h)
    return max(multiple, round(w * scale / multiple) * multiple), max(multiple, round(h * scale / multiple) * multiple)


def _timing(family: str, preset: dict) -> tuple[int, int]:
    """Frame count to request and the video fps. Wan 2.2 takes 4k+1 frames at
    the preset fps; MiniMax H3 snaps the count to its own grid."""
    if family == "wan22":
        return round(preset["duration"] * preset["fps"] / 4) * 4 + 1, preset["fps"]
    return round(preset["duration"] * _MH3_FPS), _MH3_FPS


def _sample_wan22(data, seed, width, height, length):
    """High-noise model up to ``refiner_step``, low-noise model for the rest."""
    m = nodes.NODE_CLASS_MAPPINGS
    p = data["preset"]
    shift = m["ModelSamplingSD3"]()
    high = shift.patch(data["models"]["high"], p["shift_high"])[0]
    low = shift.patch(data["models"]["low"], p["shift_low"])[0]
    encode = m["CLIPTextEncode"]()
    positive, negative, latent = m["WanImageToVideo"].execute(
        encode.encode(data["clip"], data["pos_text"])[0], encode.encode(data["clip"], data["neg_text"])[0],
        data["vae"], width, height, length, 1, start_image=data["image"]).result
    ks = m["KSamplerAdvanced"]()
    sampling = (p["steps"], p["cfg"], p["sampler"], p["scheduler"], positive, negative)
    latent = ks.sample(high, "enable", seed, *sampling, latent, 0, p["refiner_step"], "enable")[0]
    latent = ks.sample(low, "disable", seed, *sampling, latent, p["refiner_step"], 10000, "disable")[0]
    return m["VAEDecode"]().decode(data["vae"], latent)[0], None


def _sample_mh3(data, seed, width, height, length):
    m = nodes.NODE_CLASS_MAPPINGS
    p = data["preset"]
    model = m["MiniMaxH3SigmaShift"].execute(data["models"]["model"], p["shift_video"], p["shift_audio"]).result[0]
    positive, latent = m["MiniMaxH3ImageToVideo"].execute(
        data["clip"], data["vae"], data["pos_text"], width, height, length, first_frame=data["image"]).result
    negative = m["CLIPTextEncode"]().encode(data["clip"], data["neg_text"])[0]
    latent = m["KSampler"]().sample(model, seed, p["steps"], p["cfg"], p["sampler"], p["scheduler"],
                                    positive, negative, latent, denoise=1.0)[0]
    # The AV latent decodes as is: VAEDecode reads its video half, VAEDecodeAudio its audio half.
    images = m["VAEDecode"]().decode(data["vae"], latent)[0]
    audio = m["VAEDecodeAudio"].execute(vae=data["audio_vae"], samples=latent).result[0]
    return images, audio


class FlakeGenerateAnimation:
    """Samples a FLAKE_ANIM_DATA chain into a video, optionally upscales and
    frame-interpolates it, and saves it with core Create Video / Save Video."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "flake_anim_data": ("FLAKE_ANIM_DATA",),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff, "control_after_generate": True}),
            },
            "optional": {
                "upscale": ("BOOLEAN", {"default": False, "label_on": "Upscale", "label_off": "Upscale off"}),
                "upscale_model": ([""] + folder_paths.get_filename_list("upscale_models"), {"default": ""}),
                "interpolate": ("BOOLEAN", {"default": False, "label_on": "Interpolate", "label_off": "Interpolate off"}),
                "interpolation_model": ([""] + folder_paths.get_filename_list("frame_interpolation"), {
                    "default": "", "tooltip": "Doubles the frame count and the fps."}),
                "use_headroom": ("BOOLEAN", {"default": False, "label_on": "Headroom", "label_off": "Headroom off"}),
                "headroom": ("FLOAT", {
                    "default": 0.0, "min": 0.0, "max": 64.0, "step": 0.5,
                    "tooltip": "GB of VRAM kept free while sampling and decoding, on top of ComfyUI's reserve."}),
            },
            "hidden": {
                "prompt": "PROMPT",
                "extra_pnginfo": "EXTRA_PNGINFO",
            },
        }

    RETURN_TYPES = ()
    FUNCTION = "execute"
    CATEGORY = "flakes"
    DESCRIPTION = "Generate a video from FLAKE_ANIM_DATA and its start image, then save it as MP4. Displays the result inline."
    OUTPUT_NODE = True

    def execute(self, flake_anim_data, seed, upscale=False, upscale_model="", interpolate=False, interpolation_model="",
                use_headroom=False, headroom=0.0, prompt=None, extra_pnginfo=None):
        data = flake_anim_data
        if data["image"] is None:
            raise ValueError("Flake Generate Animation has no start image — connect an image to a Flake Animate Stack/Combo.")
        if upscale and not upscale_model:
            raise ValueError("Flake Generate Animation: Upscale is on but no upscale_model is selected.")
        if interpolate and not interpolation_model:
            raise ValueError("Flake Generate Animation: Interpolate is on but no interpolation_model is selected.")
        family, preset = data["family"], data["preset"]
        width, height = _video_size(data["image"], preset["resolution"], 16 if data["family"] == "wan22" else 32)
        length, fps = _timing(family, preset)
        sample = _sample_wan22 if family == "wan22" else _sample_mh3

        reserved = comfy.model_management.EXTRA_RESERVED_VRAM
        comfy.model_management.EXTRA_RESERVED_VRAM = reserved + (int(headroom * 1024 ** 3) if use_headroom else 0)
        try:
            images, audio = sample(data, seed, width, height, length)
        finally:
            comfy.model_management.EXTRA_RESERVED_VRAM = reserved

        m = nodes.NODE_CLASS_MAPPINGS
        if upscale:
            model = m["UpscaleModelLoader"].execute(upscale_model).result[0]
            images = m["ImageUpscaleWithModel"].execute(model, images).result[0]
        if interpolate:
            model = m["FrameInterpolationModelLoader"].execute(interpolation_model).result[0]
            images = m["FrameInterpolate"].execute(model, images, 2).result[0]
            fps *= 2

        video = m["CreateVideo"].execute(images, fps, audio).result[0]
        fs = data["filename_state"]
        save = m["SaveVideo"].PREPARE_CLASS_CLONE(
            {"hidden_inputs": {io.Hidden.prompt: prompt, io.Hidden.extra_pnginfo: extra_pnginfo}})
        saved = save.execute(video, _build_filename_prefix(fs["preset"], fs["stems"]), "mp4").ui.as_dict()["images"]
        return {"ui": {"flake_videos": saved, "seed": [seed]}}
