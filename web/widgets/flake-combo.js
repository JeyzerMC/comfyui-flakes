import {
    css, ensureDefault, makeSmallButton,
    _showDropIndicator, _hideDropIndicator, _hideAllDropIndicators, makeAddBlock,
    makePanelDropdown, makeSmallValueSlider,
} from "../utils.js";
import { fetchList, fetchFlake, getCoverUrl, fetchFlakeMeta } from "../api.js";
import { openEditModal } from "../flake-modal.js";
import { openFileLoadPicker } from "../pickers.js";

const TYPE_COLORS = {
    Style: "#8a6acf", Slider: "#6a9acf", Character: "#6acf8a",
    Pose: "#cf8a6a", Other: "#cf6a8a",
};

function makeComboBlock({ entry, idx, isActive, onEdit, onRemove, onReplace, onOverride, onToggleBypass, onDragStart, onDragOver, onDrop, onDragEnd }) {
    const hasCover = !!entry.name;
    const isBypassed = !!entry.bypassed;
    const block = document.createElement("div");
    block.dataset.idx = String(idx);
    block.dataset.flakeBlock = "1";

    css(block, `position:relative;height:80px;background:${
        isBypassed ? "#1a1a1a" : "#2a2a2a"
    };border:1px solid #444;border-radius:4px;cursor:pointer;font-size:11px;color:#ddd;user-select:none;box-sizing:border-box;overflow:hidden;${
        hasCover ? `background-image:url(${getCoverUrl(entry.name)});background-size:cover;background-position:center;` : ""
    }${isBypassed ? "opacity:0.45;" : ""}`);

    // Type ribbon — clickable to toggle bypass
    const typeTag = entry._pendingData?.flake_type || entry.flake_type || "Other";
    const color = TYPE_COLORS[typeTag] || TYPE_COLORS.Other;
    const ribbon = document.createElement("div");
    ribbon.textContent = typeTag[0];
    ribbon.title = isBypassed ? `${typeTag} (click to activate)` : `${typeTag} (click to bypass)`;
    const bgColor = isBypassed ? "#555" : color;
    css(ribbon, `position:absolute;top:0;left:0;width:16px;height:16px;background:${bgColor};color:#fff;font-size:9px;font-weight:700;display:flex;align-items:center;justify-content:center;border-radius:4px 0 4px 0;z-index:5;text-shadow:none;cursor:pointer;transition:opacity 0.15s;`);
    ribbon.addEventListener("mouseenter", () => { ribbon.style.opacity = "0.8"; });
    ribbon.addEventListener("mouseleave", () => { ribbon.style.opacity = "1"; });
    ribbon.addEventListener("click", (e) => {
        e.stopPropagation();
        if (onToggleBypass) onToggleBypass(idx);
    });
    block.appendChild(ribbon);

    // Strikethrough for bypassed state
    if (isBypassed) {
        const strike = document.createElement("div");
        css(strike, "position:absolute;top:50%;left:10%;right:10%;height:2.5px;background:rgba(230,90,90,0.85);transform:translateY(-50%) rotate(-30deg);z-index:4;pointer-events:none;");
        block.appendChild(strike);
    }

    // Dark overlay for cover readability
    if (hasCover) {
        const overlay = document.createElement("div");
        css(overlay, "position:absolute;inset:0;background:rgba(0,0,0,0.45);pointer-events:none;z-index:0;border-radius:3px;");
        block.appendChild(overlay);
    }

    // Name — show full display name with word wrapping (matching flake-stack logic)
    const fullName = entry.display_name || entry.name || "(missing)";
    const nameEl = document.createElement("div");
    nameEl.title = fullName;
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

    // Override button (always pinned top-right, even when not hovered)
    if (entry._pendingData) {
        const ov = document.createElement("button");
        ov.textContent = "\uD83D\uDCBE";
        ov.title = "Save changes to disk";
        css(ov, "position:absolute;top:2px;right:2px;width:16px;height:16px;line-height:14px;text-align:center;font-size:10px;background:rgba(0,0,0,0.5);color:#ddd;border:1px solid #555;border-radius:2px;cursor:pointer;padding:0;z-index:4;");
        ov.addEventListener("click", (e) => { e.stopPropagation(); onOverride(idx); });
        block.appendChild(ov);
    }

    // Hover button group: Replace / Edit / Remove (only visible on hover)
    function svgIcon(d, w = 14) {
        const tpl = document.createElement("template");
        tpl.innerHTML = `<svg width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
        return tpl.content.firstChild;
    }

    const hoverWrap = document.createElement("div");
    css(hoverWrap, "position:absolute;inset:0;display:none;align-items:center;justify-content:center;gap:6px;z-index:3;background:rgba(0,0,0,0.35);border-radius:3px;");

    const HOVER_BTN = "width:22px;height:22px;padding:0;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.92);color:#222;border:none;border-radius:4px;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,0.5);";

    const replaceBtn = document.createElement("button");
    replaceBtn.title = "Replace Flake";
    replaceBtn.appendChild(svgIcon(`<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>`));
    css(replaceBtn, HOVER_BTN);
    replaceBtn.addEventListener("click", (e) => { e.stopPropagation(); onReplace(idx); });
    hoverWrap.appendChild(replaceBtn);

    const editBtn = document.createElement("button");
    editBtn.title = "Edit Flake";
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

    // Triangle button (bottom center) for variants / LoRA
    let triangleBtn = null;
    if (entry.name) {
        triangleBtn = document.createElement("button");
        triangleBtn.innerHTML = "&#9662;";
        css(triangleBtn, "position:absolute;bottom:2px;left:50%;transform:translateX(-50%);background:transparent;color:rgba(180,180,180,0.6);border:none;padding:0;font-size:12px;line-height:1;cursor:pointer;z-index:2;display:none;");
        triangleBtn.addEventListener("click", (e) => { e.stopPropagation(); });
        triangleBtn.addEventListener("dblclick", (e) => e.stopPropagation());
        triangleBtn.addEventListener("mousedown", (e) => e.stopPropagation());
        block.appendChild(triangleBtn);
    }

    block.addEventListener("dblclick", () => onEdit(idx));
    block.addEventListener("dragover", (e) => onDragOver(e, idx, block));
    block.addEventListener("dragleave", () => { block.style.outline = ""; block.style.boxShadow = ""; });
    block.addEventListener("drop", (e) => onDrop(e, idx, block));

    return { block, triangleBtn };
}

function makeInstanceControls(block, entry, idx, onChanged, triangleBtn) {
    if (entry.inline) return { toggleOptionsPanel: () => {} };

    // Options panel (hidden by default)
    const panel = document.createElement("div");
    css(panel, "position:absolute;top:100%;left:50%;transform:translateX(-50%);width:160px;background:#1e1e1e;border:1px solid #444;border-radius:4px;padding:4px;display:none;flex-direction:column;gap:3px;z-index:50;box-shadow:0 4px 12px rgba(0,0,0,0.5);margin-top:1px;");
    panel.addEventListener("click", (e) => e.stopPropagation());
    panel.addEventListener("dblclick", (e) => e.stopPropagation());
    block.appendChild(panel);

    let optionsLoaded = false;
    let hasOptions = null;
    let flakeData = null;

    function rebuildPanel() {
        panel.replaceChildren();

        const lorasMeta = entry._pendingData?.loras || flakeData?.loras || [];
        if (entry.loras.length > lorasMeta.length) {
            entry.loras.length = lorasMeta.length;
        }
        while (entry.loras.length < lorasMeta.length) {
            entry.loras.push(lorasMeta[entry.loras.length]?.strength ?? 1.0);
        }
        const hasLoras = lorasMeta.length > 0;
        const hasOptionGroups = hasOptions && Object.keys(hasOptions).length > 0;

        if (triangleBtn) {
            triangleBtn.style.display = (hasLoras || hasOptionGroups) ? "block" : "none";
        }

        if (hasLoras) {
            for (let i = 0; i < lorasMeta.length; i++) {
                const sliderRow = document.createElement("div");
                css(sliderRow, "padding:2px 0;");
                const name = lorasMeta[i]?.name || "LoRA";
                const label = document.createElement("div");
                label.textContent = name;
                css(label, "font-size:9px;opacity:0.7;padding:2px 0;text-align:center;");
                sliderRow.appendChild(label);
                const strSlider = makeSmallValueSlider(entry.loras[i] != null ? entry.loras[i] : (lorasMeta[i]?.strength ?? 1.0), -10, 10, 0.05, (v) => {
                    entry.loras[i] = v;
                    onChanged();
                });
                sliderRow.appendChild(strSlider);
                panel.appendChild(sliderRow);
            }
        }

        if (!hasOptionGroups) {
            if (!hasLoras) {
                const empty = document.createElement("div");
                css(empty, "font-size:9px;opacity:0.5;padding:4px;text-align:center;");
                empty.textContent = "no variants";
                panel.appendChild(empty);
            }
        } else {
            for (const group of Object.keys(hasOptions)) {
                const row = document.createElement("div");
                css(row, "display:flex;flex-direction:column;gap:2px;");
                const gLabel = document.createElement("span");
                gLabel.textContent = group;
                css(gLabel, "font-size:9px;opacity:0.7;text-align:center;");
                row.appendChild(gLabel);

                const ddOptions = [{ value: "", label: "-" }];
                for (const ch of hasOptions[group]) {
                    ddOptions.push({ value: ch, label: ch });
                }
                const dd = makePanelDropdown(ddOptions, (entry.variant || {})[group] || "");
                dd.element.addEventListener("change", () => {
                    if (dd.element.value) {
                        entry.variant = entry.variant || {};
                        entry.variant[group] = dd.element.value;
                    } else {
                        if (entry.variant) delete entry.variant[group];
                    }
                    onChanged();
                });
                row.appendChild(dd.container);
                panel.appendChild(row);
            }
        }
    }

    async function loadOptions() {
        if (optionsLoaded || !entry.name) return;
        try {
            const [variants, fdata] = await Promise.all([fetchFlakeMeta(entry.name), fetchFlake(entry.name)]);
            optionsLoaded = true;
            hasOptions = variants;
            flakeData = fdata;
            rebuildPanel();
        } catch { /* ignore */ }
    }

    async function toggleOptionsPanel() {
        if (panel.style.display === "flex") {
            panel.style.display = "none";
            if (triangleBtn) triangleBtn.innerHTML = "&#9662;";
            return;
        }
        panel.style.display = "flex";
        if (triangleBtn) triangleBtn.innerHTML = "&#9652;";

        if (!optionsLoaded && entry.name) {
            panel.textContent = "";
            const loading = document.createElement("div");
            css(loading, "font-size:9px;opacity:0.5;text-align:center;padding:4px;");
            loading.textContent = "loading...";
            panel.appendChild(loading);

            try {
                await loadOptions();
            } catch {
                panel.replaceChildren();
                const err = document.createElement("div");
                css(err, "font-size:9px;color:#f88;padding:4px;text-align:center;");
                err.textContent = "failed to load";
                panel.appendChild(err);
            }
        }
    }

    if (triangleBtn) {
        triangleBtn.addEventListener("click", () => {
            toggleOptionsPanel();
        });
    }

    loadOptions();

    return { toggleOptionsPanel };
}

export function setupFlakeComboWidget(node) {
    const flakesHidden = node.widgets?.find(w => w.name === "flakes_json");
    const familyWidget = node.widgets?.find(w => w.name === "model_family");
    if (!flakesHidden) return;

    flakesHidden.computeSize = () => [0, -4];
    flakesHidden.type = "hidden";
    flakesHidden.hidden = true;
    if (flakesHidden.element) { flakesHidden.element.remove(); flakesHidden.element = null; }
    if (flakesHidden.inputEl) { flakesHidden.inputEl.remove(); flakesHidden.inputEl = null; }

    function getFamily() {
        return familyWidget?.value || "SDXL/Base";
    }

    if (!node.properties) node.properties = {};
    if (!node.properties._combo_flakes) node.properties._combo_flakes = [];
    if (node.properties._combo_active_index == null) node.properties._combo_active_index = 0;

    function readAllFlakes() {
        const flakes = node.properties._combo_flakes || [];
        for (const entry of flakes) {
            if (!entry.loras && entry.strength != null) {
                entry.loras = [entry.strength];
            }
            if (!entry.loras) entry.loras = [];
            if (!entry.variant && entry.option) {
                entry.variant = entry.option;
                delete entry.option;
            }
            if (!entry.variant) entry.variant = {};
        }
        return flakes;
    }
    function writeAllFlakes(flakes) {
        node.properties._combo_flakes = flakes;
        updateActiveFlake();
    }
    function updateActiveFlake() {
        const flakes = readAllFlakes();
        const idx = node.properties._combo_active_index || 0;
        const active = flakes[idx] || null;
        flakesHidden.value = JSON.stringify(active ? [active] : []);
    }

    const container = document.createElement("div");
    css(container, "display:flex;flex-direction:column;gap:2px;padding:0 6px 3px 6px;font-size:12px;color:#ddd;");

    const grid = document.createElement("div");
    css(grid, "display:grid;grid-template-columns:repeat(auto-fill, minmax(72px, 1fr));gap:4px;");
    container.appendChild(grid);

    let dragSrcIdx = null;

    function render() {
        const flakes = readAllFlakes();
        const activeIdx = node.properties._combo_active_index || 0;
        grid.replaceChildren();

        for (let i = 0; i < flakes.length; i++) {
            const { block: blk, triangleBtn } = makeComboBlock({
                entry: flakes[i],
                idx: i,
                isActive: i === activeIdx,
                onEdit: handleEdit,
                onRemove: handleRemove,
                onReplace: handleReplace,
                onOverride: handleOverride,
                onToggleBypass: handleToggleBypass,
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
                    const arr = readAllFlakes();
                    const [moved] = arr.splice(dragSrcIdx, 1);
                    let insertIdx = idx;
                    if (dragSrcIdx < idx) insertIdx--;
                    arr.splice(insertIdx, 0, moved);
                    if (node.properties._combo_active_index === dragSrcIdx) {
                        node.properties._combo_active_index = insertIdx;
                    } else if (node.properties._combo_active_index > dragSrcIdx && node.properties._combo_active_index <= idx) {
                        node.properties._combo_active_index--;
                    }
                    writeAllFlakes(arr);
                    dragSrcIdx = null;
                    render();
                },
                onDragEnd: (el) => {
                    el.style.opacity = "";
                    dragSrcIdx = null;
                    _hideAllDropIndicators();
                },
            });
            makeInstanceControls(blk, flakes[i], i, () => writeAllFlakes(flakes), triangleBtn);
            grid.appendChild(blk);
        }

        if (grid._addBlock) grid.appendChild(grid._addBlock);
    }

    async function handleEdit(idx) {
        const entries = readAllFlakes();
        const entry = entries[idx];
        let data;
        try {
            data = entry._pendingData ? JSON.parse(JSON.stringify(entry._pendingData)) : await fetchFlake(entry.name);
        } catch (err) {
            window.alert(`Failed to load ${entry.name}: ${err.message || err}`);
            return;
        }

        const { directories } = await fetchList(getFamily());
        const result = await openEditModal({
            mode: "edit",
            name: entry.name,
            data,
            dirs: directories,
        });

        if (!result) return;

        if (result.deleted) {
            const arr = readAllFlakes();
            arr.splice(idx, 1);
            if (node.properties._combo_active_index >= arr.length) {
                node.properties._combo_active_index = Math.max(0, arr.length - 1);
            }
            writeAllFlakes(arr);
            render();
        } else if (result.saved || result.defaultUpdated) {
            const arr = readAllFlakes();
            if (result.name && result.name !== arr[idx].name) arr[idx].name = result.name;
            arr[idx]._pendingData = result.data;
            arr[idx]._edited_at = Date.now();
            arr[idx].flake_type = result.data?.flake_type || null;
            arr[idx].has_lora = !!(result.data && (result.data.path || (result.data.loras && result.data.loras.length > 0)));
            arr[idx].display_name = result.data?.name || null;
            const newLoras = Array.isArray(result.data?.loras)
                ? result.data.loras.map(l => l?.strength ?? 1.0)
                : (result.data?.path ? [result.data.strength ?? 1.0] : []);
            arr[idx].loras = newLoras;
            if (arr[idx].variant) {
                const validGroups = new Set(Object.keys(result.data?.variants || result.data?.options || {}));
                for (const g of Object.keys(arr[idx].variant)) {
                    if (!validGroups.has(g)) delete arr[idx].variant[g];
                }
            }
            writeAllFlakes(arr);
            render();
        }
    }

    function handleRemove(idx) {
        const arr = readAllFlakes();
        arr.splice(idx, 1);
        if (node.properties._combo_active_index >= arr.length) {
            node.properties._combo_active_index = Math.max(0, arr.length - 1);
        }
        writeAllFlakes(arr);
        render();
    }

    function handleToggleBypass(idx) {
        const arr = readAllFlakes();
        arr[idx].bypassed = !arr[idx].bypassed;
        writeAllFlakes(arr);
        render();
    }

    async function handleReplace(idx) {
        const { flakes, directories } = await fetchList(getFamily());
        const result = await openFileLoadPicker({ flakes, directories, family: getFamily() });
        if (!result || !result.name) return;
        const arr = readAllFlakes();
        let has_lora = false;
        let display_name = null;
        let flake_type = null;
        let loras = [];
        try {
            const d = await fetchFlake(result.name);
            has_lora = !!(d && (d.path || (d.loras && d.loras.length > 0)));
            display_name = d.name || null;
            flake_type = d.flake_type || null;
            if (d.loras) loras = d.loras.map(l => l.strength ?? 1.0);
            else if (d.path) loras = [d.strength ?? 1.0];
        } catch {}
        arr[idx] = { ...arr[idx], name: result.name, loras, variant: {}, has_lora, display_name, flake_type };
        delete arr[idx]._pendingData;
        writeAllFlakes(arr);
        render();
    }

    async function handleOverride(idx) {
        const entries = readAllFlakes();
        const entry = entries[idx];
        if (!entry.name || !entry._pendingData) {
            window.alert("No pending changes to save.");
            return;
        }
        try {
            await saveFlakeApi(entry.name, entry._pendingData);
            const arr = readAllFlakes();
            delete arr[idx]._pendingData;
            arr[idx].has_lora = !!(entry._pendingData && (entry._pendingData.path || (entry._pendingData.loras && entry._pendingData.loras.length > 0)));
            writeAllFlakes(arr);
            render();
        } catch (err) {
            window.alert(`Save failed: ${err.message || err}`);
        }
    }

    async function handleNew() {
        const { directories } = await fetchList(getFamily());
        const result = await openEditModal({
            mode: "create",
            data: {},
            dirs: directories,
            family: getFamily(),
        });
        if (!result || !result.created) return;
        const arr = readAllFlakes();
        let has_lora = false;
        let display_name = null;
        let flake_type = null;
        let loras = [];
        if (result.data && (result.data.path || (result.data.loras && result.data.loras.length > 0))) has_lora = true;
        else if (result.name) {
            try { const d = await fetchFlake(result.name); has_lora = !!(d && (d.path || (d.loras && d.loras.length > 0))); flake_type = d.flake_type || null; } catch {}
        }
        if (result.data && result.data.name) display_name = result.data.name;
        else if (result.name) {
            try { const d = await fetchFlake(result.name); display_name = d.name || null; flake_type = flake_type || d.flake_type || null; } catch {}
        }
        if (result.data && result.data.loras) {
            loras = result.data.loras.map(l => l.strength ?? 1.0);
        } else if (result.data && result.data.path) {
            loras = [result.data.strength ?? 1.0];
        } else if (result.name) {
            try {
                const d = await fetchFlake(result.name);
                if (d.loras) loras = d.loras.map(l => l.strength ?? 1.0);
                else if (d.path) loras = [d.strength ?? 1.0];
                flake_type = flake_type || d.flake_type || null;
            } catch {}
        }
        arr.push({ name: result.name, loras, variant: {}, has_lora, display_name, flake_type });
        writeAllFlakes(arr);
        render();
    }

    async function handleLoad() {
        const { flakes, directories } = await fetchList(getFamily());
        const result = await openFileLoadPicker({ flakes, directories, family: getFamily() });
        if (!result || !result.name) return;
        const arr = readAllFlakes();
        let has_lora = false;
        let display_name = null;
        let flake_type = null;
        let loras = [];
        try {
            const d = await fetchFlake(result.name);
            has_lora = !!(d && (d.path || (d.loras && d.loras.length > 0)));
            display_name = d.name || null;
            flake_type = d.flake_type || null;
            if (d.loras) loras = d.loras.map(l => l.strength ?? 1.0);
            else if (d.path) loras = [d.strength ?? 1.0];
        } catch {}
        arr.push({ name: result.name, loras, variant: {}, has_lora, display_name, flake_type });
        writeAllFlakes(arr);
        render();
    }

    grid._addBlock = makeAddBlock({ onNew: handleNew, onLoad: handleLoad });

    grid._addBlock.addEventListener("dragover", (e) => {
        if (dragSrcIdx === null) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        _showDropIndicator(grid._addBlock);
    });
    grid._addBlock.addEventListener("dragleave", () => {
        _hideDropIndicator(grid._addBlock);
    });
    grid._addBlock.addEventListener("drop", (e) => {
        e.preventDefault();
        _hideDropIndicator(grid._addBlock);
        if (dragSrcIdx === null) return;
        const arr = readAllFlakes();
        const [moved] = arr.splice(dragSrcIdx, 1);
        arr.push(moved);
        writeAllFlakes(arr);
        dragSrcIdx = null;
        render();
    });

    if (familyWidget) {
        const origCallback = familyWidget.callback;
        familyWidget.callback = function (value) {
            const r = origCallback?.apply(this, arguments);
            render();
            return r;
        };
    }

    node._combo_render = render;
    const comboWidget = node.addDOMWidget("combo_ui", "div", container, { serialize: false, margin: 4 });
    comboWidget.computeSize = () => {
        const rows = Math.max(1, Math.ceil((readAllFlakes().length + 1) / 2));
        return [node.size[0], rows * 84 + 31];
    };
    updateActiveFlake();
    render();
}