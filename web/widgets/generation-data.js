import { css } from "../utils.js";
import { openOverlay } from "../modal.js";
import { fetchFlake, fetchPreset, getCoverUrl, getVariantImageUrl } from "../api.js";

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
            const presets = node.properties?._combo_presets || [];
            if (presets.length === 0) continue;
            axes.push({
                node, kind: "model",
                label: "Model Preset",
                items: presets.map(p => ({
                    label: (node.properties?._combo_display_names?.[p]) || p.split(/[\/\\]+/).pop() || p,
                    presetName: p,
                    coverUrl: `/flakes/preset_cover?name=${encodeURIComponent(p)}`,
                })),
            });
        } else if (type === "FlakeStack") {
            for (const e of activeEntries(node, "FlakeStack")) fixed.stackFlakes.push(e);
        } else if (type === "FlakeCombo") {
            const flakes = activeEntries(node, "FlakeCombo");
            if (flakes.length === 0) continue;
            axes.push({
                node, kind: "flake",
                label: "Flake Combo",
                items: flakes.map(e => {
                    const variantSel = Object.entries(e.variant || {}).find(([, c]) => c);
                    let cover = getCoverUrl(e.name);
                    if (variantSel) cover = getVariantImageUrl(e.name, variantSel[0], variantSel[1]);
                    const choices = Object.values(e.variant || {}).filter(Boolean);
                    const base = e.display_name || e.name.split("/").pop() || e.name;
                    return {
                        label: base + (choices.length ? ` (${choices.join(", ")})` : ""),
                        entry: e,
                        coverUrl: cover,
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

// ── Per-combination data assembly ──────────────────────────────────────────
async function combinationData(model, selection) {
    // selection: array of chosen item per axis (same order as model.axes)
    let presetName = model.fixed.presetName;
    model.axes.forEach((axis, i) => {
        if (axis.kind === "model") presetName = selection[i].presetName;
    });

    const out = { modelRows: [], outputRows: [], loraRows: [], promptRows: [], coverUrls: [] };

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
            if (d.width || d.height) out.outputRows.push(["Dimensions", `${d.width || "?"} × ${d.height || "?"}`]);
            if (d.filename_prefix) out.outputRows.push(["Filename", d.filename_prefix]);
            const label = d.display_name || presetName.split("/").pop() || presetName;
            const pos = (d.prompt?.positive || "").trim();
            const neg = (d.prompt?.negative || "").trim();
            if (pos) out.promptRows.push([`${label} · Positive`, pos]);
            if (neg) out.promptRows.push([`${label} · Negative`, neg]);
        } catch { /* skip */ }
    }

    // Gather flakes: fixed stack flakes + the selected combo flake per flake-axis
    const flakeEntries = [...model.fixed.stackFlakes];
    model.axes.forEach((axis, i) => {
        if (axis.kind === "flake") flakeEntries.push(selection[i].entry);
    });

    for (const entry of flakeEntries) {
        try {
            const d = await fetchFlake(entry.name);
            const label = entry.display_name || d.name || entry.name.split("/").pop() || entry.name;
            const choices = Object.values(entry.variant || {}).filter(Boolean);
            const vLabel = label + (choices.length ? ` (${choices.join(", ")})` : "");
            if (Array.isArray(d.loras)) {
                d.loras.forEach((lr, idx) => {
                    const p = (lr.name || lr.path || `LoRA #${idx + 1}`).replace(/^img\/[^/]+\//, "");
                    const s = entry.loras?.[idx] ?? lr.strength ?? 1;
                    out.loraRows.push([`LoRA [${Number.isInteger(s) ? s : Number(s).toFixed(2)}]`, p]);
                });
            }
            const pos = (d.positive_prompt || "").trim();
            const neg = (d.negative_prompt || "").trim();
            let posX = "", negX = "";
            for (const [g, c] of Object.entries(entry.variant || {})) {
                const v = d.variants?.[g]?.[c];
                if (v?.positive) posX += (posX ? ", " : "") + v.positive;
                if (v?.negative) negX += (negX ? ", " : "") + v.negative;
            }
            const fp = [pos, posX].filter(Boolean).join(", ");
            const fn = [neg, negX].filter(Boolean).join(", ");
            if (fp) out.promptRows.push([`${vLabel} · Positive`, fp]);
            if (fn) out.promptRows.push([`${vLabel} · Negative`, fn]);
        } catch { /* skip */ }
    }

    // Cover urls for the composite = the selected combo item covers, in order
    out.coverUrls = model.axes.map((_, i) => selection[i].coverUrl);
    return out;
}

// Stable, order-independent identity for a combination: each axis's node id
// paired with the selected item index, sorted by node id. Must match the key
// queue.js stamps onto FlakeGenerate at queue time.
export function combinationKeyFor(model, selIdx) {
    return model.axes
        .map((axis, i) => [axis.node.id, selIdx[i]])
        .sort((a, b) => a[0] - b[0])
        .map(([id, idx]) => `${id}:${idx}`)
        .join("|");
}

// ── Overlay UI ─────────────────────────────────────────────────────────────
export function openGenerationDataOverlay(model, lastImagesByCombo) {
    const { content, footer, close } = openOverlay();
    css(content.parentElement, content.parentElement.style.cssText + "min-width:760px;max-width:920px;");

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

    const split = document.createElement("div");
    css(split, "display:flex;gap:14px;align-items:flex-start;");
    content.appendChild(split);

    // Left half: one horizontal scroll grid per combo axis
    const left = document.createElement("div");
    css(left, "flex:1;display:flex;flex-direction:column;gap:12px;min-width:0;");
    const right = document.createElement("div");
    css(right, "flex:1;display:flex;flex-direction:column;gap:10px;min-width:0;max-height:60vh;overflow:auto;");
    split.appendChild(left);
    split.appendChild(right);

    // selection state: index per axis
    const selIdx = model.axes.map(() => 0);

    function currentSelection() {
        return model.axes.map((axis, i) => axis.items[selIdx[i]]);
    }

    const cards = []; // per-axis: array of card elements (to update selected ring)

    model.axes.forEach((axis, ai) => {
        const section = document.createElement("div");
        const lbl = document.createElement("div");
        lbl.textContent = axis.label;
        css(lbl, "font-size:11px;font-weight:600;color:#aaa;margin-bottom:4px;");
        section.appendChild(lbl);

        const scroll = document.createElement("div");
        css(scroll, "display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;");
        const axisCards = [];
        axis.items.forEach((item, ii) => {
            const card = document.createElement("div");
            css(card, `position:relative;flex:0 0 auto;width:72px;height:80px;border-radius:4px;cursor:pointer;background:#2a2a2a;background-image:url(${item.coverUrl});background-size:cover;background-position:center;border:2px solid ${ii === selIdx[ai] ? ACCENT : "transparent"};box-sizing:border-box;`);
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

    // Right half: composite image + label + data sections
    const compositeWrap = document.createElement("div");
    css(compositeWrap, "display:flex;flex-direction:column;align-items:center;gap:4px;");
    const compositeImg = document.createElement("img");
    css(compositeImg, "width:256px;height:256px;object-fit:cover;border-radius:6px;border:1px solid #333;background:#1a1a1a;");
    const compositeLabel = document.createElement("div");
    css(compositeLabel, "font-size:11px;color:#888;text-align:center;");
    compositeWrap.appendChild(compositeImg);
    compositeWrap.appendChild(compositeLabel);
    right.appendChild(compositeWrap);

    const dataWrap = document.createElement("div");
    css(dataWrap, "display:flex;flex-direction:column;gap:10px;");
    right.appendChild(dataWrap);

    function section(titleText, rows) {
        if (!rows.length) return null;
        const wrap = document.createElement("div");
        const h = document.createElement("div");
        h.textContent = titleText;
        css(h, `font-size:11px;font-weight:600;color:${ACCENT};margin-bottom:4px;`);
        wrap.appendChild(h);
        const list = document.createElement("div");
        css(list, "display:flex;flex-direction:column;gap:4px;");
        for (const [k, v] of rows) {
            const row = document.createElement("div");
            css(row, "background:#181818;border:1px solid #333;border-radius:6px;padding:6px 8px;");
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
        if (token !== refreshToken) return; // a newer selection superseded this

        // Composite (or generated output if we have one for this combination)
        const generated = lastImagesByCombo && lastImagesByCombo[key];
        if (generated) {
            compositeImg.src = `/view?filename=${encodeURIComponent(generated.filename)}&type=${generated.type || "output"}&subfolder=${encodeURIComponent(generated.subfolder || "")}`;
            const sub = (generated.subfolder || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
            compositeLabel.textContent = sub ? `${sub}/${generated.filename}` : generated.filename;
        } else {
            compositeLabel.textContent = "No image generated yet";
            const urls = data.coverUrls.length ? data.coverUrls : (model.fixed.presetName ? [`/flakes/preset_cover?name=${encodeURIComponent(model.fixed.presetName)}`] : []);
            compositeImg.src = await buildComposite(urls);
        }

        dataWrap.replaceChildren();
        const s1 = section("Model", data.modelRows);
        const s2 = section("Output", data.outputRows);
        const s3 = section("LoRAs", data.loraRows);
        const s4 = section("Prompts", data.promptRows);
        for (const s of [s1, s2, s3, s4]) if (s) dataWrap.appendChild(s);
        if (!s1 && !s2 && !s3 && !s4) {
            const empty = document.createElement("div");
            css(empty, "font-size:12px;color:#555;text-align:center;padding:20px;");
            empty.textContent = "No data for this combination";
            dataWrap.appendChild(empty);
        }
    }

    refreshRight();

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "Close";
    css(closeBtn, "padding:6px 18px;background:#333;color:#ddd;border:1px solid #555;border-radius:6px;cursor:pointer;font-size:13px;");
    closeBtn.addEventListener("click", () => close());
    footer.appendChild(closeBtn);
}
