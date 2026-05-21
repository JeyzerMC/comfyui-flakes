import { app } from "../../scripts/app.js";
import { setupFlakeWidget } from "./widgets/flake-stack.js";
import { setupFlakeComboWidget } from "./widgets/flake-combo.js";
import { setupFlakeModelPresetWidget } from "./widgets/flake-model-preset.js";
import { setupFlakeModelComboWidget } from "./widgets/flake-model-combo.js";
import { setupFlakeDataSplitSelect, setupIntoFlakeDataSelect, DEFAULT_SPLIT_PINS, DEFAULT_INTO_PINS } from "./widgets/flake-data-select.js";
import { setupPreviewFlakeDataWidget } from "./widgets/flake-preview.js";
import { setupFlakeGenerateWidget } from "./widgets/flake-generate.js";
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

// Recover from workflows saved by the broken v0.1.x where model_family was
// detached from node.widgets when flake_data was connected — that shifted
// the widget value order so onConfigure assigned `flakes_json` (a JSON
// string) into model_family and left flakes_json at its default "[]".
//
// Heuristic: if model_family looks like JSON ("[" or "{") and flakes_json
// is empty/default, swap them. Same for `preset` on the model nodes (the
// preset is stored as a yaml-relative name, never starts with [).
function _recoverShiftedWidgets(node, otherWidgetName) {
    if (!node.widgets) return;
    const family = node.widgets.find(w => w.name === "model_family");
    const other = node.widgets.find(w => w.name === otherWidgetName);
    if (!family || !other) return;
    const fv = String(family.value || "");
    if (!fv.startsWith("[") && !fv.startsWith("{")) return;
    const ov = String(other.value || "");
    const otherIsEmpty = ov === "" || ov === "[]" || ov === "Select a preset..." || ov === "No model preset is selected";
    if (!otherIsEmpty) return;
    other.value = fv;
    family.value = "SDXL/Base";
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
                _recoverShiftedWidgets(this, "flakes_json");
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
                _recoverShiftedWidgets(this, "flakes_json");
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
                if (!this._configured) {
                    setDefaultSize(this, 260);
                }
                return r;
            };

            const origOnConfigure = nodeType.prototype.onConfigure;
            nodeType.prototype.onConfigure = function () {
                const r = origOnConfigure?.apply(this, arguments);
                this._configured = true;
                if (!this.properties) this.properties = {};
                // Migrate old property name
                if (!this.properties._split_pins && this.properties._selected_split_pins) {
                    this.properties._split_pins = this.properties._selected_split_pins;
                }
                this._splitPinUpdate?.();
                return r;
            };
        }
        if (nodeData.name === "IntoFlakeDataSelect") {
            const origOnNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                const r = origOnNodeCreated?.apply(this, arguments);
                setupIntoFlakeDataSelect(this);
                if (!this._configured) {
                    setDefaultSize(this, 260);
                }
                return r;
            };

            const origOnConfigure = nodeType.prototype.onConfigure;
            nodeType.prototype.onConfigure = function () {
                const r = origOnConfigure?.apply(this, arguments);
                this._configured = true;
                if (!this.properties) this.properties = {};
                // Migrate old property name
                if (!this.properties._into_pins && this.properties._selected_into_pins) {
                    this.properties._into_pins = this.properties._selected_into_pins;
                }
                setupIntoFlakeDataSelect(this);
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
        if (nodeData.name === "FlakeGenerate") {
            const origOnNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                const r = origOnNodeCreated?.apply(this, arguments);
                setupFlakeGenerateWidget(this);
                if (!this._configured) {
                    setDefaultSize(this, 300);
                }
                return r;
            };

            const origOnConfigure = nodeType.prototype.onConfigure;
            nodeType.prototype.onConfigure = function () {
                const r = origOnConfigure?.apply(this, arguments);
                this._configured = true;
                return r;
            };
        }
    },
});
