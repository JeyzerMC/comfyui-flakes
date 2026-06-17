import {
    css, svgIcon, makeGridItemOverlay, makeHoverButton, makeBypassStrike,
    _showDropIndicator, _hideDropIndicator, _hideAllDropIndicators, attachHoldToSingleOut, makeAddBlock,
    makeModelOverridePanel, serializeModelOverrides,
} from "../utils.js";
import { openPresetPicker } from "../pickers.js";
import { openPresetEditModal, refreshPresetOptions } from "../preset-modal.js";
import { fetchPreset } from "../api.js";

export function makeModelComboBlock({ preset, display_name, idx, isActive, isBypassed, isGenerating, overrides, onOverrideChange, onActivate, onToggleBypass, onSingleOut, onRemove, onReplace, onEdit, onDragStart, onDragOver, onDrop, onDragEnd }) {
    const block = document.createElement("div");
    block.dataset.idx = String(idx);

    // No overflow:hidden — it would clip the top:100% override panel (the cause of
    // the "arrow does nothing" bug). The rounded background still clips to the
    // border-radius. Mirrors the Flake Stack grid block (#303).
    css(block, `position:relative;height:80px;background:#2a2a2a;border:${
        isGenerating ? "2px solid #4a9eff" : "1px solid #444"
    };border-radius:4px;cursor:pointer;font-size:11px;color:#ddd;user-select:none;box-sizing:border-box;background-image:url(/flakes/preset_cover?name=${encodeURIComponent(preset)});background-size:cover;background-position:center;${
        isGenerating ? "box-shadow:inset 0 0 0 2px rgba(74,158,255,0.7);" : ""
    }${isBypassed ? "opacity:0.45;" : ""}`);

    // Dark overlay, hover buttons, and triangle dropdown (override panel, #279).
    const { triangleBtn } = makeGridItemOverlay({
        block,
        showHoverButtons: true,
        buttons: [
            makeHoverButton({ svg: `<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>`, title: "Replace Preset", onClick: () => onReplace(idx) }),
            makeHoverButton({ svg: `<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>`, title: "Edit Preset", onClick: () => onEdit(idx) }),
            makeHoverButton({ svg: `<circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/>`, title: "Remove from Combo", onClick: () => onRemove(idx) }),
        ],
        showTriangle: true,
    });

    const fullName = display_name || preset.split(/[\/\\]+/).pop() || preset;
    const nameEl = document.createElement("div");
    nameEl.title = preset;
    css(nameEl, "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:500;text-align:center;line-height:1.2;text-shadow:0 1px 3px rgba(0,0,0,0.8);padding:0 4px;overflow:hidden;z-index:1;word-break:break-word;hyphens:auto;border-radius:3px;");
    nameEl.textContent = fullName;
    block.appendChild(nameEl);

    // Strikethrough when bypassed (mirrors FlakeCombo's disabled visual).
    if (isBypassed) block.appendChild(makeBypassStrike());

    // Enable/disable checkbox (top-right). Checked = active; unchecked =
    // bypassed (excluded from the generation product). Sits above the hover
    // overlay so it stays clickable on hover.
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.checked = !isBypassed;
    toggle.title = isBypassed ? "Preset disabled (click to enable)" : "Preset enabled (click to disable)";
    css(toggle, "position:absolute;top:3px;right:3px;z-index:6;cursor:pointer;margin:0;width:14px;height:14px;");
    toggle.addEventListener("click", (e) => { e.stopPropagation(); });
    toggle.addEventListener("mousedown", (e) => e.stopPropagation());
    toggle.addEventListener("dblclick", (e) => e.stopPropagation());
    toggle.addEventListener("change", (e) => { e.stopPropagation(); onToggleBypass(idx); });
    if (onSingleOut) attachHoldToSingleOut(toggle, () => onSingleOut(idx));
    block.appendChild(toggle);

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

    block.addEventListener("dblclick", () => onEdit(idx));
    block.addEventListener("dragover", (e) => onDragOver(e, idx, block));
    block.addEventListener("dragleave", () => { block.style.outline = ""; block.style.boxShadow = ""; });
    block.addEventListener("drop", (e) => onDrop(e, idx, block));

    // Per-instance override dropdown (#279): Filename Prefix / Steps / CFG /
    // Sampler / Scheduler — A/B test a preset without editing its file.
    if (triangleBtn && overrides) {
        // Floating panel anchored under the block, exactly like the Flake Stack
        // grid override dropdown (#303). With the block's overflow:hidden removed,
        // a position:absolute;top:100% panel shows correctly (position:fixed
        // mispositioned inside ComfyUI's transformed canvas).
        const panel = document.createElement("div");
        css(panel, "position:absolute;top:100%;left:50%;transform:translateX(-50%);background:#1e1e1e;border:1px solid #444;border-radius:4px;display:none;z-index:50;box-shadow:0 4px 12px rgba(0,0,0,0.5);margin-top:1px;");
        panel.addEventListener("click", (e) => e.stopPropagation());
        panel.addEventListener("dblclick", (e) => e.stopPropagation());
        panel.addEventListener("mousedown", (e) => e.stopPropagation());

        // Rebuild once the preset's current values are known so each field shows
        // its current value (#302/#303).
        let _defaults = {};
        const rebuild = () => panel.replaceChildren(makeModelOverridePanel(overrides, () => { if (onOverrideChange) onOverrideChange(); }, _defaults));
        rebuild();
        fetchPreset(preset).then(d => {
            _defaults = { filename_prefix: d.filename_prefix, steps: d.steps, cfg: d.cfg, sampler: d.sampler, scheduler: d.scheduler };
            rebuild();
        }).catch(() => {});
        block.appendChild(panel);

        let outside = null;
        const closePanel = () => {
            panel.style.display = "none";
            triangleBtn.textContent = "▾";
            if (outside) { document.removeEventListener("mousedown", outside); outside = null; }
        };
        triangleBtn.addEventListener("click", () => {
            if (panel.style.display === "block") { closePanel(); return; }
            panel.style.display = "block";
            triangleBtn.textContent = "▴";
            outside = (e) => { if (!block.contains(e.target)) closePanel(); };
            document.addEventListener("mousedown", outside);
        });
    }

    return block;
}

export function setupFlakeModelComboWidget(node) {
    const presetWidget = node.widgets?.find(w => w.name === "preset");
    const familyWidget = node.widgets?.find(w => w.name === "model_family");
    const overridesWidget = node.widgets?.find(w => w.name === "overrides_json");
    if (!presetWidget) return;

    // Hide the original ComfyUI combo widget
    presetWidget.computeSize = () => [0, -4];
    presetWidget.type = "hidden";
    presetWidget.hidden = true;
    if (presetWidget.element) { presetWidget.element.remove(); presetWidget.element = null; }
    if (presetWidget.inputEl) { presetWidget.inputEl.remove(); presetWidget.inputEl = null; }

    // Hide the overrides_json widget — it's driven by the per-item panel (#279).
    if (overridesWidget) {
        overridesWidget.computeSize = () => [0, -4];
        overridesWidget.type = "hidden";
        overridesWidget.hidden = true;
        if (overridesWidget.element) { overridesWidget.element.remove(); overridesWidget.element = null; }
        if (overridesWidget.inputEl) { overridesWidget.inputEl.remove(); overridesWidget.inputEl = null; }
    }

    function getFamily() {
        return familyWidget?.value || "SDXL/Base";
    }

    if (!node.properties) node.properties = {};
    if (!node.properties._combo_presets) node.properties._combo_presets = [];
    if (node.properties._combo_active_index == null) node.properties._combo_active_index = 0;
    if (!node.properties._combo_display_names) node.properties._combo_display_names = {};
    // Bypassed presets, keyed by preset name (survives drag/remove reindexing).
    if (!Array.isArray(node.properties._combo_bypassed)) node.properties._combo_bypassed = [];
    // Per-instance overrides, aligned by index with _combo_presets (#279).
    if (!Array.isArray(node.properties._combo_overrides)) node.properties._combo_overrides = [];

    function readPresets() {
        return node.properties._combo_presets || [];
    }
    function overridesArr() {
        if (!Array.isArray(node.properties._combo_overrides)) node.properties._combo_overrides = [];
        return node.properties._combo_overrides;
    }
    function getOverridesAt(i) {
        const arr = overridesArr();
        while (arr.length <= i) arr.push({});
        if (!arr[i] || typeof arr[i] !== "object") arr[i] = {};
        return arr[i];
    }
    function isPresetBypassed(preset) {
        return (node.properties._combo_bypassed || []).includes(preset);
    }
    // Drop bypass entries for presets no longer present in the combo.
    function reconcileBypassed() {
        const present = new Set(readPresets());
        node.properties._combo_bypassed = (node.properties._combo_bypassed || []).filter(p => present.has(p));
    }
    function writePresets(presets) {
        node.properties._combo_presets = presets;
        reconcileBypassed();
        updateActivePreset();
    }
    function updateActivePreset() {
        const presets = readPresets();
        const idx = node.properties._combo_active_index || 0;
        const active = presets[idx] || "Select a preset...";
        presetWidget.value = active;
        // Sync the active preset's overrides to the hidden widget so a single
        // (non-batch) run uses them; the batch cycler sets it per combination.
        if (overridesWidget) {
            overridesWidget.value = serializeModelOverrides(overridesArr()[idx] || {});
        }
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
        const generatingIdx = node._model_combo_generating_index;
        grid.replaceChildren();

        for (let i = 0; i < presets.length; i++) {
            const displayName = node.properties._combo_display_names[presets[i]] || presets[i].split(/[\/\\]+/).pop();
            const blk = makeModelComboBlock({
                preset: presets[i],
                display_name: displayName,
                idx: i,
                isActive: i === activeIdx,
                isBypassed: isPresetBypassed(presets[i]),
                isGenerating: generatingIdx != null && i === generatingIdx,
                overrides: getOverridesAt(i),
                onOverrideChange: () => updateActivePreset(),
                onActivate: (idx) => {
                    node.properties._combo_active_index = idx;
                    updateActivePreset();
                    render();
                },
                onToggleBypass: (idx) => {
                    const p = readPresets()[idx];
                    if (!p) return;
                    const arr = node.properties._combo_bypassed || (node.properties._combo_bypassed = []);
                    const at = arr.indexOf(p);
                    if (at >= 0) arr.splice(at, 1); else arr.push(p);
                    render();
                },
                // Hold the checkbox to single out: enable only this preset,
                // disable every other one in the combo (#281).
                onSingleOut: (idx) => {
                    const presets = readPresets();
                    const keep = presets[idx];
                    if (keep == null) return;
                    node.properties._combo_bypassed = [...new Set(presets.filter(p => p !== keep))];
                    render();
                },
                onRemove: (idx) => {
                    const arr = readPresets();
                    arr.splice(idx, 1);
                    overridesArr().splice(idx, 1);
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
                    // New preset under this slot — reset its overrides.
                    getOverridesAt(idx);
                    overridesArr()[idx] = {};
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
                    const result = await openPresetEditModal({ mode: "edit", name: presetName, data, family: getFamily() });
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
                    // Keep per-instance overrides aligned with the reordered presets.
                    const ov = overridesArr();
                    while (ov.length < arr.length) ov.push({});
                    const [movedOv] = ov.splice(dragSrcIdx, 1);
                    ov.splice(insertIdx, 0, movedOv || {});
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

        // Add block with a New/Existing dropdown (mirrors Flake Combo's add
        // block): create a brand-new model preset, or add an existing one (#278).
        async function pushPreset(name) {
            const arr = readPresets();
            arr.push(name);
            overridesArr().push({});
            node.properties._combo_display_names[name] = await fetchDisplayName(name);
            writePresets(arr);
            render();
        }
        const addBtn = makeAddBlock({
            addLabel: "Add preset",
            newLabel: "+ New preset",
            loadLabel: "↑ Add existing",
            onNew: async () => {
                const result = await openPresetEditModal({
                    mode: "create",
                    family: getFamily(),
                    data: {
                        checkpoint: "", checkpoint_url: "", clip_skip: -2, vae: "",
                        steps: 31, cfg: 4.7, sampler: "dpmpp_2m", scheduler: "karras",
                        width: 853, height: 1440,
                        prompt: { positive: "", negative: "" }, embeddings: [],
                    },
                });
                if (!result || !result.name) return;
                await refreshPresetOptions(getFamily());
                await pushPreset(result.name);
            },
            onLoad: async () => {
                const result = await openPresetPicker({ family: getFamily() });
                if (!result || !result.name) return;
                await pushPreset(result.name);
            },
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
            const ov = overridesArr();
            while (ov.length < arr.length) ov.push({});
            const [movedOv] = ov.splice(dragSrcIdx, 1);
            ov.push(movedOv || {});
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