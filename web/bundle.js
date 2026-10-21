import { app } from "../../scripts/app.js";
import { invalidateList } from "./api.js";
import { refreshPresetOptions } from "./preset-modal.js";

// Workflow-local flakes and presets (#437) are staged as "_local/<hash>/<name>".
const LOCAL_PREFIX = /^_local\/[0-9a-f]+\//;

function* graphNodes() {
    for (const graph of [app.graph, ...(app.graph.subgraphs?.values() ?? [])]) yield* graph.nodes;
}

function flakeEntries(node) {
    const widget = node.widgets?.find(w => w.name === "flakes_json");
    return [widget, widget ? JSON.parse(widget.value || "[]") : []];
}

// Point the nodes' flakes and presets at their new names. A name staged from
// an earlier bundle matches by its original name.
function renameInNodes({ flakes, presets }) {
    const renamed = (map, name) => map[name] ?? map[name?.replace(LOCAL_PREFIX, "")];
    for (const node of graphNodes()) {
        const [flakesWidget, entries] = flakeEntries(node);
        if (entries.some(e => renamed(flakes, e.name))) {
            for (const e of entries) e.name = renamed(flakes, e.name) ?? e.name;
            flakesWidget.value = JSON.stringify(entries);
            (node._flakes_render ?? node._combo_render)?.();
        }
        const presetWidget = node.widgets?.find(w => w.name === "preset");
        const combo = node.properties?._combo_presets;
        if (presetWidget && [presetWidget.value, ...(combo ?? [])].some(p => renamed(presets, p))) {
            presetWidget.value = renamed(presets, presetWidget.value) ?? presetWidget.value;
            if (combo) {
                node.properties._combo_presets = combo.map(p => renamed(presets, p) ?? p);
                node.properties._combo_bypassed = (node.properties._combo_bypassed ?? []).map(p => renamed(presets, p) ?? p);
            }
            (node._preset_render ?? node._model_combo_render)?.();
        }
    }
    app.graph.setDirtyCanvas(true, true);
}

function graphUsesLocal() {
    for (const node of graphNodes()) {
        const names = [...flakeEntries(node)[1].map(e => e.name), node.widgets?.find(w => w.name === "preset")?.value, ...(node.properties?._combo_presets ?? [])];
        if (names.some(n => LOCAL_PREFIX.test(n ?? ""))) return true;
    }
    return false;
}

// "Save to disk" on a local flake or preset: installs it and the flakes it
// links to, then points the workflow at the saved names. The bundle goes once
// nothing local is left.
export async function saveLocalToDisk(name) {
    const r = await fetch("/flakes/bundle/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
    });
    const result = await r.json();
    if (!r.ok) {
        window.alert(`Failed to save '${name}' to disk: ${result.error}`);
        return;
    }
    invalidateList();
    await refreshPresetOptions();
    renameInNodes(result);
    if (!graphUsesLocal()) delete app.graph.extra?.flake_bundle;
}

// A dropped Flake Generate image carries the flakes and presets it used in
// workflow.extra.flake_bundle (#427). They stay local to the workflow (#437):
// staged in ComfyUI's temp folder on every load, nothing installed on disk.
app.registerExtension({
    name: "comfyui-flakes.Bundle",
    async afterConfigureGraph() {
        const bundle = app.graph.extra?.flake_bundle;
        if (!bundle) return;
        const r = await fetch("/flakes/bundle/stage", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(bundle),
        });
        const result = await r.json();
        if (!r.ok) throw new Error(`[flakes] bundle staging failed: ${result.error}`);
        renameInNodes(result);
    },
});
