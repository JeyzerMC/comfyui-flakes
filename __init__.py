import os

import folder_paths

FLAKES_DIR = os.path.join(folder_paths.models_dir, "flakes")
os.makedirs(FLAKES_DIR, exist_ok=True)

if "flakes" in folder_paths.folder_names_and_paths:
    existing_paths, existing_exts = folder_paths.folder_names_and_paths["flakes"]
    if FLAKES_DIR not in existing_paths:
        existing_paths.append(FLAKES_DIR)
    existing_exts.update({".yaml", ".yml"})
else:
    folder_paths.folder_names_and_paths["flakes"] = ([FLAKES_DIR], {".yaml", ".yml"})

# Phase 4 — preset storage
PRESETS_DIR = os.path.join(folder_paths.models_dir, "flake_presets")
os.makedirs(PRESETS_DIR, exist_ok=True)

if "flake_presets" in folder_paths.folder_names_and_paths:
    existing_paths, existing_exts = folder_paths.folder_names_and_paths["flake_presets"]
    if PRESETS_DIR not in existing_paths:
        existing_paths.append(PRESETS_DIR)
    existing_exts.update({".yaml", ".yml"})
else:
    folder_paths.folder_names_and_paths["flake_presets"] = ([PRESETS_DIR], {".yaml", ".yml"})

from .flake_node import FlakeStack  # noqa: E402
from .full_flake_node import FullFlakes  # noqa: E402
from .flake_unpack_nodes import FlakesModel, FlakesCond, FlakesSampler  # noqa: E402
from . import flake_server  # noqa: E402,F401 — registers aiohttp routes on import

NODE_CLASS_MAPPINGS = {
    "FlakeStack": FlakeStack,
    "FullFlakes": FullFlakes,
    "FlakesModel": FlakesModel,
    "FlakesCond": FlakesCond,
    "FlakesSampler": FlakesSampler,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "FlakeStack": "Flake Stack",
    "FullFlakes": "Full Flakes",
    "FlakesModel": "Flakes Model",
    "FlakesCond": "Flakes Cond",
    "FlakesSampler": "Flakes Sampler",
}
WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
