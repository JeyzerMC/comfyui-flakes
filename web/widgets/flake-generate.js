import { css, setWidgetHidden, makeImageSection } from "../utils.js";
import { computeJobCount, getBatchImages, getBatchProgress, getLivePreview } from "../queue.js";
import { buildModel, openGenerationDataOverlay } from "./generation-data.js";

const ACCENT = "#4a9eff";

// `video`: Flake Generate Animation, whose results are videos read from
// flake_videos and whose chain comes in on flake_anim_data (#434).
export function setupFlakeGenerateWidget(node, { video = false } = {}) {
    if (!node.properties) node.properties = {};

    // Conditional optional widgets (#306): each toggle's sub-widgets only show
    // when it is on. The animation node has its own toggles (#438).
    const findWidget = (name) => node.widgets?.find((x) => x.name === name);
    const DEPS = video ? {
        upscale: ["upscale_model"],
        interpolate: ["interpolation_model"],
        use_headroom: ["headroom"],
    } : {
        adetailer: ["adetailer_denoise", "adetailer_steps", "adetailer_bbox"],
        upscale: ["upscale_model", "upscale_factor"],
    };
    function syncOptionalWidgets() {
        for (const [toggle, deps] of Object.entries(DEPS)) {
            const value = findWidget(toggle)?.value;
            const on = toggle === "adetailer" ? (value || "Off") !== "Off" : !!value;
            for (const n of deps) setWidgetHidden(findWidget(n), !on);
        }
        node.setSize([node.size[0], node.computeSize()[1]]);
        node.graph?.setDirtyCanvas(true, true);
    }
    for (const toggle of Object.keys(DEPS)) {
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
        const progress = getBatchProgress();
        if (progress?.total > 0) {
            doneLabel.textContent = `[${progress.completed}/${progress.total}] done`;
            doneLabel.style.display = "block";
        } else {
            doneLabel.style.display = "none";
        }
    }
    refreshJobCount();
    renderBatchProgress();
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
    genDataBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const flakeInput = node.inputs?.find(i => i.name === (video ? "flake_anim_data" : "flake_data"));
        const graph = node.graph;
        let startNode = null;
        if (flakeInput?.link && graph) {
            const link = graph.links[flakeInput.link];
            if (link) startNode = graph.getNodeById(link.origin_id);
        }
        // buildModel is async (fetches variant meta for All Variants cards, #345).
        const model = startNode ? await buildModel(startNode) : { axes: [], fixed: { presetName: null, stackFlakes: [] } };
        const adetailer = findWidget("adetailer")?.value || "Off";
        openGenerationDataOverlay(model, comboImages, {
            adetailer,
            adetailerDenoise: findWidget("adetailer_denoise")?.value,
            adetailerSteps: findWidget("adetailer_steps")?.value,
            adetailerBbox: findWidget("adetailer_bbox")?.value,
            upscale: !!findWidget("upscale")?.value,
            upscaleModel: findWidget("upscale_model")?.value,
            upscaleFactor: findWidget("upscale_factor")?.value,
            video,
        });
    });
    topRow.appendChild(genDataBtn);
    container.appendChild(topRow);

    // ── Image Display ──
    // Double-click the output image to reveal it in the OS file explorer (#329).
    let currentImage = null;
    let previewUrl = null; // live sampling preview shown instead of currentImage (#374)
    const reveal = () => {
        if (!currentImage) return;
        fetch("/flakes/reveal", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                filename: currentImage.filename,
                subfolder: currentImage.subfolder || "",
                type: currentImage.type || "output",
            }),
        }).catch((e) => console.error("[flakes] reveal failed", e));
    };
    const section = makeImageSection({ video, emptyText: video ? "No video generated yet" : "No image generated yet", onReveal: reveal });

    function outputRelPath(img) {
        if (!img || (img.type && img.type !== "output")) return "";
        const sub = (img.subfolder || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
        return sub ? `${sub}/${img.filename}` : img.filename;
    }

    function showImage(img) {
        currentImage = img;
        previewUrl = null;
        const rel = outputRelPath(img);
        section.show(`/view?filename=${encodeURIComponent(img.filename)}&type=${img.type || "output"}&subfolder=${encodeURIComponent(img.subfolder || "")}`, rel && img.filename, rel);
    }

    function clearImage() {
        previewUrl = null;
        section.clear();
    }

    // Live sampling preview (#374), shown until the result replaces it.
    function showPreview(url) {
        if (url === previewUrl) return;
        previewUrl = url;
        currentImage = null;
        section.showPreview(url);
    }

    container.appendChild(section.el);

    // Per-combo results: the live batch state when this workflow ran a batch,
    // else what the saved workflow carried (#373).
    // `preview` is the live sampling preview ({ url, comboKey }) or null (#374).
    function comboImages() {
        const images = getBatchImages(node) || {
            combo: node.properties._images_by_combo || {},
            ad: node.properties._images_by_combo_ad || {},
            ab: !!node.properties._adetailer_ab,
        };
        return { ...images, preview: getLivePreview(node) };
    }

    // Called by queue.js when batch results or the live preview change, and
    // after a workflow load. Mirrors batch results into properties so they are
    // saved with the workflow.
    node._flake_generate_render = function () {
        const entry = getBatchImages(node);
        if (entry) {
            node.properties._images_by_combo = entry.combo;
            node.properties._images_by_combo_ad = entry.ad;
            node.properties._adetailer_ab = entry.ab;
            if (entry.last) node.properties._last_image = entry.last;
        }
        const preview = getLivePreview(node);
        if (preview) {
            showPreview(preview.url);
            return;
        }
        const img = node.properties._last_image;
        if (img && (previewUrl || img !== currentImage)) showImage(img);
        else if (!img && previewUrl) clearImage();
    };

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
        const files = video ? output?.flake_videos : output?.flake_images;
        if (files && files.length > 0) {
            const img = files[0];
            showImage(img);
            node.properties._last_image = img;
            // Store ADetailer A/B outputs when present (#328).
            const isAB = Array.isArray(output.adetailer_ab) && output.adetailer_ab.length > 0;
            if (isAB && Array.isArray(output.flake_images_ad) && output.flake_images_ad.length > 0) {
                node.properties._last_image_ad = output.flake_images_ad[0];
                node.properties._adetailer_ab = true;
            } else {
                node.properties._last_image_ad = null;
                node.properties._adetailer_ab = false;
            }
            // Batch results are stored per combination by queue.js (from the
            // `executed` event, which carries the prompt_id). A plain run
            // replaces them with its own result under the empty key, so the
            // overlay shows it once its live preview ends (#374).
            if (!getBatchImages(node)) node.properties._images_by_combo = { "": img };
        } else if (files) {
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
