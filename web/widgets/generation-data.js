import { css, effectiveVariant, expandEntryVariants, choiceFlakeLinks } from "../utils.js";
import { openOverlay } from "../modal.js";
import { fetchFlake, fetchPreset, getCoverUrl, getVariantImageUrl, fetchFlakeMeta, cachedVariantDefaults } from "../api.js";
import { getActiveBatch, subscribeBatch, variantKey } from "../queue.js";

// Cartesian product of a flake's variant groups ({group:[choices]}) -> one
// {group: choice} per combination (#345).
function variantCombos(meta) {
    const groups = Object.keys(meta || {}).filter(g => Array.isArray(meta[g]) && meta[g].length);
    let acc = [{}];
    for (const g of groups) {
        const next = [];
        for (const a of acc) for (const ch of meta[g]) next.push({ ...a, [g]: ch });
        acc = next;
    }
    return acc;
}

// Build one combo-axis card descriptor for a flake entry (#345). itemKey is the
// item part of the comboKey queue.js stamps for it (#383).
function makeFlakeCard(e, itemKey) {
    // #237: fall back to the flake's main cover image when no variant is selected
    // (or when the variant image 404s — see card render's probe-load).
    const variant = effectiveVariant(e.variant, cachedVariantDefaults(e.name));
    const variantSel = Object.entries(variant)[0];
    const baseCover = getCoverUrl(e.name);
    const variantCover = variantSel ? getVariantImageUrl(e.name, variantSel[0], variantSel[1]) : null;
    const choices = Object.values(variant);
    const base = e.display_name || e.name.split("/").pop() || e.name;
    return {
        label: base + (choices.length ? ` (${choices.join(", ")})` : ""),
        entry: e,
        coverUrl: variantCover || baseCover,
        baseCoverUrl: baseCover,
        variantCoverUrl: variantCover,
        itemKey,
    };
}

// Parse a comboKey like "12:k3x9a|7:p0d2q.hair=red" into [nodeId, itemKey] pairs.
function parseComboKey(key) {
    if (!key) return [];
    return key.split("|").map(pair => {
        const ci = pair.indexOf(":");
        return [Number(pair.slice(0, ci)), pair.slice(ci + 1)];
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

// Active flakes of a FlakeStack with their index in flakes_json.
function stackEntries(node) {
    const w = node.widgets?.find(w => w.name === "flakes_json");
    let entries;
    try { entries = JSON.parse(w?.value || "[]"); } catch { entries = []; }
    if (!Array.isArray(entries)) return [];
    return entries.map((e, i) => ({ e, i })).filter(({ e }) => !e.inline && !e.bypassed && e.name);
}

// Variant combinations of an "All Variants" flake, [] when its meta can't be read.
async function flakeVariantCombos(name) {
    try { return variantCombos(await fetchFlakeMeta(name)); } catch { return []; }
}

// Build the combo "axes" (one per Flake Model Combo / Flake Combo node) plus
// the fixed (non-combinatorial) preset and common-stack flakes.
export async function buildModel(startNode) {
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
            const uids = node.properties._combo_uids;
            const bypassed = new Set(node.properties?._combo_bypassed || []);
            const presets = allPresets
                .map((p, i) => ({ p, uid: uids[i] }))
                .filter(({ p }) => !bypassed.has(p));
            if (presets.length === 0) continue;
            axes.push({
                node, kind: "model",
                label: "Model Preset",
                items: presets.map(({ p, uid }) => ({
                    label: (node.properties?._combo_display_names?.[p]) || p.split(/[\/\\]+/).pop() || p,
                    presetName: p,
                    coverUrl: `/flakes/preset_cover?name=${encodeURIComponent(p)}`,
                    itemKey: uid,
                })),
            });
        } else if (type === "FlakeStack") {
            for (const { e, i } of stackEntries(node)) {
                // An "All Variants" stack flake is an axis of its own, like in
                // queue.js (#343).
                const combos = e._all_variants ? await flakeVariantCombos(e.name) : [];
                if (combos.length > 1) {
                    axes.push({
                        node, kind: "flake", label: "Flake Stack",
                        items: combos.map(variant => makeFlakeCard({ ...e, variant }, `s${i}.${variantKey(variant)}`)),
                    });
                } else {
                    fixed.stackFlakes.push(e);
                }
            }
        } else if (type === "FlakeCombo") {
            const allFlakes = node.properties?._combo_flakes || [];
            const flakes = Array.isArray(allFlakes) ? allFlakes.filter(e => !e.inline && !e.bypassed && e.name) : [];
            if (flakes.length === 0) continue;
            const items = [];
            for (const e of flakes) {
                // One card per variant combination (#345) or "Multiple" choice
                // (#406), like the queue.js expansion. The meta load also gives
                // the default variant choices the cards show (#388).
                await fetchFlakeMeta(e.name).catch(() => {});
                const combos = e._all_variants ? await flakeVariantCombos(e.name) : expandEntryVariants(e);
                if (combos.length > (e._all_variants ? 0 : 1)) {
                    for (const variant of combos) items.push(makeFlakeCard({ ...e, variant }, `${e._uid}.${variantKey(variant)}`));
                } else {
                    items.push(makeFlakeCard(e, e._uid));
                }
            }
            axes.push({ node, kind: "flake", label: "Flake Combo", items });
        }
    }
    return { axes, fixed };
}

// ── placeholder image ───────────────────────────────────────────────────────
// Seeded PRNG (FNV-1a hash of the key into mulberry32) so a combination's card
// layout is the same on every render.
function seededRandom(key) {
    let h = 2166136261;
    for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
    return () => {
        h = (h + 0x6D2B79F5) | 0;
        let t = Math.imul(h ^ (h >>> 15), 1 | h);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function loadImage(url) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = url;
    });
}

// First image of `urls` that loads, else null (#410).
async function loadFirstImage(urls) {
    for (const url of urls) {
        const img = await loadImage(url);
        if (img) return img;
    }
    return null;
}

// A flake's prompts: the `prompts:` list or the legacy single `prompt:` (#371).
function flakePrompts(d) {
    return Array.isArray(d.prompts) ? d.prompts : (d.prompt ? [d.prompt] : []);
}

// Placeholder for a combination with no output yet (#375): one card per selected
// cover, at the cover's own aspect ratio, scattered over a jittered grid that
// fills both axes of the canvas, with a rotation (±15°) and offset seeded by
// `seedKey` (#384). A missing cover is drawn as a plain card. The canvas has the
// `aspect` of the image box it fills (#411); its long side is DPR-aware
// (~1024 logical px × devicePixelRatio, capped at 2×) so it isn't blurred in
// the overlay (#354).
async function buildCardStack(urlLists, seedKey, aspect) {
    const long = Math.round(1024 * Math.min(window.devicePixelRatio || 1, 2));
    const cw = aspect >= 1 ? long : Math.round(long * aspect);
    const ch = aspect >= 1 ? Math.round(long / aspect) : long;
    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, 0, cw, ch);
    const images = await Promise.all(urlLists.map(loadFirstImage));
    const rand = seededRandom(seedKey);
    const n = images.length;
    const cols = Math.max(1, Math.min(n, Math.ceil(Math.sqrt(n * aspect))));
    const rows = Math.max(1, Math.ceil(n / cols));
    const cellW = cw / cols, cellH = ch / rows;
    const cardEdge = Math.min(cellW, cellH, ch * 0.7) * 0.8;
    const border = Math.max(2, Math.round(cardEdge * 0.035));
    images.forEach((img, i) => {
        const ar = img ? img.width / img.height : 3 / 4;
        const w = (ar >= 1 ? cardEdge : cardEdge * ar) + 2 * border;
        const h = (ar >= 1 ? cardEdge / ar : cardEdge) + 2 * border;
        const angle = (rand() * 2 - 1) * Math.PI / 12;
        const row = Math.floor(i / cols);
        // Center a partial last row.
        const inRow = Math.min(cols, n - row * cols);
        const x = ((cols - inRow) / 2 + (i % cols) + 0.5 + (rand() * 2 - 1) * 0.2) * cellW;
        const y = (row + 0.5 + (rand() * 2 - 1) * 0.2) * cellH;
        // Keep the rotated card inside the canvas when it fits.
        const ex = (w * Math.abs(Math.cos(angle)) + h * Math.abs(Math.sin(angle))) / 2;
        const ey = (w * Math.abs(Math.sin(angle)) + h * Math.abs(Math.cos(angle))) / 2;
        const clamp = (v, e, size) => (2 * e < size ? Math.min(Math.max(v, e), size - e) : size / 2);
        const cx = clamp(x, ex, cw);
        const cy = clamp(y, ey, ch);
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(angle);
        ctx.shadowColor = "rgba(0,0,0,0.55)";
        ctx.shadowBlur = cardEdge * 0.08;
        ctx.shadowOffsetY = cardEdge * 0.02;
        ctx.fillStyle = "#fff";
        ctx.fillRect(-w / 2, -h / 2, w, h);
        ctx.shadowColor = "transparent";
        ctx.fillStyle = "#2a2a2a";
        if (img) ctx.drawImage(img, -w / 2 + border, -h / 2 + border, w - 2 * border, h - 2 * border);
        else ctx.fillRect(-w / 2 + border, -h / 2 + border, w - 2 * border, h - 2 * border);
        ctx.restore();
    });
    return canvas.toDataURL();
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
        await fetchFlakeMeta(entry.name);
        const variant = effectiveVariant(entry.variant, cachedVariantDefaults(entry.name));
        const choices = Object.values(variant);
        const vLabel = label + (choices.length ? ` (${choices.join(", ")})` : "");
        if (Array.isArray(d.loras)) {
            d.loras.forEach((lr, idx) => {
                const name = lr.name || `LoRA #${idx + 1}`;
                const path = lr.path || lr.name || "";
                const s = entry.loras?.[idx] ?? lr.strength ?? 1;
                loraRows.push([`${name} [${Number.isInteger(s) ? s : Number(s).toFixed(2)}]`, path]);
            });
        }
        for (const p of flakePrompts(d)) {
            const pos = (p?.positive || "").trim();
            const neg = (p?.negative || "").trim();
            if (pos) promptRows.push([`${vLabel} · Positive`, pos]);
            if (neg) promptRows.push([`${vLabel} · Negative`, neg]);
        }
        for (const [g, c] of Object.entries(variant)) {
            const v = d.variants?.[g]?.[c];
            if (v?.positive) promptRows.push([`${vLabel} · ${g} · Positive`, v.positive]);
            if (v?.negative) promptRows.push([`${vLabel} · ${g} · Negative`, v.negative]);
            // Choice LoRAs with the grid item's strength overrides (#413).
            if (Array.isArray(v?.loras)) {
                v.loras.forEach((lr, idx) => {
                    const name = lr.name || `LoRA #${idx + 1}`;
                    const s = entry.variant_loras?.[g]?.[c]?.[idx] ?? lr.strength ?? 1;
                    loraRows.push([`${name} [${Number.isInteger(s) ? s : Number(s).toFixed(2)}]`, lr.path || lr.name || ""]);
                });
            }
        }
    } catch { /* skip */ }

    // Linked flake surfacing, one block per link (#234); the overrides mirror
    // flake_io._apply_flake_link.
    const links = hostData?.flake_links || (hostData?.flake_link ? [hostData.flake_link] : []);
    const linkOverrides = links.map((link, li) => [link, (Array.isArray(entry.flake_link_overrides) ? entry.flake_link_overrides[li] : li === 0 && entry.flake_link_override) || {}]);
    // Then the selected choices' links with their per-choice overrides (#420).
    for (const [g, c, cl] of choiceFlakeLinks(hostData?.variants, entry.variant)) {
        cl.forEach((link, li) => linkOverrides.push([link, entry.variant_link_overrides?.[g]?.[c]?.[li] || {}]));
    }
    for (const [link, ovr] of linkOverrides) {
        if (!link?.target) continue;
        try {
            const linkTarget = link.target;
            const linked = await fetchFlake(linkTarget);
            const hostLabel = entry.display_name || hostData.name || entry.name.split("/").pop() || entry.name;
            const linkLabel = (linked.name || linkTarget).split("/").pop();
            const groupLabel = `${hostLabel} · linked: ${linkLabel}`;
            // Effective variant choices = grid override > yaml link variant > linked flake's default.
            await fetchFlakeMeta(linkTarget);
            const linkVariant = effectiveVariant({ ...(link.variant || {}), ...(ovr.variant || {}) }, cachedVariantDefaults(linkTarget));
            const effChoices = Object.values(linkVariant);
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
            for (const p of flakePrompts(linked)) {
                const linkPos = (p?.positive || "").trim();
                const linkNeg = (p?.negative || "").trim();
                if (linkPos) promptRows.push([`${groupLabel}${linkChoiceSuffix} · Positive`, linkPos]);
                if (linkNeg) promptRows.push([`${groupLabel}${linkChoiceSuffix} · Negative`, linkNeg]);
            }
            for (const [g, c] of Object.entries(linkVariant)) {
                const v = linked.variants?.[g]?.[c];
                if (v?.positive) promptRows.push([`${groupLabel} · ${g} · Positive`, v.positive]);
                if (v?.negative) promptRows.push([`${groupLabel} · ${g} · Negative`, v.negative]);
                // Linked choice LoRAs: grid override > link yaml > choice yaml (#414).
                if (Array.isArray(v?.loras)) {
                    v.loras.forEach((lr, idx) => {
                        const name = lr.name || `LoRA #${idx + 1}`;
                        const s = ovr.variant_loras?.[g]?.[c]?.[idx] ?? link.variant_loras?.[g]?.[c]?.[idx] ?? lr.strength ?? 1;
                        loraRows.push([`[linked] ${name} [${Number.isInteger(s) ? s : Number(s).toFixed(2)}]`, lr.path || lr.name || ""]);
                    });
                }
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

    // Cover candidates per selected item, in order: the variant image then the
    // flake cover, since a variant choice may have no image (#410).
    out.coverUrls = model.axes.map((_, i) => {
        const it = selection[i];
        return (it.baseCoverUrl ? [it.variantCoverUrl, it.baseCoverUrl] : [it.coverUrl]).filter(Boolean);
    });
    return out;
}

// Stable, order-independent identity for a combination: each axis's node id
// paired with the selected item's key, sorted by node id. Must match the key
// queue.js stamps onto FlakeGenerate at queue time.
export function combinationKeyFor(model, selIdx) {
    return model.axes
        .map((axis, i) => [axis.node.id, axis.items[selIdx[i]].itemKey])
        .sort((a, b) => a[0] - b[0])
        .map(([id, vk]) => `${id}:${vk}`)
        .join("|");
}

// ── Overlay UI ─────────────────────────────────────────────────────────────
// getImages() returns the Flake Generate node's current per-combo results
// ({ combo, ad, ab }); it is re-read whenever batch state changes (#373).
export function openGenerationDataOverlay(model, getImages, opts = {}) {
    const {
        adetailer = "Off",
        adetailerDenoise,
        adetailerSteps,
        adetailerBbox,
        upscale = false,
        upscaleModel,
        upscaleFactor,
    } = opts;
    const { content, footer, close, handlers } = openOverlay();
    const adetailerAB = getImages().ab;
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
    // Fixed-height overlay; each panel is its own (only) scroller (#411).
    const box = content.parentElement;
    css(box, box.style.cssText + "height:85vh;width:min(1200px,85vw);max-width:none;");
    content.style.overflow = "hidden";

    // Fit Output Image in View (#390): on, the output is contain-fit in its box;
    // off, it shows at natural size and the box scrolls (#412).
    let fitOn = localStorage.getItem("flakes.overlayFitImage") !== "0";
    let onFitChange = () => {};
    const fitToggle = document.createElement("label");
    css(fitToggle, "display:flex;align-items:center;gap:6px;cursor:pointer;margin-left:auto;font-size:12px;color:#ddd;");
    const fitChk = document.createElement("input");
    fitChk.type = "checkbox";
    fitChk.checked = fitOn;
    css(fitChk, "cursor:pointer;margin:0;");
    const fitSpan = document.createElement("span");
    fitSpan.textContent = "Fit Output Image in View";
    fitToggle.appendChild(fitChk);
    fitToggle.appendChild(fitSpan);
    fitChk.addEventListener("change", () => {
        fitOn = fitChk.checked;
        localStorage.setItem("flakes.overlayFitImage", fitOn ? "1" : "0");
        onFitChange();
    });
    header.appendChild(fitToggle);
    // A landscape image widens the overlay to ~the screen width (#412); portrait,
    // square and unknown keep today's width. `wrap` is the single-panel column.
    // Given the fitted image's box, the overlay hugs the contain-fit image
    // instead (#417): the box height is fixed, so one measurement suffices.
    function sizeOverlay(w, h, wrap, fitBox) {
        const landscape = w > h;
        box.style.width = landscape ? "94vw" : "min(1200px, 85vw)";
        if (wrap) wrap.style.maxWidth = landscape || fitBox ? "none" : "520px";
        if (!fitBox || !w || !h) return;
        const extra = box.offsetWidth - fitBox.clientWidth;
        box.style.width = `min(94vw, ${Math.max(520, extra + fitBox.clientHeight * w / h)}px)`;
    }
    // Panel metadata stays collapsed behind a ^ / v toggle at the bottom (#408).
    // onToggle(open) runs before the metadata is shown or hidden (#411).
    function metaToggle(panel, meta, onToggle) {
        const btn = document.createElement("button");
        btn.textContent = "^";
        css(btn, "align-self:center;background:none;border:none;color:#ddd;font-size:28px;line-height:1;padding:2px 12px;cursor:pointer;opacity:0.5;");
        btn.addEventListener("mouseenter", () => { btn.style.opacity = "0.9"; });
        btn.addEventListener("mouseleave", () => { btn.style.opacity = "0.5"; });
        meta.style.display = "none";
        btn.addEventListener("click", () => {
            const open = meta.style.display === "none";
            onToggle?.(open);
            meta.style.display = open ? "flex" : "none";
            btn.textContent = open ? "v" : "^";
        });
        panel.appendChild(btn);
        panel.appendChild(meta);
        return btn;
    }
    // The image fills its box contain-fit; Fit off shows an output at natural
    // size, scrolling on both axes inside the box (#412). The card stack always fills.
    function fitImage(img, imageBox, stacked) {
        const fill = fitOn || stacked;
        img.style.width = img.style.height = fill ? "100%" : "auto";
        imageBox.style.overflow = fill ? "hidden" : "auto";
    }
    // Collapsed metadata: the image fills the panel, no scrollbar. Expanded: the
    // image keeps its height and the panel scrolls (#411).
    function freezeImage(panel, wrap, open) {
        wrap.style.flex = open ? `0 0 ${wrap.offsetHeight}px` : "1";
        panel.style.overflowY = open ? "auto" : "hidden";
    }

    const hasCombos = model.axes.some(a => a.items.length > 1);

    if (hasCombos) {
        const split = document.createElement("div");
        css(split, "display:flex;gap:8px;flex:1;min-height:0;");
        content.appendChild(split);

        // Left: combo axis grids + combo-specific fields below
        const left = document.createElement("div");
        css(left, "flex:0 0 380px;display:flex;flex-direction:column;gap:12px;min-width:0;overflow-x:hidden;overflow-y:auto;");
        // Right: composite image + common data sections
        const right = document.createElement("div");
        css(right, "flex:1;display:flex;flex-direction:column;gap:10px;min-width:0;overflow:hidden;");
        split.appendChild(left);
        split.appendChild(right);

        function runningComboKey() {
            const batch = getActiveBatch();
            const idx = batch.promptIds.indexOf(batch.runningPromptId);
            return idx < 0 ? null : batch.comboKeys[idx];
        }

        // selection state: index per axis. Opens on the combination being
        // generated, else the last one that produced an image, else the first (#423).
        const startPairs = parseComboKey(runningComboKey() ?? getImages().lastKey);
        const selIdx = model.axes.map(axis => Math.max(0, axis.items.findIndex(item =>
            startPairs.some(([nodeId, itemKey]) => nodeId === Number(axis.node.id) && itemKey === item.itemKey))));

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
                card.dataset.itemKey = item.itemKey;
                css(card, `position:relative;flex:0 0 auto;width:108px;height:120px;border-radius:4px;cursor:pointer;background:#2a2a2a;background-size:cover;background-position:center;border:2px solid ${ii === selIdx[ai] ? ACCENT : "transparent"};box-sizing:border-box;`);
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
                // batch's running prompt includes this (nodeId, itemKey) pair.
                const progressTrack = document.createElement("div");
                css(progressTrack, "position:absolute;left:3px;right:3px;bottom:19px;height:4px;background:rgba(0,0,0,0.55);border-radius:2px;overflow:hidden;display:none;");
                const progressFill = document.createElement("div");
                css(progressFill, `height:100%;width:0%;background:${ACCENT};transition:width 0.15s ease;`);
                progressTrack.appendChild(progressFill);
                card.appendChild(progressTrack);
                card._progressTrack = progressTrack;
                card._progressFill = progressFill;

                const cap = document.createElement("div");
                cap.textContent = item.label;
                cap.title = item.label;
                css(cap, "position:absolute;left:0;right:0;bottom:0;font-size:11px;color:#fff;background:rgba(0,0,0,0.6);padding:2px 4px;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-radius:0 0 2px 2px;");
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
        cards.at(-1)?.[selIdx.at(-1)].scrollIntoView({ block: "nearest" });

        // Left: combo-specific fields container (below grids)
        const leftDataWrap = document.createElement("div");
        css(leftDataWrap, "display:flex;flex-direction:column;gap:10px;");
        const leftToggle = metaToggle(left, leftDataWrap);

        // ── Progress bars on combo grid items (#230) ──
        // Walk through every card and update its progress track based on the
        // currently-running prompt (mapped to combo via queue.js's _activeBatch).
        function findCardsForRunningCombo() {
            const pairs = parseComboKey(runningComboKey());
            const out = [];
            for (const [nodeId, itemKey] of pairs) {
                for (const axisCards of cards) {
                    for (const c of axisCards) {
                        if (Number(c.dataset.nodeId) === nodeId && c.dataset.itemKey === itemKey) {
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
        // Re-render the image when a preview or result for the selected combination arrives.
        const unsubscribe = subscribeBatch(() => {
            const preview = selectedPreview();
            if (shownData && (preview !== shownPreview || (!preview && selectedResult() !== currentGenerated))) renderImage(shownData);
        });
        // Tear down the listeners however the overlay closes (button, Esc, outside click).
        handlers.onClose = () => {
            unsubscribe();
            if (_progressApi && typeof _progressApi.removeEventListener === "function") {
                _progressApi.removeEventListener("progress", onProgress);
                _progressApi.removeEventListener("execution_success", onExecDoneForProgress);
                _progressApi.removeEventListener("execution_error", onExecDoneForProgress);
                _progressApi.removeEventListener("execution_interrupted", onExecDoneForProgress);
            }
        };

        // Right: composite image + common data sections
        const compositeWrap = document.createElement("div");
        css(compositeWrap, "flex:1;min-height:0;display:flex;flex-direction:column;gap:4px;box-sizing:border-box;padding:0 4px;");
        const imageBox = document.createElement("div");
        css(imageBox, "flex:1;min-height:0;display:flex;overflow:hidden;border-radius:6px;border:1px solid #333;background:#1a1a1a;box-sizing:border-box;");
        const compositeImg = document.createElement("img");
        css(compositeImg, "display:block;margin:auto;flex:none;width:100%;height:100%;max-width:none;object-fit:contain;");
        imageBox.appendChild(compositeImg);
        const compositeLabel = document.createElement("div");
        css(compositeLabel, "font-size:11px;color:#888;text-align:center;");
        const compositeDimensions = document.createElement("div");
        css(compositeDimensions, "font-size:10px;color:#666;text-align:center;");
        const adToggleWrap = document.createElement("div");
        css(adToggleWrap, "display:flex;align-items:center;justify-content:center;gap:8px;font-size:12px;color:#ddd;");
        // Name + dimensions above the preview image (#349).
        compositeWrap.appendChild(compositeLabel);
        compositeWrap.appendChild(compositeDimensions);
        compositeWrap.appendChild(imageBox);
        compositeWrap.appendChild(adToggleWrap);
        right.appendChild(compositeWrap);

        // Show the ACTUAL generated image dimensions (not the preset's configured
        // size) when a real output is displayed (#342). The cover-composite
        // placeholder keeps the preset dims.
        let dimsFromImage = false;
        compositeImg.addEventListener("load", () => {
            if (dimsFromImage && compositeImg.naturalWidth) {
                compositeDimensions.textContent = `${compositeImg.naturalWidth} × ${compositeImg.naturalHeight}`;
            }
            if (!stacked) {
                shownSize = [compositeImg.naturalWidth, compositeImg.naturalHeight];
                resize();
            }
        });

        // Double-click the overlay image to reveal it on disk, like the Flake
        // Generate node image (#340). Tracks the current combination's generated file.
        let currentGenerated = null;
        compositeImg.style.cursor = "pointer";
        compositeImg.title = "Double-click to reveal in file explorer";
        compositeImg.addEventListener("dblclick", () => {
            if (!currentGenerated) return;
            fetch("/flakes/reveal", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    filename: currentGenerated.filename,
                    subfolder: currentGenerated.subfolder || "",
                    type: currentGenerated.type || "output",
                }),
            }).catch((e) => console.error("[flakes] reveal failed", e));
        });

        let stacked = false;
        const fit = () => fitImage(compositeImg, imageBox, stacked);
        let shownSize = null; // natural size of the shown output / preview (#417)
        const resize = () => { if (!stacked && shownSize) sizeOverlay(...shownSize, null, fitOn && imageBox); };
        onFitChange = () => { fit(); resize(); };

        const dataWrap = document.createElement("div");
        css(dataWrap, "display:flex;flex-direction:column;gap:10px;");
        metaToggle(right, dataWrap, (open) => freezeImage(right, compositeWrap, open));

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

        function selectedResult() {
            const key = combinationKeyFor(model, selIdx);
            const images = getImages();
            return (showAd ? images.ad[key] : images.combo[key]) || null;
        }
        function selectedPreview() {
            const preview = getImages().preview;
            return preview && preview.comboKey === combinationKeyFor(model, selIdx) ? preview.url : null;
        }

        // Live preview while the selected combination samples (#374), else its
        // generated output, else the cover placeholder.
        let imageToken = 0;
        let shownPreview = null;
        async function renderImage(data) {
            const token = ++imageToken;
            const key = combinationKeyFor(model, selIdx);
            shownPreview = selectedPreview();
            const generated = shownPreview ? null : selectedResult();
            currentGenerated = generated;
            stacked = false;
            fit();
            if (shownPreview) {
                dimsFromImage = false;
                compositeImg.src = shownPreview;
                compositeLabel.textContent = "Generating…";
                compositeDimensions.textContent = data.dimensions || "";
            } else if (generated) {
                dimsFromImage = true;
                compositeImg.src = `/view?filename=${encodeURIComponent(generated.filename)}&type=${generated.type || "output"}&subfolder=${encodeURIComponent(generated.subfolder || "")}`;
                const sub = (generated.subfolder || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
                compositeLabel.textContent = sub ? `${sub}/${generated.filename}` : generated.filename;
                compositeDimensions.textContent = (compositeImg.complete && compositeImg.naturalWidth)
                    ? `${compositeImg.naturalWidth} × ${compositeImg.naturalHeight}`
                    : (data.dimensions || "");
            } else {
                dimsFromImage = false;
                compositeLabel.textContent = "No image generated yet";
                const urlLists = data.coverUrls.length ? data.coverUrls : (model.fixed.presetName ? [[`/flakes/preset_cover?name=${encodeURIComponent(model.fixed.presetName)}`]] : []);
                stacked = true;
                fit();
                sizeOverlay(data.width, data.height);
                const src = await buildCardStack(urlLists, key, (imageBox.clientWidth || 1) / (imageBox.clientHeight || 1));
                if (token !== imageToken) return;
                compositeImg.src = src;
                compositeDimensions.textContent = data.dimensions || "";
            }
        }

        let refreshToken = 0;
        let shownData = null; // combinationData of the selected combination
        async function refreshRight() {
            const token = ++refreshToken;
            const data = await combinationData(model, currentSelection());
            if (token !== refreshToken) return;
            shownData = data;
            renderImage(data);

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
            leftToggle.style.display = cs1 || cs2 ? "" : "none";
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
        css(singleWrap, "flex:1;min-height:0;display:flex;flex-direction:column;gap:10px;width:100%;max-width:520px;margin:0 auto;overflow:hidden;");
        content.appendChild(singleWrap);

        const compositeWrap = document.createElement("div");
        css(compositeWrap, "flex:1;min-height:0;display:flex;flex-direction:column;gap:4px;box-sizing:border-box;padding:0 4px;");
        const imageBox = document.createElement("div");
        css(imageBox, "flex:1;min-height:0;display:flex;overflow:hidden;border-radius:6px;border:1px solid #333;background:#1a1a1a;box-sizing:border-box;");
        const compositeImg = document.createElement("img");
        css(compositeImg, "display:block;margin:auto;flex:none;width:100%;height:100%;max-width:none;object-fit:contain;");
        imageBox.appendChild(compositeImg);
        const compositeLabel = document.createElement("div");
        css(compositeLabel, "font-size:11px;color:#888;text-align:center;");
        const compositeDimensions = document.createElement("div");
        css(compositeDimensions, "font-size:10px;color:#666;text-align:center;");
        const adToggleWrap = document.createElement("div");
        css(adToggleWrap, "display:flex;align-items:center;justify-content:center;gap:8px;font-size:12px;color:#ddd;");
        // Name + dimensions above the preview image (#349).
        compositeWrap.appendChild(compositeLabel);
        compositeWrap.appendChild(compositeDimensions);
        compositeWrap.appendChild(imageBox);
        compositeWrap.appendChild(adToggleWrap);
        singleWrap.appendChild(compositeWrap);

        // Show the ACTUAL generated image dimensions when a real output is shown (#342).
        let dimsFromImage = false;
        compositeImg.addEventListener("load", () => {
            if (dimsFromImage && compositeImg.naturalWidth) {
                compositeDimensions.textContent = `${compositeImg.naturalWidth} × ${compositeImg.naturalHeight}`;
            }
            if (!stacked) {
                shownSize = [compositeImg.naturalWidth, compositeImg.naturalHeight];
                resize();
            }
        });

        // Double-click the overlay image to reveal it on disk, like the Flake
        // Generate node image (#340). Tracks the current combination's generated file.
        let currentGenerated = null;
        compositeImg.style.cursor = "pointer";
        compositeImg.title = "Double-click to reveal in file explorer";
        compositeImg.addEventListener("dblclick", () => {
            if (!currentGenerated) return;
            fetch("/flakes/reveal", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    filename: currentGenerated.filename,
                    subfolder: currentGenerated.subfolder || "",
                    type: currentGenerated.type || "output",
                }),
            }).catch((e) => console.error("[flakes] reveal failed", e));
        });

        let stacked = false;
        const fit = () => fitImage(compositeImg, imageBox, stacked);
        let shownSize = null; // natural size of the shown output / preview (#417)
        const resize = () => { if (!stacked && shownSize) sizeOverlay(...shownSize, singleWrap, fitOn && imageBox); };
        onFitChange = () => { fit(); resize(); };

        const dataWrap = document.createElement("div");
        css(dataWrap, "display:flex;flex-direction:column;gap:10px;width:100%;");
        metaToggle(singleWrap, dataWrap, (open) => freezeImage(singleWrap, compositeWrap, open));

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

        // Match the key flake-generate.js writes when there's no combo
        // (queue.js stamps an empty key in that case).
        const key = model.axes.length === 0
            ? ""
            : combinationKeyFor(model, model.axes.map(() => 0));
        function selectedResult() {
            const images = getImages();
            const byKey = showAd ? images.ad : images.combo;
            return byKey[key] ?? byKey[""] ?? null;
        }
        function selectedPreview() {
            return getImages().preview?.url || null;
        }

        let imageToken = 0;
        let shownPreview = null;
        async function renderImage(data) {
            const token = ++imageToken;
            shownPreview = selectedPreview();
            const generated = shownPreview ? null : selectedResult();
            currentGenerated = generated;
            stacked = false;
            fit();
            if (shownPreview) {
                dimsFromImage = false;
                compositeImg.src = shownPreview;
                compositeLabel.textContent = "Generating…";
                compositeDimensions.textContent = data.dimensions || "";
            } else if (generated) {
                dimsFromImage = true;
                compositeImg.src = `/view?filename=${encodeURIComponent(generated.filename)}&type=${generated.type || "output"}&subfolder=${encodeURIComponent(generated.subfolder || "")}`;
                const sub = (generated.subfolder || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
                compositeLabel.textContent = sub ? `${sub}/${generated.filename}` : generated.filename;
                compositeDimensions.textContent = (compositeImg.complete && compositeImg.naturalWidth)
                    ? `${compositeImg.naturalWidth} × ${compositeImg.naturalHeight}`
                    : (data.dimensions || "");
            } else {
                dimsFromImage = false;
                compositeLabel.textContent = "No image generated yet";
                const urlLists = data.coverUrls.length ? data.coverUrls : (model.fixed.presetName ? [[`/flakes/preset_cover?name=${encodeURIComponent(model.fixed.presetName)}`]] : []);
                stacked = true;
                fit();
                sizeOverlay(data.width, data.height, singleWrap);
                const src = await buildCardStack(urlLists, key, (imageBox.clientWidth || 1) / (imageBox.clientHeight || 1));
                if (token !== imageToken) return;
                compositeImg.src = src;
                compositeDimensions.textContent = data.dimensions || "";
            }
        }

        let refreshToken = 0;
        let shownData = null;
        async function refreshRight() {
            const token = ++refreshToken;
            // Even when no axis has multiple options, we may still have one or
            // more axes with a single item each (e.g. one preset, one combo
            // flake). combinationData needs an entry per axis, otherwise it
            // dereferences `undefined` and the composite image stays empty.
            const sel = model.axes.map(axis => axis.items[0]).filter(Boolean);
            const data = await combinationData(model, sel);
            if (token !== refreshToken) return;
            shownData = data;
            renderImage(data);

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

        const unsubscribe = subscribeBatch(() => {
            const preview = selectedPreview();
            if (shownData && (preview !== shownPreview || (!preview && selectedResult() !== currentGenerated))) renderImage(shownData);
        });
        handlers.onClose = unsubscribe;

        refreshRight();
    }

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "Close";
    css(closeBtn, "padding:6px 18px;background:#333;color:#ddd;border:1px solid #555;border-radius:6px;cursor:pointer;font-size:13px;");
    closeBtn.addEventListener("click", () => close());
    footer.appendChild(closeBtn);
}
