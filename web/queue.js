import { app } from "../../scripts/app.js";
import { collectChain } from "./widgets/generation-data.js";
import { serializeModelOverrides } from "./utils.js";
import { fetchFlakeMeta, variantComboCount } from "./api.js";

// Full set of variant selections for a flake whose groups are `meta`
// ({group: [choices]}) — the cartesian product, one {group: choice} per combo.
// Empty meta yields a single empty selection (#343).
function enumerateVariantCombos(meta) {
    const groups = Object.keys(meta || {}).filter(g => Array.isArray(meta[g]) && meta[g].length);
    if (groups.length === 0) return [{}];
    const arrays = groups.map(g => meta[g].map(ch => [g, ch]));
    return cartesianProduct(arrays).map(pairs => Object.fromEntries(pairs));
}

// Active (non-bypassed, non-inline) "All Variants" flakes in a FlakeStack's
// flakes_json, as [{ index, flake }] (#343).
function stackAllVariantsFlakes(node) {
    const w = node.widgets?.find(w => w.name === "flakes_json");
    let entries = [];
    try { entries = JSON.parse(w?.value || "[]"); } catch { entries = []; }
    if (!Array.isArray(entries)) return [];
    return entries
        .map((flake, index) => ({ flake, index }))
        .filter(({ flake }) => flake && !flake.inline && !flake.bypassed && flake._all_variants && flake.name);
}

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

// Active (non-bypassed) presets for a FlakeModelCombo node. Bypass is keyed by
// preset name in node.properties._combo_bypassed.
function activeComboPresets(node) {
    const bypassed = new Set(node.properties?._combo_bypassed || []);
    return getComboPresets(node).filter(p => !bypassed.has(p));
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
            // Each active flake is one axis item; an "All Variants" flake expands
            // into one item per variant combination (#343).
            let axis = 0;
            for (const f of activeComboFlakes(node)) {
                axis += f._all_variants ? Math.max(1, variantComboCount(f.name)) : 1;
            }
            if (axis > 0) count *= axis;
        } else if (node.type === "FlakeModelCombo") {
            const n = activeComboPresets(node).length;
            if (n > 0) count *= n;
        } else if (node.type === "FlakeStack") {
            // Stack flakes flagged "All Variants" are extra axes (#343).
            for (const { flake } of stackAllVariantsFlakes(node)) {
                count *= Math.max(1, variantComboCount(flake.name));
            }
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

// The combination index for the prompt currently being queued (#348). With a UI
// batch count > 1 each combination queues several prompts, so the prompt-id
// index no longer equals the combination index — this maps it back.
let _currentComboIndex = null;

// Active batch promptId → comboKey map, plus a live "running" pointer.
// Exported so the Generation Data overlay can show per-combo progress (#230).
const _activeBatch = { promptIds: [], comboKeys: [], runningPromptId: null };
export function getActiveBatch() {
    return _activeBatch;
}

function setupBatchTracking(combinations, comboKeys, totalJobs) {
    const comfyApi = _resolveComfyApi();
    if (!comfyApi || typeof comfyApi.addEventListener !== "function" || combinations.length === 0) {
        if (!comfyApi) {
            // eslint-disable-next-line no-console
            console.warn("[flakes] could not resolve ComfyUI api singleton; combo highlight/per-combo image storage disabled.");
        }
        return null;
    }
    const jobs = totalJobs || combinations.length;

    const promptIds = []; // queue order
    const comboIndexByPrompt = []; // parallel to promptIds: the combination index (#348)
    let completedCount = 0;

    // Pending event buffer: websocket events for a prompt_id can arrive BEFORE
    // the REST response that gives us that prompt_id (different transport
    // channels). Buffer events we don't yet know about and replay them when
    // the patched api.queuePrompt finally registers the id. Without this, the
    // first generation in a batch consistently lost its execution_start /
    // executed events (#241).
    const pendingByPid = new Map(); // promptId -> [{type, e}]
    function applyEventForKnownPid(type, e, pid) {
        if (type === "execution_start") {
            const idx = promptIds.indexOf(pid);
            if (idx >= 0) { setComboHighlight(comboIndexByPrompt[idx]); _activeBatch.runningPromptId = pid; }
        } else if (type === "execution_success" || type === "execution_error" || type === "execution_interrupted") {
            const idx = promptIds.indexOf(pid);
            if (idx < 0) return;
            completedCount++;
            for (const n of app.graph.nodes) {
                if (n.type === "FlakeGenerate") {
                    n._batch_completed_count = completedCount;
                    n._batch_total_count = jobs;
                    n._batch_progress_render?.();
                }
            }
            maybeFinish();
        } else if (type === "executed") {
            handleExecuted(e);
        } else if (type === "progress") {
            // Progress events are handled by the overlay subscription; nothing
            // to replay batch-side. We only buffer the lifecycle events.
        }
    }
    function bufferOrApply(type, e) {
        const pid = type === "executed" ? (typeof e?.detail === "string" ? null : e?.detail?.prompt_id) : getPromptIdFromEvent(e);
        if (!pid) return;
        if (promptIds.includes(pid)) {
            applyEventForKnownPid(type, e, pid);
        } else {
            let arr = pendingByPid.get(pid);
            if (!arr) { arr = []; pendingByPid.set(pid, arr); }
            arr.push({ type, e });
        }
    }
    function flushPendingFor(pid) {
        const arr = pendingByPid.get(pid);
        if (!arr) return;
        pendingByPid.delete(pid);
        for (const { type, e } of arr) applyEventForKnownPid(type, e, pid);
    }

    // Patch api.queuePrompt for the duration of this batch so we capture the
    // returned prompt_id. (app.queuePrompt in current frontend versions
    // returns void; the low-level api.queuePrompt still returns the
    // {prompt_id, number, node_errors} REST response.)
    const _origApiQueuePrompt = comfyApi.queuePrompt?.bind(comfyApi);
    if (_origApiQueuePrompt) {
        comfyApi.queuePrompt = async function(...args) {
            // Snapshot the combo key/index now — they may already be cleared by
            // the time the await below resolves.
            const comboKeyForThisCall = _currentBatchComboKey;
            const comboIndexForThisCall = _currentComboIndex;
            const result = await _origApiQueuePrompt(...args);
            if (result?.prompt_id && comboKeyForThisCall !== null) {
                promptIds.push(result.prompt_id);
                comboIndexByPrompt.push(comboIndexForThisCall ?? 0);
                comboKeys.push(comboKeyForThisCall);
                _activeBatch.promptIds.push(result.prompt_id);
                _activeBatch.comboKeys.push(comboKeyForThisCall);
                // Replay any websocket events that arrived before this push.
                flushPendingFor(result.prompt_id);
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
            } else if (item.type === "model_combo") {
                item.node._model_combo_generating_index = item.index;
                item.node._model_combo_render?.();
            }
            // stack_variant items have no node-level highlight (#343).
        }
    }

    function maybeFinish() {
        if (completedCount >= jobs) {
            if (_batchCleanup) {
                _batchCleanup();
                _batchCleanup = null;
            }
        }
    }

    // The `executed` event carries the per-node output payload. Used to stamp
    // generated images onto FlakeGenerate nodes keyed by their comboKey.
    function handleExecuted(e) {
        const detail = e?.detail || {};
        const pid = typeof detail === "string" ? null : detail.prompt_id;
        const output = detail?.output;
        const nodeId = detail?.node;
        if (!pid || !output) return;
        const idx = promptIds.indexOf(pid);
        if (idx < 0) return;
        const comboKey = (comboKeys && comboKeys[idx]) ?? "";
        const images = output.flake_images;
        const adImages = output.flake_images_ad;
        const isAB = Array.isArray(output.adetailer_ab) && output.adetailer_ab.length > 0;
        if (!Array.isArray(images) || images.length === 0) return;
        const candidates = nodeId
            ? [app.graph.getNodeById(nodeId)].filter(n => n && n.type === "FlakeGenerate")
            : app.graph.nodes.filter(n => n.type === "FlakeGenerate");
        for (const fg of candidates) {
            fg.properties = fg.properties || {};
            fg.properties._images_by_combo = fg.properties._images_by_combo || {};
            fg.properties._images_by_combo[comboKey] = images[0];
            if (isAB && Array.isArray(adImages) && adImages.length > 0) {
                fg.properties._images_by_combo_ad = fg.properties._images_by_combo_ad || {};
                fg.properties._images_by_combo_ad[comboKey] = adImages[0];
                fg.properties._adetailer_ab = true;
            }
        }
    }

    // All websocket lifecycle/output events route through bufferOrApply so
    // events arriving before their prompt_id is registered get queued.
    const onExecStart = (e) => bufferOrApply("execution_start", e);
    const onExecSuccess = (e) => bufferOrApply("execution_success", e);
    const onExecError = (e) => bufferOrApply("execution_error", e);
    const onExecInterrupted = (e) => bufferOrApply("execution_interrupted", e);
    const onExecuted = (e) => bufferOrApply("executed", e);

    comfyApi.addEventListener("execution_start", onExecStart);
    comfyApi.addEventListener("execution_success", onExecSuccess);
    comfyApi.addEventListener("execution_error", onExecError);
    comfyApi.addEventListener("execution_interrupted", onExecInterrupted);
    comfyApi.addEventListener("executed", onExecuted);

    const cleanup = () => {
        comfyApi.removeEventListener("execution_start", onExecStart);
        comfyApi.removeEventListener("execution_success", onExecSuccess);
        comfyApi.removeEventListener("execution_error", onExecError);
        comfyApi.removeEventListener("execution_interrupted", onExecInterrupted);
        comfyApi.removeEventListener("executed", onExecuted);
        if (_origApiQueuePrompt) {
            comfyApi.queuePrompt = _origApiQueuePrompt;
        }
        _currentBatchComboKey = null;
        _activeBatch.promptIds = [];
        _activeBatch.comboKeys = [];
        _activeBatch.runningPromptId = null;
        pendingByPid.clear();
        clearAllHighlights();
    };

    return { promptIds, cleanup };
}

// Order the combinatorial nodes (FlakeCombo + FlakeModelCombo) by their
// position in the pipeline connection chain (source -> sink), so the loop
// nesting follows the graph flow rather than node creation order. The
// FlakeModelCombo is the chain source (it loads the heavy checkpoint), so it
// lands first = outermost loop = reloaded least; each subsequent FlakeCombo
// toward FlakeGenerate becomes a deeper inner loop. Combo nodes not reachable
// from any FlakeGenerate (orphans) are appended in creation order so
// disconnected graphs keep working.
function orderedComboNodes() {
    const isCombo = (n) => n.type === "FlakeCombo" || n.type === "FlakeModelCombo";
    const ordered = [];
    const seen = new Set();
    for (const gen of app.graph.nodes) {
        if (gen.type !== "FlakeGenerate") continue;
        const fdInput = gen.inputs?.find(i => i.name === "flake_data");
        if (fdInput?.link == null) continue;
        const link = app.graph.links?.[fdInput.link];
        if (!link) continue;
        const startNode = app.graph.getNodeById(link.origin_id);
        if (!startNode) continue;
        let chain = [];
        try { chain = collectChain(startNode); } catch { chain = []; }
        for (const { node } of chain) {
            if (isCombo(node) && !seen.has(node.id)) { seen.add(node.id); ordered.push(node); }
        }
    }
    for (const node of app.graph.nodes) {
        if (isCombo(node) && !seen.has(node.id)) { seen.add(node.id); ordered.push(node); }
    }
    // Exclude node-level bypassed (mode 4) / muted (mode 2) combo nodes entirely,
    // so they never contribute presets or raise "no active presets" errors (#304).
    return ordered.filter((n) => n.mode !== 4 && n.mode !== 2);
}

app.queuePrompt = async function(number, batchCount = 1) {
    const orderedNodes = orderedComboNodes();

    // Stack flakes flagged "All Variants" become extra combinatorial axes,
    // independent of any combo nodes (#343).
    const stackAxes = [];
    for (const node of app.graph.nodes) {
        if (node.type !== "FlakeStack" || node.mode === 2 || node.mode === 4) continue;
        for (const { flake, index } of stackAllVariantsFlakes(node)) {
            const meta = await fetchFlakeMeta(flake.name);
            const combos = enumerateVariantCombos(meta);
            if (combos.length <= 1) continue;
            stackAxes.push(combos.map((variant, vi) => ({
                node, type: "stack_variant", flakeIndex: index, value: variant, index, vkey: `s${index}.${vi}`,
            })));
        }
    }

    if (orderedNodes.length === 0 && stackAxes.length === 0) {
        return _originalQueuePrompt.call(this, number, batchCount);
    }

    const optionsArrays = [];

    for (const node of orderedNodes) {
        if (node.type === "FlakeCombo") {
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
            // Expand "All Variants" flakes into one axis item per variant combo;
            // ordinary flakes stay a single item. vkey keeps each combo's
            // comboKey unique (#343).
            const comboItems = [];
            for (const { flake, i } of activeFlakes) {
                if (flake._all_variants) {
                    const meta = await fetchFlakeMeta(flake.name);
                    enumerateVariantCombos(meta).forEach((variant, vi) => {
                        comboItems.push({ node, type: "combo", value: { ...flake, variant }, index: i, vkey: `${i}.${vi}` });
                    });
                } else {
                    comboItems.push({ node, type: "combo", value: flake, index: i, vkey: `${i}` });
                }
            }
            optionsArrays.push(comboItems);
        } else {
            const presets = getComboPresets(node);
            if (presets.length === 0) {
                window.alert("FlakeModelCombo node has no presets selected.");
                return;
            }
            const bypassed = new Set(node.properties?._combo_bypassed || []);
            const activePresets = presets
                .map((preset, i) => ({ preset, i }))
                .filter(({ preset }) => !bypassed.has(preset));
            if (activePresets.length === 0) {
                window.alert("FlakeModelCombo node has no active (non-bypassed) presets.");
                return;
            }
            // Keep the original preset index so combo highlighting maps correctly.
            optionsArrays.push(activePresets.map(({ preset, i }) => ({
                node,
                type: "model_combo",
                value: preset,
                index: i,
                vkey: String(i),
            })));
        }
    }

    // Append the stack "All Variants" axes (#343).
    for (const axis of stackAxes) optionsArrays.push(axis);

    const combinations = cartesianProduct(optionsArrays);
    if (combinations.length === 0) {
        return _originalQueuePrompt.call(this, number, batchCount);
    }

    // Save original widget values (once per unique node)
    const nodeOriginals = new Map();
    for (const item of combinations[0]) {
        if (!nodeOriginals.has(item.node.id)) {
            if (item.type === "combo" || item.type === "stack_variant") {
                // Both mutate the node's flakes_json; save it once to restore later.
                const w = item.node.widgets?.find(w => w.name === "flakes_json");
                nodeOriginals.set(item.node.id, { node: item.node, widget: w, value: w?.value });
            } else {
                const w = item.node.widgets?.find(w => w.name === "preset");
                const ow = item.node.widgets?.find(w => w.name === "overrides_json");
                nodeOriginals.set(item.node.id, {
                    node: item.node, widget: w, value: w?.value,
                    overrideWidget: ow, overrideValue: ow?.value,
                });
            }
        }
    }

    const flakeGenerateNodes = app.graph.nodes.filter(n => n.type === "FlakeGenerate");

    // Clean up any previous batch tracking
    if (_batchCleanup) {
        _batchCleanup();
        _batchCleanup = null;
    }

    // The UI batch count multiplies the combinations: each combination is run
    // `runsPerCombo` times in a row before moving to the next (#348). The seed
    // advances between runs via control_after_generate (randomize/increment).
    const runsPerCombo = Math.max(1, batchCount | 0);
    const totalJobs = combinations.length * runsPerCombo;

    const comboKeys = []; // parallel to promptIds; comboKeys[idx] = key for promptIds[idx]
    const tracker = setupBatchTracking(combinations, comboKeys, totalJobs);
    if (tracker) {
        _batchCleanup = tracker.cleanup;
    }
    // Initialize progress counters on every FlakeGenerate node so the "[i/N] done"
    // label resets to "[0/N]" at batch start (#227).
    for (const n of flakeGenerateNodes) {
        n._batch_completed_count = 0;
        n._batch_total_count = totalJobs;
        n._batch_progress_render?.();
    }

    try {
        for (let comboIdx = 0; comboIdx < combinations.length; comboIdx++) {
            const combination = combinations[comboIdx];
            for (const item of combination) {
                if (item.type === "combo") {
                    const w = item.node.widgets?.find(w => w.name === "flakes_json");
                    if (w) w.value = JSON.stringify([item.value]);
                } else if (item.type === "stack_variant") {
                    // Set just this stack flake's variant for the combination;
                    // other stack flakes (and other all-variants indices) are left
                    // to their own items. Restored from nodeOriginals after (#343).
                    const w = item.node.widgets?.find(w => w.name === "flakes_json");
                    if (w) {
                        let arr; try { arr = JSON.parse(w.value || "[]"); } catch { arr = []; }
                        if (arr[item.flakeIndex]) {
                            arr[item.flakeIndex] = { ...arr[item.flakeIndex], variant: item.value };
                            w.value = JSON.stringify(arr);
                        }
                    }
                } else {
                    const w = item.node.widgets?.find(w => w.name === "preset");
                    if (w) w.value = item.value;
                    // Per-instance preset overrides for this combination (#279).
                    const ow = item.node.widgets?.find(w => w.name === "overrides_json");
                    if (ow) {
                        const ovr = (item.node.properties?._combo_overrides || [])[item.index] || {};
                        ow.value = serializeModelOverrides(ovr);
                    }
                }
            }
            const comboKey = combination
                .map(it => [it.node.id, it.vkey ?? String(it.index)])
                .sort((a, b) => a[0] - b[0])
                .map(([id, vk]) => `${id}:${vk}`)
                .join("|");

            // Run this combination `runsPerCombo` times before the next (#348).
            // Tell our patched api.queuePrompt which comboKey/index to attach to
            // each captured prompt_id. app.queuePrompt in modern frontends returns
            // void; the prompt_id is captured inside the patch instead.
            for (let b = 0; b < runsPerCombo; b++) {
                if (tracker) { _currentBatchComboKey = comboKey; _currentComboIndex = comboIdx; }
                try {
                    await _originalQueuePrompt.call(this, number, 1);
                } finally {
                    if (tracker) { _currentBatchComboKey = null; _currentComboIndex = null; }
                }
            }
        }
    } finally {
        for (const orig of nodeOriginals.values()) {
            if (orig.widget) orig.widget.value = orig.value;
            if (orig.overrideWidget) orig.overrideWidget.value = orig.overrideValue;
        }
        // If no tracker is available, clear highlights immediately as fallback
        if (!tracker) {
            clearAllHighlights();
        }
    }
};
