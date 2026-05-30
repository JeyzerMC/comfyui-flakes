import { openOverlay } from "./modal.js";
import {
    css, makeButton, makeSmallButton, makeComfyLabel, makeComfyInput,
    makeComfyDropdown, makePanelDropdown, makeSearchableDropdown,
    makeComfyNumberInput, makeComfyValueSlider, makeSmallValueSlider,
    makeTextarea, makeLabel, makeNumberInput,
    familyFolder, makeHoverRemoveWrapper,
} from "./utils.js";
import {
    getCoverUrl, getVariantImageUrl, uploadCover, fetchLoras, fetchCnModels, fetchCnTypes, fetchInputs,
    saveFlakeApi, deleteFlakeApi, fetchFlakeMeta, fetchFlake,
    fetchLoraSiblingImage, loraSiblingImageUrl, fetchLoraSiblingImagePath,
    fetchLoraVariantSiblingImagePath, invalidateList,
} from "./api.js";
import { openFileBrowser } from "./pickers.js";

export function openEditModal({ mode, name, data, dirs, family = "SDXL/Base" }) {
    return new Promise((resolve) => {
        let { content, footer, close, handlers, panel } = openOverlay();
        handlers.onClose = (v) => resolve(v ?? null);

        // Dirty-state tracking — flipped on the first interaction inside the
        // modal so a stray outside-click can't silently lose progress.
        let dirty = false;
        const markDirty = () => { dirty = true; };
        panel.addEventListener("input", markDirty, true);
        panel.addEventListener("change", markDirty, true);
        handlers.confirmCancel = async () => {
            if (!dirty) return true;
            return window.confirm("Are you sure you want to cancel? Unsaved changes will be lost.");
        };

        const title = document.createElement("h3");
        css(title, "margin:0 0 8px;font-size:16px;color:#fff;font-weight:500;");
        title.textContent =
            mode === "default" ? "Edit default flake" :
            mode === "create" ? "New flake" :
            `Edit ${name}`;
        content.appendChild(title);

        // ---- Top section: name, path, cover image ----
        const topSection = document.createElement("div");
        css(topSection, "display:flex;gap:12px;align-items:flex-start;");

        const leftCol = document.createElement("div");
        css(leftCol, "flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;");

        let displayNameInput = null;
        let pathInput = null;
        let outputStemInput = null;
        let selectedType = data.flake_type || "";
        const FLAKE_TYPES = ["Style", "Slider", "Character", "Pose", "Concept", "Other"];
        let typeDropdown = null;
        let baseRootSelectRef = null;
        let rootsLoaded = false;

        if (mode !== "default") {
            const nameStemRow = document.createElement("div");
            css(nameStemRow, "display:flex;gap:8px;align-items:flex-start;");
            const nameWrap = document.createElement("div");
            css(nameWrap, "flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;");
            nameWrap.appendChild(makeComfyLabel("Display name"));
            displayNameInput = makeComfyInput(data.name || "", "e.g. My Flake");
            nameWrap.appendChild(displayNameInput);
            nameStemRow.appendChild(nameWrap);
            const stemWrap = document.createElement("div");
            css(stemWrap, "flex:0 0 140px;min-width:0;display:flex;flex-direction:column;gap:4px;");
            stemWrap.appendChild(makeComfyLabel("Output Stem"));
            outputStemInput = makeComfyInput(data.output_stem ?? "", "e.g. musashi/");
            outputStemInput.addEventListener("change", () => {
                fieldState.output_stem = outputStemInput.value || null;
            });
            stemWrap.appendChild(outputStemInput);
            nameStemRow.appendChild(stemWrap);
            leftCol.appendChild(nameStemRow);
        }

        // ---- Base + Flake type on same row ----
        let currentRootPath = "";
        let rootsCache = [];
        let resolvedPathLabel = null;

        function getOutputPrefix() {
            const folder = familyFolder(currentFamily);
            return folder ? `img/${folder}/` : "img/";
        }

        function stripOutputPrefix(val) {
            if (!val) return val;
            const prefixes = ["img/sdxl/", "img/illustrious/", "img/pony/", "img/zib/", "img/zit/", "img/common/", "img/"];
            for (const p of prefixes) {
                if (val.toLowerCase().startsWith(p)) return val.slice(p.length);
            }
            return val;
        }

        function updateResolvedPath() {
            if (!resolvedPathLabel) return;
            const raw = (pathInput?.value || "").trim();
            if (!raw) {
                resolvedPathLabel.textContent = "";
                return;
            }
            const rootPart = currentRootPath ? currentRootPath : "C:/<comfyui_path>/models/flakes/";
            const prefix = getOutputPrefix();
            const fullPath = `${rootPart}${prefix}${raw}.yaml`.replace(/\/\//g, "/");
            resolvedPathLabel.textContent = fullPath;
        }

        if (mode !== "default") {
            const typeRow = document.createElement("div");
            css(typeRow, "display:flex;gap:8px;align-items:flex-start;");
            const baseWrap = document.createElement("div");
            css(baseWrap, "flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;");
            baseWrap.appendChild(makeComfyLabel("Base Directory"));
            const baseRootSelect = document.createElement("select");
            css(baseRootSelect, "width:100%;background:#1a1a1a;color:#ddd;border:1px solid #333;padding:6px 8px;border-radius:6px;font-size:13px;box-sizing:border-box;");
            baseWrap.appendChild(baseRootSelect);
            baseRootSelectRef = baseRootSelect;
            typeRow.appendChild(baseWrap);
            const typeWrap = document.createElement("div");
            css(typeWrap, "flex:0 0 140px;min-width:0;display:flex;flex-direction:column;gap:4px;");
            typeWrap.appendChild(makeComfyLabel("Flake type"));
            typeDropdown = makeComfyDropdown(
                [{ value: "", label: "\u2014" }, ...FLAKE_TYPES.map(t => ({ value: t, label: t }))],
                selectedType,
            );
            typeDropdown.element.addEventListener("change", () => {
                selectedType = typeDropdown.element.value;
                updatePrefillPath();
            });
            typeWrap.appendChild(typeDropdown.container);
            typeRow.appendChild(typeWrap);
            leftCol.appendChild(typeRow);
            (async () => {
                try {
                    const r = await fetch("/flakes/roots?type=flakes");
                    const d = await r.json();
                    const roots = d.roots || [];
                    baseRootSelect.replaceChildren();
                    for (const root of roots) {
                        const opt = document.createElement("option");
                        opt.value = String(root.index);
                        const normalizedPath = (root.path || "").replace(/\\/g, "/").replace(/\/+$/, "");
                        // Abbreviate long paths: keep drive + first two segments + .../models
                        const pathParts = normalizedPath.split("/").filter(Boolean);
                        let shortPath = normalizedPath;
                        if (pathParts.length > 4) {
                            shortPath = `${pathParts[0]}/<...>/${pathParts.slice(-2).join("/")}`;
                        }
                        opt.textContent = `${root.label}: ${shortPath}`;
                        opt.title = `${root.label}: ${root.path}`;
                        baseRootSelect.appendChild(opt);
                    }
                    // Default to the extra model path (index > 0) when available
                    if (roots.length > 1 && mode === "create") {
                        baseRootSelect.value = String(roots[roots.length - 1].index);
                    } else if (mode === "edit" && name) {
                        const rr = await fetch(`/flakes/get?name=${encodeURIComponent(name)}`);
                        if (rr.ok) {
                            const rd = await rr.json();
                            const savedRootIndex = rd.base_root_index;
                            if (savedRootIndex != null && savedRootIndex < roots.length) {
                                baseRootSelect.value = String(savedRootIndex);
                            }
                        }
                    }
                    const rootIdx = parseInt(baseRootSelect.value, 10);
                    const root = (rootsCache.find(r => r.index === rootIdx)) || rootsCache[0];
                    currentRootPath = (root?.path || "").replace(/\\/g, "/").replace(/\/+$/, "") + "/";
                    updateResolvedPath();
                    if (!roots.length) {
                        const opt = document.createElement("option");
                        opt.textContent = "(no roots configured)";
                        opt.value = "0";
                        baseRootSelect.appendChild(opt);
                    }
                } catch { /* ignore */ }
                rootsLoaded = true;
                saveBtn.disabled = false;
            })();

            // ---- Output Path on its own row ----
            const pathRow = document.createElement("div");
            css(pathRow, "display:flex;flex-direction:column;gap:2px;");
            const pathLabel = makeComfyLabel("Output path");
            pathRow.appendChild(pathLabel);
            pathInput = makeComfyInput("", "characters/musashi");
            pathRow.appendChild(pathInput);

            (async () => {
                try {
                    const r = await fetch("/flakes/roots?type=flakes");
                    const d = await r.json();
                    rootsCache = d.roots || [];
                    const rootIdx = parseInt(baseRootSelect?.value || "0", 10);
                    const root = (rootsCache.find(r => r.index === rootIdx)) || rootsCache[0];
                    currentRootPath = (root?.path || "").replace(/\\/g, "/");
                    if (!currentRootPath.endsWith("/")) currentRootPath += "/";
                    updateResolvedPath();
                } catch { /* ignore */ }
            })();

            baseRootSelect.addEventListener("change", () => {
                const rootIdx = parseInt(baseRootSelect.value, 10);
                const root = (rootsCache.find(r => r.index === rootIdx)) || rootsCache[0];
                currentRootPath = (root?.path || "").replace(/\\/g, "/").replace(/\/+$/, "") + "/";
                updateResolvedPath();
            });

            if (mode === "edit" && name) {
                const stripped = stripOutputPrefix(name);
                pathInput.value = stripped;
            }

            leftCol.appendChild(pathRow);

            // Auto-fill path from display name + tag (create mode only)
            let pathManuallyEdited = mode !== "create";
            pathInput.addEventListener("input", () => { pathManuallyEdited = true; updateResolvedPath(); });
            function updatePrefillPath() {
                if (pathManuallyEdited) return;
                const dn = displayNameInput?.value?.trim() || "";
                const tag = selectedType;
                if (!dn && !tag) { pathInput.value = ""; updateResolvedPath(); return; }
                const tagFolder = tag ? tag.toLowerCase() + "s" : "";
                const formatted = dn.replace(/ /g, "_").toLowerCase();
                if (tagFolder && formatted) {
                    pathInput.value = `${tagFolder}/${formatted}`;
                } else {
                    pathInput.value = tagFolder || formatted;
                }
                updateResolvedPath();
            }
            displayNameInput?.addEventListener("input", updatePrefillPath);
        }
        topSection.appendChild(leftCol);

        let coverFile = null;
        let coverSourcePath = data?.cover_image || null;
        let coverImg = null;
        let setCoverFromLora = null;
        let setCoverFromCnImage = null;

        let currentFamily = family;

        function inferFamilyFromPath(path) {
            if (!path) return family;
            const norm = path.replace(/\\/g, "/");
            const FAMILY_PATH_MAP = {
                "img/sdxl/": "SDXL/Base",
                "img/illustrious/": "SDXL/Illustrious",
                "img/pony/": "SDXL/Pony",
                "img/zib/": "ZImage/Base",
                "img/zit/": "ZImage/Turbo",
                "img/common/": "Common",
            };
            for (const [prefix, fam] of Object.entries(FAMILY_PATH_MAP)) {
                if (norm.toLowerCase().startsWith(prefix)) return fam;
            }
            return family;
        }

        if (mode === "edit" && name) {
            currentFamily = inferFamilyFromPath(name);
        }

        function loraBrowserDefaultPath() {
            const folder = familyFolder(currentFamily);
            return folder ? `img/${folder}` : "";
        }
        if (mode === "edit" || mode === "create") {
            const coverWrap = document.createElement("div");
            css(coverWrap, "display:flex;flex-direction:column;align-items:center;gap:4px;");

            const coverBox = document.createElement("div");
            css(coverBox, "position:relative;width:160px;height:200px;border-radius:6px;background:#1a1a1a;border:1px solid #333;display:flex;align-items:center;justify-content:center;cursor:pointer;overflow:hidden;");

            coverImg = document.createElement("img");
            css(coverImg, "width:100%;height:100%;object-fit:cover;display:none;");
            coverBox.appendChild(coverImg);

            const coverLabel = document.createElement("span");
            coverLabel.textContent = "image";
            css(coverLabel, "font-size:10px;color:#666;pointer-events:none;");
            coverBox.appendChild(coverLabel);

            // Hover-only ✕ to remove the cover image (#239). Only visible when
            // a cover is set AND the user is hovering the box.
            const coverRemoveBtn = document.createElement("button");
            coverRemoveBtn.type = "button";
            coverRemoveBtn.textContent = "✕";
            coverRemoveBtn.title = "Remove cover image";
            css(coverRemoveBtn, "position:absolute;top:6px;right:6px;z-index:2;width:22px;height:22px;padding:0;border-radius:4px;background:rgba(20,20,20,0.85);color:#ddd;border:1px solid #555;cursor:pointer;font-size:13px;line-height:1;display:none;align-items:center;justify-content:center;opacity:0;transition:opacity 0.12s ease;");
            coverBox.appendChild(coverRemoveBtn);
            coverBox.addEventListener("mouseenter", () => {
                if (coverImg.style.display === "block") coverRemoveBtn.style.opacity = "1";
            });
            coverBox.addEventListener("mouseleave", () => { coverRemoveBtn.style.opacity = "0"; });
            coverRemoveBtn.addEventListener("click", async (e) => {
                e.stopPropagation();
                // Reset all cover state: any pending upload, the stored source, and the preview.
                coverFile = null;
                coverSourcePath = null;
                updateCoverPreview(null);
                // In edit mode, also delete the file on disk so it doesn't
                // re-appear on next open (the cover image lives next to the
                // yaml, not in the yaml itself).
                if (mode === "edit" && name) {
                    try {
                        await fetch(`/flakes/cover?name=${encodeURIComponent(name)}`, { method: "DELETE" });
                    } catch { /* ignore — preview is already cleared */ }
                }
            });

            const coverInput = document.createElement("input");
            coverInput.type = "file";
            coverInput.accept = ".png,.jpg,.jpeg,.webp,.gif";
            coverInput.style.display = "none";

            function updateCoverPreview(src) {
                if (src) {
                    coverImg.src = src;
                    coverImg.style.display = "block";
                    coverLabel.style.display = "none";
                    coverRemoveBtn.style.display = "flex";
                } else {
                    coverImg.style.display = "none";
                    coverLabel.style.display = "block";
                    coverRemoveBtn.style.display = "none";
                    coverRemoveBtn.style.opacity = "0";
                }
            }

            // Default cover for edit mode
            if (mode === "edit" && name) {
                updateCoverPreview(getCoverUrl(name));
            }

            coverBox.addEventListener("click", () => coverInput.click());
            coverInput.addEventListener("change", () => {
                const file = coverInput.files?.[0];
                if (file) {
                    coverFile = file;
                    const reader = new FileReader();
                    reader.onload = () => updateCoverPreview(reader.result);
                    reader.readAsDataURL(file);
                }
            });

            // Auto-cover from a LoRA's sibling image when no cover has been
            // explicitly chosen yet. Stores the resolved image path (e.g. .png)
            // so the saved YAML never references a .safetensors file.
            setCoverFromLora = async (loraPath) => {
                if (coverFile || coverSourcePath || !loraPath) return false;
                try {
                    const imagePath = await fetchLoraSiblingImagePath(loraPath);
                    if (imagePath) {
                        coverSourcePath = imagePath;
                        updateCoverPreview(loraSiblingImageUrl(loraPath));
                        return true;
                    }
                } catch {
                    return false;
                }
            };

            // Auto-cover from a controlnet input image when no cover has been chosen
            setCoverFromCnImage = (imagePath) => {
                if (coverFile || coverSourcePath || !imagePath) return false;
                coverSourcePath = imagePath;
                updateCoverPreview(`/view?filename=${encodeURIComponent(imagePath)}&type=input`);
                return true;
            };

            coverWrap.appendChild(coverBox);
            coverWrap.appendChild(coverInput);
            topSection.appendChild(coverWrap);

            // Default cover when path changes in create mode
            if (mode === "create" && pathInput) {
                pathInput.addEventListener("input", () => {
                    const p = pathInput.value.trim();
                    if (p && !coverFile) {
                        const prefix = getOutputPrefix();
                        const fullP = prefix + p.replace(/\.ya?ml$/i, ".png");
                        updateCoverPreview(getCoverUrl(fullP));
                    }
                });
            }

            const origClose = close;
            close = async (value) => {
                if (value && (value.created || value.saved) && coverFile) {
                    try {
                        await uploadCover(value.name, coverFile);
                    } catch { /* ignore */ }
                }
                origClose(value);
            };
        }
        content.appendChild(topSection);

        const resolvedPathRow = document.createElement("div");
        resolvedPathLabel = document.createElement("div");
        css(resolvedPathLabel, "font-size:11px;color:#666;word-break:break-all;min-height:0;");
        resolvedPathRow.appendChild(resolvedPathLabel);
        if (mode !== "default") {
            content.appendChild(resolvedPathRow);
        }

        // ---- Separator ----
        const sep = document.createElement("div");
        css(sep, "border-top:1px solid #333;margin:12px 0;");
        content.appendChild(sep);

        // ---- Optional fields state ----
        const fieldState = {
            loras: Array.isArray(data.loras)
                ? JSON.parse(JSON.stringify(data.loras))
                : (data.path ? [{ name: "", url: "", path: data.path, strength: data.strength ?? 1.0 }] : []),
            prompt: (data.prompt?.positive != null || data.prompt?.negative != null)
                ? { positive: data.prompt?.positive ?? null, negative: data.prompt?.negative ?? null }
                : null,
            resolution: data.resolution ? [...data.resolution] : null,
            controlnets: JSON.parse(JSON.stringify(data.controlnets || [])),
            variants: JSON.parse(JSON.stringify(data.variants || data.options || {})),
            output_stem: data.output_stem ?? null,
            // Flake link: yaml defaults — { target, variant, lora_strengths }
            flake_link: data.flake_link ? {
                target: String(data.flake_link.target || ""),
                variant: { ...(data.flake_link.variant || {}) },
                lora_strengths: Array.isArray(data.flake_link.lora_strengths)
                    ? [...data.flake_link.lora_strengths]
                    : [],
            } : null,
        };
        if (!Array.isArray(fieldState.controlnets._)) {
            const arr = Array.isArray(fieldState.controlnets) ? [...fieldState.controlnets] : [];
            fieldState.controlnets = { _: arr };
        }

        // Derive field order from YAML key order (Python preserves insertion order)
        const activeFields = [];
        const knownFieldKeys = { loras: "lora", path: "lora", prompt: "prompt", resolution: "resolution", controlnets: "controlnets", variants: "variants", options: "variants", flake_link: "flake_link" };
        for (const key of Object.keys(data)) {
            const ft = knownFieldKeys[key];
            if (ft && !activeFields.includes(ft)) activeFields.push(ft);
        }
        // Fallback: append any fields that exist but weren't in the key order
        if (!activeFields.includes("lora") && (Array.isArray(data.loras) || data.path)) activeFields.push("lora");
        if (!activeFields.includes("prompt") && fieldState.prompt) activeFields.push("prompt");
        if (!activeFields.includes("resolution") && fieldState.resolution) activeFields.push("resolution");
if (!activeFields.includes("controlnets") && fieldState.controlnets._.length > 0) activeFields.push("controlnets");
            if (!activeFields.includes("variants") && Object.keys(fieldState.variants).length > 0) activeFields.push("variants");
        if (!activeFields.includes("flake_link") && fieldState.flake_link) activeFields.push("flake_link");

        const optionalBox = document.createElement("div");
        css(optionalBox, "display:flex;flex-direction:column;gap:8px;");
        content.appendChild(optionalBox);

        let dragFieldIdx = null;

        function renderFields() {
            optionalBox.replaceChildren();

            for (let fi = 0; fi < activeFields.length; fi++) {
                const fieldType = activeFields[fi];
                const fieldWrap = document.createElement("div");
                css(fieldWrap, "background:#1a1a1a;padding:10px;border-radius:6px;border:1px solid #2a2a2a;display:flex;flex-direction:column;gap:6px;");
                fieldWrap.dataset.fieldIdx = String(fi);

                const header = document.createElement("div");
                css(header, "display:flex;gap:6px;align-items:center;");

                const dragIcon = document.createElement("span");
                dragIcon.textContent = "\u2630";
                css(dragIcon, "cursor:grab;color:#666;font-size:12px;");
                dragIcon.draggable = true;
                dragIcon.addEventListener("dragstart", (e) => {
                    dragFieldIdx = fi;
                    fieldWrap.style.opacity = "0.4";
                    e.dataTransfer.effectAllowed = "move";
                });
                dragIcon.addEventListener("dragend", () => {
                    dragFieldIdx = null;
                    fieldWrap.style.opacity = "";
                    for (const ind of optionalBox.querySelectorAll(".field-drop-indicator")) {
                        ind.remove();
                    }
                });
                header.appendChild(dragIcon);

                const fieldTitle = document.createElement("span");
                fieldTitle.textContent = fieldType.charAt(0).toUpperCase() + fieldType.slice(1);
                css(fieldTitle, "flex:1;font-size:12px;font-weight:500;color:#aaa;");
                header.appendChild(fieldTitle);

                const moveUpBtn = makeSmallButton("\u2191");
                moveUpBtn.title = "Move field up";
                if (fi === 0) {
                    moveUpBtn.disabled = true;
                    moveUpBtn.style.opacity = "0.35";
                    moveUpBtn.style.cursor = "default";
                }
                moveUpBtn.addEventListener("click", (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (fi === 0) return;
                    const tmp = activeFields[fi - 1];
                    activeFields[fi - 1] = activeFields[fi];
                    activeFields[fi] = tmp;
                    renderFields();
                });
                header.appendChild(moveUpBtn);

                const moveDownBtn = makeSmallButton("\u2193");
                moveDownBtn.title = "Move field down";
                if (fi === activeFields.length - 1) {
                    moveDownBtn.disabled = true;
                    moveDownBtn.style.opacity = "0.35";
                    moveDownBtn.style.cursor = "default";
                }
                moveDownBtn.addEventListener("click", (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (fi === activeFields.length - 1) return;
                    const tmp = activeFields[fi + 1];
                    activeFields[fi + 1] = activeFields[fi];
                    activeFields[fi] = tmp;
                    renderFields();
                });
                header.appendChild(moveDownBtn);

                const delFieldBtn = makeSmallButton("\u2715");
                delFieldBtn.addEventListener("click", () => {
                    const idx = activeFields.indexOf(fieldType);
                    if (idx !== -1) activeFields.splice(idx, 1);
                    if (fieldType === "lora") fieldState.loras = [];
                    if (fieldType === "prompt") fieldState.prompt = null;
                    if (fieldType === "resolution") fieldState.resolution = null;
                    if (fieldType === "controlnets") fieldState.controlnets._ = [];
                    if (fieldType === "variants") {
                        for (const k of Object.keys(fieldState.variants)) delete fieldState.variants[k];
                    }
                    if (fieldType === "flake_link") fieldState.flake_link = null;
                    renderFields();
                });
                header.appendChild(delFieldBtn);
                fieldWrap.appendChild(header);

                fieldWrap.addEventListener("dragover", (e) => {
                    if (dragFieldIdx === null || dragFieldIdx === fi) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    for (const ind of optionalBox.querySelectorAll(".field-drop-indicator")) {
                        ind.remove();
                    }
                    const indicator = document.createElement("div");
                    indicator.className = "field-drop-indicator";
                    css(indicator, "height:2px;background:#2a6acf;border-radius:1px;margin:2px 0;");
                    const rect = fieldWrap.getBoundingClientRect();
                    const above = (e.clientY - rect.top) < rect.height / 2;
                    fieldWrap.parentNode.insertBefore(
                        indicator,
                        above ? fieldWrap : fieldWrap.nextSibling,
                    );
                });
                fieldWrap.addEventListener("dragleave", (e) => {
                    // Only clear if leaving the field bounds entirely
                    const rect = fieldWrap.getBoundingClientRect();
                    if (
                        e.clientX < rect.left || e.clientX > rect.right ||
                        e.clientY < rect.top || e.clientY > rect.bottom
                    ) {
                        for (const ind of optionalBox.querySelectorAll(".field-drop-indicator")) {
                            ind.remove();
                        }
                    }
                });
                fieldWrap.addEventListener("drop", (e) => {
                    e.preventDefault();
                    for (const ind of optionalBox.querySelectorAll(".field-drop-indicator")) {
                        ind.remove();
                    }
                    if (dragFieldIdx === null || dragFieldIdx === fi) return;
                    const rect = fieldWrap.getBoundingClientRect();
                    const above = (e.clientY - rect.top) < rect.height / 2;
                    const [movedField] = activeFields.splice(dragFieldIdx, 1);
                    let insertIdx = fi;
                    if (dragFieldIdx < fi) insertIdx--;
                    if (!above) insertIdx++;
                    activeFields.splice(insertIdx, 0, movedField);
                    dragFieldIdx = null;
                    renderFields();
                });

                if (fieldType === "lora") {
                    const loraBox = document.createElement("div");
                    css(loraBox, "display:flex;flex-direction:column;gap:6px;");
                    fieldWrap.appendChild(loraBox);

                    function renderLoras() {
                        loraBox.replaceChildren();
                        for (let i = 0; i < fieldState.loras.length; i++) {
                            const lora = fieldState.loras[i];
                            const card = document.createElement("div");
                            css(card, "background:#252525;padding:10px;border-radius:6px;display:flex;flex-direction:column;gap:6px;border:1px solid #333;");

                            const header = document.createElement("div");
                            css(header, "display:flex;gap:6px;align-items:center;");

                            const dragHandle = document.createElement("span");
                            dragHandle.textContent = "\u2630";
                            css(dragHandle, "cursor:grab;color:#666;font-size:12px;");
                            header.appendChild(dragHandle);

                            const title = document.createElement("span");
                            const titleText = lora.name ? `LoRA: ${lora.name}` : "LoRA";
                            title.textContent = titleText;
                            css(title, "flex:1;font-size:12px;font-weight:500;color:#aaa;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;");
                            header.appendChild(title);

                            if (lora.url) {
                                const linkIcon = document.createElement("a");
                                linkIcon.textContent = "\uD83D\uDD17";
                                css(linkIcon, "font-size:12px;text-decoration:none;cursor:pointer;color:#4a9eff;");
                                linkIcon.addEventListener("click", (e) => {
                                    e.stopPropagation();
                                    window.open(lora.url, "_blank");
                                });
                                header.appendChild(linkIcon);
                            }

                            const editBtn = document.createElement("button");
                            editBtn.innerHTML = lora._editing ? "&#9652;" : "&#9662;";
                            css(editBtn, "background:transparent;color:#888;border:none;padding:0;font-size:14px;cursor:pointer;line-height:1;display:flex;align-items:center;justify-content:center;height:20px;width:20px;");
                            editBtn.title = "Edit name and URL";
                            editBtn.addEventListener("click", () => {
                                lora._editing = !lora._editing;
                                renderLoras();
                            });
                            header.appendChild(editBtn);

                            const removeBtn = makeSmallButton("\u2715");
                            removeBtn.addEventListener("click", () => {
                                fieldState.loras.splice(i, 1);
                                renderLoras();
                            });
                            header.appendChild(removeBtn);

                            card.appendChild(header);

                            if (lora._editing) {
                                const editRow = document.createElement("div");
                                css(editRow, "display:flex;flex-direction:column;gap:4px;");
                                const nameInput = makeComfyInput(lora.name || "", "Display name");
                                nameInput.addEventListener("change", () => {
                                    lora.name = nameInput.value;
                                    renderLoras();
                                });
                                const urlInput = makeComfyInput(lora.url || "", "https://civitai.com/models/...");
                                urlInput.addEventListener("change", () => {
                                    lora.url = urlInput.value;
                                    renderLoras();
                                });
                                editRow.appendChild(makeLabel("Name"));
                                editRow.appendChild(nameInput);
                                editRow.appendChild(makeLabel("URL"));
                                editRow.appendChild(urlInput);
                                card.appendChild(editRow);
                            }

                            const pathRow = document.createElement("div");
                            css(pathRow, "display:flex;gap:4px;align-items:center;");

                            const loraWrap = makeSearchableDropdown([], lora.path || "", "Select LoRA...");
                            loraWrap.container.style.display = "none";
                            (async () => {
                                try {
                                    const loras = await fetchLoras();
                                    for (const l of loras) loraWrap.datalist.appendChild(Object.assign(document.createElement("option"), { value: l }));
                                } catch { /* ignore */ }
                            })();

                            const pathBox = document.createElement("div");
                            css(pathBox, "flex:1;background:#1a1a1a;color:#ddd;border:1px solid #333;padding:6px 8px;border-radius:6px;font-size:13px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;");
                            pathBox.textContent = lora.path ? lora.path.replace(/\.safetensors?$/i, "").split(/[\\/]/).pop() : "No LoRA selected";
                            pathBox.title = lora.path || "";

                            const pathEditBtn = makeSmallButton("...");
                            pathEditBtn.title = "Type manually";

                            pathBox.addEventListener("click", async () => {
                                const result = await openFileBrowser({ type: "loras", defaultPath: loraBrowserDefaultPath() });
                                if (result && result.file) {
                                    lora.path = result.file;
                                    pathBox.textContent = lora.path ? lora.path.replace(/\.safetensors?$/i, "").split(/[\\/]/).pop() : "No LoRA selected";
                                    pathBox.title = lora.path || "";
                                    loraWrap.element.value = lora.path;
                                    if (i === 0 && setCoverFromLora) setCoverFromLora(lora.path);
                                }
                            });

                            pathEditBtn.addEventListener("click", (e) => {
                                e.stopPropagation();
                                pathBox.style.display = "none";
                                pathEditBtn.style.display = "none";
                                loraWrap.container.style.display = "block";
                                loraWrap.element.focus();
                            });

                            loraWrap.element.addEventListener("change", () => {
                                const val = loraWrap.element.value;
                                lora.path = val;
                                pathBox.textContent = val ? val.replace(/\.safetensors?$/i, "").split(/[\\/]/).pop() : "No LoRA selected";
                                pathBox.title = val;
                                pathBox.style.display = "block";
                                pathEditBtn.style.display = "inline-block";
                                loraWrap.container.style.display = "none";
                                if (i === 0 && val && setCoverFromLora) setCoverFromLora(val);
                            });

                            loraWrap.element.addEventListener("blur", () => {
                                setTimeout(() => {
                                    const val = loraWrap.element.value;
                                    lora.path = val;
                                    pathBox.textContent = val ? val.replace(/\.safetensors?$/i, "").split(/[\\/]/).pop() : "No LoRA selected";
                                    pathBox.title = val;
                                    pathBox.style.display = "block";
                                    pathEditBtn.style.display = "inline-block";
                                    loraWrap.container.style.display = "none";
                                    if (i === 0 && val && setCoverFromLora) setCoverFromLora(val);
                                }, 200);
                            });

                            pathRow.appendChild(pathBox);
                            pathRow.appendChild(pathEditBtn);
                            pathRow.appendChild(loraWrap.container);

                            if (lora.path) {
                                const clearBtn = makeSmallButton("\u2715");
                                css(clearBtn, "color:#f88;");
                                clearBtn.addEventListener("click", (e) => {
                                    e.stopPropagation();
                                    lora.path = "";
                                    pathBox.textContent = "No LoRA selected";
                                    pathBox.title = "";
                                    loraWrap.element.value = "";
                                });
                                pathRow.appendChild(clearBtn);
                            }

                            card.appendChild(pathRow);

                            const strSlider = makeComfyValueSlider(lora.strength ?? 1.0, -10, 10, 0.05, (v) => {
                                lora.strength = v;
                            });
                            card.appendChild(strSlider);

                            loraBox.appendChild(card);
                        }

                        const addBtn = makeSmallButton("+ Add LoRA");
                        addBtn.addEventListener("click", () => {
                            fieldState.loras.push({ name: "", url: "", path: "", strength: 1.0 });
                            renderLoras();
                        });
                        loraBox.appendChild(addBtn);
                    }
                    renderLoras();
                }

                if (fieldType === "prompt") {
                    const promptBox = document.createElement("div");
                    css(promptBox, "display:flex;gap:8px;align-items:stretch;");
                    fieldWrap.appendChild(promptBox);

                    const posCol = document.createElement("div");
                    css(posCol, "flex:0 0 70%;display:flex;flex-direction:column;gap:4px;min-width:0;");
                    promptBox.appendChild(posCol);

                    const negCol = document.createElement("div");
                    css(negCol, "flex:0 0 30%;display:flex;flex-direction:column;gap:4px;min-width:0;");
                    promptBox.appendChild(negCol);

                    function renderPrompts() {
                        posCol.replaceChildren();
                        negCol.replaceChildren();

                        if (fieldState.prompt?.positive != null) {
                            const posTA = makeTextarea(fieldState.prompt.positive, "positive prompt", 3);
                            css(posTA, "background:#1a1a1a;color:#ddd;border:1px solid #333;padding:6px;border-radius:4px;font-size:12px;width:100%;box-sizing:border-box;font-family:inherit;resize:vertical;outline:none;");
                            posTA.addEventListener("change", () => { fieldState.prompt.positive = posTA.value; });
                            const posWrap = makeHoverRemoveWrapper(posTA, () => {
                                if (fieldState.prompt.negative == null) {
                                    fieldState.prompt = null;
                                    activeFields.splice(activeFields.indexOf("prompt"), 1);
                                    renderFields();
                                } else {
                                    delete fieldState.prompt.positive;
                                    renderPrompts();
                                }
                            }, "Remove positive prompt");
                            posCol.appendChild(posWrap);
                        } else {
                            const posBtn = document.createElement("button");
                            posBtn.textContent = "+ Positive";
                            css(posBtn, "flex:1;min-height:60px;cursor:pointer;border-radius:4px;font-size:13px;background:#2a2a2a;color:#999;border:1px dashed #555;transition:background 0.15s ease;display:flex;align-items:center;justify-content:center;gap:3px;user-select:none;box-sizing:border-box;white-space:nowrap;padding:0 6px;");
                            posBtn.addEventListener("mouseenter", () => { posBtn.style.background = "#333"; });
                            posBtn.addEventListener("mouseleave", () => { posBtn.style.background = "#2a2a2a"; });
                            posBtn.addEventListener("click", () => {
                                if (!fieldState.prompt) fieldState.prompt = {};
                                fieldState.prompt.positive = fieldState.prompt.positive ?? "";
                                renderPrompts();
                            });
                            posCol.appendChild(posBtn);
                        }

                        if (fieldState.prompt?.negative != null) {
                            const negTA = makeTextarea(fieldState.prompt.negative, "negative prompt", 2);
                            css(negTA, "background:#1a1a1a;color:#ddd;border:1px solid #333;padding:6px;border-radius:4px;font-size:12px;width:100%;box-sizing:border-box;font-family:inherit;resize:vertical;outline:none;");
                            negTA.addEventListener("change", () => { fieldState.prompt.negative = negTA.value; });
                            const negWrap = makeHoverRemoveWrapper(negTA, () => {
                                if (fieldState.prompt.positive == null) {
                                    fieldState.prompt = null;
                                    activeFields.splice(activeFields.indexOf("prompt"), 1);
                                    renderFields();
                                } else {
                                    delete fieldState.prompt.negative;
                                    renderPrompts();
                                }
                            }, "Remove negative prompt");
                            negCol.appendChild(negWrap);
                        } else {
                            const negBtn = document.createElement("button");
                            negBtn.textContent = "+ Negative";
                            css(negBtn, "flex:1;min-height:60px;cursor:pointer;border-radius:4px;font-size:13px;background:#2a2a2a;color:#999;border:1px dashed #555;transition:background 0.15s ease;display:flex;align-items:center;justify-content:center;gap:3px;user-select:none;box-sizing:border-box;white-space:nowrap;padding:0 6px;");
                            negBtn.addEventListener("mouseenter", () => { negBtn.style.background = "#333"; });
                            negBtn.addEventListener("mouseleave", () => { negBtn.style.background = "#2a2a2a"; });
                            negBtn.addEventListener("click", () => {
                                if (!fieldState.prompt) fieldState.prompt = {};
                                fieldState.prompt.negative = fieldState.prompt.negative ?? "";
                                renderPrompts();
                            });
                            negCol.appendChild(negBtn);
                        }
                    }
                    renderPrompts();
                }

                if (fieldType === "resolution") {
                    const row = document.createElement("div");
                    css(row, "display:flex;gap:8px;align-items:center;");
                    const wInput = makeComfyNumberInput(fieldState.resolution?.[0] || "", "width", 64);
                    const hInput = makeComfyNumberInput(fieldState.resolution?.[1] || "", "height", 64);
                    const syncResolution = () => {
                        const rw = parseInt(wInput.value);
                        const rh = parseInt(hInput.value);
                        if (Number.isFinite(rw) && Number.isFinite(rh)) {
                            fieldState.resolution = [rw, rh];
                        } else if (!fieldState.resolution) {
                            fieldState.resolution = [1024, 1024];
                        }
                    };
                    // Listen on both input (real-time) and change (blur) so save
                    // sees the latest typed values even without losing focus first.
                    wInput.addEventListener("input", syncResolution);
                    wInput.addEventListener("change", syncResolution);
                    hInput.addEventListener("input", syncResolution);
                    hInput.addEventListener("change", syncResolution);
                    // Expose the inputs on fieldState so the save handler can read
                    // them directly as a belt-and-braces fallback.
                    fieldState._resolutionInputs = { w: wInput, h: hInput };
                    const xLabel = document.createElement("span");
                    xLabel.textContent = "\u00d7";
                    css(xLabel, "color:#888;font-size:13px;");
                    row.appendChild(wInput);
                    row.appendChild(xLabel);
                    row.appendChild(hInput);
                    fieldWrap.appendChild(row);
                }

                if (fieldType === "controlnets") {
                    const cnsBox = document.createElement("div");
                    css(cnsBox, "display:flex;flex-direction:column;gap:6px;");
                    fieldWrap.appendChild(cnsBox);

                    function renderCNs() {
                        cnsBox.replaceChildren();
                        const arr = fieldState.controlnets._ || [];
                        for (let i = 0; i < arr.length; i++) {
                            const cn = arr[i];
                            const card = document.createElement("div");
                            css(card, "background:#252525;padding:10px;border-radius:6px;display:flex;flex-direction:row;gap:10px;border:1px solid #333;");

                            // Left: input image with file picker
                            const imageCol = document.createElement("div");
                            css(imageCol, "display:flex;flex-direction:column;align-items:center;gap:4px;flex:0 0 auto;");

                            const imgBox = document.createElement("div");
                            css(imgBox, "width:80px;height:80px;border-radius:4px;background:#1a1a1a;border:1px solid #333;display:flex;align-items:center;justify-content:center;cursor:pointer;overflow:hidden;");
                            const imgPreview = document.createElement("img");
                            css(imgPreview, "width:100%;height:100%;object-fit:cover;display:none;");
                            imgBox.appendChild(imgPreview);
                            const imgLabel = document.createElement("span");
                            imgLabel.textContent = "image";
                            css(imgLabel, "font-size:10px;color:#666;pointer-events:none;");
                            imgBox.appendChild(imgLabel);

                            const imgFileInput = document.createElement("input");
                            imgFileInput.type = "file";
                            imgFileInput.accept = ".png,.jpg,.jpeg,.webp,.gif";
                            imgFileInput.style.display = "none";

                            const cnImagePath = cn.image || cn.image_name || "";

                            function updateCnImgPreview(src) {
                                if (src) {
                                    imgPreview.src = src;
                                    imgPreview.style.display = "block";
                                    imgLabel.style.display = "none";
                                } else {
                                    imgPreview.style.display = "none";
                                    imgLabel.style.display = "block";
                                }
                            }

                            if (cnImagePath) {
                                updateCnImgPreview(`/view?filename=${encodeURIComponent(cnImagePath)}&type=input`);
                            }

                            imgBox.addEventListener("click", async () => {
                                const fileInput = document.createElement("input");
                                fileInput.type = "file";
                                fileInput.accept = ".png,.jpg,.jpeg,.webp,.gif,.bmp";
                                fileInput.style.display = "none";
                                document.body.appendChild(fileInput);
                                fileInput.click();
                                await new Promise((resolve) => {
                                    fileInput.addEventListener("change", async () => {
                                        const file = fileInput.files?.[0];
                                        if (file) {
                                            try {
                                                const form = new FormData();
                                                form.append("image", file);
                                                form.append("type", "input");
                                                form.append("overwrite", "true");
                                                const resp = await fetch("/upload/image", { method: "POST", body: form });
                                                const result = await resp.json();
                                                const fileName = result.name || file.name;
                                                arr[i].image = fileName;
                                                updateCnImgPreview(`/view?filename=${encodeURIComponent(fileName)}&type=input`);
                                                if (!coverFile && !coverSourcePath && setCoverFromCnImage) setCoverFromCnImage(fileName);
                                            } catch { /* ignore */ }
                                        }
                                        document.body.removeChild(fileInput);
                                        resolve();
                                    });
                                });
                            });

                            imgFileInput.addEventListener("change", () => {
                                const file = imgFileInput.files?.[0];
                                if (file) {
                                    const reader = new FileReader();
                                    reader.onload = () => {
                                        updateCnImgPreview(reader.result);
                                    };
                                    reader.readAsDataURL(file);
                                }
                            });

                            imageCol.appendChild(imgBox);
                            imageCol.appendChild(imgFileInput);
                            card.appendChild(imageCol);

                            // Right: type, model, sliders
                            const rightCol = document.createElement("div");
                            css(rightCol, "flex:1;min-width:0;display:flex;flex-direction:column;gap:6px;");

                            // Row 1: Type dropdown + remove button
                            const typeRow = document.createElement("div");
                            css(typeRow, "display:flex;gap:4px;align-items:center;");

                            const typeDropdown = makeComfyDropdown(
                                [{ value: "", label: "\u2014 type \u2014" }],
                                cn.type || "",
                            );
                            (async () => {
                                try {
                                    const types = await fetchCnTypes();
                                    for (const t of types) {
                                        const o = document.createElement("option");
                                        o.value = t;
                                        o.textContent = t;
                                        if (t === cn.type) o.selected = true;
                                        typeDropdown.element.appendChild(o);
                                    }
                                } catch { /* ignore */ }
                            })();
                            typeDropdown.element.addEventListener("change", () => { arr[i].type = typeDropdown.element.value; });
                            typeDropdown.container.style.flex = "1";
                            typeRow.appendChild(typeDropdown.container);

                            const removeBtn = makeSmallButton("\u2715");
                            removeBtn.addEventListener("click", () => { arr.splice(i, 1); renderCNs(); });
                            typeRow.appendChild(removeBtn);
                            rightCol.appendChild(typeRow);

                            // Row 2: Model file
                            const modelRow = document.createElement("div");
                            css(modelRow, "display:flex;gap:4px;align-items:center;");

                            const modelInput = makeComfyInput(cn.model || cn.model_name || "", "model file");
                            const cnModelListId = `cnm-${Math.random().toString(36).slice(2)}`;
                            const cnModelList = document.createElement("datalist");
                            cnModelList.id = cnModelListId;
                            modelInput.setAttribute("list", cnModelListId);
                            modelInput.addEventListener("change", () => { arr[i].model = modelInput.value; });
                            modelInput.style.flex = "1";
                            modelRow.appendChild(modelInput);
                            modelRow.appendChild(cnModelList);
                            (async () => {
                                try {
                                    const cns = await fetchCnModels();
                                    for (const c of cns) { const o = document.createElement("option"); o.value = c; cnModelList.appendChild(o); }
                                } catch { /* ignore */ }
                            })();
                            rightCol.appendChild(modelRow);

                            // Row 3: Sliders
                            const slidersRow = document.createElement("div");
                            css(slidersRow, "display:flex;gap:4px;align-items:center;");

                            const strLabel = document.createElement("span");
                            strLabel.textContent = "Str";
                            css(strLabel, "font-size:10px;color:#888;flex-shrink:0;");
                            slidersRow.appendChild(strLabel);
                            const strSlider = makeComfyValueSlider(cn.strength ?? 1.0, 0, 2, 0.05, (v) => {
                                arr[i].strength = v;
                            });
                            strSlider.style.flex = "1";
                            slidersRow.appendChild(strSlider);

                            const startLabel = document.createElement("span");
                            startLabel.textContent = "Start";
                            css(startLabel, "font-size:10px;color:#888;flex-shrink:0;");
                            slidersRow.appendChild(startLabel);
                            const startSlider = makeComfyValueSlider(cn.start_percent ?? 0, 0, 1, 0.05, (v) => {
                                arr[i].start_percent = v;
                            });
                            startSlider.style.flex = "1";
                            slidersRow.appendChild(startSlider);

                            const endLabel = document.createElement("span");
                            endLabel.textContent = "End";
                            css(endLabel, "font-size:10px;color:#888;flex-shrink:0;");
                            slidersRow.appendChild(endLabel);
                            const endSlider = makeComfyValueSlider(cn.end_percent ?? 1, 0, 1, 0.05, (v) => {
                                arr[i].end_percent = v;
                            });
                            endSlider.style.flex = "1";
                            slidersRow.appendChild(endSlider);

                            rightCol.appendChild(slidersRow);
                            card.appendChild(rightCol);
                            cnsBox.appendChild(card);
                        }

                        const addBtn = makeSmallButton("+ controlnet");
                        addBtn.addEventListener("click", () => {
                            arr.push({ type: "", model: "", image: "", strength: 1.0, start_percent: 0, end_percent: 1 });
                            renderCNs();
                        });
                        cnsBox.appendChild(addBtn);
                    }
                    renderCNs();
                }

                if (fieldType === "variants") {
                    const optsBox = document.createElement("div");
                    css(optsBox, "display:flex;flex-direction:column;gap:8px;");
                    fieldWrap.appendChild(optsBox);

                    function renderOpts() {
                        optsBox.replaceChildren();
                        for (const groupName of Object.keys(fieldState.variants)) {
                            const groupCard = document.createElement("div");
                            css(groupCard, "background:#252525;padding:10px;border-radius:6px;display:flex;flex-direction:column;gap:6px;border:1px solid #333;");

                            const headerRow = document.createElement("div");
                            css(headerRow, "display:flex;gap:6px;align-items:center;");
                            const groupNameInput = makeComfyInput(groupName, "group name");
                            groupNameInput.style.flex = "1";
                            const removeGroupBtn = makeSmallButton("\u2715 group");
                            groupNameInput.addEventListener("change", () => {
                                const newName = groupNameInput.value.trim();
                                if (!newName || newName === groupName) return;
                                if (fieldState.variants[newName]) { groupNameInput.value = groupName; return; }
                                fieldState.variants[newName] = fieldState.variants[groupName];
                                delete fieldState.variants[groupName];
                                renderOpts();
                            });
                            removeGroupBtn.addEventListener("click", () => {
                                delete fieldState.variants[groupName];
                                renderOpts();
                            });
                            headerRow.appendChild(groupNameInput);
                            headerRow.appendChild(removeGroupBtn);
                            groupCard.appendChild(headerRow);

                            let dragChoiceName = null;
                            const choiceNames = Object.keys(fieldState.variants[groupName] || {});
                            for (const choiceName of choiceNames) {
                                const choice = fieldState.variants[groupName][choiceName] || {};
                                const choiceCard = document.createElement("div");
                                css(choiceCard, "background:#1a1a1a;padding:8px;border-radius:4px;display:flex;flex-direction:column;gap:4px;");

                                // Header: drag handle + name (50%) + stem (50%)
                                const cRow = document.createElement("div");
                                css(cRow, "display:flex;gap:4px;align-items:center;");

                                const dragHandle = document.createElement("span");
                                dragHandle.textContent = "\u2630";
                                css(dragHandle, "cursor:grab;color:#666;font-size:12px;padding:0 4px;user-select:none;");
                                dragHandle.draggable = true;
                                dragHandle.addEventListener("dragstart", (e) => {
                                    dragChoiceName = choiceName;
                                    choiceCard.style.opacity = "0.4";
                                    e.dataTransfer.effectAllowed = "move";
                                });
                                dragHandle.addEventListener("dragend", () => {
                                    dragChoiceName = null;
                                    choiceCard.style.opacity = "";
                                    for (const ind of optsBox.querySelectorAll(".choice-drop-indicator")) ind.remove();
                                });
                                cRow.appendChild(dragHandle);

                                const cNameInput = makeComfyInput(choiceName, "choice name");
                                cNameInput.style.flex = "1 1 50%";
                                cNameInput.style.minWidth = "0";
                                cNameInput.addEventListener("change", () => {
                                    const newCName = cNameInput.value.trim();
                                    if (!newCName || newCName === choiceName) return;
                                    if (fieldState.variants[groupName][newCName]) { cNameInput.value = choiceName; return; }
                                    const newObj = {};
                                    for (const [k, v] of Object.entries(fieldState.variants[groupName])) {
                                        newObj[k === choiceName ? newCName : k] = v;
                                    }
                                    fieldState.variants[groupName] = newObj;
                                    renderOpts();
                                });
                                cRow.appendChild(cNameInput);

                                // Output stem on the same row (per #212).
                                const stemInput = makeComfyInput(choice.output_stem ?? "", "output stem");
                                stemInput.style.flex = "1 1 50%";
                                stemInput.style.minWidth = "0";
                                stemInput.title = "Output stem (appended to the flake's output path for this variant choice)";
                                stemInput.addEventListener("change", () => {
                                    fieldState.variants[groupName][choiceName] = fieldState.variants[groupName][choiceName] || {};
                                    fieldState.variants[groupName][choiceName].output_stem = stemInput.value || null;
                                });
                                cRow.appendChild(stemInput);
                                choiceCard.appendChild(cRow);

                                // Drop indicator wiring on the card itself.
                                choiceCard.addEventListener("dragover", (e) => {
                                    if (dragChoiceName === null || dragChoiceName === choiceName) return;
                                    e.preventDefault();
                                    e.dataTransfer.dropEffect = "move";
                                    for (const ind of optsBox.querySelectorAll(".choice-drop-indicator")) ind.remove();
                                    const indicator = document.createElement("div");
                                    indicator.className = "choice-drop-indicator";
                                    css(indicator, "height:2px;background:#2a6acf;border-radius:1px;margin:2px 0;");
                                    const rect = choiceCard.getBoundingClientRect();
                                    const above = (e.clientY - rect.top) < rect.height / 2;
                                    choiceCard.parentNode.insertBefore(indicator, above ? choiceCard : choiceCard.nextSibling);
                                });
                                choiceCard.addEventListener("dragleave", (e) => {
                                    const rect = choiceCard.getBoundingClientRect();
                                    if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
                                        for (const ind of optsBox.querySelectorAll(".choice-drop-indicator")) ind.remove();
                                    }
                                });
                                choiceCard.addEventListener("drop", (e) => {
                                    e.preventDefault();
                                    for (const ind of optsBox.querySelectorAll(".choice-drop-indicator")) ind.remove();
                                    if (dragChoiceName === null || dragChoiceName === choiceName) return;
                                    const rect = choiceCard.getBoundingClientRect();
                                    const above = (e.clientY - rect.top) < rect.height / 2;
                                    const keys = Object.keys(fieldState.variants[groupName]);
                                    const srcIdx = keys.indexOf(dragChoiceName);
                                    let dstIdx = keys.indexOf(choiceName);
                                    if (srcIdx < 0 || dstIdx < 0) return;
                                    keys.splice(srcIdx, 1);
                                    if (srcIdx < dstIdx) dstIdx--;
                                    if (!above) dstIdx++;
                                    keys.splice(dstIdx, 0, dragChoiceName);
                                    const newObj = {};
                                    for (const k of keys) newObj[k] = fieldState.variants[groupName][k];
                                    fieldState.variants[groupName] = newObj;
                                    dragChoiceName = null;
                                    renderOpts();
                                });

                                // Per #238: card body is one row with name+stem header + tall prompts on
                                // the left and a portrait (832x1216) image with a hover delete dropdown
                                // on the right.
                                if (cRow.parentNode === choiceCard) choiceCard.removeChild(cRow);

                                const bodyRow = document.createElement("div");
                                css(bodyRow, "display:flex;gap:10px;align-items:stretch;");

                                const leftCol = document.createElement("div");
                                css(leftCol, "flex:1;min-width:0;display:flex;flex-direction:column;gap:6px;");
                                leftCol.appendChild(cRow);

                                const promptsWrap = document.createElement("div");
                                css(promptsWrap, "display:flex;gap:8px;align-items:stretch;flex:1;min-height:0;");
                                leftCol.appendChild(promptsWrap);

                                const choicePosCol = document.createElement("div");
                                css(choicePosCol, "flex:0 0 70%;display:flex;flex-direction:column;gap:4px;min-width:0;min-height:0;");
                                promptsWrap.appendChild(choicePosCol);

                                const choiceNegCol = document.createElement("div");
                                css(choiceNegCol, "flex:0 0 30%;display:flex;flex-direction:column;gap:4px;min-width:0;min-height:0;");
                                promptsWrap.appendChild(choiceNegCol);

                                const rightCol = document.createElement("div");
                                css(rightCol, "flex:0 0 auto;display:flex;flex-direction:column;align-items:center;gap:4px;");

                                // 832x1216 aspect (~0.684). At 160px wide -> 234px tall.
                                const IMG_W = 160, IMG_H = 234;
                                const imgBox = document.createElement("div");
                                css(imgBox, `position:relative;width:${IMG_W}px;height:${IMG_H}px;border-radius:4px;background:#1a1a1a;border:1px solid #333;display:flex;align-items:center;justify-content:center;cursor:pointer;overflow:hidden;flex-shrink:0;`);
                                const imgPreview = document.createElement("img");
                                css(imgPreview, "width:100%;height:100%;object-fit:cover;display:none;");
                                imgBox.appendChild(imgPreview);
                                const imgBoxLabel = document.createElement("span");
                                imgBoxLabel.textContent = "image";
                                css(imgBoxLabel, "font-size:11px;color:#666;pointer-events:none;");
                                imgBox.appendChild(imgBoxLabel);

                                // Hover-only delete button (top-right of image) -> dropdown menu (#238).
                                let _dropdownOpen = false;
                                const deleteBtn = document.createElement("button");
                                deleteBtn.type = "button";
                                deleteBtn.textContent = "✕";
                                deleteBtn.title = "Delete options";
                                css(deleteBtn, "position:absolute;top:6px;right:6px;z-index:2;width:22px;height:22px;padding:0;border-radius:4px;background:rgba(20,20,20,0.85);color:#ddd;border:1px solid #555;cursor:pointer;font-size:13px;line-height:1;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity 0.12s ease;");
                                imgBox.addEventListener("mouseenter", () => { deleteBtn.style.opacity = "1"; });
                                imgBox.addEventListener("mouseleave", () => { if (!_dropdownOpen) deleteBtn.style.opacity = "0"; });
                                imgBox.appendChild(deleteBtn);

                                const dropdown = document.createElement("div");
                                css(dropdown, "position:absolute;top:32px;right:6px;z-index:3;display:none;flex-direction:column;min-width:160px;background:#1f1f1f;border:1px solid #555;border-radius:4px;box-shadow:0 4px 12px rgba(0,0,0,0.5);overflow:hidden;");
                                function makeDropdownItem(label, onClick, danger) {
                                    const item = document.createElement("button");
                                    item.type = "button";
                                    item.textContent = label;
                                    css(item, `background:transparent;border:none;color:${danger ? "#f99" : "#ddd"};padding:8px 12px;text-align:left;font-size:12px;cursor:pointer;`);
                                    item.addEventListener("mouseenter", () => { item.style.background = "rgba(255,255,255,0.05)"; });
                                    item.addEventListener("mouseleave", () => { item.style.background = "transparent"; });
                                    item.addEventListener("click", (e) => { e.stopPropagation(); closeDropdown(); onClick(); });
                                    return item;
                                }
                                function refreshDropdown() {
                                    dropdown.replaceChildren();
                                    const cur = fieldState.variants[groupName][choiceName] || {};
                                    if (cur.image) {
                                        dropdown.appendChild(makeDropdownItem("Remove image", () => {
                                            delete cur.image;
                                            refreshChoiceImage();
                                        }, false));
                                    }
                                    dropdown.appendChild(makeDropdownItem("Delete choice", () => {
                                        delete fieldState.variants[groupName][choiceName];
                                        renderOpts();
                                    }, true));
                                }
                                function openDropdown() {
                                    refreshDropdown();
                                    dropdown.style.display = "flex";
                                    _dropdownOpen = true;
                                    setTimeout(() => document.addEventListener("mousedown", outsideClick), 0);
                                }
                                function closeDropdown() {
                                    dropdown.style.display = "none";
                                    _dropdownOpen = false;
                                    deleteBtn.style.opacity = "0";
                                    document.removeEventListener("mousedown", outsideClick);
                                }
                                function outsideClick(e) {
                                    if (!dropdown.contains(e.target) && e.target !== deleteBtn) closeDropdown();
                                }
                                deleteBtn.addEventListener("click", (e) => {
                                    e.stopPropagation();
                                    if (_dropdownOpen) closeDropdown(); else openDropdown();
                                });
                                imgBox.appendChild(dropdown);

                                function refreshChoiceImage() {
                                    const cur = fieldState.variants[groupName][choiceName] || {};
                                    if (cur.image) {
                                        if (cur._uploaded) {
                                            imgPreview.src = `/view?filename=${encodeURIComponent(cur.image)}&type=input`;
                                        } else if (mode !== "create" && name) {
                                            imgPreview.src = getVariantImageUrl(name, groupName, choiceName);
                                        } else {
                                            imgPreview.src = `/view?filename=${encodeURIComponent(cur.image)}&type=input`;
                                        }
                                        imgPreview.style.display = "block";
                                        imgBoxLabel.style.display = "none";
                                    } else {
                                        imgPreview.style.display = "none";
                                        imgBoxLabel.style.display = "block";
                                    }
                                }
                                imgBox.addEventListener("click", async (e) => {
                                    // Skip the file picker when the user clicks the delete button or its
                                    // dropdown — those have their own handlers.
                                    if (e.target === deleteBtn || dropdown.contains(e.target)) return;
                                    const fileInput = document.createElement("input");
                                    fileInput.type = "file";
                                    fileInput.accept = ".png,.jpg,.jpeg,.webp,.gif,.bmp";
                                    fileInput.style.display = "none";
                                    document.body.appendChild(fileInput);
                                    fileInput.click();
                                    await new Promise((resolve) => {
                                        fileInput.addEventListener("change", async () => {
                                            const file = fileInput.files?.[0];
                                            if (!file) { document.body.removeChild(fileInput); resolve(); return; }
                                            try {
                                                const form = new FormData();
                                                form.append("image", file);
                                                form.append("type", "input");
                                                form.append("overwrite", "true");
                                                const resp = await fetch("/upload/image", { method: "POST", body: form });
                                                const result = await resp.json();
                                                const fileName = result.name || file.name;
                                                fieldState.variants[groupName][choiceName] = fieldState.variants[groupName][choiceName] || {};
                                                fieldState.variants[groupName][choiceName].image = fileName;
                                                fieldState.variants[groupName][choiceName]._uploaded = true;
                                                refreshChoiceImage();
                                            } catch { /* ignore */ }
                                            document.body.removeChild(fileInput);
                                            resolve();
                                        });
                                    });
                                });
                                rightCol.appendChild(imgBox);
                                refreshChoiceImage();

                                bodyRow.appendChild(leftCol);
                                bodyRow.appendChild(rightCol);
                                choiceCard.appendChild(bodyRow);

                                function renderChoicePrompts() {
                                    choicePosCol.replaceChildren();
                                    choiceNegCol.replaceChildren();

                                    if (choice.positive != null) {
                                        const cPos = makeTextarea(choice.positive || "", "extra positive", 2);
                                        // Fill column height (the column matches the image height via align-items:stretch on bodyRow).
                                        css(cPos, "background:#1a1a1a;color:#ddd;border:1px solid #333;padding:6px;border-radius:4px;font-size:12px;width:100%;height:100%;flex:1;min-height:0;box-sizing:border-box;font-family:inherit;resize:vertical;outline:none;");
                                        cPos.addEventListener("change", () => {
                                            fieldState.variants[groupName][choiceName] = fieldState.variants[groupName][choiceName] || {};
                                            fieldState.variants[groupName][choiceName].positive = cPos.value;
                                        });
                                        const posWrap = makeHoverRemoveWrapper(cPos, () => {
                                            delete fieldState.variants[groupName][choiceName].positive;
                                            renderChoicePrompts();
                                        }, "Remove positive prompt");
                                        css(posWrap, "min-height:0;");
                                        choicePosCol.appendChild(posWrap);
                                    } else {
                                        const posBtn = document.createElement("button");
                                        posBtn.textContent = "+ Positive";
                                        css(posBtn, "flex:1;min-height:50px;cursor:pointer;border-radius:4px;font-size:13px;background:#2a2a2a;color:#999;border:1px dashed #555;transition:background 0.15s ease;display:flex;align-items:center;justify-content:center;gap:3px;user-select:none;box-sizing:border-box;white-space:nowrap;padding:0 6px;");
                                        posBtn.addEventListener("mouseenter", () => { posBtn.style.background = "#333"; });
                                        posBtn.addEventListener("mouseleave", () => { posBtn.style.background = "#2a2a2a"; });
                                        posBtn.addEventListener("click", () => {
                                            fieldState.variants[groupName][choiceName] = fieldState.variants[groupName][choiceName] || {};
                                            fieldState.variants[groupName][choiceName].positive = fieldState.variants[groupName][choiceName].positive ?? "";
                                            renderChoicePrompts();
                                        });
                                        choicePosCol.appendChild(posBtn);
                                    }

                                    if (choice.negative != null) {
                                        const cNeg = makeTextarea(choice.negative || "", "extra negative", 2);
                                        css(cNeg, "background:#1a1a1a;color:#ddd;border:1px solid #333;padding:6px;border-radius:4px;font-size:12px;width:100%;height:100%;flex:1;min-height:0;box-sizing:border-box;font-family:inherit;resize:vertical;outline:none;");
                                        cNeg.addEventListener("change", () => {
                                            fieldState.variants[groupName][choiceName] = fieldState.variants[groupName][choiceName] || {};
                                            fieldState.variants[groupName][choiceName].negative = cNeg.value;
                                        });
                                        const negWrap = makeHoverRemoveWrapper(cNeg, () => {
                                            delete fieldState.variants[groupName][choiceName].negative;
                                            renderChoicePrompts();
                                        }, "Remove negative prompt");
                                        css(negWrap, "min-height:0;");
                                        choiceNegCol.appendChild(negWrap);
                                    } else {
                                        const negBtn = document.createElement("button");
                                        negBtn.textContent = "+ Negative";
                                        css(negBtn, "flex:1;min-height:50px;cursor:pointer;border-radius:4px;font-size:13px;background:#2a2a2a;color:#999;border:1px dashed #555;transition:background 0.15s ease;display:flex;align-items:center;justify-content:center;gap:3px;user-select:none;box-sizing:border-box;white-space:nowrap;padding:0 6px;");
                                        negBtn.addEventListener("mouseenter", () => { negBtn.style.background = "#333"; });
                                        negBtn.addEventListener("mouseleave", () => { negBtn.style.background = "#2a2a2a"; });
                                        negBtn.addEventListener("click", () => {
                                            fieldState.variants[groupName][choiceName] = fieldState.variants[groupName][choiceName] || {};
                                            fieldState.variants[groupName][choiceName].negative = fieldState.variants[groupName][choiceName].negative ?? "";
                                            renderChoicePrompts();
                                        });
                                        choiceNegCol.appendChild(negBtn);
                                    }
                                }
                                renderChoicePrompts();

                                groupCard.appendChild(choiceCard);
                            }

                            const addChoiceBtn = makeSmallButton("+ choice");
                            addChoiceBtn.addEventListener("click", (e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                const inlineWrap = document.createElement("div");
                                css(inlineWrap, "display:flex;gap:6px;align-items:center;padding-top:4px;");
                                const choiceNameInput = makeComfyInput("", "e.g. red dress");
                                choiceNameInput.style.flex = "1";
                                const addBtn = makeSmallButton("Add");
                                const cancelBtn = makeSmallButton("Cancel");
                                inlineWrap.appendChild(choiceNameInput);
                                inlineWrap.appendChild(addBtn);
                                inlineWrap.appendChild(cancelBtn);
                                addChoiceBtn.replaceWith(inlineWrap);
                                choiceNameInput.focus();

                                function finish() {
                                    inlineWrap.replaceWith(addChoiceBtn);
                                }

                                addBtn.addEventListener("click", async () => {
                                    const trimmed = choiceNameInput.value.trim();
                                    if (!trimmed) { finish(); return; }
                                    if (fieldState.variants[groupName][trimmed]) {
                                        window.alert(`Choice '${trimmed}' already exists in this group.`);
                                        finish();
                                        return;
                                    }
                                    const choiceData = { positive: "" };
                                    // Auto-detect variant sibling image from first LoRA
                                    const firstLora = Array.isArray(data.loras) ? data.loras[0] : null;
                                    const loraPath = firstLora?.path || firstLora?.name || null;
                                    if (loraPath) {
                                        try {
                                            const siblingPath = await fetchLoraVariantSiblingImagePath(loraPath, groupName, trimmed);
                                            if (siblingPath) {
                                                choiceData.image = siblingPath;
                                            }
                                        } catch { /* ignore */ }
                                    }
                                    fieldState.variants[groupName][trimmed] = choiceData;
                                    finish();
                                    renderOpts();
                                });
                                cancelBtn.addEventListener("click", finish);
                                choiceNameInput.addEventListener("keydown", (ev) => {
                                    if (ev.key === "Enter") {
                                        ev.preventDefault();
                                        addBtn.click();
                                    }
                                    if (ev.key === "Escape") {
                                        ev.preventDefault();
                                        finish();
                                    }
                                });
                            });
                            groupCard.appendChild(addChoiceBtn);
                            optsBox.appendChild(groupCard);
                        }

                        const addGroupBtn = makeSmallButton("+ variant group");
                        addGroupBtn.addEventListener("click", (e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            // Replace the button with an inline input + add/cancel controls
                            const inlineWrap = document.createElement("div");
                            css(inlineWrap, "display:flex;gap:6px;align-items:center;");
                            const groupNameInput = makeComfyInput("", "e.g. outfit");
                            groupNameInput.style.flex = "1";
                            const addBtn = makeSmallButton("Add");
                            const cancelBtn = makeSmallButton("Cancel");
                            inlineWrap.appendChild(groupNameInput);
                            inlineWrap.appendChild(addBtn);
                            inlineWrap.appendChild(cancelBtn);
                            addGroupBtn.replaceWith(inlineWrap);
                            groupNameInput.focus();

                            function finish() {
                                inlineWrap.replaceWith(addGroupBtn);
                            }

                            addBtn.addEventListener("click", () => {
                                const trimmed = groupNameInput.value.trim();
                                if (!trimmed) { finish(); return; }
                                if (fieldState.variants[trimmed]) {
                                    window.alert(`Variant group '${trimmed}' already exists.`);
                                    finish();
                                    return;
                                }
                                fieldState.variants[trimmed] = {};
                                finish();
                                renderOpts();
                            });
                            cancelBtn.addEventListener("click", finish);
                            groupNameInput.addEventListener("keydown", (ev) => {
                                if (ev.key === "Enter") {
                                    ev.preventDefault();
                                    addBtn.click();
                                }
                                if (ev.key === "Escape") {
                                    ev.preventDefault();
                                    finish();
                                }
                            });
                        });
                        optsBox.appendChild(addGroupBtn);
                    }
                    renderOpts();
                }

                if (fieldType === "flake_link") {
                    // Flake link field (#234): pick a target flake, then show
                    // optional default overrides for the target's variant choices
                    // and lora strengths.
                    const linkBox = document.createElement("div");
                    css(linkBox, "display:flex;flex-direction:column;gap:8px;");
                    fieldWrap.appendChild(linkBox);

                    const targetRow = document.createElement("div");
                    css(targetRow, "display:flex;gap:8px;align-items:center;");
                    targetRow.appendChild(makeComfyLabel("Target"));
                    const targetWrap = makeSearchableDropdown(
                        [], fieldState.flake_link?.target || "", "select a flake…",
                    );
                    css(targetWrap.container, "flex:1;min-width:0;");
                    targetRow.appendChild(targetWrap.container);
                    linkBox.appendChild(targetRow);

                    const overridesBox = document.createElement("div");
                    css(overridesBox, "display:flex;flex-direction:column;gap:6px;");
                    linkBox.appendChild(overridesBox);

                    // Populate the target picker with all flakes except self
                    // (and the user's own family/dirs — but list is small enough
                    // to keep simple for now).
                    (async () => {
                        try {
                            const list = await (await fetch(`/flakes/list?family=${encodeURIComponent(currentFamily || "")}`)).json();
                            const all = (list.flakes || []).filter(n => n !== name);
                            for (const flakeName of all) {
                                targetWrap.datalist.appendChild(Object.assign(document.createElement("option"), { value: flakeName }));
                            }
                        } catch { /* ignore */ }
                    })();

                    async function refreshOverrides() {
                        overridesBox.replaceChildren();
                        const link = fieldState.flake_link;
                        if (!link || !link.target) return;
                        let linkedData;
                        try {
                            linkedData = await fetchFlake(link.target);
                        } catch {
                            const err = document.createElement("div");
                            err.textContent = `Target not found: ${link.target}`;
                            css(err, "font-size:11px;color:#f99;");
                            overridesBox.appendChild(err);
                            return;
                        }
                        // Variant choices block
                        const variants = linkedData.variants || linkedData.options || {};
                        if (Object.keys(variants).length > 0) {
                            const vLabel = document.createElement("div");
                            vLabel.textContent = "Default variant choices";
                            css(vLabel, "font-size:11px;color:#aaa;font-weight:500;");
                            overridesBox.appendChild(vLabel);
                            for (const [group, choices] of Object.entries(variants)) {
                                const row = document.createElement("div");
                                css(row, "display:flex;gap:8px;align-items:center;");
                                const gLabel = document.createElement("span");
                                gLabel.textContent = group;
                                css(gLabel, "flex:0 0 120px;font-size:12px;color:#bbb;");
                                row.appendChild(gLabel);
                                const opts = [{ value: "", label: "— none —" }, ...Object.keys(choices).map(c => ({ value: c, label: c }))];
                                const dd = makeComfyDropdown(opts, link.variant?.[group] || "");
                                dd.element.addEventListener("change", () => {
                                    link.variant = link.variant || {};
                                    if (dd.element.value) link.variant[group] = dd.element.value;
                                    else delete link.variant[group];
                                });
                                css(dd.container, "flex:1;min-width:0;");
                                row.appendChild(dd.container);
                                overridesBox.appendChild(row);
                            }
                        }
                        // LoRA strength overrides
                        const loras = Array.isArray(linkedData.loras) ? linkedData.loras : [];
                        if (loras.length > 0) {
                            const lLabel = document.createElement("div");
                            lLabel.textContent = "Default LoRA strengths";
                            css(lLabel, "font-size:11px;color:#aaa;font-weight:500;margin-top:4px;");
                            overridesBox.appendChild(lLabel);
                            link.lora_strengths = link.lora_strengths || [];
                            while (link.lora_strengths.length < loras.length) link.lora_strengths.push(null);
                            loras.forEach((lr, i) => {
                                const row = document.createElement("div");
                                css(row, "display:flex;gap:8px;align-items:center;");
                                const nm = document.createElement("span");
                                nm.textContent = lr.name || lr.path || `LoRA ${i + 1}`;
                                css(nm, "flex:0 0 160px;font-size:12px;color:#bbb;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;");
                                row.appendChild(nm);
                                const cur = link.lora_strengths[i];
                                const defaultStrength = lr.strength ?? 1.0;
                                const initial = (cur === null || cur === undefined) ? defaultStrength : cur;
                                const slider = makeSmallValueSlider(initial, 0, 2, 0.05, (v) => {
                                    link.lora_strengths[i] = v;
                                });
                                css(slider.container, "flex:1;");
                                row.appendChild(slider.container);
                                // Reset to "use linked default" button.
                                const resetBtn = makeSmallButton("↺");
                                resetBtn.title = "Use linked flake's default strength";
                                resetBtn.addEventListener("click", () => {
                                    link.lora_strengths[i] = null;
                                    refreshOverrides();
                                });
                                row.appendChild(resetBtn);
                                overridesBox.appendChild(row);
                            });
                        }
                    }
                    targetWrap.element.addEventListener("change", () => {
                        const v = targetWrap.element.value.trim();
                        if (!fieldState.flake_link) fieldState.flake_link = { target: "", variant: {}, lora_strengths: [] };
                        if (v !== fieldState.flake_link.target) {
                            fieldState.flake_link.target = v;
                            // Reset overrides when the target changes — old indices/groups don't apply.
                            fieldState.flake_link.variant = {};
                            fieldState.flake_link.lora_strengths = [];
                        }
                        refreshOverrides();
                    });
                    refreshOverrides();
                }

                optionalBox.appendChild(fieldWrap);
            }
        }
        renderFields();

        // Add field button
        const addFieldRow = document.createElement("div");
        css(addFieldRow, "display:flex;gap:8px;align-items:center;flex-wrap:wrap;");

        const addFieldBtn = makeSmallButton("+ Add flake field");
        addFieldRow.appendChild(addFieldBtn);

        const fieldMenu = document.createElement("div");
        css(fieldMenu, "display:none;flex-direction:column;gap:2px;background:#1e1e1e;border:1px solid #444;border-radius:4px;padding:4px;box-shadow:0 4px 12px rgba(0,0,0,0.5);position:fixed;z-index:10000;");
        const fieldTypes = [
            { key: "lora", label: "LoRA" },
            { key: "prompt", label: "Prompts" },
            { key: "resolution", label: "Resolution override" },
            { key: "controlnets", label: "ControlNets" },
            { key: "variants", label: "Variants" },
            { key: "flake_link", label: "Flake link" },
        ];
        for (const ft of fieldTypes) {
            const item = document.createElement("button");
            item.textContent = ft.label;
            css(item, "text-align:left;padding:4px 8px;background:#2a2a2a;color:#ddd;border:1px solid #444;border-radius:3px;cursor:pointer;font-size:12px;");
            item.addEventListener("click", () => {
                fieldMenu.style.display = "none";
                if (activeFields.includes(ft.key)) return;
                activeFields.push(ft.key);
                if (ft.key === "lora") fieldState.loras = [{ name: "", url: "", path: "", strength: 1.0 }];
                if (ft.key === "prompt") fieldState.prompt = {};
                if (ft.key === "resolution") fieldState.resolution = [1024, 1024];
                if (ft.key === "controlnets") fieldState.controlnets._ = [];
                if (ft.key === "variants") fieldState.variants = {};
                if (ft.key === "flake_link") fieldState.flake_link = { target: "", variant: {}, lora_strengths: [] };
                renderFields();
            });
            fieldMenu.appendChild(item);
        }
        document.body.appendChild(fieldMenu);

        addFieldBtn.addEventListener("mousedown", (e) => e.stopPropagation());
        addFieldBtn.addEventListener("dblclick", (e) => e.stopPropagation());
        addFieldBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            e.preventDefault();
            const showing = fieldMenu.style.display === "flex";
            if (showing) {
                fieldMenu.style.display = "none";
            } else {
                const rect = addFieldBtn.getBoundingClientRect();
                fieldMenu.style.left = `${rect.left}px`;
                fieldMenu.style.top = `${rect.bottom + 4}px`;
                fieldMenu.style.display = "flex";
            }
        });
        // Hide menu on click outside
        function onDocClick(e) {
            if (e.target !== addFieldBtn && !fieldMenu.contains(e.target)) {
                fieldMenu.style.display = "none";
            }
        }
        document.addEventListener("click", onDocClick);
        handlers.onClose = ((prev) => (v) => {
            document.removeEventListener("click", onDocClick);
            if (fieldMenu.parentElement) fieldMenu.remove();
            prev?.(v);
        })(handlers.onClose);
        content.appendChild(addFieldRow);

        // ---- Footer ----
        if (mode === "edit") {
            const deleteBtn = makeButton("Delete");
            css(deleteBtn, deleteBtn.style.cssText + "background:#5a2a2a;border-color:#7a3a3a;color:#fdd;margin-right:auto;");
            deleteBtn.addEventListener("click", async () => {
                if (!window.confirm(`Delete '${name}'? This cannot be undone.`)) return;
                try {
                    await deleteFlakeApi(name);
                    close({ deleted: true, name });
                } catch (err) {
                    window.alert(`Delete failed: ${err.message || err}`);
                }
            });
            footer.appendChild(deleteBtn);
        }

        const cancelBtn = makeButton("Cancel");
        cancelBtn.addEventListener("click", async () => {
            if (dirty && !window.confirm("Are you sure you want to cancel? Unsaved changes will be lost.")) return;
            close(undefined);
        });
        footer.appendChild(cancelBtn);

        const saveBtn = makeButton("Save", true);
        if (!rootsLoaded) saveBtn.disabled = true;
        saveBtn.addEventListener("click", async () => {
            const ordered = {};
            if (displayNameInput && displayNameInput.value) ordered.name = displayNameInput.value.trim();
            if (selectedType) ordered.flake_type = selectedType;
            if (outputStemInput && outputStemInput.value.trim()) ordered.output_stem = outputStemInput.value.trim();

            // Save fields in the user-selected order so YAML key order is preserved
            for (const ft of activeFields) {
                if (ft === "lora" && fieldState.loras && fieldState.loras.length > 0) {
                    ordered.loras = fieldState.loras.map(l => ({
                        name: l.name || "",
                        url: l.url || "",
                        path: l.path || "",
                        strength: l.strength ?? 1.0,
                    }));
                }
                if (ft === "prompt" && fieldState.prompt) {
                    ordered.prompt = {};
                    if (fieldState.prompt.positive != null) ordered.prompt.positive = fieldState.prompt.positive;
                    if (fieldState.prompt.negative != null) ordered.prompt.negative = fieldState.prompt.negative;
                }
                if (ft === "resolution") {
                    // Prefer reading directly from the DOM inputs so we capture
                    // values typed but not yet committed via change/blur.
                    const inputs = fieldState._resolutionInputs;
                    let rw = inputs ? parseInt(inputs.w.value) : NaN;
                    let rh = inputs ? parseInt(inputs.h.value) : NaN;
                    if (!Number.isFinite(rw) && fieldState.resolution) rw = parseInt(fieldState.resolution[0]);
                    if (!Number.isFinite(rh) && fieldState.resolution) rh = parseInt(fieldState.resolution[1]);
                    if (Number.isFinite(rw) && Number.isFinite(rh)) ordered.resolution = [rw, rh];
                }
                if (ft === "controlnets") {
                    const cnArr = fieldState.controlnets._ || [];
                    if (cnArr.length > 0) ordered.controlnets = cnArr;
                }
                if (ft === "variants" && Object.keys(fieldState.variants).length > 0) {
                    ordered.variants = fieldState.variants;
                }
                if (ft === "flake_link" && fieldState.flake_link && fieldState.flake_link.target) {
                    const link = fieldState.flake_link;
                    const out = { target: link.target };
                    const variant = link.variant ? Object.fromEntries(Object.entries(link.variant).filter(([, v]) => v)) : {};
                    if (Object.keys(variant).length > 0) out.variant = variant;
                    // Drop trailing nulls to keep the yaml clean.
                    let strengths = (link.lora_strengths || []).slice();
                    while (strengths.length && (strengths[strengths.length - 1] === null || strengths[strengths.length - 1] === undefined)) {
                        strengths.pop();
                    }
                    if (strengths.length > 0) out.lora_strengths = strengths;
                    ordered.flake_link = out;
                }
            }
            if (coverSourcePath && !coverFile) {
                ordered.cover_image = coverSourcePath;
            }

            try {
                if (mode === "default") {
                    await close({ defaultUpdated: true, data: ordered });
                    return;
                }
                const outputPath = (pathInput?.value || "").trim();
                if (!outputPath) { window.alert("Path is required"); return; }
                const fullOutputPath = getOutputPrefix() + outputPath;
                const baseRootIndex = baseRootSelectRef ? parseInt(baseRootSelectRef.value, 10) : 0;
                const oldName = mode !== "create" ? name : null;
                const savedName = await saveFlakeApi(
                    fullOutputPath, ordered,
                    currentFamily || undefined,
                    Number.isFinite(baseRootIndex) ? baseRootIndex : 0,
                    fullOutputPath,
                    oldName,
                );
                if (mode === "create") {
                    await close({ created: true, name: savedName, data: ordered });
                } else {
                    await close({ saved: true, name: savedName, data: ordered, oldName: name !== savedName ? name : undefined });
                }
            } catch (err) {
                window.alert(`Save failed: ${err.message || err}`);
            }
        });
        footer.appendChild(saveBtn);

        setTimeout(() => { (pathInput || displayNameInput)?.focus(); }, 0);
    });
}
