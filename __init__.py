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

from .full_flake_node import FlakeModelPreset, FlakeStack, FlakeCombo, FlakeModelCombo  # noqa: E402
from .flake_unpack_nodes import FlakesModel, FlakesCond, FlakesSampler  # noqa: E402
from . import flake_server  # noqa: E402,F401 — registers aiohttp routes on import

NODE_CLASS_MAPPINGS = {
    "FlakeModelPreset": FlakeModelPreset,
    "FlakeStack": FlakeStack,
    "FlakeCombo": FlakeCombo,
    "FlakeModelCombo": FlakeModelCombo,
    "FlakesModel": FlakesModel,
    "FlakesCond": FlakesCond,
    "FlakesSampler": FlakesSampler,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "FlakeModelPreset": "Flake Model Preset",
    "FlakeStack": "Flake Stack",
    "FlakeCombo": "Flake Combo",
    "FlakeModelCombo": "Flake Model Combo",
    "FlakesModel": "Flakes Model Split",
    "FlakesCond": "Flakes Generation Data",
    "FlakesSampler": "Flakes Sampling Values",
}
WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
