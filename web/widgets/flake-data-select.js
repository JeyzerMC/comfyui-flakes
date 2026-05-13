import { css } from "../utils.js";

const ALL_SPLIT_PINS = [
    { name: "model", type: "MODEL", label: "Model" },
    { name: "clip", type: "CLIP", label: "Clip" },
    { name: "vae", type: "VAE", label: "VAE" },
    { name: "positive", type: "CONDITIONING", label: "Positive" },
    { name: "negative", type: "CONDITIONING", label: "Negative" },
    { name: "latent", type: "LATENT", label: "Latent" },
    { name: "filename_prefix", type: "STRING", label: "Filename Prefix" },
    { name: "width", type: "INT", label: "Width" },
    { name: "height", type: "INT", label: "Height" },
    { name: "steps", type: "INT", label: "Steps" },
    { name: "cfg", type: "FLOAT", label: "CFG" },
    { name: "sampler_name", type: "*", label: "Sampler" },
    { name: "scheduler", type: "*", label: "Scheduler" },
];

const ALL_INTO_PINS = [
    { name: "model", type: "MODEL", label: "Model" },
    { name: "clip", type: "CLIP", label: "Clip" },
    { name: "vae", type: "VAE", label: "VAE" },
    { name: "positive", type: "CONDITIONING", label: "Positive" },
    { name: "negative", type: "CONDITIONING", label: "Negative" },
    { name: "latent", type: "LATENT", label: "Latent" },
    { name: "filename_prefix", type: "STRING", label: "Filename Prefix" },
    { name: "width", type: "INT", label: "Width" },
    { name: "height", type: "INT", label: "Height" },
    { name: "steps", type: "INT", label: "Steps" },
    { name: "cfg", type: "FLOAT", label: "CFG" },
    { name: "sampler_name", type: "*", label: "Sampler" },
    { name: "scheduler", type: "*", label: "Scheduler" },
];

const DEFAULT_SPLIT_PINS = ["model"];
const DEFAULT_INTO_PINS = [];

function makePinSelector({ allPins, defaultPins, propName, pinDirection, onRebuild }) {
    const container = document.createElement("div");
    css(container, "display:flex;flex-direction:column;gap:4px;padding:4px 6px;font-size:11px;color:#ddd;");

    if (!this.properties) this.properties = {};
    if (!this.properties[propName]) {
        this.properties[propName] = [...defaultPins];
    }
    const selected = this.properties[propName];

    const row = document.createElement("div");
    css(row, "display:flex;gap:4px;align-items:center;");

    const select = document.createElement("select");
    css(select, "flex:1;background:#1a1a1a;color:#ddd;border:1px solid #444;border-radius:4px;padding:4px 6px;font-size:11px;height:26px;cursor:pointer;outline:none;");
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
    css(addBtn, "width:26px;height:26px;padding:0;display:flex;align-items:center;justify-content:center;background:#2a4a3a;color:#ddd;border:1px solid #3a8a5a;border-radius:4px;cursor:pointer;font-size:14px;font-weight:bold;line-height:1;flex-shrink:0;");
    addBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const pinName = select.value;
        if (!selected.includes(pinName)) {
            selected.push(pinName);
            this.properties[propName] = selected;
            onRebuild();
            updateWidgetHiddenState();
        }
    });
    row.appendChild(addBtn);

    const removeBtn = document.createElement("button");
    removeBtn.textContent = "\u2212";
    removeBtn.title = "Remove pin";
    css(removeBtn, "width:26px;height:26px;padding:0;display:flex;align-items:center;justify-content:center;background:#4a2a2a;color:#ddd;border:1px solid #8a3a3a;border-radius:4px;cursor:pointer;font-size:14px;font-weight:bold;line-height:1;flex-shrink:0;");
    removeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const pinName = select.value;
        const idx = selected.indexOf(pinName);
        if (idx !== -1) {
            selected.splice(idx, 1);
            this.properties[propName] = selected;
            onRebuild();
            updateWidgetHiddenState();
        }
    });
    row.appendChild(removeBtn);

    container.appendChild(row);

    const pinList = document.createElement("div");
    css(pinList, "display:flex;flex-wrap:wrap;gap:3px;min-height:20px;");

    function updatePinList() {
        pinList.replaceChildren();
        if (selected.length === 0) {
            const empty = document.createElement("span");
            css(empty, "font-size:9px;opacity:0.5;");
            empty.textContent = pinDirection === "output" ? "No output pins selected" : "No input pins selected";
            pinList.appendChild(empty);
        } else {
            for (const pinName of selected) {
                const pinDef = allPins.find(p => p.name === pinName);
                const chip = document.createElement("span");
                css(chip, "display:inline-flex;align-items:center;gap:3px;background:#2a3a4a;border:1px solid #3a5a8a;border-radius:3px;padding:1px 6px;font-size:9px;cursor:pointer;");
                chip.textContent = pinDef ? pinDef.label : pinName;
                const x = document.createElement("span");
                css(x, "color:#8a5a5a;font-weight:bold;font-size:10px;margin-left:2px;");
                x.textContent = "\u00d7";
                x.addEventListener("click", (e) => {
                    e.stopPropagation();
                    const idx = selected.indexOf(pinName);
                    if (idx !== -1) {
                        selected.splice(idx, 1);
                        this.properties[propName] = selected;
                        onRebuild();
                        updateWidgetHiddenState();
                    }
                });
                chip.appendChild(x);
                pinList.appendChild(chip);
            }
        }
    }
    container.appendChild(pinList);

    const self = this;
    function updateWidgetHiddenState() {
        if (pinDirection === "output") {
            for (let i = 0; i < self.outputs.length && i < allPins.length; i++) {
                self.outputs[i].hidden = !selected.includes(allPins[i].name);
            }
        } else {
            const requiredNames = ["flake_data", "active_pins"];
            for (let i = 0; i < self.inputs.length; i++) {
                const input = self.inputs[i];
                if (requiredNames.includes(input.name)) continue;
                const pinDef = allPins.find(p => p.name === input.name);
                if (pinDef) {
                    input.hidden = !selected.includes(input.name);
                }
            }
        }
        updatePinList();
        self.setDirtyCanvas(true, true);
        if (self.size) {
            self.setSize([self.size[0], self.computeSize()[1]]);
        }
    }

    updatePinList();

    return { container, update: updateWidgetHiddenState };
}

export function setupFlakeDataSplitSelect(node) {
    const hiddenWidget = node.widgets?.find(w => w.name === "selected_pins");
    if (!hiddenWidget) return;

    hiddenWidget.computeSize = () => [0, -4];
    hiddenWidget.type = "hidden";
    hiddenWidget.hidden = true;
    if (hiddenWidget.element) { hiddenWidget.element.remove(); hiddenWidget.element = null; }
    if (hiddenWidget.inputEl) { hiddenWidget.inputEl.remove(); hiddenWidget.inputEl = null; }

    let selectedPins;
    try {
        selectedPins = JSON.parse(hiddenWidget.value || '["model"]');
        if (!Array.isArray(selectedPins)) selectedPins = ["model"];
    } catch { selectedPins = ["model"]; }
    if (!node.properties) node.properties = {};
    node.properties._selected_split_pins = selectedPins;

    function rebuildOutputs() {
        const sel = node.properties._selected_split_pins || ["model"];
        for (let i = 0; i < node.outputs.length && i < ALL_SPLIT_PINS.length; i++) {
            node.outputs[i].hidden = !sel.includes(ALL_SPLIT_PINS[i].name);
        }
        hiddenWidget.value = JSON.stringify(sel);
        node.setDirtyCanvas(true, true);
    }

    const { container, update } = makePinSelector.call(node, {
        allPins: ALL_SPLIT_PINS,
        defaultPins: DEFAULT_SPLIT_PINS,
        propName: "_selected_split_pins",
        pinDirection: "output",
        onRebuild: rebuildOutputs,
    });

    rebuildOutputs();

    const widget = node.addDOMWidget("pin_selector_ui", "div", container, { serialize: false, margin: 4 });
    node._splitPinUpdate = update;
}

export function setupIntoFlakeDataSelect(node) {
    const hiddenWidget = node.widgets?.find(w => w.name === "active_pins");
    if (!hiddenWidget) return;

    hiddenWidget.computeSize = () => [0, -4];
    hiddenWidget.type = "hidden";
    hiddenWidget.hidden = true;
    if (hiddenWidget.element) { hiddenWidget.element.remove(); hiddenWidget.element = null; }
    if (hiddenWidget.inputEl) { hiddenWidget.inputEl.remove(); hiddenWidget.inputEl = null; }

    let activePins;
    try {
        activePins = JSON.parse(hiddenWidget.value || '[]');
        if (!Array.isArray(activePins)) activePins = [];
    } catch { activePins = []; }
    if (!node.properties) node.properties = {};
    node.properties._selected_into_pins = activePins;
    hiddenWidget.value = JSON.stringify(activePins);

    function rebuildInputs() {
        const sel = node.properties._selected_into_pins || [];
        const requiredNames = ["flake_data", "active_pins"];
        for (let i = 0; i < node.inputs.length; i++) {
            const input = node.inputs[i];
            if (requiredNames.includes(input.name)) continue;
            const pinDef = ALL_INTO_PINS.find(p => p.name === input.name);
            if (pinDef) {
                input.hidden = !sel.includes(input.name);
            }
        }
        hiddenWidget.value = JSON.stringify(sel);
        node.setDirtyCanvas(true, true);
    }

    const { container, update } = makePinSelector.call(node, {
        allPins: ALL_INTO_PINS,
        defaultPins: DEFAULT_INTO_PINS,
        propName: "_selected_into_pins",
        pinDirection: "input",
        onRebuild: rebuildInputs,
    });

    rebuildInputs();

    const widget = node.addDOMWidget("pin_selector_ui", "div", container, { serialize: false, margin: 4 });
    node._intoPinUpdate = update;
}