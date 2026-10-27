# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Flake Animate** image-to-video for the **Wan 2.2** and **MiniMax H3**
  families: animate presets stored under `model_presets/video/<family>/`
  (#429), animate flakes with high/low LoRAs (#431), Flake Animate Preset and
  Preset Combo nodes (#430), and Flake Generate Animation, which samples the
  chain, optionally upscales and frame-interpolates, and saves an MP4 (with
  audio for MiniMax H3) shown in the node and the Generation Data overlay (#434).
- Flake options: named optional prompts (`prompt_options`) on a flake or
  variant choice, on or off by default, and a `toggler` on downstream flakes
  and choices (`-tails, face, +front`) that switches the options of every
  flake before it in the generation (#462).

## [0.2.0] - 2026-10-19

### Added

- LoRAs and Flake Links on model presets (#385, #386).
- "Applies by default" variant choices, with a "None" opt-out in the node
  option panel (#387, #388).
- Anima ControlNet Model dropdown: any LLLite file or the VACE depth file
  (#381), and console lines showing the patches applied (#382).
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
- Hook schedules (`schedule:` keyframes) for LoRAs, prompts and flake links,
  added from the card's ☰ menu in the flake editor (#369, #370, #372).
- Multiple prompts per flake (`prompts:` list; `prompt:` still read) (#369, #371).
- Live sampling previews in the Flake Generate node and overlay (#374).
- Anima VACE-Depth ControlNet through the ComfyUI-Advanced-ControlNet-Anima
  fork (#378).
- Flake Combo **Multiple** variant choices with Randomize, and an **All
  Variants** override that expands a flake into one generation per variant
  combo, shown as `[*]` on the grid item (#343, #345, #406, #421).
- Variant choices can contribute LoRAs, ControlNets and flake links, with LoRA
  name/URL, negative strength and strength overrides in the Stack / Combo
  dropdowns; flake links override the linked choice's strengths
  (#299, #404, #413, #414).
- New nodes: **Flake Inpaint** (#291), **Flake IPAdapter** (FaceID, #289).
- Flake Generate options: ADetailer Off/Face/A/B (#287, #327), upscaling
  (#288), `_ad_` / `_up_` output stem suffixes (#325, #326), and ComfyUI
  workflow metadata embedded in outputs (#344, #346).
- Flake links: multiple links per flake, a target picker and default overrides
  (#233, #234, #275).
- Per-instance model preset overrides (filename, steps, CFG, sampler,
  scheduler) in Flake Model Preset / Combo (#279, #292).
- Anima and Flux Klein model families (#286); ControlNet models are inferred
  from type and family (#246, #254).
- Flake Stack / Combo: per-item activate checkbox and toggle-all, duplicate
  button on grid items, drag & drop between nodes, and favorite flakes
  (#277, #314, #315, #316, #402, #415).
- Grid file picker with thumbnails and drive tabs for covers, ControlNet and
  variant images, and preset VAE / text encoder / diffusion model; flake-owned
  data is moved into the flake folder on save (#391, #392, #395, #396, #399).
- Double-click an output image in Flake Generate or the Generation Data overlay
  to reveal it on disk (#329, #340).
- Generation Data overlay: per-variant cards, image name and dimensions,
  ADetailer A/B toggle and Fit Output Image in View (#324, #345, #349, #390).

### Changed

- The Generation Data placeholder is a compact box with cards spread on both
  axes (#384).
- Ungenerated combinations in the Generation Data overlay show scattered cover
  cards instead of a split mosaic (#375).
- New Anima presets default to Euler Ancestral, Normal and the `QWEN_IMAGE`
  encoder type; family defaults now actually seed new presets (#376).
- Flake Edit uses a single "+ Add field" button, seeds default fields by flake
  type and adds a Serie field (#269, #272, #330, #331).
- Sampler and scheduler lists come from core ComfyUI KSampler (#285).
- Generate overlay layout: landscape outputs widen the panel, metadata collapses
  behind a toggle and the card stack fills the panel (#407, #408, #410, #411,
  #412, #417).
- Model families are defined once in `flake_families.py` instead of being
  duplicated across eight places in the Python and web layers (#355).

### Fixed

- Live previews never showed: ComfyUI sends none unless a preview method is set.
  Flake Generate prompts now request `auto` previews when the setting is
  `default` and the server has none (#380).
- Anima ControlNets took the SDXL path (no effect) when Flake Stack's family
  widget went stale behind a reroute or subgraph; the family now comes from the
  loaded preset (#382).
- New model presets default to the extra model path root instead of the
  ComfyUI install folder (#377).
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
- Bypassed or muted combo nodes are excluded from generation, nested combo
  batch loops follow graph order and the UI batch count multiplies combinations
  (#265, #304, #348).
- ControlNet fixes: models in subdirectories, hint image fits the generation
  frame, upstream ControlNets are kept when chaining Flake nodes, empty
  entries no longer crash (#243, #248, #251, #254, #255, #257).
- Combo highlights and overlay results survive tab switches, reordering and
  reconnects (#222, #241, #268, #373, #383).
- Preset editing: edits kept on reopen, base directory selection and extra-path
  saves preserved (#242, #245, #262, #267).
- Flake Data Split (Select) / Into Flake Data (Select) nodes could not be added
  or clicked (#208, #214, #215).
- Saving a flake whose folder or image is on another drive or junction (#396).

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

[Unreleased]: https://github.com/JeyzerMC/comfyui-flakes/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/JeyzerMC/comfyui-flakes/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/JeyzerMC/comfyui-flakes/releases/tag/v0.1.0
