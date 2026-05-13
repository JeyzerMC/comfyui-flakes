import { openOverlay } from "./modal.js";
import {
    css, makeButton, makeSmallButton, makeComfyLabel, makeComfyInput,
    makeComfyDropdown, makePanelDropdown, makeSearchableDropdown,
    makeComfyNumberInput, makeComfyValueSlider, makeSmallValueSlider,
    makeTextarea, makeLabel, makeNumberInput,
    familyFolder,
} from "./utils.js";
import {
    getCoverUrl, uploadCover, fetchLoras, fetchCnModels, fetchCnTypes, fetchInputs,
    saveFlakeApi, deleteFlakeApi, fetchFlakeMeta, fetchFlake,
    fetchLoraSiblingImage, loraSiblingImageUrl, fetchLoraSiblingImagePath,
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
        if (mode !== "default") {
            const typeRow = document.createElement("div");
            css(typeRow, "display:flex;gap:8px;align-items:flex-start;");
            const baseWrap = document.createElement("div");
            css(baseWrap, "flex:0 0 auto;min-width:0;display:flex;flex-direction:column;gap:4px;");
            baseWrap.appendChild(makeComfyLabel("Base"));
            const baseRootSelect = document.createElement("select");
            css(baseRootSelect, "background:#1a1a1a;color:#ddd;border:1px solid #333;padding:6px 8px;border-radius:6px;font-size:13px;box-sizing:border-box;");
            baseWrap.appendChild(baseRootSelect);
            baseRootSelectRef = baseRootSelect;
            typeRow.appendChild(baseWrap);
            const typeWrap = document.createElement("div");
            css(typeWrap, "flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;");
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
                        const driveLetter = (root.path || "").replace(/\\/g, "/").match(/^\/?([A-Za-z]:)/)?.[1] || "";
                        opt.textContent = driveLetter ? `${root.label} (${driveLetter})` : root.label;
                        opt.title = `${root.label}: ${root.path}`;
                        baseRootSelect.appendChild(opt);
                    }
                    updateResolvedPath();
                    if (!roots.length) {
                        const opt = document.createElement("option");
                        opt.textContent = "(no roots configured)";
                        opt.value = "0";
                        baseRootSelect.appendChild(opt);
                    }
                } catch { /* ignore */ }
            })();

            // ---- Output Path on its own row ----
            const pathRow = document.createElement("div");
            css(pathRow, "display:flex;flex-direction:column;gap:2px;");
            const pathLabel = makeComfyLabel("Output path");
            pathRow.appendChild(pathLabel);
            pathInput = makeComfyInput("", "characters/musashi");
            pathRow.appendChild(pathInput);
            const resolvedPathLabel = document.createElement("div");
            css(resolvedPathLabel, "font-size:11px;color:#666;word-break:break-all;min-height:0;");
            pathRow.appendChild(resolvedPathLabel);

            let currentRootPath = "";
            let rootsCache = [];

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

            (async () => {
                try {
                    const r = await fetch("/flakes/roots?type=flakes");
                    const d = await r.json();
                    rootsCache = d.roots || [];
                    const rootIdx = parseInt(baseRootSelect?.value || "0", 10);
                    const root = rootsCache[rootIdx] || rootsCache[0];
                    currentRootPath = (root?.path || "").replace(/\\/g, "/");
                    if (!currentRootPath.endsWith("/")) currentRootPath += "/";
                    updateResolvedPath();
                } catch { /* ignore */ }
            })();

            baseRootSelect.addEventListener("change", () => {
                const rootIdx = parseInt(baseRootSelect.value, 10);
                const root = rootsCache[rootIdx] || rootsCache[0];
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
            css(coverBox, "width:160px;height:200px;border-radius:6px;background:#1a1a1a;border:1px solid #333;display:flex;align-items:center;justify-content:center;cursor:pointer;overflow:hidden;");

            coverImg = document.createElement("img");
            css(coverImg, "width:100%;height:100%;object-fit:cover;display:none;");
            coverBox.appendChild(coverImg);

            const coverLabel = document.createElement("span");
            coverLabel.textContent = "image";
            css(coverLabel, "font-size:10px;color:#666;pointer-events:none;");
            coverBox.appendChild(coverLabel);

            const coverInput = document.createElement("input");
            coverInput.type = "file";
            coverInput.accept = ".png,.jpg,.jpeg,.webp,.gif";
            coverInput.style.display = "none";

            function updateCoverPreview(src) {
                if (src) {
                    coverImg.src = src;
                    coverImg.style.display = "block";
                    coverLabel.style.display = "none";
                } else {
                    coverImg.style.display = "none";
                    coverLabel.style.display = "block";
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
        };
        if (!Array.isArray(fieldState.controlnets._)) {
            const arr = Array.isArray(fieldState.controlnets) ? [...fieldState.controlnets] : [];
            fieldState.controlnets = { _: arr };
        }

        // Derive field order from YAML key order (Python preserves insertion order)
        const activeFields = [];
        const knownFieldKeys = { loras: "lora", path: "lora", prompt: "prompt", resolution: "resolution", controlnets: "controlnets", variants: "variants", options: "variants" };
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
                    css(promptBox, "display:flex;flex-direction:column;gap:6px;");
                    fieldWrap.appendChild(promptBox);

                    const btnRow = document.createElement("div");
                    css(btnRow, "display:flex;gap:8px;align-items:center;");
                    const posBtn = makeSmallButton("+ positive");
                    const negBtn = makeSmallButton("+ negative");
                    btnRow.appendChild(posBtn);
                    btnRow.appendChild(negBtn);
                    fieldWrap.insertBefore(btnRow, promptBox);

                    function renderPrompts() {
                        promptBox.replaceChildren();
                        if (fieldState.prompt?.positive != null) {
                            const posRow = document.createElement("div");
                            css(posRow, "display:flex;gap:4px;align-items:flex-start;");
                            const posTA = makeTextarea(fieldState.prompt.positive, "positive prompt", 3);
                            css(posTA, "background:#1a1a1a;color:#ddd;border:1px solid #333;padding:6px;border-radius:4px;font-size:12px;width:100%;box-sizing:border-box;font-family:inherit;resize:vertical;outline:none;");
                            posTA.addEventListener("change", () => { fieldState.prompt.positive = posTA.value; });
                            const rmPos = makeSmallButton("\u2715");
                            rmPos.addEventListener("click", () => {
                                if (fieldState.prompt.negative == null) {
                                    fieldState.prompt = null;
                                    activeFields.splice(activeFields.indexOf("prompt"), 1);
                                    renderFields();
                                } else {
                                    delete fieldState.prompt.positive;
                                    renderPrompts();
                                }
                            });
                            posRow.appendChild(posTA);
                            posRow.appendChild(rmPos);
                            promptBox.appendChild(posRow);
                        }
                        if (fieldState.prompt?.negative != null) {
                            const negRow = document.createElement("div");
                            css(negRow, "display:flex;gap:4px;align-items:flex-start;");
                            const negTA = makeTextarea(fieldState.prompt.negative, "negative prompt", 2);
                            css(negTA, "background:#1a1a1a;color:#ddd;border:1px solid #333;padding:6px;border-radius:4px;font-size:12px;width:100%;box-sizing:border-box;font-family:inherit;resize:vertical;outline:none;");
                            negTA.addEventListener("change", () => { fieldState.prompt.negative = negTA.value; });
                            const rmNeg = makeSmallButton("\u2715");
                            rmNeg.addEventListener("click", () => {
                                if (fieldState.prompt.positive == null) {
                                    fieldState.prompt = null;
                                    activeFields.splice(activeFields.indexOf("prompt"), 1);
                                    renderFields();
                                } else {
                                    delete fieldState.prompt.negative;
                                    renderPrompts();
                                }
                            });
                            negRow.appendChild(negTA);
                            negRow.appendChild(rmNeg);
                            promptBox.appendChild(negRow);
                        }
                    }
                    renderPrompts();

                    posBtn.addEventListener("click", () => {
                        if (!fieldState.prompt) fieldState.prompt = {};
                        fieldState.prompt.positive = fieldState.prompt.positive ?? "";
                        renderPrompts();
                    });
                    negBtn.addEventListener("click", () => {
                        if (!fieldState.prompt) fieldState.prompt = {};
                        fieldState.prompt.negative = fieldState.prompt.negative ?? "";
                        renderPrompts();
                    });
                }

                if (fieldType === "resolution") {
                    const row = document.createElement("div");
                    css(row, "display:flex;gap:8px;align-items:center;");
                    const wInput = makeComfyNumberInput(fieldState.resolution?.[0] || "", "width", 64);
                    const xLabel = document.createElement("span");
                    xLabel.textContent = "\u00d7";
                    css(xLabel, "color:#888;font-size:13px;");
                    const hInput = makeComfyNumberInput(fieldState.resolution?.[1] || "", "height", 64);
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
                                const result = await openFileBrowser({ type: "inputs", defaultPath: "" });
                                if (result && result.file) {
                                    arr[i].image = result.file;
                                    updateCnImgPreview(`/view?filename=${encodeURIComponent(result.file)}&type=input`);
                                    if (!coverFile && !coverSourcePath && setCoverFromCnImage) setCoverFromCnImage(result.file);
                                }
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
                            const strSlider = makeComfyValueSlider(cn.strength ?? 1.0, 0, 2, 0.05);
                            strSlider.style.flex = "1";
                            slidersRow.appendChild(strSlider);

                            const startLabel = document.createElement("span");
                            startLabel.textContent = "Start";
                            css(startLabel, "font-size:10px;color:#888;flex-shrink:0;");
                            slidersRow.appendChild(startLabel);
                            const startSlider = makeComfyValueSlider(cn.start_percent ?? 0, 0, 1, 0.05);
                            startSlider.style.flex = "1";
                            slidersRow.appendChild(startSlider);

                            const endLabel = document.createElement("span");
                            endLabel.textContent = "End";
                            css(endLabel, "font-size:10px;color:#888;flex-shrink:0;");
                            slidersRow.appendChild(endLabel);
                            const endSlider = makeComfyValueSlider(cn.end_percent ?? 1, 0, 1, 0.05);
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

                            for (const choiceName of Object.keys(fieldState.variants[groupName] || {})) {
                                const choiceCard = document.createElement("div");
                                css(choiceCard, "background:#1a1a1a;padding:8px;border-radius:4px;display:flex;flex-direction:column;gap:4px;");

                                const cRow = document.createElement("div");
                                css(cRow, "display:flex;gap:4px;align-items:center;");
                                const cNameInput = makeComfyInput(choiceName, "choice name");
                                cNameInput.style.flex = "1";
                                const removeChoiceBtn = makeSmallButton("\u2715");
                                cNameInput.addEventListener("change", () => {
                                    const newCName = cNameInput.value.trim();
                                    if (!newCName || newCName === choiceName) return;
                                    if (fieldState.variants[groupName][newCName]) { cNameInput.value = choiceName; return; }
                                    fieldState.variants[groupName][newCName] = fieldState.variants[groupName][choiceName];
                                    delete fieldState.variants[groupName][choiceName];
                                    renderOpts();
                                });
                                removeChoiceBtn.addEventListener("click", () => {
                                    delete fieldState.variants[groupName][choiceName];
                                    renderOpts();
                                });
                                cRow.appendChild(cNameInput);
                                cRow.appendChild(removeChoiceBtn);
                                choiceCard.appendChild(cRow);

                                const choice = fieldState.variants[groupName][choiceName] || {};

                                const choiceBtnRow = document.createElement("div");
                                css(choiceBtnRow, "display:flex;gap:8px;align-items:center;");
                                const choicePosBtn = makeSmallButton("+ positive");
                                const choiceNegBtn = makeSmallButton("+ negative");
                                choiceBtnRow.appendChild(choicePosBtn);
                                choiceBtnRow.appendChild(choiceNegBtn);
                                choiceCard.appendChild(choiceBtnRow);

                                function renderChoicePrompts() {
                                    // Remove existing prompt textareas (they come after the button row)
                                    while (choiceCard.children.length > 2) {
                                        choiceCard.removeChild(choiceCard.lastChild);
                                    }
                                    if (choice.positive != null) {
                                        const posRow = document.createElement("div");
                                        css(posRow, "display:flex;gap:4px;align-items:flex-start;");
                                        const cPos = makeTextarea(choice.positive || "", "extra positive", 2);
                                        css(cPos, "background:#1a1a1a;color:#ddd;border:1px solid #333;padding:6px;border-radius:4px;font-size:12px;width:100%;box-sizing:border-box;font-family:inherit;resize:vertical;outline:none;");
                                        cPos.addEventListener("change", () => {
                                            fieldState.variants[groupName][choiceName] = fieldState.variants[groupName][choiceName] || {};
                                            fieldState.variants[groupName][choiceName].positive = cPos.value;
                                        });
                                        const rmPos = makeSmallButton("\u2715");
                                        rmPos.addEventListener("click", () => {
                                            if (choice.negative == null) {
                                                fieldState.variants[groupName][choiceName] = {};
                                            } else {
                                                delete fieldState.variants[groupName][choiceName].positive;
                                            }
                                            renderChoicePrompts();
                                        });
                                        posRow.appendChild(cPos);
                                        posRow.appendChild(rmPos);
                                        choiceCard.appendChild(posRow);
                                    }
                                    if (choice.negative != null) {
                                        const negRow = document.createElement("div");
                                        css(negRow, "display:flex;gap:4px;align-items:flex-start;");
                                        const cNeg = makeTextarea(choice.negative || "", "extra negative", 2);
                                        css(cNeg, "background:#1a1a1a;color:#ddd;border:1px solid #333;padding:6px;border-radius:4px;font-size:12px;width:100%;box-sizing:border-box;font-family:inherit;resize:vertical;outline:none;");
                                        cNeg.addEventListener("change", () => {
                                            fieldState.variants[groupName][choiceName] = fieldState.variants[groupName][choiceName] || {};
                                            fieldState.variants[groupName][choiceName].negative = cNeg.value;
                                        });
                                        const rmNeg = makeSmallButton("\u2715");
                                        rmNeg.addEventListener("click", () => {
                                            if (choice.positive == null) {
                                                fieldState.variants[groupName][choiceName] = {};
                                            } else {
                                                delete fieldState.variants[groupName][choiceName].negative;
                                            }
                                            renderChoicePrompts();
                                        });
                                        negRow.appendChild(cNeg);
                                        negRow.appendChild(rmNeg);
                                        choiceCard.appendChild(negRow);
                                    }
                                }
                                renderChoicePrompts();

                                choicePosBtn.addEventListener("click", () => {
                                    fieldState.variants[groupName][choiceName] = fieldState.variants[groupName][choiceName] || {};
                                    fieldState.variants[groupName][choiceName].positive = fieldState.variants[groupName][choiceName].positive ?? "";
                                    renderChoicePrompts();
                                });
                                choiceNegBtn.addEventListener("click", () => {
                                    fieldState.variants[groupName][choiceName] = fieldState.variants[groupName][choiceName] || {};
                                    fieldState.variants[groupName][choiceName].negative = fieldState.variants[groupName][choiceName].negative ?? "";
                                    renderChoicePrompts();
                                });

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

                                addBtn.addEventListener("click", () => {
                                    const trimmed = choiceNameInput.value.trim();
                                    if (!trimmed) { finish(); return; }
                                    if (fieldState.variants[groupName][trimmed]) {
                                        window.alert(`Choice '${trimmed}' already exists in this group.`);
                                        finish();
                                        return;
                                    }
                                    fieldState.variants[groupName][trimmed] = {};
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
                if (ft === "resolution" && fieldState.resolution) {
                    const rw = parseInt(fieldState.resolution[0]);
                    const rh = parseInt(fieldState.resolution[1]);
                    if (!isNaN(rw) && !isNaN(rh)) ordered.resolution = [rw, rh];
                }
                if (ft === "controlnets") {
                    const cnArr = fieldState.controlnets._ || [];
                    if (cnArr.length > 0) ordered.controlnets = cnArr;
                }
                if (ft === "variants" && Object.keys(fieldState.variants).length > 0) {
                    ordered.variants = fieldState.variants;
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
                const body = {
                    name: fullOutputPath,
                    data: ordered,
                    family: currentFamily || undefined,
                    base_root_index: Number.isFinite(baseRootIndex) ? baseRootIndex : 0,
                    output_path: fullOutputPath,
                };
                if (mode !== "create") body.old_name = name;
                const r = await fetch("/flakes/save", {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(body),
                });
                if (!r.ok) {
                    const err = await r.json().catch(() => ({}));
                    throw new Error(err.error || `HTTP ${r.status}`);
                }
                const savedName = (await r.json()).name || outputPath;
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
