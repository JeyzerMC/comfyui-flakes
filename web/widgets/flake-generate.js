import { css } from "../utils.js";
import { computeJobCount } from "../queue.js";
import { buildModel, openGenerationDataOverlay } from "./generation-data.js";

const ACCENT = "#4a9eff";

export function setupFlakeGenerateWidget(node) {
    if (!node.properties) node.properties = {};

    const container = document.createElement("div");
    css(container, "display:flex;flex-direction:column;gap:4px;padding:4px 6px;font-size:12px;color:#ddd;");

    // ── Jobs label + Generation Data button (below the Seed section) ──
    const topRow = document.createElement("div");
    css(topRow, "display:flex;align-items:center;gap:8px;font-size:12px;color:#ddd;min-height:36px;");

    const jobsLabel = document.createElement("span");
    css(jobsLabel, "font-size:11px;font-weight:600;color:" + ACCENT + ";flex-shrink:0;");
    topRow.appendChild(jobsLabel);

    let lastJobCount = -1;
    function refreshJobCount() {
        const n = computeJobCount(node.graph);
        if (n === lastJobCount) return;
        lastJobCount = n;
        jobsLabel.textContent = `Jobs: ${n}`;
    }
    refreshJobCount();
    const jobsPoll = setInterval(refreshJobCount, 200);

    const genDataBtn = document.createElement("div");
    css(genDataBtn, `flex:1;background:#222;border:1px solid ${ACCENT}44;border-radius:8px;padding:8px 6px;cursor:pointer;transition:border-color 0.15s,background 0.15s;display:flex;align-items:center;justify-content:center;gap:6px;min-height:30px;box-sizing:border-box;`);
    const gdIcon = document.createElement("span");
    gdIcon.textContent = "📊";
    gdIcon.style.fontSize = "14px";
    genDataBtn.appendChild(gdIcon);
    const gdLabel = document.createElement("span");
    gdLabel.textContent = "Generation Data";
    css(gdLabel, `font-size:11px;font-weight:600;color:${ACCENT};`);
    genDataBtn.appendChild(gdLabel);
    genDataBtn.addEventListener("mouseenter", () => { genDataBtn.style.borderColor = ACCENT; genDataBtn.style.background = "#282828"; });
    genDataBtn.addEventListener("mouseleave", () => { genDataBtn.style.borderColor = ACCENT + "44"; genDataBtn.style.background = "#222"; });
    genDataBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const flakeInput = node.inputs?.find(i => i.name === "flake_data");
        const graph = node.graph;
        let startNode = null;
        if (flakeInput?.link && graph) {
            const link = graph.links[flakeInput.link];
            if (link) startNode = graph.getNodeById(link.origin_id);
        }
        const model = startNode ? buildModel(startNode) : { axes: [], fixed: { presetName: null, stackFlakes: [] } };
        openGenerationDataOverlay(model, node.properties._images_by_combo || {});
    });
    topRow.appendChild(genDataBtn);
    container.appendChild(topRow);

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

    // Read-only filename label (filename only, full path in tooltip) + dimensions
    const filenameLabel = document.createElement("div");
    css(filenameLabel, "width:100%;box-sizing:border-box;color:#ccc;padding:0 4px;font-size:12px;font-family:inherit;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:none;cursor:default;");
    imageContainer.appendChild(filenameLabel);

    const dimensionsLabel = document.createElement("div");
    css(dimensionsLabel, "width:100%;box-sizing:border-box;color:#888;padding:0 4px;font-size:11px;font-family:inherit;text-align:center;display:none;");
    imageContainer.appendChild(dimensionsLabel);

    function outputRelPath(img) {
        if (!img || (img.type && img.type !== "output")) return "";
        const sub = (img.subfolder || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
        return sub ? `${sub}/${img.filename}` : img.filename;
    }

    function showImage(img) {
        imageEl.src = `/view?filename=${encodeURIComponent(img.filename)}&type=${img.type || "output"}&subfolder=${encodeURIComponent(img.subfolder || "")}`;
        imageEl.style.display = "block";
        noImageLabel.style.display = "none";
        const rel = outputRelPath(img);
        if (rel) {
            const fileName = img.filename;
            filenameLabel.textContent = fileName;
            filenameLabel.title = rel;
            filenameLabel.style.display = "block";
        } else {
            filenameLabel.style.display = "none";
        }
        imageEl.onload = () => {
            if (imageEl.naturalWidth && imageEl.naturalHeight) {
                dimensionsLabel.textContent = `${imageEl.naturalWidth} × ${imageEl.naturalHeight}`;
                dimensionsLabel.style.display = "block";
            }
        };
        if (imageEl.complete && imageEl.naturalWidth) {
            dimensionsLabel.textContent = `${imageEl.naturalWidth} × ${imageEl.naturalHeight}`;
            dimensionsLabel.style.display = "block";
        }
    }

    function clearImage() {
        imageEl.style.display = "none";
        noImageLabel.style.display = "block";
        filenameLabel.style.display = "none";
        dimensionsLabel.style.display = "none";
    }

    container.appendChild(imageContainer);

    // ── Add DOM widget ──
    const genWidget = node.addDOMWidget("flake_generate_ui", "div", container, { serialize: false, margin: 4 });

    const origOnRemoved = node.onRemoved;
    node.onRemoved = function () {
        clearInterval(jobsPoll);
        return origOnRemoved?.apply(this, arguments);
    };

    const origOnExecuted = node.onExecuted;
    node.onExecuted = function (output) {
        const r = origOnExecuted?.apply(this, arguments);
        if (output && output.flake_images && output.flake_images.length > 0) {
            const img = output.flake_images[0];
            showImage(img);
            node.properties._last_image = img;
            // Record the generated image keyed by the active combination (set
            // by queue.js before this prompt) so the Generation Data overlay
            // can show it for that combination. Empty key = no combo nodes.
            const comboKey = node._pending_combination_key || "";
            node.properties._images_by_combo = node.properties._images_by_combo || {};
            node.properties._images_by_combo[comboKey] = img;
        } else if (output && output.flake_images) {
            clearImage();
        }
        return r;
    };

    const origOnConfigure = node.onConfigure;
    node.onConfigure = function () {
        const r = origOnConfigure?.apply(this, arguments);
        node._configured = true;
        if (node.properties?._last_image) {
            showImage(node.properties._last_image);
        } else {
            clearImage();
        }
        return r;
    };

    genWidget.computeSize = () => [node.size[0], Math.max(320, node.size[0] * 0.6)];
}
