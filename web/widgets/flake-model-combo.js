import {
    css, ensureDefault,
    _showDropIndicator, _hideDropIndicator, _hideAllDropIndicators,
} from "../utils.js";
import { openPresetPicker } from "../pickers.js";
import { fetchPreset } from "../api.js";

function svgIcon(d, w = 14) {
    const tpl = document.createElement("template");
    tpl.innerHTML = `<svg width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
    return tpl.content.firstChild;
}

export function makeModelComboBlock({ preset, display_name, idx, isActive, onActivate, onRemove, onReplace, onEdit, onDragStart, onDragOver, onDrop, onDragEnd }) {
    const block = document.createElement("div");
    block.dataset.idx = String(idx);

    css(block, `position:relative;height:80px;background:#2a2a2a;border:1px solid #444;border-radius:4px;cursor:pointer;font-size:11px;color:#ddd;user-select:none;box-sizing:border-box;overflow:hidden;background-image:url(/flakes/preset_cover?name=${encodeURIComponent(preset)});background-size:cover;background-position:center;`);

    // Dark overlay for cover readability
    const overlay = document.createElement("div");
    css(overlay, "position:absolute;inset:0;background:rgba(0,0,0,0.45);pointer-events:none;z-index:0;border-radius:3px;");
    block.appendChild(overlay);

    // Name — show display_name (falling back to last part of path)
    const fullName = display_name || preset.split(/[\/\\]+/).pop() || preset;
    const nameEl = document.createElement("div");
    nameEl.title = preset;
    css(nameEl, "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:500;text-align:center;line-height:1.2;text-shadow:0 1px 3px rgba(0,0,0,0.8);padding:0 4px;overflow:hidden;z-index:1;word-break:break-word;hyphens:auto;border-radius:3px;");
    nameEl.textContent = fullName;
    block.appendChild(nameEl);

    // Draggable for reorder
    block.draggable = true;
    block.style.cursor = "grab";
    block.addEventListener("dragstart", (e) => {
        if (e.target && e.target !== block && e.target.tagName === "BUTTON") {
            e.preventDefault();
            return;
        }
        block.style.cursor = "grabbing";
        onDragStart(e, idx, block);
    });
    block.addEventListener("dragend", () => {
        block.style.cursor = "grab";
        onDragEnd(block);
    });

    // Hover button group: Replace / Edit / Remove
    const hoverWrap = document.createElement("div");
    css(hoverWrap, "position:absolute;inset:0;display:none;align-items:center;justify-content:center;gap:6px;z-index:3;background:rgba(0,0,0,0.35);border-radius:3px;");

    const HOVER_BTN = "width:22px;height:22px;padding:0;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.92);color:#222;border:none;border-radius:4px;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,0.5);";

    const replaceBtn = document.createElement("button");
    replaceBtn.title = "Replace Preset";
    replaceBtn.appendChild(svgIcon(`<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>`));
    css(replaceBtn, HOVER_BTN);
    replaceBtn.addEventListener("click", (e) => { e.stopPropagation(); onReplace(idx); });
    hoverWrap.appendChild(replaceBtn);

    const editBtn = document.createElement("button");
    editBtn.title = "Edit Preset";
    editBtn.appendChild(svgIcon(`<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>`));
    css(editBtn, HOVER_BTN);
    editBtn.addEventListener("click", (e) => { e.stopPropagation(); onEdit(idx); });
    hoverWrap.appendChild(editBtn);

    const removeBtn = document.createElement("button");
    removeBtn.title = "Remove from Combo";
    removeBtn.appendChild(svgIcon(`<circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/>`));
    css(removeBtn, HOVER_BTN);
    removeBtn.addEventListener("click", (e) => { e.stopPropagation(); onRemove(idx); });
    hoverWrap.appendChild(removeBtn);

    block.appendChild(hoverWrap);
    block.addEventListener("mouseenter", () => { hoverWrap.style.display = "flex"; });
    block.addEventListener("mouseleave", () => { hoverWrap.style.display = "none"; });

    block.addEventListener("dblclick", () => onEdit(idx));
    block.addEventListener("dragover", (e) => onDragOver(e, idx, block));
    block.addEventListener("dragleave", () => { block.style.outline = ""; block.style.boxShadow = ""; });
    block.addEventListener("drop", (e) => onDrop(e, idx, block));

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

    function getFamily() {
        return familyWidget?.value || "SDXL/Base";
    }

    if (!node.properties) node.properties = {};
    if (!node.properties._combo_presets) node.properties._combo_presets = [];
    if (node.properties._combo_active_index == null) node.properties._combo_active_index = 0;
    if (!node.properties._combo_display_names) node.properties._combo_display_names = {};

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

    async function fetchDisplayName(presetName) {
        try {
            const data = await fetchPreset(presetName);
            return data.display_name || data.name || presetName;
        } catch {
            return presetName.split(/[\/\\]+/).pop();
        }
    }

    const container = document.createElement("div");
    css(container, "display:flex;flex-direction:column;gap:2px;padding:0 6px 3px 6px;font-size:12px;color:#ddd;");

    const grid = document.createElement("div");
    css(grid, "display:grid;grid-template-columns:repeat(auto-fill, minmax(72px, 1fr));gap:4px;");
    container.appendChild(grid);

    let dragSrcIdx = null;

    function render() {
        const presets = readPresets();
        const activeIdx = node.properties._combo_active_index || 0;
        grid.replaceChildren();

        for (let i = 0; i < presets.length; i++) {
            const displayName = node.properties._combo_display_names[presets[i]] || presets[i].split(/[\/\\]+/).pop();
            const blk = makeModelComboBlock({
                preset: presets[i],
                display_name: displayName,
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
                onReplace: async (idx) => {
                    const result = await openPresetPicker({ family: getFamily() });
                    if (!result || !result.name) return;
                    const arr = readPresets();
                    arr[idx] = result.name;
                    const name = await fetchDisplayName(result.name);
                    node.properties._combo_display_names[result.name] = name;
                    writePresets(arr);
                    render();
                },
                onEdit: async (idx) => {
                    const presetName = readPresets()[idx];
                    if (!presetName) return;
                    const { openPresetEditModal } = await import("../preset-modal.js");
                    const data = await fetchPreset(presetName);
                    const result = await openPresetEditModal({ mode: "edit", name: presetName, data });
                    if (result) {
                        const name = await fetchDisplayName(presetName);
                        node.properties._combo_display_names[presetName] = name;
                        render();
                    }
                },
                onDragStart: (e, idx, el) => {
                    dragSrcIdx = idx;
                    e.dataTransfer.effectAllowed = "move";
                    el.style.opacity = "0.4";
                },
                onDragOver: (e, idx, el) => {
                    if (dragSrcIdx === null || idx === dragSrcIdx) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    _showDropIndicator(el);
                },
                onDrop: (e, idx, el) => {
                    e.preventDefault();
                    _hideDropIndicator(el);
                    if (dragSrcIdx === null || idx === dragSrcIdx) return;
                    const arr = readPresets();
                    const [moved] = arr.splice(dragSrcIdx, 1);
                    let insertIdx = idx;
                    if (dragSrcIdx < idx) insertIdx--;
                    arr.splice(insertIdx, 0, moved);
                    if (node.properties._combo_active_index === dragSrcIdx) {
                        node.properties._combo_active_index = insertIdx;
                    } else if (node.properties._combo_active_index > dragSrcIdx && node.properties._combo_active_index <= idx) {
                        node.properties._combo_active_index--;
                    }
                    writePresets(arr);
                    dragSrcIdx = null;
                    render();
                },
                onDragEnd: (el) => {
                    el.style.opacity = "";
                    dragSrcIdx = null;
                    _hideAllDropIndicators();
                },
            });
            grid.appendChild(blk);

            // Fetch display name asynchronously
            fetchDisplayName(presets[i]).then(name => {
                if (node.properties._combo_display_names[presets[i]] !== name) {
                    node.properties._combo_display_names[presets[i]] = name;
                    // Update the name element if it's still in the DOM
                    const nameEl = blk.querySelector("[title]");
                    if (nameEl && nameEl.textContent !== name) {
                        nameEl.textContent = name;
                    }
                }
            });
        }

        const addBtn = document.createElement("div");
        css(addBtn, "position:relative;height:80px;background:#2a2a2a;border:1px dashed #555;border-radius:4px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;cursor:pointer;font-size:11px;color:#999;user-select:none;box-sizing:border-box;");
        addBtn.draggable = false;
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
            arr.push(result.name);
            const name = await fetchDisplayName(result.name);
            node.properties._combo_display_names[result.name] = name;
            writePresets(arr);
            render();
        });

        addBtn.addEventListener("dragover", (e) => {
            if (dragSrcIdx === null) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            _showDropIndicator(addBtn);
        });
        addBtn.addEventListener("dragleave", () => {
            _hideDropIndicator(addBtn);
        });
        addBtn.addEventListener("drop", (e) => {
            e.preventDefault();
            _hideDropIndicator(addBtn);
            if (dragSrcIdx === null) return;
            const arr = readPresets();
            const [moved] = arr.splice(dragSrcIdx, 1);
            arr.push(moved);
            writePresets(arr);
            dragSrcIdx = null;
            render();
        });

        grid.appendChild(addBtn);
    }

    // React to native family widget changes
    if (familyWidget) {
        const origCallback = familyWidget.callback;
        familyWidget.callback = function (value) {
            const r = origCallback?.apply(this, arguments);
            render();
            return r;
        };
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