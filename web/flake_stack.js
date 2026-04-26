import { app } from "../../scripts/app.js";

// ---------- API ----------

let LIST_PROMISE = null;

function invalidateList() { LIST_PROMISE = null; }

async function fetchList() {
    if (!LIST_PROMISE) {
        LIST_PROMISE = fetch("/flakes/list").then(r => r.json()).then(d => ({
            flakes: Array.isArray(d.flakes) ? d.flakes : [],
            directories: Array.isArray(d.directories) ? d.directories : [],
        }));
    }
    return LIST_PROMISE;
}

async function fetchFlake(name) {
    const r = await fetch(`/flakes/get?name=${encodeURIComponent(name)}`);
    if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${r.status}`);
    }
    return (await r.json()).data || {};
}

async function saveFlakeApi(name, data) {
    const r = await fetch("/flakes/save", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, data }),
    });
    if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${r.status}`);
    }
    invalidateList();
}

async function deleteFlakeApi(name) {
    const r = await fetch(`/flakes/delete?name=${encodeURIComponent(name)}`, { method: "DELETE" });
    if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${r.status}`);
    }
    invalidateList();
}

// --- Autocomplete / assets (Phase 2) ---

let LORAS_PROMISE = null;
function fetchLoras() {
    if (!LORAS_PROMISE) LORAS_PROMISE = fetch("/flakes/loras").then(r => r.json()).then(d => d.loras || []);
    return LORAS_PROMISE;
}

let CNMODELS_PROMISE = null;
function fetchCnModels() {
    if (!CNMODELS_PROMISE) CNMODELS_PROMISE = fetch("/flakes/cnmodels").then(r => r.json()).then(d => d.controlnets || []);
    return CNMODELS_PROMISE;
}

let INPUTS_PROMISE = null;
function fetchInputs() {
    if (!INPUTS_PROMISE) INPUTS_PROMISE = fetch("/flakes/inputs").then(r => r.json()).then(d => d.inputs || []);
    return INPUTS_PROMISE;
}

// --- Cover (Phase 3) ---

function getCoverUrl(name) {
    return `/flakes/cover?name=${encodeURIComponent(name)}`;
}

async function uploadCover(name, file) {
    const form = new FormData();
    form.append("file", file);
    const r = await fetch(`/flakes/cover?name=${encodeURIComponent(name)}`, {
        method: "POST",
        body: form,
    });
    if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${r.status}`);
    }
}

// --- Flake meta (option groups per flake) ---

const META_CACHE = {};
async function fetchFlakeMeta(name) {
    if (META_CACHE[name]) return META_CACHE[name];
    const r = await fetch(`/flakes/meta?name=${encodeURIComponent(name)}`);
    if (!r.ok) return {};
    const d = await r.json();
    META_CACHE[name] = d.options || {};
    return META_CACHE[name];
}

// ---------- Default-flake helpers ----------

function makeDefaultEntry() {
    return {
        inline: true,
        content: { prompt: { positive: "", negative: "" }, options: {} },
        strength: 1.0,
        option: {},
    };
}

function ensureDefault(entries) {
    if (!entries.length || !entries[0].inline) entries.unshift(makeDefaultEntry());
    return entries;
}

// ---------- Style helpers ----------

const css = (el, s) => { el.style.cssText = s; return el; };

function makeButton(label, primary = false) {
    const b = document.createElement("button");
    b.textContent = label;
    css(b, `padding:6px 12px;cursor:pointer;border-radius:3px;font-size:12px;${
        primary
            ? "background:#2a6acf;color:#fff;border:1px solid #2a6acf;"
            : "background:#2a2a2a;color:#ddd;border:1px solid #444;"
    }`);
    return b;
}

function makeSmallButton(label) {
    const b = document.createElement("button");
    b.textContent = label;
    css(b, "padding:2px 6px;cursor:pointer;background:#2a2a2a;color:#ddd;border:1px solid #444;border-radius:2px;font-size:11px;");
    return b;
}

function makeInput(value = "", placeholder = "") {
    const el = document.createElement("input");
    el.type = "text";
    el.value = value;
    el.placeholder = placeholder;
    css(el, "background:#2a2a2a;color:#ddd;border:1px solid #444;padding:4px 6px;border-radius:3px;font-size:12px;width:100%;box-sizing:border-box;");
    return el;
}

function makeTextarea(value = "", placeholder = "", rows = 3) {
    const el = document.createElement("textarea");
    el.value = value;
    el.placeholder = placeholder;
    el.rows = rows;
    css(el, "background:#2a2a2a;color:#ddd;border:1px solid #444;padding:6px;border-radius:3px;font-size:12px;width:100%;box-sizing:border-box;font-family:inherit;resize:vertical;");
    return el;
}

function makeLabel(text) {
    const l = document.createElement("div");
    l.textContent = text;
    css(l, "font-size:11px;opacity:0.7;margin:4px 0 2px;");
    return l;
}

function makeNumberInput(value = 0, placeholder = "", step = 0.1) {
    const el = document.createElement("input");
    el.type = "number";
    el.value = String(value);
    el.placeholder = placeholder;
    el.step = String(step);
    css(el, "background:#2a2a2a;color:#ddd;border:1px solid #444;padding:4px 6px;border-radius:3px;font-size:12px;width:100%;box-sizing:border-box;");
    return el;
}

// ---------- Modal infrastructure ----------

function openOverlay() {
    const overlay = document.createElement("div");
    css(overlay, "position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;");
    const panel = document.createElement("div");
    css(panel, "background:#1e1e1e;color:#ddd;border:1px solid #444;border-radius:6px;padding:16px;min-width:480px;max-width:720px;max-height:85vh;overflow:auto;display:flex;flex-direction:column;gap:8px;box-shadow:0 4px 24px rgba(0,0,0,0.5);");
    overlay.appendChild(panel);

    const handlers = { onClose: null };
    function close(value) {
        document.body.removeChild(overlay);
        document.removeEventListener("keydown", onKey);
        handlers.onClose?.(value);
    }
    function onKey(e) { if (e.key === "Escape") close(undefined); }
    document.addEventListener("keydown", onKey);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(undefined); });

    document.body.appendChild(overlay);
    return { overlay, panel, close, handlers };
}

// ---------- Edit / Create / Default modal ----------

function openEditModal({ mode, name, data, dirs }) {
    return new Promise((resolve) => {
        const { panel, close, handlers } = openOverlay();
        handlers.onClose = (v) => resolve(v ?? null);

        const title = document.createElement("h3");
        css(title, "margin:0 0 4px;font-size:14px;");
        title.textContent =
            mode === "default" ? "Edit default flake" :
            mode === "create" ? "New flake" :
            `Edit ${name}`;
        panel.appendChild(title);

        // ---- Path (create mode) ----
        let pathInput = null;
        if (mode === "create") {
            panel.appendChild(makeLabel("Path (e.g. characters/musashi)"));
            pathInput = makeInput("", "characters/musashi");
            const listId = `flake-dirs-${Math.random().toString(36).slice(2)}`;
            const dlist = document.createElement("datalist");
            dlist.id = listId;
            for (const d of dirs) {
                const o = document.createElement("option");
                o.value = `${d}/`;
                dlist.appendChild(o);
            }
            pathInput.setAttribute("list", listId);
            panel.appendChild(dlist);
            panel.appendChild(pathInput);
        }

        // ---- Prompts ----
        const prompt = data.prompt || {};
        panel.appendChild(makeLabel("Positive prompt"));
        const posTA = makeTextarea(prompt.positive || "", "joined with ' BREAK ' between flakes", 4);
        panel.appendChild(posTA);

        panel.appendChild(makeLabel("Negative prompt"));
        const negTA = makeTextarea(prompt.negative || "", "joined with ', ' between flakes", 3);
        panel.appendChild(negTA);

        // ---- LoRA (Phase 2) ----
        panel.appendChild(makeLabel("LoRA path (in models/loras/)"));
        const loraBox = document.createElement("div");
        css(loraBox, "display:flex;gap:4px;");
        const loraPath = makeInput(data.path || "", "e.g. sd_xl_offset_example-lora_1.0.safetensors");
        const loraListId = `lora-list-${Math.random().toString(36).slice(2)}`;
        const loraList = document.createElement("datalist");
        loraList.id = loraListId;
        loraPath.setAttribute("list", loraListId);
        loraBox.appendChild(loraPath);
        loraBox.appendChild(loraList);
        (async () => {
            try {
                const loras = await fetchLoras();
                for (const l of loras) {
                    const o = document.createElement("option");
                    o.value = l;
                    loraList.appendChild(o);
                }
            } catch { /* ignore */ }
        })();

        panel.appendChild(loraBox);

        panel.appendChild(makeLabel("LoRA strength"));
        const loraStrength = makeNumberInput(data.strength ?? 1.0, "1.0", 0.05);
        loraStrength.min = "0";
        loraStrength.max = "2";
        panel.appendChild(loraStrength);

        // ---- Resolution (Phase 2) ----
        panel.appendChild(makeLabel("Resolution (width × height, optional)"));
        const resBox = document.createElement("div");
        css(resBox, "display:flex;gap:8px;align-items:center;");
        const resWidth = makeNumberInput(data.resolution?.[0] || "", "width", 64);
        resWidth.min = "64";
        resWidth.step = "64";
        const resLabel = document.createElement("span");
        resLabel.textContent = "×";
        css(resLabel, "color:#888;");
        const resHeight = makeNumberInput(data.resolution?.[1] || "", "height", 64);
        resHeight.min = "64";
        resHeight.step = "64";
        resBox.appendChild(resWidth);
        resBox.appendChild(resLabel);
        resBox.appendChild(resHeight);
        panel.appendChild(resBox);

        // ---- ControlNets (Phase 2) ----
        panel.appendChild(makeLabel("ControlNets"));
        const cnsBox = document.createElement("div");
        css(cnsBox, "display:flex;flex-direction:column;gap:6px;");
        panel.appendChild(cnsBox);

        const cnsState = JSON.parse(JSON.stringify(data.controlnets || []));
        if (!Array.isArray(cnsState._)) {
            const arr = Array.isArray(cnsState) ? cnsState : [];
            cnsState._ = arr;
        }

        function renderControlNets() {
            cnsBox.replaceChildren();
            const arr = cnsState._ || [];

            for (let i = 0; i < arr.length; i++) {
                const cn = arr[i];
                const card = document.createElement("div");
                css(card, "background:rgba(255,255,255,0.04);padding:8px;border-radius:4px;display:flex;flex-direction:column;gap:4px;");

                const topRow = document.createElement("div");
                css(topRow, "display:flex;gap:4px;align-items:center;");

                const typeInput = makeInput(cn.type || "", "type (e.g. openpose)");
                typeInput.style.width = "120px";
                typeInput.addEventListener("change", () => { arr[i].type = typeInput.value; });
                topRow.appendChild(typeInput);

                const modelInput = makeInput(cn.model || cn.model_name || "", "model file");
                const cnModelListId = `cnm-${Math.random().toString(36).slice(2)}`;
                const cnModelList = document.createElement("datalist");
                cnModelList.id = cnModelListId;
                modelInput.setAttribute("list", cnModelListId);
                modelInput.addEventListener("change", () => { arr[i].model = modelInput.value; });
                topRow.appendChild(modelInput);
                topRow.appendChild(cnModelList);
                (async () => {
                    try {
                        const cns = await fetchCnModels();
                        for (const c of cns) {
                            const o = document.createElement("option"); o.value = c; cnModelList.appendChild(o);
                        }
                    } catch { /* ignore */ }
                })();

                const removeBtn = makeSmallButton("✕");
                removeBtn.addEventListener("click", () => {
                    arr.splice(i, 1);
                    renderControlNets();
                });
                topRow.appendChild(removeBtn);
                card.appendChild(topRow);

                const midRow = document.createElement("div");
                css(midRow, "display:flex;gap:4px;align-items:center;");
                const imgInput = makeInput(cn.image || cn.image_name || "", "input image");
                const imgListId = `img-list-${Math.random().toString(36).slice(2)}`;
                const imgList = document.createElement("datalist");
                imgList.id = imgListId;
                imgInput.setAttribute("list", imgListId);
                imgInput.addEventListener("change", () => { arr[i].image = imgInput.value; });
                midRow.appendChild(imgInput);
                midRow.appendChild(imgList);
                (async () => {
                    try {
                        const inputs = await fetchInputs();
                        for (const inp of inputs) {
                            const o = document.createElement("option"); o.value = inp; imgList.appendChild(o);
                        }
                    } catch { /* ignore */ }
                })();
                card.appendChild(midRow);

                const botRow = document.createElement("div");
                css(botRow, "display:flex;gap:4px;align-items:center;");
                const strInput = makeNumberInput(cn.strength ?? 1.0, "strength", 0.05);
                strInput.style.width = "80px";
                strInput.min = "0";
                strInput.max = "2";
                strInput.addEventListener("change", () => { arr[i].strength = parseFloat(strInput.value) || 1; });
                botRow.appendChild(strInput);

                const startInput = makeNumberInput(cn.start_percent ?? 0, "start%", 0.05);
                startInput.style.width = "70px";
                startInput.min = "0";
                startInput.max = "1";
                startInput.addEventListener("change", () => { arr[i].start_percent = parseFloat(startInput.value) || 0; });
                botRow.appendChild(startInput);

                const endInput = makeNumberInput(cn.end_percent ?? 1, "end%", 0.05);
                endInput.style.width = "70px";
                endInput.min = "0";
                endInput.max = "1";
                endInput.addEventListener("change", () => { arr[i].end_percent = parseFloat(endInput.value) || 1; });
                botRow.appendChild(endInput);

                card.appendChild(botRow);
                cnsBox.appendChild(card);
            }

            const addBtn = makeSmallButton("+ controlnet");
            addBtn.addEventListener("click", () => {
                arr.push({ type: "", model: "", image: "", strength: 1.0, start_percent: 0, end_percent: 1 });
                renderControlNets();
            });
            cnsBox.appendChild(addBtn);
        }
        renderControlNets();

        // ---- Cover image (Phase 3) ----
        if (mode === "edit" || mode === "create") {
            panel.appendChild(makeLabel("Cover image"));
            const coverRow = document.createElement("div");
            css(coverRow, "display:flex;gap:8px;align-items:center;");

            const coverPreview = document.createElement("img");
            css(coverPreview, "width:64px;height:64px;border-radius:4px;object-fit:cover;background:#2a2a2a;border:1px solid #444;");
            if (mode === "edit" && name) {
                coverPreview.src = getCoverUrl(name);
            }
            coverRow.appendChild(coverPreview);

            const coverInput = document.createElement("input");
            coverInput.type = "file";
            coverInput.accept = ".png,.jpg,.jpeg,.webp,.gif";
            css(coverInput, "font-size:11px;color:#ddd;");
            coverInput.addEventListener("change", () => {
                const file = coverInput.files?.[0];
                if (file) {
                    const reader = new FileReader();
                    reader.onload = () => { coverPreview.src = reader.result; };
                    reader.readAsDataURL(file);
                }
            });
            coverRow.appendChild(coverInput);

            panel.appendChild(coverRow);

            let _coverFile = null;
            coverInput.addEventListener("change", () => { _coverFile = coverInput.files?.[0]; });

            const origClose = close;
            close = async (value) => {
                // If user saved successfully and chose a cover file, upload it
                if (value && (value.created || value.saved) && _coverFile) {
                    try {
                        await uploadCover(value.name, _coverFile);
                    } catch { /* ignore — main save already happened */ }
                }
                origClose(value);
            };
        }

        // ---- Option groups ----
        panel.appendChild(makeLabel("Option groups"));
        const optsBox = document.createElement("div");
        css(optsBox, "display:flex;flex-direction:column;gap:8px;");
        panel.appendChild(optsBox);

        const optionsState = JSON.parse(JSON.stringify(data.options || {}));

        function renderOptions() {
            optsBox.replaceChildren();

            for (const groupName of Object.keys(optionsState)) {
                const groupCard = document.createElement("div");
                css(groupCard, "background:rgba(255,255,255,0.04);padding:8px;border-radius:4px;display:flex;flex-direction:column;gap:6px;");

                const headerRow = document.createElement("div");
                css(headerRow, "display:flex;gap:6px;align-items:center;");
                const groupNameInput = makeInput(groupName, "group name");
                const removeGroupBtn = makeSmallButton("✕ group");
                groupNameInput.addEventListener("change", () => {
                    const newName = groupNameInput.value.trim();
                    if (!newName || newName === groupName) return;
                    if (optionsState[newName]) { groupNameInput.value = groupName; return; }
                    optionsState[newName] = optionsState[groupName];
                    delete optionsState[groupName];
                    renderOptions();
                });
                removeGroupBtn.addEventListener("click", () => {
                    delete optionsState[groupName];
                    renderOptions();
                });
                headerRow.appendChild(groupNameInput);
                headerRow.appendChild(removeGroupBtn);
                groupCard.appendChild(headerRow);

                for (const choiceName of Object.keys(optionsState[groupName] || {})) {
                    const choiceCard = document.createElement("div");
                    css(choiceCard, "background:rgba(255,255,255,0.04);padding:6px;border-radius:3px;display:flex;flex-direction:column;gap:4px;");

                    const cRow = document.createElement("div");
                    css(cRow, "display:flex;gap:4px;align-items:center;");
                    const cNameInput = makeInput(choiceName, "choice name");
                    const removeChoiceBtn = makeSmallButton("✕");
                    cNameInput.addEventListener("change", () => {
                        const newCName = cNameInput.value.trim();
                        if (!newCName || newCName === choiceName) return;
                        if (optionsState[groupName][newCName]) { cNameInput.value = choiceName; return; }
                        optionsState[groupName][newCName] = optionsState[groupName][choiceName];
                        delete optionsState[groupName][choiceName];
                        renderOptions();
                    });
                    removeChoiceBtn.addEventListener("click", () => {
                        delete optionsState[groupName][choiceName];
                        renderOptions();
                    });
                    cRow.appendChild(cNameInput);
                    cRow.appendChild(removeChoiceBtn);
                    choiceCard.appendChild(cRow);

                    const choice = optionsState[groupName][choiceName] || {};
                    const cPos = makeTextarea(choice.positive || "", "extra positive (joined with ', ')", 2);
                    cPos.addEventListener("change", () => {
                        optionsState[groupName][choiceName] = optionsState[groupName][choiceName] || {};
                        optionsState[groupName][choiceName].positive = cPos.value;
                    });
                    choiceCard.appendChild(cPos);

                    const cNeg = makeTextarea(choice.negative || "", "extra negative", 2);
                    cNeg.addEventListener("change", () => {
                        optionsState[groupName][choiceName] = optionsState[groupName][choiceName] || {};
                        optionsState[groupName][choiceName].negative = cNeg.value;
                    });
                    choiceCard.appendChild(cNeg);

                    groupCard.appendChild(choiceCard);
                }

                const addChoiceBtn = makeSmallButton("+ choice");
                addChoiceBtn.addEventListener("click", () => {
                    const cn = window.prompt("Choice name:", "");
                    if (!cn) return;
                    const trimmed = cn.trim();
                    if (!trimmed || optionsState[groupName][trimmed]) return;
                    optionsState[groupName][trimmed] = { positive: "", negative: "" };
                    renderOptions();
                });
                groupCard.appendChild(addChoiceBtn);

                optsBox.appendChild(groupCard);
            }

            const addGroupBtn = makeSmallButton("+ option group");
            addGroupBtn.addEventListener("click", () => {
                const gn = window.prompt("Option group name (e.g. outfit):", "");
                if (!gn) return;
                const trimmed = gn.trim();
                if (!trimmed || optionsState[trimmed]) return;
                optionsState[trimmed] = {};
                renderOptions();
            });
            optsBox.appendChild(addGroupBtn);
        }
        renderOptions();

        // ---- Footer ----
        const footer = document.createElement("div");
        css(footer, "display:flex;gap:8px;justify-content:flex-end;margin-top:12px;");

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
            if (loraPath.value) ordered.path = loraPath.value;
            if (loraStrength.value) ordered.strength = parseFloat(loraStrength.value);
            if (posTA.value || negTA.value) {
                ordered.prompt = { positive: posTA.value, negative: negTA.value };
            }
            const rw = parseInt(resWidth.value);
            const rh = parseInt(resHeight.value);
            if (!isNaN(rw) && !isNaN(rh)) ordered.resolution = [rw, rh];
            const cnArr = cnsState._ || [];
            if (cnArr.length > 0) ordered.controlnets = cnArr;
            if (Object.keys(optionsState).length > 0) ordered.options = optionsState;

            try {
                if (mode === "create") {
                    const targetName = (pathInput.value || "").trim();
                    if (!targetName) { window.alert("Path is required"); return; }
                    await saveFlakeApi(targetName, ordered);
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

        panel.appendChild(footer);

        setTimeout(() => { (pathInput || posTA).focus(); }, 0);
    });
}

// ---------- Picker (Load existing) ----------

function openPicker(available) {
    return new Promise((resolve) => {
        const { panel, close, handlers } = openOverlay();
        handlers.onClose = (v) => resolve(v ?? null);
        css(panel, panel.style.cssText + "min-width:320px;");

        const title = document.createElement("h3");
        css(title, "margin:0;font-size:14px;");
        title.textContent = "Load existing flake";
        panel.appendChild(title);

        if (available.length === 0) {
            const empty = document.createElement("div");
            empty.textContent = "No saved flakes available.";
            css(empty, "opacity:0.5;font-style:italic;padding:12px;text-align:center;");
            panel.appendChild(empty);
        } else {
            const listBox = document.createElement("div");
            css(listBox, "display:flex;flex-direction:column;gap:4px;max-height:50vh;overflow:auto;");
            for (const n of available) {
                const item = document.createElement("button");
                item.textContent = n;
                css(item, "text-align:left;padding:6px 10px;background:#2a2a2a;color:#ddd;border:1px solid #444;border-radius:3px;cursor:pointer;font-size:12px;");
                item.addEventListener("mouseenter", () => { item.style.background = "#333"; });
                item.addEventListener("mouseleave", () => { item.style.background = "#2a2a2a"; });
                item.addEventListener("click", () => close({ name: n }));
                listBox.appendChild(item);
            }
            panel.appendChild(listBox);
        }

        const footer = document.createElement("div");
        css(footer, "display:flex;justify-content:flex-end;margin-top:8px;");
        const cancelBtn = makeButton("Cancel");
        cancelBtn.addEventListener("click", () => close(undefined));
        footer.appendChild(cancelBtn);
        panel.appendChild(footer);
    });
}

// ---------- Block ----------

function makeBlock({ entry, idx, onEdit, onRemove, onDragStart, onDragOver, onDrop, onDragEnd }) {
    const isDefault = !!entry.inline;
    const block = document.createElement("div");
    block.draggable = !isDefault;
    block.dataset.idx = String(idx);
    css(block, `position:relative;height:72px;background:${
        isDefault ? "#2a3a4a" : "#2a2a2a"
    };border:1px solid ${
        isDefault ? "#3a5a8a" : "#444"
    };border-radius:4px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;cursor:${
        isDefault ? "pointer" : "grab"
    };font-size:11px;color:#ddd;user-select:none;padding:4px 3px;box-sizing:border-box;`);

    // ---- Cover thumbnail (Phase 3) ----
    const cover = document.createElement("div");
    if (!isDefault && entry.name) {
        css(cover, `width:36px;height:36px;border-radius:50%;background-image:url(${getCoverUrl(entry.name)});background-size:cover;background-position:center;background-color:#444;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:600;color:#fff;`);
    } else {
        css(cover, `width:36px;height:36px;border-radius:50%;background:${
            isDefault ? "#3a5a8a" : "#444"
        };display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:600;color:#fff;`);
    }
    if (isDefault) {
        cover.textContent = "\u2726";
    } else if (!entry.name) {
        cover.textContent = "?";
    } else {
        const span = document.createElement("span");
        span.textContent = (entry.name || "?").split("/").pop().charAt(0).toUpperCase();
        cover.appendChild(span);
    }
    block.appendChild(cover);

    const nameEl = document.createElement("div");
    css(nameEl, "font-size:9px;text-align:center;line-height:1.2;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;");
    nameEl.textContent = isDefault ? "Default" : ((entry.name || "(missing)").split("/").pop());
    block.appendChild(nameEl);

    if (!isDefault) {
        const rm = document.createElement("button");
        rm.textContent = "\u2715";
        rm.title = "Remove from stack";
        css(rm, "position:absolute;top:2px;right:2px;width:16px;height:16px;line-height:14px;text-align:center;font-size:10px;background:#3a2a2a;color:#ddd;border:1px solid #555;border-radius:2px;cursor:pointer;padding:0;");
        rm.addEventListener("click", (e) => { e.stopPropagation(); onRemove(idx); });
        block.appendChild(rm);
    }

    block.addEventListener("dblclick", () => onEdit(idx));
    if (block.draggable) {
        block.addEventListener("dragstart", (e) => onDragStart(e, idx, block));
        block.addEventListener("dragend", () => onDragEnd(block));
    }
    block.addEventListener("dragover", (e) => onDragOver(e, idx, block));
    block.addEventListener("dragleave", () => { block.style.outline = ""; });
    block.addEventListener("drop", (e) => onDrop(e, idx, block));

    return block;
}

// ---- Per-instance controls (Phase 2) ----

function makeInstanceControls(block, entry, idx, onChanged) {
    if (entry.inline) return; // No per-instance controls for default block

    const controls = document.createElement("div");
    css(controls, "position:absolute;bottom:2px;left:2px;right:2px;display:flex;gap:2px;align-items:center;font-size:9px;");

    // Strength
    const strInput = document.createElement("input");
    strInput.type = "number";
    strInput.value = entry.strength != null ? entry.strength : 1.0;
    strInput.step = "0.05";
    strInput.min = "0";
    strInput.max = "2";
    strInput.title = "LoRA strength";
    css(strInput, "width:38px;background:rgba(0,0,0,0.4);color:#ddd;border:1px solid #555;border-radius:2px;padding:0 2px;font-size:9px;text-align:center;");
    strInput.addEventListener("change", () => {
        entry.strength = parseFloat(strInput.value) || 1.0;
        onChanged();
    });
    strInput.addEventListener("click", (e) => e.stopPropagation());
    strInput.addEventListener("dblclick", (e) => e.stopPropagation());
    strInput.addEventListener("mousedown", (e) => e.stopPropagation());
    controls.appendChild(strInput);

    // Options expander
    const expandBtn = document.createElement("button");
    expandBtn.textContent = "\u25BE";
    expandBtn.title = "Show option groups";
    css(expandBtn, "background:rgba(0,0,0,0.4);color:#aaa;border:1px solid #555;border-radius:2px;padding:0 3px;font-size:9px;cursor:pointer;line-height:1;");
    expandBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleOptionsPanel();
    });
    controls.appendChild(expandBtn);

    block.appendChild(controls);

    // Options panel (hidden by default)
    const panel = document.createElement("div");
    css(panel, "position:absolute;top:100%;left:0;right:0;background:#1e1e1e;border:1px solid #444;border-radius:4px;padding:4px;display:none;flex-direction:column;gap:3px;z-index:50;box-shadow:0 4px 12px rgba(0,0,0,0.5);margin-top:1px;min-width:120px;");
    panel.addEventListener("click", (e) => e.stopPropagation());
    panel.addEventListener("dblclick", (e) => e.stopPropagation());
    block.appendChild(panel);

    let optionsLoaded = false;

    async function toggleOptionsPanel() {
        if (panel.style.display === "flex") {
            panel.style.display = "none";
            return;
        }
        panel.style.display = "flex";

        if (!optionsLoaded && entry.name) {
            panel.textContent = "";
            const loading = document.createElement("div");
            css(loading, "font-size:9px;opacity:0.5;text-align:center;padding:4px;");
            loading.textContent = "loading...";
            panel.appendChild(loading);

            try {
                const options = await fetchFlakeMeta(entry.name);
                optionsLoaded = true;
                panel.replaceChildren();

                if (!Object.keys(options).length) {
                    const empty = document.createElement("div");
                    css(empty, "font-size:9px;opacity:0.5;padding:4px;text-align:center;");
                    empty.textContent = "no option groups";
                    panel.appendChild(empty);
                } else {
                    for (const group of Object.keys(options)) {
                        const row = document.createElement("div");
                        css(row, "display:flex;gap:2px;align-items:center;");
                        const gLabel = document.createElement("span");
                        gLabel.textContent = group + ":";
                        css(gLabel, "font-size:9px;opacity:0.7;white-space:nowrap;");
                        row.appendChild(gLabel);

                        const sel = document.createElement("select");
                        css(sel, "background:#2a2a2a;color:#ddd;border:1px solid #444;border-radius:2px;font-size:9px;padding:0 2px;flex:1;min-width:0;");
                        const noneOpt = document.createElement("option");
                        noneOpt.value = "";
                        noneOpt.textContent = "-";
                        sel.appendChild(noneOpt);

                        for (const ch of options[group]) {
                            const opt = document.createElement("option");
                            opt.value = ch;
                            opt.textContent = ch;
                            if ((entry.option || {})[group] === ch) opt.selected = true;
                            sel.appendChild(opt);
                        }

                        sel.addEventListener("change", () => {
                            if (sel.value) {
                                entry.option = entry.option || {};
                                entry.option[group] = sel.value;
                            } else {
                                if (entry.option) delete entry.option[group];
                            }
                            onChanged();
                        });
                        row.appendChild(sel);
                        panel.appendChild(row);
                    }
                }
            } catch {
                panel.replaceChildren();
                const err = document.createElement("div");
                css(err, "font-size:9px;color:#f88;padding:4px;text-align:center;");
                err.textContent = "failed to load";
                panel.appendChild(err);
            }
        }
    }
}

function makeAddBlock({ onNew, onLoad }) {
    const block = document.createElement("div");
    css(block, `position:relative;height:72px;background:#2a2a2a;border:1px dashed #555;border-radius:4px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;cursor:pointer;font-size:11px;color:#999;user-select:none;padding:4px 3px;box-sizing:border-box;`);

    const icon = document.createElement("div");
    css(icon, "width:36px;height:36px;border-radius:50%;background:#333;border:1px dashed #555;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:600;color:#888;");
    icon.textContent = "+";
    block.appendChild(icon);

    const label = document.createElement("div");
    css(label, "font-size:9px;text-align:center;");
    label.textContent = "Add flake";
    block.appendChild(label);

    const menu = document.createElement("div");
    css(menu, "position:absolute;top:100%;left:0;right:0;background:#1e1e1e;border:1px solid #444;border-radius:4px;display:none;flex-direction:column;padding:2px;z-index:100;box-shadow:0 4px 12px rgba(0,0,0,0.5);margin-top:2px;");

    const newBtn = document.createElement("button");
    newBtn.textContent = "+ New flake";
    css(newBtn, "width:100%;padding:6px 8px;background:#2a2a2a;color:#ddd;border:1px solid #444;border-radius:3px;cursor:pointer;font-size:12px;text-align:left;margin-bottom:2px;");
    const loadBtn = document.createElement("button");
    loadBtn.textContent = "\u2191 Load existing";
    css(loadBtn, "width:100%;padding:6px 8px;background:#2a2a2a;color:#ddd;border:1px solid #444;border-radius:3px;cursor:pointer;font-size:12px;text-align:left;");

    menu.appendChild(newBtn);
    menu.appendChild(loadBtn);
    block.appendChild(menu);

    let hideHandler = null;

    function showMenu() {
        menu.style.display = "flex";
        if (!hideHandler) {
            hideHandler = (e) => {
                if (!block.contains(e.target)) hideMenu();
            };
            document.addEventListener("click", hideHandler);
        }
    }

    function hideMenu() {
        menu.style.display = "none";
        if (hideHandler) {
            document.removeEventListener("click", hideHandler);
            hideHandler = null;
        }
    }

    block.addEventListener("click", (e) => {
        e.stopPropagation();
        menu.style.display === "flex" ? hideMenu() : showMenu();
    });

    menu.addEventListener("click", (e) => e.stopPropagation());

    newBtn.addEventListener("click", () => {
        hideMenu();
        onNew();
    });

    loadBtn.addEventListener("click", () => {
        hideMenu();
        onLoad();
    });

    block.addEventListener("dragover", (e) => e.preventDefault());
    block.addEventListener("drop", (e) => e.preventDefault());

    return block;
}

// ---------- Main widget ----------

function setupFlakeWidget(node) {
    const hidden = node.widgets?.find(w => w.name === "flakes_json");
    if (!hidden) return;

    hidden.computeSize = () => [0, -4];
    hidden.type = "hidden";
    hidden.hidden = true;
    hidden.computedHeight = 0;
    const hideEl = (el) => { if (!el) return; el.hidden = true; el.style.display = "none"; };
    hideEl(hidden.element);
    hideEl(hidden.inputEl);

    const container = document.createElement("div");
    css(container, "display:flex;flex-direction:column;gap:6px;padding:6px;font-size:12px;color:#ddd;");

    const grid = document.createElement("div");
    css(grid, "display:grid;grid-template-columns:repeat(auto-fill, minmax(72px, 1fr));gap:4px;");
    container.appendChild(grid);

    function readEntries() {
        try {
            const arr = JSON.parse(hidden.value || "[]");
            return ensureDefault(Array.isArray(arr) ? arr : []);
        } catch {
            return ensureDefault([]);
        }
    }
    function writeEntries(entries) { hidden.value = JSON.stringify(entries); }

    let dragSrcIdx = null;

    function render() {
        const entries = readEntries();
        grid.replaceChildren();
        for (let i = 0; i < entries.length; i++) {
            const blk = makeBlock({
                entry: entries[i],
                idx: i,
                onEdit: handleEdit,
                onRemove: handleRemove,
                onDragStart: (e, idx, el) => {
                    dragSrcIdx = idx;
                    e.dataTransfer.effectAllowed = "move";
                    el.style.opacity = "0.4";
                },
                onDragOver: (e, idx, el) => {
                    if (dragSrcIdx === null || idx === 0 || idx === dragSrcIdx) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    el.style.outline = "2px solid #2a6acf";
                },
                onDrop: (e, idx) => {
                    e.preventDefault();
                    if (dragSrcIdx === null || idx === 0 || idx === dragSrcIdx) return;
                    const arr = readEntries();
                    const [moved] = arr.splice(dragSrcIdx, 1);
                    arr.splice(idx, 0, moved);
                    writeEntries(arr);
                    dragSrcIdx = null;
                    render();
                },
                onDragEnd: (el) => {
                    el.style.opacity = "";
                    dragSrcIdx = null;
                    for (const child of grid.children) child.style.outline = "";
                },
            });
            // Phase 2: add per-instance controls
            makeInstanceControls(blk, entries[i], i, () => {
                writeEntries(entries);
            });
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

        const { directories } = await fetchList();

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
            writeEntries(arr);
            render();
        } else if (result.deleted) {
            const arr = readEntries().filter((_, i) => i !== idx);
            writeEntries(ensureDefault(arr));
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

    async function handleNew() {
        const { directories } = await fetchList();
        const result = await openEditModal({
            mode: "create",
            data: { prompt: { positive: "", negative: "" }, options: {} },
            dirs: directories,
        });
        if (!result || !result.created) return;
        const arr = readEntries();
        arr.push({ name: result.name, strength: 1.0, option: {} });
        writeEntries(arr);
        render();
    }

    async function handleLoad() {
        const { flakes } = await fetchList();
        const used = new Set(readEntries().filter(e => e.name).map(e => e.name));
        const available = flakes.filter(n => !used.has(n));
        const result = await openPicker(available);
        if (!result || !result.name) return;
        const arr = readEntries();
        arr.push({ name: result.name, strength: 1.0, option: {} });
        writeEntries(arr);
        render();
    }

    grid._addBlock = makeAddBlock({ onNew: handleNew, onLoad: handleLoad });

    node._flakes_render = render;
    const widget = node.addDOMWidget("flakes_ui", "div", container, { serialize: false });
    widget.computeSize = () => {
        const rows = Math.max(1, Math.ceil((readEntries().length + 1) / 2));
        return [node.size[0], rows * 80 + 36];
    };

    writeEntries(readEntries());
    render();
}

// ---------- Full Flake widget (Phase 4) ----------

function setupFullFlakeWidget(node) {
    const presetHidden = node.widgets?.find(w => w.name === "preset_json");
    const flakesHidden = node.widgets?.find(w => w.name === "flakes_json");
    if (!presetHidden || !flakesHidden) return;

    // Hide both STRING widgets
    for (const w of [presetHidden, flakesHidden]) {
        w.computeSize = () => [0, -4];
        w.type = "hidden";
        w.hidden = true;
        w.computedHeight = 0;
        const hideEl = (el) => { if (!el) return; el.hidden = true; el.style.display = "none"; };
        hideEl(w.element);
        hideEl(w.inputEl);
    }

    function readPreset() {
        try { return JSON.parse(presetHidden.value || "{}"); } catch { return {}; }
    }
    function writePreset(p) { presetHidden.value = JSON.stringify(p); }

    function readEntries() {
        try {
            const arr = JSON.parse(flakesHidden.value || "[]");
            return ensureDefault(Array.isArray(arr) ? arr : []);
        } catch { return ensureDefault([]); }
    }
    function writeEntries(entries) { flakesHidden.value = JSON.stringify(entries); }

    const container = document.createElement("div");
    css(container, "display:flex;flex-direction:column;gap:6px;padding:6px;font-size:12px;color:#ddd;");

    // ---- Preset selector ----
    const presetRow = document.createElement("div");
    css(presetRow, "display:flex;gap:6px;align-items:center;");

    const presetLabel = document.createElement("span");
    presetLabel.textContent = "model";
    css(presetLabel, "font-size:12px;opacity:0.6;white-space:nowrap;");

    const presetSelect = document.createElement("select");
    css(presetSelect, "flex:1;background:#1a1a1a;color:#ccc;border:1px solid #555;padding:2px 4px;border-radius:3px;font-size:11px;cursor:pointer;");

    const noneOpt = document.createElement("option");
    noneOpt.value = "";
    noneOpt.textContent = "— select a preset —";
    presetSelect.appendChild(noneOpt);

    const addPresetBtn = document.createElement("button");
    addPresetBtn.textContent = "+";
    addPresetBtn.title = "New model preset";
    css(addPresetBtn, "width:24px;height:24px;padding:0;cursor:pointer;background:#1a1a1a;color:#999;border:1px solid #555;border-radius:12px;font-size:14px;line-height:22px;text-align:center;");

    presetRow.appendChild(presetLabel);
    presetRow.appendChild(presetSelect);
    presetRow.appendChild(addPresetBtn);
    container.appendChild(presetRow);

    // ---- Flakes grid ----
    const grid = document.createElement("div");
    css(grid, "display:grid;grid-template-columns:repeat(auto-fill, minmax(72px, 1fr));gap:4px;");
    container.appendChild(grid);

    let dragSrcIdx = null;

    function render() {
        const entries = readEntries();
        grid.replaceChildren();
        for (let i = 0; i < entries.length; i++) {
            const blk = makeBlock({
                entry: entries[i],
                idx: i,
                onEdit: handleEdit,
                onRemove: handleRemove,
                onDragStart: (e, idx, el) => {
                    dragSrcIdx = idx;
                    e.dataTransfer.effectAllowed = "move";
                    el.style.opacity = "0.4";
                },
                onDragOver: (e, idx, el) => {
                    if (dragSrcIdx === null || idx === 0 || idx === dragSrcIdx) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    el.style.outline = "2px solid #2a6acf";
                },
                onDrop: (e, idx) => {
                    e.preventDefault();
                    if (dragSrcIdx === null || idx === 0 || idx === dragSrcIdx) return;
                    const arr = readEntries();
                    const [moved] = arr.splice(dragSrcIdx, 1);
                    arr.splice(idx, 0, moved);
                    writeEntries(arr);
                    dragSrcIdx = null;
                    render();
                },
                onDragEnd: (el) => {
                    el.style.opacity = "";
                    dragSrcIdx = null;
                    for (const child of grid.children) child.style.outline = "";
                },
            });
            makeInstanceControls(blk, entries[i], i, () => writeEntries(entries));
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

        const { directories } = await fetchList();
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
            writeEntries(arr);
            render();
        } else if (result.deleted) {
            const arr = readEntries().filter((_, i) => i !== idx);
            writeEntries(ensureDefault(arr));
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

    async function handleNew() {
        const { directories } = await fetchList();
        const result = await openEditModal({
            mode: "create",
            data: { prompt: { positive: "", negative: "" }, options: {} },
            dirs: directories,
        });
        if (!result || !result.created) return;
        const arr = readEntries();
        arr.push({ name: result.name, strength: 1.0, option: {} });
        writeEntries(arr);
        render();
    }

    async function handleLoad() {
        const { flakes } = await fetchList();
        const used = new Set(readEntries().filter(e => e.name).map(e => e.name));
        const available = flakes.filter(n => !used.has(n));
        const result = await openPicker(available);
        if (!result || !result.name) return;
        const arr = readEntries();
        arr.push({ name: result.name, strength: 1.0, option: {} });
        writeEntries(arr);
        render();
    }

    grid._addBlock = makeAddBlock({ onNew: handleNew, onLoad: handleLoad });

    // ---- Preset select loading ----
    async function loadPresetList() {
        try {
            const r = await fetch("/flakes/presets");
            const d = await r.json();
            const presets = d.presets || [];
            const current = readPreset();
            const currentName = current.name || "";

            presetSelect.replaceChildren();
            const noOpt = document.createElement("option");
            noOpt.value = "";
            noOpt.textContent = "— select a preset —";
            presetSelect.appendChild(noOpt);

            for (const p of presets) {
                const opt = document.createElement("option");
                opt.value = p;
                opt.textContent = p;
                if (p === currentName) opt.selected = true;
                presetSelect.appendChild(opt);
            }

            if (currentName && !presets.includes(currentName)) {
                const opt = document.createElement("option");
                opt.value = currentName;
                opt.textContent = currentName + " (missing)";
                opt.selected = true;
                presetSelect.appendChild(opt);
            }
        } catch { /* ignore */ }
    }

    presetSelect.addEventListener("change", () => {
        const p = readPreset();
        p.name = presetSelect.value;
        writePreset(p);
    });

    // ---- Manage Presets modal ----
    function openPresetManager() {
        return new Promise((resolve) => {
            const { panel, close, handlers } = openOverlay();
            handlers.onClose = (v) => resolve(v ?? null);
            css(panel, panel.style.cssText + "min-width:520px;");

            const title = document.createElement("h3");
            css(title, "margin:0;font-size:14px;");
            title.textContent = "Manage Model Presets";
            panel.appendChild(title);

            // List of presets
            const listBox = document.createElement("div");
            css(listBox, "display:flex;flex-direction:column;gap:4px;max-height:40vh;overflow:auto;");
            panel.appendChild(listBox);

            const footer = document.createElement("div");
            css(footer, "display:flex;gap:8px;margin-top:8px;");

            const newBtn = makeButton("+ New Preset", true);
            const closeBtn = makeButton("Close");
            closeBtn.addEventListener("click", () => close(null));
            footer.appendChild(newBtn);
            footer.appendChild(closeBtn);
            panel.appendChild(footer);

            async function refreshList() {
                listBox.replaceChildren();
                try {
                    const r = await fetch("/flakes/presets");
                    const d = await r.json();
                    const presets = d.presets || [];

                    if (presets.length === 0) {
                        const empty = document.createElement("div");
                        css(empty, "opacity:0.5;font-style:italic;padding:12px;text-align:center;");
                        empty.textContent = "No presets yet.";
                        listBox.appendChild(empty);
                    }

                    for (const pn of presets) {
                        const row = document.createElement("div");
                        css(row, "display:flex;gap:4px;align-items:center;padding:4px 0;border-bottom:1px solid #333;");

                        const nameSpan = document.createElement("span");
                        nameSpan.textContent = pn;
                        css(nameSpan, "flex:1;font-size:12px;");
                        row.appendChild(nameSpan);

                        const editBtn = makeSmallButton("Edit");
                        editBtn.addEventListener("click", async () => {
                            try {
                                const r = await fetch(`/flakes/preset?name=${encodeURIComponent(pn)}`);
                                const d = await r.json();
                                const result = await openPresetEditModal({ mode: "edit", name: pn, data: d.data || {} });
                                if (result) refreshList();
                            } catch (err) {
                                window.alert(`Failed to load preset: ${err.message}`);
                            }
                        });
                        row.appendChild(editBtn);

                        const delBtn = makeSmallButton("Del");
                        css(delBtn, delBtn.style.cssText + "color:#faa;");
                        delBtn.addEventListener("click", async () => {
                            if (!window.confirm(`Delete preset '${pn}'?`)) return;
                            try {
                                await fetch(`/flakes/presets/delete?name=${encodeURIComponent(pn)}`, { method: "DELETE" });
                                loadPresetList();
                                refreshList();
                            } catch (err) {
                                window.alert(`Delete failed: ${err.message}`);
                            }
                        });
                        row.appendChild(delBtn);

                        listBox.appendChild(row);
                    }
                } catch (err) {
                    const errDiv = document.createElement("div");
                    css(errDiv, "color:#f88;padding:8px;");
                    errDiv.textContent = `Failed to load presets: ${err.message}`;
                    listBox.appendChild(errDiv);
                }
            }
            refreshList();

            newBtn.addEventListener("click", async () => {
                const result = await openPresetEditModal({
                    mode: "create",
                    data: {
                        checkpoint: "",
                        clip_skip: -2,
                        vae: "",
                        steps: 20,
                        cfg: 7.0,
                        sampler: "euler",
                        scheduler: "karras",
                        width: 1024,
                        height: 1024,
                        prompt: { positive: "", negative: "" },
                        embeddings: [],
                    },
                });
                if (result) {
                    refreshList();
                    loadPresetList();
                }
            });

            close(null);
        });
    }

    function openPresetEditModal({ mode, name, data }) {
        return new Promise((resolve) => {
            const { panel, close, handlers } = openOverlay();
            handlers.onClose = (v) => resolve(v ?? null);

            const title = document.createElement("h3");
            css(title, "margin:0 0 4px;font-size:14px;");
            title.textContent = mode === "create" ? "New Model Preset" : `Edit ${name}`;
            panel.appendChild(title);

            let pathInput = null;
            if (mode === "create") {
                panel.appendChild(makeLabel("Preset name (e.g. sdxl-juggernaut)"));
                pathInput = makeInput("", "my-preset");
                panel.appendChild(pathInput);
            }

            // Checkpoint
            panel.appendChild(makeLabel("Checkpoint (from models/checkpoints/)"));
            const ckptInput = makeInput(data.checkpoint || "", "sd_xl_base_1.0.safetensors");
            panel.appendChild(ckptInput);

            // Clip skip
            panel.appendChild(makeLabel("Clip Skip"));
            const csInput = makeNumberInput(data.clip_skip ?? -2, "-2", 1);
            csInput.min = "-24";
            csInput.max = "-1";
            panel.appendChild(csInput);

            // VAE
            panel.appendChild(makeLabel("VAE (optional, from models/vae/)"));
            const vaeInput = makeInput(data.vae || "", "sdxl_vae.safetensors");
            panel.appendChild(vaeInput);

            // Steps
            panel.appendChild(makeLabel("Steps"));
            const stepsInput = makeNumberInput(data.steps ?? 20, "20", 1);
            stepsInput.min = "1";
            stepsInput.max = "150";
            panel.appendChild(stepsInput);

            // CFG
            panel.appendChild(makeLabel("CFG"));
            const cfgInput = makeNumberInput(data.cfg ?? 7.0, "7.0", 0.5);
            cfgInput.min = "1";
            cfgInput.max = "30";
            panel.appendChild(cfgInput);

            // Sampler / Scheduler
            {
                panel.appendChild(makeLabel("Sampler / Scheduler"));

                const ssRow = document.createElement("div");
                css(ssRow, "display:flex;gap:8px;");

                const samplerInput = document.createElement("select");
                css(samplerInput, "flex:1;background:#2a2a2a;color:#ddd;border:1px solid #444;padding:4px 6px;border-radius:3px;font-size:12px;");
                const samplers = ["euler", "euler_ancestral", "heun", "heunpp2", "dpm_2", "dpm_2_ancestral", "lms", "dpm_fast", "dpm_adaptive", "dpmpp_2s_ancestral", "dpmpp_sde", "dpmpp_sde_gpu", "dpmpp_2m", "dpmpp_2m_sde", "dpmpp_2m_sde_gpu", "dpmpp_3m_sde", "dpmpp_3m_sde_gpu", "ddpm", "lcm", "ipndm", "ipndm_v", "deis", "res_multistep", "res_multistep_cfg", "res_multistep_turbo", "uni_pc", "uni_pc_bh2"];
                for (const s of samplers) {
                    const o = document.createElement("option"); o.value = s; o.textContent = s;
                    if (s === (data.sampler || "euler")) o.selected = true;
                    samplerInput.appendChild(o);
                }
                ssRow.appendChild(samplerInput);

                const schedInput = document.createElement("select");
                css(schedInput, "flex:1;background:#2a2a2a;color:#ddd;border:1px solid #444;padding:4px 6px;border-radius:3px;font-size:12px;");
                const schedulers = ["normal", "karras", "exponential", "sgm_uniform", "simple", "ddim_uniform"];
                for (const s of schedulers) {
                    const o = document.createElement("option"); o.value = s; o.textContent = s;
                    if (s === (data.scheduler || "karras")) o.selected = true;
                    schedInput.appendChild(o);
                }
                ssRow.appendChild(schedInput);

                panel.appendChild(ssRow);
            }

            // Resolution
            panel.appendChild(makeLabel("Resolution"));
            const resRow = document.createElement("div");
            css(resRow, "display:flex;gap:8px;align-items:center;");
            const wInput = makeNumberInput(data.width ?? 1024, "1024", 64);
            wInput.min = "64";
            wInput.step = "64";
            const rLabel = document.createElement("span");
            rLabel.textContent = "\u00d7";
            css(rLabel, "color:#888;");
            const hInput = makeNumberInput(data.height ?? 1024, "1024", 64);
            hInput.min = "64";
            hInput.step = "64";
            resRow.appendChild(wInput);
            resRow.appendChild(rLabel);
            resRow.appendChild(hInput);
            panel.appendChild(resRow);

            // Prompts
            const prompt = data.prompt || {};
            panel.appendChild(makeLabel("Positive prompt (base prompt before flakes)"));
            const posTA = makeTextarea(prompt.positive || "", "masterpiece, best quality", 3);
            panel.appendChild(posTA);

            panel.appendChild(makeLabel("Negative prompt (base negative before flakes)"));
            const negTA = makeTextarea(prompt.negative || "", "worst quality, low quality", 3);
            panel.appendChild(negTA);

            // Footer
            const footer = document.createElement("div");
            css(footer, "display:flex;gap:8px;justify-content:flex-end;margin-top:12px;");

            if (mode === "edit") {
                const delBtn = makeButton("Delete");
                css(delBtn, delBtn.style.cssText + "background:#5a2a2a;border-color:#7a3a3a;color:#fdd;margin-right:auto;");
                delBtn.addEventListener("click", async () => {
                    if (!window.confirm(`Delete preset '${name}'?`)) return;
                    try {
                        await fetch(`/flakes/presets/delete?name=${encodeURIComponent(name)}`, { method: "DELETE" });
                        close({ deleted: true, name });
                    } catch (err) {
                        window.alert(`Delete failed: ${err.message}`);
                    }
                });
                footer.appendChild(delBtn);
            }

            const cancelBtn = makeButton("Cancel");
            cancelBtn.addEventListener("click", () => close(undefined));
            footer.appendChild(cancelBtn);

            const saveBtn = makeButton("Save", true);
            saveBtn.addEventListener("click", async () => {
                const ordered = {
                    checkpoint: ckptInput.value,
                    clip_skip: parseInt(csInput.value),
                    vae: vaeInput.value || null,
                    steps: parseInt(stepsInput.value),
                    cfg: parseFloat(cfgInput.value),
                    sampler: samplerInput.value,
                    scheduler: schedInput.value,
                    width: parseInt(wInput.value),
                    height: parseInt(hInput.value),
                    prompt: { positive: posTA.value, negative: negTA.value },
                    embeddings: [],
                };

                try {
                    if (mode === "create") {
                        const pName = (pathInput.value || "").trim();
                        if (!pName) { window.alert("Preset name is required"); return; }
                        await fetch("/flakes/presets/save", {
                            method: "PUT",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ name: pName, data: ordered }),
                        });
                        close({ created: true, name: pName });
                    } else {
                        await fetch("/flakes/presets/save", {
                            method: "PUT",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ name, data: ordered }),
                        });
                        close({ saved: true, name });
                    }
                } catch (err) {
                    window.alert(`Save failed: ${err.message || err}`);
                }
            });
            footer.appendChild(saveBtn);
            panel.appendChild(footer);

            setTimeout(() => { (pathInput || ckptInput).focus(); }, 0);
        });
    }

    addPresetBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const result = await openPresetEditModal({
            mode: "create",
            data: {
                checkpoint: "",
                clip_skip: -2,
                vae: "",
                steps: 20,
                cfg: 7.0,
                sampler: "euler",
                scheduler: "karras",
                width: 1024,
                height: 1024,
                prompt: { positive: "", negative: "" },
                embeddings: [],
            },
        });
        if (result) loadPresetList();
    });

    // ---- Widget registration ----
    node._flakes_render = render;
    const flakeWidget = node.addDOMWidget("fullflakes_ui", "div", container, { serialize: false });
    flakeWidget.computeSize = () => {
        const rows = Math.max(1, Math.ceil((readEntries().length + 1) / 2));
        return [node.size[0], rows * 80 + 80];
    };
    writeEntries(readEntries());
    render();
}

// ---------- Extension registration ----------

app.registerExtension({
    name: "comfyui-flakes.FlakeStack",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name === "FlakeStack") {
            const origOnNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                const r = origOnNodeCreated?.apply(this, arguments);
                setupFlakeWidget(this);
                return r;
            };

            const origOnConfigure = nodeType.prototype.onConfigure;
            nodeType.prototype.onConfigure = function () {
                const r = origOnConfigure?.apply(this, arguments);
                this._flakes_render?.();
                return r;
            };
        }

        if (nodeData.name === "FullFlakes") {
            const origOnNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                const r = origOnNodeCreated?.apply(this, arguments);
                setupFullFlakeWidget(this);
                return r;
            };

            const origOnConfigure = nodeType.prototype.onConfigure;
            nodeType.prototype.onConfigure = function () {
                const r = origOnConfigure?.apply(this, arguments);
                this._flakes_render?.();
                return r;
            };
        }
    },
});
