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

async function fetchPreset(name) {
    const r = await fetch(`/flakes/preset?name=${encodeURIComponent(name)}`);
    if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${r.status}`);
    }
    return (await r.json()).data || {};
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
        content: { options: {} },
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

// ----- ComfyUI-native style helpers (for modal) -----

function makeComfyLabel(text) {
    const l = document.createElement("div");
    l.textContent = text;
    css(l, "font-size:13px;color:#aaa;margin:10px 0 4px;font-weight:400;");
    return l;
}

function makeComfyInput(value = "", placeholder = "") {
    const el = document.createElement("input");
    el.type = "text";
    el.value = value;
    el.placeholder = placeholder;
    css(el, "background:#1a1a1a;color:#ddd;border:1px solid #333;padding:6px 8px;border-radius:6px;font-size:13px;width:100%;box-sizing:border-box;outline:none;");
    el.addEventListener("focus", () => { el.style.borderColor = "#555"; });
    el.addEventListener("blur", () => { el.style.borderColor = "#333"; });
    return el;
}

function makeComfyDropdown(options = [], selected = "") {
    const wrap = document.createElement("div");
    css(wrap, "position:relative;width:100%;");
    const el = document.createElement("select");
    for (const opt of options) {
        const o = document.createElement("option");
        o.value = opt.value;
        o.textContent = opt.label;
        if (opt.value === selected) o.selected = true;
        el.appendChild(o);
    }
    css(el, "background:#1a1a1a;color:#ddd;border:1px solid #333;padding:6px 8px;border-radius:6px;font-size:13px;width:100%;box-sizing:border-box;appearance:none;cursor:pointer;outline:none;");
    el.addEventListener("focus", () => { el.style.borderColor = "#555"; });
    el.addEventListener("blur", () => { el.style.borderColor = "#333"; });

    // Chevron icon
    const chevron = document.createElement("div");
    chevron.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>`;
    css(chevron, "position:absolute;right:8px;top:50%;transform:translateY(-50%);pointer-events:none;");

    wrap.appendChild(el);
    wrap.appendChild(chevron);
    return { element: el, container: wrap };
}

let EMBEDDINGS_PROMISE = null;
function fetchEmbeddings() {
    if (!EMBEDDINGS_PROMISE) EMBEDDINGS_PROMISE = fetch("/flakes/embeddings").then(r => r.json()).then(d => d.embeddings || []);
    return EMBEDDINGS_PROMISE;
}

function makeSearchableDropdown(items = [], value = "", placeholder = "") {
    const wrap = document.createElement("div");
    css(wrap, "position:relative;width:100%;");

    const el = document.createElement("input");
    el.type = "text";
    el.value = value;
    el.placeholder = placeholder;
    const listId = `sd-${Math.random().toString(36).slice(2,9)}`;
    el.setAttribute("list", listId);
    css(el, "background:#1a1a1a;color:#ddd;border:1px solid #333;padding:6px 8px;border-radius:6px;font-size:13px;width:100%;box-sizing:border-box;outline:none;");
    el.addEventListener("focus", () => { el.style.borderColor = "#555"; });
    el.addEventListener("blur", () => { el.style.borderColor = "#333"; });

    const datalist = document.createElement("datalist");
    datalist.id = listId;
    for (const item of items) {
        const o = document.createElement("option");
        o.value = item;
        datalist.appendChild(o);
    }

    wrap.appendChild(el);
    wrap.appendChild(datalist);
    return { element: el, datalist, container: wrap };
}

function makeComfyNumberInput(value, placeholder, step = 1) {
    const el = document.createElement("input");
    el.type = "number";
    el.value = String(value);
    el.placeholder = placeholder;
    el.step = String(step);
    css(el, "background:#1a1a1a;color:#ddd;border:1px solid #333;padding:6px 8px;border-radius:6px;font-size:13px;width:100%;box-sizing:border-box;outline:none;");
    el.addEventListener("focus", () => { el.style.borderColor = "#555"; });
    el.addEventListener("blur", () => { el.style.borderColor = "#333"; });
    return el;
}

function makeComfySlider(value, min, max, step) {
    const row = document.createElement("div");
    css(row, "display:flex;align-items:center;gap:0;background:#1a1a1a;border:1px solid #333;border-radius:6px;overflow:hidden;");

    let current = parseFloat(value) || 0;
    const clamp = (v) => Math.min(max, Math.max(min, Math.round(v / step) * step));
    const format = (v) => Number.isInteger(step) ? String(v) : v.toFixed(step < 0.1 ? 2 : 1);
    current = clamp(current);

    const minusBtn = document.createElement("button");
    minusBtn.textContent = "\u2212";
    css(minusBtn, "width:28px;height:32px;padding:0;background:transparent;color:#888;border:none;border-right:1px solid #333;cursor:pointer;font-size:14px;line-height:1;flex-shrink:0;transition:background 0.1s;");
    minusBtn.addEventListener("mouseenter", () => minusBtn.style.background = "#252525");
    minusBtn.addEventListener("mouseleave", () => minusBtn.style.background = "transparent");

    const valSpan = document.createElement("span");
    valSpan.textContent = format(current);
    css(valSpan, "flex:1;text-align:center;font-size:13px;color:#ddd;font-variant-numeric:tabular-nums;user-select:none;cursor:ew-resize;height:32px;display:flex;align-items:center;justify-content:center;");

    const plusBtn = document.createElement("button");
    plusBtn.textContent = "+";
    css(plusBtn, "width:28px;height:32px;padding:0;background:transparent;color:#888;border:none;border-left:1px solid #333;cursor:pointer;font-size:14px;line-height:1;flex-shrink:0;transition:background 0.1s;");
    plusBtn.addEventListener("mouseenter", () => plusBtn.style.background = "#252525");
    plusBtn.addEventListener("mouseleave", () => plusBtn.style.background = "transparent");

    function update(v) {
        current = clamp(v);
        valSpan.textContent = format(current);
    }

    minusBtn.addEventListener("click", () => update(current - step));
    plusBtn.addEventListener("click", () => update(current + step));

    // Click to edit
    valSpan.addEventListener("click", (e) => {
        e.stopPropagation();
        const input = document.createElement("input");
        input.type = "number";
        input.value = String(current);
        input.step = String(step);
        css(input, "flex:1;text-align:center;font-size:13px;color:#ddd;background:transparent;border:none;outline:none;height:32px;");
        valSpan.replaceWith(input);
        input.focus();
        input.select();
        function commit() {
            const v = parseFloat(input.value);
            if (!isNaN(v)) update(v);
            input.replaceWith(valSpan);
            valSpan.textContent = format(current);
        }
        input.addEventListener("blur", commit);
        input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } if (e.key === "Escape") { input.replaceWith(valSpan); valSpan.textContent = format(current); } });
    });

    // Drag to slide
    let dragging = false;
    let startX = 0;
    let startVal = 0;
    const pxPerStep = 4;

    valSpan.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragging = true;
        startX = e.clientX;
        startVal = current;
        valSpan.style.cursor = "grabbing";
    });

    window.addEventListener("mousemove", (e) => {
        if (!dragging) return;
        const deltaPx = e.clientX - startX;
        const deltaSteps = Math.round(deltaPx / pxPerStep);
        const newVal = clamp(startVal + deltaSteps * step);
        if (newVal !== current) {
            current = newVal;
            valSpan.textContent = format(current);
        }
    });

    window.addEventListener("mouseup", () => {
        if (!dragging) return;
        dragging = false;
        valSpan.style.cursor = "ew-resize";
    });

    row.appendChild(minusBtn);
    row.appendChild(valSpan);
    row.appendChild(plusBtn);

    row.getValue = () => current;
    return row;
}

function makeComfyValueSlider(value, min, max, step, onChange) {
    const row = document.createElement("div");
    css(row, "display:flex;align-items:center;background:#1a1a1a;border:1px solid #333;border-radius:6px;overflow:hidden;height:32px;cursor:ew-resize;");

    let current = parseFloat(value) || 0;
    const clamp = (v) => Math.min(max, Math.max(min, Math.round(v / step) * step));
    const format = (v) => Number.isInteger(step) ? String(v) : v.toFixed(step < 0.1 ? 2 : 1);
    current = clamp(current);

    const valSpan = document.createElement("span");
    valSpan.textContent = format(current);
    css(valSpan, "flex:1;text-align:center;font-size:13px;color:#ddd;font-variant-numeric:tabular-nums;user-select:none;height:32px;display:flex;align-items:center;justify-content:center;");

    function update(v) {
        current = clamp(v);
        valSpan.textContent = format(current);
        if (onChange) onChange(current);
    }

    // Click to edit
    valSpan.addEventListener("click", (e) => {
        e.stopPropagation();
        const input = document.createElement("input");
        input.type = "number";
        input.value = String(current);
        input.step = String(step);
        css(input, "flex:1;text-align:center;font-size:13px;color:#ddd;background:transparent;border:none;outline:none;height:32px;");
        valSpan.replaceWith(input);
        input.focus();
        input.select();
        function commit() {
            const v = parseFloat(input.value);
            if (!isNaN(v)) update(v);
            input.replaceWith(valSpan);
            valSpan.textContent = format(current);
        }
        input.addEventListener("blur", commit);
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") { e.preventDefault(); commit(); }
            if (e.key === "Escape") { input.replaceWith(valSpan); valSpan.textContent = format(current); }
        });
    });

    // Drag to slide
    let dragging = false;
    let startX = 0;
    let startVal = 0;
    const pxPerStep = 4;

    row.addEventListener("mousedown", (e) => {
        if (e.target === valSpan) return;
        e.preventDefault();
        dragging = true;
        startX = e.clientX;
        startVal = current;
        row.style.cursor = "grabbing";
    });

    valSpan.addEventListener("mousedown", (e) => {
        e.preventDefault();
        dragging = true;
        startX = e.clientX;
        startVal = current;
        row.style.cursor = "grabbing";
    });

    window.addEventListener("mousemove", (e) => {
        if (!dragging) return;
        const deltaPx = e.clientX - startX;
        const deltaSteps = Math.round(deltaPx / pxPerStep);
        const newVal = clamp(startVal + deltaSteps * step);
        if (newVal !== current) {
            current = newVal;
            valSpan.textContent = format(current);
        }
    });

    window.addEventListener("mouseup", () => {
        if (!dragging) return;
        dragging = false;
        row.style.cursor = "ew-resize";
    });

    row.appendChild(valSpan);
    row.getValue = () => current;
    row.update = update;
    return row;
}

// ---------- Modal infrastructure ----------

function openOverlay() {
    const overlay = document.createElement("div");
    css(overlay, "position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,sans-serif;");
    const panel = document.createElement("div");
    css(panel, "background:#1e1e1e;color:#ddd;border:1px solid #2a2a2a;border-radius:12px;min-width:480px;max-width:720px;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,0.5);");

    const content = document.createElement("div");
    css(content, "flex:1;overflow:auto;padding:20px;display:flex;flex-direction:column;gap:4px;min-height:0;");

    const footer = document.createElement("div");
    css(footer, "flex-shrink:0;padding:12px 20px;border-top:1px solid #333;display:flex;gap:8px;justify-content:flex-end;");

    panel.appendChild(content);
    panel.appendChild(footer);
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
    return { overlay, panel, content, footer, close, handlers };
}

// ---------- Edit / Create / Default modal ----------

function openEditModal({ mode, name, data, dirs }) {
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
        if (mode === "create") {
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
            lora: data.path ? { path: data.path, strength: data.strength ?? 1.0 } : null,
            prompt: (data.prompt?.positive != null || data.prompt?.negative != null)
                ? { positive: data.prompt?.positive ?? null, negative: data.prompt?.negative ?? null }
                : null,
            resolution: data.resolution ? [...data.resolution] : null,
            controlnets: JSON.parse(JSON.stringify(data.controlnets || [])),
            options: JSON.parse(JSON.stringify(data.options || {})),
        };
        if (!Array.isArray(fieldState.controlnets._)) {
            const arr = Array.isArray(fieldState.controlnets) ? [...fieldState.controlnets] : [];
            fieldState.controlnets = { _: arr };
        }

        const activeFields = [];
        if (fieldState.lora) activeFields.push("lora");
        if (fieldState.prompt) activeFields.push("prompt");
        if (fieldState.resolution) activeFields.push("resolution");
        if (fieldState.controlnets._.length > 0) activeFields.push("controlnets");
        if (Object.keys(fieldState.options).length > 0) activeFields.push("options");

        const optionalBox = document.createElement("div");
        css(optionalBox, "display:flex;flex-direction:column;gap:8px;");
        content.appendChild(optionalBox);

        function renderFields() {
            optionalBox.replaceChildren();

            for (const fieldType of activeFields) {
                const fieldWrap = document.createElement("div");
                css(fieldWrap, "background:#1a1a1a;padding:10px;border-radius:6px;border:1px solid #2a2a2a;display:flex;flex-direction:column;gap:6px;");

                const header = document.createElement("div");
                css(header, "display:flex;gap:6px;align-items:center;");

                const dragIcon = document.createElement("span");
                dragIcon.textContent = "\u2630";
                css(dragIcon, "cursor:grab;color:#666;font-size:12px;");
                header.appendChild(dragIcon);

                const fieldTitle = document.createElement("span");
                fieldTitle.textContent = fieldType.charAt(0).toUpperCase() + fieldType.slice(1);
                css(fieldTitle, "flex:1;font-size:12px;font-weight:500;color:#aaa;");
                header.appendChild(fieldTitle);

                const delFieldBtn = makeSmallButton("\u2715");
                delFieldBtn.addEventListener("click", () => {
                    const idx = activeFields.indexOf(fieldType);
                    if (idx !== -1) activeFields.splice(idx, 1);
                    if (fieldType === "lora") fieldState.lora = null;
                    if (fieldType === "prompt") fieldState.prompt = null;
                    if (fieldType === "resolution") fieldState.resolution = null;
                    if (fieldType === "controlnets") fieldState.controlnets._ = [];
                    if (fieldType === "options") {
                        for (const k of Object.keys(fieldState.options)) delete fieldState.options[k];
                    }
                    renderFields();
                });
                header.appendChild(delFieldBtn);
                fieldWrap.appendChild(header);

                if (fieldType === "lora") {
                    const row = document.createElement("div");
                    css(row, "display:flex;gap:8px;align-items:flex-start;");

                    const loraPathCol = document.createElement("div");
                    css(loraPathCol, "flex:3;min-width:0;display:flex;gap:4px;align-items:center;");

                    const loraBox = document.createElement("div");
                    css(loraBox, "flex:1;background:#1a1a1a;color:#ddd;border:1px solid #333;padding:6px 8px;border-radius:6px;font-size:13px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;");
                    const loraPath = fieldState.lora?.path || "";
                    const loraName = loraPath ? loraPath.replace(/\.safetensors?$/i, "").split(/[\\/]/).pop() : "No LoRA selected";
                    loraBox.textContent = loraName;
                    loraBox.title = loraPath || "";

                    const loraWrap = makeSearchableDropdown([], loraPath, "Select LoRA...");
                    loraWrap.container.style.display = "none";
                    (async () => {
                        try {
                            const loras = await fetchLoras();
                            for (const l of loras) loraWrap.datalist.appendChild(Object.assign(document.createElement("option"), { value: l }));
                        } catch { /* ignore */ }
                    })();

                    loraBox.addEventListener("click", () => {
                        loraBox.style.display = "none";
                        loraWrap.container.style.display = "block";
                        loraWrap.element.focus();
                    });
                    loraWrap.element.addEventListener("change", () => {
                        const val = loraWrap.element.value;
                        if (!fieldState.lora) fieldState.lora = { strength: 1.0 };
                        fieldState.lora.path = val;
                        const newName = val ? val.replace(/\.safetensors?$/i, "").split(/[\\/]/).pop() : "No LoRA selected";
                        loraBox.textContent = newName;
                        loraBox.title = val;
                    });
                    loraWrap.element.addEventListener("blur", () => {
                        setTimeout(() => {
                            loraWrap.container.style.display = "none";
                            loraBox.style.display = "block";
                        }, 200);
                    });

                    loraPathCol.appendChild(loraBox);
                    loraPathCol.appendChild(loraWrap.container);

                    if (loraPath) {
                        const clearLora = makeSmallButton("\u2715");
                        css(clearLora, "color:#f88;");
                        clearLora.addEventListener("click", (e) => {
                            e.stopPropagation();
                            if (fieldState.lora) fieldState.lora.path = "";
                            loraBox.textContent = "No LoRA selected";
                            loraBox.title = "";
                            loraWrap.element.value = "";
                        });
                        loraPathCol.appendChild(clearLora);
                    }

                    row.appendChild(loraPathCol);

                    const strCol = document.createElement("div");
                    css(strCol, "flex:1;min-width:0;");
                    const strSlider = makeComfyValueSlider(fieldState.lora?.strength ?? 1.0, -10, 10, 0.05);
                    strCol.appendChild(strSlider);
                    row.appendChild(strCol);
                    fieldWrap.appendChild(row);
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
        ];
        for (const ft of fieldTypes) {
            const item = document.createElement("button");
            item.textContent = ft.label;
            css(item, "text-align:left;padding:4px 8px;background:#2a2a2a;color:#ddd;border:1px solid #444;border-radius:3px;cursor:pointer;font-size:12px;");
            item.addEventListener("click", () => {
                fieldMenu.style.display = "none";
                if (activeFields.includes(ft.key)) return;
                activeFields.push(ft.key);
                if (ft.key === "lora") fieldState.lora = { path: "", strength: 1.0 };
                if (ft.key === "prompt") fieldState.prompt = {};
                if (ft.key === "resolution") fieldState.resolution = [1024, 1024];
                if (ft.key === "controlnets") fieldState.controlnets._ = [];
                if (ft.key === "options") fieldState.options = {};
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
            if (fieldState.lora) {
                if (fieldState.lora.path) ordered.path = fieldState.lora.path;
                ordered.strength = fieldState.lora.strength ?? 1.0;
            }
            if (fieldState.prompt) {
                ordered.prompt = {};
                if (fieldState.prompt.positive != null) ordered.prompt.positive = fieldState.prompt.positive;
                if (fieldState.prompt.negative != null) ordered.prompt.negative = fieldState.prompt.negative;
            }
            if (fieldState.resolution) {
                const rw = parseInt(fieldState.resolution[0]);
                const rh = parseInt(fieldState.resolution[1]);
                if (!isNaN(rw) && !isNaN(rh)) ordered.resolution = [rw, rh];
            }
            const cnArr = fieldState.controlnets._ || [];
            if (cnArr.length > 0) ordered.controlnets = cnArr;
            if (Object.keys(fieldState.options).length > 0) ordered.options = fieldState.options;

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

        setTimeout(() => { (pathInput || displayNameInput).focus(); }, 0);
    });
}

// ---------- Picker (Load existing) ----------

function openPicker(available) {
    return new Promise((resolve) => {
        const { content, footer, close, handlers } = openOverlay();
        handlers.onClose = (v) => resolve(v ?? null);
        css(content.parentElement, content.parentElement.style.cssText + "min-width:320px;");

        const title = document.createElement("h3");
        css(title, "margin:0 0 8px;font-size:16px;color:#fff;font-weight:500;");
        title.textContent = "Load existing flake";
        content.appendChild(title);

        if (available.length === 0) {
            const empty = document.createElement("div");
            empty.textContent = "No saved flakes available.";
            css(empty, "opacity:0.5;font-style:italic;padding:12px;text-align:center;");
            content.appendChild(empty);
        } else {
            const listBox = document.createElement("div");
            css(listBox, "display:flex;flex-direction:column;gap:4px;");
            for (const n of available) {
                const item = document.createElement("button");
                item.textContent = n;
                css(item, "text-align:left;padding:6px 10px;background:#2a2a2a;color:#ddd;border:1px solid #444;border-radius:3px;cursor:pointer;font-size:12px;");
                item.addEventListener("mouseenter", () => { item.style.background = "#333"; });
                item.addEventListener("mouseleave", () => { item.style.background = "#2a2a2a"; });
                item.addEventListener("click", () => close({ name: n }));
                listBox.appendChild(item);
            }
            content.appendChild(listBox);
        }

        const cancelBtn = makeButton("Cancel");
        cancelBtn.addEventListener("click", () => close(undefined));
        footer.appendChild(cancelBtn);
    });
}

// ---------- Block ----------

function makeBlock({ entry, idx, onEdit, onRemove, onOverride, onDragStart, onDragOver, onDrop, onDragEnd }) {
    const isDefault = !!entry.inline;
    const hasCover = !isDefault && entry.name;
    const block = document.createElement("div");
    block.dataset.idx = String(idx);
    block.dataset.flakeBlock = "1";

    css(block, `position:relative;height:80px;background:${
        isDefault ? "#2a3a4a" : "#2a2a2a"
    };border:1px solid ${
        isDefault ? "#3a5a8a" : "#444"
    };border-radius:4px;cursor:pointer;font-size:11px;color:#ddd;user-select:none;box-sizing:border-box;${
        hasCover ? `background-image:url(${getCoverUrl(entry.name)});background-size:cover;background-position:center;` : ""
    }`);

    // Dark overlay for cover readability
    if (hasCover) {
        const overlay = document.createElement("div");
        css(overlay, "position:absolute;inset:0;background:rgba(0,0,0,0.45);pointer-events:none;z-index:0;");
        block.appendChild(overlay);
    }

    // Name
    const fullName = isDefault ? "Default" : (entry.display_name || entry.name || "(missing)");
    const shortName = fullName.split(/[\/\\ _\-]+/).pop() || fullName;
    const nameEl = document.createElement("div");
    nameEl.title = fullName;
    css(nameEl, "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:500;text-align:center;line-height:1.2;text-shadow:0 1px 3px rgba(0,0,0,0.8);padding:0 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;z-index:1;");
    nameEl.textContent = shortName;
    block.appendChild(nameEl);

    // Drag handle (left edge vertical line)
    if (!isDefault) {
        const dragHandle = document.createElement("div");
        css(dragHandle, "position:absolute;left:0;top:20%;bottom:20%;width:3px;background:#555;border-radius:2px;cursor:grab;z-index:2;");
        dragHandle.draggable = true;
        dragHandle.addEventListener("dragstart", (e) => { onDragStart(e, idx, block); });
        dragHandle.addEventListener("dragend", () => { onDragEnd(block); });
        block.appendChild(dragHandle);
    }

    // Override button
    if (!isDefault && entry._pendingData) {
        const ov = document.createElement("button");
        ov.textContent = "\uD83D\uDCBE";
        ov.title = "Save changes to disk";
        css(ov, "position:absolute;top:2px;right:20px;width:16px;height:16px;line-height:14px;text-align:center;font-size:10px;background:rgba(0,0,0,0.5);color:#ddd;border:1px solid #555;border-radius:2px;cursor:pointer;padding:0;z-index:2;");
        ov.addEventListener("click", (e) => { e.stopPropagation(); onOverride(idx); });
        block.appendChild(ov);
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

    // Triangle button (bottom center) for options / LoRA
    let triangleBtn = null;
    if (!isDefault && (entry.has_lora || entry.name)) {
        triangleBtn = document.createElement("button");
        triangleBtn.innerHTML = "&#9662;"; // down-pointing triangle
        css(triangleBtn, "position:absolute;bottom:2px;left:50%;transform:translateX(-50%);background:transparent;color:rgba(180,180,180,0.6);border:none;padding:0;font-size:12px;line-height:1;cursor:pointer;z-index:2;");
        triangleBtn.addEventListener("click", (e) => {
            e.stopPropagation();
        });
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

// ---- Per-instance controls ----

function makeInstanceControls(block, entry, idx, onChanged, triangleBtn) {
    if (entry.inline) return { toggleOptionsPanel: () => {} };

    // Options panel (hidden by default)
    const panel = document.createElement("div");
    css(panel, "position:absolute;top:100%;left:0;right:0;background:#1e1e1e;border:1px solid #444;border-radius:4px;padding:4px;display:none;flex-direction:column;gap:3px;z-index:50;box-shadow:0 4px 12px rgba(0,0,0,0.5);margin-top:1px;min-width:120px;");
    panel.addEventListener("click", (e) => e.stopPropagation());
    panel.addEventListener("dblclick", (e) => e.stopPropagation());
    block.appendChild(panel);

    let optionsLoaded = false;
    let hasOptions = false;

    function rebuildPanel() {
        panel.replaceChildren();

        // LoRA strength slider at top of panel
        if (entry.has_lora) {
            const sliderRow = document.createElement("div");
            css(sliderRow, "padding:2px 0;");
            const strSlider = makeComfyValueSlider(entry.strength != null ? entry.strength : 1.0, -10, 10, 0.05, (v) => {
                entry.strength = v;
                onChanged();
            });
            sliderRow.appendChild(strSlider);
            panel.appendChild(sliderRow);
        }

        if (!hasOptions || !Object.keys(hasOptions).length) {
            const empty = document.createElement("div");
            css(empty, "font-size:9px;opacity:0.5;padding:4px;text-align:center;");
            empty.textContent = "no option groups";
            panel.appendChild(empty);
        } else {
            for (const group of Object.keys(hasOptions)) {
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

                for (const ch of hasOptions[group]) {
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
    }

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
                hasOptions = options;
                rebuildPanel();
            } catch {
                panel.replaceChildren();
                const err = document.createElement("div");
                css(err, "font-size:9px;color:#f88;padding:4px;text-align:center;");
                err.textContent = "failed to load";
                panel.appendChild(err);
            }
        }
    }

    // Right-click to open options panel
    block.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        toggleOptionsPanel();
    });

    // Triangle button click
    if (triangleBtn) {
        triangleBtn.addEventListener("click", () => {
            toggleOptionsPanel();
        });
    }

    return { toggleOptionsPanel };
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
    const flakesHidden = node.widgets?.find(w => w.name === "flakes_json");
    if (!flakesHidden) return;

    // Hide flakes_json STRING widget
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
            const { block: blk, triangleBtn } = makeBlock({
                entry: entries[i],
                idx: i,
                onEdit: handleEdit,
                onRemove: handleRemove,
                onOverride: handleOverride,
                onDragStart: (e, idx, el) => {
                    dragSrcIdx = idx;
                    e.dataTransfer.effectAllowed = "move";
                    el.style.opacity = "0.4";
                },
                onDragOver: (e, idx, el) => {
                    if (dragSrcIdx === null || idx === 0 || idx === dragSrcIdx) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    el.style.boxShadow = "inset 2px 0 0 #2a6acf";
                },
                onDrop: (e, idx, el) => {
                    e.preventDefault();
                    el.style.boxShadow = "";
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
                    for (const b of grid.querySelectorAll("[data-flake-block]")) {
                        b.style.boxShadow = "";
                    }
                },
            });
            makeInstanceControls(blk, entries[i], i, () => writeEntries(entries), triangleBtn);
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
                data = entry._pendingData ? JSON.parse(JSON.stringify(entry._pendingData)) : await fetchFlake(entry.name);
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
        } else if (result.saved) {
            const arr = readEntries();
            arr[idx]._pendingData = result.data;
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

    async function handleOverride(idx) {
        const entries = readEntries();
        const entry = entries[idx];
        if (!entry.name || !entry._pendingData) {
            window.alert("No pending changes to save.");
            return;
        }
        try {
            await saveFlakeApi(entry.name, entry._pendingData);
            const arr = readEntries();
            delete arr[idx]._pendingData;
            writeEntries(arr);
            render();
        } catch (err) {
            window.alert(`Save failed: ${err.message || err}`);
        }
    }

    async function handleNew() {
        const { directories } = await fetchList();
        const result = await openEditModal({
            mode: "create",
            data: { options: {} },
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

// ---------- Preset helpers (extracted for FlakeModelPreset) ----------

async function refreshPresetOptions() {
    try {
        const r = await fetch("/flakes/presets");
        const d = await r.json();
        const names = d.presets || [];
        const newValues = names.length ? ["Select a preset...", ...names] : ["No model preset is selected"];
        for (const n of app.graph.nodes) {
            if (n.type !== "FlakeModelPreset") continue;
            const pw = n.widgets?.find(w => w.name === "preset");
            if (pw && pw.options) pw.options.values = newValues;
        }
    } catch { /* ignore */ }
}

function addPresetButtonToParent(parent) {
    if (!parent || parent.querySelector(".flake-preset-new-btn")) return false;

    const btn = document.createElement("button");
    btn.className = "flake-preset-new-btn";
    btn.title = "Create or edit model preset";
    btn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
             fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 5v14M5 12h14"/>
        </svg>`;
    css(btn, `
        display:inline-flex;align-items:center;justify-content:center;
        width:32px;height:32px;padding:0;margin:0;
        background:#1f1f1f;color:#aaa;
        border:none;border-left:1px solid #444;
        border-radius:0 6px 6px 0;
        cursor:pointer;flex-shrink:0;
        transition:background 0.15s ease;
    `);
    btn.addEventListener("mouseenter", () => { btn.style.background = "#2a2a2a"; });
    btn.addEventListener("mouseleave", () => { btn.style.background = "#1f1f1f"; });
    btn.addEventListener("click", handlePresetButton);
    btn.addEventListener("dblclick", (e) => e.stopPropagation());
    btn.addEventListener("mousedown", (e) => e.stopPropagation());

    parent.style.display = "flex";
    parent.style.alignItems = "center";
    parent.appendChild(btn);
    return true;
}

function attachPresetButton(node) {
    let attachedAny = false;
    const presetWidget = node.widgets?.find(w => w.name === "preset");
    if (!presetWidget) return false;

    let presetEl = presetWidget.element || presetWidget.inputEl;
    if (presetEl?.parentElement) {
        if (addPresetButtonToParent(presetEl.parentElement)) attachedAny = true;
    }
    const byAria = document.querySelectorAll('[aria-label="preset"]');
    for (const el of byAria) {
        const parent = el.parentElement;
        if (parent && addPresetButtonToParent(parent)) attachedAny = true;
    }
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

async function handlePresetButton(e) {
    if (e) e.stopPropagation();
    let current = "";
    for (const n of app.graph.nodes) {
        if (n.type !== "FlakeModelPreset") continue;
        const pw = n.widgets?.find(w => w.name === "preset");
        if (pw) { current = pw.value || ""; break; }
    }
    const isPlaceholder = !current || current === "Select a preset..." || current === "No model preset is selected";

    if (isPlaceholder) {
        const result = await openPresetEditModal({
            mode: "create",
            data: {
                checkpoint: "",
                clip_skip: -2,
                vae: "",
                steps: 20,
                cfg: 4.0,
                sampler: "dpmpp_2m",
                scheduler: "karras",
                width: 832,
                height: 1216,
                prompt: { positive: "", negative: "" },
                embeddings: [],
            },
        });
        if (result) refreshPresetOptions();
    } else {
        let data;
        try {
            data = await fetchPreset(current);
        } catch (err) {
            window.alert(`Failed to load preset '${current}': ${err.message || err}`);
            return;
        }
        const result = await openPresetEditModal({
            mode: "edit",
            name: current,
            data,
        });
        if (result) refreshPresetOptions();
    }
}

function openPresetEditModal({ mode, name, data }) {
    return new Promise((resolve) => {
        let { content, footer, close, handlers } = openOverlay();
        handlers.onClose = (v) => resolve(v ?? null);

        const title = document.createElement("h3");
        css(title, "margin:0 0 8px;font-size:16px;color:#fff;font-weight:500;");
        title.textContent = mode === "create" ? "New Model Preset" : `Edit ${name}`;
        content.appendChild(title);

        let pathInput = null;
        if (mode === "create") {
            content.appendChild(makeComfyLabel("Preset name"));
            pathInput = makeComfyInput("", "e.g. sdxl-juggernaut");
            content.appendChild(pathInput);
        } else {
            content.appendChild(makeComfyLabel("Preset name"));
            pathInput = makeComfyInput(name, "");
            content.appendChild(pathInput);
        }

        content.appendChild(makeComfyLabel("Checkpoint"));
        const ckptWrap = makeSearchableDropdown([], data.checkpoint || "", "Select checkpoint...");
        content.appendChild(ckptWrap.container);
        (async () => {
            try {
                const ckpts = await fetchCheckpoints();
                for (const c of ckpts) ckptWrap.datalist.appendChild(Object.assign(document.createElement("option"), { value: c }));
            } catch { /* ignore */ }
        })();

        const sliderRow = document.createElement("div");
        css(sliderRow, "display:flex;gap:8px;align-items:flex-start;");
        const csWrap = document.createElement("div");
        css(csWrap, "flex:1;min-width:0;");
        csWrap.appendChild(makeComfyLabel("Clip Skip"));
        const csSlider = makeComfyValueSlider(data.clip_skip ?? -2, -24, -1, 1);
        csWrap.appendChild(csSlider);
        sliderRow.appendChild(csWrap);
        const stepsWrap = document.createElement("div");
        css(stepsWrap, "flex:1;min-width:0;");
        stepsWrap.appendChild(makeComfyLabel("Steps"));
        const stepsSlider = makeComfyValueSlider(data.steps ?? 20, 1, 150, 1);
        stepsWrap.appendChild(stepsSlider);
        sliderRow.appendChild(stepsWrap);
        const cfgWrap = document.createElement("div");
        css(cfgWrap, "flex:1;min-width:0;");
        cfgWrap.appendChild(makeComfyLabel("CFG"));
        const cfgSlider = makeComfyValueSlider(data.cfg ?? 7.0, 1, 30, 0.5);
        cfgWrap.appendChild(cfgSlider);
        sliderRow.appendChild(cfgWrap);
        content.appendChild(sliderRow);

        content.appendChild(makeComfyLabel("VAE (optional)"));
        const vaeWrap = makeSearchableDropdown([], data.vae || "", "Select VAE...");
        content.appendChild(vaeWrap.container);
        (async () => {
            try {
                const vaes = await fetchVaes();
                for (const v of vaes) vaeWrap.datalist.appendChild(Object.assign(document.createElement("option"), { value: v }));
            } catch { /* ignore */ }
        })();

        const sampSchedRow = document.createElement("div");
        css(sampSchedRow, "display:flex;gap:8px;align-items:flex-start;");
        const sampWrap = document.createElement("div");
        css(sampWrap, "flex:1;min-width:0;");
        sampWrap.appendChild(makeComfyLabel("Sampler"));
        const samplerOpts = ["euler", "euler_ancestral", "heun", "heunpp2", "dpm_2", "dpm_2_ancestral", "lms", "dpm_fast", "dpm_adaptive", "dpmpp_2s_ancestral", "dpmpp_sde", "dpmpp_sde_gpu", "dpmpp_2m", "dpmpp_2m_sde", "dpmpp_2m_sde_gpu", "dpmpp_3m_sde", "dpmpp_3m_sde_gpu", "ddpm", "lcm", "ipndm", "ipndm_v", "deis", "res_multistep", "res_multistep_cfg", "res_multistep_turbo", "uni_pc", "uni_pc_bh2"].map(s => ({ value: s, label: s }));
        const samplerDD = makeComfyDropdown(samplerOpts, data.sampler || "euler");
        sampWrap.appendChild(samplerDD.container);
        sampSchedRow.appendChild(sampWrap);
        const schedWrap = document.createElement("div");
        css(schedWrap, "flex:1;min-width:0;");
        schedWrap.appendChild(makeComfyLabel("Scheduler"));
        const schedOpts = ["normal", "karras", "exponential", "sgm_uniform", "simple", "ddim_uniform"].map(s => ({ value: s, label: s }));
        const schedDD = makeComfyDropdown(schedOpts, data.scheduler || "karras");
        schedWrap.appendChild(schedDD.container);
        sampSchedRow.appendChild(schedWrap);
        content.appendChild(sampSchedRow);

        content.appendChild(makeComfyLabel("Resolution"));
        const resRow = document.createElement("div");
        css(resRow, "display:flex;gap:8px;align-items:center;");
        const wInput = makeComfyNumberInput(data.width ?? 1024, "1024", 64);
        const rLabel = document.createElement("span");
        rLabel.textContent = "\u00d7";
        css(rLabel, "color:#888;font-size:13px;");
        const hInput = makeComfyNumberInput(data.height ?? 1024, "1024", 64);
        resRow.appendChild(wInput);
        resRow.appendChild(rLabel);
        resRow.appendChild(hInput);
        content.appendChild(resRow);

        content.appendChild(makeComfyLabel("Positive embeddings"));
        const posEmbWrap = makeSearchableDropdown([], (data.embeddings?.positive || []).join(", "), "embedding1, embedding2...");
        content.appendChild(posEmbWrap.container);
        (async () => {
            try {
                const embs = await fetchEmbeddings();
                for (const e of embs) posEmbWrap.datalist.appendChild(Object.assign(document.createElement("option"), { value: e }));
            } catch { /* ignore */ }
        })();

        content.appendChild(makeComfyLabel("Negative embeddings"));
        const negEmbWrap = makeSearchableDropdown([], (data.embeddings?.negative || []).join(", "), "embedding1, embedding2...");
        content.appendChild(negEmbWrap.container);
        (async () => {
            try {
                const embs = await fetchEmbeddings();
                for (const e of embs) negEmbWrap.datalist.appendChild(Object.assign(document.createElement("option"), { value: e }));
            } catch { /* ignore */ }
        })();

        const prompt = data.prompt || {};
        content.appendChild(makeComfyLabel("Positive prompt"));
        const posTA = makeTextarea(prompt.positive || "", "masterpiece, best quality", 3);
        css(posTA, "background:#1a1a1a;color:#ddd;border:1px solid #333;padding:8px;border-radius:6px;font-size:13px;width:100%;box-sizing:border-box;font-family:inherit;resize:vertical;outline:none;");
        posTA.addEventListener("focus", () => posTA.style.borderColor = "#555");
        posTA.addEventListener("blur", () => posTA.style.borderColor = "#333");
        content.appendChild(posTA);

        content.appendChild(makeComfyLabel("Negative prompt"));
        const negTA = makeTextarea(prompt.negative || "", "worst quality, low quality", 3);
        css(negTA, "background:#1a1a1a;color:#ddd;border:1px solid #333;padding:8px;border-radius:6px;font-size:13px;width:100%;box-sizing:border-box;font-family:inherit;resize:vertical;outline:none;");
        negTA.addEventListener("focus", () => negTA.style.borderColor = "#555");
        negTA.addEventListener("blur", () => negTA.style.borderColor = "#333");
        content.appendChild(negTA);

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
                checkpoint: ckptWrap.element.value,
                clip_skip: csSlider.getValue(),
                vae: vaeWrap.element.value || null,
                steps: stepsSlider.getValue(),
                cfg: cfgSlider.getValue(),
                sampler: samplerDD.element.value,
                scheduler: schedDD.element.value,
                width: parseInt(wInput.value) || 1024,
                height: parseInt(hInput.value) || 1024,
                prompt: { positive: posTA.value, negative: negTA.value },
                embeddings: {
                    positive: posEmbWrap.element.value.split(",").map(s => s.trim()).filter(Boolean),
                    negative: negEmbWrap.element.value.split(",").map(s => s.trim()).filter(Boolean),
                },
            };

            try {
                const pName = (pathInput.value || "").trim();
                if (!pName) { window.alert("Preset name is required"); return; }
                if (mode === "create") {
                    await fetch("/flakes/presets/save", {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ name: pName, data: ordered }),
                    });
                    close({ created: true, name: pName });
                } else {
                    if (pName !== name) {
                        // Rename: save under new name, delete old
                        await fetch("/flakes/presets/save", {
                            method: "PUT",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ name: pName, data: ordered }),
                        });
                        await fetch(`/flakes/presets/delete?name=${encodeURIComponent(name)}`, { method: "DELETE" });
                        close({ saved: true, name: pName, oldName: name });
                    } else {
                        await fetch("/flakes/presets/save", {
                            method: "PUT",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ name, data: ordered }),
                        });
                        close({ saved: true, name });
                    }
                }
            } catch (err) {
                window.alert(`Save failed: ${err.message || err}`);
            }
        });
        footer.appendChild(saveBtn);

        setTimeout(() => { (pathInput || ckptWrap.element).focus(); }, 0);
    });
}

function setupFlakeModelPresetWidget(node) {
    const presetWidget = node.widgets?.find(w => w.name === "preset");
    if (!presetWidget) return;

    attachPresetButton(node);

    const attachInterval = setInterval(() => {
        attachPresetButton(node);
    }, 500);

    const origOnRemoved = node.onRemoved;
    node.onRemoved = function () {
        clearInterval(attachInterval);
        return origOnRemoved?.apply(this, arguments);
    };

    node._preset_render = () => {};
}

// ---------- FlakeCombo widget ----------

function makeComboBlock({ entry, idx, isActive, onActivate, onRemove }) {
    const hasCover = !!entry.name;
    const block = document.createElement("div");
    block.dataset.idx = String(idx);

    css(block, `position:relative;height:80px;background:${
        isActive ? "#2a4a3a" : "#2a2a2a"
    };border:2px solid ${
        isActive ? "#3a8a5a" : "#444"
    };border-radius:4px;cursor:pointer;font-size:11px;color:#ddd;user-select:none;box-sizing:border-box;${
        hasCover ? `background-image:url(${getCoverUrl(entry.name)});background-size:cover;background-position:center;` : ""
    }`);

    if (hasCover) {
        const overlay = document.createElement("div");
        css(overlay, "position:absolute;inset:0;background:rgba(0,0,0,0.45);pointer-events:none;z-index:0;");
        block.appendChild(overlay);
    }

    const fullName = entry.display_name || entry.name || "(missing)";
    const shortName = fullName.split(/[\/\\ _\-]+/).pop() || fullName;
    const nameEl = document.createElement("div");
    nameEl.title = fullName;
    css(nameEl, "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:500;text-align:center;line-height:1.2;text-shadow:0 1px 3px rgba(0,0,0,0.8);padding:0 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;z-index:1;");
    nameEl.textContent = shortName;
    block.appendChild(nameEl);

    if (isActive) {
        const check = document.createElement("div");
        check.textContent = "\u2713";
        css(check, "position:absolute;top:2px;left:2px;width:16px;height:16px;line-height:14px;text-align:center;font-size:10px;background:rgba(58,138,90,0.8);color:#fff;border-radius:2px;z-index:2;");
        block.appendChild(check);
    }

    const rm = document.createElement("button");
    rm.textContent = "\u2715";
    rm.title = "Remove from combo";
    css(rm, "position:absolute;top:2px;right:2px;width:16px;height:16px;line-height:14px;text-align:center;font-size:10px;background:rgba(0,0,0,0.5);color:#ddd;border:1px solid #555;border-radius:2px;cursor:pointer;padding:0;z-index:2;");
    rm.addEventListener("click", (e) => { e.stopPropagation(); onRemove(idx); });
    block.appendChild(rm);

    block.addEventListener("click", () => onActivate(idx));

    return block;
}

function setupFlakeComboWidget(node) {
    const flakesHidden = node.widgets?.find(w => w.name === "flakes_json");
    if (!flakesHidden) return;

    flakesHidden.computeSize = () => [0, -4];
    flakesHidden.type = "hidden";
    flakesHidden.hidden = true;
    if (flakesHidden.element) { flakesHidden.element.remove(); flakesHidden.element = null; }
    if (flakesHidden.inputEl) { flakesHidden.inputEl.remove(); flakesHidden.inputEl = null; }

    if (!node.properties) node.properties = {};
    if (!node.properties._combo_flakes) node.properties._combo_flakes = [];
    if (node.properties._combo_active_index == null) node.properties._combo_active_index = 0;

    function readAllFlakes() {
        return node.properties._combo_flakes || [];
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

    function render() {
        const flakes = readAllFlakes();
        const activeIdx = node.properties._combo_active_index || 0;
        grid.replaceChildren();

        for (let i = 0; i < flakes.length; i++) {
            const blk = makeComboBlock({
                entry: flakes[i],
                idx: i,
                isActive: i === activeIdx,
                onActivate: (idx) => {
                    node.properties._combo_active_index = idx;
                    updateActiveFlake();
                    render();
                },
                onRemove: (idx) => {
                    const arr = readAllFlakes();
                    arr.splice(idx, 1);
                    if (node.properties._combo_active_index >= arr.length) {
                        node.properties._combo_active_index = Math.max(0, arr.length - 1);
                    }
                    writeAllFlakes(arr);
                    render();
                },
            });
            grid.appendChild(blk);
        }

        if (grid._addBlock) grid.appendChild(grid._addBlock);
    }

    async function handleNew() {
        const { directories } = await fetchList();
        const result = await openEditModal({
            mode: "create",
            data: { options: {} },
            dirs: directories,
        });
        if (!result || !result.created) return;
        const arr = readAllFlakes();
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
        writeAllFlakes(arr);
        render();
    }

    async function handleLoad() {
        const { flakes } = await fetchList();
        const used = new Set(readAllFlakes().filter(e => e.name).map(e => e.name));
        const available = flakes.filter(n => !used.has(n));
        const result = await openPicker(available);
        if (!result || !result.name) return;
        const arr = readAllFlakes();
        let has_lora = false;
        let display_name = null;
        try { const d = await fetchFlake(result.name); has_lora = !!(d && d.lora_path); display_name = d.name || null; } catch {}
        arr.push({ name: result.name, strength: 1.0, option: {}, has_lora, display_name });
        writeAllFlakes(arr);
        render();
    }

    grid._addBlock = makeAddBlock({ onNew: handleNew, onLoad: handleLoad });

    node._combo_render = render;
    const comboWidget = node.addDOMWidget("combo_ui", "div", container, { serialize: false, margin: 4 });
    comboWidget.computeSize = () => {
        const rows = Math.max(1, Math.ceil((readAllFlakes().length + 1) / 2));
        return [node.size[0], rows * 84 + 31];
    };
    updateActiveFlake();
    render();
}

// ---------- FlakeModelCombo widget ----------

function makeModelComboBlock({ preset, idx, isActive, onActivate, onRemove }) {
    const block = document.createElement("div");
    block.dataset.idx = String(idx);

    css(block, `position:relative;height:80px;background:${
        isActive ? "#2a4a3a" : "#2a2a2a"
    };border:2px solid ${
        isActive ? "#3a8a5a" : "#444"
    };border-radius:4px;cursor:pointer;font-size:11px;color:#ddd;user-select:none;box-sizing:border-box;`);

    const nameEl = document.createElement("div");
    nameEl.title = preset;
    css(nameEl, "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:500;text-align:center;line-height:1.2;text-shadow:0 1px 3px rgba(0,0,0,0.8);padding:0 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;z-index:1;");
    nameEl.textContent = preset;
    block.appendChild(nameEl);

    if (isActive) {
        const check = document.createElement("div");
        check.textContent = "\u2713";
        css(check, "position:absolute;top:2px;left:2px;width:16px;height:16px;line-height:14px;text-align:center;font-size:10px;background:rgba(58,138,90,0.8);color:#fff;border-radius:2px;z-index:2;");
        block.appendChild(check);
    }

    const rm = document.createElement("button");
    rm.textContent = "\u2715";
    rm.title = "Remove from combo";
    css(rm, "position:absolute;top:2px;right:2px;width:16px;height:16px;line-height:14px;text-align:center;font-size:10px;background:rgba(0,0,0,0.5);color:#ddd;border:1px solid #555;border-radius:2px;cursor:pointer;padding:0;z-index:2;");
    rm.addEventListener("click", (e) => { e.stopPropagation(); onRemove(idx); });
    block.appendChild(rm);

    block.addEventListener("click", () => onActivate(idx));

    return block;
}

function setupFlakeModelComboWidget(node) {
    const presetWidget = node.widgets?.find(w => w.name === "preset");
    if (!presetWidget) return;

    if (!node.properties) node.properties = {};
    if (!node.properties._combo_presets) node.properties._combo_presets = [];
    if (node.properties._combo_active_index == null) node.properties._combo_active_index = 0;

    function readPresets() {
        return node.properties._combo_presets || [];
    }
    function writePresets(presets) {
        node.properties._combo_presets = presets;
        updateActivePreset();
    }
    function updateActivePreset() {
        const presets = readPresets();
        const idx = node.properties._combo_active_index || 0;
        const active = presets[idx] || "Select a preset...";
        presetWidget.value = active;
    }

    const container = document.createElement("div");
    css(container, "display:flex;flex-direction:column;gap:2px;padding:0 6px 3px 6px;font-size:12px;color:#ddd;");

    const grid = document.createElement("div");
    css(grid, "display:grid;grid-template-columns:repeat(auto-fill, minmax(72px, 1fr));gap:4px;");
    container.appendChild(grid);

    function render() {
        const presets = readPresets();
        const activeIdx = node.properties._combo_active_index || 0;
        grid.replaceChildren();

        for (let i = 0; i < presets.length; i++) {
            const blk = makeModelComboBlock({
                preset: presets[i],
                idx: i,
                isActive: i === activeIdx,
                onActivate: (idx) => {
                    node.properties._combo_active_index = idx;
                    updateActivePreset();
                    render();
                },
                onRemove: (idx) => {
                    const arr = readPresets();
                    arr.splice(idx, 1);
                    if (node.properties._combo_active_index >= arr.length) {
                        node.properties._combo_active_index = Math.max(0, arr.length - 1);
                    }
                    writePresets(arr);
                    render();
                },
            });
            grid.appendChild(blk);
        }

        const addBtn = document.createElement("div");
        css(addBtn, "position:relative;height:80px;background:#2a2a2a;border:1px dashed #555;border-radius:4px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;cursor:pointer;font-size:11px;color:#999;user-select:none;box-sizing:border-box;");
        const icon = document.createElement("div");
        css(icon, "font-size:20px;font-weight:300;color:#666;line-height:1;");
        icon.textContent = "+";
        addBtn.appendChild(icon);
        const label = document.createElement("div");
        css(label, "font-size:9px;text-align:center;");
        label.textContent = "Add preset";
        addBtn.appendChild(label);
        addBtn.addEventListener("click", () => {
            const current = presetWidget.value;
            if (!current || current === "Select a preset..." || current === "No model preset is selected") {
                window.alert("Select a preset from the dropdown first");
                return;
            }
            const arr = readPresets();
            if (arr.includes(current)) {
                window.alert("Preset already in combo");
                return;
            }
            arr.push(current);
            writePresets(arr);
            render();
        });
        grid.appendChild(addBtn);
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

// ---------- Frontend Queueing for Combinations ----------

function getComboFlakes(node) {
    return node.properties?._combo_flakes || [];
}

function getComboPresets(node) {
    return node.properties?._combo_presets || [];
}

function cartesianProduct(arrays) {
    if (arrays.length === 0) return [[]];
    const result = [];
    const head = arrays[0];
    const tail = cartesianProduct(arrays.slice(1));
    for (const h of head) {
        for (const t of tail) {
            result.push([h, ...t]);
        }
    }
    return result;
}

const _originalQueuePrompt = app.queuePrompt;
app.queuePrompt = async function(number, batchCount = 1) {
    const comboNodes = app.graph.nodes.filter(n => n.type === "FlakeCombo");
    const modelComboNodes = app.graph.nodes.filter(n => n.type === "FlakeModelCombo");

    if (comboNodes.length === 0 && modelComboNodes.length === 0) {
        return _originalQueuePrompt.call(this, number, batchCount);
    }

    const optionsArrays = [];

    for (const node of comboNodes) {
        const flakes = getComboFlakes(node);
        if (flakes.length === 0) {
            window.alert("FlakeCombo node has no flakes selected.");
            return;
        }
        optionsArrays.push(flakes.map((flake, i) => ({
            node,
            type: "combo",
            value: flake,
            index: i,
        })));
    }

    for (const node of modelComboNodes) {
        const presets = getComboPresets(node);
        if (presets.length === 0) {
            window.alert("FlakeModelCombo node has no presets selected.");
            return;
        }
        optionsArrays.push(presets.map((preset, i) => ({
            node,
            type: "model_combo",
            value: preset,
            index: i,
        })));
    }

    const combinations = cartesianProduct(optionsArrays);
    if (combinations.length === 0) {
        return _originalQueuePrompt.call(this, number, batchCount);
    }

    if (!window.confirm(`This will queue ${combinations.length} prompt(s). Continue?`)) {
        return;
    }

    // Save original widget values (once per unique node)
    const nodeOriginals = new Map();
    for (const item of combinations[0]) {
        if (!nodeOriginals.has(item.node.id)) {
            if (item.type === "combo") {
                const w = item.node.widgets?.find(w => w.name === "flakes_json");
                nodeOriginals.set(item.node.id, { node: item.node, widget: w, value: w?.value });
            } else {
                const w = item.node.widgets?.find(w => w.name === "preset");
                nodeOriginals.set(item.node.id, { node: item.node, widget: w, value: w?.value });
            }
        }
    }

    try {
        for (const combination of combinations) {
            for (const item of combination) {
                if (item.type === "combo") {
                    const w = item.node.widgets?.find(w => w.name === "flakes_json");
                    if (w) w.value = JSON.stringify([item.value]);
                } else {
                    const w = item.node.widgets?.find(w => w.name === "preset");
                    if (w) w.value = item.value;
                }
            }
            await _originalQueuePrompt.call(this, number, 1);
        }
    } finally {
        for (const orig of nodeOriginals.values()) {
            if (orig.widget) orig.widget.value = orig.value;
        }
        for (const n of app.graph.nodes) {
            if (n.type === "FlakeCombo") n._combo_render?.();
            if (n.type === "FlakeModelCombo") n._model_combo_render?.();
        }
    }
};

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
        if (nodeData.name === "FlakeModelPreset") {
            const origOnNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                const r = origOnNodeCreated?.apply(this, arguments);
                setupFlakeModelPresetWidget(this);
                return r;
            };

            const origOnConfigure = nodeType.prototype.onConfigure;
            nodeType.prototype.onConfigure = function () {
                const r = origOnConfigure?.apply(this, arguments);
                this._preset_render?.();
                return r;
            };
        }
        if (nodeData.name === "FlakeCombo") {
            const origOnNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                const r = origOnNodeCreated?.apply(this, arguments);
                setupFlakeComboWidget(this);
                return r;
            };

            const origOnConfigure = nodeType.prototype.onConfigure;
            nodeType.prototype.onConfigure = function () {
                const r = origOnConfigure?.apply(this, arguments);
                this._combo_render?.();
                return r;
            };
        }
        if (nodeData.name === "FlakeModelCombo") {
            const origOnNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                const r = origOnNodeCreated?.apply(this, arguments);
                setupFlakeModelComboWidget(this);
                return r;
            };

            const origOnConfigure = nodeType.prototype.onConfigure;
            nodeType.prototype.onConfigure = function () {
                const r = origOnConfigure?.apply(this, arguments);
                this._model_combo_render?.();
                return r;
            };
        }
    },
});
