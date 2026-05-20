import { app } from "../../scripts/app.js";

export function getComboFlakes(node) {
    return node.properties?._combo_flakes || [];
}

export function getComboPresets(node) {
    return node.properties?._combo_presets || [];
}

// Active (non-bypassed) flakes for a FlakeCombo node.
function activeComboFlakes(node) {
    return getComboFlakes(node).filter(f => !f.bypassed);
}

// Number of prompts a generation will queue: the product of each
// FlakeCombo's active-flake count and each FlakeModelCombo's preset count.
// Returns 1 when there are combo nodes but a single combination, or 1 when
// there are no combo nodes at all (a normal single queue).
export function computeJobCount(graph) {
    const g = graph || app.graph;
    if (!g) return 1;
    let count = 1;
    for (const node of g.nodes) {
        if (node.type === "FlakeCombo") {
            const n = activeComboFlakes(node).length;
            if (n > 0) count *= n;
        } else if (node.type === "FlakeModelCombo") {
            const n = getComboPresets(node).length;
            if (n > 0) count *= n;
        }
    }
    return count;
}

export function cartesianProduct(arrays) {
    if (arrays.length === 0) return [[]];
    const result = [];
    const head = arrays[0];
    const tail = cartesianProduct(arrays.slice(1));
    for (const h of head) {
        for (const t of tail) {
            result.push([h, ...t]);
        }
    }
    return result;
}

const _originalQueuePrompt = app.queuePrompt;

let _batchCleanup = null;

function getPromptIdFromEvent(e) {
    const detail = e.detail;
    return typeof detail === "string" ? detail : detail?.prompt_id;
}

function clearAllHighlights() {
    for (const n of app.graph.nodes) {
        if (n.type === "FlakeCombo") {
            delete n._combo_generating_index;
            n._combo_render?.();
        }
        if (n.type === "FlakeModelCombo") {
            delete n._model_combo_generating_index;
            n._model_combo_render?.();
        }
    }
}

function setupBatchTracking(combinations) {
    const comfyApi = window.comfyAPI?.api?.api;
    if (!comfyApi || combinations.length === 0) return null;

    const promptIds = []; // insertion order = combo index
    let completedCount = 0;

    function setComboHighlight(comboIndex) {
        const combination = combinations[comboIndex];
        if (!combination) return;
        for (const item of combination) {
            if (item.type === "combo") {
                item.node._combo_generating_index = item.index;
                item.node._combo_render?.();
            } else {
                item.node._model_combo_generating_index = item.index;
                item.node._model_combo_render?.();
            }
        }
    }

    function maybeFinish() {
        if (completedCount >= combinations.length) {
            if (_batchCleanup) {
                _batchCleanup();
                _batchCleanup = null;
            }
        }
    }

    const onExecStart = (e) => {
        const pid = getPromptIdFromEvent(e);
        if (!pid) return;
        const idx = promptIds.indexOf(pid);
        if (idx >= 0) setComboHighlight(idx);
    };

    const onExecDone = (e) => {
        const pid = getPromptIdFromEvent(e);
        if (!pid) return;
        const idx = promptIds.indexOf(pid);
        if (idx < 0) return;
        completedCount++;
        maybeFinish();
    };

    comfyApi.addEventListener("execution_start", onExecStart);
    comfyApi.addEventListener("execution_success", onExecDone);
    comfyApi.addEventListener("execution_error", onExecDone);
    comfyApi.addEventListener("execution_interrupted", onExecDone);

    const cleanup = () => {
        comfyApi.removeEventListener("execution_start", onExecStart);
        comfyApi.removeEventListener("execution_success", onExecDone);
        comfyApi.removeEventListener("execution_error", onExecDone);
        comfyApi.removeEventListener("execution_interrupted", onExecDone);
        clearAllHighlights();
    };

    return { promptIds, cleanup };
}

app.queuePrompt = async function(number, batchCount = 1) {
    const comboNodes = app.graph.nodes.filter(n => n.type === "FlakeCombo");
    const modelComboNodes = app.graph.nodes.filter(n => n.type === "FlakeModelCombo");

    if (comboNodes.length === 0 && modelComboNodes.length === 0) {
        return _originalQueuePrompt.call(this, number, batchCount);
    }

    const optionsArrays = [];

    for (const node of comboNodes) {
        const flakes = getComboFlakes(node);
        if (flakes.length === 0) {
            window.alert("FlakeCombo node has no flakes selected.");
            return;
        }
        const activeFlakes = flakes
            .map((flake, i) => ({ flake, i }))
            .filter(({ flake }) => !flake.bypassed);
        if (activeFlakes.length === 0) {
            window.alert("FlakeCombo node has no active (non-bypassed) flakes.");
            return;
        }
        optionsArrays.push(activeFlakes.map(({ flake, i }) => ({
            node,
            type: "combo",
            value: flake,
            index: i,
        })));
    }

    for (const node of modelComboNodes) {
        const presets = getComboPresets(node);
        if (presets.length === 0) {
            window.alert("FlakeModelCombo node has no presets selected.");
            return;
        }
        optionsArrays.push(presets.map((preset, i) => ({
            node,
            type: "model_combo",
            value: preset,
            index: i,
        })));
    }

    const combinations = cartesianProduct(optionsArrays);
    if (combinations.length === 0) {
        return _originalQueuePrompt.call(this, number, batchCount);
    }

    // Save original widget values (once per unique node)
    const nodeOriginals = new Map();
    for (const item of combinations[0]) {
        if (!nodeOriginals.has(item.node.id)) {
            if (item.type === "combo") {
                const w = item.node.widgets?.find(w => w.name === "flakes_json");
                nodeOriginals.set(item.node.id, { node: item.node, widget: w, value: w?.value });
            } else {
                const w = item.node.widgets?.find(w => w.name === "preset");
                nodeOriginals.set(item.node.id, { node: item.node, widget: w, value: w?.value });
            }
        }
    }

    const flakeGenerateNodes = app.graph.nodes.filter(n => n.type === "FlakeGenerate");

    // Clean up any previous batch tracking
    if (_batchCleanup) {
        _batchCleanup();
        _batchCleanup = null;
    }

    const tracker = setupBatchTracking(combinations);
    if (tracker) {
        _batchCleanup = tracker.cleanup;
    }

    try {
        for (let comboIdx = 0; comboIdx < combinations.length; comboIdx++) {
            const combination = combinations[comboIdx];
            for (const item of combination) {
                if (item.type === "combo") {
                    const w = item.node.widgets?.find(w => w.name === "flakes_json");
                    if (w) w.value = JSON.stringify([item.value]);
                } else {
                    const w = item.node.widgets?.find(w => w.name === "preset");
                    if (w) w.value = item.value;
                }
            }
            const comboKey = combination
                .map(it => [it.node.id, it.index])
                .sort((a, b) => a[0] - b[0])
                .map(([id, idx]) => `${id}:${idx}`)
                .join("|");
            for (const fg of flakeGenerateNodes) fg._pending_combination_key = comboKey;

            const result = await _originalQueuePrompt.call(this, number, 1);
            if (tracker && result?.prompt_id) {
                tracker.promptIds.push(result.prompt_id);
            }
        }
    } finally {
        for (const orig of nodeOriginals.values()) {
            if (orig.widget) orig.widget.value = orig.value;
        }
        // If no tracker is available, clear highlights immediately as fallback
        if (!tracker) {
            clearAllHighlights();
        }
    }
};
