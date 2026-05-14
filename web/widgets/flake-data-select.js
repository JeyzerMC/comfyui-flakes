import { css } from "../utils.js";

const SPLIT_PIN_TYPES = {
    model: "MODEL",
    clip: "CLIP",
    vae: "VAE",
    positive: "CONDITIONING",
    negative: "CONDITIONING",
    latent: "LATENT",
    filename_prefix: "STRING",
    width: "INT",
    height: "INT",
    steps: "INT",
    cfg: "FLOAT",
    sampler_name: "COMBO_SAMPLER",
    scheduler: "COMBO_SCHEDULER",
};

const INTO_PIN_TYPES = {
    model: "MODEL",
    clip: "CLIP",
    vae: "VAE",
    positive: "CONDITIONING",
    negative: "CONDITIONING",
    latent: "LATENT",
    filename_prefix: "STRING",
    width: "INT",
    height: "INT",
    steps: "INT",
    cfg: "FLOAT",
    sampler_name: "COMBO_SAMPLER",
    scheduler: "COMBO_SCHEDULER",
};

const ALL_SPLIT_PINS = [
    { name: "model", label: "Model" },
    { name: "clip", label: "Clip" },
    { name: "vae", label: "VAE" },
    { name: "positive", label: "Positive" },
    { name: "negative", label: "Negative" },
    { name: "latent", label: "Latent" },
    { name: "filename_prefix", label: "Filename Prefix" },
    { name: "width", label: "Width" },
    { name: "height", label: "Height" },
    { name: "steps", label: "Steps" },
    { name: "cfg", label: "CFG" },
    { name: "sampler_name", label: "Sampler" },
    { name: "scheduler", label: "Scheduler" },
];

const ALL_INTO_PINS = [
    { name: "model", label: "Model" },
    { name: "clip", label: "Clip" },
    { name: "vae", label: "VAE" },
    { name: "positive", label: "Positive" },
    { name: "negative", label: "Negative" },
    { name: "latent", label: "Latent" },
    { name: "filename_prefix", label: "Filename Prefix" },
    { name: "width", label: "Width" },
    { name: "height", label: "Height" },
    { name: "steps", label: "Steps" },
    { name: "cfg", label: "CFG" },
    { name: "sampler_name", label: "Sampler" },
    { name: "scheduler", label: "Scheduler" },
];

const DEFAULT_SPLIT_PINS = ["model"];
const DEFAULT_INTO_PINS = ["model"];

function hideWidget(node, widgetName) {
    const w = node.widgets?.find(w => w.name === widgetName);
    if (!w) return;
    w.computeSize = () => [0, -4];
    w.type = "hidden";
    w.hidden = true;
    if (w.element) { w.element.remove(); w.element = null; }
    if (w.inputEl) { w.inputEl.remove(); w.inputEl = null; }
}

const SPLIT_OUTPUT_ORDER = ALL_SPLIT_PINS.map(p => p.name);
const INTO_INPUT_ORDER = ALL_INTO_PINS.map(p => p.name);

function addDynamicOutput(node, pinName) {
    const type = SPLIT_PIN_TYPES[pinName] || "*";
    const pinDef = ALL_SPLIT_PINS.find(p => p.name === pinName);
    const label = pinDef ? pinDef.label : pinName;
    node.addOutput(label, type);
    const outIdx = node.outputs.length - 1;
    node.outputs[outIdx].name = pinName;
    return outIdx;
}

function removeDynamicOutput(node, pinName) {
    const idx = node.outputs.findIndex(o => o.name === pinName);
    if (idx === -1) return;
    if (node.outputs[idx].links && node.outputs[idx].links.length > 0) {
        node.disconnectOutputs(idx);
    }
    node.removeOutput(idx);
}

function addDynamicInput(node, pinName) {
    const type = INTO_PIN_TYPES[pinName] || "*";
    const pinDef = ALL_INTO_PINS.find(p => p.name === pinName);
    node.addInput(pinName, type, { shape: 6 });
}

function removeDynamicInput(node, pinName) {
    const idx = node.inputs.findIndex(i => i.name === pinName);
    if (idx === -1) return;
    if (node.inputs[idx].link != null) {
        node.disconnectInput(idx);
    }
    node.removeInput(idx);
}

function syncSplitOutputs(node, selected) {
    const current = node.outputs.map(o => o.name);
    const toRemove = current.filter(n => !selected.includes(n));
    for (const name of toRemove) {
        removeDynamicOutput(node, name);
    }
    for (const name of selected) {
        if (!current.includes(name)) {
            addDynamicOutput(node, name);
        }
    }
    node.setDirtyCanvas(true, true);
    const sz = node.computeSize();
    if (node.size[0] < sz[0] || node.size[1] < sz[1]) {
        node.setSize([Math.max(node.size[0], sz[0]), Math.max(node.size[1], sz[1])]);
    }
}

function syncIntoInputs(node, selected) {
    const fixedNames = new Set(["flake_data", "active_pins"]);
    const currentDynamic = node.inputs.filter(i => !fixedNames.has(i.name)).map(i => i.name);
    const toRemove = currentDynamic.filter(n => !selected.includes(n));
    for (const name of toRemove) {
        removeDynamicInput(node, name);
    }
    for (const name of selected) {
        if (!currentDynamic.includes(name)) {
            addDynamicInput(node, name);
        }
    }
    node.setDirtyCanvas(true, true);
    const sz = node.computeSize();
    if (node.size[0] < sz[0] || node.size[1] < sz[1]) {
        node.setSize([Math.max(node.size[0], sz[0]), Math.max(node.size[1], sz[1])]);
    }
}

function createPinSelector({ node, allPins, defaultPins, propName, direction, syncFn }) {
    const container = document.createElement("div");
    css(container, "display:flex;flex-direction:column;gap:4px;padding:4px 6px;font-size:11px;color:#ddd;pointer-events:auto;");

    if (!node.properties) node.properties = {};

    const hiddenName = direction === "output" ? "selected_pins" : "active_pins";
    const hiddenWidget = node.widgets?.find(w => w.name === hiddenName);

    let selected;
    try {
        let raw;
        if (hiddenWidget && hiddenWidget.value) {
            raw = typeof hiddenWidget.value === "string" ? hiddenWidget.value : JSON.stringify(hiddenWidget.value);
        } else if (node.properties[propName]) {
            raw = typeof node.properties[propName] === "string" ? node.properties[propName] : JSON.stringify(node.properties[propName]);
        } else {
            raw = JSON.stringify(defaultPins);
        }
        selected = JSON.parse(raw);
        if (!Array.isArray(selected)) selected = [...defaultPins];
    } catch {
        selected = [...defaultPins];
    }

    for (const name of selected) {
        if (!allPins.find(p => p.name === name)) {
            selected = selected.filter(n => n !== name);
        }
    }
    if (selected.length === 0) selected = [...defaultPins];

    node.properties[propName] = [...selected];
    if (hiddenWidget) {
        hiddenWidget.value = JSON.stringify(selected);
    }

    const row = document.createElement("div");
    css(row, "display:flex;gap:4px;align-items:center;");

    const label = document.createElement("span");
    css(label, "font-size:10px;opacity:0.7;white-space:nowrap;");
    label.textContent = direction === "output" ? "output pin" : "input pin";
    row.appendChild(label);

    const select = document.createElement("select");
    css(select, "flex:1;background:#1a1a1a;color:#ddd;border:1px solid #444;border-radius:4px;padding:2px 4px;font-size:11px;height:22px;cursor:pointer;outline:none;min-width:0;");
    for (const pin of allPins) {
        const opt = document.createElement("option");
        opt.value = pin.name;
        opt.textContent = pin.label;
        select.appendChild(opt);
    }
    row.appendChild(select);

    const addBtn = document.createElement("button");
    addBtn.textContent = "+";
    addBtn.title = "Add pin";
    css(addBtn, "width:22px;height:22px;padding:0;display:flex;align-items:center;justify-content:center;background:#2a4a3a;color:#ddd;border:1px solid #3a8a5a;border-radius:4px;cursor:pointer;font-size:14px;font-weight:bold;line-height:1;flex-shrink:0;");
    row.appendChild(addBtn);

    const removeBtn = document.createElement("button");
    removeBtn.textContent = "\u2212";
    removeBtn.title = "Remove pin";
    css(removeBtn, "width:22px;height:22px;padding:0;display:flex;align-items:center;justify-content:center;background:#4a2a2a;color:#ddd;border:1px solid #8a3a3a;border-radius:4px;cursor:pointer;font-size:14px;font-weight:bold;line-height:1;flex-shrink:0;");
    row.appendChild(removeBtn);

    container.appendChild(row);

    const pinList = document.createElement("div");
    css(pinList, "display:flex;flex-wrap:wrap;gap:3px;min-height:16px;");
    container.appendChild(pinList);

    function refresh() {
        if (hiddenWidget) {
            hiddenWidget.value = JSON.stringify(selected);
        }
        node.properties[propName] = [...selected];

        syncFn(node, selected);

        pinList.replaceChildren();
        if (selected.length === 0) {
            const empty = document.createElement("span");
            css(empty, "font-size:9px;opacity:0.5;");
            empty.textContent = direction === "output" ? "No output pins" : "No input pins";
            pinList.appendChild(empty);
        } else {
            for (const pinName of selected) {
                const pinDef = allPins.find(p => p.name === pinName);
                const chip = document.createElement("span");
                css(chip, "display:inline-flex;align-items:center;gap:2px;background:#2a3a4a;border:1px solid #3a5a8a;border-radius:3px;padding:1px 5px;font-size:9px;cursor:default;");
                chip.textContent = pinDef ? pinDef.label : pinName;
                const x = document.createElement("span");
                css(x, "color:#8a5a5a;font-weight:bold;font-size:10px;cursor:pointer;margin-left:1px;");
                x.textContent = "\u00d7";
                x.addEventListener("click", (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    const idx = selected.indexOf(pinName);
                    if (idx !== -1) {
                        selected.splice(idx, 1);
                        refresh();
                    }
                });
                chip.appendChild(x);
                pinList.appendChild(chip);
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

    removeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        const pinName = select.value;
        const idx = selected.indexOf(pinName);
        if (idx !== -1) {
            selected.splice(idx, 1);
            refresh();
        }
    });

    refresh();

    return { container, refresh };
}

export function setupFlakeDataSplitSelect(node) {
    const { container, refresh } = createPinSelector({
        node,
        allPins: ALL_SPLIT_PINS,
        defaultPins: DEFAULT_SPLIT_PINS,
        propName: "_selected_split_pins",
        direction: "output",
        syncFn: syncSplitOutputs,
    });

    hideWidget(node, "selected_pins");

    node.addDOMWidget("pin_selector_ui", "div", container, {
        serialize: false,
        margin: 4,
    });

    node._splitPinUpdate = refresh;

    requestAnimationFrame(() => {
        refresh();
        const sz = node.computeSize();
        node.setSize([Math.max(node.size[0], sz[0], 260), Math.max(node.size[1], sz[1])]);
    });
}

export function setupIntoFlakeDataSelect(node) {
    const { container, refresh } = createPinSelector({
        node,
        allPins: ALL_INTO_PINS,
        defaultPins: DEFAULT_INTO_PINS,
        propName: "_selected_into_pins",
        direction: "input",
        syncFn: syncIntoInputs,
    });

    hideWidget(node, "active_pins");

    node.addDOMWidget("pin_selector_ui", "div", container, {
        serialize: false,
        margin: 4,
    });

    node._intoPinUpdate = refresh;

    requestAnimationFrame(() => {
        refresh();
        const sz = node.computeSize();
        node.setSize([Math.max(node.size[0], sz[0], 260), Math.max(node.size[1], sz[1])]);
    });
}