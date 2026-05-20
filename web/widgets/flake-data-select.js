import { css } from "../utils.js";

const ALL_SPLIT_PINS = [
    { name: "model", label: "Model", type: "MODEL" },
    { name: "clip", label: "Clip", type: "CLIP" },
    { name: "vae", label: "VAE", type: "VAE" },
    { name: "positive", label: "Positive", type: "CONDITIONING" },
    { name: "negative", label: "Negative", type: "CONDITIONING" },
    { name: "latent", label: "Latent", type: "LATENT" },
    { name: "filename_prefix", label: "Filename Prefix", type: "STRING" },
    { name: "width", label: "Width", type: "INT" },
    { name: "height", label: "Height", type: "INT" },
    { name: "steps", label: "Steps", type: "INT" },
    { name: "cfg", label: "CFG", type: "FLOAT" },
    { name: "sampler_name", label: "Sampler", type: "STRING" },
    { name: "scheduler", label: "Scheduler", type: "STRING" },
];

const ALL_INTO_PINS = [
    { name: "model", label: "Model", type: "MODEL" },
    { name: "clip", label: "Clip", type: "CLIP" },
    { name: "vae", label: "VAE", type: "VAE" },
    { name: "positive", label: "Positive", type: "CONDITIONING" },
    { name: "negative", label: "Negative", type: "CONDITIONING" },
    { name: "latent", label: "Latent", type: "LATENT" },
    { name: "filename_prefix", label: "Filename Prefix", type: "STRING" },
    { name: "width", label: "Width", type: "INT" },
    { name: "height", label: "Height", type: "INT" },
    { name: "steps", label: "Steps", type: "INT" },
    { name: "cfg", label: "CFG", type: "FLOAT" },
    { name: "sampler_name", label: "Sampler", type: "STRING" },
    { name: "scheduler", label: "Scheduler", type: "STRING" },
];

export const DEFAULT_SPLIT_PINS = ["model"];
export const DEFAULT_INTO_PINS = [];

// ── FlakeDataSplitSelect ──────────────────────────────────────────────────────
// Manages output pin visibility. State lives in node.properties._split_pins.

function syncSplitOutputs(node, selected) {
    if (!node.outputs || !node.outputs.length) return;
    for (let i = 0; i < node.outputs.length; i++) {
        const out = node.outputs[i];
        const pinDef = ALL_SPLIT_PINS.find(p => p.name === out.name);
        if (!pinDef) continue;
        const shouldHide = !selected.includes(out.name);
        if (shouldHide && !out.hidden && out.links && out.links.length) {
            for (const linkId of [...out.links]) {
                node.graph?.removeLink?.(linkId);
            }
        }
        out.hidden = shouldHide;
    }
    node.setDirtyCanvas(true, true);
    const sz = node.computeSize();
    node.setSize([Math.max(node.size[0], sz[0]), Math.max(node.size[1], sz[1])]);
}

export function setupFlakeDataSplitSelect(node) {
    if (!node.properties) node.properties = {};

    // Restore saved selection or default
    let selected;
    try {
        const raw = node.properties._split_pins;
        selected = Array.isArray(raw) ? [...raw] : [...DEFAULT_SPLIT_PINS];
    } catch {
        selected = [...DEFAULT_SPLIT_PINS];
    }
    node.properties._split_pins = [...selected];

    // Delay sync until outputs are populated (new ComfyUI frontend may create
    // outputs after onNodeCreated).
    if (node.outputs && node.outputs.length) {
        syncSplitOutputs(node, selected);
    } else {
        const checkOutputs = setInterval(() => {
            if (node.outputs && node.outputs.length) {
                clearInterval(checkOutputs);
                syncSplitOutputs(node, selected);
            }
        }, 50);
        setTimeout(() => clearInterval(checkOutputs), 2000);
    }

    // ── UI ──
    const container = document.createElement("div");
    css(container, "display:flex;flex-direction:column;gap:4px;padding:4px 6px;font-size:11px;color:#ddd;pointer-events:auto;");

    const row = document.createElement("div");
    css(row, "display:flex;gap:0;align-items:center;");

    const label = document.createElement("span");
    css(label, "font-size:10px;opacity:0.7;white-space:nowrap;margin-right:4px;");
    label.textContent = "output pin";
    row.appendChild(label);

    const select = document.createElement("select");
    css(select, "flex:1;background:#1a1a1a;color:#ddd;border:1px solid #444;border-right:none;border-radius:4px 0 0 4px;padding:2px 8px 2px 4px;font-size:11px;height:22px;cursor:pointer;outline:none;min-width:0;box-sizing:border-box;appearance:auto;");
    for (const pin of ALL_SPLIT_PINS) {
        const opt = document.createElement("option");
        opt.value = pin.name;
        opt.textContent = pin.label;
        select.appendChild(opt);
    }
    row.appendChild(select);

    const addBtn = document.createElement("button");
    addBtn.textContent = "+";
    addBtn.title = "Add output pin";
    css(addBtn, "width:22px;height:22px;padding:0;display:flex;align-items:center;justify-content:center;background:#333;color:#ccc;border:1px solid #444;border-radius:0 4px 4px 0;cursor:pointer;font-size:14px;line-height:1;flex-shrink:0;box-sizing:border-box;");
    row.appendChild(addBtn);

    container.appendChild(row);

    const chipRow = document.createElement("div");
    css(chipRow, "display:flex;flex-wrap:wrap;gap:3px;min-height:16px;");
    container.appendChild(chipRow);

    function refresh() {
        node.properties._split_pins = [...selected];
        syncSplitOutputs(node, selected);

        chipRow.replaceChildren();
        if (selected.length === 0) {
            const empty = document.createElement("span");
            css(empty, "font-size:9px;opacity:0.5;");
            empty.textContent = "No output pins";
            chipRow.appendChild(empty);
        } else {
            for (const pinName of selected) {
                const pinDef = ALL_SPLIT_PINS.find(p => p.name === pinName);
                const chip = document.createElement("span");
                css(chip, "display:inline-flex;align-items:center;gap:2px;background:#2a3a4a;border:1px solid #3a5a8a;border-radius:3px;padding:1px 5px;font-size:9px;cursor:default;");
                chip.textContent = pinDef ? pinDef.label : pinName;
                const x = document.createElement("span");
                css(x, "color:#8a5a5a;font-weight:bold;font-size:10px;cursor:pointer;margin-left:1px;");
                x.textContent = "×";
                x.addEventListener("click", (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    selected = selected.filter(n => n !== pinName);
                    refresh();
                });
                chip.appendChild(x);
                chipRow.appendChild(chip);
            }
        }
    }

    addBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        const pinName = select.value;
        if (!selected.includes(pinName)) {
            selected.push(pinName);
            refresh();
        }
    });

    node.addDOMWidget("split_pin_selector", "div", container, { serialize: false, margin: 4 });
    node._splitPinUpdate = refresh;

    refresh();
    const sz = node.computeSize();
    node.setSize([Math.max(node.size[0], sz[0], 260), Math.max(node.size[1], sz[1])]);
}

// ── IntoFlakeDataSelect ───────────────────────────────────────────────────────
// Dynamically adds/removes input pins via node.addInput / node.removeInput.
// No default pins. State lives in node.properties._into_pins.

const FIXED_INTO_INPUTS = new Set(["flake_data"]);

function getIntoSelected(node) {
    return (node.inputs || [])
        .filter(i => !FIXED_INTO_INPUTS.has(i.name))
        .map(i => i.name);
}

function addIntoPin(node, pinName) {
    const pinDef = ALL_INTO_PINS.find(p => p.name === pinName);
    if (!pinDef) return;
    // Don't add if already present
    if (node.inputs?.find(i => i.name === pinName)) return;
    node.addInput(pinName, pinDef.type);
}

function removeIntoPin(node, pinName) {
    const idx = node.inputs?.findIndex(i => i.name === pinName);
    if (idx == null || idx < 0) return;
    if (node.inputs[idx].link != null) node.disconnectInput(idx);
    node.removeInput(idx);
}

const OPTIONAL_WIDGET_NAMES = new Set([
    "filename_prefix", "width", "height", "steps", "cfg", "sampler_name", "scheduler"
]);

function removeIntoWidgets(node) {
    if (!node.widgets) return;
    for (let i = node.widgets.length - 1; i >= 0; i--) {
        const w = node.widgets[i];
        if (!OPTIONAL_WIDGET_NAMES.has(w.name)) continue;
        if (w.element) { w.element.remove(); w.element = null; }
        if (w.inputEl) { w.inputEl.remove(); w.inputEl = null; }
        node.widgets.splice(i, 1);
    }
}

export function setupIntoFlakeDataSelect(node) {
    if (!node.properties) node.properties = {};
    if (node._intoSetupDone) {
        node._intoPinUpdate?.();
        return;
    }
    node._intoSetupDone = true;

    // Fully remove auto-created widgets for optional fields — pins are managed dynamically.
    // (Previously these were hidden but the canvas-drawn widgets still caught clicks,
    // hijacking clicks meant for the dropdown / + button.)
    removeIntoWidgets(node);

    // Remove any pre-existing optional inputs that Python adds automatically.
    // Keep only flake_data.
    const toRemove = [];
    for (let i = (node.inputs?.length ?? 0) - 1; i >= 0; i--) {
        if (!FIXED_INTO_INPUTS.has(node.inputs[i].name)) {
            toRemove.push(i);
        }
    }
    for (const idx of toRemove) {
        if (node.inputs[idx].link != null) node.disconnectInput(idx);
        node.removeInput(idx);
    }

    // Restore saved pins
    const savedPins = node.properties._into_pins;
    if (Array.isArray(savedPins)) {
        for (const pinName of savedPins) {
            addIntoPin(node, pinName);
        }
    }

    // ── UI ──
    const container = document.createElement("div");
    css(container, "display:flex;flex-direction:column;gap:4px;padding:4px 6px;font-size:11px;color:#ddd;pointer-events:auto;");

    const row = document.createElement("div");
    css(row, "display:flex;gap:0;align-items:center;");

    const label = document.createElement("span");
    css(label, "font-size:10px;opacity:0.7;white-space:nowrap;margin-right:4px;");
    label.textContent = "input pin";
    row.appendChild(label);

    // Dropdown styled to match ComfyUI's native COMBO widget (sampler_name style)
    const select = document.createElement("select");
    css(select, "flex:1;background:#1a1a1a;color:#ddd;border:1px solid #444;border-right:none;border-radius:4px 0 0 4px;padding:2px 8px 2px 4px;font-size:11px;height:22px;cursor:pointer;outline:none;min-width:0;box-sizing:border-box;appearance:auto;");
    for (const pin of ALL_INTO_PINS) {
        const opt = document.createElement("option");
        opt.value = pin.name;
        opt.textContent = pin.label;
        select.appendChild(opt);
    }
    row.appendChild(select);

    const addBtn = document.createElement("button");
    addBtn.textContent = "+";
    addBtn.title = "Add input pin";
    css(addBtn, "width:22px;height:22px;padding:0;display:flex;align-items:center;justify-content:center;background:#333;color:#ccc;border:1px solid #444;border-radius:0 4px 4px 0;cursor:pointer;font-size:14px;line-height:1;flex-shrink:0;box-sizing:border-box;");
    row.appendChild(addBtn);

    container.appendChild(row);

    const chipRow = document.createElement("div");
    css(chipRow, "display:flex;flex-wrap:wrap;gap:3px;min-height:16px;");
    container.appendChild(chipRow);

    function refresh() {
        const current = getIntoSelected(node);
        node.properties._into_pins = [...current];

        chipRow.replaceChildren();
        if (current.length === 0) {
            const empty = document.createElement("span");
            css(empty, "font-size:9px;opacity:0.5;");
            empty.textContent = "No input pins";
            chipRow.appendChild(empty);
        } else {
            for (const pinName of current) {
                const pinDef = ALL_INTO_PINS.find(p => p.name === pinName);
                const chip = document.createElement("span");
                css(chip, "display:inline-flex;align-items:center;gap:2px;background:#2a3a4a;border:1px solid #3a5a8a;border-radius:3px;padding:1px 5px;font-size:9px;cursor:default;");
                chip.textContent = pinDef ? pinDef.label : pinName;
                const x = document.createElement("span");
                css(x, "color:#8a5a5a;font-weight:bold;font-size:10px;cursor:pointer;margin-left:1px;");
                x.textContent = "×";
                x.addEventListener("click", (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    removeIntoPin(node, pinName);
                    refresh();
                    const sz = node.computeSize();
                    node.setSize([Math.max(node.size[0], sz[0]), Math.max(node.size[1], sz[1])]);
                });
                chip.appendChild(x);
                chipRow.appendChild(chip);
            }
        }
    }

    addBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        const pinName = select.value;
        addIntoPin(node, pinName);
        refresh();
        const sz = node.computeSize();
        node.setSize([Math.max(node.size[0], sz[0]), Math.max(node.size[1], sz[1])]);
    });

    node.addDOMWidget("into_pin_selector", "div", container, { serialize: false, margin: 4 });
    node._intoPinUpdate = refresh;

    refresh();
    const sz = node.computeSize();
    node.setSize([Math.max(node.size[0], sz[0], 260), Math.max(node.size[1], sz[1])]);
}
