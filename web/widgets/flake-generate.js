import { css } from "../utils.js";
import { CATEGORIES, CATEGORY_STYLE, makeOverlay, makeButton } from "./flake-preview.js";

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
                makeOverlay(gridContainer, category, catData);
            });
            gridContainer.appendChild(btn);
        }
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

    const origOnExecuted = node.onExecuted;
    node.onExecuted = function (output) {
        const r = origOnExecuted?.apply(this, arguments);
        if (output) {
            if (output.images && output.images.length > 0) {
                const img = output.images[0];
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
