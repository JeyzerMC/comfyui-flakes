import { css } from "../utils.js";
import { openOverlay } from "../modal.js";
import { fetchFlake, fetchPreset, getCoverUrl, getVariantImageUrl } from "../api.js";
import { getActiveBatch } from "../queue.js";

// Parse a comboKey like "12:0|7:2" into a list of [nodeId, itemIdx] pairs.
function parseComboKey(key) {
    if (!key) return [];
    return key.split("|").map(pair => {
        const [n, i] = pair.split(":").map(Number);
        return [n, i];
    });
}

// Resolve the ComfyUI api singleton (same pattern as queue.js).
function _resolveComfyApi() {
    return (
        window.comfyAPI?.api?.api
        || window.comfyAPI?.api
        || (typeof window !== "undefined" && window.app?.api)
        || null
    );
}

const ACCENT = "#4a9eff";

// ── Upstream chain ─────────────────────────────────────────────────────────
// Walk the flake_data input upstream from the Flake Generate node and collect,
// in pipeline order, every node that contributes generation data:
//   - FlakeModelPreset / FlakeModelCombo (terminal source)
//   - FlakeStack (common, non-combinatorial flakes)
//   - FlakeCombo (combinatorial flakes)
export function collectChain(startNode) {
    const chain = [];
    const visited = new Set();
    let current = startNode;
    while (current && !visited.has(current.id)) {
        visited.add(current.id);
        const t = current.type;
        if (t === "FlakeStack" || t === "FlakeCombo") {
            chain.push({ type: t, node: current });
            const fdInput = current.inputs?.find(i => i.name === "flake_data");
            if (!fdInput?.link) break;
            const link = current.graph?.links?.[fdInput.link];
            if (!link) break;
            current = current.graph?.getNodeById(link.origin_id);
        } else if (t === "FlakeModelPreset" || t === "FlakeModelCombo") {
            chain.push({ type: t, node: current });
            break;
        } else {
            break;
        }
    }
    return chain.reverse();
}

function activeEntries(node, type) {
    let entries;
    if (type === "FlakeCombo") {
        entries = node.properties?._combo_flakes || [];
    } else {
        const w = node.widgets?.find(w => w.name === "flakes_json");
        try { entries = JSON.parse(w?.value || "[]"); } catch { entries = []; }
    }
    if (!Array.isArray(entries)) return [];
    return entries.filter(e => !e.inline && !e.bypassed && e.name);
}

// Build the combo "axes" (one per Flake Model Combo / Flake Combo node) plus
// the fixed (non-combinatorial) preset and common-stack flakes.
export function buildModel(startNode) {
    const chain = collectChain(startNode);
    const axes = []; // [{ node, kind:'model'|'flake', label, items:[{label,name,coverUrl,...}] }]
    const fixed = { presetName: null, stackFlakes: [] };

    for (const { type, node } of chain) {
        if (type === "FlakeModelPreset") {
            const w = node.widgets?.find(w => w.name === "preset");
            const v = w?.value;
            if (v && v !== "Select a preset..." && v !== "No model preset is selected") {
                fixed.presetName = v;
            }
        } else if (type === "FlakeModelCombo") {
            const allPresets = node.properties?._combo_presets || [];
            const bypassed = new Set(node.properties?._combo_bypassed || []);
            // Keep each kept preset's ORIGINAL index within _combo_presets so the
            // overlay's combo key matches the key queue.js stamps (which uses the
            // original index). Filtering shifts positions otherwise (#268).
            const presets = allPresets
                .map((p, i) => ({ p, i }))
                .filter(({ p }) => !bypassed.has(p));
            if (presets.length === 0) continue;
            axes.push({
                node, kind: "model",
                label: "Model Preset",
                items: presets.map(({ p, i }) => ({
                    label: (node.properties?._combo_display_names?.[p]) || p.split(/[\/\\]+/).pop() || p,
                    presetName: p,
                    coverUrl: `/flakes/preset_cover?name=${encodeURIComponent(p)}`,
                    originalIndex: i,
                })),
            });
        } else if (type === "FlakeStack") {
            for (const e of activeEntries(node, "FlakeStack")) fixed.stackFlakes.push(e);
        } else if (type === "FlakeCombo") {
            // Preserve the ORIGINAL index within _combo_flakes (the array queue.js
            // iterates) so the overlay combo key aligns with the queued key (#268).
            const allFlakes = node.properties?._combo_flakes || [];
            const flakes = Array.isArray(allFlakes)
                ? allFlakes.map((e, i) => ({ e, i })).filter(({ e }) => !e.inline && !e.bypassed && e.name)
                : [];
            if (flakes.length === 0) continue;
            axes.push({
                node, kind: "flake",
                label: "Flake Combo",
                items: flakes.map(({ e, i }) => {
                    // #237: fall back to the flake's main cover image when no
                    // variant is selected (or when the variant image 404s —
                    // see card render where we probe-load below).
                    const variantSel = Object.entries(e.variant || {}).find(([, c]) => c);
                    const baseCover = getCoverUrl(e.name);
                    const variantCover = variantSel ? getVariantImageUrl(e.name, variantSel[0], variantSel[1]) : null;
                    const choices = Object.values(e.variant || {}).filter(Boolean);
                    const base = e.display_name || e.name.split("/").pop() || e.name;
                    return {
                        label: base + (choices.length ? ` (${choices.join(", ")})` : ""),
                        entry: e,
                        coverUrl: variantCover || baseCover,
                        baseCoverUrl: baseCover,
                        variantCoverUrl: variantCover,
                        originalIndex: i,
                    };
                }),
            });
        }
    }
    return { axes, fixed };
}

// ── k-d-tree composite image ───────────────────────────────────────────────
// Recursively partition a rectangle, alternating split axis, one leaf per
// image. The first image gets the larger leading half on each split.
function partition(x, y, w, h, urls, horizontal) {
    if (urls.length === 1) return [{ x, y, w, h, url: urls[0] }];
    const headCount = Math.ceil(urls.length / 2);
    const head = urls.slice(0, headCount);
    const tail = urls.slice(headCount);
    if (horizontal) {
        const hh = h * (headCount / urls.length);
        return [
            ...partition(x, y, w, hh, head, !horizontal),
            ...partition(x, y + hh, w, h - hh, tail, !horizontal),
        ];
    }
    const ww = w * (headCount / urls.length);
    return [
        ...partition(x, y, ww, h, head, !horizontal),
        ...partition(x + ww, y, w - ww, h, tail, !horizontal),
    ];
}

function buildComposite(urls, size = 256) {
    return new Promise((resolve) => {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#1a1a1a";
        ctx.fillRect(0, 0, size, size);
        if (urls.length === 0) { resolve(canvas.toDataURL()); return; }
        // For the 3-image case: top half = first, bottom split in two.
        const rects = urls.length === 3
            ? [
                { x: 0, y: 0, w: size, h: size / 2, url: urls[0] },
                { x: 0, y: size / 2, w: size / 2, h: size / 2, url: urls[1] },
                { x: size / 2, y: size / 2, w: size / 2, h: size / 2, url: urls[2] },
            ]
            : partition(0, 0, size, size, urls, true);
        let pending = rects.length;
        if (pending === 0) { resolve(canvas.toDataURL()); return; }
        for (const r of rects) {
            const img = new Image();
            img.onload = () => {
                // cover-fit
                const ar = img.width / img.height;
                const rar = r.w / r.h;
                let sx = 0, sy = 0, sw = img.width, sh = img.height;
                if (ar > rar) { sw = img.height * rar; sx = (img.width - sw) / 2; }
                else { sh = img.width / rar; sy = (img.height - sh) / 2; }
                ctx.drawImage(img, sx, sy, sw, sh, r.x, r.y, r.w, r.h);
                if (--pending === 0) resolve(canvas.toDataURL());
            };
            img.onerror = () => { if (--pending === 0) resolve(canvas.toDataURL()); };
            img.src = r.url;
        }
    });
}

// Convert a single flake entry into label/lora/prompt rows.
// If the host flake has a flake_link, also append the linked flake's effective
// rows (post-override) — #236. The effective variant/strength is derived
// from per-grid override > yaml default > linked flake's own default.
async function flakeEntryRows(entry) {
    const loraRows = [];
    const promptRows = [];
    let hostData = null;
    try {
        const d = await fetchFlake(entry.name);
        hostData = d;
        const label = entry.display_name || d.name || entry.name.split("/").pop() || entry.name;
        const choices = Object.values(entry.variant || {}).filter(Boolean);
        const vLabel = label + (choices.length ? ` (${choices.join(", ")})` : "");
        if (Array.isArray(d.loras)) {
            d.loras.forEach((lr, idx) => {
                const name = lr.name || `LoRA #${idx + 1}`;
                const path = lr.path || lr.name || "";
                const s = entry.loras?.[idx] ?? lr.strength ?? 1;
                loraRows.push([`${name} [${Number.isInteger(s) ? s : Number(s).toFixed(2)}]`, path]);
            });
        }
        const pos = ((d.prompt && d.prompt.positive) || "").trim();
        const neg = ((d.prompt && d.prompt.negative) || "").trim();
        if (pos) promptRows.push([`${vLabel} · Positive`, pos]);
        if (neg) promptRows.push([`${vLabel} · Negative`, neg]);
        for (const [g, c] of Object.entries(entry.variant || {})) {
            const v = d.variants?.[g]?.[c];
            if (v?.positive) promptRows.push([`${vLabel} · ${g} · Positive`, v.positive]);
            if (v?.negative) promptRows.push([`${vLabel} · ${g} · Negative`, v.negative]);
        }
    } catch { /* skip */ }

    // Linked flake surfacing.
    if (hostData?.flake_link?.target) {
        try {
            const linkTarget = hostData.flake_link.target;
            const link = hostData.flake_link;
            const ovr = entry.flake_link_override || {};
            const linked = await fetchFlake(linkTarget);
            const hostLabel = entry.display_name || hostData.name || entry.name.split("/").pop() || entry.name;
            const linkLabel = (linked.name || linkTarget).split("/").pop();
            const groupLabel = `${hostLabel} · linked: ${linkLabel}`;
            // Effective variant choices = grid override > yaml default.
            const effectiveVariant = { ...(link.variant || {}), ...(ovr.variant || {}) };
            const effChoices = Object.values(effectiveVariant).filter(Boolean);
            const linkChoiceSuffix = effChoices.length ? ` (${effChoices.join(", ")})` : "";
            // Linked LoRA rows with effective strengths.
            if (Array.isArray(linked.loras)) {
                linked.loras.forEach((lr, idx) => {
                    const name = lr.name || `LoRA #${idx + 1}`;
                    const path = lr.path || lr.name || "";
                    let s = ovr.lora_strengths?.[idx];
                    if (s === null || s === undefined) s = (link.lora_strengths || [])[idx];
                    if (s === null || s === undefined) s = lr.strength ?? 1;
                    loraRows.push([`[linked] ${name} [${Number.isInteger(s) ? s : Number(s).toFixed(2)}]`, path]);
                });
            }
            // Linked prompts
            const linkPos = ((linked.prompt && linked.prompt.positive) || "").trim();
            const linkNeg = ((linked.prompt && linked.prompt.negative) || "").trim();
            if (linkPos) promptRows.push([`${groupLabel}${linkChoiceSuffix} · Positive`, linkPos]);
            if (linkNeg) promptRows.push([`${groupLabel}${linkChoiceSuffix} · Negative`, linkNeg]);
            for (const [g, c] of Object.entries(effectiveVariant)) {
                if (!c) continue;
                const v = linked.variants?.[g]?.[c];
                if (v?.positive) promptRows.push([`${groupLabel} · ${g} · Positive`, v.positive]);
                if (v?.negative) promptRows.push([`${groupLabel} · ${g} · Negative`, v.negative]);
            }
        } catch { /* missing linked target — skip silently */ }
    }
    return { loraRows, promptRows };
}

// ── Per-combination data assembly ──────────────────────────────────────────
// Returns common (model preset + stack flakes) and combo (all combo-axis selected
// flakes) data buckets separately, so the overlay can show common on the right
// and ALL combo-axis data on the left (#228). The previous unified bucket was
// the root cause of combo data leaking into the right panel and second-combo
// data being dropped from the left panel.
async function combinationData(model, selection) {
    let presetName = model.fixed.presetName;
    model.axes.forEach((axis, i) => {
        if (axis.kind === "model") presetName = selection[i].presetName;
    });

    const out = {
        modelRows: [],
        commonLoraRows: [],
        commonPromptRows: [],
        comboLoraRows: [],
        comboPromptRows: [],
        coverUrls: [],
        dimensions: null,
        width: null,
        height: null,
    };

    if (presetName) {
        try {
            const d = await fetchPreset(presetName);
            const m = out.modelRows;
            if (d.checkpoint) m.push(["Checkpoint", d.checkpoint]);
            if (d.vae && d.vae !== "baked-in") m.push(["VAE", d.vae]);
            if (d.text_encoder && d.text_encoder !== "baked-in") m.push(["Text Encoder", d.text_encoder]);
            if (d.clip_skip) m.push(["Clip Skip", String(d.clip_skip)]);
            if (d.sampler) m.push(["Sampler", d.sampler]);
            if (d.scheduler) m.push(["Scheduler", d.scheduler]);
            if (d.cfg) m.push(["CFG", String(d.cfg)]);
            if (d.steps) m.push(["Steps", String(d.steps)]);
            if (d.width || d.height) {
                out.dimensions = `${d.width || "?"} × ${d.height || "?"}`;
                out.width = d.width || null;
                out.height = d.height || null;
            }
            const label = d.display_name || presetName.split("/").pop() || presetName;
            const pos = (d.prompt?.positive || "").trim();
            const neg = (d.prompt?.negative || "").trim();
            if (pos) out.commonPromptRows.push([`${label} · Positive (Model)`, pos]);
            if (neg) out.commonPromptRows.push([`${label} · Negative (Model)`, neg]);
        } catch { /* skip */ }
    }

    // Common: fixed stack flakes (Flake Stack contributions are shared across all combinations).
    for (const entry of model.fixed.stackFlakes) {
        const rows = await flakeEntryRows(entry);
        out.commonLoraRows.push(...rows.loraRows);
        out.commonPromptRows.push(...rows.promptRows);
    }

    // Combo: every flake-axis's currently-selected entry (multiple axes are
    // each rendered as their own block on the left panel).
    for (let i = 0; i < model.axes.length; i++) {
        const axis = model.axes[i];
        if (axis.kind !== "flake") continue;
        const entry = selection[i]?.entry;
        if (!entry) continue;
        const rows = await flakeEntryRows(entry);
        out.comboLoraRows.push(...rows.loraRows);
        out.comboPromptRows.push(...rows.promptRows);
    }

    // Cover urls for the composite = the selected combo item covers, in order.
    out.coverUrls = model.axes.map((_, i) => selection[i].coverUrl);
    return out;
}

// Stable, order-independent identity for a combination: each axis's node id
// paired with the selected item index, sorted by node id. Must match the key
// queue.js stamps onto FlakeGenerate at queue time.
export function combinationKeyFor(model, selIdx) {
    return model.axes
        .map((axis, i) => [axis.node.id, axis.items[selIdx[i]]?.originalIndex ?? selIdx[i]])
        .sort((a, b) => a[0] - b[0])
        .map(([id, idx]) => `${id}:${idx}`)
        .join("|");
}

// ── Overlay UI ─────────────────────────────────────────────────────────────
export function openGenerationDataOverlay(model, lastImagesByCombo, opts = {}) {
    const {
        lastImagesByComboAd = {},
        adetailerAB = false,
        adetailer = "Off",
        adetailerDenoise,
        adetailerSteps,
        adetailerBbox,
        upscale = false,
        upscaleModel,
        upscaleFactor,
    } = opts;
    let { content, footer, close } = openOverlay();
    // Wider overlay (#324): give the right-hand image + data panel more room.
    css(content.parentElement, content.parentElement.style.cssText + "width:auto;max-width:min(1200px,85vw);min-width:0;");

    const header = document.createElement("div");
    css(header, "display:flex;align-items:center;gap:8px;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid #333;");
    const icon = document.createElement("span");
    icon.textContent = "📊";
    icon.style.fontSize = "18px";
    header.appendChild(icon);
    const title = document.createElement("span");
    title.textContent = "Generation Data";
    css(title, `font-size:15px;font-weight:600;color:${ACCENT};`);
    header.appendChild(title);
    content.appendChild(header);

    if (model.axes.length === 0 && !model.fixed.presetName && model.fixed.stackFlakes.length === 0) {
        const empty = document.createElement("div");
        css(empty, "font-size:13px;color:#555;text-align:center;padding:40px;");
        empty.textContent = "No generation data available";
        content.appendChild(empty);
        const cb = document.createElement("button");
        cb.textContent = "Close";
        css(cb, "padding:6px 18px;background:#333;color:#ddd;border:1px solid #555;border-radius:6px;cursor:pointer;font-size:13px;");
        cb.addEventListener("click", () => close());
        footer.appendChild(cb);
        return;
    }

    const hasCombos = model.axes.some(a => a.items.length > 1);

    if (hasCombos) {
        const split = document.createElement("div");
        css(split, "display:flex;gap:8px;align-items:flex-start;");
        content.appendChild(split);

        // Left third: combo axis grids + combo-specific fields below
        const left = document.createElement("div");
        css(left, "flex:0 0 33%;display:flex;flex-direction:column;gap:12px;min-width:0;max-height:65vh;overflow:auto;");
        // Right two-thirds: composite image + common data sections
        const right = document.createElement("div");
        css(right, "flex:1;display:flex;flex-direction:column;gap:10px;min-width:0;max-height:65vh;overflow:auto;");
        split.appendChild(left);
        split.appendChild(right);

        // selection state: index per axis
        const selIdx = model.axes.map(() => 0);

        function currentSelection() {
            return model.axes.map((axis, i) => axis.items[selIdx[i]]);
        }

        const cards = []; // per-axis: array of card elements (to update selected ring)

        // Left: combo axis grids
        model.axes.forEach((axis, ai) => {
            const section = document.createElement("div");
            const lbl = document.createElement("div");
            lbl.textContent = axis.label;
            css(lbl, "font-size:11px;font-weight:600;color:#aaa;margin-bottom:4px;");
            section.appendChild(lbl);

            const scroll = document.createElement("div");
            css(scroll, "display:flex;flex-wrap:wrap;gap:6px;padding-bottom:4px;");
            const axisCards = [];
            axis.items.forEach((item, ii) => {
                const card = document.createElement("div");
                card.dataset.nodeId = String(axis.node.id);
                // Use the original index so progress-bar matching against the
                // queued comboKey (original indices) aligns (#268).
                card.dataset.itemIdx = String(item.originalIndex ?? ii);
                css(card, `position:relative;flex:0 0 auto;width:72px;height:80px;border-radius:4px;cursor:pointer;background:#2a2a2a;background-size:cover;background-position:center;border:2px solid ${ii === selIdx[ai] ? ACCENT : "transparent"};box-sizing:border-box;`);
                // #237: probe-load variant image and fall back to base cover if 404,
                // matching the flake-combo node grid behavior. Without this the
                // card showed no image when a missing variant choice image was
                // selected.
                if (item.variantCoverUrl) {
                    const probe = new Image();
                    probe.onload = () => { card.style.backgroundImage = `url(${item.variantCoverUrl})`; };
                    probe.onerror = () => {
                        if (item.baseCoverUrl) card.style.backgroundImage = `url(${item.baseCoverUrl})`;
                    };
                    probe.src = item.variantCoverUrl;
                    // Show base immediately while probe resolves so there's
                    // never an empty cell.
                    if (item.baseCoverUrl) card.style.backgroundImage = `url(${item.baseCoverUrl})`;
                } else if (item.coverUrl) {
                    card.style.backgroundImage = `url(${item.coverUrl})`;
                }
                // Progress bar (above the caption) — shown while the active
                // batch's running prompt includes this (nodeId, itemIdx) pair.
                const progressTrack = document.createElement("div");
                css(progressTrack, "position:absolute;left:2px;right:2px;bottom:14px;height:3px;background:rgba(0,0,0,0.55);border-radius:2px;overflow:hidden;display:none;");
                const progressFill = document.createElement("div");
                css(progressFill, `height:100%;width:0%;background:${ACCENT};transition:width 0.15s ease;`);
                progressTrack.appendChild(progressFill);
                card.appendChild(progressTrack);
                card._progressTrack = progressTrack;
                card._progressFill = progressFill;

                const cap = document.createElement("div");
                cap.textContent = item.label;
                cap.title = item.label;
                css(cap, "position:absolute;left:0;right:0;bottom:0;font-size:9px;color:#fff;background:rgba(0,0,0,0.6);padding:1px 3px;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-radius:0 0 2px 2px;");
                card.appendChild(cap);
                card.addEventListener("click", () => {
                    selIdx[ai] = ii;
                    axisCards.forEach((c, k) => { c.style.borderColor = k === ii ? ACCENT : "transparent"; });
                    refreshRight();
                });
                axisCards.push(card);
                scroll.appendChild(card);
            });
            cards.push(axisCards);
            section.appendChild(scroll);
            left.appendChild(section);
        });

        // Left: combo-specific fields container (below grids)
        const leftDataWrap = document.createElement("div");
        css(leftDataWrap, "display:flex;flex-direction:column;gap:10px;");
        left.appendChild(leftDataWrap);

        // ── Progress bars on combo grid items (#230) ──
        // Walk through every card and update its progress track based on the
        // currently-running prompt (mapped to combo via queue.js's _activeBatch).
        function findCardsForRunningCombo() {
            const batch = getActiveBatch();
            const pid = batch.runningPromptId;
            if (!pid) return [];
            const idx = batch.promptIds.indexOf(pid);
            if (idx < 0) return [];
            const key = batch.comboKeys[idx];
            const pairs = parseComboKey(key);
            const out = [];
            for (const [nodeId, itemIdx] of pairs) {
                for (const axisCards of cards) {
                    for (const c of axisCards) {
                        if (Number(c.dataset.nodeId) === nodeId && Number(c.dataset.itemIdx) === itemIdx) {
                            out.push(c);
                        }
                    }
                }
            }
            return out;
        }
        function clearAllProgress() {
            for (const axisCards of cards) {
                for (const c of axisCards) {
                    if (c._progressTrack) c._progressTrack.style.display = "none";
                    if (c._progressFill) c._progressFill.style.width = "0%";
                }
            }
        }
        const _progressApi = _resolveComfyApi();
        const onProgress = (e) => {
            const detail = e?.detail || {};
            const value = detail.value ?? 0;
            const max = detail.max ?? 1;
            const pct = Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100));
            const activeCards = findCardsForRunningCombo();
            if (activeCards.length === 0) return;
            for (const axisCards of cards) {
                for (const c of axisCards) {
                    if (activeCards.includes(c)) {
                        c._progressTrack.style.display = "block";
                        c._progressFill.style.width = `${pct}%`;
                    } else {
                        c._progressTrack.style.display = "none";
                        c._progressFill.style.width = "0%";
                    }
                }
            }
        };
        const onExecDoneForProgress = () => clearAllProgress();
        if (_progressApi && typeof _progressApi.addEventListener === "function") {
            _progressApi.addEventListener("progress", onProgress);
            _progressApi.addEventListener("execution_success", onExecDoneForProgress);
            _progressApi.addEventListener("execution_error", onExecDoneForProgress);
            _progressApi.addEventListener("execution_interrupted", onExecDoneForProgress);
        }
        // Late-open seed (#241): if a batch is already in flight when the
        // overlay opens, immediately mark the running combo's grid cards so the
        // progress bar appears at "indeterminate / 0%" even before the next
        // progress event arrives. Once a progress event fires, onProgress
        // refines the width.
        (function seedFromActiveBatch() {
            const batch = getActiveBatch();
            if (!batch.runningPromptId) return;
            const activeCards = findCardsForRunningCombo();
            for (const c of activeCards) {
                if (c._progressTrack) c._progressTrack.style.display = "block";
                // Leave width at 0% — onProgress will fill it in.
            }
        })();
        // Tear down the listeners when the overlay closes.
        const _origClose = close;
        close = function(...args) {
            if (_progressApi && typeof _progressApi.removeEventListener === "function") {
                _progressApi.removeEventListener("progress", onProgress);
                _progressApi.removeEventListener("execution_success", onExecDoneForProgress);
                _progressApi.removeEventListener("execution_error", onExecDoneForProgress);
                _progressApi.removeEventListener("execution_interrupted", onExecDoneForProgress);
            }
            return _origClose(...args);
        };

        // Right: composite image + common data sections
        const compositeWrap = document.createElement("div");
        css(compositeWrap, "display:flex;flex-direction:column;align-items:center;gap:4px;width:100%;box-sizing:border-box;padding:0 4px;");
        const compositeImg = document.createElement("img");
        // Aspect ratio is set per-combination in refreshRight (#231); start at
        // a 1:1 placeholder while data loads.
        css(compositeImg, "width:100%;height:auto;aspect-ratio:1/1;object-fit:contain;border-radius:6px;border:1px solid #333;background:#1a1a1a;");
        const compositeLabel = document.createElement("div");
        css(compositeLabel, "font-size:11px;color:#888;text-align:center;");
        const compositeDimensions = document.createElement("div");
        css(compositeDimensions, "font-size:10px;color:#666;text-align:center;");
        const adToggleWrap = document.createElement("div");
        css(adToggleWrap, "display:flex;align-items:center;gap:8px;font-size:12px;color:#ddd;");
        compositeWrap.appendChild(compositeImg);
        compositeWrap.appendChild(compositeLabel);
        compositeWrap.appendChild(compositeDimensions);
        compositeWrap.appendChild(adToggleWrap);
        right.appendChild(compositeWrap);
        function applyAspectRatio(w, h) {
            if (!w || !h) return;
            // Full-width image (#339): the panel sets the width; height follows the
            // output aspect ratio.
            compositeImg.style.aspectRatio = `${w} / ${h}`;
        }

        const dataWrap = document.createElement("div");
        css(dataWrap, "display:flex;flex-direction:column;gap:10px;");
        right.appendChild(dataWrap);

        function section(titleText, rows) {
            if (!rows.length) return null;
            const wrap = document.createElement("div");
            const h = document.createElement("div");
            h.textContent = titleText;
            css(h, `font-size:11px;font-weight:600;color:${ACCENT};margin-bottom:6px;`);
            wrap.appendChild(h);
            const list = document.createElement("div");
            css(list, "display:flex;flex-wrap:wrap;gap:6px;");
            for (const [k, v] of rows) {
                const row = document.createElement("div");
                css(row, "background:#181818;border:1px solid #333;border-radius:6px;padding:6px 8px;flex:0 0 auto;min-width:0;max-width:100%;box-sizing:border-box;");
                const ke = document.createElement("div");
                ke.textContent = k;
                css(ke, "font-size:10px;color:#888;margin-bottom:2px;");
                const ve = document.createElement("div");
                ve.textContent = typeof v === "string" ? v : String(v);
                css(ve, "font-size:12px;color:#ddd;word-break:break-word;white-space:pre-wrap;");
                row.appendChild(ke);
                row.appendChild(ve);
                list.appendChild(row);
            }
            wrap.appendChild(list);
            return wrap;
        }

        let refreshToken = 0;
        async function refreshRight() {
            const token = ++refreshToken;
            const sel = currentSelection();
            const key = combinationKeyFor(model, selIdx);
            const data = await combinationData(model, sel);
            if (token !== refreshToken) return;

            // Match the preview aspect ratio to the output's resolution (#231).
            applyAspectRatio(data.width, data.height);

            // Composite (or generated output if we have one for this combination)
            const generated = showAd
                ? (lastImagesByComboAd && lastImagesByComboAd[key])
                : (lastImagesByCombo && lastImagesByCombo[key]);
            if (generated) {
                compositeImg.src = `/view?filename=${encodeURIComponent(generated.filename)}&type=${generated.type || "output"}&subfolder=${encodeURIComponent(generated.subfolder || "")}`;
                const sub = (generated.subfolder || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
                compositeLabel.textContent = sub ? `${sub}/${generated.filename}` : generated.filename;
            } else {
                compositeLabel.textContent = "No image generated yet";
                const urls = data.coverUrls.length ? data.coverUrls : (model.fixed.presetName ? [`/flakes/preset_cover?name=${encodeURIComponent(model.fixed.presetName)}`] : []);
                compositeImg.src = await buildComposite(urls);
            }
            compositeDimensions.textContent = data.dimensions || "";

            // Right panel: common data only (Model Preset + Flake Stack).
            // Combo-axis data lives exclusively on the left (#228).
            dataWrap.replaceChildren();
            const s1 = section("Model", data.modelRows);
            const s2 = section("LoRAs", data.commonLoraRows);
            const s3 = section("Prompts", data.commonPromptRows);
            const s4 = section("Generation settings", extraInfoRows());
            for (const s of [s1, s2, s3, s4]) if (s) dataWrap.appendChild(s);
            if (!s1 && !s2 && !s3 && !s4) {
                const empty = document.createElement("div");
                css(empty, "font-size:12px;color:#555;text-align:center;padding:20px;");
                empty.textContent = "No data for this combination";
                dataWrap.appendChild(empty);
            }

            // Left panel below grids: combo-axis-specific data (all flake-axis
            // selected entries, not just the first — that was the #228 bug).
            leftDataWrap.replaceChildren();
            const cs1 = section("LoRAs", data.comboLoraRows);
            const cs2 = section("Prompts", data.comboPromptRows);
            if (cs1) leftDataWrap.appendChild(cs1);
            if (cs2) leftDataWrap.appendChild(cs2);
        }

        // ADetailer A/B toggle (#328): only visible when this run produced both
        // regular and ADetailer outputs. It switches the previewed image.
        let showAd = false;
        let adToggle = null;
        if (adetailerAB) {
            adToggle = document.createElement("label");
            css(adToggle, "display:flex;align-items:center;gap:6px;cursor:pointer;");
            const chk = document.createElement("input");
            chk.type = "checkbox";
            chk.checked = false;
            css(chk, "cursor:pointer;margin:0;");
            const span = document.createElement("span");
            span.textContent = "Show ADetailer output";
            adToggle.appendChild(chk);
            adToggle.appendChild(span);
            chk.addEventListener("change", () => {
                showAd = chk.checked;
                refreshRight();
            });
            adToggleWrap.appendChild(adToggle);
        }

        // Build extra info rows for ADetailer/Upscale settings (#324).
        function extraInfoRows() {
            const rows = [];
            if (adetailer !== "Off") {
                rows.push(["ADetailer", adetailer]);
                if (adetailerDenoise != null) rows.push(["ADetailer denoise", String(adetailerDenoise)]);
                if (adetailerSteps != null) rows.push(["ADetailer steps", String(adetailerSteps)]);
                if (adetailerBbox) rows.push(["ADetailer bbox", adetailerBbox]);
            }
            if (upscale) {
                rows.push(["Upscale", "On"]);
                if (upscaleModel) rows.push(["Upscale model", upscaleModel]);
                if (upscaleFactor != null) rows.push(["Upscale factor", String(upscaleFactor)]);
            }
            return rows;
        }

        refreshRight();
    } else {
        // No combo nodes: single centered panel
        const singleWrap = document.createElement("div");
        css(singleWrap, "display:flex;flex-direction:column;align-items:center;gap:10px;max-width:520px;margin:0 auto;max-height:60vh;overflow:auto;");
        content.appendChild(singleWrap);

        const compositeWrap = document.createElement("div");
        css(compositeWrap, "display:flex;flex-direction:column;align-items:center;gap:4px;width:100%;box-sizing:border-box;padding:0 4px;");
        const compositeImg = document.createElement("img");
        css(compositeImg, "width:100%;height:auto;aspect-ratio:1/1;object-fit:contain;border-radius:6px;border:1px solid #333;background:#1a1a1a;");
        const compositeLabel = document.createElement("div");
        css(compositeLabel, "font-size:11px;color:#888;text-align:center;");
        const compositeDimensions = document.createElement("div");
        css(compositeDimensions, "font-size:10px;color:#666;text-align:center;");
        const adToggleWrap = document.createElement("div");
        css(adToggleWrap, "display:flex;align-items:center;gap:8px;font-size:12px;color:#ddd;");
        compositeWrap.appendChild(compositeImg);
        compositeWrap.appendChild(compositeLabel);
        compositeWrap.appendChild(compositeDimensions);
        compositeWrap.appendChild(adToggleWrap);
        singleWrap.appendChild(compositeWrap);
        function applyAspectRatioSingle(w, h) {
            if (!w || !h) return;
            // Full-width image (#339): the panel sets the width; height follows the
            // output aspect ratio.
            compositeImg.style.aspectRatio = `${w} / ${h}`;
        }

        const dataWrap = document.createElement("div");
        css(dataWrap, "display:flex;flex-direction:column;gap:10px;width:100%;");
        singleWrap.appendChild(dataWrap);

        function section(titleText, rows) {
            if (!rows.length) return null;
            const wrap = document.createElement("div");
            const h = document.createElement("div");
            h.textContent = titleText;
            css(h, `font-size:11px;font-weight:600;color:${ACCENT};margin-bottom:6px;`);
            wrap.appendChild(h);
            const list = document.createElement("div");
            css(list, "display:flex;flex-wrap:wrap;gap:6px;");
            for (const [k, v] of rows) {
                const row = document.createElement("div");
                css(row, "background:#181818;border:1px solid #333;border-radius:6px;padding:6px 8px;flex:0 0 auto;min-width:0;max-width:100%;box-sizing:border-box;");
                const ke = document.createElement("div");
                ke.textContent = k;
                css(ke, "font-size:10px;color:#888;margin-bottom:2px;");
                const ve = document.createElement("div");
                ve.textContent = typeof v === "string" ? v : String(v);
                css(ve, "font-size:12px;color:#ddd;word-break:break-word;white-space:pre-wrap;");
                row.appendChild(ke);
                row.appendChild(ve);
                list.appendChild(row);
            }
            wrap.appendChild(list);
            return wrap;
        }

        // ADetailer A/B toggle (#328) for the single-panel path.
        let showAd = false;
        if (adetailerAB) {
            const adToggle = document.createElement("label");
            css(adToggle, "display:flex;align-items:center;gap:6px;cursor:pointer;");
            const chk = document.createElement("input");
            chk.type = "checkbox";
            chk.checked = false;
            css(chk, "cursor:pointer;margin:0;");
            const span = document.createElement("span");
            span.textContent = "Show ADetailer output";
            adToggle.appendChild(chk);
            adToggle.appendChild(span);
            chk.addEventListener("change", () => {
                showAd = chk.checked;
                refreshRight();
            });
            adToggleWrap.appendChild(adToggle);
        }

        // Extra info rows for ADetailer/Upscale settings (#324).
        function extraInfoRows() {
            const rows = [];
            if (adetailer !== "Off") {
                rows.push(["ADetailer", adetailer]);
                if (adetailerDenoise != null) rows.push(["ADetailer denoise", String(adetailerDenoise)]);
                if (adetailerSteps != null) rows.push(["ADetailer steps", String(adetailerSteps)]);
                if (adetailerBbox) rows.push(["ADetailer bbox", adetailerBbox]);
            }
            if (upscale) {
                rows.push(["Upscale", "On"]);
                if (upscaleModel) rows.push(["Upscale model", upscaleModel]);
                if (upscaleFactor != null) rows.push(["Upscale factor", String(upscaleFactor)]);
            }
            return rows;
        }

        let refreshToken = 0;
        async function refreshRight() {
            const token = ++refreshToken;
            // Even when no axis has multiple options, we may still have one or
            // more axes with a single item each (e.g. one preset, one combo
            // flake). combinationData needs an entry per axis, otherwise it
            // dereferences `undefined` and the composite image stays empty.
            const sel = model.axes.map(axis => axis.items[0]).filter(Boolean);
            const data = await combinationData(model, sel);
            if (token !== refreshToken) return;

            // Match the key flake-generate.js writes when there's no combo
            // (queue.js stamps an empty key in that case).
            const key = model.axes.length === 0
                ? ""
                : combinationKeyFor(model, model.axes.map(() => 0));
            applyAspectRatioSingle(data.width, data.height);
            const generated = showAd
                ? (lastImagesByComboAd && (lastImagesByComboAd[key] ?? lastImagesByComboAd[""]))
                : (lastImagesByCombo && (lastImagesByCombo[key] ?? lastImagesByCombo[""]));
            if (generated) {
                compositeImg.src = `/view?filename=${encodeURIComponent(generated.filename)}&type=${generated.type || "output"}&subfolder=${encodeURIComponent(generated.subfolder || "")}`;
                const sub = (generated.subfolder || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
                compositeLabel.textContent = sub ? `${sub}/${generated.filename}` : generated.filename;
            } else {
                compositeLabel.textContent = "No image generated yet";
                const urls = data.coverUrls.length ? data.coverUrls : (model.fixed.presetName ? [`/flakes/preset_cover?name=${encodeURIComponent(model.fixed.presetName)}`] : []);
                compositeImg.src = await buildComposite(urls);
            }
            compositeDimensions.textContent = data.dimensions || "";

            // Single panel: no left/right split, so merge common+combo data.
            dataWrap.replaceChildren();
            const s1 = section("Model", data.modelRows);
            const s2 = section("LoRAs", [...data.commonLoraRows, ...data.comboLoraRows]);
            const s3 = section("Prompts", [...data.commonPromptRows, ...data.comboPromptRows]);
            const s4 = section("Generation settings", extraInfoRows());
            for (const s of [s1, s2, s3, s4]) if (s) dataWrap.appendChild(s);
            if (!s1 && !s2 && !s3 && !s4) {
                const empty = document.createElement("div");
                css(empty, "font-size:12px;color:#555;text-align:center;padding:20px;");
                empty.textContent = "No data for this combination";
                dataWrap.appendChild(empty);
            }
        }

        refreshRight();
    }

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "Close";
    css(closeBtn, "padding:6px 18px;background:#333;color:#ddd;border:1px solid #555;border-radius:6px;cursor:pointer;font-size:13px;");
    closeBtn.addEventListener("click", () => close());
    footer.appendChild(closeBtn);
}
