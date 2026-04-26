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

let CKPTS_PROMISE = null;
function fetchCheckpoints() {
    if (!CKPTS_PROMISE) CKPTS_PROMISE = fetch("/flakes/checkpoints").then(r => r.json()).then(d => d.checkpoints || []);
    return CKPTS_PROMISE;
}

let VAES_PROMISE = null;
function fetchVaes() {
    if (!VAES_PROMISE) VAES_PROMISE = fetch("/flakes/vaes").then(r => r.json()).then(d => d.vaes || []);
    return VAES_PROMISE;
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
    css(b, "padding:2px 6px;font-size:10px;cursor:pointer;background:#2a2a2a;color:#ddd;border:1px solid #444;border-radius:3px;");
    return b;
}

function makeIconBtn(text, title, onClick) {
    const b = document.createElement("button");
    b.textContent = text;
    b.title = title;
    css(b, "width:18px;height:18px;padding:0;cursor:pointer;background:#2a2a2a;color:#aaa;border:1px solid #444;border-radius:3px;font-size:10px;line-height:16px;text-align:center;flex-shrink:0;");
    b.addEventListener("click", onClick);
    b.addEventListener("dblclick", (e) => e.stopPropagation());
    b.addEventListener("mousedown", (e) => e.stopPropagation());
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

        // ---- Name (display name for grid) ----
        panel.appendChild(makeLabel("Display name (shown in the grid)"));
        const displayNameInput = makeInput(data.name || "", "e.g. My Flake");
        panel.appendChild(displayNameInput);

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
        const loraSelect = document.createElement("select");
        css(loraSelect, "width:100%;background:#1a1a1a;color:#ccc;border:1px solid #555;padding:4px 6px;border-radius:3px;font-size:12px;");
        const loraNone = document.createElement("option");
        loraNone.value = "";
        loraNone.textContent = "(none)";
        loraSelect.appendChild(loraNone);
        (async () => {
            try {
                const loras = await fetchLoras();
                for (const l of loras) {
                    const o = document.createElement("option");
                    o.value = l;
                    o.textContent = l.split("/").pop();
                    if (l === (data.path || "")) o.selected = true;
                    loraSelect.appendChild(o);
                }
            } catch { /* ignore */ }
        })();
        panel.appendChild(loraSelect);

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
            if (displayNameInput.value) ordered.name = displayNameInput.value.trim();
            if (loraSelect.value) ordered.path = loraSelect.value;
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
    const hasCover = !isDefault && entry.name;
    const block = document.createElement("div");
    block.dataset.idx = String(idx);

    css(block, `position:relative;height:80px;background:${
        isDefault ? "#2a3a4a" : "#2a2a2a"
    };border:1px solid ${
        isDefault ? "#3a5a8a" : "#444"
    };border-radius:4px;cursor:pointer;font-size:11px;color:#ddd;user-select:none;overflow:hidden;box-sizing:border-box;${
        hasCover ? `background-image:url(${getCoverUrl(entry.name)});background-size:cover;background-position:center;` : ""
    }`);

    // Dark overlay for cover readability
    if (hasCover) {
        const overlay = document.createElement("div");
        css(overlay, "position:absolute;inset:0;background:rgba(0,0,0,0.45);pointer-events:none;z-index:0;");
        block.appendChild(overlay);
    }

    // Name — centered vertically over the background / overlay
    const fullName = isDefault ? "Default" : (entry.display_name || entry.name || "(missing)");
    const shortName = fullName.split(/[\/\\ _\-]+/).pop() || fullName;
    const nameEl = document.createElement("div");
    nameEl.title = fullName;
    css(nameEl, "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:500;text-align:center;line-height:1.2;text-shadow:0 1px 3px rgba(0,0,0,0.8);padding:0 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;z-index:1;");
    nameEl.textContent = shortName;
    block.appendChild(nameEl);

    // Drag handle
    if (!isDefault) {
        const grip = document.createElement("button");
        grip.textContent = "\u2630";
        grip.title = "Drag to reorder";
        grip.draggable = true;
        css(grip, "position:absolute;top:2px;left:2px;width:16px;height:16px;line-height:12px;text-align:center;font-size:8px;background:rgba(0,0,0,0.5);color:#888;border:1px solid #555;border-radius:2px;cursor:grab;padding:0;z-index:2;");
        grip.addEventListener("dragstart", (e) => { onDragStart(e, idx, block); });
        grip.addEventListener("dragend", () => { onDragEnd(block); });
        grip.addEventListener("click", (e) => e.stopPropagation());
        block.appendChild(grip);
    }

    // Remove button
    if (!isDefault) {
        const rm = document.createElement("button");
        rm.textContent = "\u2715";
        rm.title = "Remove from stack";
        css(rm, "position:absolute;top:2px;right:2px;width:16px;height:16px;line-height:14px;text-align:center;font-size:10px;background:rgba(0,0,0,0.5);color:#ddd;border:1px solid #555;border-radius:2px;cursor:pointer;padding:0;z-index:2;");
        rm.addEventListener("click", (e) => { e.stopPropagation(); onRemove(idx); });
        block.appendChild(rm);
    }

    block.addEventListener("dblclick", () => onEdit(idx));
    block.addEventListener("dragover", (e) => onDragOver(e, idx, block));
    block.addEventListener("dragleave", () => { block.style.outline = ""; });
    block.addEventListener("drop", (e) => onDrop(e, idx, block));

    return block;
}

// ---- Per-instance controls (Phase 2) ----

function makeInstanceControls(block, entry, idx, onChanged) {
    if (entry.inline) return;

    const step = 0.05;
    const clampVal = (v) => Math.round(Math.min(2, Math.max(0, v)) / step) * step;
    const formatVal = (v) => v.toFixed(2);

    // Controls container — stack rows vertically
    const controls = document.createElement("div");
    css(controls, "position:absolute;bottom:4px;left:6px;right:6px;display:flex;flex-direction:column;gap:2px;z-index:2;");
    block.appendChild(controls);

    // Strength row (only if flake has a LoRA)
    if (entry.has_lora) {
        const strRow = document.createElement("div");
        css(strRow, "display:flex;gap:3px;align-items:center;");

        const minusBtn = makeIconBtn("\u2212", "Decrease strength",
            (e) => { e.stopPropagation(); entry.strength = clampVal((entry.strength ?? 1) - step); valSpan.textContent = formatVal(entry.strength); onChanged(); });

        const valSpan = document.createElement("span");
        valSpan.textContent = formatVal(entry.strength != null ? entry.strength : 1);
        css(valSpan, "flex:1;font-size:10px;text-align:center;color:#ccc;font-variant-numeric:tabular-nums;line-height:16px;");

        const plusBtn = makeIconBtn("+", "Increase strength",
            (e) => { e.stopPropagation(); entry.strength = clampVal((entry.strength ?? 1) + step); valSpan.textContent = formatVal(entry.strength); onChanged(); });

        strRow.appendChild(minusBtn);
        strRow.appendChild(valSpan);
        strRow.appendChild(plusBtn);
        controls.appendChild(strRow);
    }

    // Options row
    const optRow = document.createElement("div");
    css(optRow, "display:flex;gap:3px;align-items:center;");
    const expandBtn = makeIconBtn("\u25BE", "Show option groups",
        (e) => { e.stopPropagation(); toggleOptionsPanel(); });
    const optLabel = document.createElement("span");
    optLabel.textContent = "options";
    css(optLabel, "font-size:8px;opacity:0.5;");
    optRow.appendChild(expandBtn);
    optRow.appendChild(optLabel);
    controls.appendChild(optRow);

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
    css(block, `position:relative;height:80px;background:#2a2a2a;border:1px dashed #555;border-radius:4px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;cursor:pointer;font-size:11px;color:#999;user-select:none;box-sizing:border-box;`);

    const icon = document.createElement("div");
    css(icon, "font-size:20px;font-weight:300;color:#666;line-height:1;");
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

// ---------- FlakeStack widget ----------
function setupFlakeWidget(node) {
    const presetWidget = node.widgets?.find(w => w.name === "preset");
    const flakesHidden = node.widgets?.find(w => w.name === "flakes_json");
    if (!presetWidget || !flakesHidden) return;

    // Hide flakes_json STRING widget — it's only a data channel, no visible UI
    flakesHidden.computeSize = () => [0, -4];
    flakesHidden.type = "hidden";
    flakesHidden.hidden = true;
    if (flakesHidden.element) { flakesHidden.element.remove(); flakesHidden.element = null; }
    if (flakesHidden.inputEl) { flakesHidden.inputEl.remove(); flakesHidden.inputEl = null; }

    function readEntries() {
        try {
            const arr = JSON.parse(flakesHidden.value || "[]");
            return ensureDefault(Array.isArray(arr) ? arr : []);
        } catch { return ensureDefault([]); }
    }
    function writeEntries(entries) { flakesHidden.value = JSON.stringify(entries); }

    // ---- Custom DOM widget: "+" / "..." row + flakes grid ----
    const container = document.createElement("div");
    css(container, "display:flex;flex-direction:column;gap:2px;padding:0 6px 3px 6px;font-size:12px;color:#ddd;");

    // Hidden toolbar fallback for legacy canvas mode (shown only if DOM injection fails)
    const toolbar = document.createElement("div");
    css(toolbar, "display:none;gap:4px;align-items:center;");
    const plusBtn = document.createElement("button");
    plusBtn.textContent = "+";
    plusBtn.title = "New model preset";
    css(plusBtn, "width:22px;height:22px;padding:0;cursor:pointer;background:#1a1a1a;color:#999;border:1px solid #555;border-radius:11px;font-size:13px;line-height:20px;text-align:center;");
    toolbar.appendChild(plusBtn);
    const presetLabel = document.createElement("span");
    presetLabel.textContent = "model";
    css(presetLabel, "font-size:10px;opacity:0.4;white-space:nowrap;margin-left:2px;");
    toolbar.appendChild(presetLabel);
    container.appendChild(toolbar);

    // Flakes grid
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
        let has_lora = false;
        let display_name = null;
        if (result.data && result.data.lora_path) has_lora = true;
        else if (result.name) {
            try { const d = await fetchFlake(result.name); has_lora = !!(d && d.lora_path); } catch {}
        }
        if (result.data && result.data.name) display_name = result.data.name;
        else if (result.name) {
            try { const d = await fetchFlake(result.name); display_name = d.name || null; } catch {}
        }
        arr.push({ name: result.name, strength: 1.0, option: {}, has_lora, display_name });
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
        let has_lora = false;
        let display_name = null;
        try { const d = await fetchFlake(result.name); has_lora = !!(d && d.lora_path); display_name = d.name || null; } catch {}
        arr.push({ name: result.name, strength: 1.0, option: {}, has_lora, display_name });
        writeEntries(arr);
        render();
    }

    grid._addBlock = makeAddBlock({ onNew: handleNew, onLoad: handleLoad });

    // Initial load of preset options
    refreshPresetOptions();

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
            const ckptSelect = document.createElement("select");
            css(ckptSelect, "width:100%;background:#1a1a1a;color:#ccc;border:1px solid #555;padding:4px 6px;border-radius:3px;font-size:12px;");
            const ckptNone = document.createElement("option");
            ckptNone.value = "";
            ckptNone.textContent = "— select checkpoint —";
            ckptSelect.appendChild(ckptNone);
            (async () => {
                try {
                    const ckpts = await fetchCheckpoints();
                    for (const c of ckpts) {
                        const o = document.createElement("option");
                        o.value = c;
                        o.textContent = c.split("/").pop();
                        if (c === (data.checkpoint || "")) o.selected = true;
                        ckptSelect.appendChild(o);
                    }
                } catch { /* ignore */ }
            })();
            panel.appendChild(ckptSelect);

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
                    checkpoint: ckptSelect.value,
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

            setTimeout(() => { (pathInput || ckptSelect).focus(); }, 0);
        });
    }

    async function handleNewPreset(e) {
        if (e) e.stopPropagation();
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
        if (result) refreshPresetOptions();
    }
    plusBtn.addEventListener("click", handleNewPreset);

    async function refreshPresetOptions() {
        try {
            const r = await fetch("/flakes/presets");
            const d = await r.json();
            const names = d.presets || [];
            const newValues = names.length ? ["Select a preset...", ...names] : ["No model preset is selected"];
            // Update ALL FlakeStack preset widgets globally
            for (const n of app.graph.nodes) {
                if (n.type !== "FlakeStack") continue;
                const pw = n.widgets?.find(w => w.name === "preset");
                if (pw && pw.options) pw.options.values = newValues;
            }
        } catch { /* ignore */ }
    }

    function addPresetButtonToParent(parent) {
        if (!parent || parent.querySelector(".flake-preset-new-btn")) return false;
        const btn = document.createElement("button");
        btn.className = "flake-preset-new-btn";
        btn.textContent = "+";
        btn.title = "Create new preset";
        css(btn, "width:22px;height:22px;padding:0;cursor:pointer;background:#1a1a1a;color:#999;border:1px solid #555;border-radius:11px;font-size:13px;line-height:20px;text-align:center;flex-shrink:0;margin-left:4px;");
        btn.addEventListener("click", handleNewPreset);
        btn.addEventListener("dblclick", (e) => e.stopPropagation());
        btn.addEventListener("mousedown", (e) => e.stopPropagation());
        parent.style.display = "flex";
        parent.style.alignItems = "center";
        parent.appendChild(btn);
        return true;
    }

    function attachPresetButton() {
        let attachedAny = false;

        // Strategy 1: widget.element / inputEl (legacy canvas DOM)
        let presetEl = presetWidget.element || presetWidget.inputEl;
        if (presetEl?.parentElement) {
            if (addPresetButtonToParent(presetEl.parentElement)) attachedAny = true;
        }

        // Strategy 2: Node 2.0 PrimeVue Select — search by aria-label
        const byAria = document.querySelectorAll('[aria-label="preset"]');
        for (const el of byAria) {
            const parent = el.parentElement;
            if (parent && addPresetButtonToParent(parent)) attachedAny = true;
        }

        // Strategy 3: Legacy/native <select> elements
        const allSelects = document.querySelectorAll("select");
        for (const sel of allSelects) {
            const firstOpt = sel.options[0];
            if (!firstOpt) continue;
            const text = firstOpt.text || firstOpt.label || firstOpt.value || "";
            if (!text.includes("Select a preset") && !text.includes("No model preset")) continue;
            if (sel.parentElement && addPresetButtonToParent(sel.parentElement)) attachedAny = true;
        }

        return attachedAny;
    }

    // Try immediately, then use MutationObserver until the preset DOM renders
    if (!attachPresetButton()) {
        const observer = new MutationObserver(() => {
            if (attachPresetButton()) {
                observer.disconnect();
                // Hide legacy toolbar since inline button is working
                toolbar.style.display = "none";
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => {
            observer.disconnect();
            // If nothing was attached after 3s, show legacy toolbar fallback
            if (!document.querySelector(".flake-preset-new-btn")) {
                toolbar.style.display = "flex";
            }
        }, 3000);
    } else {
        toolbar.style.display = "none";
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
    },
});
