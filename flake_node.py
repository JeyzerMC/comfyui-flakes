from __future__ import annotations

import json
import logging

from . import flake_compose


class FlakeStack:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL",),
                "clip": ("CLIP",),
                "flakes_json": ("STRING", {
                    "multiline": True,
                    "default": "[]",
                    "tooltip": "JSON-encoded list of flake entries. Managed by the Flake Stack widget.",
                }),
            },
            "optional": {
                "base_positive": ("STRING", {"multiline": True, "default": ""}),
                "base_negative": ("STRING", {"multiline": True, "default": ""}),
                "default_width": ("INT", {"default": 1024, "min": 16, "max": 16384, "step": 8}),
                "default_height": ("INT", {"default": 1024, "min": 16, "max": 16384, "step": 8}),
            },
        }

    RETURN_TYPES = ("MODEL", "CLIP", "CONDITIONING", "CONDITIONING", "LATENT", "INT", "INT")
    RETURN_NAMES = ("model", "clip", "positive", "negative", "latent", "width", "height")
    FUNCTION = "execute"
    CATEGORY = "flakes"
    DESCRIPTION = "Applies an ordered list of flake presets (prompts + LoRA + resolution + controlnets) between a checkpoint loader and a sampler."

    def execute(self, model, clip, flakes_json,
                base_positive="", base_negative="",
                default_width=1024, default_height=1024):
        try:
            entries = json.loads(flakes_json) if flakes_json else []
        except json.JSONDecodeError as exc:
            raise ValueError(f"flakes_json is not valid JSON: {exc}") from exc

        if not isinstance(entries, list):
            raise ValueError("flakes_json must be a JSON list of flake entries")

        normalized: list[dict] = []
        for i, entry in enumerate(entries):
            if not isinstance(entry, dict) or not entry.get("name"):
                logging.warning("[FlakeStack] skipping entry %d (missing 'name'): %r", i, entry)
                continue
            normalized.append(entry)

        return flake_compose.compose(
            model, clip, normalized,
            base_positive, base_negative,
            int(default_width), int(default_height),
        )
