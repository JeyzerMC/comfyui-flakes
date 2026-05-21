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

// ComfyUI exposes the websocket-event-emitting `api` singleton in slightly
// different places depending on frontend version. Try several spots so we
// don't silently lose batch tracking on a newer/older frontend.
function _resolveComfyApi() {
    return (
        window.comfyAPI?.api?.api
        || window.comfyAPI?.api
        || app.api
        || window.app?.api
        || null
    );
}

// Set by the outer batch loop before each combo's queue call; read by the
// patched api.queuePrompt so the captured prompt_id can be tagged with the
// right comboKey. Cleared between combos.
let _currentBatchComboKey = null;

function setupBatchTracking(combinations, comboKeys) {
    const comfyApi = _resolveComfyApi();
    if (!comfyApi || typeof comfyApi.addEventListener !== "function" || combinations.length === 0) {
        if (!comfyApi) {
            // eslint-disable-next-line no-console
            console.warn("[flakes] could not resolve ComfyUI api singleton; combo highlight/per-combo image storage disabled.");
        }
        return null;
    }

    const promptIds = []; // insertion order = combo index
    let completedCount = 0;

    // Patch api.queuePrompt for the duration of this batch so we capture the
    // returned prompt_id. (app.queuePrompt in current frontend versions
    // returns void; the low-level api.queuePrompt still returns the
    // {prompt_id, number, node_errors} REST response.)
    const _origApiQueuePrompt = comfyApi.queuePrompt?.bind(comfyApi);
    if (_origApiQueuePrompt) {
        comfyApi.queuePrompt = async function(...args) {
            const result = await _origApiQueuePrompt(...args);
            if (result?.prompt_id && _currentBatchComboKey !== null) {
                promptIds.push(result.prompt_id);
                comboKeys.push(_currentBatchComboKey);
            }
            return result;
        };
    }

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
        // Surface progress to the Flake Generate node label "[i/N] done" (#227).
        for (const n of app.graph.nodes) {
            if (n.type === "FlakeGenerate") {
                n._batch_completed_count = completedCount;
                n._batch_total_count = combinations.length;
                n._batch_progress_render?.();
            }
        }
        maybeFinish();
    };

    // Stamp generated images onto the right combo key on the right FlakeGenerate
    // node by reading the prompt_id from the `executed` event. Without this,
    // _pending_combination_key races between successive prompts in a batch and
    // every prompt's output overwrites the same (latest) combo slot.
    const onExecuted = (e) => {
        const detail = e?.detail || {};
        const pid = typeof detail === "string" ? null : detail.prompt_id;
        const output = detail?.output;
        const nodeId = detail?.node;
        if (!pid || !output) return;
        const idx = promptIds.indexOf(pid);
        if (idx < 0) return;
        const comboKey = (comboKeys && comboKeys[idx]) ?? "";
        const images = output.flake_images;
        if (!Array.isArray(images) || images.length === 0) return;
        // Pin the image to the FlakeGenerate node that produced it. If we have
        // a node id from the event, prefer that; otherwise stamp every
        // FlakeGenerate node (single-FG workflows are by far the common case).
        const candidates = nodeId
            ? [app.graph.getNodeById(nodeId)].filter(n => n && n.type === "FlakeGenerate")
            : app.graph.nodes.filter(n => n.type === "FlakeGenerate");
        for (const fg of candidates) {
            fg.properties = fg.properties || {};
            fg.properties._images_by_combo = fg.properties._images_by_combo || {};
            fg.properties._images_by_combo[comboKey] = images[0];
        }
    };

    comfyApi.addEventListener("execution_start", onExecStart);
    comfyApi.addEventListener("execution_success", onExecDone);
    comfyApi.addEventListener("execution_error", onExecDone);
    comfyApi.addEventListener("execution_interrupted", onExecDone);
    comfyApi.addEventListener("executed", onExecuted);

    const cleanup = () => {
        comfyApi.removeEventListener("execution_start", onExecStart);
        comfyApi.removeEventListener("execution_success", onExecDone);
        comfyApi.removeEventListener("execution_error", onExecDone);
        comfyApi.removeEventListener("execution_interrupted", onExecDone);
        comfyApi.removeEventListener("executed", onExecuted);
        // Restore api.queuePrompt — don't leave our patch installed past the
        // batch lifetime, otherwise stale closures would accumulate.
        if (_origApiQueuePrompt) {
            comfyApi.queuePrompt = _origApiQueuePrompt;
        }
        _currentBatchComboKey = null;
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

    const comboKeys = []; // parallel to promptIds; comboKeys[idx] = key for promptIds[idx]
    const tracker = setupBatchTracking(combinations, comboKeys);
    if (tracker) {
        _batchCleanup = tracker.cleanup;
    }
    // Initialize progress counters on every FlakeGenerate node so the "[i/N] done"
    // label resets to "[0/N]" at batch start (#227).
    for (const n of flakeGenerateNodes) {
        n._batch_completed_count = 0;
        n._batch_total_count = combinations.length;
        n._batch_progress_render?.();
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

            // Tell our patched api.queuePrompt which comboKey to attach to the
            // upcoming prompt_id. app.queuePrompt in modern frontends returns
            // void; the prompt_id is captured inside the patch instead.
            if (tracker) _currentBatchComboKey = comboKey;
            try {
                await _originalQueuePrompt.call(this, number, 1);
            } finally {
                if (tracker) _currentBatchComboKey = null;
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
