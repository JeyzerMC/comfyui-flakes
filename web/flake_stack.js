import { app } from "../../scripts/app.js";

let FLAKE_LIST_CACHE = null;
const META_CACHE = new Map();

async function fetchFlakes() {
    if (FLAKE_LIST_CACHE) return FLAKE_LIST_CACHE;
    const resp = await fetch("/flakes/list");
    const data = await resp.json();
    FLAKE_LIST_CACHE = Array.isArray(data.flakes) ? data.flakes : [];
    return FLAKE_LIST_CACHE;
}

async function fetchMeta(name) {
    if (!name) return {};
    if (META_CACHE.has(name)) return META_CACHE.get(name);
    const resp = await fetch(`/flakes/meta?name=${encodeURIComponent(name)}`);
    if (!resp.ok) {
        META_CACHE.set(name, {});
        return {};
    }
    const data = await resp.json();
    const opts = data.options || {};
    META_CACHE.set(name, opts);
    return opts;
}

function clearChildren(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
}

function styleButton(b) {
    b.style.cssText = "padding: 2px 6px; cursor: pointer; background: #2a2a2a; color: #ddd; border: 1px solid #444; border-radius: 2px; font-size: 11px;";
}

function setupFlakeWidget(node) {
    const hidden = node.widgets?.find(w => w.name === "flakes_json");
    if (!hidden) return;

    // Suppress the text widget's rendering; it remains as the serialization channel.
    // Multiline STRING widgets are DOM widgets with their own element, so we must
    // hide the DOM element in addition to collapsing the canvas layout slot.
    hidden.computeSize = () => [0, -4];
    hidden.type = "hidden";
    hidden.hidden = true;
    hidden.computedHeight = 0;
    const hideEl = (el) => {
        if (!el) return;
        el.hidden = true;
        el.style.display = "none";
    };
    hideEl(hidden.element);
    hideEl(hidden.inputEl);

    const container = document.createElement("div");
    container.style.cssText = "display: flex; flex-direction: column; gap: 4px; padding: 4px; font-size: 12px; color: #ddd;";

    const list = document.createElement("div");
    list.style.cssText = "display: flex; flex-direction: column; gap: 4px;";
    container.appendChild(list);

    const addBtn = document.createElement("button");
    addBtn.textContent = "+ Add flake";
    styleButton(addBtn);
    addBtn.style.alignSelf = "flex-start";
    container.appendChild(addBtn);

    const empty = document.createElement("div");
    empty.textContent = "No flakes. Click '+ Add flake' to start.";
    empty.style.cssText = "opacity: 0.5; font-style: italic; padding: 4px;";
    list.appendChild(empty);

    let rows = [];

    function updateEmpty() {
        empty.style.display = rows.length === 0 ? "" : "none";
        if (rows.length === 0 && empty.parentNode !== list) list.appendChild(empty);
    }

    function serialize() {
        const data = rows.map(r => {
            const entry = {
                name: r.nameSelect.value,
                strength: parseFloat(r.strengthInput.value),
            };
            if (r.option && Object.keys(r.option).length > 0) entry.option = r.option;
            return entry;
        });
        hidden.value = JSON.stringify(data);
    }

    async function refreshOptions(rowState) {
        clearChildren(rowState.optionBox);
        const name = rowState.nameSelect.value;
        const opts = await fetchMeta(name);
        for (const [group, choices] of Object.entries(opts)) {
            const label = document.createElement("span");
            label.textContent = `${group}:`;
            label.style.cssText = "opacity: 0.7; margin-left: 4px; font-size: 11px;";
            const sel = document.createElement("select");
            sel.style.cssText = "max-width: 90px; font-size: 11px;";
            const none = document.createElement("option");
            none.value = "";
            none.textContent = "—";
            sel.appendChild(none);
            for (const c of choices) {
                const o = document.createElement("option");
                o.value = c;
                o.textContent = c;
                if ((rowState.option || {})[group] === c) o.selected = true;
                sel.appendChild(o);
            }
            sel.addEventListener("change", () => {
                rowState.option = rowState.option || {};
                if (sel.value) rowState.option[group] = sel.value;
                else delete rowState.option[group];
                serialize();
            });
            rowState.optionBox.appendChild(label);
            rowState.optionBox.appendChild(sel);
        }
    }

    function move(rowState, direction) {
        const idx = rows.indexOf(rowState);
        const target = idx + direction;
        if (idx < 0 || target < 0 || target >= rows.length) return;
        [rows[idx], rows[target]] = [rows[target], rows[idx]];
        for (const r of rows) list.appendChild(r.el);
        updateEmpty();
        serialize();
    }

    async function addRow(entry) {
        const flakes = await fetchFlakes();
        const row = document.createElement("div");
        row.style.cssText = "display: flex; align-items: center; gap: 4px; flex-wrap: wrap; background: rgba(255,255,255,0.04); padding: 4px; border-radius: 3px;";

        const nameSelect = document.createElement("select");
        nameSelect.style.cssText = "flex: 1; min-width: 120px; font-size: 11px;";
        const currentName = entry?.name ?? flakes[0] ?? "";
        const haveCurrent = flakes.includes(currentName);
        if (!haveCurrent && currentName) {
            const missingOpt = document.createElement("option");
            missingOpt.value = currentName;
            missingOpt.textContent = `${currentName} (missing)`;
            missingOpt.selected = true;
            nameSelect.appendChild(missingOpt);
        }
        for (const name of flakes) {
            const opt = document.createElement("option");
            opt.value = name;
            opt.textContent = name;
            if (name === currentName) opt.selected = true;
            nameSelect.appendChild(opt);
        }

        const strengthInput = document.createElement("input");
        strengthInput.type = "number";
        strengthInput.value = (entry?.strength ?? 1.0).toString();
        strengthInput.step = "0.05";
        strengthInput.min = "-2";
        strengthInput.max = "2";
        strengthInput.style.cssText = "width: 55px; font-size: 11px;";

        const optionBox = document.createElement("div");
        optionBox.style.cssText = "display: flex; gap: 2px; flex-wrap: wrap; align-items: center;";

        const upBtn = document.createElement("button"); upBtn.textContent = "↑"; styleButton(upBtn);
        const downBtn = document.createElement("button"); downBtn.textContent = "↓"; styleButton(downBtn);
        const delBtn = document.createElement("button"); delBtn.textContent = "✕"; styleButton(delBtn);

        row.appendChild(nameSelect);
        row.appendChild(strengthInput);
        row.appendChild(optionBox);
        row.appendChild(upBtn);
        row.appendChild(downBtn);
        row.appendChild(delBtn);
        list.appendChild(row);

        const rowState = {
            el: row, nameSelect, strengthInput, optionBox,
            option: { ...(entry?.option || {}) },
        };
        rows.push(rowState);

        upBtn.addEventListener("click", () => move(rowState, -1));
        downBtn.addEventListener("click", () => move(rowState, +1));
        delBtn.addEventListener("click", () => {
            rows = rows.filter(r => r !== rowState);
            if (row.parentNode === list) list.removeChild(row);
            updateEmpty();
            serialize();
        });
        nameSelect.addEventListener("change", async () => {
            rowState.option = {};
            await refreshOptions(rowState);
            serialize();
        });
        strengthInput.addEventListener("change", serialize);

        await refreshOptions(rowState);
        updateEmpty();
    }

    addBtn.addEventListener("click", async () => {
        await addRow({ name: null, strength: 1.0, option: {} });
        serialize();
    });

    async function reload() {
        for (const r of rows) {
            if (r.el.parentNode === list) list.removeChild(r.el);
        }
        rows = [];
        let entries = [];
        try { entries = JSON.parse(hidden.value || "[]"); }
        catch (e) { entries = []; }
        for (const e of entries) await addRow(e);
        updateEmpty();
    }

    node._flakes_reload = reload;

    node.addDOMWidget("flakes_ui", "div", container, { serialize: false });

    reload();
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
            this._flakes_reload?.();
            return r;
        };
    },
});
