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



export const DEFAULT_SPLIT_PINS = ["model"];
export const DEFAULT_INTO_PINS = ["model"];

const WIDGET_PIN_NAMES = new Set(["filename_prefix", "width", "height", "steps", "cfg", "sampler_name", "scheduler"]);

function applyPinVisibility(node, selected, direction, allPins) {
    if (direction === "output") {
        for (let i = node.outputs.length - 1; i >= 0; i--) {
            const pinDef = allPins.find(p => p.name === node.outputs[i].name);
            if (!pinDef) continue;
            const wasHidden = node.outputs[i].hidden;
            const shouldHide = !selected.includes(pinDef.name);
            node.outputs[i].hidden = shouldHide;
            if (shouldHide && !wasHidden) {
                node.disconnectOutputs(i);
            }
        }
    } else {
        const fixedNames = new Set(["flake_data", "active_pins"]);
        for (let i = node.inputs.length - 1; i >= 0; i--) {
            const input = node.inputs[i];
            if (fixedNames.has(input.name)) continue;
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

function syncSplitVisibility(node, selected) {
    applyPinVisibility(node, selected, "output", ALL_SPLIT_PINS);
}

function syncIntoVisibility(node, selected, widgetContainer) {
    applyPinVisibility(node, selected, "input", ALL_INTO_PINS);
    if (widgetContainer) {
        widgetContainer.replaceChildren();
        for (const name of selected) {
            if (!WIDGET_PIN_NAMES.has(name)) continue;
            const pinDef = ALL_INTO_PINS.find(p => p.name === name);
            const hiddenW = node.widgets?.find(w => w.name === name);
            const row = document.createElement("div");
            css(row, "display:flex;align-items:center;gap:4px;padding:2px 0;");
            const lbl = document.createElement("span");
            lbl.textContent = (pinDef?.label || name) + ":";
            css(lbl, "font-size:10px;color:#999;white-space:nowrap;min-width:60px;flex-shrink:0;");
            row.appendChild(lbl);
            let inputEl;
            if (name === "sampler_name" || name === "scheduler") {
                inputEl = document.createElement("select");
                const opts = hiddenW?.options?.values || [];
                for (const opt of opts) {
                    const o = document.createElement("option");
                    o.value = opt;
                    o.textContent = opt;
                    if (opt === (hiddenW?.value || "")) o.selected = true;
                    inputEl.appendChild(o);
                }
                css(inputEl, "flex:1;background:#1a1a1a;color:#ddd;border:1px solid #444;border-radius:3px;padding:2px 4px;font-size:11px;height:22px;cursor:pointer;outline:none;");
            } else if (name === "filename_prefix") {
                inputEl = document.createElement("input");
                inputEl.type = "text";
                inputEl.value = hiddenW?.value || "";
                css(inputEl, "flex:1;background:#1a1a1a;color:#ddd;border:1px solid #444;border-radius:3px;padding:2px 4px;font-size:11px;outline:none;");
            } else {
                inputEl = document.createElement("input");
                inputEl.type = "number";
                inputEl.value = hiddenW?.value ?? 0;
                inputEl.step = name === "cfg" ? "0.1" : "1";
                css(inputEl, "flex:1;background:#1a1a1a;color:#ddd;border:1px solid #444;border-radius:3px;padding:2px 4px;font-size:11px;outline:none;");
            }
            inputEl.addEventListener("input", () => {
                if (hiddenW) hiddenW.value = inputEl.value;
            });
            inputEl.addEventListener("change", () => {
                if (hiddenW) hiddenW.value = inputEl.value;
            });
            row.appendChild(inputEl);
            widgetContainer.appendChild(row);
        }
    }
}

function hideWidget(node, widgetName) {
    const w = node.widgets?.find(w => w.name === widgetName);
    if (!w) return;
    w.computeSize = () => [0, -4];
    w.type = "hidden";
    w.hidden = true;
    if (w.element) { w.element.remove(); w.element = null; }
    if (w.inputEl) { w.inputEl.remove(); w.inputEl = null; }
}

function createPinSelector({ node, allPins, defaultPins, propName, hiddenName, direction, syncFn, showRemoveButton = true }) {
    const container = document.createElement("div");
    css(container, "display:flex;flex-direction:column;gap:4px;padding:4px 6px;font-size:11px;color:#ddd;pointer-events:auto;");

    if (!node.properties) node.properties = {};

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
    css(addBtn, "width:20px;height:20px;padding:0;display:flex;align-items:center;justify-content:center;background:#333;color:#ccc;border:1px solid #555;border-radius:3px;cursor:pointer;font-size:13px;line-height:1;flex-shrink:0;transition:background 0.1s;");
    addBtn.addEventListener("mouseenter", () => addBtn.style.background = "#444");
    addBtn.addEventListener("mouseleave", () => addBtn.style.background = "#333");
    row.appendChild(addBtn);

    let removeBtn = null;
    if (showRemoveButton) {
        removeBtn = document.createElement("button");
        removeBtn.textContent = "\u2212";
        removeBtn.title = "Remove pin";
        css(removeBtn, "width:20px;height:20px;padding:0;display:flex;align-items:center;justify-content:center;background:#4a2a2a;color:#ddd;border:1px solid #8a3a3a;border-radius:3px;cursor:pointer;font-size:13px;line-height:1;flex-shrink:0;");
        row.appendChild(removeBtn);
    }

    container.appendChild(row);

    const pinList = document.createElement("div");
    css(pinList, "display:flex;flex-wrap:wrap;gap:3px;min-height:16px;");
    container.appendChild(pinList);

    const widgetRows = document.createElement("div");
    css(widgetRows, "display:flex;flex-direction:column;gap:1px;");

    function refresh() {
        if (hiddenWidget) {
            hiddenWidget.value = JSON.stringify(selected);
        }
        node.properties[propName] = [...selected];

        syncFn(node, selected, widgetRows);

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
        if (direction === "input" && widgetRows.children.length > 0 && !container.contains(widgetRows)) {
            container.appendChild(widgetRows);
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

    if (removeBtn) {
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
    }

    refresh();

    return { container, refresh };
}

export function setupFlakeDataSplitSelect(node) {
    applyPinVisibility(node, DEFAULT_SPLIT_PINS, "output", ALL_SPLIT_PINS);

    const { container, refresh } = createPinSelector({
        node,
        allPins: ALL_SPLIT_PINS,
        defaultPins: DEFAULT_SPLIT_PINS,
        propName: "_selected_split_pins",
        hiddenName: "selected_pins",
        direction: "output",
        syncFn: syncSplitVisibility,
    });

    hideWidget(node, "selected_pins");

    node.addDOMWidget("pin_selector_ui", "div", container, {
        serialize: false,
        margin: 4,
    });

    node._splitPinUpdate = refresh;

    refresh();
    const sz = node.computeSize();
    node.setSize([Math.max(node.size[0], sz[0], 260), Math.max(node.size[1], sz[1])]);
}

export function setupIntoFlakeDataSelect(node) {
    applyPinVisibility(node, DEFAULT_INTO_PINS, "input", ALL_INTO_PINS);

    for (const wName of WIDGET_PIN_NAMES) {
        hideWidget(node, wName);
    }

    const { container, refresh } = createPinSelector({
        node,
        allPins: ALL_INTO_PINS,
        defaultPins: DEFAULT_INTO_PINS,
        propName: "_selected_into_pins",
        hiddenName: "active_pins",
        direction: "input",
        syncFn: syncIntoVisibility,
        showRemoveButton: false,
    });

    hideWidget(node, "active_pins");

    node.addDOMWidget("pin_selector_ui", "div", container, {
        serialize: false,
        margin: 4,
    });

    node._intoPinUpdate = refresh;

    refresh();
    const sz = node.computeSize();
    node.setSize([Math.max(node.size[0], sz[0], 260), Math.max(node.size[1], sz[1])]);
}