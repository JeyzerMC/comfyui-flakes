import { openOverlay } from "./modal.js";
import {
    css, makeButton, makeSmallButton, makeComfyLabel, makeComfyInput,
    makeComfyDropdown, makePanelDropdown, makeSearchableDropdown,
    makeComfyNumberInput, makeComfyValueSlider, makeSmallValueSlider,
    makeTextarea, makeLabel, makeNumberInput, attachAutoGrow,
    familyFolder, makeHoverRemoveWrapper, CN_MODEL_MAP,
} from "./utils.js";
import {
    getCoverUrl, getVariantImageUrl, uploadCover, fetchLoras, fetchCnTypes, fetchInputs,
    saveFlakeApi, deleteFlakeApi, fetchFlakeMeta, fetchFlake,
    fetchLoraSiblingImage, loraSiblingImageUrl, fetchLoraSiblingImagePath,
    fetchLoraVariantSiblingImagePath, invalidateList,
} from "./api.js";
import { openFileBrowser, openFileLoadPicker } from "./pickers.js";

// Infer a ControlNet type + sibling cover name from a CN image filename (#306, #318).
// Old naming: "char_depthanythingv2_001.png" -> sibling "char_cover_001.png".
// JIP naming: "pose_classic_3_depthanythingv2_001.png" -> sibling
//   "pose_classic_0_cover_001.png" (the "_3_<preproc>_" run becomes "_0_cover_").
// `inferredType` is matched against the available CN `types` so an unknown token
// is ignored.
function inferCnFromImage(filename, types = []) {
    const ext = filename.match(/\.[^.]+$/)?.[0] || "";
    const base = filename.slice(0, filename.length - ext.length);
    const lower = base.toLowerCase();
    // [filename token substring, canonical type fragment]
    const ALIASES = [
        ["depthanything", "depth"], ["midas", "depth"], ["zoe", "depth"], ["leres", "depth"], ["depth", "depth"],
        ["dwpose", "openpose"], ["densepose", "openpose"], ["openpose", "openpose"],
        ["canny", "canny"],
        ["lineartanime", "lineart"], ["lineart", "lineart"],
        ["softedge", "softedge"], ["pidinet", "softedge"], ["hed", "softedge"],
        ["scribble", "scribble"], ["mlsd", "mlsd"],
        ["normalbae", "normal"], ["normal", "normal"],
        ["segmentation", "seg"], ["ade20k", "seg"], ["seg", "seg"], ["tile", "tile"],
    ];
    let token = "", frag = "";
    for (const [tk, fr] of ALIASES) {
        if (lower.includes(tk)) { token = tk; frag = fr; break; }
    }
    const lowerTypes = types.map((t) => t.toLowerCase());
    let inferredType = "";
    if (frag) {
        const idx = lowerTypes.findIndex((t) => t.includes(frag));
        if (idx >= 0) inferredType = types[idx];
    }
    if (!inferredType) {
        const idx = lowerTypes.findIndex((t) => lower.includes(t));
        if (idx >= 0) inferredType = types[idx];
    }
    let sibling = "";
    if (token) {
        const segs = base.split("_");
        const ti = segs.findIndex((s) => s.toLowerCase().includes(token));
        if (ti >= 0) {
            // JIP naming: the preproc token is preceded by a numeric order marker
            // (e.g. "3"); the cover uses order "0", so turn "_3_<preproc>_" into
            // "_0_cover_". Otherwise just swap the token segment for "cover".
            if (ti > 0 && /^\d+$/.test(segs[ti - 1])) {
                segs[ti - 1] = "0";
            }
            segs[ti] = "cover";
            sibling = segs.join("_") + ext;
        }
    }
    return { inferredType, sibling };
}

export function openEditModal({ mode, name, data, dirs, family = "SDXL/Base" }) {
    return new Promise((resolve) => {
        let { content, footer, close, handlers, panel } = openOverlay();
        handlers.onClose = (v) => resolve(v ?? null);

        // Dirty-state tracking — flipped on the first interaction inside the
        // modal so a stray outside-click can't silently lose progress.
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
        title.textContent =
            mode === "default" ? "Edit default flake" :
            mode === "create" ? "New flake" :
            `Edit ${name}`;
        content.appendChild(title);

        // ---- Top section: name, path, cover image ----
        const topSection = document.createElement("div");
        css(topSection, "display:flex;gap:12px;align-items:flex-start;");

        const leftCol = document.createElement("div");
        css(leftCol, "flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;");

        let displayNameInput = null;
        let pathInput = null;
        let outputStemInput = null;
        let selectedType = data.flake_type || "";
        const FLAKE_TYPES = ["Style", "Slider", "Character", "Pose", "Concept", "Other"];
        // Optional fields seeded when a type is chosen while creating a flake.
        // The user can remove any of them afterwards.
        const DEFAULT_FIELDS_BY_TYPE = {
            Character: ["lora", "prompt", "variants"],
            Slider: ["lora"],
            Style: ["lora", "prompt"],
            Pose: ["prompt", "controlnets"],
        };
        // Seed a type's default optional fields, skipping any already present so
        // user-entered fields are never clobbered. Hoisted so the type dropdown
        // handler (defined above the field state) can call it at event time.
        function applyTypeDefaults(type) {
            const keys = DEFAULT_FIELDS_BY_TYPE[type];
            if (!keys) return;
            let lastAdded = null;
            for (const key of keys) {
                if (activeFields.includes(key)) continue;
                activeFields.push(key);
                lastAdded = key;
                if (key === "lora") fieldState.loras = [{ name: "", url: "", path: "", strength: 1.0, _editing: true }];
                else if (key === "prompt") fieldState.prompt = {};
                else if (key === "controlnets") fieldState.controlnets._ = [];
                else if (key === "variants") fieldState.variants = type === "Character" ? { outfit: { classic: {} } } : {};
            }
            if (lastAdded) { renderFields(); scrollToFieldKey(lastAdded); }
        }
        let typeDropdown = null;
        let baseRootSelectRef = null;
        // The Save button is gated on `rootsLoaded` so create/edit can't save
        // before the base-directory roots resolve. Default-flake mode loads no
        // roots, so treat it as ready immediately — otherwise the inline
        // Default flake can never be saved (#253).
        let rootsLoaded = mode === "default";

        // ---- Resolved-path helpers (shared across the field rows below) ----
        let currentRootPath = "";
        let rootsCache = [];
        let resolvedPathLabel = null;
        let serieInput = null;

        function getOutputPrefix() {
            const folder = familyFolder(currentFamily);
            return folder ? `img/${folder}/` : "img/";
        }

        function stripOutputPrefix(val) {
            if (!val) return val;
            const prefixes = ["img/sdxl/", "img/illustrious/", "img/pony/", "img/zib/", "img/zit/", "img/anima/", "img/flux_klein/", "img/common/", "img/"];
            for (const p of prefixes) {
                if (val.toLowerCase().startsWith(p)) return val.slice(p.length);
            }
            return val;
        }

        function updateResolvedPath() {
            if (!resolvedPathLabel) return;
            const raw = (pathInput?.value || "").trim();
            if (!raw) {
                resolvedPathLabel.textContent = "";
                return;
            }
            const rootPart = currentRootPath ? currentRootPath : "C:/<comfyui_path>/models/flakes/";
            const prefix = getOutputPrefix();
            const fullPath = `${rootPart}${prefix}${raw}.yaml`.replace(/\/\//g, "/");
            resolvedPathLabel.textContent = fullPath;
        }

        // ---- Prefill chain (#272/#273/#274) ----
        // In create mode, while a field hasn't been manually edited, compose
        // Output Path and Output Stem from Serie -> Display Name -> tagged LoRA
        // names. Serie precedes the display name; tagged LoRA names follow it.
        let pathManuallyEdited = mode !== "create";
        let stemManuallyEdited = mode !== "create";
        function slugPart(s) { return (s || "").trim().replace(/ /g, "_").toLowerCase(); }
        function taggedLoraSlugs() {
            return (fieldState.loras || [])
                .filter(l => l && l.tag_name && (l.name || "").trim())
                .map(l => slugPart(l.name));
        }
        function recomputePrefills() {
            if (mode !== "create") return;
            const dn = slugPart(displayNameInput?.value);
            const serie = slugPart(serieInput?.value);
            const tags = taggedLoraSlugs();
            if (!pathManuallyEdited && pathInput) {
                const typeFolder = selectedType ? selectedType.toLowerCase() + "s" : "";
                pathInput.value = [typeFolder, serie, dn, ...tags].filter(Boolean).join("/");
                updateResolvedPath();
            }
            if (!stemManuallyEdited && outputStemInput) {
                // Display name contributes to the stem only for Character flakes (#273).
                const stemDn = selectedType === "Character" ? dn : "";
                const stemParts = [serie, stemDn, ...tags].filter(Boolean);
                outputStemInput.value = stemParts.length ? stemParts.join("/") + "/" : "";
                fieldState.output_stem = outputStemInput.value || null;
            }
        }

        if (mode !== "default") {
            // ---- Row 1: Display Name + Flake Type ----
            const row1 = document.createElement("div");
            css(row1, "display:flex;gap:8px;align-items:flex-start;");
            const nameWrap = document.createElement("div");
            css(nameWrap, "flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;");
            nameWrap.appendChild(makeComfyLabel("Display name"));
            displayNameInput = makeComfyInput(data.name || "", "e.g. My Flake");
            nameWrap.appendChild(displayNameInput);
            row1.appendChild(nameWrap);
            const typeWrap = document.createElement("div");
            css(typeWrap, "flex:0 0 140px;min-width:0;display:flex;flex-direction:column;gap:4px;");
            typeWrap.appendChild(makeComfyLabel("Flake type"));
            typeDropdown = makeComfyDropdown(
                [{ value: "", label: "\u2014" }, ...FLAKE_TYPES.map(t => ({ value: t, label: t }))],
                selectedType,
            );
            typeDropdown.element.addEventListener("change", () => {
                selectedType = typeDropdown.element.value;
                recomputePrefills();
                if (mode === "create") applyTypeDefaults(selectedType);
            });
            typeWrap.appendChild(typeDropdown.container);
            row1.appendChild(typeWrap);
            leftCol.appendChild(row1);

            // ---- Row 2: Serie + Output Stem (50/50) ----
            const row2 = document.createElement("div");
            css(row2, "display:flex;gap:8px;align-items:flex-start;");
            const serieWrap = document.createElement("div");
            css(serieWrap, "flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;");
            serieWrap.appendChild(makeComfyLabel("Serie"));
            const serieDD = makeSearchableDropdown([], data.serie || "", "e.g. Vinland Saga");
            serieInput = serieDD.element;
            serieWrap.appendChild(serieDD.container);
            row2.appendChild(serieWrap);
            // Populate the serie suggestions from existing flakes' series.
            (async () => {
                try {
                    const r = await fetch("/flakes/series");
                    const d = await r.json();
                    for (const s of (d.series || [])) {
                        serieDD.datalist.appendChild(Object.assign(document.createElement("option"), { value: s }));
                    }
                } catch { /* ignore */ }
            })();
            serieInput.addEventListener("input", recomputePrefills);
            serieInput.addEventListener("change", () => {
                fieldState.serie = serieInput.value.trim() || null;
                recomputePrefills();
            });

            const stemWrap = document.createElement("div");
            css(stemWrap, "flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;");
            stemWrap.appendChild(makeComfyLabel("Output Stem"));
            outputStemInput = makeComfyInput(data.output_stem ?? "", "e.g. musashi/");
            outputStemInput.addEventListener("change", () => {
                fieldState.output_stem = outputStemInput.value || null;
            });
            outputStemInput.addEventListener("input", () => { stemManuallyEdited = true; });
            stemWrap.appendChild(outputStemInput);
            row2.appendChild(stemWrap);
            leftCol.appendChild(row2);

            // ---- Row 3: Base Directory + Output Path (50/50) ----
            const row3 = document.createElement("div");
            css(row3, "display:flex;gap:8px;align-items:flex-start;");
            const baseWrap = document.createElement("div");
            css(baseWrap, "flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;");
            baseWrap.appendChild(makeComfyLabel("Base Directory"));
            const baseRootSelect = document.createElement("select");
            css(baseRootSelect, "width:100%;background:#1a1a1a;color:#ddd;border:1px solid #333;padding:6px 8px;border-radius:6px;font-size:13px;box-sizing:border-box;");
            baseWrap.appendChild(baseRootSelect);
            baseRootSelectRef = baseRootSelect;
            row3.appendChild(baseWrap);
            const pathWrap = document.createElement("div");
            css(pathWrap, "flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;");
            pathWrap.appendChild(makeComfyLabel("Output path"));
            pathInput = makeComfyInput("", "characters/musashi");
            pathWrap.appendChild(pathInput);
            row3.appendChild(pathWrap);
            leftCol.appendChild(row3);
            (async () => {
                try {
                    const r = await fetch("/flakes/roots?type=flakes");
                    const d = await r.json();
                    const roots = d.roots || [];
                    baseRootSelect.replaceChildren();
                    for (const root of roots) {
                        const opt = document.createElement("option");
                        opt.value = String(root.index);
                        const normalizedPath = (root.path || "").replace(/\\/g, "/").replace(/\/+$/, "");
                        // Abbreviate long paths: keep drive + first two segments + .../models
                        const pathParts = normalizedPath.split("/").filter(Boolean);
                        let shortPath = normalizedPath;
                        if (pathParts.length > 4) {
                            shortPath = `${pathParts[0]}/<...>/${pathParts.slice(-2).join("/")}`;
                        }
                        opt.textContent = `${root.label}: ${shortPath}`;
                        opt.title = `${root.label}: ${root.path}`;
                        baseRootSelect.appendChild(opt);
                    }
                    // Default to the extra model path (index > 0) when available
                    if (roots.length > 1 && mode === "create") {
                        baseRootSelect.value = String(roots[roots.length - 1].index);
                    } else if (mode === "edit" && name) {
                        const rr = await fetch(`/flakes/get?name=${encodeURIComponent(name)}`);
                        if (rr.ok) {
                            const rd = await rr.json();
                            const savedRootIndex = rd.base_root_index;
                            if (savedRootIndex != null && savedRootIndex < roots.length) {
                                baseRootSelect.value = String(savedRootIndex);
                            }
                        }
                    }
                    const rootIdx = parseInt(baseRootSelect.value, 10);
                    const root = (rootsCache.find(r => r.index === rootIdx)) || rootsCache[0];
                    currentRootPath = (root?.path || "").replace(/\\/g, "/").replace(/\/+$/, "") + "/";
                    updateResolvedPath();
                    if (!roots.length) {
                        const opt = document.createElement("option");
                        opt.textContent = "(no roots configured)";
                        opt.value = "0";
                        baseRootSelect.appendChild(opt);
                    }
                } catch { /* ignore */ }
                rootsLoaded = true;
                saveBtn.disabled = false;
            })();

            (async () => {
                try {
                    const r = await fetch("/flakes/roots?type=flakes");
                    const d = await r.json();
                    rootsCache = d.roots || [];
                    const rootIdx = parseInt(baseRootSelect?.value || "0", 10);
                    const root = (rootsCache.find(r => r.index === rootIdx)) || rootsCache[0];
                    currentRootPath = (root?.path || "").replace(/\\/g, "/");
                    if (!currentRootPath.endsWith("/")) currentRootPath += "/";
                    updateResolvedPath();
                } catch { /* ignore */ }
            })();

            baseRootSelect.addEventListener("change", () => {
                const rootIdx = parseInt(baseRootSelect.value, 10);
                const root = (rootsCache.find(r => r.index === rootIdx)) || rootsCache[0];
                currentRootPath = (root?.path || "").replace(/\\/g, "/").replace(/\/+$/, "") + "/";
                updateResolvedPath();
            });

            if (mode === "edit" && name) {
                const stripped = stripOutputPrefix(name);
                pathInput.value = stripped;
            }

            // Auto-fill path/stem from serie + display name + tagged loras
            // (create mode only; a manual edit disables that field's prefill).
            pathInput.addEventListener("input", () => { pathManuallyEdited = true; updateResolvedPath(); });
            displayNameInput?.addEventListener("input", recomputePrefills);
        }
        topSection.appendChild(leftCol);

        let coverFile = null;
        let coverSourcePath = data?.cover_image || null;
        let coverImg = null;
        let setCoverFromLora = null;
        let setCoverFromCnImage = null;

        let currentFamily = family;

        function inferFamilyFromPath(path) {
            if (!path) return family;
            const norm = path.replace(/\\/g, "/");
            const FAMILY_PATH_MAP = {
                "img/sdxl/": "SDXL/Base",
                "img/illustrious/": "SDXL/Illustrious",
                "img/pony/": "SDXL/Pony",
                "img/zib/": "ZImage/Base",
                "img/zit/": "ZImage/Turbo",
                "img/anima/": "Anima/Base",
                "img/flux_klein/": "Flux/Klein",
                "img/common/": "Common",
            };
            for (const [prefix, fam] of Object.entries(FAMILY_PATH_MAP)) {
                if (norm.toLowerCase().startsWith(prefix)) return fam;
            }
            return family;
        }

        if (mode === "edit" && name) {
            currentFamily = inferFamilyFromPath(name);
        }

        function loraBrowserDefaultPath() {
            const folder = familyFolder(currentFamily);
            return folder ? `img/${folder}` : "";
        }

        // Open the load picker (search bar + folders + flakes) and return the
        // chosen flake name, or null. Hoisted so the add-field UI can auto-open
        // it when a Flake Link field is added (#320).
        async function pickFlakeTarget() {
            try {
                const list = await (await fetch(`/flakes/list?family=${encodeURIComponent(currentFamily || "")}`)).json();
                const flakes = (list.flakes || []).filter(n => n !== name);
                const res = await openFileLoadPicker({
                    flakes,
                    directories: list.directories || [],
                    family: currentFamily || "",
                    displayNames: list.display_names || {},
                    tagNames: list.tag_names || {},
                });
                return res && res.name ? res.name : null;
            } catch { return null; }
        }

        if (mode === "edit" || mode === "create") {
            const coverWrap = document.createElement("div");
            css(coverWrap, "display:flex;flex-direction:column;align-items:center;gap:4px;");

            const coverBox = document.createElement("div");
            css(coverBox, "position:relative;width:160px;height:200px;border-radius:6px;background:#1a1a1a;border:1px solid #333;display:flex;align-items:center;justify-content:center;cursor:pointer;overflow:hidden;");

            coverImg = document.createElement("img");
            css(coverImg, "width:100%;height:100%;object-fit:cover;display:none;");
            coverBox.appendChild(coverImg);

            const coverLabel = document.createElement("span");
            coverLabel.textContent = "image";
            css(coverLabel, "font-size:10px;color:#666;pointer-events:none;");
            coverBox.appendChild(coverLabel);

            // Hover-only ✕ to remove the cover image (#239). Only visible when
            // a cover is set AND the user is hovering the box.
            const coverRemoveBtn = document.createElement("button");
            coverRemoveBtn.type = "button";
            coverRemoveBtn.textContent = "✕";
            coverRemoveBtn.title = "Remove cover image";
            css(coverRemoveBtn, "position:absolute;top:6px;right:6px;z-index:2;width:22px;height:22px;padding:0;border-radius:4px;background:rgba(20,20,20,0.85);color:#ddd;border:1px solid #555;cursor:pointer;font-size:13px;line-height:1;display:none;align-items:center;justify-content:center;opacity:0;transition:opacity 0.12s ease;");
            coverBox.appendChild(coverRemoveBtn);
            coverBox.addEventListener("mouseenter", () => {
                if (coverImg.style.display === "block") coverRemoveBtn.style.opacity = "1";
            });
            coverBox.addEventListener("mouseleave", () => { coverRemoveBtn.style.opacity = "0"; });
            coverRemoveBtn.addEventListener("click", async (e) => {
                e.stopPropagation();
                // Reset all cover state: any pending upload, the stored source, and the preview.
                coverFile = null;
                coverSourcePath = null;
                updateCoverPreview(null);
                // In edit mode, also delete the file on disk so it doesn't
                // re-appear on next open (the cover image lives next to the
                // yaml, not in the yaml itself).
                if (mode === "edit" && name) {
                    try {
                        await fetch(`/flakes/cover?name=${encodeURIComponent(name)}`, { method: "DELETE" });
                    } catch { /* ignore — preview is already cleared */ }
                }
            });

            const coverInput = document.createElement("input");
            coverInput.type = "file";
            coverInput.accept = ".png,.jpg,.jpeg,.webp,.gif";
            coverInput.style.display = "none";

            function updateCoverPreview(src) {
                if (src) {
                    coverImg.src = src;
                    coverImg.style.display = "block";
                    coverLabel.style.display = "none";
                    coverRemoveBtn.style.display = "flex";
                } else {
                    coverImg.style.display = "none";
                    coverLabel.style.display = "block";
                    coverRemoveBtn.style.display = "none";
                    coverRemoveBtn.style.opacity = "0";
                }
            }

            // Default cover for edit mode
            if (mode === "edit" && name) {
                updateCoverPreview(getCoverUrl(name));
            }

            coverBox.addEventListener("click", () => coverInput.click());
            coverInput.addEventListener("change", () => {
                const file = coverInput.files?.[0];
                if (file) {
                    const reader = new FileReader();
                    reader.onload = () => updateCoverPreview(reader.result);
                    reader.readAsDataURL(file);
                    if (file.path) {
                        // Desktop/Electron exposes the absolute path: store a
                        // reference instead of copying the bytes next to the
                        // flake YAML (#259). Backend reads the path directly.
                        coverSourcePath = file.path;
                        coverFile = null;
                    } else {
                        // Plain browser — no path available; fall back to the
                        // upload-and-store-beside-yaml behaviour.
                        coverFile = file;
                        coverSourcePath = null;
                    }
                }
            });

            // Auto-cover from a LoRA's sibling image when no cover has been
            // explicitly chosen yet. Stores the resolved image path (e.g. .png)
            // so the saved YAML never references a .safetensors file.
            setCoverFromLora = async (loraPath) => {
                if (coverFile || coverSourcePath || !loraPath) return false;
                try {
                    const imagePath = await fetchLoraSiblingImagePath(loraPath);
                    if (imagePath) {
                        coverSourcePath = imagePath;
                        updateCoverPreview(loraSiblingImageUrl(loraPath));
                        return true;
                    }
                } catch {
                    return false;
                }
            };

            // Auto-cover from a controlnet input image when no cover has been chosen
            setCoverFromCnImage = (imagePath) => {
                if (coverFile || coverSourcePath || !imagePath) return false;
                coverSourcePath = imagePath;
                updateCoverPreview(`/view?filename=${encodeURIComponent(imagePath)}&type=input`);
                return true;
            };

            coverWrap.appendChild(coverBox);
            coverWrap.appendChild(coverInput);
            topSection.appendChild(coverWrap);

            // Default cover when path changes in create mode
            if (mode === "create" && pathInput) {
                pathInput.addEventListener("input", () => {
                    const p = pathInput.value.trim();
                    if (p && !coverFile) {
                        const prefix = getOutputPrefix();
                        const fullP = prefix + p.replace(/\.ya?ml$/i, ".png");
                        updateCoverPreview(getCoverUrl(fullP));
                    }
                });
            }

            const origClose = close;
            close = async (value) => {
                if (value && (value.created || value.saved)) {
                    if (coverFile) {
                        try {
                            await uploadCover(value.name, coverFile);
                        } catch { /* ignore */ }
                    } else if (coverSourcePath) {
                        // A cover_image reference supersedes any previously-copied
                        // cover sitting beside the yaml; remove it so the
                        // reference isn't shadowed on reload (#259).
                        try {
                            await fetch(`/flakes/cover?name=${encodeURIComponent(value.name)}`, { method: "DELETE" });
                        } catch { /* ignore */ }
                    }
                }
                origClose(value);
            };
        }
        content.appendChild(topSection);

        const resolvedPathRow = document.createElement("div");
        resolvedPathLabel = document.createElement("div");
        css(resolvedPathLabel, "font-size:11px;color:#666;word-break:break-all;min-height:0;");
        resolvedPathRow.appendChild(resolvedPathLabel);
        if (mode !== "default") {
            content.appendChild(resolvedPathRow);
        }

        // ---- Separator ----
        const sep = document.createElement("div");
        css(sep, "border-top:1px solid #333;margin:12px 0;");
        content.appendChild(sep);

        // ---- Optional fields state ----
        const fieldState = {
            loras: Array.isArray(data.loras)
                ? JSON.parse(JSON.stringify(data.loras))
                : (data.path ? [{ name: "", url: "", path: data.path, strength: data.strength ?? 1.0 }] : []),
            prompt: (data.prompt?.positive != null || data.prompt?.negative != null)
                ? { positive: data.prompt?.positive ?? null, negative: data.prompt?.negative ?? null }
                : null,
            resolution: data.resolution ? [...data.resolution] : null,
            controlnets: JSON.parse(JSON.stringify(data.controlnets || [])),
            variants: JSON.parse(JSON.stringify(data.variants || data.options || {})),
            output_stem: data.output_stem ?? null,
            serie: data.serie ?? null,
            // Flake links: yaml defaults — list of { target, variant, lora_strengths }.
            // Normalize legacy single `flake_link` into the list (#234).
            flake_links: (Array.isArray(data.flake_links)
                ? data.flake_links
                : (data.flake_link ? [data.flake_link] : [])
            ).filter(l => l && l.target).map(l => ({
                target: String(l.target || ""),
                variant: { ...(l.variant || {}) },
                lora_strengths: Array.isArray(l.lora_strengths) ? [...l.lora_strengths] : [],
            })),
        };
        if (!Array.isArray(fieldState.controlnets._)) {
            const arr = Array.isArray(fieldState.controlnets) ? [...fieldState.controlnets] : [];
            fieldState.controlnets = { _: arr };
        }

        // Derive field order from YAML key order (Python preserves insertion order)
        const activeFields = [];
        const knownFieldKeys = { loras: "lora", path: "lora", prompt: "prompt", resolution: "resolution", controlnets: "controlnets", variants: "variants", options: "variants", flake_links: "flake_link", flake_link: "flake_link" };
        for (const key of Object.keys(data)) {
            const ft = knownFieldKeys[key];
            if (ft && !activeFields.includes(ft)) activeFields.push(ft);
        }
        // Fallback: append any fields that exist but weren't in the key order
        if (!activeFields.includes("lora") && (Array.isArray(data.loras) || data.path)) activeFields.push("lora");
        if (!activeFields.includes("prompt") && fieldState.prompt) activeFields.push("prompt");
        if (!activeFields.includes("resolution") && fieldState.resolution) activeFields.push("resolution");
if (!activeFields.includes("controlnets") && fieldState.controlnets._.length > 0) activeFields.push("controlnets");
            if (!activeFields.includes("variants") && Object.keys(fieldState.variants).length > 0) activeFields.push("variants");
        if (!activeFields.includes("flake_link") && fieldState.flake_links && fieldState.flake_links.length) activeFields.push("flake_link");

        const optionalBox = document.createElement("div");
        css(optionalBox, "display:flex;flex-direction:column;gap:8px;");
        content.appendChild(optionalBox);

        let dragFieldIdx = null;

        // Scroll a just-added field into view (#271) once it has rendered, so a
        // field that spawns below the fold is revealed instead of staying hidden.
        function scrollToFieldKey(key) {
            if (!key) return;
            requestAnimationFrame(() => {
                const el = optionalBox.querySelector(`[data-field-key="${key}"]`);
                if (!el || typeof el.scrollIntoView !== "function") return;
                const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
                el.scrollIntoView({ block: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
            });
        }

        function renderFields() {
            optionalBox.replaceChildren();

            for (let fi = 0; fi < activeFields.length; fi++) {
                const fieldType = activeFields[fi];
                const fieldWrap = document.createElement("div");
                css(fieldWrap, "background:#1a1a1a;padding:10px;border-radius:6px;border:1px solid #2a2a2a;display:flex;flex-direction:column;gap:6px;");
                fieldWrap.dataset.fieldIdx = String(fi);
                fieldWrap.dataset.fieldKey = fieldType;

                const header = document.createElement("div");
                css(header, "display:flex;gap:6px;align-items:center;");

                const dragIcon = document.createElement("span");
                dragIcon.textContent = "\u2630";
                css(dragIcon, "cursor:grab;color:#666;font-size:12px;");
                dragIcon.draggable = true;
                dragIcon.addEventListener("dragstart", (e) => {
                    dragFieldIdx = fi;
                    fieldWrap.style.opacity = "0.4";
                    e.dataTransfer.effectAllowed = "move";
                });
                dragIcon.addEventListener("dragend", () => {
                    dragFieldIdx = null;
                    fieldWrap.style.opacity = "";
                    for (const ind of optionalBox.querySelectorAll(".field-drop-indicator")) {
                        ind.remove();
                    }
                });
                header.appendChild(dragIcon);

                const fieldTitle = document.createElement("span");
                // Title-case and replace underscores so e.g. "flake_link" reads
                // "Flake Link" instead of "Flake_link" (#307).
                fieldTitle.textContent = fieldType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
                css(fieldTitle, "flex:1;font-size:12px;font-weight:500;color:#aaa;");
                header.appendChild(fieldTitle);

                const moveUpBtn = makeSmallButton("\u2191");
                moveUpBtn.title = "Move field up";
                if (fi === 0) {
                    moveUpBtn.disabled = true;
                    moveUpBtn.style.opacity = "0.35";
                    moveUpBtn.style.cursor = "default";
                }
                moveUpBtn.addEventListener("click", (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (fi === 0) return;
                    const tmp = activeFields[fi - 1];
                    activeFields[fi - 1] = activeFields[fi];
                    activeFields[fi] = tmp;
                    renderFields();
                });
                header.appendChild(moveUpBtn);

                const moveDownBtn = makeSmallButton("\u2193");
                moveDownBtn.title = "Move field down";
                if (fi === activeFields.length - 1) {
                    moveDownBtn.disabled = true;
                    moveDownBtn.style.opacity = "0.35";
                    moveDownBtn.style.cursor = "default";
                }
                moveDownBtn.addEventListener("click", (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (fi === activeFields.length - 1) return;
                    const tmp = activeFields[fi + 1];
                    activeFields[fi + 1] = activeFields[fi];
                    activeFields[fi] = tmp;
                    renderFields();
                });
                header.appendChild(moveDownBtn);

                const delFieldBtn = makeSmallButton("\u2715");
                delFieldBtn.addEventListener("click", () => {
                    const idx = activeFields.indexOf(fieldType);
                    if (idx !== -1) activeFields.splice(idx, 1);
                    if (fieldType === "lora") fieldState.loras = [];
                    if (fieldType === "prompt") fieldState.prompt = null;
                    if (fieldType === "resolution") fieldState.resolution = null;
                    if (fieldType === "controlnets") fieldState.controlnets._ = [];
                    if (fieldType === "variants") {
                        for (const k of Object.keys(fieldState.variants)) delete fieldState.variants[k];
                    }
                    if (fieldType === "flake_link") fieldState.flake_links = [];
                    renderFields();
                });
                header.appendChild(delFieldBtn);
                fieldWrap.appendChild(header);

                fieldWrap.addEventListener("dragover", (e) => {
                    if (dragFieldIdx === null || dragFieldIdx === fi) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    for (const ind of optionalBox.querySelectorAll(".field-drop-indicator")) {
                        ind.remove();
                    }
                    const indicator = document.createElement("div");
                    indicator.className = "field-drop-indicator";
                    css(indicator, "height:2px;background:#2a6acf;border-radius:1px;margin:2px 0;");
                    const rect = fieldWrap.getBoundingClientRect();
                    const above = (e.clientY - rect.top) < rect.height / 2;
                    fieldWrap.parentNode.insertBefore(
                        indicator,
                        above ? fieldWrap : fieldWrap.nextSibling,
                    );
                });
                fieldWrap.addEventListener("dragleave", (e) => {
                    // Only clear if leaving the field bounds entirely
                    const rect = fieldWrap.getBoundingClientRect();
                    if (
                        e.clientX < rect.left || e.clientX > rect.right ||
                        e.clientY < rect.top || e.clientY > rect.bottom
                    ) {
                        for (const ind of optionalBox.querySelectorAll(".field-drop-indicator")) {
                            ind.remove();
                        }
                    }
                });
                fieldWrap.addEventListener("drop", (e) => {
                    e.preventDefault();
                    for (const ind of optionalBox.querySelectorAll(".field-drop-indicator")) {
                        ind.remove();
                    }
                    if (dragFieldIdx === null || dragFieldIdx === fi) return;
                    const rect = fieldWrap.getBoundingClientRect();
                    const above = (e.clientY - rect.top) < rect.height / 2;
                    const [movedField] = activeFields.splice(dragFieldIdx, 1);
                    let insertIdx = fi;
                    if (dragFieldIdx < fi) insertIdx--;
                    if (!above) insertIdx++;
                    activeFields.splice(insertIdx, 0, movedField);
                    dragFieldIdx = null;
                    renderFields();
                });

                if (fieldType === "lora") {
                    const loraBox = document.createElement("div");
                    css(loraBox, "display:flex;flex-direction:column;gap:6px;");
                    fieldWrap.appendChild(loraBox);

                    function renderLoras() {
                        loraBox.replaceChildren();
                        for (let i = 0; i < fieldState.loras.length; i++) {
                            const lora = fieldState.loras[i];
                            const card = document.createElement("div");
                            css(card, "background:#252525;padding:10px;border-radius:6px;display:flex;flex-direction:column;gap:6px;border:1px solid #333;");

                            const header = document.createElement("div");
                            css(header, "display:flex;gap:6px;align-items:center;");

                            const dragHandle = document.createElement("span");
                            dragHandle.textContent = "\u2630";
                            css(dragHandle, "cursor:grab;color:#666;font-size:12px;");
                            header.appendChild(dragHandle);

                            const title = document.createElement("span");
                            const titleText = lora.name ? `LoRA: ${lora.name}` : "LoRA";
                            title.textContent = titleText;
                            css(title, "flex:1;font-size:12px;font-weight:500;color:#aaa;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;");
                            header.appendChild(title);

                            if (lora.url) {
                                const linkIcon = document.createElement("a");
                                linkIcon.textContent = "\uD83D\uDD17";
                                css(linkIcon, "font-size:12px;text-decoration:none;cursor:pointer;color:#4a9eff;");
                                linkIcon.addEventListener("click", (e) => {
                                    e.stopPropagation();
                                    window.open(lora.url, "_blank");
                                });
                                header.appendChild(linkIcon);
                            }

                            const editBtn = document.createElement("button");
                            editBtn.innerHTML = lora._editing ? "&#9652;" : "&#9662;";
                            css(editBtn, "background:transparent;color:#888;border:none;padding:0;font-size:14px;cursor:pointer;line-height:1;display:flex;align-items:center;justify-content:center;height:20px;width:20px;");
                            editBtn.title = "Edit name and URL";
                            editBtn.addEventListener("click", () => {
                                lora._editing = !lora._editing;
                                renderLoras();
                            });
                            header.appendChild(editBtn);

                            const removeBtn = makeSmallButton("\u2715");
                            removeBtn.addEventListener("click", () => {
                                fieldState.loras.splice(i, 1);
                                renderLoras();
                            });
                            header.appendChild(removeBtn);

                            card.appendChild(header);

                            if (lora._editing) {
                                const editRow = document.createElement("div");
                                css(editRow, "display:flex;flex-direction:column;gap:4px;");
                                const nameInput = makeComfyInput(lora.name || "", "Display name");
                                nameInput.addEventListener("change", () => {
                                    lora.name = nameInput.value;
                                    if (lora.tag_name) recomputePrefills();
                                    renderLoras();
                                });
                                const urlInput = makeComfyInput(lora.url || "", "https://civitai.com/models/...");
                                urlInput.addEventListener("change", () => {
                                    lora.url = urlInput.value;
                                    renderLoras();
                                });
                                editRow.appendChild(makeLabel("Name"));
                                editRow.appendChild(nameInput);
                                // Tag-name checkbox (#274): append this LoRA's name to the
                                // output stem, output path, and grid display name.
                                const tagRow = document.createElement("div");
                                css(tagRow, "display:flex;align-items:center;gap:6px;margin-top:2px;");
                                const tagChk = document.createElement("input");
                                tagChk.type = "checkbox";
                                tagChk.checked = !!lora.tag_name;
                                css(tagChk, "cursor:pointer;margin:0;");
                                const tagLbl = document.createElement("label");
                                tagLbl.textContent = "Tag flake with this LoRA's name";
                                css(tagLbl, "font-size:11px;color:#aaa;cursor:pointer;");
                                const toggleTag = () => {
                                    lora.tag_name = tagChk.checked;
                                    recomputePrefills();
                                };
                                tagChk.addEventListener("change", toggleTag);
                                tagLbl.addEventListener("click", () => { tagChk.checked = !tagChk.checked; toggleTag(); });
                                tagRow.appendChild(tagChk);
                                tagRow.appendChild(tagLbl);
                                editRow.appendChild(tagRow);
                                editRow.appendChild(makeLabel("URL"));
                                editRow.appendChild(urlInput);
                                card.appendChild(editRow);
                            }

                            const pathRow = document.createElement("div");
                            css(pathRow, "display:flex;gap:4px;align-items:center;");

                            const loraWrap = makeSearchableDropdown([], lora.path || "", "Select LoRA...");
                            loraWrap.container.style.display = "none";
                            (async () => {
                                try {
                                    const loras = await fetchLoras();
                                    for (const l of loras) loraWrap.datalist.appendChild(Object.assign(document.createElement("option"), { value: l }));
                                } catch { /* ignore */ }
                            })();

                            const pathBox = document.createElement("div");
                            css(pathBox, "flex:1;background:#1a1a1a;color:#ddd;border:1px solid #333;padding:6px 8px;border-radius:6px;font-size:13px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;height:32px;box-sizing:border-box;display:flex;align-items:center;");
                            pathBox.textContent = lora.path ? lora.path.replace(/\.safetensors?$/i, "").split(/[\\/]/).pop() : "No LoRA selected";
                            pathBox.title = lora.path || "";

                            const pathEditBtn = makeSmallButton("...");
                            pathEditBtn.title = "Type manually";

                            pathBox.addEventListener("click", async () => {
                                const result = await openFileBrowser({ type: "loras", defaultPath: loraBrowserDefaultPath() });
                                if (result && result.file) {
                                    lora.path = result.file;
                                    pathBox.textContent = lora.path ? lora.path.replace(/\.safetensors?$/i, "").split(/[\\/]/).pop() : "No LoRA selected";
                                    pathBox.title = lora.path || "";
                                    loraWrap.element.value = lora.path;
                                    if (i === 0 && setCoverFromLora) setCoverFromLora(lora.path);
                                }
                            });

                            pathEditBtn.addEventListener("click", (e) => {
                                e.stopPropagation();
                                pathBox.style.display = "none";
                                pathEditBtn.style.display = "none";
                                loraWrap.container.style.display = "block";
                                loraWrap.element.focus();
                            });

                            loraWrap.element.addEventListener("change", () => {
                                const val = loraWrap.element.value;
                                lora.path = val;
                                pathBox.textContent = val ? val.replace(/\.safetensors?$/i, "").split(/[\\/]/).pop() : "No LoRA selected";
                                pathBox.title = val;
                                pathBox.style.display = "block";
                                pathEditBtn.style.display = "inline-block";
                                loraWrap.container.style.display = "none";
                                if (i === 0 && val && setCoverFromLora) setCoverFromLora(val);
                            });

                            loraWrap.element.addEventListener("blur", () => {
                                setTimeout(() => {
                                    const val = loraWrap.element.value;
                                    lora.path = val;
                                    pathBox.textContent = val ? val.replace(/\.safetensors?$/i, "").split(/[\\/]/).pop() : "No LoRA selected";
                                    pathBox.title = val;
                                    pathBox.style.display = "block";
                                    pathEditBtn.style.display = "inline-block";
                                    loraWrap.container.style.display = "none";
                                    if (i === 0 && val && setCoverFromLora) setCoverFromLora(val);
                                }, 200);
                            });

                            pathRow.appendChild(pathBox);
                            pathRow.appendChild(pathEditBtn);
                            pathRow.appendChild(loraWrap.container);

                            if (lora.path) {
                                const clearBtn = makeSmallButton("\u2715");
                                css(clearBtn, "color:#f88;");
                                clearBtn.addEventListener("click", (e) => {
                                    e.stopPropagation();
                                    lora.path = "";
                                    pathBox.textContent = "No LoRA selected";
                                    pathBox.title = "";
                                    loraWrap.element.value = "";
                                });
                                pathRow.appendChild(clearBtn);
                            }

                            card.appendChild(pathRow);

                            const strSlider = makeComfyValueSlider(lora.strength ?? 1.0, -10, 10, 0.05, (v) => {
                                lora.strength = v;
                            });
                            card.appendChild(strSlider);

                            loraBox.appendChild(card);
                        }

                        const addBtn = makeSmallButton("+ Add LoRA");
                        addBtn.addEventListener("click", () => {
                            // Open new LoRA entries expanded (name + URL visible).
                            // _editing is runtime-only and stripped on save.
                            fieldState.loras.push({ name: "", url: "", path: "", strength: 1.0, _editing: true });
                            renderLoras();
                        });
                        loraBox.appendChild(addBtn);
                    }
                    renderLoras();
                }

                if (fieldType === "prompt") {
                    const promptBox = document.createElement("div");
                    css(promptBox, "display:flex;gap:8px;align-items:stretch;");
                    fieldWrap.appendChild(promptBox);

                    const posCol = document.createElement("div");
                    css(posCol, "display:flex;flex-direction:column;gap:4px;min-width:0;");
                    promptBox.appendChild(posCol);

                    const negCol = document.createElement("div");
                    css(negCol, "display:flex;flex-direction:column;gap:4px;min-width:0;");
                    promptBox.appendChild(negCol);

                    const taCss = "background:#1a1a1a;color:#ddd;border:1px solid #333;padding:6px;border-radius:4px;font-size:12px;width:100%;box-sizing:border-box;font-family:inherit;outline:none;";

                    function renderPrompts() {
                        posCol.replaceChildren();
                        negCol.replaceChildren();

                        const hasNeg = fieldState.prompt?.negative != null;
                        // Positive spans the width when alone; equal split with a
                        // negative present. The "+ Negative" placeholder stays
                        // compact so it never steals the positive's space (#264).
                        posCol.style.flex = hasNeg ? "1 1 0" : "1 1 auto";
                        negCol.style.flex = hasNeg ? "1 1 0" : "0 0 auto";

                        // A positive prompt is always present by default (#332) — no
                        // "+ Positive" button. Seed an empty string when missing.
                        if (!fieldState.prompt) fieldState.prompt = {};
                        if (fieldState.prompt.positive == null) fieldState.prompt.positive = "";
                        {
                            const posTA = makeTextarea(fieldState.prompt.positive, "positive prompt", 3);
                            css(posTA, taCss);
                            posTA.addEventListener("change", () => { fieldState.prompt.positive = posTA.value; });
                            posTA.addEventListener("input", () => { fieldState.prompt.positive = posTA.value; });
                            attachAutoGrow(posTA);
                            const posWrap = makeHoverRemoveWrapper(posTA, () => {
                                if (fieldState.prompt.negative == null) {
                                    fieldState.prompt = null;
                                    activeFields.splice(activeFields.indexOf("prompt"), 1);
                                    renderFields();
                                } else {
                                    delete fieldState.prompt.positive;
                                    renderPrompts();
                                }
                            }, "Remove positive prompt");
                            posCol.appendChild(posWrap);
                        }

                        if (hasNeg) {
                            const negTA = makeTextarea(fieldState.prompt.negative, "negative prompt", 2);
                            css(negTA, taCss);
                            negTA.addEventListener("change", () => { fieldState.prompt.negative = negTA.value; });
                            negTA.addEventListener("input", () => { fieldState.prompt.negative = negTA.value; });
                            attachAutoGrow(negTA);
                            const negWrap = makeHoverRemoveWrapper(negTA, () => {
                                if (fieldState.prompt.positive == null) {
                                    fieldState.prompt = null;
                                    activeFields.splice(activeFields.indexOf("prompt"), 1);
                                    renderFields();
                                } else {
                                    delete fieldState.prompt.negative;
                                    renderPrompts();
                                }
                            }, "Remove negative prompt");
                            negCol.appendChild(negWrap);
                        } else {
                            const negBtn = document.createElement("button");
                            negBtn.textContent = "+ Negative";
                            css(negBtn, "align-self:flex-start;cursor:pointer;border-radius:4px;font-size:13px;background:#2a2a2a;color:#999;border:1px dashed #555;transition:background 0.15s ease;user-select:none;box-sizing:border-box;white-space:nowrap;padding:6px 10px;");
                            negBtn.addEventListener("mouseenter", () => { negBtn.style.background = "#333"; });
                            negBtn.addEventListener("mouseleave", () => { negBtn.style.background = "#2a2a2a"; });
                            negBtn.addEventListener("click", () => {
                                if (!fieldState.prompt) fieldState.prompt = {};
                                fieldState.prompt.negative = fieldState.prompt.negative ?? "";
                                renderPrompts();
                            });
                            negCol.appendChild(negBtn);
                        }
                    }
                    renderPrompts();
                }

                if (fieldType === "resolution") {
                    const row = document.createElement("div");
                    css(row, "display:flex;gap:8px;align-items:center;");
                    const wInput = makeComfyNumberInput(fieldState.resolution?.[0] || "", "width", 64);
                    const hInput = makeComfyNumberInput(fieldState.resolution?.[1] || "", "height", 64);
                    const syncResolution = () => {
                        const rw = parseInt(wInput.value);
                        const rh = parseInt(hInput.value);
                        if (Number.isFinite(rw) && Number.isFinite(rh)) {
                            fieldState.resolution = [rw, rh];
                        } else if (!fieldState.resolution) {
                            fieldState.resolution = [1024, 1024];
                        }
                    };
                    // Listen on both input (real-time) and change (blur) so save
                    // sees the latest typed values even without losing focus first.
                    wInput.addEventListener("input", syncResolution);
                    wInput.addEventListener("change", syncResolution);
                    hInput.addEventListener("input", syncResolution);
                    hInput.addEventListener("change", syncResolution);
                    // Expose the inputs on fieldState so the save handler can read
                    // them directly as a belt-and-braces fallback.
                    fieldState._resolutionInputs = { w: wInput, h: hInput };
                    const xLabel = document.createElement("span");
                    xLabel.textContent = "\u00d7";
                    css(xLabel, "color:#888;font-size:13px;");
                    row.appendChild(wInput);
                    row.appendChild(xLabel);
                    row.appendChild(hInput);
                    fieldWrap.appendChild(row);
                }

                if (fieldType === "controlnets") {
                    const cnsBox = document.createElement("div");
                    css(cnsBox, "display:flex;flex-direction:column;gap:6px;");
                    fieldWrap.appendChild(cnsBox);

                    function renderCNs() {
                        cnsBox.replaceChildren();
                        const arr = fieldState.controlnets._ || [];
                        for (let i = 0; i < arr.length; i++) {
                            const cn = arr[i];
                            const card = document.createElement("div");
                            css(card, "background:#252525;padding:10px;border-radius:6px;display:flex;flex-direction:row;gap:10px;border:1px solid #333;");

                            // Left: input image with file picker
                            const imageCol = document.createElement("div");
                            css(imageCol, "display:flex;flex-direction:column;align-items:center;gap:4px;flex:0 0 auto;");

                            const imgBox = document.createElement("div");
                            imgBox.dataset.cnMainImg = "1";
                            css(imgBox, "width:80px;height:80px;border-radius:4px;background:#1a1a1a;border:1px solid #333;display:flex;align-items:center;justify-content:center;cursor:pointer;overflow:hidden;");
                            const imgPreview = document.createElement("img");
                            css(imgPreview, "width:100%;height:100%;object-fit:cover;display:none;");
                            imgBox.appendChild(imgPreview);
                            const imgLabel = document.createElement("span");
                            imgLabel.textContent = "image";
                            css(imgLabel, "font-size:10px;color:#666;pointer-events:none;");
                            imgBox.appendChild(imgLabel);

                            // Caption showing the controlnet image's intrinsic
                            // pixel dimensions (#256). Filled from the preview
                            // <img> once it loads; hidden when there's no image.
                            const dimLabel = document.createElement("span");
                            css(dimLabel, "font-size:10px;color:#666;pointer-events:none;display:none;");
                            imgPreview.addEventListener("load", () => {
                                if (imgPreview.naturalWidth && imgPreview.naturalHeight) {
                                    dimLabel.textContent = `${imgPreview.naturalWidth} × ${imgPreview.naturalHeight}`;
                                    dimLabel.style.display = "block";
                                }
                            });

                            const imgFileInput = document.createElement("input");
                            imgFileInput.type = "file";
                            imgFileInput.accept = ".png,.jpg,.jpeg,.webp,.gif";
                            imgFileInput.style.display = "none";

                            const cnImagePath = cn.image || cn.image_name || "";

                            function updateCnImgPreview(src) {
                                if (src) {
                                    imgPreview.src = src;
                                    imgPreview.style.display = "block";
                                    imgLabel.style.display = "none";
                                } else {
                                    imgPreview.style.display = "none";
                                    imgLabel.style.display = "block";
                                    dimLabel.textContent = "";
                                    dimLabel.style.display = "none";
                                }
                            }

                            if (cnImagePath) {
                                updateCnImgPreview(`/view?filename=${encodeURIComponent(cnImagePath)}&type=input`);
                            }

                            imgBox.addEventListener("click", async () => {
                                const fileInput = document.createElement("input");
                                fileInput.type = "file";
                                fileInput.accept = ".png,.jpg,.jpeg,.webp,.gif,.bmp";
                                fileInput.style.display = "none";
                                document.body.appendChild(fileInput);
                                fileInput.click();
                                await new Promise((resolve) => {
                                    fileInput.addEventListener("change", async () => {
                                        const file = fileInput.files?.[0];
                                        if (file) {
                                            try {
                                                const form = new FormData();
                                                form.append("image", file);
                                                form.append("type", "input");
                                                form.append("overwrite", "true");
                                                const resp = await fetch("/upload/image", { method: "POST", body: form });
                                                const result = await resp.json();
                                                const fileName = result.name || file.name;
                                                arr[i].image = fileName;
                                                updateCnImgPreview(`/view?filename=${encodeURIComponent(fileName)}&type=input`);
                                                // Auto-set type + cover from the filename (#306).
                                                let inferredType = "";
                                                let siblingCover = "";
                                                try {
                                                    const types = await fetchCnTypes();
                                                    const res = inferCnFromImage(fileName, types);
                                                    inferredType = res.inferredType;
                                                    siblingCover = res.sibling;
                                                } catch { /* ignore */ }
                                                if (inferredType && !arr[i].type) arr[i].type = inferredType;
                                                // Prefer a sibling "_cover_" image as the cover; probe via /view.
                                                if (siblingCover && !coverFile && !coverSourcePath && setCoverFromCnImage) {
                                                    const probe = new Image();
                                                    probe.onload = () => { if (!coverFile && !coverSourcePath) setCoverFromCnImage(siblingCover); };
                                                    probe.src = `/view?filename=${encodeURIComponent(siblingCover)}&type=input`;
                                                }
                                                renderCNs();
                                            } catch { /* ignore */ }
                                        }
                                        document.body.removeChild(fileInput);
                                        resolve();
                                    });
                                });
                            });

                            imgFileInput.addEventListener("change", () => {
                                const file = imgFileInput.files?.[0];
                                if (file) {
                                    const reader = new FileReader();
                                    reader.onload = () => {
                                        updateCnImgPreview(reader.result);
                                    };
                                    reader.readAsDataURL(file);
                                }
                            });

                            imageCol.appendChild(imgBox);
                            imageCol.appendChild(dimLabel);
                            imageCol.appendChild(imgFileInput);
                            card.appendChild(imageCol);

                            // Right column (#311): Row 1 = model + Img res + delete;
                            // Row 2 = type (narrow) + Str/Start/End.
                            const rightCol = document.createElement("div");
                            css(rightCol, "flex:1;min-width:0;display:flex;flex-direction:column;gap:6px;");

                            // Row 1: model label, Img res checkbox, delete button.
                            const typeRow = document.createElement("div");
                            css(typeRow, "display:flex;gap:8px;align-items:center;");
                            const modelLabel = document.createElement("span");
                            const inferred = cn.model || cn.model_name
                                || (cn.type ? CN_MODEL_MAP[familyFolder(currentFamily)]?.[cn.type] || "" : "");
                            modelLabel.textContent = inferred ? `model: ${inferred}` : "model: \u2014";
                            css(modelLabel, "font-size:11px;color:#888;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;");
                            typeRow.appendChild(modelLabel);
                            const resWrap = document.createElement("label");
                            css(resWrap, "display:flex;align-items:center;gap:3px;font-size:10px;color:#888;white-space:nowrap;cursor:pointer;");
                            const resChk = document.createElement("input");
                            resChk.type = "checkbox";
                            resChk.checked = !!cn.resolution_from_image;
                            resChk.title = "Use this ControlNet image's dimensions as the generation resolution";
                            css(resChk, "width:14px;height:14px;cursor:pointer;margin:0;");
                            resChk.addEventListener("change", () => { arr[i].resolution_from_image = resChk.checked; });
                            resWrap.appendChild(resChk);
                            resWrap.appendChild(document.createTextNode("Img res"));
                            typeRow.appendChild(resWrap);
                            const removeBtn = makeSmallButton("\u2715");
                            removeBtn.addEventListener("click", () => { arr.splice(i, 1); renderCNs(); });
                            typeRow.appendChild(removeBtn);
                            rightCol.appendChild(typeRow);

                            // Row 2: type dropdown (narrow) + Str / Start / End.
                            const controlsRow = document.createElement("div");
                            css(controlsRow, "display:flex;gap:6px;align-items:flex-end;");
                            const makeCtlCol = (labelText, el, basis) => {
                                const col = document.createElement("div");
                                css(col, `${basis};min-width:0;display:flex;flex-direction:column;gap:2px;`);
                                const lbl = document.createElement("span");
                                lbl.textContent = labelText;
                                css(lbl, "font-size:10px;color:#888;");
                                el.style.width = "100%";
                                col.appendChild(lbl);
                                col.appendChild(el);
                                return col;
                            };
                            const typeDropdown = makeComfyDropdown(
                                [{ value: "", label: "\u2014 type \u2014" }],
                                cn.type || "",
                            );
                            (async () => {
                                try {
                                    const types = await fetchCnTypes();
                                    for (const t of types) {
                                        const o = document.createElement("option");
                                        o.value = t;
                                        o.textContent = t;
                                        if (t === cn.type) o.selected = true;
                                        typeDropdown.element.appendChild(o);
                                    }
                                } catch { /* ignore */ }
                            })();
                            typeDropdown.element.addEventListener("change", () => { arr[i].type = typeDropdown.element.value; renderCNs(); });
                            controlsRow.appendChild(makeCtlCol("Type", typeDropdown.container, "flex:0 0 96px"));

                            const strSlider = makeComfyValueSlider(cn.strength ?? 1.0, 0, 2, 0.05, (v) => { arr[i].strength = v; });
                            controlsRow.appendChild(makeCtlCol("Str", strSlider, "flex:1"));
                            const startSlider = makeComfyValueSlider(cn.start_percent ?? 0, 0, 1, 0.05, (v) => { arr[i].start_percent = v; });
                            controlsRow.appendChild(makeCtlCol("Start", startSlider, "flex:1"));
                            const endSlider = makeComfyValueSlider(cn.end_percent ?? 1, 0, 1, 0.05, (v) => { arr[i].end_percent = v; });
                            controlsRow.appendChild(makeCtlCol("End", endSlider, "flex:1"));

                            rightCol.appendChild(controlsRow);
                            card.appendChild(rightCol);
                            cnsBox.appendChild(card);
                        }

                        const addBtn = makeSmallButton("+ controlnet");
                        addBtn.addEventListener("click", () => {
                            arr.push({ type: "", image: "", strength: 1.0, start_percent: 0, end_percent: 1 });
                            renderCNs();
                        });
                        cnsBox.appendChild(addBtn);
                    }
                    renderCNs();
                }

                if (fieldType === "variants") {
                    const optsBox = document.createElement("div");
                    css(optsBox, "display:flex;flex-direction:column;gap:8px;");
                    fieldWrap.appendChild(optsBox);

                    function renderOpts() {
                        optsBox.replaceChildren();
                        for (const groupName of Object.keys(fieldState.variants)) {
                            const groupCard = document.createElement("div");
                            css(groupCard, "background:#252525;padding:10px;border-radius:6px;display:flex;flex-direction:column;gap:6px;border:1px solid #333;");

                            const headerRow = document.createElement("div");
                            css(headerRow, "display:flex;gap:6px;align-items:center;");
                            const groupNameInput = makeComfyInput(groupName, "group name");
                            groupNameInput.style.flex = "1";
                            const removeGroupBtn = makeSmallButton("\u2715 group");
                            groupNameInput.addEventListener("change", () => {
                                const newName = groupNameInput.value.trim();
                                if (!newName || newName === groupName) return;
                                if (fieldState.variants[newName]) { groupNameInput.value = groupName; return; }
                                fieldState.variants[newName] = fieldState.variants[groupName];
                                delete fieldState.variants[groupName];
                                renderOpts();
                            });
                            removeGroupBtn.addEventListener("click", () => {
                                delete fieldState.variants[groupName];
                                renderOpts();
                            });
                            headerRow.appendChild(groupNameInput);
                            headerRow.appendChild(removeGroupBtn);
                            groupCard.appendChild(headerRow);

                            let dragChoiceName = null;
                            const choiceNames = Object.keys(fieldState.variants[groupName] || {});
                            for (const choiceName of choiceNames) {
                                const choice = fieldState.variants[groupName][choiceName] || {};
                                const choiceCard = document.createElement("div");
                                css(choiceCard, "background:#1a1a1a;padding:8px;border-radius:4px;display:flex;flex-direction:column;gap:4px;");

                                // Header: drag handle + name (50%) + stem (50%)
                                const cRow = document.createElement("div");
                                css(cRow, "display:flex;gap:4px;align-items:center;");

                                // Hamburger handle (#331): drag to reorder the choice AND
                                // click to open the "Add field" menu (LoRA / ControlNet /
                                // Flake Link) for this choice \u2014 replaces the per-section
                                // "+ LoRA / + ControlNet / + Flake Link" buttons.
                                const dragHandle = document.createElement("span");
                                dragHandle.textContent = "\u2630";
                                css(dragHandle, "cursor:grab;color:#666;font-size:12px;padding:0 4px;user-select:none;");
                                dragHandle.title = "Drag to reorder \u2022 click to add a field";
                                dragHandle.draggable = true;
                                dragHandle.addEventListener("dragstart", (e) => {
                                    dragChoiceName = choiceName;
                                    choiceCard.style.opacity = "0.4";
                                    e.dataTransfer.effectAllowed = "move";
                                });
                                dragHandle.addEventListener("dragend", () => {
                                    dragChoiceName = null;
                                    choiceCard.style.opacity = "";
                                    for (const ind of optsBox.querySelectorAll(".choice-drop-indicator")) ind.remove();
                                });
                                dragHandle.addEventListener("click", (e) => {
                                    e.stopPropagation();
                                    openChoiceFieldMenu(dragHandle);
                                });
                                cRow.appendChild(dragHandle);

                                const cNameInput = makeComfyInput(choiceName, "choice name");
                                cNameInput.style.flex = "1 1 50%";
                                cNameInput.style.minWidth = "0";
                                cNameInput.addEventListener("change", () => {
                                    const newCName = cNameInput.value.trim();
                                    if (!newCName || newCName === choiceName) return;
                                    if (fieldState.variants[groupName][newCName]) { cNameInput.value = choiceName; return; }
                                    const newObj = {};
                                    for (const [k, v] of Object.entries(fieldState.variants[groupName])) {
                                        newObj[k === choiceName ? newCName : k] = v;
                                    }
                                    fieldState.variants[groupName] = newObj;
                                    renderOpts();
                                });
                                cRow.appendChild(cNameInput);

                                // Output stem on the same row (per #212).
                                const stemInput = makeComfyInput(choice.output_stem ?? "", "output stem");
                                stemInput.style.flex = "1 1 50%";
                                stemInput.style.minWidth = "0";
                                stemInput.title = "Output stem (appended to the flake's output path for this variant choice)";
                                stemInput.addEventListener("change", () => {
                                    fieldState.variants[groupName][choiceName] = fieldState.variants[groupName][choiceName] || {};
                                    fieldState.variants[groupName][choiceName].output_stem = stemInput.value || null;
                                });
                                cRow.appendChild(stemInput);
                                choiceCard.appendChild(cRow);

                                // Drop indicator wiring on the card itself.
                                choiceCard.addEventListener("dragover", (e) => {
                                    if (dragChoiceName === null || dragChoiceName === choiceName) return;
                                    e.preventDefault();
                                    e.dataTransfer.dropEffect = "move";
                                    for (const ind of optsBox.querySelectorAll(".choice-drop-indicator")) ind.remove();
                                    const indicator = document.createElement("div");
                                    indicator.className = "choice-drop-indicator";
                                    css(indicator, "height:2px;background:#2a6acf;border-radius:1px;margin:2px 0;");
                                    const rect = choiceCard.getBoundingClientRect();
                                    const above = (e.clientY - rect.top) < rect.height / 2;
                                    choiceCard.parentNode.insertBefore(indicator, above ? choiceCard : choiceCard.nextSibling);
                                });
                                choiceCard.addEventListener("dragleave", (e) => {
                                    const rect = choiceCard.getBoundingClientRect();
                                    if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
                                        for (const ind of optsBox.querySelectorAll(".choice-drop-indicator")) ind.remove();
                                    }
                                });
                                choiceCard.addEventListener("drop", (e) => {
                                    e.preventDefault();
                                    for (const ind of optsBox.querySelectorAll(".choice-drop-indicator")) ind.remove();
                                    if (dragChoiceName === null || dragChoiceName === choiceName) return;
                                    const rect = choiceCard.getBoundingClientRect();
                                    const above = (e.clientY - rect.top) < rect.height / 2;
                                    const keys = Object.keys(fieldState.variants[groupName]);
                                    const srcIdx = keys.indexOf(dragChoiceName);
                                    let dstIdx = keys.indexOf(choiceName);
                                    if (srcIdx < 0 || dstIdx < 0) return;
                                    keys.splice(srcIdx, 1);
                                    if (srcIdx < dstIdx) dstIdx--;
                                    if (!above) dstIdx++;
                                    keys.splice(dstIdx, 0, dragChoiceName);
                                    const newObj = {};
                                    for (const k of keys) newObj[k] = fieldState.variants[groupName][k];
                                    fieldState.variants[groupName] = newObj;
                                    dragChoiceName = null;
                                    renderOpts();
                                });

                                // Per #238: card body is one row with name+stem header + tall prompts on
                                // the left and a portrait (832x1216) image with a hover delete dropdown
                                // on the right.
                                if (cRow.parentNode === choiceCard) choiceCard.removeChild(cRow);

                                // #336: the cover image floats right so the header, prompts,
                                // and Variant LoRAs flow beside it; the LoRAs spill to full
                                // width once they extend past the bottom of the image.
                                const bodyRow = document.createElement("div");
                                css(bodyRow, "display:flow-root;");

                                const promptsWrap = document.createElement("div");
                                css(promptsWrap, "display:flex;gap:8px;align-items:flex-start;margin-top:6px;");

                                // Host for the Variant LoRAs section, kept in flow beside the
                                // floated image (populated by renderChoiceExtras). A plain block
                                // (not a BFC) so its rows wrap to full width past the image.
                                const loraHost = document.createElement("div");

                                const choicePosCol = document.createElement("div");
                                css(choicePosCol, "display:flex;flex-direction:column;gap:4px;min-width:0;min-height:0;");
                                promptsWrap.appendChild(choicePosCol);

                                const choiceNegCol = document.createElement("div");
                                css(choiceNegCol, "display:flex;flex-direction:column;gap:4px;min-width:0;min-height:0;");
                                promptsWrap.appendChild(choiceNegCol);

                                const rightCol = document.createElement("div");
                                css(rightCol, "float:right;margin:0 0 8px 10px;display:flex;flex-direction:column;align-items:center;gap:4px;");

                                // 832x1216 aspect (~0.684). At 160px wide -> 234px tall.
                                const IMG_W = 160, IMG_H = 234;
                                const imgBox = document.createElement("div");
                                css(imgBox, `position:relative;width:${IMG_W}px;height:${IMG_H}px;border-radius:4px;background:#1a1a1a;border:1px solid #333;display:flex;align-items:center;justify-content:center;cursor:pointer;overflow:hidden;flex-shrink:0;`);
                                const imgPreview = document.createElement("img");
                                css(imgPreview, "width:100%;height:100%;object-fit:cover;display:none;");
                                imgBox.appendChild(imgPreview);
                                const imgBoxLabel = document.createElement("span");
                                imgBoxLabel.textContent = "image";
                                css(imgBoxLabel, "font-size:11px;color:#666;pointer-events:none;");
                                imgBox.appendChild(imgBoxLabel);

                                // Hover-only delete button (top-right of image) -> dropdown menu (#238).
                                let _dropdownOpen = false;
                                const deleteBtn = document.createElement("button");
                                deleteBtn.type = "button";
                                deleteBtn.textContent = "✕";
                                deleteBtn.title = "Delete options";
                                css(deleteBtn, "position:absolute;top:6px;right:6px;z-index:2;width:22px;height:22px;padding:0;border-radius:4px;background:rgba(20,20,20,0.85);color:#ddd;border:1px solid #555;cursor:pointer;font-size:13px;line-height:1;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity 0.12s ease;");
                                imgBox.addEventListener("mouseenter", () => { deleteBtn.style.opacity = "1"; });
                                imgBox.addEventListener("mouseleave", () => { if (!_dropdownOpen) deleteBtn.style.opacity = "0"; });
                                imgBox.appendChild(deleteBtn);

                                const dropdown = document.createElement("div");
                                css(dropdown, "position:absolute;top:32px;right:6px;z-index:3;display:none;flex-direction:column;min-width:160px;background:#1f1f1f;border:1px solid #555;border-radius:4px;box-shadow:0 4px 12px rgba(0,0,0,0.5);overflow:hidden;");
                                function makeDropdownItem(label, onClick, danger) {
                                    const item = document.createElement("button");
                                    item.type = "button";
                                    item.textContent = label;
                                    css(item, `background:transparent;border:none;color:${danger ? "#f99" : "#ddd"};padding:8px 12px;text-align:left;font-size:12px;cursor:pointer;`);
                                    item.addEventListener("mouseenter", () => { item.style.background = "rgba(255,255,255,0.05)"; });
                                    item.addEventListener("mouseleave", () => { item.style.background = "transparent"; });
                                    item.addEventListener("click", (e) => { e.stopPropagation(); closeDropdown(); onClick(); });
                                    return item;
                                }
                                function refreshDropdown() {
                                    dropdown.replaceChildren();
                                    const cur = fieldState.variants[groupName][choiceName] || {};
                                    if (cur.image) {
                                        dropdown.appendChild(makeDropdownItem("Remove image", () => {
                                            delete cur.image;
                                            refreshChoiceImage();
                                        }, false));
                                    }
                                    dropdown.appendChild(makeDropdownItem("Delete choice", () => {
                                        delete fieldState.variants[groupName][choiceName];
                                        renderOpts();
                                    }, true));
                                }
                                function openDropdown() {
                                    refreshDropdown();
                                    dropdown.style.display = "flex";
                                    _dropdownOpen = true;
                                    setTimeout(() => document.addEventListener("mousedown", outsideClick), 0);
                                }
                                function closeDropdown() {
                                    dropdown.style.display = "none";
                                    _dropdownOpen = false;
                                    deleteBtn.style.opacity = "0";
                                    document.removeEventListener("mousedown", outsideClick);
                                }
                                function outsideClick(e) {
                                    if (!dropdown.contains(e.target) && e.target !== deleteBtn) closeDropdown();
                                }
                                deleteBtn.addEventListener("click", (e) => {
                                    e.stopPropagation();
                                    if (_dropdownOpen) closeDropdown(); else openDropdown();
                                });
                                imgBox.appendChild(dropdown);

                                function refreshChoiceImage() {
                                    const cur = fieldState.variants[groupName][choiceName] || {};
                                    if (cur.image) {
                                        if (cur._uploaded) {
                                            imgPreview.src = `/view?filename=${encodeURIComponent(cur.image)}&type=input`;
                                        } else if (mode !== "create" && name) {
                                            imgPreview.src = getVariantImageUrl(name, groupName, choiceName);
                                        } else {
                                            imgPreview.src = `/view?filename=${encodeURIComponent(cur.image)}&type=input`;
                                        }
                                        imgPreview.style.display = "block";
                                        imgBoxLabel.style.display = "none";
                                    } else {
                                        imgPreview.style.display = "none";
                                        imgBoxLabel.style.display = "block";
                                    }
                                }
                                imgBox.addEventListener("click", async (e) => {
                                    // Skip the file picker when the user clicks the delete button or its
                                    // dropdown — those have their own handlers.
                                    if (e.target === deleteBtn || dropdown.contains(e.target)) return;
                                    const fileInput = document.createElement("input");
                                    fileInput.type = "file";
                                    fileInput.accept = ".png,.jpg,.jpeg,.webp,.gif,.bmp";
                                    fileInput.style.display = "none";
                                    document.body.appendChild(fileInput);
                                    fileInput.click();
                                    await new Promise((resolve) => {
                                        fileInput.addEventListener("change", async () => {
                                            const file = fileInput.files?.[0];
                                            if (!file) { document.body.removeChild(fileInput); resolve(); return; }
                                            try {
                                                const form = new FormData();
                                                form.append("image", file);
                                                form.append("type", "input");
                                                form.append("overwrite", "true");
                                                const resp = await fetch("/upload/image", { method: "POST", body: form });
                                                const result = await resp.json();
                                                const fileName = result.name || file.name;
                                                fieldState.variants[groupName][choiceName] = fieldState.variants[groupName][choiceName] || {};
                                                fieldState.variants[groupName][choiceName].image = fileName;
                                                fieldState.variants[groupName][choiceName]._uploaded = true;
                                                refreshChoiceImage();
                                            } catch { /* ignore */ }
                                            document.body.removeChild(fileInput);
                                            resolve();
                                        });
                                    });
                                });
                                rightCol.appendChild(imgBox);
                                refreshChoiceImage();

                                // Float (image) first in source order so the header, prompts,
                                // and LoRAs that follow wrap to its left (#336).
                                bodyRow.appendChild(rightCol);
                                bodyRow.appendChild(cRow);
                                bodyRow.appendChild(promptsWrap);
                                bodyRow.appendChild(loraHost);
                                choiceCard.appendChild(bodyRow);

                                function renderChoicePrompts() {
                                    choicePosCol.replaceChildren();
                                    choiceNegCol.replaceChildren();

                                    // Positive spans the width when alone; equal
                                    // split with a compact "+ Negative" otherwise (#264).
                                    const hasNeg = choice.negative != null;
                                    choicePosCol.style.flex = hasNeg ? "1 1 0" : "1 1 auto";
                                    choiceNegCol.style.flex = hasNeg ? "1 1 0" : "0 0 auto";

                                    // Positive override is always present by default (#332)
                                    // — no "+ Positive" button. Empty values are pruned on save.
                                    fieldState.variants[groupName][choiceName] = fieldState.variants[groupName][choiceName] || {};
                                    if (choice.positive == null) choice.positive = "";
                                    {
                                        const cPos = makeTextarea(choice.positive || "", "extra positive", 2);
                                        // Content-sized beside the floated image; autogrows (#336).
                                        css(cPos, "background:#1a1a1a;color:#ddd;border:1px solid #333;padding:6px;border-radius:4px;font-size:12px;width:100%;min-height:64px;box-sizing:border-box;font-family:inherit;resize:vertical;outline:none;");
                                        attachAutoGrow(cPos);
                                        cPos.addEventListener("change", () => {
                                            fieldState.variants[groupName][choiceName] = fieldState.variants[groupName][choiceName] || {};
                                            fieldState.variants[groupName][choiceName].positive = cPos.value;
                                        });
                                        const posWrap = makeHoverRemoveWrapper(cPos, () => {
                                            delete fieldState.variants[groupName][choiceName].positive;
                                            renderChoicePrompts();
                                        }, "Remove positive prompt");
                                        css(posWrap, "min-height:0;");
                                        choicePosCol.appendChild(posWrap);
                                    }

                                    if (choice.negative != null) {
                                        const cNeg = makeTextarea(choice.negative || "", "extra negative", 2);
                                        css(cNeg, "background:#1a1a1a;color:#ddd;border:1px solid #333;padding:6px;border-radius:4px;font-size:12px;width:100%;min-height:64px;box-sizing:border-box;font-family:inherit;resize:vertical;outline:none;");
                                        attachAutoGrow(cNeg);
                                        cNeg.addEventListener("change", () => {
                                            fieldState.variants[groupName][choiceName] = fieldState.variants[groupName][choiceName] || {};
                                            fieldState.variants[groupName][choiceName].negative = cNeg.value;
                                        });
                                        const negWrap = makeHoverRemoveWrapper(cNeg, () => {
                                            delete fieldState.variants[groupName][choiceName].negative;
                                            renderChoicePrompts();
                                        }, "Remove negative prompt");
                                        css(negWrap, "min-height:0;");
                                        choiceNegCol.appendChild(negWrap);
                                    } else {
                                        const negBtn = document.createElement("button");
                                        negBtn.textContent = "+ Negative";
                                        css(negBtn, "align-self:flex-start;cursor:pointer;border-radius:4px;font-size:13px;background:#2a2a2a;color:#999;border:1px dashed #555;transition:background 0.15s ease;user-select:none;box-sizing:border-box;white-space:nowrap;padding:6px 10px;");
                                        negBtn.addEventListener("mouseenter", () => { negBtn.style.background = "#333"; });
                                        negBtn.addEventListener("mouseleave", () => { negBtn.style.background = "#2a2a2a"; });
                                        negBtn.addEventListener("click", () => {
                                            fieldState.variants[groupName][choiceName] = fieldState.variants[groupName][choiceName] || {};
                                            fieldState.variants[groupName][choiceName].negative = fieldState.variants[groupName][choiceName].negative ?? "";
                                            renderChoicePrompts();
                                        });
                                        choiceNegCol.appendChild(negBtn);
                                    }
                                }
                                renderChoicePrompts();

                                // Per-choice LoRAs / ControlNets / Flake Links (#299):
                                // a variant choice carries its own, merged on top of the
                                // flake at generation. Persisted under variants[g][c].* and
                                // saved automatically via ordered.variants (empties pruned).
                                const extrasHost = document.createElement("div");
                                css(extrasHost, "display:flex;flex-direction:column;gap:3px;margin-top:6px;");
                                choiceCard.appendChild(extrasHost);

                                async function pickChoiceTarget() {
                                    try {
                                        const list = await (await fetch(`/flakes/list?family=${encodeURIComponent(currentFamily || "")}`)).json();
                                        const flakes = (list.flakes || []).filter((n) => n !== name);
                                        const res = await openFileLoadPicker({ flakes, directories: list.directories || [], family: currentFamily || "", displayNames: list.display_names || {}, tagNames: list.tag_names || {} });
                                        return res && res.name ? res.name : null;
                                    } catch { return null; }
                                }

                                // Add a field to this variant choice (#331). Mirrors the
                                // old per-section "+ X" button actions, now reached from the
                                // hamburger handle's dropdown.
                                async function addChoiceField(key) {
                                    const co = fieldState.variants[groupName][choiceName] || (fieldState.variants[groupName][choiceName] = {});
                                    if (key === "lora") {
                                        if (!Array.isArray(co.loras)) co.loras = [];
                                        co.loras.push({ name: "", path: "", strength: 1.0 });
                                        renderChoiceExtras();
                                    } else if (key === "controlnets") {
                                        if (!Array.isArray(co.controlnets)) co.controlnets = [];
                                        co.controlnets.push({ type: "", image: "", strength: 1.0 });
                                        renderChoiceExtras();
                                    } else if (key === "flake_link") {
                                        const t = await pickChoiceTarget();
                                        if (!t) return;
                                        if (!Array.isArray(co.flake_links)) co.flake_links = [];
                                        co.flake_links.push({ target: t, variant: {}, lora_strengths: [] });
                                        renderChoiceExtras();
                                    }
                                }

                                // Transient "Add field" popup anchored under the hamburger.
                                function openChoiceFieldMenu(anchorEl) {
                                    const menu = document.createElement("div");
                                    css(menu, "display:flex;flex-direction:column;gap:2px;background:#1e1e1e;border:1px solid #444;border-radius:4px;padding:4px;box-shadow:0 4px 12px rgba(0,0,0,0.5);position:fixed;z-index:10000;");
                                    const opts = [
                                        { key: "lora", label: "LoRA" },
                                        { key: "controlnets", label: "ControlNet" },
                                        { key: "flake_link", label: "Flake Link" },
                                    ];
                                    function cleanup() {
                                        document.removeEventListener("click", onOutside, true);
                                        if (menu.parentElement) menu.remove();
                                    }
                                    function onOutside(e) {
                                        if (!menu.contains(e.target) && e.target !== anchorEl) cleanup();
                                    }
                                    for (const o of opts) {
                                        const it = document.createElement("button");
                                        it.textContent = o.label;
                                        css(it, "text-align:left;padding:4px 8px;background:#2a2a2a;color:#ddd;border:1px solid #444;border-radius:3px;cursor:pointer;font-size:12px;");
                                        it.addEventListener("click", (e) => { e.stopPropagation(); cleanup(); addChoiceField(o.key); });
                                        menu.appendChild(it);
                                    }
                                    document.body.appendChild(menu);
                                    const rect = anchorEl.getBoundingClientRect();
                                    menu.style.left = `${rect.left}px`;
                                    menu.style.top = `${rect.bottom + 4}px`;
                                    // Defer so the opening click doesn't immediately close it.
                                    setTimeout(() => document.addEventListener("click", onOutside, true), 0);
                                }

                                function renderChoiceExtras() {
                                    extrasHost.replaceChildren();
                                    loraHost.replaceChildren();
                                    const co = fieldState.variants[groupName][choiceName] || (fieldState.variants[groupName][choiceName] = {});
                                    const sectionLabel = (text, host = extrasHost) => {
                                        const l = document.createElement("div");
                                        l.textContent = text;
                                        css(l, "font-size:11px;color:#aaa;font-weight:500;margin-top:6px;");
                                        host.appendChild(l);
                                    };
                                    // ---- LoRAs ---- (rendered into loraHost, beside the floated
                                    // cover image, wrapping to full width when tall — #336)
                                    const loras = Array.isArray(co.loras) ? co.loras : [];
                                    if (loras.length) sectionLabel("Variant LoRAs", loraHost);
                                    loras.forEach((lr, i) => {
                                        const row = document.createElement("div");
                                        css(row, "display:flex;gap:6px;align-items:center;margin-top:3px;");
                                        // Clickable box that opens the same "Select LoRA" file
                                        // popup as the regular flake LoRA section (#310).
                                        const box = document.createElement("div");
                                        css(box, "flex:1;min-width:0;background:#1a1a1a;color:#ddd;border:1px solid #333;padding:5px 8px;border-radius:6px;font-size:12px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;");
                                        const showName = () => { box.textContent = lr.path ? lr.path.replace(/\.safetensors?$/i, "").split(/[\\/]/).pop() : "Select LoRA…"; box.title = lr.path || ""; };
                                        showName();
                                        box.addEventListener("click", async () => {
                                            const result = await openFileBrowser({ type: "loras", defaultPath: "" });
                                            if (result && result.file) { lr.path = result.file; showName(); }
                                        });
                                        row.appendChild(box);
                                        const slider = makeSmallValueSlider(lr.strength ?? 1.0, 0, 2, 0.05, (v) => { lr.strength = v; });
                                        slider.style.flex = "0 0 110px";
                                        row.appendChild(slider);
                                        const rm = makeSmallButton("✕");
                                        rm.addEventListener("click", () => { loras.splice(i, 1); if (!loras.length) delete co.loras; renderChoiceExtras(); });
                                        row.appendChild(rm);
                                        loraHost.appendChild(row);
                                    });
                                    // ---- ControlNets ----
                                    const cnets = Array.isArray(co.controlnets) ? co.controlnets : [];
                                    if (cnets.length) sectionLabel("Variant ControlNets");
                                    cnets.forEach((cn, i) => {
                                        // Image-left + fields-right layout matching the
                                        // regular CN section (#311).
                                        const card = document.createElement("div");
                                        css(card, "display:flex;gap:8px;align-items:flex-start;background:#252525;padding:6px;border-radius:6px;border:1px solid #333;");
                                        const imgBox = document.createElement("div");
                                        css(imgBox, "flex:0 0 72px;width:72px;height:72px;border:1px solid #333;border-radius:6px;background:#1a1a1a;cursor:pointer;overflow:hidden;display:flex;align-items:center;justify-content:center;");
                                        const imgPrev = document.createElement("img");
                                        css(imgPrev, "width:100%;height:100%;object-fit:cover;display:none;");
                                        const imgPlaceholder = document.createElement("span");
                                        imgPlaceholder.textContent = "+ img";
                                        css(imgPlaceholder, "font-size:10px;color:#888;");
                                        imgBox.appendChild(imgPrev);
                                        imgBox.appendChild(imgPlaceholder);
                                        // Caption with the ControlNet image's intrinsic dimensions,
                                        // shown below the image like the top-level CN section (#256/#351).
                                        const dimCap = document.createElement("span");
                                        css(dimCap, "font-size:10px;color:#666;display:none;");
                                        imgPrev.addEventListener("load", () => {
                                            if (imgPrev.naturalWidth && imgPrev.naturalHeight) {
                                                dimCap.textContent = `${imgPrev.naturalWidth} × ${imgPrev.naturalHeight}`;
                                                dimCap.style.display = "block";
                                            }
                                        });
                                        const showImg = () => {
                                            if (cn.image) { imgPrev.src = `/view?filename=${encodeURIComponent(cn.image)}&type=input`; imgPrev.style.display = "block"; imgPlaceholder.style.display = "none"; }
                                            else { imgPrev.style.display = "none"; imgPlaceholder.style.display = "block"; dimCap.textContent = ""; dimCap.style.display = "none"; }
                                        };
                                        showImg();
                                        imgBox.addEventListener("click", () => {
                                            const fi = document.createElement("input");
                                            fi.type = "file"; fi.accept = ".png,.jpg,.jpeg,.webp,.gif,.bmp"; fi.style.display = "none";
                                            document.body.appendChild(fi); fi.click();
                                            fi.addEventListener("change", async () => {
                                                const file = fi.files?.[0];
                                                if (file) {
                                                    try {
                                                        const form = new FormData(); form.append("image", file); form.append("type", "input"); form.append("overwrite", "true");
                                                        const resp = await fetch("/upload/image", { method: "POST", body: form });
                                                        const result = await resp.json();
                                                        cn.image = result.name || file.name;
                                                        if (!cn.type) { try { const types = await fetchCnTypes(); const r = inferCnFromImage(cn.image, types); if (r.inferredType) cn.type = r.inferredType; } catch { /* ignore */ } }
                                                        renderChoiceExtras();
                                                    } catch { /* ignore */ }
                                                }
                                                document.body.removeChild(fi);
                                            });
                                        });
                                        const imageCol = document.createElement("div");
                                        css(imageCol, "flex:0 0 auto;display:flex;flex-direction:column;align-items:center;gap:3px;");
                                        imageCol.appendChild(imgBox);
                                        imageCol.appendChild(dimCap);
                                        card.appendChild(imageCol);

                                        const right = document.createElement("div");
                                        css(right, "flex:1;min-width:0;display:flex;flex-direction:column;gap:6px;");
                                        const r1 = document.createElement("div");
                                        css(r1, "display:flex;gap:8px;align-items:center;");
                                        const modelLbl = document.createElement("span");
                                        const inferredModel = cn.model || cn.model_name || (cn.type ? CN_MODEL_MAP[familyFolder(currentFamily)]?.[cn.type] || "" : "");
                                        modelLbl.textContent = inferredModel ? `model: ${inferredModel}` : "model: —";
                                        css(modelLbl, "font-size:11px;color:#888;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;");
                                        r1.appendChild(modelLbl);
                                        const resW = document.createElement("label");
                                        css(resW, "display:flex;align-items:center;gap:3px;font-size:10px;color:#888;white-space:nowrap;cursor:pointer;");
                                        const resC = document.createElement("input"); resC.type = "checkbox"; resC.checked = !!cn.resolution_from_image; css(resC, "width:14px;height:14px;cursor:pointer;margin:0;");
                                        resC.addEventListener("change", () => { cn.resolution_from_image = resC.checked; });
                                        resW.appendChild(resC); resW.appendChild(document.createTextNode("Img res"));
                                        r1.appendChild(resW);
                                        const rmBtn = makeSmallButton("✕");
                                        rmBtn.addEventListener("click", () => { cnets.splice(i, 1); if (!cnets.length) delete co.controlnets; renderChoiceExtras(); });
                                        r1.appendChild(rmBtn);
                                        right.appendChild(r1);

                                        const r2 = document.createElement("div");
                                        css(r2, "display:flex;gap:6px;align-items:flex-end;");
                                        const ctlCol = (labelText, el, basis) => { const c = document.createElement("div"); css(c, `${basis};min-width:0;display:flex;flex-direction:column;gap:2px;`); const l = document.createElement("span"); l.textContent = labelText; css(l, "font-size:10px;color:#888;"); el.style.width = "100%"; c.appendChild(l); c.appendChild(el); return c; };
                                        const typeDD = makeComfyDropdown([{ value: "", label: "— type —" }], cn.type || "");
                                        fetchCnTypes().then((types) => { for (const t of types) { const o = document.createElement("option"); o.value = t; o.textContent = t; if (t === cn.type) o.selected = true; typeDD.element.appendChild(o); } }).catch(() => {});
                                        typeDD.element.addEventListener("change", () => { cn.type = typeDD.element.value; renderChoiceExtras(); });
                                        r2.appendChild(ctlCol("Type", typeDD.container, "flex:0 0 96px"));
                                        const strS = makeComfyValueSlider(cn.strength ?? 1.0, 0, 2, 0.05, (v) => { cn.strength = v; });
                                        r2.appendChild(ctlCol("Str", strS, "flex:1"));
                                        const startS = makeComfyValueSlider(cn.start_percent ?? 0, 0, 1, 0.05, (v) => { cn.start_percent = v; });
                                        r2.appendChild(ctlCol("Start", startS, "flex:1"));
                                        const endS = makeComfyValueSlider(cn.end_percent ?? 1, 0, 1, 0.05, (v) => { cn.end_percent = v; });
                                        r2.appendChild(ctlCol("End", endS, "flex:1"));
                                        right.appendChild(r2);
                                        card.appendChild(right);
                                        extrasHost.appendChild(card);
                                    });
                                    // ---- Flake Links ----
                                    const links = Array.isArray(co.flake_links) ? co.flake_links : [];
                                    if (links.length) sectionLabel("Variant Flake Links");
                                    links.forEach((link, li) => {
                                        const card = document.createElement("div");
                                        css(card, "background:#252525;padding:6px;border-radius:6px;border:1px solid #333;display:flex;flex-direction:column;gap:6px;");
                                        const header = document.createElement("div");
                                        css(header, "display:flex;gap:8px;align-items:center;");
                                        const title = document.createElement("span");
                                        title.textContent = link.target ? link.target.split("/").pop() : "(no target)";
                                        title.title = link.target || "";
                                        css(title, "flex:1;font-size:12px;color:#cdd;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;");
                                        header.appendChild(title);
                                        const chg = makeSmallButton("Change");
                                        chg.addEventListener("click", async () => { const t = await pickChoiceTarget(); if (t) { link.target = t; link.lora_strengths = []; renderChoiceExtras(); } });
                                        header.appendChild(chg);
                                        const rm = makeSmallButton("✕");
                                        rm.addEventListener("click", () => { links.splice(li, 1); if (!links.length) delete co.flake_links; renderChoiceExtras(); });
                                        header.appendChild(rm);
                                        card.appendChild(header);
                                        const ovr = document.createElement("div");
                                        css(ovr, "display:flex;flex-direction:column;gap:4px;");
                                        card.appendChild(ovr);
                                        if (link.target) {
                                            fetchFlake(link.target).then((ld) => {
                                                const lps = (Array.isArray(ld.loras) && ld.loras.length) ? ld.loras : (ld.path ? [{ name: "", path: ld.path, strength: ld.strength ?? 1.0 }] : []);
                                                if (!Array.isArray(link.lora_strengths)) link.lora_strengths = [];
                                                lps.forEach((lr, i) => {
                                                    const r = document.createElement("div");
                                                    css(r, "display:flex;gap:6px;align-items:center;");
                                                    const nm = document.createElement("span");
                                                    nm.textContent = lr.name || lr.path || `LoRA ${i + 1}`;
                                                    css(nm, "flex:0 0 120px;font-size:11px;color:#bbb;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;");
                                                    r.appendChild(nm);
                                                    const cur = link.lora_strengths[i];
                                                    const init = (cur === null || cur === undefined) ? (lr.strength ?? 1.0) : cur;
                                                    const sl = makeComfyValueSlider(init, -10, 10, 0.05, (v) => { while (link.lora_strengths.length <= i) link.lora_strengths.push(null); link.lora_strengths[i] = v; });
                                                    sl.style.flex = "1";
                                                    r.appendChild(sl);
                                                    ovr.appendChild(r);
                                                });
                                            }).catch(() => {});
                                        }
                                        extrasHost.appendChild(card);
                                    });
                                }
                                renderChoiceExtras();

                                groupCard.appendChild(choiceCard);
                            }

                            const addChoiceBtn = makeSmallButton("+ choice");
                            addChoiceBtn.addEventListener("click", (e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                const inlineWrap = document.createElement("div");
                                css(inlineWrap, "display:flex;gap:6px;align-items:center;padding-top:4px;");
                                const choiceNameInput = makeComfyInput("", "e.g. red dress");
                                choiceNameInput.style.flex = "1";
                                const addBtn = makeSmallButton("Add");
                                const cancelBtn = makeSmallButton("Cancel");
                                inlineWrap.appendChild(choiceNameInput);
                                inlineWrap.appendChild(addBtn);
                                inlineWrap.appendChild(cancelBtn);
                                addChoiceBtn.replaceWith(inlineWrap);
                                choiceNameInput.focus();

                                function finish() {
                                    inlineWrap.replaceWith(addChoiceBtn);
                                }

                                addBtn.addEventListener("click", async () => {
                                    const trimmed = choiceNameInput.value.trim();
                                    if (!trimmed) { finish(); return; }
                                    if (fieldState.variants[groupName][trimmed]) {
                                        window.alert(`Choice '${trimmed}' already exists in this group.`);
                                        finish();
                                        return;
                                    }
                                    const choiceData = { positive: "" };
                                    // Auto-detect variant sibling image from first LoRA
                                    const firstLora = Array.isArray(data.loras) ? data.loras[0] : null;
                                    const loraPath = firstLora?.path || firstLora?.name || null;
                                    if (loraPath) {
                                        try {
                                            const siblingPath = await fetchLoraVariantSiblingImagePath(loraPath, groupName, trimmed);
                                            if (siblingPath) {
                                                choiceData.image = siblingPath;
                                            }
                                        } catch { /* ignore */ }
                                    }
                                    fieldState.variants[groupName][trimmed] = choiceData;
                                    finish();
                                    renderOpts();
                                });
                                cancelBtn.addEventListener("click", finish);
                                choiceNameInput.addEventListener("keydown", (ev) => {
                                    if (ev.key === "Enter") {
                                        ev.preventDefault();
                                        addBtn.click();
                                    }
                                    if (ev.key === "Escape") {
                                        ev.preventDefault();
                                        finish();
                                    }
                                });
                            });
                            groupCard.appendChild(addChoiceBtn);
                            optsBox.appendChild(groupCard);
                        }

                        const addGroupBtn = makeSmallButton("+ variant group");
                        addGroupBtn.addEventListener("click", (e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            // Replace the button with an inline input + add/cancel controls
                            const inlineWrap = document.createElement("div");
                            css(inlineWrap, "display:flex;gap:6px;align-items:center;");
                            const groupNameInput = makeComfyInput("", "e.g. outfit");
                            groupNameInput.style.flex = "1";
                            const addBtn = makeSmallButton("Add");
                            const cancelBtn = makeSmallButton("Cancel");
                            inlineWrap.appendChild(groupNameInput);
                            inlineWrap.appendChild(addBtn);
                            inlineWrap.appendChild(cancelBtn);
                            addGroupBtn.replaceWith(inlineWrap);
                            groupNameInput.focus();

                            function finish() {
                                inlineWrap.replaceWith(addGroupBtn);
                            }

                            addBtn.addEventListener("click", () => {
                                const trimmed = groupNameInput.value.trim();
                                if (!trimmed) { finish(); return; }
                                if (fieldState.variants[trimmed]) {
                                    window.alert(`Variant group '${trimmed}' already exists.`);
                                    finish();
                                    return;
                                }
                                fieldState.variants[trimmed] = {};
                                finish();
                                renderOpts();
                            });
                            cancelBtn.addEventListener("click", finish);
                            groupNameInput.addEventListener("keydown", (ev) => {
                                if (ev.key === "Enter") {
                                    ev.preventDefault();
                                    addBtn.click();
                                }
                                if (ev.key === "Escape") {
                                    ev.preventDefault();
                                    finish();
                                }
                            });
                        });
                        optsBox.appendChild(addGroupBtn);
                    }
                    renderOpts();
                }

                if (fieldType === "flake_link") {
                    // Flake links field (#234): one or more linked flakes, each
                    // picked via an overlay (search + folders), with optional
                    // default overrides for the target's variant choices and lora
                    // strengths. Persisted as `flake_links:` (list).
                    const linkBox = document.createElement("div");
                    css(linkBox, "display:flex;flex-direction:column;gap:8px;");
                    fieldWrap.appendChild(linkBox);

                    if (!Array.isArray(fieldState.flake_links)) fieldState.flake_links = [];

                    // Render one link's variant + lora-strength overrides into box.
                    function renderOneLinkOverrides(link, box) {
                        box.replaceChildren();
                        if (!link.target) return;
                        (async () => {
                            let linkedData;
                            try {
                                linkedData = await fetchFlake(link.target);
                            } catch {
                                const err = document.createElement("div");
                                err.textContent = `Target not found: ${link.target}`;
                                css(err, "font-size:11px;color:#f99;");
                                box.appendChild(err);
                                return;
                            }
                            const variants = linkedData.variants || linkedData.options || {};
                            if (Object.keys(variants).length > 0) {
                                const vLabel = document.createElement("div");
                                vLabel.textContent = "Variant choice override (saved on this flake)";
                                css(vLabel, "font-size:11px;color:#aaa;font-weight:500;");
                                box.appendChild(vLabel);
                                for (const [group, choices] of Object.entries(variants)) {
                                    const row = document.createElement("div");
                                    css(row, "display:flex;gap:8px;align-items:center;");
                                    const gLabel = document.createElement("span");
                                    gLabel.textContent = group;
                                    css(gLabel, "flex:0 0 120px;font-size:12px;color:#bbb;");
                                    row.appendChild(gLabel);
                                    const opts = [{ value: "", label: "— none —" }, ...Object.keys(choices).map(c => ({ value: c, label: c }))];
                                    const dd = makeComfyDropdown(opts, link.variant?.[group] || "");
                                    dd.element.addEventListener("change", () => {
                                        link.variant = link.variant || {};
                                        if (dd.element.value) link.variant[group] = dd.element.value;
                                        else delete link.variant[group];
                                    });
                                    css(dd.container, "flex:1;min-width:0;");
                                    row.appendChild(dd.container);
                                    box.appendChild(row);
                                }
                            }
                            // Linked flake's LoRAs — the modern `loras` list, or a
                            // legacy single LoRA stored as `path`/`strength` (#300).
                            // Without the legacy fallback, a single-LoRA target shows
                            // no override sliders at all.
                            const loras = (Array.isArray(linkedData.loras) && linkedData.loras.length)
                                ? linkedData.loras
                                : (linkedData.path ? [{ name: "", path: linkedData.path, strength: linkedData.strength ?? 1.0 }] : []);
                            if (loras.length > 0) {
                                const lLabel = document.createElement("div");
                                lLabel.textContent = "LoRA strength overrides";
                                css(lLabel, "font-size:11px;color:#aaa;font-weight:500;margin-top:4px;");
                                box.appendChild(lLabel);
                                link.lora_strengths = link.lora_strengths || [];
                                while (link.lora_strengths.length < loras.length) link.lora_strengths.push(null);
                                loras.forEach((lr, i) => {
                                    const row = document.createElement("div");
                                    css(row, "display:flex;gap:8px;align-items:center;");
                                    const nm = document.createElement("span");
                                    nm.textContent = lr.name || lr.path || `LoRA ${i + 1}`;
                                    css(nm, "flex:0 0 160px;font-size:12px;color:#bbb;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;");
                                    row.appendChild(nm);
                                    const cur = link.lora_strengths[i];
                                    const defaultStrength = lr.strength ?? 1.0;
                                    const initial = (cur === null || cur === undefined) ? defaultStrength : cur;
                                    // makeSmallValueSlider returns a bare element (not {container}).
                                    // The old `.container` access made css() throw, so the
                                    // sliders never rendered — only the label did (#307).
                                    // Range matches the grid override dropdown (-10..10).
                                    // Uses the larger makeComfyValueSlider for readability (#312).
                                    const slider = makeComfyValueSlider(initial, -10, 10, 0.05, (v) => {
                                        link.lora_strengths[i] = v;
                                    });
                                    slider.style.flex = "1";
                                    row.appendChild(slider);
                                    const resetBtn = makeSmallButton("↺");
                                    resetBtn.title = "Use linked flake's default strength";
                                    resetBtn.addEventListener("click", () => {
                                        link.lora_strengths[i] = null;
                                        renderOneLinkOverrides(link, box);
                                    });
                                    row.appendChild(resetBtn);
                                    box.appendChild(row);
                                });
                            }
                        })();
                    }

                    function renderLinks() {
                        linkBox.replaceChildren();
                        fieldState.flake_links.forEach((link, li) => {
                            const card = document.createElement("div");
                            css(card, "background:#252525;padding:8px;border-radius:6px;border:1px solid #333;display:flex;flex-direction:column;gap:6px;");
                            const header = document.createElement("div");
                            css(header, "display:flex;gap:8px;align-items:center;");
                            const title = document.createElement("span");
                            title.textContent = link.target ? link.target.split("/").pop() : "(no target)";
                            title.title = link.target || "";
                            css(title, "flex:1;font-size:12px;font-weight:500;color:#cdd;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;");
                            header.appendChild(title);
                            const changeBtn = makeSmallButton("Change");
                            changeBtn.addEventListener("click", async () => {
                                const picked = await pickFlakeTarget();
                                if (picked && picked !== link.target) {
                                    link.target = picked;
                                    link.variant = {};
                                    link.lora_strengths = [];
                                    renderLinks();
                                }
                            });
                            header.appendChild(changeBtn);
                            const removeBtn = makeSmallButton("✕");
                            removeBtn.addEventListener("click", () => {
                                fieldState.flake_links.splice(li, 1);
                                renderLinks();
                            });
                            header.appendChild(removeBtn);
                            card.appendChild(header);
                            const ovrBox = document.createElement("div");
                            css(ovrBox, "display:flex;flex-direction:column;gap:6px;");
                            card.appendChild(ovrBox);
                            renderOneLinkOverrides(link, ovrBox);
                            linkBox.appendChild(card);
                        });
                        const addBtn = makeSmallButton("+ Add flake link");
                        addBtn.addEventListener("click", async () => {
                            const picked = await pickFlakeTarget();
                            if (picked) {
                                fieldState.flake_links.push({ target: picked, variant: {}, lora_strengths: [] });
                                renderLinks();
                            }
                        });
                        linkBox.appendChild(addBtn);
                    }

                    renderLinks();
                }

                optionalBox.appendChild(fieldWrap);
            }
        }
        renderFields();

        // Add field UI: a single "+ Add field" button that opens a dropdown with
        // every field type. The standalone +LoRA / +ControlNet / +Flake Link quick
        // buttons were removed (#330); those types live in the dropdown instead.
        const addFieldWrap = document.createElement("div");
        css(addFieldWrap, "display:flex;flex-direction:column;gap:2px;");

        const btnRow = document.createElement("div");
        css(btnRow, "display:flex;gap:8px;align-items:center;flex-wrap:wrap;");

        // "+ Add field" dropdown for every field type.
        const addFieldBtn = makeSmallButton("+ Add field");
        btnRow.appendChild(addFieldBtn);

        const fieldMenu = document.createElement("div");
        css(fieldMenu, "display:none;flex-direction:column;gap:2px;background:#1e1e1e;border:1px solid #444;border-radius:4px;padding:4px;box-shadow:0 4px 12px rgba(0,0,0,0.5);position:fixed;z-index:10000;");
        const fieldTypes = [
            { key: "prompt", label: "Prompts" },
            { key: "resolution", label: "Resolution override" },
            { key: "variants", label: "Variants" },
            { key: "lora", label: "LoRA" },
            { key: "controlnets", label: "ControlNets" },
            { key: "flake_link", label: "Flake link" },
        ];
        for (const ft of fieldTypes) {
            const item = document.createElement("button");
            item.textContent = ft.label;
            css(item, "text-align:left;padding:4px 8px;background:#2a2a2a;color:#ddd;border:1px solid #444;border-radius:3px;cursor:pointer;font-size:12px;");
            item.addEventListener("click", async () => {
                fieldMenu.style.display = "none";
                if (activeFields.includes(ft.key)) {
                    scrollToFieldKey(ft.key);
                    return;
                }
                activeFields.push(ft.key);
                if (ft.key === "lora") fieldState.loras = [{ name: "", url: "", path: "", strength: 1.0, _editing: true }];
                if (ft.key === "prompt") fieldState.prompt = {};
                if (ft.key === "resolution") fieldState.resolution = [1024, 1024];
                if (ft.key === "controlnets") fieldState.controlnets._ = [{ type: "", image: "", strength: 1.0 }];
                if (ft.key === "variants") fieldState.variants = { Default: { Default: {} } };
                if (ft.key === "flake_link") fieldState.flake_links = [];
                renderFields();
                scrollToFieldKey(ft.key);
                // Preserve the old quick-add conveniences now that the standalone
                // buttons are gone (#330): auto-open the CN file picker (#319) and
                // the Load-existing-flake popup (#320).
                if (ft.key === "controlnets") {
                    const imgBox = optionalBox.querySelector('[data-field-key="controlnets"] [data-cn-main-img]');
                    if (imgBox) imgBox.click();
                } else if (ft.key === "flake_link") {
                    const target = await pickFlakeTarget();
                    if (target) {
                        fieldState.flake_links.push({ target, variant: {}, lora_strengths: [] });
                        renderFields();
                        scrollToFieldKey("flake_link");
                    }
                }
            });
            fieldMenu.appendChild(item);
        }
        document.body.appendChild(fieldMenu);

        addFieldBtn.addEventListener("mousedown", (e) => e.stopPropagation());
        addFieldBtn.addEventListener("dblclick", (e) => e.stopPropagation());
        addFieldBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            e.preventDefault();
            const showing = fieldMenu.style.display === "flex";
            if (showing) {
                fieldMenu.style.display = "none";
            } else {
                const rect = addFieldBtn.getBoundingClientRect();
                fieldMenu.style.left = `${rect.left}px`;
                fieldMenu.style.top = `${rect.bottom + 4}px`;
                fieldMenu.style.display = "flex";
            }
        });
        // Hide menu on click outside
        function onDocClick(e) {
            if (e.target !== addFieldBtn && !fieldMenu.contains(e.target)) {
                fieldMenu.style.display = "none";
            }
        }
        document.addEventListener("click", onDocClick);
        handlers.onClose = ((prev) => (v) => {
            document.removeEventListener("click", onDocClick);
            if (fieldMenu.parentElement) fieldMenu.remove();
            prev?.(v);
        })(handlers.onClose);

        addFieldWrap.appendChild(btnRow);
        content.appendChild(addFieldWrap);

        // ---- Footer ----
        if (mode === "edit") {
            const deleteBtn = makeButton("Delete");
            css(deleteBtn, deleteBtn.style.cssText + "background:#5a2a2a;border-color:#7a3a3a;color:#fdd;margin-right:auto;");
            deleteBtn.addEventListener("click", async () => {
                if (!window.confirm(`Delete '${name}'? This cannot be undone.`)) return;
                try {
                    await deleteFlakeApi(name);
                    close({ deleted: true, name });
                } catch (err) {
                    window.alert(`Delete failed: ${err.message || err}`);
                }
            });
            footer.appendChild(deleteBtn);
        }

        const cancelBtn = makeButton("Cancel");
        cancelBtn.addEventListener("click", async () => {
            if (dirty && !window.confirm("Are you sure you want to cancel? Unsaved changes will be lost.")) return;
            close(undefined);
        });
        footer.appendChild(cancelBtn);

        const saveBtn = makeButton("Save", true);
        if (!rootsLoaded) saveBtn.disabled = true;
        saveBtn.addEventListener("click", async () => {
            const ordered = {};
            if (displayNameInput && displayNameInput.value) ordered.name = displayNameInput.value.trim();
            if (selectedType) ordered.flake_type = selectedType;
            if (serieInput && serieInput.value.trim()) ordered.serie = serieInput.value.trim();
            if (outputStemInput && outputStemInput.value.trim()) ordered.output_stem = outputStemInput.value.trim();

            // Save fields in the user-selected order so YAML key order is preserved
            for (const ft of activeFields) {
                if (ft === "lora" && fieldState.loras && fieldState.loras.length > 0) {
                    ordered.loras = fieldState.loras.map(l => ({
                        name: l.name || "",
                        url: l.url || "",
                        path: l.path || "",
                        strength: l.strength ?? 1.0,
                        ...(l.tag_name ? { tag_name: true } : {}),
                    }));
                }
                if (ft === "prompt" && fieldState.prompt) {
                    ordered.prompt = {};
                    if (fieldState.prompt.positive != null) ordered.prompt.positive = fieldState.prompt.positive;
                    if (fieldState.prompt.negative != null) ordered.prompt.negative = fieldState.prompt.negative;
                }
                if (ft === "resolution") {
                    // Prefer reading directly from the DOM inputs so we capture
                    // values typed but not yet committed via change/blur.
                    const inputs = fieldState._resolutionInputs;
                    let rw = inputs ? parseInt(inputs.w.value) : NaN;
                    let rh = inputs ? parseInt(inputs.h.value) : NaN;
                    if (!Number.isFinite(rw) && fieldState.resolution) rw = parseInt(fieldState.resolution[0]);
                    if (!Number.isFinite(rh) && fieldState.resolution) rh = parseInt(fieldState.resolution[1]);
                    if (Number.isFinite(rw) && Number.isFinite(rh)) ordered.resolution = [rw, rh];
                }
                if (ft === "controlnets") {
                    const cnArr = fieldState.controlnets._ || [];
                    if (cnArr.length > 0) {
                        ordered.controlnets = cnArr.map(cn => {
                            const { model, model_name, resolution_from_image, ...rest } = cn;
                            if (resolution_from_image) rest.resolution_from_image = true;
                            return rest;
                        });
                    }
                }
                if (ft === "variants" && Object.keys(fieldState.variants).length > 0) {
                    // Prune incomplete per-choice LoRAs / ControlNets / Flake Links
                    // (#299): drop rows missing their key field and remove now-empty
                    // arrays so the yaml stays clean.
                    for (const group of Object.values(fieldState.variants)) {
                        for (const choice of Object.values(group || {})) {
                            if (!choice) continue;
                            if (Array.isArray(choice.loras)) {
                                choice.loras = choice.loras.filter(l => l && (l.path || l.name));
                                if (choice.loras.length === 0) delete choice.loras;
                            }
                            if (Array.isArray(choice.controlnets)) {
                                choice.controlnets = choice.controlnets.filter(cn => cn && (cn.image || cn.type));
                                if (choice.controlnets.length === 0) delete choice.controlnets;
                            }
                            if (Array.isArray(choice.flake_links)) {
                                choice.flake_links = choice.flake_links
                                    .filter(l => l && l.target)
                                    .map(l => {
                                        const out = { target: l.target };
                                        const strengths = (l.lora_strengths || []).slice();
                                        while (strengths.length && (strengths[strengths.length - 1] == null)) strengths.pop();
                                        if (strengths.length) out.lora_strengths = strengths;
                                        if (l.variant && Object.keys(l.variant).length) out.variant = l.variant;
                                        return out;
                                    });
                                if (choice.flake_links.length === 0) delete choice.flake_links;
                            }
                        }
                    }
                    ordered.variants = fieldState.variants;
                }
                if (ft === "flake_link" && Array.isArray(fieldState.flake_links) && fieldState.flake_links.length > 0) {
                    const outLinks = [];
                    for (const link of fieldState.flake_links) {
                        if (!link || !link.target) continue;
                        const out = { target: link.target };
                        const variant = link.variant ? Object.fromEntries(Object.entries(link.variant).filter(([, v]) => v)) : {};
                        if (Object.keys(variant).length > 0) out.variant = variant;
                        // Drop trailing nulls to keep the yaml clean.
                        let strengths = (link.lora_strengths || []).slice();
                        while (strengths.length && (strengths[strengths.length - 1] === null || strengths[strengths.length - 1] === undefined)) {
                            strengths.pop();
                        }
                        if (strengths.length > 0) out.lora_strengths = strengths;
                        outLinks.push(out);
                    }
                    if (outLinks.length > 0) ordered.flake_links = outLinks;
                }
            }
            if (coverSourcePath && !coverFile) {
                ordered.cover_image = coverSourcePath;
            }

            try {
                if (mode === "default") {
                    await close({ defaultUpdated: true, data: ordered });
                    return;
                }
                const outputPath = (pathInput?.value || "").trim();
                if (!outputPath) { window.alert("Path is required"); return; }
                const fullOutputPath = getOutputPrefix() + outputPath;
                const baseRootIndex = baseRootSelectRef ? parseInt(baseRootSelectRef.value, 10) : 0;
                const oldName = mode !== "create" ? name : null;
                const savedName = await saveFlakeApi(
                    fullOutputPath, ordered,
                    currentFamily || undefined,
                    Number.isFinite(baseRootIndex) ? baseRootIndex : 0,
                    fullOutputPath,
                    oldName,
                );
                if (mode === "create") {
                    await close({ created: true, name: savedName, data: ordered });
                } else {
                    await close({ saved: true, name: savedName, data: ordered, oldName: name !== savedName ? name : undefined });
                }
            } catch (err) {
                window.alert(`Save failed: ${err.message || err}`);
            }
        });
        footer.appendChild(saveBtn);

        setTimeout(() => { (pathInput || displayNameInput)?.focus(); }, 0);
    });
}
