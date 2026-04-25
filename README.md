# ComfyUI Flakes

A single ComfyUI node — **Flake Stack** — that inserts an ordered list of reusable presets ("flakes") between a checkpoint loader and a sampler. Each flake bundles a prompt fragment, optional LoRA, optional target resolution, optional ControlNets, and optional named option groups (e.g. `outfit: winter | summer`).

The goal: keep your day-to-day workflow graphs unchanged while swapping characters, poses, and styles by editing a small list instead of rewiring nodes.

## Install

### Via ComfyUI Manager
Search for **ComfyUI Flakes** and install.

### Manual
```bash
cd ComfyUI/custom_nodes
git clone https://github.com/JeyzerMC/comfyui-flakes
```

PyYAML is the only external dependency and is already part of ComfyUI's core requirements.

## The node

**Flake Stack** (`category: flakes`) takes:

| Input             | Type      | Notes                                                                       |
| ----------------- | --------- | --------------------------------------------------------------------------- |
| `model`           | MODEL     | Output of a checkpoint loader.                                              |
| `clip`            | CLIP      | Same.                                                                       |
| `flakes_json`     | STRING    | Managed by the in-node UI — you don't edit this directly.                   |
| `base_positive`   | STRING    | Prepended to every flake's positive prompt (joined with ` BREAK `).         |
| `base_negative`   | STRING    | Appended to every flake's negative prompt.                                  |
| `default_width`   | INT       | Used when no flake declares a `resolution`.                                 |
| `default_height`  | INT       | Same.                                                                       |

It returns: `model, clip, positive, negative, latent, width, height` — wire those into your sampler.

The first flake in the stack that declares a `resolution` wins; otherwise `default_width × default_height` is used.

## Flake files

Flakes live as `.yaml` files under `ComfyUI/models/flakes/` (auto-created on first launch). The directory layout is freeform — subfolders become part of the flake name (e.g. `characters/musashi.yaml` → `characters/musashi`).

### Schema

```yaml
# Optional LoRA (filename or stem under ComfyUI/models/loras/)
path: my_lora_folder/vagabond_musashi
strength: 0.9

# Prompt fragments
prompt:
  positive: "1boy, miyamoto musashi, long wild black hair, fierce eyes, scarred face, weathered ronin, daito and wakizashi, sumi-e ink shading"
  negative: "modern clothing, suit, glasses, clean shaven youth, soft features"

# Optional fixed resolution (first flake with one wins)
resolution: [832, 1216]

# Optional named option groups; pick one variant per group from the UI
options:
  outfit:
    ronin:
      positive: "tattered kimono, frayed hakama, travelling cloak, dusty road"
      negative: ""
    shirtless:
      positive: "shirtless, muscular torso, hakama only, sweat, training in dojo"
      negative: ""

# Optional ControlNets — image stems live under ComfyUI/input/
controlnets:
  - type: openpose
    model: control_openpose_xl.safetensors   # under ComfyUI/models/controlnet/
    image: standing_openpose                  # .png/.jpg/.jpeg/.webp under ComfyUI/input/
    strength: 0.8
    start_percent: 0.0
    end_percent: 1.0
```

All keys are optional except a flake must contain *something* useful. A pure-prompt "quality base" flake is just a `prompt:` block.

### Joining behaviour

- **Between flakes** in the stack: positives are joined with ` BREAK `, negatives with `, `.
- **Within a flake** (option group additions to the base flake): joined with `, `.

This separation lets each flake act like an independent CLIP region while options layer modifiers onto a single flake.

## Folder layout example

```
ComfyUI/models/flakes/
├── styles/
│   └── quality_base.yaml
├── characters/
│   └── musashi.yaml
└── poses/
    └── standing.yaml
```

In the node UI, click **+ Add flake**, pick `styles/quality_base`, then `characters/musashi`, then `poses/standing`. Reorder with ↑/↓, set per-entry strength, and pick option variants from the dropdowns.

## License

MIT.
