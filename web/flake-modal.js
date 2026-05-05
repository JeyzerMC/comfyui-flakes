import { openOverlay } from "./modal.js";
import {
    css, makeButton, makeSmallButton, makeComfyLabel, makeComfyInput,
    makeComfyDropdown, makePanelDropdown, makeSearchableDropdown,
    makeComfyNumberInput, makeComfyValueSlider, makeSmallValueSlider,
    makeTextarea, makeLabel, makeNumberInput,
} from "./utils.js";
import {
    getCoverUrl, uploadCover, fetchLoras, fetchCnModels, fetchInputs,
    saveFlakeApi, deleteFlakeApi, fetchFlakeMeta, fetchFlake,
    fetchLoraSiblingImage,
} from "./api.js";
import { openFileBrowser } from "./pickers.js";

export function openEditModal({ mode, name, data, dirs }) {
    return new Promise((resolve) => {
        let { content, footer, close, handlers } = openOverlay();
        handlers.onClose = (v) => resolve(v ?? null);

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

        leftCol.appendChild(makeComfyLabel("Display name"));
        const displayNameInput = makeComfyInput(data.name || "", "e.g. My Flake");
        leftCol.appendChild(displayNameInput);

        let pathInput = null;
        let familyDropdown = null;
        const FAMILY_OPTIONS = [
            { value: "SDXL/Base", label: "SDXL/Base" },
            { value: "SDXL/Illustrious", label: "SDXL/Illustrious" },
            { value: "SDXL/Pony", label: "SDXL/Pony" },
            { value: "ZImage/Base", label: "ZImage/Base" },
            { value: "ZImage/Turbo", label: "ZImage/Turbo" },
            { value: "Common", label: "Common" },
        ];
        if (mode === "create") {
            leftCol.appendChild(makeComfyLabel("Model family"));
            familyDropdown = makeComfyDropdown(FAMILY_OPTIONS, "SDXL/Base");
            leftCol.appendChild(familyDropdown.container);

            leftCol.appendChild(makeComfyLabel("Path"));
            pathInput = makeComfyInput("", "characters/musashi");
            const listId = `flake-dirs-${Math.random().toString(36).slice(2)}`;
            const dlist = document.createElement("datalist");
            dlist.id = listId;
            for (const d of dirs) {
                const o = document.createElement("option");
                o.value = `${d}/`;
                dlist.appendChild(o);
            }
            pathInput.setAttribute("list", listId);
            leftCol.appendChild(dlist);
            leftCol.appendChild(pathInput);
        }
        topSection.appendChild(leftCol);

        let coverFile = null;
        let coverImg = null;
        // Set by the cover-image block; used by the LoRA selectors to default
        // the cover to the LoRA's sibling image when no cover has been chosen.
        let setCoverFromLora = null;
        if (mode === "edit" || mode === "create") {
            const coverWrap = document.createElement("div");
            css(coverWrap, "display:flex;flex-direction:column;align-items:center;gap:4px;");

            const coverBox = document.createElement("div");
            css(coverBox, "width:80px;height:80px;border-radius:6px;background:#1a1a1a;border:1px solid #333;display:flex;align-items:center;justify-content:center;cursor:pointer;overflow:hidden;");

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
            // explicitly chosen yet. Returns true if a sibling image was set.
            setCoverFromLora = async (loraPath) => {
                if (coverFile || !loraPath) return false;
                try {
                    const result = await fetchLoraSiblingImage(loraPath);
                    if (!result || coverFile) return false;
                    const file = new File([result.blob], `cover.${result.ext}`, { type: result.mime });
                    coverFile = file;
                    const reader = new FileReader();
                    reader.onload = () => updateCoverPreview(reader.result);
                    reader.readAsDataURL(file);
                    return true;
                } catch {
                    return false;
                }
            };

            coverWrap.appendChild(coverBox);
            coverWrap.appendChild(coverInput);
            topSection.appendChild(coverWrap);

            // Default cover when path changes in create mode
            if (mode === "create" && pathInput) {
                pathInput.addEventListener("input", () => {
                    const p = pathInput.value.trim();
                    if (p && !coverFile) {
                        const pngPath = p.replace(/\.ya?ml$/i, ".png");
                        // We can't know if it exists, but we can set the src anyway
                        updateCoverPreview(getCoverUrl(pngPath));
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
            options: JSON.parse(JSON.stringify(data.options || {})),
            output_stem: data.output_stem ?? null,
        };
        if (!Array.isArray(fieldState.controlnets._)) {
            const arr = Array.isArray(fieldState.controlnets) ? [...fieldState.controlnets] : [];
            fieldState.controlnets = { _: arr };
        }

        // Derive field order from YAML key order (Python preserves insertion order)
        const activeFields = [];
        const knownFieldKeys = { loras: "lora", path: "lora", prompt: "prompt", resolution: "resolution", controlnets: "controlnets", options: "options", output_stem: "output_stem" };
        for (const key of Object.keys(data)) {
            const ft = knownFieldKeys[key];
            if (ft && !activeFields.includes(ft)) activeFields.push(ft);
        }
        // Fallback: append any fields that exist but weren't in the key order
        if (!activeFields.includes("lora") && (Array.isArray(data.loras) || data.path)) activeFields.push("lora");
        if (!activeFields.includes("prompt") && fieldState.prompt) activeFields.push("prompt");
        if (!activeFields.includes("resolution") && fieldState.resolution) activeFields.push("resolution");
        if (!activeFields.includes("controlnets") && fieldState.controlnets._.length > 0) activeFields.push("controlnets");
        if (!activeFields.includes("options") && Object.keys(fieldState.options).length > 0) activeFields.push("options");
        if (!activeFields.includes("output_stem") && fieldState.output_stem != null) activeFields.push("output_stem");

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

                const delFieldBtn = makeSmallButton("\u2715");
                delFieldBtn.addEventListener("click", () => {
                    const idx = activeFields.indexOf(fieldType);
                    if (idx !== -1) activeFields.splice(idx, 1);
                    if (fieldType === "lora") fieldState.loras = [];
                    if (fieldType === "prompt") fieldState.prompt = null;
                    if (fieldType === "resolution") fieldState.resolution = null;
                    if (fieldType === "controlnets") fieldState.controlnets._ = [];
                    if (fieldType === "options") {
                        for (const k of Object.keys(fieldState.options)) delete fieldState.options[k];
                    }
                    if (fieldType === "output_stem") fieldState.output_stem = null;
                    renderFields();
                });
                header.appendChild(delFieldBtn);
                fieldWrap.appendChild(header);

                fieldWrap.addEventListener("dragover", (e) => {
                    if (dragFieldIdx === null || dragFieldIdx === fi) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    let indicator = optionalBox.querySelector(".field-drop-indicator");
                    if (!indicator) {
                        indicator = document.createElement("div");
                        indicator.className = "field-drop-indicator";
                        css(indicator, "height:2px;background:#2a6acf;border-radius:1px;margin:2px 0;");
                    }
                    if (optionalBox.children[fi] !== indicator) {
                        optionalBox.insertBefore(indicator, optionalBox.children[fi]);
                    }
                });
                fieldWrap.addEventListener("dragleave", () => {
                    for (const ind of optionalBox.querySelectorAll(".field-drop-indicator")) {
                        ind.remove();
                    }
                });
                fieldWrap.addEventListener("drop", (e) => {
                    e.preventDefault();
                    for (const ind of optionalBox.querySelectorAll(".field-drop-indicator")) {
                        ind.remove();
                    }
                    if (dragFieldIdx === null || dragFieldIdx === fi) return;
                    const [movedField] = activeFields.splice(dragFieldIdx, 1);
                    let insertIdx = fi;
                    if (dragFieldIdx < fi) insertIdx--;
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
                                const result = await openFileBrowser({ type: "loras", defaultPath: "" });
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
                            css(card, "background:#252525;padding:10px;border-radius:6px;display:flex;flex-direction:column;gap:6px;border:1px solid #333;");

                            const topRow = document.createElement("div");
                            css(topRow, "display:flex;gap:6px;align-items:center;");
                            const typeInput = makeComfyInput(cn.type || "", "type (e.g. openpose)");
                            typeInput.style.flex = "1";
                            typeInput.addEventListener("change", () => { arr[i].type = typeInput.value; });
                            topRow.appendChild(typeInput);

                            const modelInput = makeComfyInput(cn.model || cn.model_name || "", "model file");
                            const cnModelListId = `cnm-${Math.random().toString(36).slice(2)}`;
                            const cnModelList = document.createElement("datalist");
                            cnModelList.id = cnModelListId;
                            modelInput.setAttribute("list", cnModelListId);
                            modelInput.addEventListener("change", () => { arr[i].model = modelInput.value; });
                            modelInput.style.flex = "2";
                            topRow.appendChild(modelInput);
                            topRow.appendChild(cnModelList);
                            (async () => {
                                try {
                                    const cns = await fetchCnModels();
                                    for (const c of cns) { const o = document.createElement("option"); o.value = c; cnModelList.appendChild(o); }
                                } catch { /* ignore */ }
                            })();

                            const removeBtn = makeSmallButton("\u2715");
                            removeBtn.addEventListener("click", () => { arr.splice(i, 1); renderCNs(); });
                            topRow.appendChild(removeBtn);
                            card.appendChild(topRow);

                            const midRow = document.createElement("div");
                            css(midRow, "display:flex;gap:6px;align-items:center;");
                            const imgInput = makeComfyInput(cn.image || cn.image_name || "", "input image");
                            const imgListId = `img-list-${Math.random().toString(36).slice(2)}`;
                            const imgList = document.createElement("datalist");
                            imgList.id = imgListId;
                            imgInput.setAttribute("list", imgListId);
                            imgInput.addEventListener("change", () => { arr[i].image = imgInput.value; });
                            imgInput.style.flex = "1";
                            midRow.appendChild(imgInput);
                            midRow.appendChild(imgList);
                            (async () => {
                                try {
                                    const inputs = await fetchInputs();
                                    for (const inp of inputs) { const o = document.createElement("option"); o.value = inp; imgList.appendChild(o); }
                                } catch { /* ignore */ }
                            })();
                            card.appendChild(midRow);

                            const botRow = document.createElement("div");
                            css(botRow, "display:flex;gap:6px;align-items:center;");
                            const strSlider = makeComfyValueSlider(cn.strength ?? 1.0, 0, 2, 0.05);
                            botRow.appendChild(strSlider);
                            const startSlider = makeComfyValueSlider(cn.start_percent ?? 0, 0, 1, 0.05);
                            botRow.appendChild(startSlider);
                            const endSlider = makeComfyValueSlider(cn.end_percent ?? 1, 0, 1, 0.05);
                            botRow.appendChild(endSlider);
                            card.appendChild(botRow);
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

                if (fieldType === "options") {
                    const optsBox = document.createElement("div");
                    css(optsBox, "display:flex;flex-direction:column;gap:8px;");
                    fieldWrap.appendChild(optsBox);

                    function renderOpts() {
                        optsBox.replaceChildren();
                        for (const groupName of Object.keys(fieldState.options)) {
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
                                if (fieldState.options[newName]) { groupNameInput.value = groupName; return; }
                                fieldState.options[newName] = fieldState.options[groupName];
                                delete fieldState.options[groupName];
                                renderOpts();
                            });
                            removeGroupBtn.addEventListener("click", () => {
                                delete fieldState.options[groupName];
                                renderOpts();
                            });
                            headerRow.appendChild(groupNameInput);
                            headerRow.appendChild(removeGroupBtn);
                            groupCard.appendChild(headerRow);

                            for (const choiceName of Object.keys(fieldState.options[groupName] || {})) {
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
                                    if (fieldState.options[groupName][newCName]) { cNameInput.value = choiceName; return; }
                                    fieldState.options[groupName][newCName] = fieldState.options[groupName][choiceName];
                                    delete fieldState.options[groupName][choiceName];
                                    renderOpts();
                                });
                                removeChoiceBtn.addEventListener("click", () => {
                                    delete fieldState.options[groupName][choiceName];
                                    renderOpts();
                                });
                                cRow.appendChild(cNameInput);
                                cRow.appendChild(removeChoiceBtn);
                                choiceCard.appendChild(cRow);

                                const choice = fieldState.options[groupName][choiceName] || {};

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
                                            fieldState.options[groupName][choiceName] = fieldState.options[groupName][choiceName] || {};
                                            fieldState.options[groupName][choiceName].positive = cPos.value;
                                        });
                                        const rmPos = makeSmallButton("\u2715");
                                        rmPos.addEventListener("click", () => {
                                            if (choice.negative == null) {
                                                fieldState.options[groupName][choiceName] = {};
                                            } else {
                                                delete fieldState.options[groupName][choiceName].positive;
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
                                            fieldState.options[groupName][choiceName] = fieldState.options[groupName][choiceName] || {};
                                            fieldState.options[groupName][choiceName].negative = cNeg.value;
                                        });
                                        const rmNeg = makeSmallButton("\u2715");
                                        rmNeg.addEventListener("click", () => {
                                            if (choice.positive == null) {
                                                fieldState.options[groupName][choiceName] = {};
                                            } else {
                                                delete fieldState.options[groupName][choiceName].negative;
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
                                    fieldState.options[groupName][choiceName] = fieldState.options[groupName][choiceName] || {};
                                    fieldState.options[groupName][choiceName].positive = fieldState.options[groupName][choiceName].positive ?? "";
                                    renderChoicePrompts();
                                });
                                choiceNegBtn.addEventListener("click", () => {
                                    fieldState.options[groupName][choiceName] = fieldState.options[groupName][choiceName] || {};
                                    fieldState.options[groupName][choiceName].negative = fieldState.options[groupName][choiceName].negative ?? "";
                                    renderChoicePrompts();
                                });

                                groupCard.appendChild(choiceCard);
                            }

                            const addChoiceBtn = makeSmallButton("+ choice");
                            addChoiceBtn.addEventListener("click", () => {
                                const cn = window.prompt("Choice name:", "");
                                if (!cn) return;
                                const trimmed = cn.trim();
                                if (!trimmed || fieldState.options[groupName][trimmed]) return;
                                fieldState.options[groupName][trimmed] = {};
                                renderOpts();
                            });
                            groupCard.appendChild(addChoiceBtn);
                            optsBox.appendChild(groupCard);
                        }

                        const addGroupBtn = makeSmallButton("+ option group");
                        addGroupBtn.addEventListener("click", () => {
                            const gn = window.prompt("Option group name (e.g. outfit):", "");
                            if (!gn) return;
                            const trimmed = gn.trim();
                            if (!trimmed || fieldState.options[trimmed]) return;
                            fieldState.options[trimmed] = {};
                            renderOpts();
                        });
                        optsBox.appendChild(addGroupBtn);
                    }
                    renderOpts();
                }

                if (fieldType === "output_stem") {
                    const stemInput = makeComfyInput(fieldState.output_stem ?? "", "e.g. musashi/ or bike");
                    stemInput.addEventListener("change", () => {
                        fieldState.output_stem = stemInput.value || null;
                    });
                    fieldWrap.appendChild(stemInput);
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
        css(fieldMenu, "display:none;flex-direction:column;gap:2px;background:#1e1e1e;border:1px solid #444;border-radius:4px;padding:4px;box-shadow:0 4px 12px rgba(0,0,0,0.5);position:absolute;z-index:100;");
        const fieldTypes = [
            { key: "lora", label: "LoRA" },
            { key: "prompt", label: "Prompts" },
            { key: "resolution", label: "Resolution override" },
            { key: "controlnets", label: "ControlNets" },
            { key: "options", label: "Options" },
            { key: "output_stem", label: "Output Filename Stem" },
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
                if (ft.key === "options") fieldState.options = {};
                if (ft.key === "output_stem") fieldState.output_stem = "";
                renderFields();
            });
            fieldMenu.appendChild(item);
        }
        addFieldRow.appendChild(fieldMenu);

        addFieldBtn.addEventListener("click", () => {
            fieldMenu.style.display = fieldMenu.style.display === "flex" ? "none" : "flex";
        });
        // Hide menu on click outside
        document.addEventListener("click", (e) => {
            if (!addFieldRow.contains(e.target)) fieldMenu.style.display = "none";
        });
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
        cancelBtn.addEventListener("click", () => close(undefined));
        footer.appendChild(cancelBtn);

        const saveBtn = makeButton("Save", true);
        saveBtn.addEventListener("click", async () => {
            const ordered = {};
            if (displayNameInput.value) ordered.name = displayNameInput.value.trim();

            // Save fields in the user-selected order so YAML key order is preserved
            for (const ft of activeFields) {
                if (ft === "lora" && fieldState.loras && fieldState.loras.length > 0) {
                    ordered.loras = fieldState.loras.map(l => ({
                        name: l.name || "",
                        url: l.url || "",
                        path: l.path || "",
                        strength: l.strength ?? 1.0,
                    }));
                    // Backward compatibility: single unnamed LoRA
                    if (fieldState.loras.length === 1) {
                        const l = fieldState.loras[0];
                        if (!l.name && !l.url && l.path) {
                            ordered.path = l.path;
                            ordered.strength = l.strength ?? 1.0;
                        }
                    }
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
                if (ft === "options" && Object.keys(fieldState.options).length > 0) {
                    ordered.options = fieldState.options;
                }
                if (ft === "output_stem" && fieldState.output_stem != null) {
                    ordered.output_stem = fieldState.output_stem;
                }
            }

            try {
                if (mode === "create") {
                    const targetName = (pathInput.value || "").trim();
                    if (!targetName) { window.alert("Path is required"); return; }
                    const family = familyDropdown?.element?.value || "";
                    await saveFlakeApi(targetName, ordered, family);
                    close({ created: true, name: targetName, data: ordered });
                } else if (mode === "default") {
                    close({ defaultUpdated: true, data: ordered });
                } else {
                    await saveFlakeApi(name, ordered);
                    close({ saved: true, name, data: ordered });
                }
            } catch (err) {
                window.alert(`Save failed: ${err.message || err}`);
            }
        });
        footer.appendChild(saveBtn);

        setTimeout(() => { (pathInput || displayNameInput).focus(); }, 0);
    });
}
