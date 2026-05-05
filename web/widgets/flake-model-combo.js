import { css } from "../utils.js";
import { openPresetPicker } from "../pickers.js";

export function makeModelComboBlock({ preset, idx, isActive, onActivate, onRemove }) {
    const block = document.createElement("div");
    block.dataset.idx = String(idx);

    css(block, `position:relative;height:80px;background:${
        isActive ? "#2a4a3a" : "#2a2a2a"
    };border:2px solid ${
        isActive ? "#3a8a5a" : "#444"
    };border-radius:4px;cursor:pointer;font-size:11px;color:#ddd;user-select:none;box-sizing:border-box;background-image:url(/flakes/preset_cover?name=${encodeURIComponent(preset)});background-size:cover;background-position:center;`);

    // Dark overlay for cover readability
    const overlay = document.createElement("div");
    css(overlay, "position:absolute;inset:0;background:rgba(0,0,0,0.45);pointer-events:none;z-index:0;");
    block.appendChild(overlay);

    const nameEl = document.createElement("div");
    nameEl.title = preset;
    css(nameEl, "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:500;text-align:center;line-height:1.2;text-shadow:0 1px 3px rgba(0,0,0,0.8);padding:0 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;z-index:1;");
    nameEl.textContent = preset;
    block.appendChild(nameEl);

    if (isActive) {
        const check = document.createElement("div");
        check.textContent = "\u2713";
        css(check, "position:absolute;top:2px;left:2px;width:16px;height:16px;line-height:14px;text-align:center;font-size:10px;background:rgba(58,138,90,0.8);color:#fff;border-radius:2px;z-index:2;");
        block.appendChild(check);
    }

    const rm = document.createElement("button");
    rm.textContent = "\u2715";
    rm.title = "Remove from combo";
    css(rm, "position:absolute;top:2px;right:2px;width:16px;height:16px;line-height:14px;text-align:center;font-size:10px;background:rgba(0,0,0,0.5);color:#ddd;border:1px solid #555;border-radius:2px;cursor:pointer;padding:0;z-index:2;");
    rm.addEventListener("click", (e) => { e.stopPropagation(); onRemove(idx); });
    block.appendChild(rm);

    block.addEventListener("click", () => onActivate(idx));

    return block;
}

export function setupFlakeModelComboWidget(node) {
    const presetWidget = node.widgets?.find(w => w.name === "preset");
    const familyWidget = node.widgets?.find(w => w.name === "model_family");
    if (!presetWidget) return;

    // Hide the original ComfyUI combo widget
    presetWidget.computeSize = () => [0, -4];
    presetWidget.type = "hidden";
    presetWidget.hidden = true;
    if (presetWidget.element) { presetWidget.element.remove(); presetWidget.element = null; }
    if (presetWidget.inputEl) { presetWidget.inputEl.remove(); presetWidget.inputEl = null; }

    // Hide model_family combo widget
    if (familyWidget) {
        familyWidget.computeSize = () => [0, -4];
        familyWidget.type = "hidden";
        familyWidget.hidden = true;
        if (familyWidget.element) { familyWidget.element.remove(); familyWidget.element = null; }
        if (familyWidget.inputEl) { familyWidget.inputEl.remove(); familyWidget.inputEl = null; }
    }

    function getFamily() {
        return familyWidget?.value || "SDXL/Base";
    }

    if (!node.properties) node.properties = {};
    if (!node.properties._combo_presets) node.properties._combo_presets = [];
    if (node.properties._combo_active_index == null) node.properties._combo_active_index = 0;

    function readPresets() {
        return node.properties._combo_presets || [];
    }
    function writePresets(presets) {
        node.properties._combo_presets = presets;
        updateActivePreset();
    }
    function updateActivePreset() {
        const presets = readPresets();
        const idx = node.properties._combo_active_index || 0;
        const active = presets[idx] || "Select a preset...";
        presetWidget.value = active;
    }

    const container = document.createElement("div");
    css(container, "display:flex;flex-direction:column;gap:2px;padding:0 6px 3px 6px;font-size:12px;color:#ddd;");

    // Family dropdown
    const familyRow = document.createElement("div");
    css(familyRow, "display:flex;gap:8px;align-items:center;padding:4px 0;");
    const familyLabel = document.createElement("span");
    familyLabel.textContent = "Family:";
    css(familyLabel, "font-size:11px;color:#aaa;white-space:nowrap;");
    familyRow.appendChild(familyLabel);

    const familySelect = document.createElement("select");
    const FAMILIES = ["SDXL/Base", "SDXL/Illustrious", "SDXL/Pony", "ZImage/Base", "ZImage/Turbo"];
    for (const f of FAMILIES) {
        const opt = document.createElement("option");
        opt.value = f;
        opt.textContent = f;
        if (f === getFamily()) opt.selected = true;
        familySelect.appendChild(opt);
    }
    css(familySelect, "flex:1;background:#1a1a1a;color:#ddd;border:1px solid #444;padding:6px 10px;border-radius:4px;font-size:13px;line-height:1.4;cursor:pointer;outline:none;min-height:30px;");
    familySelect.addEventListener("change", () => {
        if (familyWidget) familyWidget.value = familySelect.value;
        render();
    });
    familySelect.addEventListener("mousedown", (e) => e.stopPropagation());
    familySelect.addEventListener("click", (e) => e.stopPropagation());
    familyRow.appendChild(familySelect);
    container.appendChild(familyRow);

    const grid = document.createElement("div");
    css(grid, "display:grid;grid-template-columns:repeat(auto-fill, minmax(72px, 1fr));gap:4px;");
    container.appendChild(grid);

    function render() {
        const presets = readPresets();
        const activeIdx = node.properties._combo_active_index || 0;
        grid.replaceChildren();

        for (let i = 0; i < presets.length; i++) {
            const blk = makeModelComboBlock({
                preset: presets[i],
                idx: i,
                isActive: i === activeIdx,
                onActivate: (idx) => {
                    node.properties._combo_active_index = idx;
                    updateActivePreset();
                    render();
                },
                onRemove: (idx) => {
                    const arr = readPresets();
                    arr.splice(idx, 1);
                    if (node.properties._combo_active_index >= arr.length) {
                        node.properties._combo_active_index = Math.max(0, arr.length - 1);
                    }
                    writePresets(arr);
                    render();
                },
            });
            grid.appendChild(blk);
        }

        const addBtn = document.createElement("div");
        css(addBtn, "position:relative;height:80px;background:#2a2a2a;border:1px dashed #555;border-radius:4px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;cursor:pointer;font-size:11px;color:#999;user-select:none;box-sizing:border-box;");
        const icon = document.createElement("div");
        css(icon, "font-size:20px;font-weight:300;color:#666;line-height:1;");
        icon.textContent = "+";
        addBtn.appendChild(icon);
        const label = document.createElement("div");
        css(label, "font-size:9px;text-align:center;");
        label.textContent = "Add preset";
        addBtn.appendChild(label);
        addBtn.addEventListener("click", async () => {
            const result = await openPresetPicker({ family: getFamily() });
            if (!result || !result.name) return;
            const arr = readPresets();
            if (arr.includes(result.name)) {
                window.alert("Preset already in combo");
                return;
            }
            arr.push(result.name);
            writePresets(arr);
            render();
        });
        grid.appendChild(addBtn);
    }

    node._model_combo_render = render;
    const comboWidget = node.addDOMWidget("model_combo_ui", "div", container, { serialize: false, margin: 4 });
    comboWidget.computeSize = () => {
        const rows = Math.max(1, Math.ceil((readPresets().length + 1) / 2));
        return [node.size[0], rows * 84 + 31];
    };
    updateActivePreset();
    render();
}
