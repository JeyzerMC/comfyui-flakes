import {
    css, ensureDefault, makeSmallButton, makeAccentButton, svgIcon, makeGridItemOverlay, makeHoverButton, makeTypeRibbon, makeBypassStrike, makeFavoriteStar, TYPE_COLORS,
    _showDropIndicator, _hideDropIndicator, _hideAllDropIndicators, makeAddBlock, flakeDrag, clearFlakeDrag,
    makePanelDropdown, makeSmallValueSlider, renderVariantLoraSliders, variantInitials, renderFlakeLabel, splitNameAndTags,
    _registerOpenPanel, _unregisterOpenPanel, setWidgetHidden, effectiveVariant, variantDropdownOptions, variantDefaultsOf, choiceFlakeLinks, makeImageSection,
    isLocalName, markLocal, SAVE_TO_DISK_SVG,
} from "../utils.js";
import { saveLocalToDisk } from "../bundle.js";
import { fetchList, fetchFlake, getCoverUrl, getVariantImageUrl, fetchFlakeMeta, cachedVariantDefaults, invalidateList, importAnimFlakeApi, pickedImageUrl } from "../api.js";
import { openEditModal } from "../flake-modal.js";
import { openFileLoadPicker, makeItemImagesButton } from "../pickers.js";
import { stackImageJobs } from "../queue.js";

// Append the names of any tag-name LoRAs (#274) to a flake's grid display name,
// e.g. "Askeladd" + a tagged "Some Author Name" -> "Askeladd — Some Author Name".
function appendLoraTags(baseName, loras) {
    if (!baseName || !Array.isArray(loras)) return baseName;
    const tags = loras
        .filter(l => l && l.tag_name && (l.name || "").trim())
        .map(l => l.name.trim());
    return tags.length ? `${baseName} — ${tags.join(", ")}` : baseName;
}

// Grid item [width, height] per kind; animate items are larger to show their
// input image (#441).
const ITEM_SIZE = { img: [90, 100], anim: [104, 128] };

function makeBlock({ entry, idx, kind, onEdit, onRemove, onReplace, onToggleBypass, onDuplicate, onImagesChanged, onDragStart, onDragOver, onDrop, onDragEnd }) {
    const isDefault = !!entry.inline;
    const isBypassed = !!entry.bypassed;
    const isAnim = kind === "anim";
    const hasCover = !isDefault && entry.name;
    const block = document.createElement("div");
    block.dataset.idx = String(idx);
    block.dataset.flakeBlock = "1";

    css(block, `position:relative;height:${ITEM_SIZE[kind][1]}px;background:${
        isDefault ? "#2a3a4a" : isBypassed ? "#1a1a1a" : "#2a2a2a"
    };border:1px solid ${
        isDefault ? "#3a5a8a" : isBypassed ? "#333" : "#444"
    };border-radius:4px;cursor:pointer;font-size:11px;color:#ddd;user-select:none;box-sizing:border-box;${
        hasCover || isAnim ? "background-size:cover;background-position:center;" : ""
    }${isBypassed ? "opacity:0.45;" : ""}`);

    // Cover image — the first input image of an animate item (#441), else an
    // effective variant choice's image when it has one, else the base cover.
    function refreshCover() {
        if (entry.images?.length) {
            block.style.backgroundImage = `url("${pickedImageUrl(entry.images[0])}")`;
            return;
        }
        if (!hasCover) return;
        const baseUrl = getCoverUrl(entry.name);
        const sel = Object.entries(effectiveVariant(entry.variant, cachedVariantDefaults(entry.name)))[0];
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

    // Type ribbon — static; activation is via the top-right checkbox (#314),
    // mirroring Flake Combo / Flake Model Combo.
    if (!isDefault) {
        const ribbon = makeTypeRibbon(entry, isBypassed);
        if (ribbon) {
            ribbon.style.cursor = "default";
            ribbon.title = entry.flake_type;
            block.appendChild(ribbon);
        }
    }

    // Strikethrough for bypassed state
    if (isBypassed && !isDefault) {
        block.appendChild(makeBypassStrike());
    }

    // Enable/disable checkbox (top-right): checked = active, unchecked = bypassed.
    // Replaces the old "click the type tag" toggle (#314).
    if (!isDefault) {
        const toggle = document.createElement("input");
        toggle.type = "checkbox";
        toggle.checked = !isBypassed;
        toggle.title = isBypassed ? "Flake disabled (click to enable)" : "Flake enabled (click to disable)";
        css(toggle, "position:absolute;top:3px;right:3px;z-index:6;cursor:pointer;margin:0;width:14px;height:14px;");
        toggle.addEventListener("click", (e) => { e.stopPropagation(); });
        toggle.addEventListener("mousedown", (e) => e.stopPropagation());
        toggle.addEventListener("dblclick", (e) => e.stopPropagation());
        toggle.addEventListener("change", (e) => { e.stopPropagation(); onToggleBypass(idx); });
        block.appendChild(toggle);
    }

    // Duplicate (») button (bottom-right): adds a copy of this flake beside it so
    // the user can quickly make variations with different overrides (#316).
    if (!isDefault && onDuplicate) {
        const dup = document.createElement("button");
        dup.textContent = "»";
        dup.title = "Duplicate this flake";
        css(dup, "position:absolute;bottom:2px;right:2px;z-index:6;width:16px;height:16px;padding:0;line-height:14px;font-size:12px;font-weight:700;border:none;background:transparent;color:#cfe6ff;cursor:pointer;text-shadow:0 1px 3px rgba(0,0,0,0.9);");
        dup.addEventListener("click", (e) => { e.stopPropagation(); onDuplicate(idx); });
        dup.addEventListener("mousedown", (e) => e.stopPropagation());
        dup.addEventListener("dblclick", (e) => e.stopPropagation());
        block.appendChild(dup);
    }

    if (!isDefault && entry.favorite) {
        const star = makeFavoriteStar();
        // Animate items keep the bottom-left for their input images button.
        if (isAnim) Object.assign(star.style, { left: "auto", right: "20px" });
        block.appendChild(star);
    }
    if (isAnim) block.appendChild(makeItemImagesButton(entry, onImagesChanged));

    // Name — stacked label: name line, dimmer tag line (#297), variant suffix.
    const fullName = isDefault ? "Default" : (entry.display_name || entry.name || "(missing)");
    const nameEl = document.createElement("div");
    css(nameEl, "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:500;text-align:center;line-height:1.2;text-shadow:0 1px 3px rgba(0,0,0,0.8);padding:0 4px;overflow:hidden;z-index:1;word-break:break-word;hyphens:auto;");
    function refreshName() {
        if (isDefault) {
            renderFlakeLabel(nameEl, { name: "Default" });
            return;
        }
        const { name, tags } = splitNameAndTags(fullName, entry.tags);
        const base = name.includes("/") ? name.split("/").pop() : name;
        renderFlakeLabel(nameEl, { name: base, tags, variantText: variantInitials(entry, cachedVariantDefaults(entry.name)) });
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
            ...(isLocalName(entry.name) ? [makeHoverButton({ svg: SAVE_TO_DISK_SVG, title: "Save to disk", onClick: () => saveLocalToDisk(entry.name) })] : []),
        ] : [],
        showTriangle: !isDefault && !!entry.name,
    });
    if (!isDefault && isLocalName(entry.name)) markLocal(block);

    block.addEventListener("dblclick", () => onEdit(idx));
    block.addEventListener("dragover", (e) => onDragOver(e, idx, block));
    block.addEventListener("dragleave", () => { block.style.outline = ""; block.style.boxShadow = ""; });
    block.addEventListener("drop", (e) => onDrop(e, idx, block));

    function refreshVisuals() { refreshName(); refreshCover(); }
    // Default variant choices show once the flake's meta is loaded (#388).
    if (hasCover && !cachedVariantDefaults(entry.name)) fetchFlakeMeta(entry.name).then(refreshVisuals, () => {});

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
    let linkedFlakes = {};

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

            // "All Variants" — generate one output per variant combination (#343).
            const avRow = document.createElement("label");
            css(avRow, "display:flex;align-items:center;justify-content:center;gap:6px;font-size:10px;cursor:pointer;");
            const avChk = document.createElement("input");
            avChk.type = "checkbox";
            avChk.checked = !!entry._all_variants;
            css(avChk, "cursor:pointer;margin:0;");
            const avLbl = document.createElement("span");
            avLbl.textContent = "All Variants";
            avRow.append(avChk, avLbl);
            nativeColumn.appendChild(avRow);

            const groupsWrap = document.createElement("div");
            css(groupsWrap, "display:flex;flex-direction:column;gap:3px;");
            nativeColumn.appendChild(groupsWrap);
            // Per-group choice LoRA sliders, hidden while All Variants is on (#413).
            const variantLoraRenders = [];
            const applyAv = () => {
                groupsWrap.style.opacity = entry._all_variants ? "0.4" : "1";
                groupsWrap.style.pointerEvents = entry._all_variants ? "none" : "auto";
                variantLoraRenders.forEach(r => r());
            };
            avChk.addEventListener("change", () => {
                entry._all_variants = avChk.checked || undefined;
                applyAv();
                rebuildLinkedPanel();
                onChanged();
                if (onVariantChange) onVariantChange();
            });

            for (const group of Object.keys(hasOptions)) {
                const row = document.createElement("div");
                css(row, "display:flex;flex-direction:column;gap:2px;");
                const gLabel = document.createElement("span");
                gLabel.textContent = group;
                css(gLabel, "font-size:9px;opacity:0.7;text-align:center;");
                row.appendChild(gLabel);

                const defaultChoice = (cachedVariantDefaults(entry.name) || {})[group];
                const current = (entry.variant || {})[group] || "";
                const dd = makePanelDropdown(variantDropdownOptions(hasOptions[group], defaultChoice), current === defaultChoice ? "" : current);
                const vlHost = document.createElement("div");
                const renderVl = () => {
                    const ch = (entry.variant || {})[group] || defaultChoice;
                    renderVariantLoraSliders(vlHost, flakeData?.variants, entry, group, entry._all_variants ? null : ch, onChanged);
                };
                variantLoraRenders.push(renderVl);
                dd.element.addEventListener("change", () => {
                    if (dd.element.value) {
                        entry.variant = entry.variant || {};
                        entry.variant[group] = dd.element.value;
                    } else {
                        if (entry.variant) delete entry.variant[group];
                    }
                    renderVl();
                    rebuildLinkedPanel();
                    onChanged();
                    if (onVariantChange) onVariantChange();
                });
                row.append(dd.container, vlHost);
                groupsWrap.appendChild(row);
            }
            applyAv();
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
        const links = flakeData?.flake_links || (flakeData?.flake_link ? [flakeData.flake_link] : []);
        // Then the links of the effective variant choices, under a "<group>: <choice>"
        // heading and overridden in entry.variant_link_overrides (#420).
        const choiceLinks = entry._all_variants ? [] : choiceFlakeLinks(flakeData?.variants, entry.variant)
            .filter(([, , cl]) => cl.some(l => linkedFlakes[l?.target]));
        if (!links.some(l => linkedFlakes[l?.target]) && !choiceLinks.length) {
            linkedColumn.style.display = "none";
            return;
        }
        linkedColumn.style.display = "flex";
        linkedColumn.replaceChildren();

        // Migrate the legacy single override into the per-link array (#234).
        if (!Array.isArray(entry.flake_link_overrides)) {
            entry.flake_link_overrides = entry.flake_link_override ? [entry.flake_link_override] : [];
        }

        const renderLink = (link, overrides, li) => {
            const linkedFlakeData = linkedFlakes[link?.target];
            if (!linkedFlakeData) return;
            overrides[li] = overrides[li] || { variant: {}, lora_strengths: [] };
            const ovr = overrides[li];
            ovr.variant = ovr.variant || {};
            ovr.lora_strengths = ovr.lora_strengths || [];
            const yamlDefaults = link;

            if (li > 0) {
                const gap = document.createElement("div");
                css(gap, "border-top:2px solid #444;margin:4px 0;");
                linkedColumn.appendChild(gap);
            }

            const title = document.createElement("div");
            title.textContent = (linkedFlakeData.name || link.target).split("/").pop();
            title.title = `Linked: ${link.target}`;
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
                const targetDefaults = variantDefaultsOf(linkedVariants);
                for (const group of Object.keys(linkedVariants)) {
                    const targetDefault = targetDefaults[group];
                    const row = document.createElement("div");
                    css(row, "display:flex;flex-direction:column;gap:2px;");
                    const gLabel = document.createElement("span");
                    gLabel.textContent = group;
                    css(gLabel, "font-size:9px;opacity:0.7;text-align:center;");
                    row.appendChild(gLabel);
                    const yamlChoice = (yamlDefaults.variant || {})[group] || "";
                    const current = ovr.variant[group] || yamlChoice;
                    const dd = makePanelDropdown(variantDropdownOptions(Object.keys(linkedVariants[group]), targetDefault), current === targetDefault ? "" : current);
                    // Choice LoRA sliders: override > link yaml > target default choice (#414).
                    const vlHost = document.createElement("div");
                    const renderVl = () => {
                        const ch = ovr.variant[group] || yamlChoice || targetDefault;
                        renderVariantLoraSliders(vlHost, linkedVariants, ovr, group, ch, onChanged, yamlDefaults.variant_loras?.[group]?.[ch] || []);
                    };
                    // "" (the default entry, or None without a default) follows the link
                    // yaml when it is unset; otherwise it must beat the yaml choice (#419).
                    dd.element.addEventListener("change", () => {
                        const value = dd.element.value || (yamlChoice && (targetDefault || "__none__"));
                        if (value) ovr.variant[group] = value;
                        else delete ovr.variant[group];
                        renderVl();
                        onChanged();
                    });
                    row.append(dd.container, vlHost);
                    linkedColumn.appendChild(row);
                    renderVl();
                }
            }

            if (linkedLoras.length === 0 && Object.keys(linkedVariants).length === 0) {
                const empty = document.createElement("div");
                css(empty, "font-size:9px;opacity:0.5;padding:4px;text-align:center;");
                empty.textContent = "no overrides";
                linkedColumn.appendChild(empty);
            }
        };
        links.forEach((link, li) => renderLink(link, entry.flake_link_overrides, li));
        for (const [group, choice, cl] of choiceLinks) {
            const heading = document.createElement("div");
            heading.textContent = `${group}: ${choice}`;
            css(heading, `font-size:9px;opacity:0.8;text-align:center;font-weight:600;padding:2px 0;${linkedColumn.childElementCount ? "border-top:2px solid #444;margin-top:4px;padding-top:6px;" : ""}`);
            linkedColumn.appendChild(heading);
            const overrides = (((entry.variant_link_overrides ||= {})[group] ||= {})[choice] ||= []);
            cl.forEach((link, li) => renderLink(link, overrides, li));
        }
    }

    async function loadOptions() {
        if (optionsLoaded || !entry.name) return;
        try {
            const [variants, fdata] = await Promise.all([fetchFlakeMeta(entry.name), fetchFlake(entry.name)]);
            optionsLoaded = true;
            hasOptions = variants;
            flakeData = fdata;
            // Also fetch each linked flake's data if the host declares links.
            const links = [...(fdata?.flake_links || (fdata?.flake_link ? [fdata.flake_link] : []))];
            for (const choices of Object.values(fdata?.variants || {})) {
                for (const choice of Object.values(choices || {})) links.push(...(choice?.flake_links || []));
            }
            const targets = [...new Set(links.map(l => l?.target).filter(Boolean))];
            linkedFlakes = Object.fromEntries(await Promise.all(targets.map(async t => [t, await fetchFlake(t).catch(() => null)])));
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

// kind "anim": a Flake Animate Stack node (family widget, flake_anim_data
// input, animate flakes).
export function setupFlakeWidget(node, { kind = "img" } = {}) {
    const familyName = kind === "anim" ? "family" : "model_family";
    const dataInput = kind === "anim" ? "flake_anim_data" : "flake_data";
    const flakesHidden = node.widgets?.find(w => w.name === "flakes_json");
    const familyWidget = node.widgets?.find(w => w.name === familyName);
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
        const flakeDataInput = node.inputs?.find(i => i.name === dataInput);
        if (!flakeDataInput || flakeDataInput.link == null) return null;
        const link = node.graph?.links?.[flakeDataInput.link];
        if (!link) return null;
        const upstreamNode = node.graph.getNodeById(link.origin_id);
        if (!upstreamNode) return null;
        const upstreamFamily = upstreamNode.widgets?.find(w => w.name === familyName);
        return upstreamFamily?.value || null;
    }
    function _isFlakeDataConnected() {
        const flakeDataInput = node.inputs?.find(i => i.name === dataInput);
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

    // Toggle-all button (#315): activate/deactivate every flake on the grid at once.
    // Matches the native Generation Data button via the shared helper (#338),
    // centered in the column.
    const { btn: toggleAll, lbl: toggleAllLbl } = makeAccentButton("Activate all");
    toggleAll.style.alignSelf = "center";
    toggleAll.style.margin = "2px 0";
    function setAllActive(active) {
        const arr = readEntries();
        for (let i = 1; i < arr.length; i++) arr[i].bypassed = !active;  // skip inline Default
        writeEntries(arr);
        render();
    }
    function refreshToggleAll() {
        const arr = readEntries().slice(1);
        const allActive = arr.length > 0 && arr.every(e => !e.bypassed);
        toggleAllLbl.textContent = allActive ? "Deactivate all" : "Activate all";
    }
    toggleAll.addEventListener("click", () => {
        const arr = readEntries().slice(1);
        const allActive = arr.length > 0 && arr.every(e => !e.bypassed);
        setAllActive(!allActive);
        refreshToggleAll();
    });
    container.appendChild(toggleAll);

    // Flakes grid
    const [itemW, itemH] = ITEM_SIZE[kind];
    const grid = document.createElement("div");
    css(grid, `display:grid;grid-template-columns:repeat(auto-fill, minmax(${itemW}px, 1fr));gap:4px;`);
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
                kind,
                onEdit: handleEdit,
                onRemove: handleRemove,
                onReplace: handleReplace,
                onToggleBypass: handleToggleBypass,
                onDuplicate: handleDuplicate,
                onImagesChanged: () => { writeEntries(entries); render(); },
                onDragStart: (e, idx, el) => {
                    dragSrcIdx = idx;
                    Object.assign(flakeDrag, { node, entry: entries[idx], take: () => takeDragged(idx), kind });
                    e.dataTransfer.effectAllowed = "move";
                    el.style.opacity = "0.4";
                },
                onDragOver: (e, idx, el) => {
                    if (!isForeignDrag() && (dragSrcIdx === null || idx === 0 || idx === dragSrcIdx)) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    _showDropIndicator(el);
                },
                onDrop: (e, idx, el) => {
                    e.preventDefault();
                    _hideDropIndicator(el);
                    if (isForeignDrag()) {
                        dropForeign(Math.max(idx, 1));  // never displace the inline Default
                        return;
                    }
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
                    clearFlakeDrag();
                    _hideAllDropIndicators();
                },
            });
            makeInstanceControls(blk, entries[i], i, () => writeEntries(entries), triangleBtn, refreshVisuals);
            grid.appendChild(blk);
        }
        if (grid._addBlock) grid.appendChild(grid._addBlock);
        refreshToggleAll();
        refreshPreview();
    }

    // Cross-node drag & drop with other Flake Stack / Flake Combo grids (#415).
    function isForeignDrag() {
        return flakeDrag.node !== null && flakeDrag.node !== node && flakeDrag.kind === kind;
    }

    // The source block leaves the DOM on re-render, so its dragend may never fire.
    function takeDragged(idx) {
        const arr = readEntries();
        arr.splice(idx, 1);
        writeEntries(arr);
        dragSrcIdx = null;
        clearFlakeDrag();
        render();
        node.setDirtyCanvas(true, true);
    }

    function dropForeign(at) {
        const entry = JSON.parse(JSON.stringify(flakeDrag.entry));
        delete entry._uid;
        for (const [group, choice] of Object.entries(entry.variant || {})) {
            if (Array.isArray(choice)) entry.variant[group] = choice[0];
        }
        const arr = readEntries();
        arr.splice(at, 0, entry);
        writeEntries(arr);
        render();
        flakeDrag.take();
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

        const { directories } = await fetchList(getFamily(), kind);
        const result = await openEditModal({
            mode: isDefault ? "default" : "edit",
            name: entry.name,
            data,
            dirs: directories,
            // The inline Default animate flake takes its family from the node.
            family: kind === "anim" ? getFamily() : undefined,
            kind,
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
            arr[idx].favorite = !!result.data?.favorite;
            if (result.data?.name) arr[idx].display_name = appendLoraTags(result.data.name, result.data.loras);
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

    function handleDuplicate(idx) {
        if (idx === 0) return;  // never duplicate the inline Default entry
        const arr = readEntries();
        const copy = JSON.parse(JSON.stringify(arr[idx]));
        arr.splice(idx + 1, 0, copy);
        writeEntries(arr);
        render();
    }

    async function handleReplace(idx) {
        if (idx === 0) return;
        const { flakes, directories, display_names, tag_names, favorites, folder_covers } = await fetchList(getFamily(), kind);
        const result = await openFileLoadPicker({ flakes, directories, family: getFamily(), kind, displayNames: display_names, tagNames: tag_names, favorites, folderCovers: folder_covers });
        if (!result || !result.name) return;
        const arr = readEntries();
        let has_lora = false;
        let display_name = null;
        let flake_type = null;
        let favorite = false;
        let loras = [];
        try {
            const d = await fetchFlake(result.name);
            has_lora = !!(d && (d.path || (d.loras && d.loras.length > 0)));
            display_name = appendLoraTags(d.name || null, d.loras);
            flake_type = d.flake_type || null;
            favorite = !!d.favorite;
            if (d.loras) loras = d.loras.map(l => l.strength ?? 1.0);
            else if (d.path) loras = [d.strength ?? 1.0];
        } catch {}
        arr[idx] = { name: result.name, loras, variant: {}, has_lora, display_name, flake_type, favorite, images: arr[idx].images };
        writeEntries(arr);
        render();
    }

    async function handleNew() {
        const { directories } = await fetchList(getFamily(), kind);
        const result = await openEditModal({
            mode: "create",
            data: {},
            dirs: directories,
            family: getFamily(),
            kind,
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
        display_name = appendLoraTags(display_name, result.data?.loras);
        arr.push({ name: result.name, loras, variant: {}, has_lora, display_name, flake_type, favorite: !!result.data?.favorite });
        writeEntries(arr);
        render();
    }

    async function handleLoad() {
        const { flakes, directories, display_names, tag_names, favorites, folder_covers } = await fetchList(getFamily(), kind);
        const result = await openFileLoadPicker({ flakes, directories, family: getFamily(), kind, displayNames: display_names, tagNames: tag_names, favorites, folderCovers: folder_covers });
        if (!result || !result.name) return;
        await addFlake(result.name);
    }

    // Animate grids: copy a picked image flake into the node's family, edit
    // the copy, then add it like a loaded flake (#433).
    async function handleImport() {
        const { flakes, directories, display_names, tag_names, favorites, folder_covers } = await fetchList("", "img");
        const picked = await openFileLoadPicker({ flakes, directories, displayNames: display_names, tagNames: tag_names, favorites, folderCovers: folder_covers });
        if (!picked || !picked.name) return;
        let name;
        let data;
        try {
            name = await importAnimFlakeApi(picked.name, getFamily());
            data = await fetchFlake(name);
        } catch (err) {
            window.alert(`Failed to import ${picked.name}: ${err.message || err}`);
            return;
        }
        const result = await openEditModal({ mode: "edit", name, data, dirs: (await fetchList(getFamily(), kind)).directories, kind });
        if (result?.deleted) return;
        await addFlake(result?.name || name);
    }

    async function addFlake(name) {
        const arr = readEntries();
        let has_lora = false;
        let display_name = null;
        let flake_type = null;
        let favorite = false;
        let loras = [];
        try {
            const d = await fetchFlake(name);
            has_lora = !!(d && (d.path || (d.loras && d.loras.length > 0)));
            display_name = appendLoraTags(d.name || null, d.loras);
            flake_type = d.flake_type || null;
            favorite = !!d.favorite;
            if (d.loras) loras = d.loras.map(l => l.strength ?? 1.0);
            else if (d.path) loras = [d.strength ?? 1.0];
        } catch {}
        arr.push({ name, loras, variant: {}, has_lora, display_name, flake_type, favorite });
        writeEntries(arr);
        render();
    }

    grid._addBlock = makeAddBlock({ onNew: handleNew, onLoad: handleLoad, onImport: kind === "anim" ? handleImport : null });
    grid._addBlock.style.height = `${itemH}px`;

    // Allow dropping after the last item onto the add block
    grid._addBlock.addEventListener("dragover", (e) => {
        if (dragSrcIdx === null && !isForeignDrag()) return;
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
        if (isForeignDrag()) {
            dropForeign(readEntries().length);
            return;
        }
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

    // Flake Animate Stack: the first job's input image under the grid (#442).
    const preview = kind === "anim" ? makeImageSection({ emptyText: "No input image" }) : null;
    let previewPath;
    if (preview) {
        container.appendChild(preview.el);
        preview.imageEl.addEventListener("load", () => {
            node.setSize([node.size[0], Math.max(node.size[1], node.computeSize()[1])]);
            node.setDirtyCanvas(true, true);
        });
    }
    function refreshPreview() {
        const path = stackImageJobs(node)[0]?.image ?? null;
        if (!preview || path === previewPath) return;
        previewPath = path;
        if (path) preview.show(pickedImageUrl(path), path.split(/[\\/]/).pop(), path);
        else preview.clear();
    }
    // Image scaled to the widget width (6px padding + 4px margin a side), plus
    // the filename and dimension labels; the empty label otherwise.
    function previewHeight() {
        if (!preview) return 0;
        const { naturalWidth: w, naturalHeight: h } = preview.imageEl;
        return previewPath && w ? Math.min(w, node.size[0] - 20) * h / w + 46 : 36;
    }

    // ---- Widget registration ----
    node._flakes_render = render;
    const flakeWidget = node.addDOMWidget("flakes_ui", "div", container, { serialize: false, margin: 4 });
    flakeWidget.computeSize = () => {
        // Match the actual auto-fill column count (minmax item width + 4px gap) so a
        // wide node doesn't over-count rows and pad itself with empty space (#317).
        const cols = Math.max(1, Math.floor((node.size[0] - 16) / (itemW + 4)));
        const rows = Math.max(1, Math.ceil((readEntries().length + 1) / cols));
        return [node.size[0], rows * (itemH + 4) + 55 + previewHeight()];  // +24 for the toggle-all button (#315)
    };
    writeEntries(readEntries());
    render();

    const origOnRemoved = node.onRemoved;
    node.onRemoved = function () {
        clearInterval(_familyPoll);
        return origOnRemoved?.apply(this, arguments);
    };
}
