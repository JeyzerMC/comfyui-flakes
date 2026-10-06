# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Generation support for the **Anima**, **Krea2** and **Z-Image** model families,
  which ship as a bare diffusion model plus a separate text encoder and VAE
  rather than an all-in-one checkpoint (#356, #357, #358).
  - New `Krea2/Turbo` family (folder `krea2`).
  - Preset fields `diffusion_model`, `clip_type` and `shift`, with a
    diffusion-model picker and text-encoder type dropdown in the preset editor
    (#357, #360).
  - New presets seed their sampler settings from the selected family (#356).
  - `GET /flakes/families`, `/flakes/diffusion_models` and `/flakes/clip_types`
    (#360).
  - **Requires ComfyUI v0.34 or newer** — `comfy/ldm/krea2/`,
    `comfy.text_encoders.anima`/`.krea2`/`.z_image` and `CLIPType.KREA2` do not
    exist in older releases.
- ControlNet support for **Anima** (ControlNet-LLLite) and **Z-Image** (Fun
  ControlNet Union). Both are model patches loaded from `models/model_patches/`
  and applied to the model rather than the conditioning; the flake ControlNet
  editor is unchanged and only lists the types the family supports
  (#363, #364, #365, #366).

### Fixed

- Z-Image flake ControlNets failed to load: the Fun ControlNet Union is a model
  patch, not a regular ControlNet (#365).

- A UNET-only checkpoint (how Anima, Krea2 and Z-Image are usually distributed,
  even when the file sits in `models/checkpoints/`) no longer fails on the first
  `CLIPTextEncode`. The loader detects the missing text encoder and VAE and takes
  them from the preset (#358).
- Standalone text encoders load through `comfy.sd.load_clip` with an explicit
  `CLIPType`, so `lumina2` and `krea2` encoders work at all (#358).
- `clip_skip` is no longer applied to Qwen-based text encoders, where it is
  meaningless and can raise (#359).
- The negative prompt is zeroed out when sampling at CFG ≤ 1, as distilled models
  require (#359).
- Missing files named by a preset now fail with an actionable error instead of
  being silently ignored and generating with the wrong components (#358).

### Changed

- Model families are defined once in `flake_families.py` instead of being
  duplicated across eight places in the Python and web layers (#355).

## [0.1.0] - 2026-05-19

First tagged release. ComfyUI Flakes is a custom-node pack for ComfyUI that turns
prompt fragments, LoRA stacks, resolutions, ControlNets, and sampler settings
into reusable on-disk presets ("flakes") composable from a grid UI between any
checkpoint loader and sampler.

### Added

#### Nodes

- **Flake Stack** — load and merge an ordered list of YAML flakes between a
  checkpoint loader and sampler; outputs `model`, `clip`, `positive`,
  `negative`, `latent`, `width`, `height`.
- **Flake Model Preset** — checkpoint + VAE + text encoder + sampling defaults
  bundled as a reusable preset, with cover image, override fields, and
  configurable output base path.
- **Flake Combo** / **Flake Model Combo** — frontend-queued batch nodes that
  iterate combinations of flakes and presets, with live `Jobs: N` indicator and
  active-combo highlighting during generation.
- **Flake Generate** — `KSampler` + `VAE Decode` + `Save Image` wrapper using
  the native ComfyUI seed widget, with read-only output-path display below the
  generated image.
- **Flake Data converter nodes** — `FlakeDataSplit`, `IntoFlakeDataSelect`,
  `FlakeDataSplitSelect` consolidate the per-flake outputs into a single
  `flake_data` pin and let downstream graphs pick which fields to expose with
  dynamic pin add/remove.
- **Preview Flake Data** — popup modal with a 2×2 grid of Models / Inputs /
  Prompts / ControlNets, robust against multiple ComfyUI frontend output
  shapes.

#### Flake format

- YAML-based flakes under `ComfyUI/models/flakes/`, with subfolder paths
  mapping to flake names.
- Optional fields: LoRA list (multiple per flake with name, URL, strength),
  positive/negative prompt fragments, resolution, ControlNets (type, model,
  image, strength, start/end percent), and **variant groups** for picking one
  prompt fragment per group from the UI.
- Per-variant choice images, optional Output Stem override, model-family
  classification.
- Prompts joined with `BREAK` between flakes so each flake acts as an
  independent CLIP region.

#### UI / UX

- Grid UI on Flake Stack: `+ New flake`, `↑ Load existing`, drag to reorder,
  double-click to edit, `✕` to remove from stack.
- Edit / New Flake overlay with optional fields, cover image, separate
  positive / negative prompt sections, multi-LoRA selector, ControlNet
  configuration with type dropdown and OS file picker, drag-to-reorder for
  optional fields, and unsaved-edit confirmation.
- Visual preset picker overlay with folder navigation, search bar, thumbnail
  grid, and model-family preselection.
- Inline hover buttons on grid items: Replace / Edit / Remove, LoRA-strength
  slider, options dropdown.
- Generation Data combination overlay merging Models and Inputs into a single
  preview surface with conditional half-panels per combo type.
- Bypassed-state toggle on Flake Type ribbon (diagonal hatching when
  disabled); bypassed flakes excluded from queue.
- Native ComfyUI seed widget for Flake Generate.
- Cover-image autoselection from sibling files of the checkpoint or first
  LoRA; double-click cover to open edit overlay.
- Custom dropdown control for searchable fields (replaces browser `datalist`).
- Single-click numerical slider editing; unified slider control across all
  numeric fields.

#### Infrastructure

- ComfyUI Manager publish workflow (`.github/workflows/publish.yml`).
- Python-backed file browser endpoints for correct base-path resolution
  across `models/checkpoints`, `models/loras`, `models/controlnet`,
  `models/flakes`, and `models/model_presets`.
- Logo and extension-overview assets under `assets/img/`.

### Changed

- Path field naming unified across modals; autocomplete listing removed in
  favor of the custom dropdown.
- Bundle nodes renamed from `Flakes*` to `Flake*` for consistency.
- Three pins `model_bundle` / `generation_data` / `sampling_preset` replaced
  with a single `flake_data` pin (with the converter nodes handling
  destructuring when needed).
- Flake field `options` renamed to `variants`.
- Preview surface: four preview buttons merged into two (Models + Inputs)
  showing the full upstream chain.
- Cover image scales with node width on resize.
- Clip Skip displayed as a positive value (CivitAI convention).
- Default Model Preset values: 832×1216, CFG 4, sampler `dpmpp_2m`.

### Fixed

- FlakeStack cache invalidated on inline edit and on new-flake creation.
- `filename_prefix` stems reset each execution to prevent recursive output
  paths; stems preserved across chained FlakeStack nodes; runtime overrides
  applied.
- `cover_image` preserved when editing a flake without changing its cover;
  no longer copies the image file (stores sibling path instead).
- Stray top-level `path` / `strength` no longer written to flake YAML.
- New flakes register under the family-prefixed name.
- Grid-item overrides reset when a flake's defaults change.
- Variant / ControlNet image buttons use the OS file picker.
- Output filename prefix label restyled to match Model Preset name.
- Duplicate-image render in FlakeGenerate prevented.
- Sampler / scheduler types use plain `SAMPLER` / `SCHEDULER` strings (fixes
  `FlakeDataSplitSelect` not creatable when `comfy.samplers` imports
  successfully).
- Bypassed flakes excluded from `FlakeCombo` job queue.
- Hover buttons stay square, don't overlap grid edges, and remain clickable
  above the options dropdown.
- Custom widgets preserved across configure / refresh (preview rebuilt from
  graph, Inputs button stays active).
- Option dropdown closes when clicking outside; opening one closes the
  others.
- Numerous overlay-layout fixes: full-path label realigned below Base / Cover
  rows, overlay width constrained, prompts section height reduced, dropdowns
  scaled with canvas zoom.

[Unreleased]: https://github.com/JeyzerMC/comfyui-flakes/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/JeyzerMC/comfyui-flakes/releases/tag/v0.1.0
