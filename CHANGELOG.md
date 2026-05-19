# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
