import { css } from "../utils.js";

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

function applyPinVisibility(node, selected, direction, allPins) {
    if (direction === "output") {
        for (let i = 0; i < node.outputs.length && i < allPins.length; i++) {
            const wasHidden = node.outputs[i].hidden;
            const shouldHide = !selected.includes(allPins[i].name);
            node.outputs[i].hidden = shouldHide;
            if (shouldHide && !wasHidden) {
                node.disconnectOutputs(i);
            }
        }
    } else {
        const fixedNames = ["flake_data", "active_pins"];
        for (let i = 0; i < node.inputs.length; i++) {
            const input = node.inputs[i];
            if (fixedNames.includes(input.name)) continue;
            const pinDef = allPins.find(p => p.name === input.name);
            if (!pinDef) continue;
            const wasHidden = input.hidden;
            const shouldHide = !selected.includes(input.name);
            input.hidden = shouldHide;
            if (shouldHide && !wasHidden && input.link != null) {
                node.disconnectInput(i);
            }
        }
    }
    node.setDirtyCanvas(true, true);
    const sz = node.computeSize();
    if (node.size[0] < sz[0] || node.size[1] < sz[1]) {
        node.setSize([Math.max(node.size[0], sz[0]), Math.max(node.size[1], sz[1])]);
    }
}

function hidePinsWidget(node, widgetName) {
    const w = node.widgets?.find(w => w.name === widgetName);
    if (!w) return;
    w.computeSize = () => [0, -4];
    w.type = "hidden";
    w.hidden = true;
    if (w.element) { w.element.remove(); w.element = null; }
    if (w.inputEl) { w.inputEl.remove(); w.inputEl = null; }
}

function createPinSelector({ node, allPins, defaultPins, propName, direction }) {
    const container = document.createElement("div");
    css(container, "display:flex;flex-direction:column;gap:4px;padding:4px 6px;font-size:11px;color:#ddd;pointer-events:auto;");

    if (!node.properties) node.properties = {};

    const hiddenName = direction === "output" ? "selected_pins" : "active_pins";
    const hiddenWidget = node.widgets?.find(w => w.name === hiddenName);

    let selected;
    try {
        const raw = hiddenWidget?.value ?? node.properties[propName] ?? JSON.stringify(defaultPins);
        selected = JSON.parse(raw);
        if (!Array.isArray(selected)) selected = [...defaultPins];
    } catch {
        selected = [...defaultPins];
    }
    node.properties[propName] = [...selected];

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

        applyPinVisibility(node, selected, direction, allPins);

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
    });

    hidePinsWidget(node, "selected_pins");

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
    });

    hidePinsWidget(node, "active_pins");

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