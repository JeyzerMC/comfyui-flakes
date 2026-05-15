import { css } from "../utils.js";
import { CATEGORIES, CATEGORY_STYLE, makeOverlay, makeButton } from "./flake-preview.js";
import { fetchFlake, fetchPreset } from "../api.js";

export function setupFlakeGenerateWidget(node) {
    if (!node.properties) node.properties = {};

    const container = document.createElement("div");
    css(container, "display:flex;flex-direction:column;gap:4px;padding:4px 6px;font-size:12px;color:#ddd;");

    // ── Preview Grid (1x2 — 2 buttons) ──
    const gridContainer = document.createElement("div");
    css(gridContainer, "position:relative;display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:0;font-size:12px;color:#ddd;min-height:70px;");

    let currentPreviewData = node.properties._preview_data || null;

    function renderPreviewGrid(previewData) {
        gridContainer.replaceChildren();
        for (const cat of CATEGORIES) {
            const info = CATEGORY_STYLE[cat];
            const data = previewData ? (previewData[cat] || {}) : {};
            const hasData = previewData && Object.keys(data).length > 0;
            const btn = makeButton(cat, info, hasData, (category) => {
                const catData = currentPreviewData ? (currentPreviewData[category] || {}) : {};
                makeOverlay(category, catData);
            });
            gridContainer.appendChild(btn);
        }
    }

    // Walk the graph upstream from this node and collect all FlakeStack/FlakeCombo
    // nodes in order, plus the terminal FlakeModelPreset.
    function collectUpstreamChain(startNode) {
        const chain = []; // [{type, node}]
        const visited = new Set();
        let current = startNode;

        while (current && !visited.has(current.id)) {
            visited.add(current.id);
            const t = current.type;
            if (t === "FlakeStack" || t === "FlakeCombo") {
                chain.push({ type: t, node: current });
                // Follow flake_data input upstream
                const fdInput = current.inputs?.find(i => i.name === "flake_data");
                if (!fdInput?.link) break;
                const link = current.graph?.links?.[fdInput.link];
                if (!link) break;
                current = current.graph?.getNodeById(link.origin_id);
            } else if (t === "FlakeModelPreset") {
                chain.push({ type: t, node: current });
                break;
            } else {
                break;
            }
        }
        // Reverse so preset is first, then stacks in order
        return chain.reverse();
    }

    // Strip img/<family>/ prefix from a LoRA path for cleaner display
    function stripLoraPrefix(path) {
        return path.replace(/^img\/[^/]+\//, "");
    }

    async function buildPreviewFromUpstream() {
        const flakeInput = node.inputs?.find(i => i.name === "flake_data");
        if (!flakeInput?.link) return;
        const graph = node.graph;
        if (!graph) return;
        const link = graph.links[flakeInput.link];
        if (!link) return;
        const upstreamNode = graph.getNodeById(link.origin_id);
        if (!upstreamNode) return;

        const chain = collectUpstreamChain(upstreamNode);

        // Collect individual fields; we'll group them before storing
        let checkpoint = null, vae = null, textEncoder = null;
        let clipSkip = null, width = null, height = null;
        let steps = null, cfg = null, sampler = null, scheduler = null;
        const loraRows = []; // [{label, strength, path}]
        const modelsInfo = {};
        const inputsInfo = {};
        let filenamePrefix = null;

        for (const { type, node: chainNode } of chain) {
            if (type === "FlakeModelPreset") {
                const presetWidget = chainNode.widgets?.find(w => w.name === "preset");
                const presetName = presetWidget?.value;
                if (!presetName || presetName === "Select a preset..." || presetName === "No model preset is selected") continue;
                try {
                    const data = await fetchPreset(presetName);
                    const label = data.display_name || presetName.split("/").pop() || presetName;
                    if (data.checkpoint) checkpoint = data.checkpoint;
                    if (data.vae && data.vae !== "baked-in") vae = data.vae;
                    if (data.text_encoder && data.text_encoder !== "baked-in") textEncoder = data.text_encoder;
                    if (data.clip_skip) clipSkip = String(data.clip_skip);
                    if (data.width) width = String(data.width);
                    if (data.height) height = String(data.height);
                    if (data.steps) steps = String(data.steps);
                    if (data.cfg) cfg = String(data.cfg);
                    if (data.sampler) sampler = data.sampler;
                    if (data.scheduler) scheduler = data.scheduler;
                    if (data.filename_prefix) filenamePrefix = data.filename_prefix;
                    // Preset prompts
                    const pos = (data.prompt?.positive || "").trim();
                    const neg = (data.prompt?.negative || "").trim();
                    if (pos) inputsInfo[`${label} · Positive`] = pos;
                    if (neg) inputsInfo[`${label} · Negative`] = neg;
                } catch { /* skip */ }
            } else if (type === "FlakeStack" || type === "FlakeCombo") {
                // For FlakeCombo, read the full list from properties (flakes_json only holds the active entry)
                let entries;
                if (type === "FlakeCombo") {
                    entries = chainNode.properties?._combo_flakes || [];
                } else {
                    const flakesWidget = chainNode.widgets?.find(w => w.name === "flakes_json");
                    if (!flakesWidget) continue;
                    try { entries = JSON.parse(flakesWidget.value || "[]"); } catch { continue; }
                }
                if (!Array.isArray(entries)) continue;

                for (const entry of entries) {
                    if (entry.inline || entry.bypassed || !entry.name) continue;
                    try {
                        const data = await fetchFlake(entry.name);
                        const label = entry.display_name || data.name || entry.name.split("/").pop() || entry.name;

                        // LoRAs — collect for grouped display
                        if (Array.isArray(data.loras)) {
                            data.loras.forEach((lr, i) => {
                                const rawPath = lr.name || lr.path || `LoRA #${i + 1}`;
                                const strength = entry.loras?.[i] ?? lr.strength ?? 1;
                                loraRows.push({ label, strength, path: rawPath });
                            });
                        }
                        // Resolution override
                        if (data.width) width = String(data.width);
                        if (data.height) height = String(data.height);

                        // Prompts
                        const pos = (data.positive_prompt || "").trim();
                        const neg = (data.negative_prompt || "").trim();
                        const variant = entry.variant || {};
                        let posExtra = "";
                        let negExtra = "";
                        for (const [group, choice] of Object.entries(variant)) {
                            const v = data.variants?.[group]?.[choice];
                            if (v?.positive) posExtra += (posExtra ? ", " : "") + v.positive;
                            if (v?.negative) negExtra += (negExtra ? ", " : "") + v.negative;
                        }
                        const finalPos = [pos, posExtra].filter(Boolean).join(", ");
                        const finalNeg = [neg, negExtra].filter(Boolean).join(", ");
                        if (finalPos) inputsInfo[`${label} · Positive`] = finalPos;
                        if (finalNeg) inputsInfo[`${label} · Negative`] = finalNeg;

                        // ControlNets
                        if (Array.isArray(data.controlnets)) {
                            data.controlnets.forEach((cn, i) => {
                                if (cn.model_name || cn.image_name) {
                                    inputsInfo[`${label} · ControlNet ${i + 1}`] = [cn.model_name, cn.image_name, cn.strength != null ? `strength: ${cn.strength}` : ""].filter(Boolean).join(" | ");
                                }
                            });
                        }
                    } catch { /* skip */ }
                }
            }
        }

        // Build grouped Models rows
        if (checkpoint) modelsInfo["Checkpoint"] = checkpoint;
        // Group: Width · Height · Clip Skip · Steps · CFG on one line
        const row1Parts = [
            width && `W: ${width}`,
            height && `H: ${height}`,
            clipSkip && `Skip: ${clipSkip}`,
            steps && `Steps: ${steps}`,
            cfg && `CFG: ${cfg}`,
        ].filter(Boolean);
        if (row1Parts.length) modelsInfo["Resolution & Sampling"] = row1Parts.join("  ·  ");
        // Group: VAE · Text Encoder · Sampler · Scheduler on one line
        const row2Parts = [
            vae && `VAE: ${vae}`,
            textEncoder && `TE: ${textEncoder}`,
            sampler && `Sampler: ${sampler}`,
            scheduler && `Sched: ${scheduler}`,
        ].filter(Boolean);
        if (row2Parts.length) modelsInfo["Pipeline"] = row2Parts.join("  ·  ");
        // LoRA rows: "LoRA [strength]" → "stripped/path"
        for (const lr of loraRows) {
            const strengthStr = Number.isInteger(lr.strength) ? String(lr.strength) : lr.strength.toFixed(2);
            modelsInfo[`LoRA [${strengthStr}]`] = stripLoraPrefix(lr.path);
        }

        // Build Inputs with filename prefix as the first field
        const orderedInputs = {};
        if (filenamePrefix) orderedInputs["Filename Prefix"] = filenamePrefix;
        Object.assign(orderedInputs, inputsInfo);

        const hasAny = Object.keys(modelsInfo).length > 0 || Object.keys(orderedInputs).length > 0;
        if (!hasAny) return;

        currentPreviewData = { Models: modelsInfo, Inputs: orderedInputs };
        node.properties._preview_data = currentPreviewData;
        renderPreviewGrid(currentPreviewData);
    }

    renderPreviewGrid(currentPreviewData);
    container.appendChild(gridContainer);

    // ── Image Display ──
    const imageContainer = document.createElement("div");
    css(imageContainer, "display:flex;flex-direction:column;align-items:center;gap:4px;margin-top:4px;");

    const imageEl = document.createElement("img");
    css(imageEl, "max-width:100%;border-radius:4px;display:none;");
    imageContainer.appendChild(imageEl);

    const noImageLabel = document.createElement("div");
    css(noImageLabel, "font-size:11px;opacity:0.4;text-align:center;padding:8px 0;");
    noImageLabel.textContent = "No image generated yet";
    imageContainer.appendChild(noImageLabel);

    container.appendChild(imageContainer);

    // ── Add DOM widget ──
    const genWidget = node.addDOMWidget("flake_generate_ui", "div", container, { serialize: false, margin: 4 });

    const origOnConnectionsChange = node.onConnectionsChange;
    node.onConnectionsChange = function (type, index, connected, link_info) {
        const r = origOnConnectionsChange?.apply(this, arguments);
        const flakeInputIdx = node.inputs?.findIndex(i => i.name === "flake_data") ?? 0;
        if (type === 1 && index === flakeInputIdx) {
            if (connected) {
                buildPreviewFromUpstream();
            } else {
                currentPreviewData = null;
                node.properties._preview_data = null;
                renderPreviewGrid(null);
            }
        }
        return r;
    };

    const origOnExecuted = node.onExecuted;
    node.onExecuted = function (output) {
        const r = origOnExecuted?.apply(this, arguments);
        if (output) {
            if (output.flake_images && output.flake_images.length > 0) {
                const img = output.flake_images[0];
                imageEl.src = `/view?filename=${encodeURIComponent(img.filename)}&type=${img.type || "output"}&subfolder=${encodeURIComponent(img.subfolder || "")}`;
                imageEl.style.display = "block";
                noImageLabel.style.display = "none";
                node.properties._last_image = img;
            } else {
                imageEl.style.display = "none";
                noImageLabel.style.display = "block";
            }
            if (output.preview_data) {
                currentPreviewData = Array.isArray(output.preview_data) ? output.preview_data[0] : output.preview_data;
                node.properties._preview_data = currentPreviewData;
                renderPreviewGrid(currentPreviewData);
            }
        }
        return r;
    };

    const origOnConfigure = node.onConfigure;
    node.onConfigure = function () {
        const r = origOnConfigure?.apply(this, arguments);
        node._configured = true;
        if (node.properties?._last_image) {
            const img = node.properties._last_image;
            imageEl.src = `/view?filename=${encodeURIComponent(img.filename)}&type=${img.type || "output"}&subfolder=${encodeURIComponent(img.subfolder || "")}`;
            imageEl.style.display = "block";
            noImageLabel.style.display = "none";
        } else {
            imageEl.style.display = "none";
            noImageLabel.style.display = "block";
        }
        if (node.properties?._preview_data) {
            currentPreviewData = node.properties._preview_data;
            renderPreviewGrid(currentPreviewData);
        } else {
            renderPreviewGrid(null);
        }
        // Rebuild from the graph after links are restored so both buttons stay active
        setTimeout(() => buildPreviewFromUpstream(), 0);
        return r;
    };

    genWidget.computeSize = () => [node.size[0], Math.max(320, node.size[0] * 0.6)];
}
