import { app } from "../../scripts/app.js";
import { collectChain, MODEL_COMBO_TYPES, STACK_TYPES, FLAKE_COMBO_TYPES } from "./widgets/generation-data.js";
import { serializeModelOverrides, expandEntryVariants } from "./utils.js";
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

// A FlakeStack's flakes_json entries.
function stackEntries(node) {
    const w = node.widgets?.find(w => w.name === "flakes_json");
    let entries = [];
    try { entries = JSON.parse(w?.value || "[]"); } catch { entries = []; }
    return Array.isArray(entries) ? entries : [];
}

// Active (non-bypassed, non-inline) "All Variants" flakes in a FlakeStack's
// flakes_json, as [{ index, flake }] (#343).
function stackAllVariantsFlakes(node) {
    return stackEntries(node)
        .map((flake, index) => ({ flake, index }))
        .filter(({ flake }) => flake && !flake.inline && !flake.bypassed && flake._all_variants && flake.name);
}

// Flake Animate grid items carry input images (#441), one job each. A combo
// item splits into [{ image, key: `${key}@${k}` }]; without images it stays
// one job under its own key. The Generation Data overlay mirrors these keys.
export function itemImageJobs(entry, key) {
    const images = entry.images || [];
    return images.length ? images.map((image, k) => ({ image, key: `${key}@${k}` })) : [{ image: null, key }];
}

// A Flake Animate Stack's jobs: one per input image of its active items, in
// grid order, as [{ index, image, key: `s@${k}` }] (index: the item's entry).
export function stackImageJobs(node) {
    return stackEntries(node)
        .flatMap((e, index) => (e && !e.bypassed && e.images || []).map(image => ({ index, image })))
        .map((job, k) => ({ ...job, key: `s@${k}` }));
}

export function getComboFlakes(node) {
    return node.properties?._combo_flakes || [];
}

export function getComboPresets(node) {
    return node.properties?._combo_presets || [];
}

// Persistent id of a combo grid item (#383): Flake Combo entries carry it as
// `_uid`, Flake Model Combo keeps `_combo_uids` parallel to `_combo_presets`.
// Combo keys use it, so results, previews and highlights survive reordering.
export function newItemUid() {
    return Math.random().toString(36).slice(2, 10);
}

// Sub-key of an "All Variants" item: its selection as sorted group=choice pairs.
export function variantKey(variant) {
    return Object.keys(variant).sort().map(g => `${g}=${variant[g]}`).join(",");
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
        if (FLAKE_COMBO_TYPES.includes(node.type)) {
            // Each active flake is one axis item; an "All Variants" flake expands
            // into one item per variant combination (#343), a "Multiple" one
            // into one per checked choice set (#406), each times its input images (#441).
            let axis = 0;
            for (const f of activeComboFlakes(node)) {
                const variants = f._all_variants ? Math.max(1, variantComboCount(f.name)) : expandEntryVariants(f).length;
                axis += variants * itemImageJobs(f, "").length;
            }
            if (axis > 0) count *= axis;
        } else if (MODEL_COMBO_TYPES.includes(node.type)) {
            const n = activeComboPresets(node).length;
            if (n > 0) count *= n;
        } else if (STACK_TYPES.includes(node.type)) {
            // Stack flakes flagged "All Variants" are extra axes (#343), and so
            // are a Flake Animate Stack's input images (#441).
            for (const { flake } of stackAllVariantsFlakes(node)) {
                count *= Math.max(1, variantComboCount(flake.name));
            }
            count *= Math.max(1, stackImageJobs(node).length);
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

// Live batch state per workflow (#373): running combo item per combo node id,
// results per FlakeGenerate node id, progress counters. Switching workflow tabs
// rebuilds every node and the batch's workflow may not be the active one when
// its events arrive, so nodes read this when they render instead of owning it.
const _batchStates = new WeakMap(); // workflow -> { generating, images, completed, total }
const _batchListeners = new Set();

// Nodes that sample a chain: they show previews and keep per-combination results.
const GENERATE_TYPES = ["FlakeGenerate", "FlakeGenerateAnimation"];

function activeWorkflow() {
    // Frontends without a workflow store have a single implicit workflow.
    return app.extensionManager?.workflow?.activeWorkflow ?? app;
}

function activeState() {
    return _batchStates.get(activeWorkflow());
}

// Combo node -> the running uid its last render highlighted.
const _shownUids = new WeakMap();

// Uid of the running item of a FlakeCombo / FlakeModelCombo node, if any.
// Called by the node's render.
export function getGeneratingUid(node) {
    const uid = activeState()?.generating[node.id];
    _shownUids.set(node, uid);
    return uid;
}

// { combo: {comboKey: img}, ad: {comboKey: img}, ab, last, lastKey } for a FlakeGenerate
// node, or null when no batch of this workflow produced results for it.
export function getBatchImages(node) {
    return activeState()?.images[node.id] || null;
}

export function getBatchProgress() {
    return activeState() || null;
}

// fn() runs after any batch state change; returns an unsubscribe function.
export function subscribeBatch(fn) {
    _batchListeners.add(fn);
    return () => _batchListeners.delete(fn);
}

// Re-renders only the combo nodes whose highlighted item changed.
function renderHighlights(state) {
    if (activeState() !== state) return;
    for (const n of app.graph.nodes) {
        if (_shownUids.has(n) && _shownUids.get(n) === state?.generating[n.id]) continue;
        if (FLAKE_COMBO_TYPES.includes(n.type)) n._combo_render?.();
        else if (MODEL_COMBO_TYPES.includes(n.type)) n._model_combo_render?.();
    }
}

// FlakeGenerate nodes read the active workflow's state themselves.
function renderResults() {
    for (const n of app.graph.nodes) {
        if (GENERATE_TYPES.includes(n.type)) n._flake_generate_render?.();
    }
    for (const fn of _batchListeners) fn();
}

// Latest per-step sampling preview (#374). Only one prompt executes at a time,
// so a single blob URL is kept; the previous one is revoked when replaced.
let _preview = null; // { url, nodeId, promptId }

function setPreview(next) {
    if (_preview) URL.revokeObjectURL(_preview.url);
    _preview = next;
    renderResults();
}

// { url, comboKey } while `node` is sampling, else null. comboKey is the
// running batch combination ("" for a plain run). Previews of a batch queued
// from another workflow are not shown.
export function getLivePreview(node) {
    if (!_preview || _preview.nodeId !== String(node.id)) return null;
    const idx = _activeBatch.promptIds.indexOf(_preview.promptId);
    if (idx >= 0 && _activeBatch.state !== activeState()) return null;
    return { url: _preview.url, comboKey: idx >= 0 ? _activeBatch.comboKeys[idx] : "" };
}

// FlakeGenerate shows its sampling previews itself; keep core from also drawing
// them on the node (#380). Registered at module load, i.e. before core's own
// listener (extensions load before the app adds its api handlers), so stopping
// propagation here hides the event from it.
_resolveComfyApi()?.addEventListener("b_preview_with_metadata", (e) => {
    const { blob, displayNodeId, jobId } = e.detail;
    if (!GENERATE_TYPES.includes(app.graph?.getNodeById(displayNodeId)?.type)) return;
    e.stopImmediatePropagation();
    setPreview({ url: URL.createObjectURL(blob), nodeId: String(displayNodeId), promptId: jobId });
});

// ComfyUI sends no sampling previews when the Live preview setting is
// "default" and the server runs without --preview-method (#380).
let _serverPreviewDefault = null;
function serverPreviewDefault() {
    _serverPreviewDefault ??= fetch("/flakes/preview_default").then(r => r.json()).then(d => d.method).catch(() => null);
    return _serverPreviewDefault;
}

// Set by setupBatchTracking while a batch runs; called with each prompt the
// batch loop queues.
let _onBatchPromptQueued = null;

// api.queuePrompt stays wrapped for the session: prompts with a FlakeGenerate
// get previews unless the user or the server chose a method, and batch prompts
// report their prompt_id (app.queuePrompt in current frontends returns void;
// api.queuePrompt returns the {prompt_id, number, node_errors} REST response).
function installQueuePromptWrapper(comfyApi) {
    const origQueuePrompt = comfyApi.queuePrompt.bind(comfyApi);
    comfyApi.queuePrompt = async function(number, data, opts) {
        // Snapshot the combo key/index now — they may already be cleared by
        // the time the awaits below resolve.
        const comboKey = _currentBatchComboKey;
        const comboIndex = _currentComboIndex;
        if ((!opts?.previewMethod || opts.previewMethod === "default")
            && Object.values(data?.output || {}).some(n => GENERATE_TYPES.includes(n?.class_type))
            && await serverPreviewDefault() === "none") {
            opts = { ...opts, previewMethod: "auto" };
        }
        const result = await origQueuePrompt(number, data, opts);
        if (result?.prompt_id && comboKey !== null) _onBatchPromptQueued?.(result.prompt_id, comboKey, comboIndex);
        return result;
    };
}

app.registerExtension({
    name: "comfyui-flakes.BatchState",
    setup() {
        const comfyApi = _resolveComfyApi();
        if (!comfyApi) return;
        installQueuePromptWrapper(comfyApi);
        // The node's result replaces its preview; a finished, interrupted or
        // superseded prompt drops it.
        comfyApi.addEventListener("executed", ({ detail }) => {
            if (_preview && String(detail.display_node || detail.node) === _preview.nodeId) setPreview(null);
        });
        const dropForPrompt = (e) => { if (_preview && getPromptIdFromEvent(e) === _preview.promptId) setPreview(null); };
        comfyApi.addEventListener("execution_success", dropForPrompt);
        comfyApi.addEventListener("execution_error", dropForPrompt);
        comfyApi.addEventListener("execution_interrupted", dropForPrompt);
        comfyApi.addEventListener("execution_start", (e) => { if (_preview && getPromptIdFromEvent(e) !== _preview.promptId) setPreview(null); });
        comfyApi.addEventListener("reconnected", () => { if (_preview) setPreview(null); });
    },
    // The workflow store switches the active workflow only after the new
    // graph's nodes are configured, so re-read the store once loading is complete.
    afterLoadGraph() {
        renderHighlights(activeState());
        renderResults();
    },
});

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
const _activeBatch = { promptIds: [], comboKeys: [], runningPromptId: null, state: null };
export function getActiveBatch() {
    return _activeBatch;
}

function setupBatchTracking(state, combinations, comboKeys) {
    const comfyApi = _resolveComfyApi();
    if (!comfyApi || typeof comfyApi.addEventListener !== "function" || combinations.length === 0) {
        if (!comfyApi) {
            // eslint-disable-next-line no-console
            console.warn("[flakes] could not resolve ComfyUI api singleton; combo highlight/per-combo image storage disabled.");
        }
        return null;
    }
    const jobs = state.total;

    const promptIds = []; // queue order
    const comboIndexByPrompt = []; // parallel to promptIds: the combination index (#348)
    const done = new Set(); // finished prompt ids (events and /history backfill may both report one)
    let closed = false;
    _activeBatch.state = state;

    // Pending event buffer: websocket events for a prompt_id can arrive BEFORE
    // the REST response that gives us that prompt_id (different transport
    // channels). Buffer events we don't yet know about and replay them when
    // the patched api.queuePrompt finally registers the id. Without this, the
    // first generation in a batch consistently lost its execution_start /
    // executed events (#241).
    const pendingByPid = new Map(); // promptId -> [{type, e}]
    function applyEventForKnownPid(type, e, pid) {
        if (type === "execution_start") {
            setRunning(pid);
        } else if (type === "execution_success" || type === "execution_error" || type === "execution_interrupted") {
            markDone(pid);
        } else if (type === "executed") {
            handleOutput(pid, e.detail.display_node || e.detail.node, e.detail.output);
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

    // The api.queuePrompt wrapper reports each prompt_id the batch loop queues.
    _onBatchPromptQueued = (pid, comboKey, comboIndex) => {
        promptIds.push(pid);
        comboIndexByPrompt.push(comboIndex ?? 0);
        comboKeys.push(comboKey);
        _activeBatch.promptIds.push(pid);
        _activeBatch.comboKeys.push(comboKey);
        // Replay any websocket events that arrived before this push.
        flushPendingFor(pid);
    };

    function setRunning(pid) {
        const idx = promptIds.indexOf(pid);
        if (idx < 0) return;
        _activeBatch.runningPromptId = pid;
        state.generating = {};
        for (const item of combinations[comboIndexByPrompt[idx]]) {
            // stack_variant items have no node-level highlight (#343).
            if (item.type === "combo" || item.type === "model_combo") state.generating[item.node.id] = item.uid;
        }
        renderHighlights(state);
    }

    function markDone(pid) {
        if (!promptIds.includes(pid) || done.has(pid)) return;
        done.add(pid);
        state.completed = done.size;
        if (done.size >= jobs && _batchCleanup === cleanup) {
            _batchCleanup();
            _batchCleanup = null;
        }
    }

    // A FlakeGenerate output (from the `executed` event or /history): store
    // its images (or FlakeGenerateAnimation's videos) by the prompt's comboKey
    // under the producing node's id.
    function handleOutput(pid, nodeId, output) {
        const idx = promptIds.indexOf(pid);
        const images = output?.flake_images || output?.flake_videos;
        if (idx < 0 || !Array.isArray(images) || images.length === 0) return;
        const comboKey = comboKeys[idx] ?? "";
        const entry = state.images[nodeId] || (state.images[nodeId] = { combo: {}, ad: {}, ab: false, last: null, lastKey: null });
        entry.combo[comboKey] = images[0];
        entry.last = images[0];
        entry.lastKey = comboKey;
        const adImages = output.flake_images_ad;
        if (Array.isArray(output.adetailer_ab) && output.adetailer_ab.length > 0 && Array.isArray(adImages) && adImages.length > 0) {
            entry.ad[comboKey] = adImages[0];
            entry.ab = true;
        }
        renderResults();
    }

    // Websocket events are lost while the socket is down (background tabs,
    // reconnects): recover finished prompts from /history and the running one
    // from /queue. Prompts gone from both were deleted from the queue.
    async function backfill() {
        if (closed) return;
        const queue = await (await comfyApi.fetchApi("/queue")).json();
        if (closed) return;
        const queued = new Set([...queue.queue_running, ...queue.queue_pending].map(q => q[1]));
        for (const pid of promptIds.slice()) {
            if (done.has(pid) || queued.has(pid)) continue;
            const history = (await (await comfyApi.fetchApi(`/history/${pid}`)).json())[pid];
            if (closed) return;
            for (const [nodeId, output] of Object.entries(history?.outputs || {})) handleOutput(pid, nodeId, output);
            markDone(pid);
        }
        const running = queue.queue_running[0]?.[1];
        if (running && !closed) setRunning(running);
    }

    // All websocket lifecycle/output events route through bufferOrApply so
    // events arriving before their prompt_id is registered get queued.
    const onExecStart = (e) => bufferOrApply("execution_start", e);
    const onExecSuccess = (e) => bufferOrApply("execution_success", e);
    const onExecError = (e) => bufferOrApply("execution_error", e);
    const onExecInterrupted = (e) => bufferOrApply("execution_interrupted", e);
    const onExecuted = (e) => bufferOrApply("executed", e);
    const onVisibility = () => { if (document.visibilityState === "visible") backfill(); };

    comfyApi.addEventListener("execution_start", onExecStart);
    comfyApi.addEventListener("execution_success", onExecSuccess);
    comfyApi.addEventListener("execution_error", onExecError);
    comfyApi.addEventListener("execution_interrupted", onExecInterrupted);
    comfyApi.addEventListener("executed", onExecuted);
    comfyApi.addEventListener("reconnected", backfill);
    document.addEventListener("visibilitychange", onVisibility);

    function cleanup() {
        closed = true;
        comfyApi.removeEventListener("execution_start", onExecStart);
        comfyApi.removeEventListener("execution_success", onExecSuccess);
        comfyApi.removeEventListener("execution_error", onExecError);
        comfyApi.removeEventListener("execution_interrupted", onExecInterrupted);
        comfyApi.removeEventListener("executed", onExecuted);
        comfyApi.removeEventListener("reconnected", backfill);
        document.removeEventListener("visibilitychange", onVisibility);
        _onBatchPromptQueued = null;
        _currentBatchComboKey = null;
        _activeBatch.promptIds = [];
        _activeBatch.comboKeys = [];
        _activeBatch.runningPromptId = null;
        _activeBatch.state = null;
        pendingByPid.clear();
        state.generating = {};
        renderHighlights(state);
    }

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
    const isCombo = (n) => FLAKE_COMBO_TYPES.includes(n.type) || MODEL_COMBO_TYPES.includes(n.type);
    const ordered = [];
    const seen = new Set();
    for (const gen of app.graph.nodes) {
        if (!GENERATE_TYPES.includes(gen.type)) continue;
        const fdInput = gen.inputs?.find(i => i.name === "flake_data" || i.name === "flake_anim_data");
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
        if (!STACK_TYPES.includes(node.type) || node.mode === 2 || node.mode === 4) continue;
        for (const { flake, index } of stackAllVariantsFlakes(node)) {
            const meta = await fetchFlakeMeta(flake.name);
            const combos = enumerateVariantCombos(meta);
            if (combos.length <= 1) continue;
            stackAxes.push(combos.map((variant) => ({
                node, type: "stack_variant", flakeIndex: index, value: variant, vkey: `s${index}.${variantKey(variant)}`,
            })));
        }
        const imageJobs = stackImageJobs(node);
        if (imageJobs.length) {
            stackAxes.push(imageJobs.map(({ index, image, key }) => ({
                node, type: "stack_image", flakeIndex: index, value: image, vkey: key,
            })));
        }
    }

    if (orderedNodes.length === 0 && stackAxes.length === 0) {
        // A plain run supersedes this workflow's finished batch results.
        const state = activeState();
        if (state && state.completed >= state.total) _batchStates.delete(activeWorkflow());
        return _originalQueuePrompt.call(this, number, batchCount);
    }

    const optionsArrays = [];

    for (const node of orderedNodes) {
        if (FLAKE_COMBO_TYPES.includes(node.type)) {
            const flakes = getComboFlakes(node);
            if (flakes.length === 0) {
                window.alert(`${node.type} node has no flakes selected.`);
                return;
            }
            const activeFlakes = flakes.filter(flake => !flake.bypassed);
            if (activeFlakes.length === 0) {
                window.alert(`${node.type} node has no active (non-bypassed) flakes.`);
                return;
            }
            // Expand "All Variants" flakes into one axis item per variant combo,
            // "Multiple" choices into one per checked choice (#406); ordinary
            // flakes stay a single item. vkey keeps each combo's comboKey
            // unique (#343). Each splits again per input image (#441), the
            // job's entry carrying it as `image`.
            const comboItems = [];
            for (const flake of activeFlakes) {
                const uid = flake._uid;
                const variants = flake._all_variants ? enumerateVariantCombos(await fetchFlakeMeta(flake.name)) : expandEntryVariants(flake);
                const split = flake._all_variants || variants.length > 1;
                for (const variant of variants) {
                    const value = split ? { ...flake, variant } : flake;
                    for (const { image, key } of itemImageJobs(flake, split ? `${uid}.${variantKey(variant)}` : uid)) {
                        comboItems.push({ node, type: "combo", value: image ? { ...value, image } : value, uid, vkey: key });
                    }
                }
            }
            optionsArrays.push(comboItems);
        } else {
            const presets = getComboPresets(node);
            if (presets.length === 0) {
                window.alert(`${node.type} node has no presets selected.`);
                return;
            }
            const bypassed = new Set(node.properties?._combo_bypassed || []);
            const activePresets = presets
                .map((preset, i) => ({ preset, i }))
                .filter(({ preset }) => !bypassed.has(preset));
            if (activePresets.length === 0) {
                window.alert(`${node.type} node has no active (non-bypassed) presets.`);
                return;
            }
            // index picks the preset's overrides when its combination is queued.
            const uids = node.properties._combo_uids;
            optionsArrays.push(activePresets.map(({ preset, i }) => ({
                node,
                type: "model_combo",
                value: preset,
                index: i,
                uid: uids[i],
                vkey: uids[i],
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
            if (item.type === "combo" || item.type === "stack_variant" || item.type === "stack_image") {
                // All mutate the node's flakes_json; save it once to restore later.
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

    const flakeGenerateNodes = app.graph.nodes.filter(n => GENERATE_TYPES.includes(n.type));

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

    // Fresh state for this workflow: the "[i/N] done" label restarts at "[0/N]"
    // (#227) and the previous batch's results are dropped.
    const state = { generating: {}, images: {}, completed: 0, total: totalJobs };
    _batchStates.set(activeWorkflow(), state);
    for (const n of flakeGenerateNodes) {
        n.properties._images_by_combo = {};
        n.properties._images_by_combo_ad = {};
        n.properties._adetailer_ab = false;
    }
    renderResults();

    const comboKeys = []; // parallel to promptIds; comboKeys[idx] = key for promptIds[idx]
    const tracker = setupBatchTracking(state, combinations, comboKeys);
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
                } else if (item.type === "stack_image") {
                    // This job's input image goes on its item only; the previous
                    // job's is cleared (#441).
                    const w = item.node.widgets?.find(w => w.name === "flakes_json");
                    if (w) {
                        let arr; try { arr = JSON.parse(w.value || "[]"); } catch { arr = []; }
                        arr.forEach((e, i) => { e.image = i === item.flakeIndex ? item.value : undefined; });
                        w.value = JSON.stringify(arr);
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
                .map(it => [it.node.id, it.vkey])
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
    }
};
