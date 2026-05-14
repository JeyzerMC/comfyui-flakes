import { openOverlay } from "./modal.js";
import {
    css, makeButton, makeComfyLabel, makeComfyInput,
    makeComfyDropdown, makeSearchableDropdown, makeComfySlider,
    makeTextarea,
} from "./utils.js";
import { fetchPreset, fetchCheckpoints, fetchVaes, fetchEmbeddings } from "./api.js";
import { openFileBrowser } from "./pickers.js";
import { app } from "../../scripts/app.js";

export function openPresetEditModal({ mode, name, data, family = "SDXL/Base" }) {
    return new Promise((resolve) => {
        let { content, footer, close, handlers, panel } = openOverlay();
        handlers.onClose = (v) => resolve(v ?? null);

        let dirty = false;
        const markDirty = () => { dirty = true; };
        panel.addEventListener("input", markDirty, true);
        panel.addEventListener("change", markDirty, true);
        handlers.confirmCancel = async () => {
            if (!dirty) return true;
            return window.confirm("Are you sure you want to cancel? Unsaved changes will be lost.");
        };

        const title = document.createElement("h3");
        css(title, "margin:0 0 8px;font-size:16px;color:#fff;font-weight:500;");
        title.textContent = mode === "create" ? "New Model Preset" : `Edit ${name}`;
        content.appendChild(title);

        let pathInput = null;
        let nameInput = null;
        let filenamePrefixInput = null;
        let baseRootDropdown = null;
        let availableRoots = [];
        let resolvedPathLabel = null;

        const FAMILY_FROM_FOLDER = {
            sdxl: "SDXL/Base",
            illustrious: "SDXL/Illustrious",
            pony: "SDXL/Pony",
            zib: "ZImage/Base",
            zit: "ZImage/Turbo",
            common: "Common",
        };

        function stripPresetPrefix(p) {
            const parts = p.replace(/\\/g, "/").split("/");
            if (parts[0] === "img" && parts.length >= 3 && FAMILY_FROM_FOLDER[parts[1]]) return parts.slice(2).join("/");
            if (parts.length >= 2 && FAMILY_FROM_FOLDER[parts[0]]) return parts.slice(1).join("/");
            return p;
        }

        const nameRow = document.createElement("div");
        css(nameRow, "display:flex;gap:8px;align-items:flex-start;");
        const nameWrap = document.createElement("div");
        css(nameWrap, "flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;");
        nameWrap.appendChild(makeComfyLabel("Preset name"));
        nameInput = makeComfyInput(mode === "create" ? "" : (data?.display_name || name), mode === "create" ? "e.g. WAI Illustrious V17" : "");
        nameWrap.appendChild(nameInput);
        nameRow.appendChild(nameWrap);
        const prefixWrap = document.createElement("div");
        css(prefixWrap, "flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;");
        prefixWrap.appendChild(makeComfyLabel("Filename prefix"));
        filenamePrefixInput = makeComfyInput(data?.filename_prefix || "", "wai_illustrious_v17");
        prefixWrap.appendChild(filenamePrefixInput);
        nameRow.appendChild(prefixWrap);
        content.appendChild(nameRow);

        // Base path + output path on same line.
        const pathRow = document.createElement("div");
        css(pathRow, "display:flex;gap:8px;align-items:flex-start;");
        const basePathWrap = document.createElement("div");
        css(basePathWrap, "flex:0 0 auto;min-width:0;display:flex;flex-direction:column;gap:4px;");
        basePathWrap.appendChild(makeComfyLabel("Base"));
        const baseRootSelect = document.createElement("select");
        css(baseRootSelect, "background:#1a1a1a;color:#ddd;border:1px solid #333;padding:6px 8px;border-radius:6px;font-size:13px;box-sizing:border-box;");
        basePathWrap.appendChild(baseRootSelect);
        pathRow.appendChild(basePathWrap);
        const pathWrap = document.createElement("div");
        css(pathWrap, "flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;");
pathWrap.appendChild(makeComfyLabel("Output path"));
            pathInput = makeComfyInput("", "nova_anime_xl_v18");
            pathWrap.appendChild(pathInput);
            resolvedPathLabel = document.createElement("div");
            css(resolvedPathLabel, "font-size:10px;color:#666;margin-top:2px;word-break:break-all;");
            pathWrap.appendChild(resolvedPathLabel);
            pathRow.appendChild(pathWrap);
        content.appendChild(pathRow);

        function updateResolvedPath() {
            const raw = (pathInput?.value || "").trim();
            if (!raw) {
                resolvedPathLabel.textContent = "";
                return;
            }
            const rootIdx = parseInt(baseRootSelect?.value || "0", 10);
            const root = availableRoots[rootIdx] || availableRoots[0];
            const rootPart = root ? (root.path || "").replace(/\\/g, "/").replace(/\/+$/, "") + "/" : "C:/<comfy>/model_presets/";
            const folder = familyFolderLocal(family);
            const familyPrefix = folder ? `img/${folder}/` : "";
            const fullPath = `${rootPart}${familyPrefix}${raw}.yaml`;
            resolvedPathLabel.textContent = fullPath;
        }

        // pathManuallyEdited: once true, stop auto-syncing from name/family.
        let pathManuallyEdited = mode !== "create";
        pathInput.addEventListener("input", () => { pathManuallyEdited = true; updateResolvedPath(); });

        function familyFolderLocal(fam) {
            const map = {
                "SDXL/Base": "sdxl",
                "SDXL/Illustrious": "illustrious",
                "SDXL/Pony": "pony",
                "ZImage/Base": "zib",
                "ZImage/Turbo": "zit",
                "Common": "common",
            };
            return map[fam] || "";
        }

        function snake(s) {
            return (s || "").trim().replace(/[\s/]+/g, "_").replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase();
        }

        function syncOutputPath() {
            const stem = snake(nameInput.value);
            if (!pathManuallyEdited) pathInput.value = stem;
            filenamePrefixInput.value = stem;
            updateResolvedPath();
        }
        nameInput.addEventListener("input", syncOutputPath);

        // Seed output path from the existing preset name in edit mode.
        if (mode !== "create" && name) {
            pathInput.value = stripPresetPrefix(name);
            updateResolvedPath();
        }

        (async () => {
            try {
                const r = await fetch("/flakes/roots?type=model_presets");
                const d = await r.json();
                availableRoots = d.roots || [];
                baseRootSelect.replaceChildren();
                for (const root of availableRoots) {
                    const opt = document.createElement("option");
                    opt.value = String(root.index);
                    const driveLetter = (root.path || "").replace(/\\/g, "/").match(/^\/?([A-Za-z]:)/)?.[1] || "";
                    opt.textContent = driveLetter ? `${root.label} (${driveLetter})` : root.label;
                    opt.title = `${root.label}: ${root.path}`;
                    baseRootSelect.appendChild(opt);
                }
                if (!availableRoots.length) {
                    const opt = document.createElement("option");
                    opt.textContent = "(no roots configured)";
                    opt.value = "0";
                    baseRootSelect.appendChild(opt);
                }
                if (mode === "create" && !pathManuallyEdited) syncOutputPath();
                updateResolvedPath();
            } catch { /* ignore */ }
        })();

        baseRootSelect.addEventListener("change", updateResolvedPath);

        // Cover image
        let presetCoverFile = null;
        let presetCoverImg = null;
        const presetCoverWrap = document.createElement("div");
        css(presetCoverWrap, "display:flex;flex-direction:column;align-items:center;gap:4px;margin:8px 0;");

        const presetCoverBox = document.createElement("div");
        css(presetCoverBox, "width:140px;height:200px;border-radius:6px;background:#1a1a1a;border:1px solid #333;display:flex;align-items:center;justify-content:center;cursor:pointer;overflow:hidden;flex-shrink:0;");

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
                    updatePresetCoverPreview(`/flakes/checkpoint_sibling_image?path=${encodeURIComponent(val)}`);
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
        // presetCoverWrap is appended below alongside the Checkpoint column.

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

        // Two-column row: Checkpoint (and its URL toggle) on the left,
        // Cover Image preview on the right.
        const ckptCoverRow = document.createElement("div");
        css(ckptCoverRow, "display:flex;gap:12px;align-items:flex-start;margin-top:8px;");
        const ckptCol = document.createElement("div");
        css(ckptCol, "flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;");
        ckptCoverRow.appendChild(ckptCol);
        ckptCoverRow.appendChild(presetCoverWrap);
        content.appendChild(ckptCoverRow);

        const ckptUrlInput = makeComfyInput(data.checkpoint_url || "", "https://civitai.com/models/...");
        ckptUrlInput.style.display = "none";

        const ckptLabelRow = document.createElement("div");
        css(ckptLabelRow, "display:flex;gap:2px;align-items:center;");
        const ckptLabel = makeComfyLabel("Checkpoint");
        css(ckptLabel, "margin:0;");
        ckptLabelRow.appendChild(ckptLabel);

        const ckptLinkIcon = document.createElement("a");
        ckptLinkIcon.textContent = "\uD83D\uDD17";
        css(ckptLinkIcon, "font-size:12px;text-decoration:none;cursor:pointer;display:none;color:#4a9eff;align-items:center;vertical-align:middle;");
        ckptLinkIcon.addEventListener("click", (e) => {
            e.stopPropagation();
            const url = ckptUrlInput.value;
            if (url) window.open(url, "_blank");
        });
        ckptLabelRow.appendChild(ckptLinkIcon);

        const ckptUrlToggle = document.createElement("button");
        ckptUrlToggle.innerHTML = "&#9662;";
        css(ckptUrlToggle, "background:transparent;color:#888;border:none;padding:0;font-size:12px;cursor:pointer;line-height:1;display:flex;align-items:center;justify-content:center;height:16px;width:16px;");
        ckptUrlToggle.addEventListener("click", (e) => {
            e.stopPropagation();
            const showing = ckptUrlInput.style.display !== "none";
            ckptUrlInput.style.display = showing ? "none" : "block";
            ckptUrlToggle.innerHTML = showing ? "&#9662;" : "&#9652;";
        });
        ckptLabelRow.appendChild(ckptUrlToggle);
        ckptCol.appendChild(ckptLabelRow);

        ckptCol.appendChild(ckptUrlInput);

        const ckptWrap = makeSearchableDropdown([], data.checkpoint || "", "Select checkpoint...");

        const ckptBox = document.createElement("div");
        css(ckptBox, "background:#1a1a1a;color:#ddd;border:1px solid #333;padding:6px 8px;border-radius:6px;font-size:13px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0;");
        ckptBox.textContent = data.checkpoint ? data.checkpoint.replace(/\.safetensors?$/i, "").split(/[\\/]/).pop() : "Select Checkpoint";

        ckptCol.appendChild(ckptBox);
        ckptCol.appendChild(ckptWrap.container);
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
        ckptWrap.element.addEventListener("change", () => {
            const val = ckptWrap.element.value;
            ckptBox.textContent = val ? val.replace(/\.safetensors?$/i, "").split(/[\\/]/).pop() : "Select Checkpoint";
            ckptWrap.container.style.display = "none";
            tryAutoCover(val);
        });
        ckptWrap.element.addEventListener("blur", () => {
            setTimeout(() => {
                const val = ckptWrap.element.value;
                ckptBox.textContent = val ? val.replace(/\.safetensors?$/i, "").split(/[\\/]/).pop() : "Select Checkpoint";
                ckptWrap.container.style.display = "none";
                tryAutoCover(val);
            }, 200);
        });

        function updateCkptUrlVisibility() {
            const hasUrl = !!ckptUrlInput.value;
            ckptLinkIcon.style.display = hasUrl ? "inline-flex" : "none";
        }
        ckptUrlInput.addEventListener("change", updateCkptUrlVisibility);
        ckptUrlInput.addEventListener("input", updateCkptUrlVisibility);
        updateCkptUrlVisibility();

        const vaeSampRow = document.createElement("div");
        css(vaeSampRow, "display:flex;gap:8px;align-items:flex-start;");
        const vaeColWrap = document.createElement("div");
        css(vaeColWrap, "flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;");
        vaeColWrap.appendChild(makeComfyLabel("VAE (optional)"));
        const vaeWrap = makeSearchableDropdown([], data.vae || "", "Select VAE...");
        vaeColWrap.appendChild(vaeWrap.container);
        vaeSampRow.appendChild(vaeColWrap);
        const sampColWrap = document.createElement("div");
        css(sampColWrap, "flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;");
        sampColWrap.appendChild(makeComfyLabel("Sampler"));
        const samplerOpts = ["euler", "euler_ancestral", "heun", "heunpp2", "dpm_2", "dpm_2_ancestral", "lms", "dpm_fast", "dpm_adaptive", "dpmpp_2s_ancestral", "dpmpp_sde", "dpmpp_sde_gpu", "dpmpp_2m", "dpmpp_2m_sde", "dpmpp_2m_sde_gpu", "dpmpp_3m_sde", "dpmpp_3m_sde_gpu", "ddpm", "lcm", "ipndm", "ipndm_v", "deis", "res_multistep", "res_multistep_cfg", "res_multistep_turbo", "uni_pc", "uni_pc_bh2"].map(s => ({ value: s, label: s }));
        const samplerDD = makeComfyDropdown(samplerOpts, data.sampler || "euler");
        sampColWrap.appendChild(samplerDD.container);
        vaeSampRow.appendChild(sampColWrap);
        ckptCol.appendChild(vaeSampRow);
        const teSchedRow = document.createElement("div");
        css(teSchedRow, "display:flex;gap:8px;align-items:flex-start;");
        const teColWrap = document.createElement("div");
        css(teColWrap, "flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;");
        teColWrap.appendChild(makeComfyLabel("Text Encoder (optional)"));
        const teWrap = makeSearchableDropdown([], data.text_encoder || "", "Select text encoder...");
        teColWrap.appendChild(teWrap.container);
        teSchedRow.appendChild(teColWrap);
        const schedColWrap = document.createElement("div");
        css(schedColWrap, "flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;");
        schedColWrap.appendChild(makeComfyLabel("Scheduler"));
        const schedOpts = ["normal", "karras", "exponential", "sgm_uniform", "simple", "ddim_uniform"].map(s => ({ value: s, label: s }));
        const schedDD = makeComfyDropdown(schedOpts, data.scheduler || "karras");
        schedColWrap.appendChild(schedDD.container);
        teSchedRow.appendChild(schedColWrap);
        ckptCol.appendChild(teSchedRow);
        (async () => {
            try {
                const vaes = await fetchVaes();
                for (const v of vaes) vaeWrap.datalist.appendChild(Object.assign(document.createElement("option"), { value: v }));
            } catch { /* ignore */ }
            try {
                const r = await fetch("/flakes/text_encoders");
                const d = await r.json();
                const tes = d.text_encoders || [];
                for (const t of tes) teWrap.datalist.appendChild(Object.assign(document.createElement("option"), { value: t }));
            } catch { /* ignore */ }
        })();

        const numRow = document.createElement("div");
        css(numRow, "display:flex;gap:8px;align-items:flex-start;margin-top:-6px;");
        const wWrap = document.createElement("div");
        css(wWrap, "flex:1;min-width:0;");
        wWrap.appendChild(makeComfyLabel("Width"));
        const wSlider = makeComfySlider(data.width ?? 1024, 64, 4096, 64);
        wWrap.appendChild(wSlider);
        numRow.appendChild(wWrap);
        const hWrap = document.createElement("div");
        css(hWrap, "flex:1;min-width:0;");
        hWrap.appendChild(makeComfyLabel("Height"));
        const hSlider = makeComfySlider(data.height ?? 1024, 64, 4096, 64);
        hWrap.appendChild(hSlider);
        numRow.appendChild(hWrap);
        const csWrap = document.createElement("div");
        css(csWrap, "flex:1;min-width:0;");
        csWrap.appendChild(makeComfyLabel("Clip Skip"));
        const csSlider = makeComfySlider(Math.abs(data.clip_skip ?? -2), 1, 24, 1);
        csWrap.appendChild(csSlider);
        numRow.appendChild(csWrap);
        const stepsWrap = document.createElement("div");
        css(stepsWrap, "flex:1;min-width:0;");
        stepsWrap.appendChild(makeComfyLabel("Steps"));
        const stepsSlider = makeComfySlider(data.steps ?? 20, 1, 150, 1);
        stepsWrap.appendChild(stepsSlider);
        numRow.appendChild(stepsWrap);
        const cfgWrap = document.createElement("div");
        css(cfgWrap, "flex:1;min-width:0;");
        cfgWrap.appendChild(makeComfyLabel("CFG"));
        const cfgSlider = makeComfySlider(data.cfg ?? 7.0, 1, 30, 0.5);
        cfgWrap.appendChild(cfgSlider);
        numRow.appendChild(cfgWrap);
        content.appendChild(numRow);

        const embRow = document.createElement("div");
        css(embRow, "display:flex;gap:8px;align-items:flex-start;");
        const posEmbCol = document.createElement("div");
        css(posEmbCol, "flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;");
        posEmbCol.appendChild(makeComfyLabel("Positive embeddings"));
        const posEmbWrap = makeSearchableDropdown([], (data.embeddings?.positive || []).join(", "), "embedding1, embedding2...");
        posEmbCol.appendChild(posEmbWrap.container);
        embRow.appendChild(posEmbCol);
        const negEmbCol = document.createElement("div");
        css(negEmbCol, "flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;");
        negEmbCol.appendChild(makeComfyLabel("Negative embeddings"));
        const negEmbWrap = makeSearchableDropdown([], (data.embeddings?.negative || []).join(", "), "embedding1, embedding2...");
        negEmbCol.appendChild(negEmbWrap.container);
        embRow.appendChild(negEmbCol);
        content.appendChild(embRow);
        (async () => {
            try {
                const embs = await fetchEmbeddings();
                for (const e of embs) posEmbWrap.datalist.appendChild(Object.assign(document.createElement("option"), { value: e }));
            } catch { /* ignore */ }
        })();
        (async () => {
            try {
                const embs = await fetchEmbeddings();
                for (const e of embs) negEmbWrap.datalist.appendChild(Object.assign(document.createElement("option"), { value: e }));
            } catch { /* ignore */ }
        })();

        const prompt = data.prompt || {};
        content.appendChild(makeComfyLabel("Positive prompt"));
        const posTA = makeTextarea(prompt.positive || "", "masterpiece, best quality", 3);
        css(posTA, "background:#1a1a1a;color:#ddd;border:1px solid #333;padding:8px;border-radius:6px;font-size:13px;width:100%;box-sizing:border-box;font-family:inherit;resize:vertical;outline:none;min-height:78px;flex-shrink:0;");
        posTA.addEventListener("focus", () => posTA.style.borderColor = "#555");
        posTA.addEventListener("blur", () => posTA.style.borderColor = "#333");
        content.appendChild(posTA);

        content.appendChild(makeComfyLabel("Negative prompt"));
        const negTA = makeTextarea(prompt.negative || "", "worst quality, low quality", 3);
        css(negTA, "background:#1a1a1a;color:#ddd;border:1px solid #333;padding:8px;border-radius:6px;font-size:13px;width:100%;box-sizing:border-box;font-family:inherit;resize:vertical;outline:none;min-height:78px;flex-shrink:0;");
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
        cancelBtn.addEventListener("click", async () => {
            if (dirty && !window.confirm("Are you sure you want to cancel? Unsaved changes will be lost.")) return;
            close(undefined);
        });
        footer.appendChild(cancelBtn);

        const saveBtn = makeButton("Save", true);
        saveBtn.addEventListener("click", async () => {
            const ordered = {
                display_name: (nameInput.value || "").trim() || undefined,
                filename_prefix: (filenamePrefixInput.value || "").trim() || undefined,
                checkpoint: ckptWrap.element.value,
                checkpoint_url: ckptUrlInput.value || "",
                clip_skip: -Math.abs(csSlider.getValue()),
                vae: vaeWrap.element.value || null,
                text_encoder: teWrap.element.value || null,
                steps: stepsSlider.getValue(),
                cfg: cfgSlider.getValue(),
                sampler: samplerDD.element.value,
                scheduler: schedDD.element.value,
                width: wSlider.getValue(),
                height: hSlider.getValue(),
                prompt: { positive: posTA.value, negative: negTA.value },
                embeddings: {
                    positive: posEmbWrap.element.value.split(",").map(s => s.trim()).filter(Boolean),
                    negative: negEmbWrap.element.value.split(",").map(s => s.trim()).filter(Boolean),
                },
            };
            // Drop undefined keys so the YAML stays clean
            for (const k of Object.keys(ordered)) if (ordered[k] === undefined) delete ordered[k];

            try {
                const outputPath = (pathInput.value || "").trim();
                if (!outputPath) { window.alert("Output path is required"); return; }
                const baseRootIndex = parseInt(baseRootSelect.value, 10);
                const body = {
                    name: outputPath,
                    data: ordered,
                    family: family || undefined,
                    base_root_index: Number.isFinite(baseRootIndex) ? baseRootIndex : 0,
                    output_path: outputPath,
                };
                if (mode !== "create") body.old_name = name;
                const r = await fetch("/flakes/presets/save", {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(body),
                });
                if (!r.ok) {
                    const err = await r.json().catch(() => ({}));
                    throw new Error(err.error || `HTTP ${r.status}`);
                }
                const savedName = (await r.json()).name || outputPath;
                if (mode === "create") {
                    close({ created: true, name: savedName });
                } else {
                    close({ saved: true, name: savedName, oldName: name !== savedName ? name : undefined });
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
