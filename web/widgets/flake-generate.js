import { css } from "../utils.js";
import { CATEGORIES, CATEGORY_STYLE, makeOverlay, makeButton } from "./flake-preview.js";
import { fetchFlake } from "../api.js";

export function setupFlakeGenerateWidget(node) {
    if (!node.properties) node.properties = {};

    const container = document.createElement("div");
    css(container, "display:flex;flex-direction:column;gap:4px;padding:4px 6px;font-size:12px;color:#ddd;");

    // ── Preview Grid (2x2) ──
    const gridContainer = document.createElement("div");
    css(gridContainer, "position:relative;display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:0;font-size:12px;color:#ddd;min-height:110px;");

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

    async function buildPreviewFromUpstream() {
        // Walk upstream from the flake_data input to collect flake configs
        const flakeInput = node.inputs?.find(i => i.name === "flake_data");
        if (!flakeInput?.link) return;

        const graph = node.graph;
        if (!graph) return;
        const link = graph.links[flakeInput.link];
        if (!link) return;
        const upstreamNode = graph.getNodeById(link.origin_id);
        if (!upstreamNode) return;

        // Collect flake names from the upstream FlakeStack widget
        const flakesJsonWidget = upstreamNode.widgets?.find(w => w.name === "flakes_json");
        if (!flakesJsonWidget) return;

        let flakes;
        try { flakes = JSON.parse(flakesJsonWidget.value || "[]"); } catch { return; }
        if (!Array.isArray(flakes) || flakes.length === 0) return;

        const modelsInfo = {};
        const promptsInfo = {};
        const paramsInfo = {};
        const metaInfo = {};

        for (const entry of flakes) {
            if (!entry.name || entry.inline) continue;
            try {
                const data = await fetchFlake(entry.name);
                const label = entry.display_name || entry.name.split("/").pop() || entry.name;

                if (data.checkpoint) modelsInfo[`${label} · Checkpoint`] = data.checkpoint;
                if (data.vae && data.vae !== "baked-in") modelsInfo[`${label} · VAE`] = data.vae;
                if (Array.isArray(data.loras)) {
                    data.loras.forEach((lr, i) => {
                        const lrName = lr.name || lr.path || `LoRA #${i + 1}`;
                        modelsInfo[`${label} · ${lrName}`] = `strength: ${lr.strength ?? 1}`;
                    });
                }
                if (data.positive_prompt) promptsInfo[`${label} · Positive`] = data.positive_prompt;
                if (data.negative_prompt) promptsInfo[`${label} · Negative`] = data.negative_prompt;
                if (data.steps != null) paramsInfo[`${label} · Steps`] = String(data.steps);
                if (data.cfg != null) paramsInfo[`${label} · CFG`] = String(data.cfg);
                if (data.sampler) paramsInfo[`${label} · Sampler`] = data.sampler;
                if (data.scheduler) paramsInfo[`${label} · Scheduler`] = data.scheduler;
                if (data.width != null) metaInfo[`${label} · Width`] = String(data.width);
                if (data.height != null) metaInfo[`${label} · Height`] = String(data.height);
            } catch { /* skip flakes that fail to load */ }
        }

        const hasAny = [modelsInfo, promptsInfo, paramsInfo, metaInfo].some(o => Object.keys(o).length > 0);
        if (!hasAny) return;

        currentPreviewData = { Models: modelsInfo, Prompts: promptsInfo, Parameters: paramsInfo, Metadata: metaInfo };
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
        // type 1 = input changed
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
                const subfolder = img.subfolder ? `${encodeURIComponent(img.subfolder)}/` : "";
                const type = img.type || "output";
                imageEl.src = `/view?filename=${encodeURIComponent(img.filename)}&type=${type}&subfolder=${encodeURIComponent(img.subfolder || "")}`;
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
            const subfolder = img.subfolder ? `${encodeURIComponent(img.subfolder)}/` : "";
            const type = img.type || "output";
            imageEl.src = `/view?filename=${encodeURIComponent(img.filename)}&type=${type}&subfolder=${encodeURIComponent(img.subfolder || "")}`;
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
        return r;
    };

    genWidget.computeSize = () => [node.size[0], Math.max(340, node.size[0] * 0.6)];
}
