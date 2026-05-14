import { css } from "../utils.js";
import { CATEGORIES, CATEGORY_STYLE, makeOverlay, makeButton } from "./flake-preview.js";

function hideWidget(node, widgetName) {
    const w = node.widgets?.find(w => w.name === widgetName);
    if (!w) return;
    w.computeSize = () => [0, -4];
    w.type = "hidden";
    w.hidden = true;
    if (w.element) { w.element.remove(); w.element = null; }
    if (w.inputEl) { w.inputEl.remove(); w.inputEl = null; }
}

function getSeedWidget(node) {
    return node.widgets?.find(w => w.name === "seed");
}

export function setupFlakeGenerateWidget(node) {
    if (!node.properties) node.properties = {};

    hideWidget(node, "seed");

    const container = document.createElement("div");
    css(container, "display:flex;flex-direction:column;gap:4px;padding:4px 6px;font-size:12px;color:#ddd;");

    // ── Seed Row ──
    const seedRow = document.createElement("div");
    css(seedRow, "display:flex;align-items:center;gap:4px;");

    const seedLabel = document.createElement("span");
    seedLabel.textContent = "Seed";
    css(seedLabel, "font-size:11px;opacity:0.7;min-width:30px;");
    seedRow.appendChild(seedLabel);

    const seedInput = document.createElement("input");
    seedInput.type = "number";
    seedInput.value = "0";
    css(seedInput, "flex:1;background:#2a2a2a;color:#ddd;border:1px solid #444;border-radius:3px;padding:2px 4px;font-size:11px;min-width:0;");
    seedRow.appendChild(seedInput);

    function syncSeedToWidget() {
        const w = getSeedWidget(node);
        if (w) w.value = parseInt(seedInput.value, 10) || 0;
    }
    function syncSeedFromWidget() {
        const w = getSeedWidget(node);
        if (w) seedInput.value = String(w.value);
    }

    seedInput.addEventListener("change", syncSeedToWidget);
    seedInput.addEventListener("input", syncSeedToWidget);

    const randBtn = document.createElement("button");
    randBtn.textContent = "\uD83C\uDFB2";
    randBtn.title = "Randomize seed";
    css(randBtn, "width:20px;height:20px;padding:0;background:#2a2a2a;color:#aaa;border:1px solid #444;border-radius:3px;cursor:pointer;font-size:11px;line-height:1;display:flex;align-items:center;justify-content:center;");
    randBtn.addEventListener("click", () => {
        const w = getSeedWidget(node);
        if (w) {
            w.value = Math.floor(Math.random() * 0xffffffffffffffff);
            seedInput.value = String(w.value);
        }
    });
    seedRow.appendChild(randBtn);

    const decBtn = document.createElement("button");
    decBtn.textContent = "\u2212";
    decBtn.title = "Decrement seed";
    css(decBtn, "width:20px;height:20px;padding:0;background:#2a2a2a;color:#aaa;border:1px solid #444;border-radius:3px;cursor:pointer;font-size:12px;line-height:1;display:flex;align-items:center;justify-content:center;");
    decBtn.addEventListener("click", () => {
        const w = getSeedWidget(node);
        if (w) {
            w.value = Math.max(0, Number(w.value) - 1);
            seedInput.value = String(w.value);
        }
    });
    seedRow.appendChild(decBtn);

    const incBtn = document.createElement("button");
    incBtn.textContent = "+";
    incBtn.title = "Increment seed";
    css(incBtn, "width:20px;height:20px;padding:0;background:#2a2a2a;color:#aaa;border:1px solid #444;border-radius:3px;cursor:pointer;font-size:12px;line-height:1;display:flex;align-items:center;justify-content:center;");
    incBtn.addEventListener("click", () => {
        const w = getSeedWidget(node);
        if (w) {
            w.value = Math.min(0xffffffffffffffff, Number(w.value) + 1);
            seedInput.value = String(w.value);
        }
    });
    seedRow.appendChild(incBtn);

    container.appendChild(seedRow);

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
            if (output.seed !== undefined) {
                seedInput.value = String(output.seed);
            }
            if (output.preview_data) {
                currentPreviewData = output.preview_data;
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
        syncSeedFromWidget();
        return r;
    };

    syncSeedFromWidget();

    genWidget.computeSize = () => [node.size[0], Math.max(340, node.size[0] * 0.6)];
}
