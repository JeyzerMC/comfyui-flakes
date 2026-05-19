![ComfyUI Flakes](assets/img/logo_flakes.png)

> Reusable prompt presets — swap characters, styles, and poses without rewiring your workflow.

<!-- TODO: replace with your description -->
_Description coming soon._

<!-- TODO: add a screenshot/gif of an example workflow here -->
<!-- ![Example workflow](docs/workflow_example.png) -->
![Extension Overview](assets/img/extension_overview.png)

---

## Installation

**Via ComfyUI Manager** (Recommended)

Search for **ComfyUI Flakes** and click Install.

**Manual**

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/JeyzerMC/comfyui-flakes
```

No extra dependencies — PyYAML is already part of ComfyUI's core.

---

## Nodes

### Flake Stack

Sits between your checkpoint loader and sampler. Loads an ordered list of **flakes** (YAML presets), merges their prompts and LoRAs, and outputs everything the sampler needs.

<!-- TODO: add a gif/image of the Flake Stack node in action -->
<!-- ![Flake Stack demo](docs/flake_stack.gif) -->

**Inputs** — `model`, `clip`  
**Outputs** — `model`, `clip`, `positive`, `negative`, `latent`, `width`, `height`

The built-in grid UI lets you:

- **`+ New flake`** — create and save a new flake to `models/flakes/`
- **`↑ Load existing`** — add an on-disk flake to the stack
- **Double-click a block** — edit; changes to saved flakes write back to disk
- **Drag** blocks to reorder
- **`✕`** — remove from stack (file is kept; use the modal's **Delete** to remove it)

The first flake declaring a `resolution` wins; default is **1024 × 1024**.

#### Flake file format

Flakes are `.yaml` files under `ComfyUI/models/flakes/`. Subfolders become part of the name (`characters/musashi.yaml` → `characters/musashi`).

```yaml
# LoRA (optional)
path: my_loras/musashi
strength: 0.9

# Prompt fragments
prompt:
  positive: "1boy, miyamoto musashi, long wild black hair"
  negative: "modern clothing, glasses"

# Resolution (optional — first flake with one wins)
resolution: [832, 1216]

# Variant groups (optional — pick one per group from the UI)
variants:
  outfit:
    ronin:
      positive: "tattered kimono, frayed hakama"
    shirtless:
      positive: "shirtless, hakama only"

# ControlNets (optional)
controlnets:
  - type: openpose
    model: control_openpose_xl.safetensors
    image: standing_openpose
    strength: 0.8
    start_percent: 0.0
    end_percent: 1.0
```

Prompts are joined with `BREAK` between flakes so each flake acts as an independent CLIP region.

---

## Roadmap

- [ ] _Planned items go here_

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for the full release history. This project follows [Semantic Versioning](https://semver.org/) and the format from [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## License

[MIT](LICENSE)
