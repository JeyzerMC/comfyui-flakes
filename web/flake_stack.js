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

        const prompt = data.prompt || {};
        panel.appendChild(makeLabel("Positive prompt"));
        const posTA = makeTextarea(prompt.positive || "", "joined with ' BREAK ' between flakes", 4);
        panel.appendChild(posTA);

        panel.appendChild(makeLabel("Negative prompt"));
        const negTA = makeTextarea(prompt.negative || "", "joined with ', ' between flakes", 3);
        panel.appendChild(negTA);

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
            // Build new data preserving fields the modal doesn't (yet) edit.
            const ordered = {};
            if (data.path !== undefined) ordered.path = data.path;
            if (data.strength !== undefined) ordered.strength = data.strength;
            if (posTA.value || negTA.value) {
                ordered.prompt = { positive: posTA.value, negative: negTA.value };
            }
            if (data.resolution !== undefined) ordered.resolution = data.resolution;
            if (Object.keys(optionsState).length > 0) ordered.options = optionsState;
            if (data.controlnets !== undefined) ordered.controlnets = data.controlnets;

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
    css(block, `position:relative;height:104px;background:${
        isDefault ? "#2a3a4a" : "#2a2a2a"
    };border:1px solid ${
        isDefault ? "#3a5a8a" : "#444"
    };border-radius:4px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;cursor:${
        isDefault ? "pointer" : "grab"
    };font-size:11px;color:#ddd;user-select:none;padding:6px 4px;box-sizing:border-box;`);

    const cover = document.createElement("div");
    css(cover, `width:48px;height:48px;border-radius:50%;background:${
        isDefault ? "#3a5a8a" : "#444"
    };display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:600;color:#fff;`);
    if (isDefault) {
        cover.textContent = "✦";
    } else {
        const stem = (entry.name || "?").split("/").pop() || "?";
        cover.textContent = stem.charAt(0).toUpperCase();
    }
    block.appendChild(cover);

    const nameEl = document.createElement("div");
    css(nameEl, "font-size:10px;text-align:center;line-height:1.2;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;");
    nameEl.textContent = isDefault ? "Default" : ((entry.name || "(missing)").split("/").pop());
    block.appendChild(nameEl);

    if (!isDefault) {
        const rm = document.createElement("button");
        rm.textContent = "✕";
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

// ---------- Main widget ----------

function setupFlakeWidget(node) {
    const hidden = node.widgets?.find(w => w.name === "flakes_json");
    if (!hidden) return;

    // Hide the underlying multiline STRING widget; it remains as the serialization channel.
    hidden.computeSize = () => [0, -4];
    hidden.type = "hidden";
    hidden.hidden = true;
    hidden.computedHeight = 0;
    const hideEl = (el) => { if (!el) return; el.hidden = true; el.style.display = "none"; };
    hideEl(hidden.element);
    hideEl(hidden.inputEl);

    const container = document.createElement("div");
    css(container, "display:flex;flex-direction:column;gap:8px;padding:6px;font-size:12px;color:#ddd;");

    const grid = document.createElement("div");
    css(grid, "display:grid;grid-template-columns:repeat(auto-fill, minmax(96px, 1fr));gap:6px;");
    container.appendChild(grid);

    const tools = document.createElement("div");
    css(tools, "display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap;");
    const newBtn = makeSmallButton("+ New flake");
    const loadBtn = makeSmallButton("↑ Load existing");
    tools.appendChild(newBtn);
    tools.appendChild(loadBtn);
    container.appendChild(tools);

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
            grid.appendChild(makeBlock({
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
            }));
        }
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
        // For 'saved': stack unchanged (the YAML on disk was updated).
    }

    function handleRemove(idx) {
        if (idx === 0) return;
        const arr = readEntries();
        arr.splice(idx, 1);
        writeEntries(arr);
        render();
    }

    newBtn.addEventListener("click", async () => {
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
    });

    loadBtn.addEventListener("click", async () => {
        const { flakes } = await fetchList();
        const used = new Set(readEntries().filter(e => e.name).map(e => e.name));
        const available = flakes.filter(n => !used.has(n));
        const result = await openPicker(available);
        if (!result || !result.name) return;
        const arr = readEntries();
        arr.push({ name: result.name, strength: 1.0, option: {} });
        writeEntries(arr);
        render();
    });

    node._flakes_render = render;
    node.addDOMWidget("flakes_ui", "div", container, { serialize: false });

    // Initialize: ensure the default-flake entry exists, then render.
    writeEntries(readEntries());
    render();
}

app.registerExtension({
    name: "comfyui-flakes.FlakeStack",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "FlakeStack") return;

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
    },
});
