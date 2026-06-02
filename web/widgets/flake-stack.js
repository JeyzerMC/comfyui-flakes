import {
    css, ensureDefault, makeSmallButton, svgIcon, makeGridItemOverlay, makeHoverButton, makeTypeRibbon, makeBypassStrike, TYPE_COLORS,
    _showDropIndicator, _hideDropIndicator, _hideAllDropIndicators, makeAddBlock,
    makePanelDropdown, makeSmallValueSlider, variantSuffix,
    _registerOpenPanel, _unregisterOpenPanel, setWidgetHidden,
} from "../utils.js";
import { fetchList, fetchFlake, getCoverUrl, getVariantImageUrl, fetchFlakeMeta, invalidateList } from "../api.js";
import { openEditModal } from "../flake-modal.js";
import { openFileLoadPicker } from "../pickers.js";

function makeBlock({ entry, idx, onEdit, onRemove, onReplace, onToggleBypass, onDragStart, onDragOver, onDrop, onDragEnd }) {
    const isDefault = !!entry.inline;
    const isBypassed = !!entry.bypassed;
    const hasCover = !isDefault && entry.name;
    const block = document.createElement("div");
    block.dataset.idx = String(idx);
    block.dataset.flakeBlock = "1";

    css(block, `position:relative;height:80px;background:${
        isDefault ? "#2a3a4a" : isBypassed ? "#1a1a1a" : "#2a2a2a"
    };border:1px solid ${
        isDefault ? "#3a5a8a" : isBypassed ? "#333" : "#444"
    };border-radius:4px;cursor:pointer;font-size:11px;color:#ddd;user-select:none;box-sizing:border-box;${
        hasCover ? "background-size:cover;background-position:center;" : ""
    }${isBypassed ? "opacity:0.45;" : ""}`);

    // Cover image — swap to a selected variant choice's image when it has one,
    // otherwise fall back to the flake's base cover.
    function refreshCover() {
        if (!hasCover) return;
        const baseUrl = getCoverUrl(entry.name);
        const variant = entry.variant || {};
        const sel = Object.entries(variant).find(([, c]) => c != null && c !== "");
        if (!sel) {
            block.style.backgroundImage = `url(${baseUrl})`;
            return;
        }
        const [group, choice] = sel;
        const variantUrl = getVariantImageUrl(entry.name, group, choice);
        const probe = new Image();
        probe.onload = () => { block.style.backgroundImage = `url(${variantUrl})`; };
        probe.onerror = () => { block.style.backgroundImage = `url(${baseUrl})`; };
        probe.src = variantUrl;
    }
    refreshCover();

    // Type ribbon + bypass (clicking toggles bypass)
    if (!isDefault) {
        const ribbon = makeTypeRibbon(entry, isBypassed, onToggleBypass, idx);
        block.appendChild(ribbon);
    }

    // Strikethrough for bypassed state
    if (isBypassed && !isDefault) {
        block.appendChild(makeBypassStrike());
    }

    // Name — show portion after / with word wrapping, plus selected variant
    const fullName = isDefault ? "Default" : (entry.display_name || entry.name || "(missing)");
    const nameAfterSlash = fullName.includes("/") ? fullName.split("/").pop() : fullName;
    const nameEl = document.createElement("div");
    css(nameEl, "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:500;text-align:center;line-height:1.2;text-shadow:0 1px 3px rgba(0,0,0,0.8);padding:0 4px;overflow:hidden;z-index:1;word-break:break-word;hyphens:auto;");
    function refreshName() {
        const suffix = isDefault ? "" : variantSuffix(entry);
        nameEl.title = fullName + suffix;
        nameEl.textContent = nameAfterSlash + suffix;
    }
    refreshName();
    block.appendChild(nameEl);

    // Whole block is draggable for reorder. The browser only initiates a
    // drag after the cursor moves a few pixels with the button held, so
    // single clicks (Edit / Remove / Replace buttons) and double-clicks
    // still register normally.
    if (!isDefault) {
        block.draggable = true;
        block.style.cursor = "grab";
        block.addEventListener("dragstart", (e) => {
            // Don't start a drag when the user clicks one of the hover buttons
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
    }


    const { triangleBtn } = makeGridItemOverlay({
        block,
        showHoverButtons: !isDefault,
        buttons: !isDefault ? [
            makeHoverButton({ svg: `<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>`, title: "Replace Flake", onClick: () => onReplace(idx) }),
            makeHoverButton({ svg: `<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>`, title: "Edit Flake", onClick: () => onEdit(idx) }),
            makeHoverButton({ svg: `<circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/>`, title: "Remove Flake", onClick: () => onRemove(idx) }),
        ] : [],
        showTriangle: !isDefault && !!entry.name,
    });

    block.addEventListener("dblclick", () => onEdit(idx));
    block.addEventListener("dragover", (e) => onDragOver(e, idx, block));
    block.addEventListener("dragleave", () => { block.style.outline = ""; block.style.boxShadow = ""; });
    block.addEventListener("drop", (e) => onDrop(e, idx, block));

    function refreshVisuals() { refreshName(); refreshCover(); }

    return { block, triangleBtn, refreshName, refreshVisuals };
}

function makeInstanceControls(block, entry, idx, onChanged, triangleBtn, onVariantChange) {
    if (entry.inline) return { toggleOptionsPanel: () => {} };

    // Options panel (hidden by default). Container is a flex row so we can add
    // a second panel to the right when the host flake has a flake_link (#235).
    const panel = document.createElement("div");
    css(panel, "position:absolute;top:100%;left:50%;transform:translateX(-50%);background:#1e1e1e;border:1px solid #444;border-radius:4px;padding:0;display:none;flex-direction:row;gap:0;z-index:50;box-shadow:0 4px 12px rgba(0,0,0,0.5);margin-top:1px;");
    panel.addEventListener("click", (e) => e.stopPropagation());
    panel.addEventListener("dblclick", (e) => e.stopPropagation());
    block.appendChild(panel);

    const nativeColumn = document.createElement("div");
    css(nativeColumn, "width:160px;padding:4px;display:flex;flex-direction:column;gap:3px;box-sizing:border-box;");
    panel.appendChild(nativeColumn);

    const linkedColumn = document.createElement("div");
    css(linkedColumn, "width:160px;padding:4px;display:none;flex-direction:column;gap:3px;box-sizing:border-box;border-left:1px solid #333;");
    panel.appendChild(linkedColumn);

    let optionsLoaded = false;
    let hasOptions = false;
    let flakeData = null;
    let linkedFlakeData = null;

    function rebuildPanel() {
        nativeColumn.replaceChildren();

        const lorasMeta = flakeData?.loras || [];
        // Sync override array length to match the YAML
        if (entry.loras.length > lorasMeta.length) {
            entry.loras.length = lorasMeta.length;
        }
        while (entry.loras.length < lorasMeta.length) {
            entry.loras.push(lorasMeta[entry.loras.length]?.strength ?? 1.0);
        }
        const hasLoras = lorasMeta.length > 0;
        const hasOptionGroups = hasOptions && Object.keys(hasOptions).length > 0;

        if (triangleBtn) {
            triangleBtn.style.display = "block";
        }

        // 1. Output Stem (top) — per-instance runtime override
        const outputStem = (entry._output_stem_override ?? flakeData?.output_stem ?? "") || "";
        const opLabel = document.createElement("div");
        opLabel.textContent = "Output Stem";
        css(opLabel, "font-size:9px;opacity:0.7;text-align:center;");
        nativeColumn.appendChild(opLabel);
        const opInput = document.createElement("input");
        opInput.type = "text";
        opInput.value = outputStem;
        opInput.placeholder = "e.g. musashi/";
        css(opInput, "width:100%;box-sizing:border-box;background:#1a1a1a;color:#ddd;border:1px solid #333;padding:2px 4px;border-radius:3px;font-size:10px;outline:none;");
        opInput.addEventListener("input", () => {
            entry._output_stem_override = opInput.value || null;
            onChanged();
        });
        nativeColumn.appendChild(opInput);

        // 2. LoRA strength sliders
        if (hasLoras) {
            const sep = document.createElement("div");
            css(sep, "border-top:1px solid #333;margin:2px 0;");
            nativeColumn.appendChild(sep);
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
                nativeColumn.appendChild(sliderRow);
            }
        }

        // 3. Variant groups
        if (hasOptionGroups) {
            const sep = document.createElement("div");
            css(sep, "border-top:1px solid #333;margin:2px 0;");
            nativeColumn.appendChild(sep);
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
                    if (onVariantChange) onVariantChange();
                });
                row.appendChild(dd.container);
                nativeColumn.appendChild(row);
            }
        } else if (!hasLoras) {
            const sep = document.createElement("div");
            css(sep, "border-top:1px solid #333;margin:2px 0;");
            nativeColumn.appendChild(sep);
            const empty = document.createElement("div");
            css(empty, "font-size:9px;opacity:0.5;padding:4px;text-align:center;");
            empty.textContent = "no variants";
            nativeColumn.appendChild(empty);
        }

        rebuildLinkedPanel();
    }

    // Linked flake panel (#235): shown when the host flake declares a
    // flake_link. The overrides write to entry.flake_link_override which the
    // backend's resolve() reads at execute time.
    function rebuildLinkedPanel() {
        if (!flakeData?.flake_link?.target || !linkedFlakeData) {
            linkedColumn.style.display = "none";
            return;
        }
        linkedColumn.style.display = "flex";
        linkedColumn.replaceChildren();

        entry.flake_link_override = entry.flake_link_override || { variant: {}, lora_strengths: [] };
        const ovr = entry.flake_link_override;
        ovr.variant = ovr.variant || {};
        ovr.lora_strengths = ovr.lora_strengths || [];

        const yamlDefaults = flakeData.flake_link;

        const title = document.createElement("div");
        title.textContent = (linkedFlakeData.name || flakeData.flake_link.target).split("/").pop();
        title.title = `Linked: ${flakeData.flake_link.target}`;
        css(title, "font-size:9px;opacity:0.8;text-align:center;font-weight:600;color:#4a9eff;padding:2px 0;");
        linkedColumn.appendChild(title);

        const linkedLoras = Array.isArray(linkedFlakeData.loras) ? linkedFlakeData.loras : [];
        if (linkedLoras.length > 0) {
            const sep = document.createElement("div");
            css(sep, "border-top:1px solid #333;margin:2px 0;");
            linkedColumn.appendChild(sep);
            for (let i = 0; i < linkedLoras.length; i++) {
                const sliderRow = document.createElement("div");
                css(sliderRow, "padding:2px 0;");
                const name = linkedLoras[i]?.name || "LoRA";
                const label = document.createElement("div");
                label.textContent = name;
                css(label, "font-size:9px;opacity:0.7;padding:2px 0;text-align:center;");
                sliderRow.appendChild(label);
                // Effective default: per-grid override > yaml default > linked flake's own
                let initial = ovr.lora_strengths[i];
                if (initial === null || initial === undefined) initial = (yamlDefaults.lora_strengths || [])[i];
                if (initial === null || initial === undefined) initial = linkedLoras[i]?.strength ?? 1.0;
                const strSlider = makeSmallValueSlider(initial, -10, 10, 0.05, (v) => {
                    while (ovr.lora_strengths.length <= i) ovr.lora_strengths.push(null);
                    ovr.lora_strengths[i] = v;
                    onChanged();
                });
                sliderRow.appendChild(strSlider);
                linkedColumn.appendChild(sliderRow);
            }
        }

        const linkedVariants = linkedFlakeData.variants || linkedFlakeData.options || {};
        if (Object.keys(linkedVariants).length > 0) {
            const sep = document.createElement("div");
            css(sep, "border-top:1px solid #333;margin:2px 0;");
            linkedColumn.appendChild(sep);
            for (const group of Object.keys(linkedVariants)) {
                const row = document.createElement("div");
                css(row, "display:flex;flex-direction:column;gap:2px;");
                const gLabel = document.createElement("span");
                gLabel.textContent = group;
                css(gLabel, "font-size:9px;opacity:0.7;text-align:center;");
                row.appendChild(gLabel);
                const ddOptions = [{ value: "", label: "-" }];
                for (const ch of Object.keys(linkedVariants[group])) ddOptions.push({ value: ch, label: ch });
                const current = ovr.variant[group] || (yamlDefaults.variant || {})[group] || "";
                const dd = makePanelDropdown(ddOptions, current);
                dd.element.addEventListener("change", () => {
                    if (dd.element.value) ovr.variant[group] = dd.element.value;
                    else delete ovr.variant[group];
                    onChanged();
                });
                row.appendChild(dd.container);
                linkedColumn.appendChild(row);
            }
        }

        if (linkedLoras.length === 0 && Object.keys(linkedVariants).length === 0) {
            const empty = document.createElement("div");
            css(empty, "font-size:9px;opacity:0.5;padding:4px;text-align:center;");
            empty.textContent = "no overrides";
            linkedColumn.appendChild(empty);
        }
    }

    async function loadOptions() {
        if (optionsLoaded || !entry.name) return;
        try {
            const [variants, fdata] = await Promise.all([fetchFlakeMeta(entry.name), fetchFlake(entry.name)]);
            optionsLoaded = true;
            hasOptions = variants;
            flakeData = fdata;
            // Also fetch linked flake data if the host declares a flake_link.
            if (fdata?.flake_link?.target) {
                try {
                    linkedFlakeData = await fetchFlake(fdata.flake_link.target);
                } catch { /* leave null — rebuildLinkedPanel hides the column */ }
            }
            rebuildPanel();
        } catch { /* ignore */ }
    }

    let outsideHandler = null;

    function closeOptionsPanel() {
        panel.style.display = "none";
        if (triangleBtn) triangleBtn.textContent = "▾";
        if (outsideHandler) {
            document.removeEventListener("mousedown", outsideHandler);
            outsideHandler = null;
        }
        _unregisterOpenPanel(closeOptionsPanel);
    }

    async function toggleOptionsPanel() {
        if (panel.style.display === "flex") {
            closeOptionsPanel();
            return;
        }
        _registerOpenPanel(closeOptionsPanel);
        panel.style.display = "flex";
        if (triangleBtn) triangleBtn.textContent = "▴";
        if (!outsideHandler) {
            outsideHandler = (e) => {
                if (!block.contains(e.target)) closeOptionsPanel();
            };
            document.addEventListener("mousedown", outsideHandler);
        }

        if (!optionsLoaded && entry.name) {
            nativeColumn.replaceChildren();
            const loading = document.createElement("div");
            css(loading, "font-size:9px;opacity:0.5;text-align:center;padding:4px;");
            loading.textContent = "loading...";
            nativeColumn.appendChild(loading);

            try {
                await loadOptions();
            } catch {
                nativeColumn.replaceChildren();
                const err = document.createElement("div");
                css(err, "font-size:9px;color:#f88;padding:4px;text-align:center;");
                err.textContent = "failed to load";
                nativeColumn.appendChild(err);
            }
        }
    }

    // Triangle button click
    if (triangleBtn) {
        triangleBtn.addEventListener("click", () => {
            toggleOptionsPanel();
        });
    }

    // Load options in background so triangle shows immediately for flakes that have options/loras
    loadOptions();

    return { toggleOptionsPanel };
}

export function setupFlakeWidget(node) {
    const flakesHidden = node.widgets?.find(w => w.name === "flakes_json");
    const familyWidget = node.widgets?.find(w => w.name === "model_family");
    if (!flakesHidden) return;

    // Hide flakes_json STRING widget permanently, with serialize=true
    // so edited values (including the default flake's prompt) reach the
    // backend. Manual hiding via type/hidden/removeElement was skipping
    // serialization in ComfyUI's graph payload.
    setWidgetHidden(flakesHidden, true);

    function getFamily() {
        return familyWidget?.value || "SDXL/Base";
    }

    // Hide model_family widget when flake_data input is connected, and infer
    // the family value from the upstream node. The widget stays in node.widgets
    // so serialization still includes model_family (REQUIRED on the Python
    // side). setWidgetHidden() in utils.js stacks every known hide signal
    // (computeSize, type, hidden, draw, options, DOM element display).
    let _familyHidden = false;
    function _inferUpstreamFamily() {
        const flakeDataInput = node.inputs?.find(i => i.name === "flake_data");
        if (!flakeDataInput || flakeDataInput.link == null) return null;
        const link = node.graph?.links?.[flakeDataInput.link];
        if (!link) return null;
        const upstreamNode = node.graph.getNodeById(link.origin_id);
        if (!upstreamNode) return null;
        const upstreamFamily = upstreamNode.widgets?.find(w => w.name === "model_family");
        return upstreamFamily?.value || null;
    }
    function _isFlakeDataConnected() {
        const flakeDataInput = node.inputs?.find(i => i.name === "flake_data");
        return !!(flakeDataInput && flakeDataInput.link != null);
    }
    function _updateFamilyVisibility() {
        if (!familyWidget) return;
        // Hide whenever the input pin is connected — not only when the upstream
        // family is inferable. Otherwise a connected-but-uninferable upstream
        // leaves the widget visible-but-disabled (#261).
        const shouldHide = _isFlakeDataConnected();
        const upstream = _inferUpstreamFamily();
        if (upstream !== null && upstream !== familyWidget.value) {
            familyWidget.value = upstream;
            if (familyWidget.callback) familyWidget.callback(upstream);
        }
        if (shouldHide === _familyHidden) return;
        _familyHidden = shouldHide;
        setWidgetHidden(familyWidget, shouldHide);
        node.setDirtyCanvas(true, true);
        // Note: we deliberately don't call node.setSize() here — doing so
        // overrode user-resized node sizes on reload.
    }
    const _familyPoll = setInterval(_updateFamilyVisibility, 200);
    setTimeout(_updateFamilyVisibility, 0);

    function readEntries() {
        try {
            const arr = JSON.parse(flakesHidden.value || "[]");
            const result = ensureDefault(Array.isArray(arr) ? arr : []);
            for (const entry of result) {
                if (!entry.loras && entry.strength != null) {
                    entry.loras = [entry.strength];
                }
                if (!entry.loras) entry.loras = [];
            }
            return result;
        } catch { return ensureDefault([]); }
    }
    function writeEntries(entries) { flakesHidden.value = JSON.stringify(entries); }

    // Custom DOM widget
    const container = document.createElement("div");
    css(container, "display:flex;flex-direction:column;gap:2px;padding:0 6px 3px 6px;font-size:12px;color:#ddd;");

    // Flakes grid
    const grid = document.createElement("div");
    css(grid, "display:grid;grid-template-columns:repeat(auto-fill, minmax(72px, 1fr));gap:4px;");
    container.appendChild(grid);

    let dragSrcIdx = null;

    function render() {
        const entries = readEntries();
        grid.replaceChildren();
        for (const indicator of grid.querySelectorAll(".flake-drop-indicator")) {
            indicator.remove();
        }
        for (let i = 0; i < entries.length; i++) {
            const { block: blk, triangleBtn, refreshVisuals } = makeBlock({
                entry: entries[i],
                idx: i,
                onEdit: handleEdit,
                onRemove: handleRemove,
                onReplace: handleReplace,
                onToggleBypass: handleToggleBypass,
                onDragStart: (e, idx, el) => {
                    dragSrcIdx = idx;
                    e.dataTransfer.effectAllowed = "move";
                    el.style.opacity = "0.4";
                },
                onDragOver: (e, idx, el) => {
                    if (dragSrcIdx === null || idx === 0 || idx === dragSrcIdx) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    _showDropIndicator(el);
                },
                onDrop: (e, idx, el) => {
                    e.preventDefault();
                    _hideDropIndicator(el);
                    if (dragSrcIdx === null || idx === 0 || idx === dragSrcIdx) return;
                    const arr = readEntries();
                    const [moved] = arr.splice(dragSrcIdx, 1);
                    let insertIdx = idx;
                    if (dragSrcIdx < idx) insertIdx--;
                    arr.splice(insertIdx, 0, moved);
                    writeEntries(arr);
                    dragSrcIdx = null;
                    render();
                },
                onDragEnd: (el) => {
                    el.style.opacity = "";
                    dragSrcIdx = null;
                    _hideAllDropIndicators();
                },
            });
            makeInstanceControls(blk, entries[i], i, () => writeEntries(entries), triangleBtn, refreshVisuals);
            grid.appendChild(blk);
        }
        if (grid._addBlock) grid.appendChild(grid._addBlock);
    }

    async function handleEdit(idx) {
        const entries = readEntries();
        const entry = entries[idx];
        const isDefault = !!entry.inline;

        let data;
        if (isDefault) {
            data = JSON.parse(JSON.stringify(entry.content || {}));
        } else {
            try {
                data = await fetchFlake(entry.name);
            } catch (err) {
                window.alert(`Failed to load ${entry.name}: ${err.message || err}`);
                return;
            }
        }

        const { directories } = await fetchList(getFamily());
        const result = await openEditModal({
            mode: isDefault ? "default" : "edit",
            name: entry.name,
            data,
            dirs: directories,
        });

        if (!result) return;

        if (result.defaultUpdated) {
            const arr = readEntries();
            arr[idx].content = result.data;
            arr[idx]._edited_at = Date.now();
            arr[idx].has_lora = !!(result.data && (result.data.path || (result.data.loras && result.data.loras.length > 0)));
            writeEntries(arr);
            render();
        } else if (result.deleted) {
            const arr = readEntries().filter((_, i) => i !== idx);
            writeEntries(ensureDefault(arr));
            render();
        } else if (result.saved) {
            const arr = readEntries();
            // The modal already persisted the flake to disk; just refresh the
            // entry's display metadata to reflect the new defaults.
            if (result.name && result.name !== arr[idx].name) arr[idx].name = result.name;
            arr[idx]._edited_at = Date.now();
            arr[idx].flake_type = result.data?.flake_type || null;
            arr[idx].has_lora = !!(result.data && (result.data.path || (result.data.loras && result.data.loras.length > 0)));
            // Clear per-instance overrides so the grid item reflects the new
            // defaults instead of masking them with stale values.
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
            writeEntries(arr);
            render();
        }
    }

    function handleRemove(idx) {
        if (idx === 0) return;
        const arr = readEntries();
        arr.splice(idx, 1);
        writeEntries(arr);
        render();
    }

    function handleToggleBypass(idx) {
        if (idx === 0) return;
        const arr = readEntries();
        arr[idx].bypassed = !arr[idx].bypassed;
        writeEntries(arr);
        render();
    }

    async function handleReplace(idx) {
        if (idx === 0) return;
        const { flakes, directories, display_names } = await fetchList(getFamily());
        const result = await openFileLoadPicker({ flakes, directories, family: getFamily(), displayNames: display_names });
        if (!result || !result.name) return;
        const arr = readEntries();
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
        arr[idx] = { name: result.name, loras, variant: {}, has_lora, display_name, flake_type };
        writeEntries(arr);
        render();
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
        invalidateList(); // ensure the load picker sees the newly created flake
        const arr = readEntries();
        let has_lora = false;
        let display_name = null;
        let loras = [];
        let flake_type = result.data?.flake_type || null;
        if (result.data && (result.data.path || (result.data.loras && result.data.loras.length > 0))) has_lora = true;
        else if (result.name) {
            try { const d = await fetchFlake(result.name); has_lora = !!(d && (d.path || (d.loras && d.loras.length > 0))); flake_type = flake_type || d.flake_type || null; } catch {}
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
        writeEntries(arr);
        render();
    }

    async function handleLoad() {
        const { flakes, directories, display_names } = await fetchList(getFamily());
        const result = await openFileLoadPicker({ flakes, directories, family: getFamily(), displayNames: display_names });
        if (!result || !result.name) return;
        const arr = readEntries();
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
        writeEntries(arr);
        render();
    }

    grid._addBlock = makeAddBlock({ onNew: handleNew, onLoad: handleLoad });

    // Allow dropping after the last item onto the add block
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
        const arr = readEntries();
        const [moved] = arr.splice(dragSrcIdx, 1);
        arr.push(moved);
        writeEntries(arr);
        dragSrcIdx = null;
        render();
    });

    // React to native family widget changes
    if (familyWidget) {
        const origCallback = familyWidget.callback;
        familyWidget.callback = function (value) {
            const r = origCallback?.apply(this, arguments);
            render();
            return r;
        };
    }

    // ---- Widget registration ----
    node._flakes_render = render;
    const flakeWidget = node.addDOMWidget("flakes_ui", "div", container, { serialize: false, margin: 4 });
    flakeWidget.computeSize = () => {
        const rows = Math.max(1, Math.ceil((readEntries().length + 1) / 2));
        return [node.size[0], rows * 84 + 31];
    };
    writeEntries(readEntries());
    render();

    const origOnRemoved = node.onRemoved;
    node.onRemoved = function () {
        clearInterval(_familyPoll);
        return origOnRemoved?.apply(this, arguments);
    };
}
