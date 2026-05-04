import { openOverlay } from "./modal.js";
import {
    css, makeButton, makeSmallButton, makeComfyLabel, makeComfyInput,
    makeComfyDropdown, makeSearchableDropdown, makeComfyNumberInput,
    makeComfyValueSlider, makeTextarea,
} from "./utils.js";
import { fetchPreset, fetchCheckpoints, fetchVaes, fetchEmbeddings } from "./api.js";
import { openFileBrowser } from "./pickers.js";
import { app } from "../../scripts/app.js";

export function openPresetEditModal({ mode, name, data, family = "SDXL/Base" }) {
    return new Promise((resolve) => {
        let { content, footer, close, handlers } = openOverlay();
        handlers.onClose = (v) => resolve(v ?? null);

        const title = document.createElement("h3");
        css(title, "margin:0 0 8px;font-size:16px;color:#fff;font-weight:500;");
        title.textContent = mode === "create" ? "New Model Preset" : `Edit ${name}`;
        content.appendChild(title);

        const FAMILY_OPTIONS = [
            { value: "SDXL/Base", label: "SDXL/Base" },
            { value: "SDXL/Illustrious", label: "SDXL/Illustrious" },
            { value: "SDXL/Pony", label: "SDXL/Pony" },
            { value: "ZImage/Base", label: "ZImage/Base" },
            { value: "ZImage/Turbo", label: "ZImage/Turbo" },
            { value: "Common", label: "Common" },
        ];

        let pathInput = null;
        let familyDropdown = null;
        if (mode === "create") {
            content.appendChild(makeComfyLabel("Model family"));
            familyDropdown = makeComfyDropdown(FAMILY_OPTIONS, family);
            content.appendChild(familyDropdown.container);

            content.appendChild(makeComfyLabel("Preset name"));
            pathInput = makeComfyInput("", "e.g. sdxl-juggernaut");
            content.appendChild(pathInput);
        } else {
            content.appendChild(makeComfyLabel("Preset name"));
            pathInput = makeComfyInput(name, "");
            content.appendChild(pathInput);
        }

        // Cover image
        let presetCoverFile = null;
        let presetCoverImg = null;
        const presetCoverWrap = document.createElement("div");
        css(presetCoverWrap, "display:flex;flex-direction:column;align-items:center;gap:4px;margin:8px 0;");

        const presetCoverBox = document.createElement("div");
        css(presetCoverBox, "width:120px;height:120px;border-radius:6px;background:#1a1a1a;border:1px solid #333;display:flex;align-items:center;justify-content:center;cursor:pointer;overflow:hidden;");

        presetCoverImg = document.createElement("img");
        css(presetCoverImg, "width:100%;height:100%;object-fit:cover;display:none;");
        presetCoverBox.appendChild(presetCoverImg);

        const presetCoverLabel = document.createElement("span");
        presetCoverLabel.textContent = "cover image";
        css(presetCoverLabel, "font-size:10px;color:#666;pointer-events:none;");
        presetCoverBox.appendChild(presetCoverLabel);

        const presetCoverInput = document.createElement("input");
        presetCoverInput.type = "file";
        presetCoverInput.accept = ".png,.jpg,.jpeg,.webp,.gif";
        presetCoverInput.style.display = "none";

        function updatePresetCoverPreview(src) {
            if (src) {
                presetCoverImg.src = src;
                presetCoverImg.style.display = "block";
                presetCoverLabel.style.display = "none";
            } else {
                presetCoverImg.style.display = "none";
                presetCoverLabel.style.display = "block";
            }
        }

        if (mode === "edit" && name) {
            updatePresetCoverPreview(`/flakes/preset_cover?name=${encodeURIComponent(name)}`);
        }

        presetCoverImg.addEventListener("error", () => {
            presetCoverImg.style.display = "none";
            presetCoverLabel.style.display = "block";
        });

        async function tryAutoCover(val) {
            if (!val || presetCoverFile || presetCoverImg.style.display === "block") return;
            try {
                const resp = await fetch(`/flakes/checkpoint_sibling_image?path=${encodeURIComponent(val)}`);
                if (resp.ok) {
                    const blob = await resp.blob();
                    const ctype = resp.headers.get("content-type") || "image/png";
                    const ext = ctype.includes("jpeg") ? ".jpg" : ctype.includes("webp") ? ".webp" : ctype.includes("gif") ? ".gif" : ".png";
                    presetCoverFile = new File([blob], `cover${ext}`, { type: ctype });
                    const url = URL.createObjectURL(blob);
                    updatePresetCoverPreview(url);
                }
            } catch { /* ignore */ }
        }

        presetCoverBox.addEventListener("click", () => presetCoverInput.click());
        presetCoverInput.addEventListener("change", () => {
            const file = presetCoverInput.files?.[0];
            if (file) {
                presetCoverFile = file;
                const reader = new FileReader();
                reader.onload = () => updatePresetCoverPreview(reader.result);
                reader.readAsDataURL(file);
            }
        });

        presetCoverWrap.appendChild(presetCoverBox);
        presetCoverWrap.appendChild(presetCoverInput);
        content.appendChild(presetCoverWrap);

        // Update close handler to upload cover
        const origPresetClose = close;
        close = async (value) => {
            if (value && (value.created || value.saved) && presetCoverFile) {
                try {
                    const form = new FormData();
                    form.append("file", presetCoverFile);
                    await fetch(`/flakes/preset_cover?name=${encodeURIComponent(value.name)}`, { method: "POST", body: form });
                } catch { /* ignore */ }
            }
            origPresetClose(value);
        };

        const ckptUrlInput = makeComfyInput(data.checkpoint_url || "", "https://civitai.com/models/...");
        ckptUrlInput.style.display = "none";

        const ckptLabelRow = document.createElement("div");
        css(ckptLabelRow, "display:flex;gap:6px;align-items:center;");
        const ckptLabel = makeComfyLabel("Checkpoint");
        ckptLabelRow.appendChild(ckptLabel);

        const ckptLinkIcon = document.createElement("a");
        ckptLinkIcon.textContent = "\uD83D\uDD17";
        css(ckptLinkIcon, "font-size:12px;text-decoration:none;cursor:pointer;display:none;color:#4a9eff;");
        ckptLinkIcon.addEventListener("click", (e) => {
            e.stopPropagation();
            const url = ckptUrlInput.value;
            if (url) window.open(url, "_blank");
        });
        ckptLabelRow.appendChild(ckptLinkIcon);

        const ckptUrlToggle = document.createElement("button");
        ckptUrlToggle.innerHTML = "&#9662;";
        css(ckptUrlToggle, "background:transparent;color:#888;border:none;padding:0;font-size:14px;cursor:pointer;line-height:1;display:flex;align-items:center;justify-content:center;height:20px;width:20px;");
        ckptUrlToggle.addEventListener("click", (e) => {
            e.stopPropagation();
            const showing = ckptUrlInput.style.display !== "none";
            ckptUrlInput.style.display = showing ? "none" : "block";
            ckptUrlToggle.innerHTML = showing ? "&#9662;" : "&#9652;";
        });
        ckptLabelRow.appendChild(ckptUrlToggle);
        content.appendChild(ckptLabelRow);

        content.appendChild(ckptUrlInput);

        const ckptWrap = makeSearchableDropdown([], data.checkpoint || "", "Select checkpoint...");

        const ckptBox = document.createElement("div");
        css(ckptBox, "background:#1a1a1a;color:#ddd;border:1px solid #333;padding:6px 8px;border-radius:6px;font-size:13px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;");
        ckptBox.textContent = data.checkpoint ? data.checkpoint.replace(/\.safetensors?$/i, "").split(/[\\/]/).pop() : "Select Checkpoint";

        const ckptRow = document.createElement("div");
        css(ckptRow, "display:flex;gap:4px;align-items:center;");
        ckptRow.appendChild(ckptBox);
        const ckptEditBtn = makeSmallButton("...");
        ckptEditBtn.title = "Type manually";
        ckptRow.appendChild(ckptEditBtn);
        content.appendChild(ckptRow);
        content.appendChild(ckptWrap.container);
        ckptWrap.container.style.display = "none";
        (async () => {
            try {
                const ckpts = await fetchCheckpoints();
                for (const c of ckpts) ckptWrap.datalist.appendChild(Object.assign(document.createElement("option"), { value: c }));
            } catch { /* ignore */ }
        })();

        ckptBox.addEventListener("click", async () => {
            const result = await openFileBrowser({ type: "checkpoints", defaultPath: "" });
            if (result && result.file) {
                ckptWrap.element.value = result.file;
                ckptWrap.element.dispatchEvent(new Event("change"));
            }
        });
        ckptEditBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            ckptBox.style.display = "none";
            ckptEditBtn.style.display = "none";
            ckptWrap.container.style.display = "block";
            ckptWrap.element.focus();
        });
        ckptWrap.element.addEventListener("change", () => {
            const val = ckptWrap.element.value;
            ckptBox.textContent = val ? val.replace(/\.safetensors?$/i, "").split(/[\\/]/).pop() : "Select Checkpoint";
            ckptBox.style.display = "block";
            ckptEditBtn.style.display = "inline-block";
            ckptWrap.container.style.display = "none";
            tryAutoCover(val);
        });
        ckptWrap.element.addEventListener("blur", () => {
            setTimeout(() => {
                const val = ckptWrap.element.value;
                ckptBox.textContent = val ? val.replace(/\.safetensors?$/i, "").split(/[\\/]/).pop() : "Select Checkpoint";
                ckptBox.style.display = "block";
                ckptEditBtn.style.display = "inline-block";
                ckptWrap.container.style.display = "none";
                tryAutoCover(val);
            }, 200);
        });

        function updateCkptUrlVisibility() {
            const hasUrl = !!ckptUrlInput.value;
            ckptLinkIcon.style.display = hasUrl ? "inline" : "none";
        }
        ckptUrlInput.addEventListener("change", updateCkptUrlVisibility);
        ckptUrlInput.addEventListener("input", updateCkptUrlVisibility);
        updateCkptUrlVisibility();

        const sliderRow = document.createElement("div");
        css(sliderRow, "display:flex;gap:8px;align-items:flex-start;");
        const csWrap = document.createElement("div");
        css(csWrap, "flex:1;min-width:0;");
        csWrap.appendChild(makeComfyLabel("Clip Skip"));
        const csSlider = makeComfyValueSlider(data.clip_skip ?? -2, -24, -1, 1);
        csWrap.appendChild(csSlider);
        sliderRow.appendChild(csWrap);
        const stepsWrap = document.createElement("div");
        css(stepsWrap, "flex:1;min-width:0;");
        stepsWrap.appendChild(makeComfyLabel("Steps"));
        const stepsSlider = makeComfyValueSlider(data.steps ?? 20, 1, 150, 1);
        stepsWrap.appendChild(stepsSlider);
        sliderRow.appendChild(stepsWrap);
        const cfgWrap = document.createElement("div");
        css(cfgWrap, "flex:1;min-width:0;");
        cfgWrap.appendChild(makeComfyLabel("CFG"));
        const cfgSlider = makeComfyValueSlider(data.cfg ?? 7.0, 1, 30, 0.5);
        cfgWrap.appendChild(cfgSlider);
        sliderRow.appendChild(cfgWrap);
        content.appendChild(sliderRow);

        content.appendChild(makeComfyLabel("VAE (optional)"));
        const vaeWrap = makeSearchableDropdown([], data.vae || "", "Select VAE...");
        content.appendChild(vaeWrap.container);
        (async () => {
            try {
                const vaes = await fetchVaes();
                for (const v of vaes) vaeWrap.datalist.appendChild(Object.assign(document.createElement("option"), { value: v }));
            } catch { /* ignore */ }
        })();

        const sampSchedRow = document.createElement("div");
        css(sampSchedRow, "display:flex;gap:8px;align-items:flex-start;");
        const sampWrap = document.createElement("div");
        css(sampWrap, "flex:1;min-width:0;");
        sampWrap.appendChild(makeComfyLabel("Sampler"));
        const samplerOpts = ["euler", "euler_ancestral", "heun", "heunpp2", "dpm_2", "dpm_2_ancestral", "lms", "dpm_fast", "dpm_adaptive", "dpmpp_2s_ancestral", "dpmpp_sde", "dpmpp_sde_gpu", "dpmpp_2m", "dpmpp_2m_sde", "dpmpp_2m_sde_gpu", "dpmpp_3m_sde", "dpmpp_3m_sde_gpu", "ddpm", "lcm", "ipndm", "ipndm_v", "deis", "res_multistep", "res_multistep_cfg", "res_multistep_turbo", "uni_pc", "uni_pc_bh2"].map(s => ({ value: s, label: s }));
        const samplerDD = makeComfyDropdown(samplerOpts, data.sampler || "euler");
        sampWrap.appendChild(samplerDD.container);
        sampSchedRow.appendChild(sampWrap);
        const schedWrap = document.createElement("div");
        css(schedWrap, "flex:1;min-width:0;");
        schedWrap.appendChild(makeComfyLabel("Scheduler"));
        const schedOpts = ["normal", "karras", "exponential", "sgm_uniform", "simple", "ddim_uniform"].map(s => ({ value: s, label: s }));
        const schedDD = makeComfyDropdown(schedOpts, data.scheduler || "karras");
        schedWrap.appendChild(schedDD.container);
        sampSchedRow.appendChild(schedWrap);
        content.appendChild(sampSchedRow);

        content.appendChild(makeComfyLabel("Resolution"));
        const resRow = document.createElement("div");
        css(resRow, "display:flex;gap:8px;align-items:center;");
        const wInput = makeComfyNumberInput(data.width ?? 1024, "1024", 64);
        const rLabel = document.createElement("span");
        rLabel.textContent = "\u00d7";
        css(rLabel, "color:#888;font-size:13px;");
        const hInput = makeComfyNumberInput(data.height ?? 1024, "1024", 64);
        resRow.appendChild(wInput);
        resRow.appendChild(rLabel);
        resRow.appendChild(hInput);
        content.appendChild(resRow);

        content.appendChild(makeComfyLabel("Positive embeddings"));
        const posEmbWrap = makeSearchableDropdown([], (data.embeddings?.positive || []).join(", "), "embedding1, embedding2...");
        content.appendChild(posEmbWrap.container);
        (async () => {
            try {
                const embs = await fetchEmbeddings();
                for (const e of embs) posEmbWrap.datalist.appendChild(Object.assign(document.createElement("option"), { value: e }));
            } catch { /* ignore */ }
        })();

        content.appendChild(makeComfyLabel("Negative embeddings"));
        const negEmbWrap = makeSearchableDropdown([], (data.embeddings?.negative || []).join(", "), "embedding1, embedding2...");
        content.appendChild(negEmbWrap.container);
        (async () => {
            try {
                const embs = await fetchEmbeddings();
                for (const e of embs) negEmbWrap.datalist.appendChild(Object.assign(document.createElement("option"), { value: e }));
            } catch { /* ignore */ }
        })();

        const prompt = data.prompt || {};
        content.appendChild(makeComfyLabel("Positive prompt"));
        const posTA = makeTextarea(prompt.positive || "", "masterpiece, best quality", 3);
        css(posTA, "background:#1a1a1a;color:#ddd;border:1px solid #333;padding:8px;border-radius:6px;font-size:13px;width:100%;box-sizing:border-box;font-family:inherit;resize:vertical;outline:none;");
        posTA.addEventListener("focus", () => posTA.style.borderColor = "#555");
        posTA.addEventListener("blur", () => posTA.style.borderColor = "#333");
        content.appendChild(posTA);

        content.appendChild(makeComfyLabel("Negative prompt"));
        const negTA = makeTextarea(prompt.negative || "", "worst quality, low quality", 3);
        css(negTA, "background:#1a1a1a;color:#ddd;border:1px solid #333;padding:8px;border-radius:6px;font-size:13px;width:100%;box-sizing:border-box;font-family:inherit;resize:vertical;outline:none;");
        negTA.addEventListener("focus", () => negTA.style.borderColor = "#555");
        negTA.addEventListener("blur", () => negTA.style.borderColor = "#333");
        content.appendChild(negTA);

        if (mode === "edit") {
            const delBtn = makeButton("Delete");
            css(delBtn, delBtn.style.cssText + "background:#5a2a2a;border-color:#7a3a3a;color:#fdd;margin-right:auto;");
            delBtn.addEventListener("click", async () => {
                if (!window.confirm(`Delete preset '${name}'?`)) return;
                try {
                    await fetch(`/flakes/presets/delete?name=${encodeURIComponent(name)}`, { method: "DELETE" });
                    close({ deleted: true, name });
                } catch (err) {
                    window.alert(`Delete failed: ${err.message}`);
                }
            });
            footer.appendChild(delBtn);
        }

        const cancelBtn = makeButton("Cancel");
        cancelBtn.addEventListener("click", () => close(undefined));
        footer.appendChild(cancelBtn);

        const saveBtn = makeButton("Save", true);
        saveBtn.addEventListener("click", async () => {
            const ordered = {
                checkpoint: ckptWrap.element.value,
                checkpoint_url: ckptUrlInput.value || "",
                clip_skip: csSlider.getValue(),
                vae: vaeWrap.element.value || null,
                steps: stepsSlider.getValue(),
                cfg: cfgSlider.getValue(),
                sampler: samplerDD.element.value,
                scheduler: schedDD.element.value,
                width: parseInt(wInput.value) || 1024,
                height: parseInt(hInput.value) || 1024,
                prompt: { positive: posTA.value, negative: negTA.value },
                embeddings: {
                    positive: posEmbWrap.element.value.split(",").map(s => s.trim()).filter(Boolean),
                    negative: negEmbWrap.element.value.split(",").map(s => s.trim()).filter(Boolean),
                },
            };

            try {
                const pName = (pathInput.value || "").trim();
                if (!pName) { window.alert("Preset name is required"); return; }
                const family = familyDropdown?.element?.value || "";
                if (mode === "create") {
                    await fetch("/flakes/presets/save", {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ name: pName, data: ordered, family: family || undefined }),
                    });
                    close({ created: true, name: pName });
                } else {
                    if (pName !== name) {
                        // Rename: save under new name, delete old
                        await fetch("/flakes/presets/save", {
                            method: "PUT",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ name: pName, data: ordered }),
                        });
                        await fetch(`/flakes/presets/delete?name=${encodeURIComponent(name)}`, { method: "DELETE" });
                        close({ saved: true, name: pName, oldName: name });
                    } else {
                        await fetch("/flakes/presets/save", {
                            method: "PUT",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ name, data: ordered }),
                        });
                        close({ saved: true, name });
                    }
                }
            } catch (err) {
                window.alert(`Save failed: ${err.message || err}`);
            }
        });
        footer.appendChild(saveBtn);

        setTimeout(() => { (pathInput || ckptWrap.element).focus(); }, 0);
    });
}

export async function refreshPresetOptions(family = "") {
    try {
        // Fetch presets for all unique families used by nodes, plus the requested family
        const familyMap = new Map();
        for (const n of app.graph.nodes) {
            if (n.type !== "FlakeModelPreset" && n.type !== "FlakeModelCombo") continue;
            const fw = n.widgets?.find(w => w.name === "model_family");
            const nodeFamily = fw?.value || family || "";
            if (!familyMap.has(nodeFamily)) {
                const query = nodeFamily ? `?family=${encodeURIComponent(nodeFamily)}` : "";
                const r = await fetch(`/flakes/presets${query}`, { cache: "no-store" });
                const d = await r.json();
                const names = d.presets || [];
                const newValues = names.length ? ["Select a preset...", ...names] : ["No model preset is selected"];
                familyMap.set(nodeFamily, newValues);
            }
        }

        // Also fetch for the explicitly requested family if no nodes exist yet
        if (family && !familyMap.has(family)) {
            const query = `?family=${encodeURIComponent(family)}`;
            const r = await fetch(`/flakes/presets${query}`, { cache: "no-store" });
            const d = await r.json();
            const names = d.presets || [];
            const newValues = names.length ? ["Select a preset...", ...names] : ["No model preset is selected"];
            familyMap.set(family, newValues);
        }

        for (const n of app.graph.nodes) {
            if (n.type !== "FlakeModelPreset" && n.type !== "FlakeModelCombo") continue;
            const pw = n.widgets?.find(w => w.name === "preset");
            if (!pw || !pw.options) continue;
            const fw = n.widgets?.find(w => w.name === "model_family");
            const nodeFamily = fw?.value || "";
            const newValues = familyMap.get(nodeFamily) || familyMap.get("") || ["No model preset is selected"];
            pw.options.values = newValues;

            // Update the widget value list that ComfyUI/LiteGraph uses internally
            if (pw.options.values) {
                pw.options.values = newValues;
            }

            // Try multiple ways to find the <select> element in case ComfyUI wraps it
            let selectEl = pw.inputEl || pw.element;
            if (!selectEl || selectEl.tagName !== "SELECT") {
                // Search within the node's DOM for the select
                const widgetEl = n.widgets?.find(w => w.name === "preset")?.inputEl;
                if (widgetEl && widgetEl.tagName === "SELECT") {
                    selectEl = widgetEl;
                }
            }
            if (!selectEl || selectEl.tagName !== "SELECT") {
                // Last resort: search the node's HTML element
                if (n.htmlEl) {
                    selectEl = n.htmlEl.querySelector('select');
                }
            }

            if (selectEl && selectEl.tagName === "SELECT") {
                selectEl.replaceChildren();
                for (const v of newValues) {
                    const opt = document.createElement("option");
                    opt.value = v;
                    opt.textContent = v;
                    selectEl.appendChild(opt);
                }
                if (!newValues.includes(pw.value)) {
                    pw.value = newValues[0] || "";
                }
                selectEl.value = pw.value;
            }

            // Force ComfyUI to redraw the widget
            if (pw.callback) {
                try { pw.callback(pw.value); } catch { /* ignore */ }
            }
            if (n.setDirtyCanvas) {
                n.setDirtyCanvas(true, true);
            }

            // Trigger preset UI re-render if the node has a custom renderer
            if (n._preset_render) {
                try { n._preset_render(); } catch { /* ignore */ }
            }
        }
    } catch (err) {
        console.error("[flakes] failed to refresh preset options:", err);
    }
}

export function addPresetButtonToParent(parent) {
    if (!parent || parent.querySelector(".flake-preset-new-btn")) return false;

    const btn = document.createElement("button");
    btn.className = "flake-preset-new-btn";
    btn.title = "Create or edit model preset";
    btn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
             fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 5v14M5 12h14"/>
        </svg>`;
    css(btn, `
        display:inline-flex;align-items:center;justify-content:center;
        width:32px;height:32px;padding:0;margin:0;
        background:#1f1f1f;color:#aaa;
        border:none;border-left:1px solid #444;
        border-radius:0 6px 6px 0;
        cursor:pointer;flex-shrink:0;
        transition:background 0.15s ease;
    `);
    btn.addEventListener("mouseenter", () => { btn.style.background = "#2a2a2a"; });
    btn.addEventListener("mouseleave", () => { btn.style.background = "#1f1f1f"; });
    btn.addEventListener("click", handlePresetButton);
    btn.addEventListener("dblclick", (e) => e.stopPropagation());
    btn.addEventListener("mousedown", (e) => e.stopPropagation());

    parent.style.display = "flex";
    parent.style.alignItems = "center";
    parent.appendChild(btn);
    return true;
}

export function attachPresetButton(node) {
    let attachedAny = false;
    const presetWidget = node.widgets?.find(w => w.name === "preset");
    if (!presetWidget) return false;

    let presetEl = presetWidget.element || presetWidget.inputEl;
    if (presetEl?.parentElement) {
        if (addPresetButtonToParent(presetEl.parentElement)) attachedAny = true;
    }
    const byAria = document.querySelectorAll('[aria-label="preset"]');
    for (const el of byAria) {
        const parent = el.parentElement;
        if (parent && addPresetButtonToParent(parent)) attachedAny = true;
    }
    const allSelects = document.querySelectorAll("select");
    for (const sel of allSelects) {
        const firstOpt = sel.options[0];
        if (!firstOpt) continue;
        const text = firstOpt.text || firstOpt.label || firstOpt.value || "";
        if (!text.includes("Select a preset") && !text.includes("No model preset")) continue;
        if (sel.parentElement && addPresetButtonToParent(sel.parentElement)) attachedAny = true;
    }
    return attachedAny;
}

export async function handlePresetButton(e) {
    if (e) e.stopPropagation();
    let current = "";
    let currentFamily = "";
    for (const n of app.graph.nodes) {
        if (n.type !== "FlakeModelPreset") continue;
        const pw = n.widgets?.find(w => w.name === "preset");
        const fw = n.widgets?.find(w => w.name === "model_family");
        if (pw) { current = pw.value || ""; }
        if (fw) { currentFamily = fw.value || ""; }
        if (pw) break;
    }
    const isPlaceholder = !current || current === "Select a preset..." || current === "No model preset is selected";

    if (isPlaceholder) {
        const result = await openPresetEditModal({
            mode: "create",
            data: {
                checkpoint: "",
                checkpoint_url: "",
                clip_skip: -2,
                vae: "",
                steps: 20,
                cfg: 4.0,
                sampler: "dpmpp_2m",
                scheduler: "karras",
                width: 832,
                height: 1216,
                prompt: { positive: "", negative: "" },
                embeddings: [],
            },
        });
        if (result) refreshPresetOptions(currentFamily);
    } else {
        let data;
        try {
            data = await fetchPreset(current);
        } catch (err) {
            window.alert(`Failed to load preset '${current}': ${err.message || err}`);
            return;
        }
        const result = await openPresetEditModal({
            mode: "edit",
            name: current,
            data,
        });
        if (result) refreshPresetOptions(currentFamily);
    }
}
