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
        }

    RETURN_TYPES = ("MODEL", "CLIP", "CONDITIONING", "CONDITIONING", "LATENT", "INT", "INT")
    RETURN_NAMES = ("model", "clip", "positive", "negative", "latent", "width", "height")
    FUNCTION = "execute"
    CATEGORY = "flakes"
    DESCRIPTION = (
        "Applies an ordered list of flake presets between a checkpoint loader and a sampler. "
        "Block 0 is the inline default flake (its prompt/dimensions live in the workflow); "
        "subsequent blocks reference saved flakes from models/flakes/."
    )

    def execute(self, model, clip, flakes_json):
        try:
            entries = json.loads(flakes_json) if flakes_json else []
        except json.JSONDecodeError as exc:
            raise ValueError(f"flakes_json is not valid JSON: {exc}") from exc

        if not isinstance(entries, list):
            raise ValueError("flakes_json must be a JSON list of flake entries")

        normalized: list[dict] = []
        for i, entry in enumerate(entries):
            if not isinstance(entry, dict):
                logging.warning("[FlakeStack] skipping non-object entry %d: %r", i, entry)
                continue
            if entry.get("inline") or entry.get("name"):
                normalized.append(entry)
            else:
                logging.warning("[FlakeStack] skipping entry %d (needs 'name' or 'inline')", i)

        return flake_compose.compose(model, clip, normalized)
