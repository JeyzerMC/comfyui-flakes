import { app } from "../../scripts/app.js";
import { setupFlakeWidget } from "./widgets/flake-stack.js";
import { setupFlakeComboWidget } from "./widgets/flake-combo.js";
import { setupFlakeModelPresetWidget } from "./widgets/flake-model-preset.js";
import { setupFlakeModelComboWidget } from "./widgets/flake-model-combo.js";
import { setupFlakeDataSplitSelect, setupIntoFlakeDataSelect, DEFAULT_SPLIT_PINS, DEFAULT_INTO_PINS } from "./widgets/flake-data-select.js";
import { setupPreviewFlakeDataWidget } from "./widgets/flake-preview.js";
import "./queue.js";

function removeHiddenInputs(node, names) {
    for (let i = node.inputs.length - 1; i >= 0; i--) {
        if (names.includes(node.inputs[i].name)) {
            node.inputs.splice(i, 1);
        }
    }
}

function setDefaultSize(node, minWidth) {
    const size = node.computeSize();
    if (size[0] < minWidth) {
        node.setSize([minWidth, size[1]]);
    } else {
        node.setSize(size);
    }
}

app.registerExtension({
    name: "comfyui-flakes.FlakeStack",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name === "FlakeStack") {
            const origOnNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                const r = origOnNodeCreated?.apply(this, arguments);
                setupFlakeWidget(this);
                removeHiddenInputs(this, ["model_family", "flakes_json"]);
                if (!this._configured) {
                    setDefaultSize(this, 340);
                }
                return r;
            };

            const origOnConfigure = nodeType.prototype.onConfigure;
            nodeType.prototype.onConfigure = function () {
                const r = origOnConfigure?.apply(this, arguments);
                this._configured = true;
                removeHiddenInputs(this, ["model_family", "flakes_json"]);
                this._flakes_render?.();
                return r;
            };
        }
        if (nodeData.name === "FlakeModelPreset") {
            const origOnNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                const r = origOnNodeCreated?.apply(this, arguments);
                setupFlakeModelPresetWidget(this);
                removeHiddenInputs(this, ["model_family", "preset"]);
                if (!this._configured) {
                    setDefaultSize(this, 300);
                }
                return r;
            };

            const origOnConfigure = nodeType.prototype.onConfigure;
            nodeType.prototype.onConfigure = function () {
                const r = origOnConfigure?.apply(this, arguments);
                this._configured = true;
                removeHiddenInputs(this, ["model_family", "preset"]);
                this._preset_render?.();
                return r;
            };
        }
        if (nodeData.name === "FlakeCombo") {
            const origOnNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                const r = origOnNodeCreated?.apply(this, arguments);
                setupFlakeComboWidget(this);
                removeHiddenInputs(this, ["model_family", "flakes_json"]);
                if (!this._configured) {
                    setDefaultSize(this, 340);
                }
                return r;
            };

            const origOnConfigure = nodeType.prototype.onConfigure;
            nodeType.prototype.onConfigure = function () {
                const r = origOnConfigure?.apply(this, arguments);
                this._configured = true;
                removeHiddenInputs(this, ["model_family", "flakes_json"]);
                this._combo_render?.();
                return r;
            };
        }
        if (nodeData.name === "FlakeModelCombo") {
            const origOnNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                const r = origOnNodeCreated?.apply(this, arguments);
                setupFlakeModelComboWidget(this);
                removeHiddenInputs(this, ["model_family", "preset"]);
                if (!this._configured) {
                    setDefaultSize(this, 300);
                }
                return r;
            };

            const origOnConfigure = nodeType.prototype.onConfigure;
            nodeType.prototype.onConfigure = function () {
                const r = origOnConfigure?.apply(this, arguments);
                this._configured = true;
                removeHiddenInputs(this, ["model_family", "preset"]);
                this._model_combo_render?.();
                return r;
            };
        }
        if (nodeData.name === "FlakeDataSplitSelect") {
            const origOnNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                const r = origOnNodeCreated?.apply(this, arguments);
                setupFlakeDataSplitSelect(this);
                removeHiddenInputs(this, ["selected_pins"]);
                if (!this._configured) {
                    setDefaultSize(this, 260);
                }
                return r;
            };

            const origOnConfigure = nodeType.prototype.onConfigure;
            nodeType.prototype.onConfigure = function () {
                const r = origOnConfigure?.apply(this, arguments);
                this._configured = true;
                removeHiddenInputs(this, ["selected_pins"]);
                if (!this.properties) this.properties = {};
                let savedPins;
                try {
                    const raw = this.properties._selected_split_pins;
                    savedPins = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : null;
                } catch { savedPins = null; }
                if (!Array.isArray(savedPins)) {
                    const w = this.widgets?.find(w => w.name === "selected_pins");
                    try {
                        savedPins = w && w.value ? JSON.parse(w.value) : null;
                    } catch { savedPins = null; }
                }
                if (!Array.isArray(savedPins)) savedPins = [...DEFAULT_SPLIT_PINS];
                for (let i = this.outputs.length - 1; i >= 0; i--) {
                    this.disconnectOutputs(i);
                    this.removeOutput(i);
                }
                this.properties._selected_split_pins = [...savedPins];
                this._splitPinUpdate?.();
                return r;
            };
        }
        if (nodeData.name === "IntoFlakeDataSelect") {
            const origOnNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                const r = origOnNodeCreated?.apply(this, arguments);
                setupIntoFlakeDataSelect(this);
                removeHiddenInputs(this, ["active_pins"]);
                if (!this._configured) {
                    setDefaultSize(this, 260);
                }
                return r;
            };

            const origOnConfigure = nodeType.prototype.onConfigure;
            nodeType.prototype.onConfigure = function () {
                const r = origOnConfigure?.apply(this, arguments);
                this._configured = true;
                removeHiddenInputs(this, ["active_pins"]);
                if (!this.properties) this.properties = {};
                let savedPins;
                try {
                    const raw = this.properties._selected_into_pins;
                    savedPins = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : null;
                } catch { savedPins = null; }
                if (!Array.isArray(savedPins)) {
                    const w = this.widgets?.find(w => w.name === "active_pins");
                    try {
                        savedPins = w && w.value ? JSON.parse(w.value) : null;
                    } catch { savedPins = null; }
                }
                if (!Array.isArray(savedPins)) savedPins = [...DEFAULT_INTO_PINS];
                const fixedNames = new Set(["flake_data", "active_pins"]);
                for (let i = this.inputs.length - 1; i >= 0; i--) {
                    if (!fixedNames.has(this.inputs[i].name)) {
                        if (this.inputs[i].link != null) {
                            this.disconnectInput(i);
                        }
                        this.removeInput(i);
                    }
                }
                this.properties._selected_into_pins = [...savedPins];
                this._intoPinUpdate?.();
                return r;
            };
        }
        if (nodeData.name === "PreviewFlakeData") {
            const origOnNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                const r = origOnNodeCreated?.apply(this, arguments);
                setupPreviewFlakeDataWidget(this);
                if (!this._configured) {
                    setDefaultSize(this, 260);
                }
                return r;
            };
        }
    },
});
