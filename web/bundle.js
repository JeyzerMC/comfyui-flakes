import { app } from "../../scripts/app.js";
import { invalidateList } from "./api.js";
import { refreshPresetOptions } from "./preset-modal.js";

// Point the nodes at the "<name> (imported)" copies the server installed for
// name collisions.
function renameInNodes({ flakes, presets }) {
    for (const graph of [app.graph, ...(app.graph.subgraphs?.values() ?? [])]) {
        for (const node of graph.nodes) {
            const flakesWidget = node.widgets?.find(w => w.name === "flakes_json");
            const entries = flakesWidget ? JSON.parse(flakesWidget.value || "[]") : [];
            if (entries.some(e => flakes[e.name])) {
                for (const e of entries) e.name = flakes[e.name] ?? e.name;
                flakesWidget.value = JSON.stringify(entries);
                (node._flakes_render ?? node._combo_render)?.();
            }
            const presetWidget = node.widgets?.find(w => w.name === "preset");
            if (presetWidget && presets[presetWidget.value]) {
                presetWidget.value = presets[presetWidget.value];
                (node._preset_render ?? node._model_combo_render)?.();
            }
        }
    }
    app.graph.setDirtyCanvas(true, true);
}

// A dropped Flake Generate image carries the flakes and presets it used in
// workflow.extra.flake_bundle (#427). Install them once and drop the bundle so
// it isn't saved back into the workflow.
app.registerExtension({
    name: "comfyui-flakes.Bundle",
    async afterConfigureGraph() {
        const bundle = app.graph.extra?.flake_bundle;
        if (!bundle) return;
        delete app.graph.extra.flake_bundle;
        const r = await fetch("/flakes/bundle/install", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(bundle),
        });
        const result = await r.json();
        if (!r.ok) throw new Error(`[flakes] bundle install failed: ${result.error}`);
        if (result.installed.length) {
            invalidateList();
            await refreshPresetOptions();
        }
        if (Object.keys(result.flakes).length || Object.keys(result.presets).length) renameInNodes(result);
    },
});
