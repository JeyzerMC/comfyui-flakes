import { app } from "../../scripts/app.js";
import { setupFlakeWidget } from "./widgets/flake-stack.js";
import { setupFlakeComboWidget } from "./widgets/flake-combo.js";
import { setupFlakeModelPresetWidget } from "./widgets/flake-model-preset.js";
import { setupFlakeModelComboWidget } from "./widgets/flake-model-combo.js";
import "./queue.js";

function removeHiddenInputs(node, names) {
    for (let i = node.inputs.length - 1; i >= 0; i--) {
        if (names.includes(node.inputs[i].name)) {
            node.inputs.splice(i, 1);
        }
    }
}

function disableWidgetConversion(node, names) {
    const origGetWidgetOnPos = node.getWidgetOnPos;
    node.getWidgetOnPos = function (x, y) {
        const widget = origGetWidgetOnPos?.apply(this, arguments);
        if (widget && names.includes(widget.name)) {
            return null;
        }
        return widget;
    };
}

app.registerExtension({
    name: "comfyui-flakes.FlakeStack",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name === "FlakeStack") {
            nodeType.prototype.size = [340, 200];
            const origOnNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                const r = origOnNodeCreated?.apply(this, arguments);
                setupFlakeWidget(this);
                removeHiddenInputs(this, ["model_family", "flakes_json"]);
                disableWidgetConversion(this, ["model_family", "flakes_json"]);
                return r;
            };

            const origOnConfigure = nodeType.prototype.onConfigure;
            nodeType.prototype.onConfigure = function () {
                const r = origOnConfigure?.apply(this, arguments);
                removeHiddenInputs(this, ["model_family", "flakes_json"]);
                disableWidgetConversion(this, ["model_family", "flakes_json"]);
                this._flakes_render?.();
                return r;
            };
        }
        if (nodeData.name === "FlakeModelPreset") {
            nodeType.prototype.size = [300, 200];
            const origOnNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                const r = origOnNodeCreated?.apply(this, arguments);
                setupFlakeModelPresetWidget(this);
                removeHiddenInputs(this, ["model_family", "preset"]);
                disableWidgetConversion(this, ["model_family", "preset"]);
                return r;
            };

            const origOnConfigure = nodeType.prototype.onConfigure;
            nodeType.prototype.onConfigure = function () {
                const r = origOnConfigure?.apply(this, arguments);
                removeHiddenInputs(this, ["model_family", "preset"]);
                disableWidgetConversion(this, ["model_family", "preset"]);
                this._preset_render?.();
                return r;
            };
        }
        if (nodeData.name === "FlakeCombo") {
            nodeType.prototype.size = [340, 200];
            const origOnNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                const r = origOnNodeCreated?.apply(this, arguments);
                setupFlakeComboWidget(this);
                removeHiddenInputs(this, ["model_family", "flakes_json"]);
                disableWidgetConversion(this, ["model_family", "flakes_json"]);
                return r;
            };

            const origOnConfigure = nodeType.prototype.onConfigure;
            nodeType.prototype.onConfigure = function () {
                const r = origOnConfigure?.apply(this, arguments);
                removeHiddenInputs(this, ["model_family", "flakes_json"]);
                disableWidgetConversion(this, ["model_family", "flakes_json"]);
                this._combo_render?.();
                return r;
            };
        }
        if (nodeData.name === "FlakeModelCombo") {
            nodeType.prototype.size = [300, 200];
            const origOnNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                const r = origOnNodeCreated?.apply(this, arguments);
                setupFlakeModelComboWidget(this);
                removeHiddenInputs(this, ["model_family", "preset"]);
                disableWidgetConversion(this, ["model_family", "preset"]);
                return r;
            };

            const origOnConfigure = nodeType.prototype.onConfigure;
            nodeType.prototype.onConfigure = function () {
                const r = origOnConfigure?.apply(this, arguments);
                removeHiddenInputs(this, ["model_family", "preset"]);
                disableWidgetConversion(this, ["model_family", "preset"]);
                this._model_combo_render?.();
                return r;
            };
        }
    },
});
