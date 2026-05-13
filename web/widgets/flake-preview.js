import { css } from "../utils.js";

const CATEGORY_INFO = {
    Models: { icon: "\uD83D\uDCBB", color: "#4a9eff" },
    Prompts: { icon: "\uD83D\uDCDD", color: "#4aff9e" },
    Parameters: { icon: "\u2699\uFE0F", color: "#ff9e4a" },
    Metadata: { icon: "\uD83D\uDCCB", color: "#9e4aff" },
};

function extractPreviewData(flakeData) {
    if (!flakeData) return null;
    try {
        const [modelBundle, generationData, samplingPreset] = flakeData;
        const result = { Models: {}, Prompts: {}, Parameters: {}, Metadata: {} };

        if (modelBundle) {
            const [model, clip, vae] = modelBundle;
            if (model) result.Models["Checkpoint"] = "(loaded)";
            if (clip) result.Models["Text Encoder"] = "(loaded)";
            if (vae) result.Models["VAE"] = "(loaded)";
        }

        if (generationData) {
            const [positive, negative, latent, width, height, posText, negText] = generationData;
            if (posText) result.Prompts["Positive"] = posText;
            if (negText) result.Prompts["Negative"] = negText;
            if (width && height) result.Metadata["Resolution"] = `${width} x ${height}`;
            if (generationData.length > 7 && generationData[7] && typeof generationData[7] === "object") {
                const fnameState = generationData[7];
                const preset = fnameState.preset || "";
                const stems = fnameState.stems || [];
                const prefix = preset ? preset + (stems.length ? "/" : "") : "";
                result.Metadata["Filename Prefix"] = prefix + stems.join("_");
            }
        }

        if (samplingPreset) {
            const [steps, cfg, sampler, scheduler] = samplingPreset;
            if (steps != null) result.Parameters["Steps"] = String(steps);
            if (cfg != null) result.Parameters["CFG"] = String(cfg);
            if (sampler) result.Parameters["Sampler"] = String(sampler);
            if (scheduler) result.Parameters["Scheduler"] = String(scheduler);
        }

        return result;
    } catch {
        return null;
    }
}

function makeCategoryCard(category, data, onClick) {
    const info = CATEGORY_INFO[category] || { icon: "\uD83D\uDCC4", color: "#999" };
    const entries = Object.entries(data);
    const hasData = entries.length > 0;

    const card = document.createElement("div");
    css(card, `position:relative;background:#2a2a2a;border:1px solid #444;border-radius:6px;padding:10px;cursor:pointer;transition:border-color 0.15s,background 0.15s;display:flex;flex-direction:column;gap:6px;min-height:80px;box-sizing:border-box;`);
    card.addEventListener("mouseenter", () => {
        card.style.borderColor = info.color;
        card.style.background = "#2e2e2e";
    });
    card.addEventListener("mouseleave", () => {
        card.style.borderColor = "#444";
        card.style.background = "#2a2a2a";
    });

    const header = document.createElement("div");
    css(header, "display:flex;align-items:center;gap:6px;");
    const iconSpan = document.createElement("span");
    iconSpan.textContent = info.icon;
    css(iconSpan, "font-size:14px;");
    header.appendChild(iconSpan);
    const titleSpan = document.createElement("span");
    titleSpan.textContent = category;
    css(titleSpan, `font-size:12px;font-weight:600;color:${info.color};`);
    header.appendChild(titleSpan);

    const badge = document.createElement("span");
    badge.textContent = String(entries.length);
    css(badge, `font-size:10px;background:${info.color}22;color:${info.color};padding:1px 6px;border-radius:10px;margin-left:auto;`);
    header.appendChild(badge);

    card.appendChild(header);

    if (hasData) {
        const preview = document.createElement("div");
        css(preview, "font-size:10px;color:#aaa;line-height:1.4;overflow:hidden;max-height:40px;");
        const previewKeys = entries.slice(0, 3);
        preview.textContent = previewKeys.map(([k]) => k).join(", ") + (entries.length > 3 ? " ..." : "");
        card.appendChild(preview);
    } else {
        const empty = document.createElement("div");
        css(empty, "font-size:10px;color:#555;opacity:0.6;");
        empty.textContent = "No data";
        card.appendChild(empty);
    }

    card.addEventListener("click", (e) => {
        e.stopPropagation();
        onClick(category, data);
    });

    return card;
}

function showOverlay(container, category, data) {
    const info = CATEGORY_INFO[category] || { icon: "\uD83D\uDCC4", color: "#999" };
    const entries = Object.entries(data);

    // Remove existing overlay
    const existing = container.querySelector(".flake-preview-overlay");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    css(overlay, "position:absolute;inset:0;background:rgba(0,0,0,0.85);z-index:100;display:flex;flex-direction:column;padding:12px;box-sizing:border-box;overflow-y:auto;");

    const headerRow = document.createElement("div");
    css(headerRow, "display:flex;align-items:center;gap:8px;margin-bottom:8px;");
    const iconSpan = document.createElement("span");
    iconSpan.textContent = info.icon;
    iconSpan.style.fontSize = "16px";
    headerRow.appendChild(iconSpan);
    const title = document.createElement("span");
    title.textContent = category;
    css(title, `font-size:14px;font-weight:600;color:${info.color};`);
    headerRow.appendChild(title);

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "\u2715";
    css(closeBtn, "margin-left:auto;background:none;border:1px solid #555;color:#aaa;width:24px;height:24px;border-radius:4px;cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center;padding:0;");
    closeBtn.addEventListener("click", () => overlay.remove());
    headerRow.appendChild(closeBtn);

    overlay.appendChild(headerRow);

    if (entries.length === 0) {
        const empty = document.createElement("div");
        css(empty, "font-size:11px;color:#555;text-align:center;padding:20px;");
        empty.textContent = "No data available";
        overlay.appendChild(empty);
    } else {
        const list = document.createElement("div");
        css(list, "display:flex;flex-direction:column;gap:6px;");
        for (const [key, value] of entries) {
            const row = document.createElement("div");
            css(row, "display:flex;flex-direction:column;gap:2px;background:#222;border:1px solid #333;border-radius:4px;padding:6px 8px;");
            const keyEl = document.createElement("div");
            keyEl.textContent = key;
            css(keyEl, `font-size:10px;color:${info.color};font-weight:600;`);
            row.appendChild(keyEl);
            const valEl = document.createElement("div");
            const valStr = typeof value === "string" ? value : String(value);
            valEl.textContent = valStr.length > 200 ? valStr.substring(0, 200) + "..." : valStr;
            css(valEl, "font-size:11px;color:#ddd;word-break:break-word;white-space:pre-wrap;max-height:100px;overflow-y:auto;");
            row.appendChild(valEl);
            list.appendChild(row);
        }
        overlay.appendChild(list);
    }

    overlay.addEventListener("click", (e) => {
        if (e.target === overlay) overlay.remove();
    });

    container.style.position = "relative";
    container.appendChild(overlay);
}

export function setupPreviewFlakeDataWidget(node) {
    const flakeDataInput = node.inputs?.find(i => i.name === "flake_data");
    if (!flakeDataInput) return;

    if (!node.properties) node.properties = {};
    if (!node.properties._preview_data) node.properties._preview_data = null;

    const container = document.createElement("div");
    css(container, "position:relative;display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:6px;font-size:12px;color:#ddd;min-height:170px;");

    const placeholder = document.createElement("div");
    css(placeholder, "grid-column:1/-1;display:flex;align-items:center;justify-content:center;color:#555;font-size:11px;text-align:center;padding:20px;");
    placeholder.textContent = "Connect a FLAKE_DATA input to preview";
    container.appendChild(placeholder);

    let currentData = null;

    function render(previewData) {
        container.replaceChildren();

        if (!previewData) {
            const ph = document.createElement("div");
            css(ph, "grid-column:1/-1;display:flex;align-items:center;justify-content:center;color:#555;font-size:11px;text-align:center;padding:20px;");
            ph.textContent = "No data to preview";
            container.appendChild(ph);
            return;
        }

        const categories = ["Models", "Prompts", "Parameters", "Metadata"];
        for (const cat of categories) {
            const data = previewData[cat] || {};
            const card = makeCategoryCard(cat, data, (category, catData) => {
                showOverlay(container, category, catData);
            });
            container.appendChild(card);
        }
    }

    // Try to extract data from connected node if available
    function updatePreview() {
        try {
            // Look for the connected FLAKE_DATA input by checking the graph
            const inputLinks = node.inputs?.[0]?.link;
            if (inputLinks != null) {
                const link = node.graph?.links?.[inputLinks];
                if (link) {
                    const sourceNode = node.graph?.getNodeById?.(link.origin_id);
                    if (sourceNode && typeof sourceNode._getLastOutput === "function") {
                        currentData = sourceNode._getLastOutput();
                    }
                }
            }
        } catch { /* ignore */ }

        if (currentData) {
            const preview = extractPreviewData(currentData);
            render(preview);
        } else {
            render(null);
        }
    }

    // Update on graph execution (when data flows through the node)
    const origOnExecuted = node.onExecuted;
    node.onExecuted = function (output) {
        const r = origOnExecuted?.apply(this, arguments);
        if (output && output[0]) {
            currentData = output[0];
            const preview = extractPreviewData(currentData);
            render(preview);
        }
        return r;
    };

    // Also hook into onConfigure to restore state
    const origOnConfigure = node.onConfigure;
    node.onConfigure = function () {
        const r = origOnConfigure?.apply(this, arguments);
        if (node.properties?._preview_data) {
            currentData = node.properties._preview_data;
            const preview = extractPreviewData(currentData);
            render(preview);
        }
        return r;
    };

    node._preview_update = updatePreview;

    const previewWidget = node.addDOMWidget("preview_ui", "div", container, { serialize: false, margin: 4 });
    previewWidget.computeSize = () => [node.size[0], 180];

    render(null);
}