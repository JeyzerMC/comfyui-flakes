## Flake Model Preset buttons

The buttons `Select Preset` and `Create Preset` in the `Flake Model Preset` node do not share the same styling as what the `Flake Stack` has. I need you to make sure the two buttons have the exact same styling as the `Add Flake` button on the `Flake Stack` node. 

## Preset buttons does not work

The button `Create Preset` and `Select Preset` do nothing presently if I don't have existing presets. I can't create new presets. 

## Model family selection

Right now, the Flake node system is designed only for SDXL based architectures. 

Add a dropdown for the `Flake Model Preset`, `Flake Stack` and both `Combo` nodes to select a model family. Model families can be SDXL/Base, SDXL/Illustrious, SDXL/Pony, ZImage/Base, ZImage/Turbo.

When creating a preset or a lora, add an dropdown above the path option to specify the model family. The flake or preset will then be saved under a folder (+ path specified) specific to that family. 

Here's the mapping of family to top level folder within their type:

- SDXL/Base -> sdxl
- SDXL/Illustrious -> illustrious
- SDXL/Pony -> pony
- ZImage/Base -> zib
- ZImage/Turbo -> zit
- Common -> common (Not model specific)

So a flake created for a Illustrious character lora will have the model family SDXL/Illustrious and the path value will be `characters/<character_name>`. The flake on disk will reside in `<comfy_dir>/models/flakes/img/illustrious/characters/<character_name>.yaml`.

So a flake created for a SDXL/Base character lora will have the model family SDXL/Base and the path value will be `characters/<character_name>`. The flake on disk will reside in `<comfy_dir>/models/flakes/img/sdxl/characters/<character_name>.yaml`.

For a model preset for an SDXL/Illustrious checkpoint, the preset yaml will be saved under `<comfy_dir>/models/flakes/model_presets/illustrious/<preset_name>.yaml`.

For a model preset for an SDXL/Base checkpoint, the preset yaml will be saved under
`<comfy_dir>/models/flakes/model_presets/sdxl/<preset_name>.yaml`.

### Flakes filter

SDXL derived flakes are only compatible with SDXL families, so in the `Flake Stack` node for example, if I select `SDXL/Pony` for example in the dropdown, it will only show me flakes residing inside `common/`, `sdxl`, and `pony` directories (SDXL/Base flakes are compatible with both Illustrious and Pony but not ZImage ones). If I select `SDXL/Base`, then only `common` and `sdxl` flakes will be shown when adding flakes. Same logic for model presets.