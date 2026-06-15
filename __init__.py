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

PRESETS_DIR = os.path.join(FLAKES_DIR, "model_presets")
os.makedirs(PRESETS_DIR, exist_ok=True)

if "model_presets" in folder_paths.folder_names_and_paths:
    existing_paths, existing_exts = folder_paths.folder_names_and_paths["model_presets"]
    if PRESETS_DIR not in existing_paths:
        existing_paths.append(PRESETS_DIR)
    existing_exts.update({".yaml", ".yml"})
else:
    folder_paths.folder_names_and_paths["model_presets"] = ([PRESETS_DIR], {".yaml", ".yml"})

from .full_flake_node import FlakeModelPreset, FlakeStack, FlakeCombo, FlakeModelCombo  # noqa: E402
from .flake_data_nodes import FlakeDataSplitAll, FlakeDataSplitSelect, IntoFlakeDataAll, IntoFlakeDataSelect, PreviewFlakeData, FlakeGenerate  # noqa: E402
from .flake_extra_nodes import FlakeIPAdapter  # noqa: E402
from . import flake_server  # noqa: E402,F401 — registers aiohttp routes on import

NODE_CLASS_MAPPINGS = {
    "FlakeModelPreset": FlakeModelPreset,
    "FlakeStack": FlakeStack,
    "FlakeCombo": FlakeCombo,
    "FlakeModelCombo": FlakeModelCombo,
    "FlakeDataSplitAll": FlakeDataSplitAll,
    "FlakeDataSplitSelect": FlakeDataSplitSelect,
    "IntoFlakeDataAll": IntoFlakeDataAll,
    "IntoFlakeDataSelect": IntoFlakeDataSelect,
    "PreviewFlakeData": PreviewFlakeData,
    "FlakeGenerate": FlakeGenerate,
    "FlakeIPAdapter": FlakeIPAdapter,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "FlakeModelPreset": "Flake Model Preset",
    "FlakeStack": "Flake Stack",
    "FlakeCombo": "Flake Combo",
    "FlakeModelCombo": "Flake Model Combo",
    "FlakeDataSplitAll": "Flake Data Split (All)",
    "FlakeDataSplitSelect": "Flake Data Split (Select)",
    "IntoFlakeDataAll": "Into Flake Data (All)",
    "IntoFlakeDataSelect": "Into Flake Data (Select)",
    "PreviewFlakeData": "Preview Flake Data",
    "FlakeGenerate": "Flake Generate",
    "FlakeIPAdapter": "Flake IPAdapter",
}
WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
