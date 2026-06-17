import { css, setWidgetHidden } from "../utils.js";
import { computeJobCount } from "../queue.js";
import { buildModel, openGenerationDataOverlay } from "./generation-data.js";

const ACCENT = "#4a9eff";

export function setupFlakeGenerateWidget(node) {
    if (!node.properties) node.properties = {};

    // Conditional optional widgets (#306): the ADetailer/Upscale sub-widgets only
    // show when their toggle is on.
    const findWidget = (name) => node.widgets?.find((x) => x.name === name);
    const ADETAILER_DEPS = ["adetailer_denoise", "adetailer_steps", "adetailer_bbox"];
    const UPSCALE_DEPS = ["upscale_model", "upscale_factor"];
    function syncOptionalWidgets() {
        const adOn = !!findWidget("adetailer")?.value;
        const upOn = !!findWidget("upscale")?.value;
        for (const n of ADETAILER_DEPS) setWidgetHidden(findWidget(n), !adOn);
        for (const n of UPSCALE_DEPS) setWidgetHidden(findWidget(n), !upOn);
        node.setSize([node.size[0], node.computeSize()[1]]);
        node.graph?.setDirtyCanvas(true, true);
    }
    for (const toggle of ["adetailer", "upscale"]) {
        const tw = findWidget(toggle);
        if (!tw) continue;
        const cb = tw.callback;
        tw.callback = function () {
            const r = cb?.apply(this, arguments);
            syncOptionalWidgets();
            return r;
        };
    }
    // Defer once so all native widgets exist before first sync.
    setTimeout(syncOptionalWidgets, 0);

    const container = document.createElement("div");
    css(container, "display:flex;flex-direction:column;gap:4px;padding:4px 6px;font-size:12px;color:#ddd;");

    // ── Jobs label (+ done label) + Generation Data button (below the Seed section) ──
    const topRow = document.createElement("div");
    css(topRow, "display:flex;align-items:center;gap:8px;font-size:12px;color:#ddd;min-height:36px;");

    const jobsCol = document.createElement("div");
    css(jobsCol, "display:flex;flex-direction:column;gap:1px;flex:1;min-width:0;");
    topRow.appendChild(jobsCol);

    const jobsLabel = document.createElement("span");
    css(jobsLabel, "font-size:11px;font-weight:600;color:" + ACCENT + ";");
    jobsCol.appendChild(jobsLabel);

    const doneLabel = document.createElement("span");
    css(doneLabel, "font-size:10px;color:#888;");
    jobsCol.appendChild(doneLabel);

    let lastJobCount = -1;
    function refreshJobCount() {
        const n = computeJobCount(node.graph);
        if (n !== lastJobCount) {
            lastJobCount = n;
            jobsLabel.textContent = `Total jobs: ${n}`;
        }
    }
    function renderBatchProgress() {
        const total = node._batch_total_count ?? 0;
        const done = node._batch_completed_count ?? 0;
        if (total > 0) {
            doneLabel.textContent = `[${done}/${total}] done`;
            doneLabel.style.display = "block";
        } else {
            doneLabel.style.display = "none";
        }
    }
    refreshJobCount();
    renderBatchProgress();
    node._batch_progress_render = renderBatchProgress;
    const jobsPoll = setInterval(() => { refreshJobCount(); renderBatchProgress(); }, 200);

    // Generation Data button — width fits content (no flex:1) per #227.
    const genDataBtn = document.createElement("div");
    css(genDataBtn, `flex:0 0 auto;background:#222;border:1px solid ${ACCENT}44;border-radius:8px;padding:6px 10px;cursor:pointer;transition:border-color 0.15s,background 0.15s;display:inline-flex;align-items:center;gap:6px;min-height:30px;box-sizing:border-box;white-space:nowrap;`);
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
            // Per-combo storage is populated from queue.js via the `executed`
            // websocket event (which carries the correct prompt_id), so we no
            // longer write _images_by_combo here — doing so raced when the
            // batch loop advanced to the next combo before this fired.
            // For single-prompt (no combo) runs, still record under the empty
            // key as a safety net.
            if (!node.properties._images_by_combo || Object.keys(node.properties._images_by_combo).length === 0) {
                node.properties._images_by_combo = node.properties._images_by_combo || {};
                node.properties._images_by_combo[""] = img;
            }
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
