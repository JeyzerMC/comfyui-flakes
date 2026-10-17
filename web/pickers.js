import { openOverlay } from "./modal.js";
import { css, makeButton, makeComfyInput, familyFolder, renderFlakeLabel } from "./utils.js";
import { getCoverUrl, fetchBrowse, fetchLoras, fetchCheckpoints } from "./api.js";

const BROWSE_TYPE_LABELS = {
    checkpoints: "models/checkpoints",
    loras: "models/loras",
    vae: "models/vae",
    text_encoders: "models/text_encoders",
    diffusion_models: "models/diffusion_models",
    flakes: "models/flakes",
    inputs: "input",
    output: "output",
    flake_images: "flakes",
    models: "models",
};

export async function openFileLoadPicker({ flakes, directories, family = "", displayNames = {}, tagNames = {} }) {
    // Exclude model_presets from everything
    const allFlakes = flakes.filter(n => {
        const norm = n.replace(/\\/g, "/");
        return !norm.startsWith("model_presets/") && norm !== "model_presets";
    });
    const allDirs = directories.filter(d => {
        const norm = d.replace(/\\/g, "/");
        return !norm.startsWith("model_presets/") && norm !== "model_presets";
    });

    return new Promise((resolve) => {
        const { content, footer, close, handlers } = openOverlay();
        handlers.onClose = (v) => resolve(v ?? null);
        css(content.parentElement, content.parentElement.style.cssText + "width:min(1100px,94vw);max-width:94vw;");

        const title = document.createElement("h3");
        css(title, "margin:0 0 8px;font-size:16px;color:#fff;font-weight:500;");
        title.textContent = "Load existing flake";
        content.appendChild(title);

        // Breadcrumb / path bar
        const pathBar = document.createElement("div");
        css(pathBar, "font-size:11px;color:#888;margin-bottom:6px;word-break:break-all;cursor:pointer;");
        content.appendChild(pathBar);

        // Search bar
        const searchRow = document.createElement("div");
        css(searchRow, "margin-bottom:8px;");
        const searchInput = makeComfyInput("", "Search flakes...");
        searchRow.appendChild(searchInput);
        content.appendChild(searchRow);

        const grid = document.createElement("div");
        css(grid, "display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px;max-height:65vh;overflow:auto;align-content:start;");
        content.appendChild(grid);

        const initialFolder = (() => {
            const folder = familyFolder(family);
            return folder ? `img/${folder}` : "";
        })();
        let currentFolder = initialFolder;
        let selectedName = null;
        let selectedEl = null;

        function normPath(p) {
            return p.replace(/\\/g, "/");
        }

        function getSubfolders(folder) {
            const prefix = folder ? normPath(folder) + "/" : "";
            const subs = new Set();
            for (const d of allDirs) {
                const n = normPath(d);
                if (!n.startsWith(prefix)) continue;
                const rest = n.slice(prefix.length);
                if (!rest || rest.includes("/")) continue;
                subs.add(rest);
            }
            return [...subs].sort(naturalOrder);
        }

        function getFlakesInFolder(folder) {
            const prefix = folder ? normPath(folder) + "/" : "";
            return allFlakes.filter(f => {
                const n = normPath(f);
                if (!prefix) return !n.includes("/");
                if (!n.startsWith(prefix)) return false;
                return !n.slice(prefix.length).includes("/");
            }).sort((x, y) => naturalOrder(x.split("/").pop(), y.split("/").pop()));
        }

        function renderBreadcrumb() {
            const base = "models/flakes/";
            pathBar.textContent = base + (currentFolder ? normPath(currentFolder) + "/" : "");
        }

        function renderGrid(filter = "") {
            grid.replaceChildren();
            selectedName = null;
            selectedEl = null;
            const term = filter.toLowerCase().trim();
            renderBreadcrumb();

            if (term) {
                // Search mode: scoped to currentFolder so the breadcrumb stays meaningful
                const prefix = currentFolder ? normPath(currentFolder) + "/" : "";
                const scoped = prefix
                    ? allFlakes.filter(n => normPath(n).startsWith(prefix))
                    : allFlakes;
                const filtered = scoped.filter(n => normPath(n).slice(prefix.length).toLowerCase().includes(term));
                if (filtered.length === 0) {
                    const empty = document.createElement("div");
                    empty.textContent = "No flakes found.";
                    css(empty, "opacity:0.5;font-style:italic;padding:12px;text-align:center;grid-column:1 / -1;");
                    grid.appendChild(empty);
                    return;
                }
                for (const name of filtered) {
                    grid.appendChild(makeFlakeThumb(name));
                }
                return;
            }

            // Folder mode: subfolders + flakes in current folder
            const subfolders = getSubfolders(currentFolder);
            const folderFlakes = getFlakesInFolder(currentFolder);

            if (currentFolder) {
                // Up folder item
                const upItem = document.createElement("div");
                css(upItem, "aspect-ratio:1/1;background:#252525;border:1px solid #444;border-radius:4px;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;user-select:none;box-sizing:border-box;");
                const upIcon = document.createElement("div");
                upIcon.textContent = "\u2191";
                css(upIcon, "font-size:24px;color:#888;");
                const upLabel = document.createElement("div");
                upLabel.textContent = "..";
                css(upLabel, "font-size:10px;color:#aaa;");
                upItem.appendChild(upIcon);
                upItem.appendChild(upLabel);
                upItem.addEventListener("click", () => {
                    const parts = normPath(currentFolder).split("/").filter(Boolean);
                    parts.pop();
                    currentFolder = parts.join("/");
                    renderGrid();
                });
                upItem.addEventListener("dblclick", (e) => e.stopPropagation());
                grid.appendChild(upItem);
            }

            for (const sub of subfolders) {
                const folderItem = document.createElement("div");
                css(folderItem, "aspect-ratio:1/1;background:#252525;border:1px solid #444;border-radius:4px;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;user-select:none;box-sizing:border-box;");
                const fIcon = document.createElement("div");
                fIcon.textContent = "\uD83D\uDCC1";
                css(fIcon, "font-size:32px;");
                const fLabel = document.createElement("div");
                fLabel.textContent = sub;
                css(fLabel, "font-size:10px;color:#ddd;text-align:center;padding:0 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;");
                folderItem.appendChild(fIcon);
                folderItem.appendChild(fLabel);
                folderItem.addEventListener("click", () => {
                    currentFolder = currentFolder ? normPath(currentFolder) + "/" + sub : sub;
                    renderGrid();
                });
                folderItem.addEventListener("dblclick", () => {
                    currentFolder = currentFolder ? normPath(currentFolder) + "/" + sub : sub;
                    renderGrid();
                });
                grid.appendChild(folderItem);
            }

            for (const name of folderFlakes) {
                grid.appendChild(makeFlakeThumb(name));
            }

            if (subfolders.length === 0 && folderFlakes.length === 0) {
                const empty = document.createElement("div");
                empty.textContent = "No flakes found.";
                css(empty, "opacity:0.5;font-style:italic;padding:12px;text-align:center;grid-column:1 / -1;");
                grid.appendChild(empty);
            }
        }

        function makeFlakeThumb(name) {
            const thumb = document.createElement("div");
            css(thumb, `position:relative;aspect-ratio:1/1;background:#2a2a2a;border:1px solid #444;border-radius:4px;cursor:pointer;font-size:10px;color:#ddd;user-select:none;box-sizing:border-box;overflow:hidden;background-image:url(${getCoverUrl(name)});background-size:cover;background-position:center;`);

            const overlay = document.createElement("div");
            css(overlay, "position:absolute;inset:0;background:rgba(0,0,0,0.45);pointer-events:none;z-index:0;");
            thumb.appendChild(overlay);

            const displayName = displayNames[name] || "";
            const label = displayName || (name.includes("/") ? name.split("/").pop() : name);
            const nameEl = document.createElement("div");
            nameEl.title = name;
            css(nameEl, "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:500;text-align:center;line-height:1.2;text-shadow:0 1px 3px rgba(0,0,0,0.8);padding:0 4px;overflow:hidden;z-index:1;word-break:break-word;hyphens:auto;");
            // Stacked label with a dimmer tag line, matching the grid (#297).
            renderFlakeLabel(nameEl, { name: label, tags: tagNames[name] || [] });
            thumb.appendChild(nameEl);

            thumb.addEventListener("click", () => {
                if (selectedEl) {
                    selectedEl.style.borderColor = "#444";
                }
                selectedName = name;
                selectedEl = thumb;
                thumb.style.borderColor = "#2a6acf";
            });
            thumb.addEventListener("dblclick", () => {
                close({ name });
            });

            return thumb;
        }

        pathBar.addEventListener("click", () => {
            currentFolder = "";
            searchInput.value = "";
            renderGrid();
        });

        renderGrid();
        searchInput.addEventListener("input", () => renderGrid(searchInput.value));

        const cancelBtn = makeButton("Cancel");
        cancelBtn.addEventListener("click", () => close(undefined));
        footer.appendChild(cancelBtn);

        const selectBtn = makeButton("Select", true);
        selectBtn.addEventListener("click", () => {
            if (!selectedName) {
                window.alert("Select a flake first.");
                return;
            }
            close({ name: selectedName });
        });
        footer.appendChild(selectBtn);
    });
}

export async function openPresetPicker({ selected = "", family = "" } = {}) {
    return new Promise(async (resolve) => {
        let presets = [];
        let displayNames = {};
        try {
            const query = family ? `?family=${encodeURIComponent(family)}` : "";
            const r = await fetch(`/flakes/presets${query}`, { cache: "no-store" });
            const d = await r.json();
            presets = d.presets || [];
            displayNames = d.display_names || {};
        } catch (err) {
            console.error("[flakes] failed to load presets for picker:", err);
        }

        const { content, footer, close, handlers } = openOverlay();
        handlers.onClose = (v) => resolve(v ?? null);
        css(content.parentElement, content.parentElement.style.cssText + "min-width:420px;max-width:640px;");

        const title = document.createElement("h3");
        css(title, "margin:0 0 8px;font-size:16px;color:#fff;font-weight:500;");
        title.textContent = "Select a Preset";
        content.appendChild(title);

        const pathBar = document.createElement("div");
        css(pathBar, "font-size:11px;color:#888;margin-bottom:6px;word-break:break-all;cursor:pointer;");
        content.appendChild(pathBar);

        const searchRow = document.createElement("div");
        css(searchRow, "margin-bottom:8px;");
        const searchInput = makeComfyInput("", "Search presets...");
        searchRow.appendChild(searchInput);
        content.appendChild(searchRow);

        const grid = document.createElement("div");
        css(grid, "display:grid;grid-template-columns:repeat(auto-fill, minmax(100px, 1fr));gap:8px;max-height:400px;overflow:auto;padding:4px;");
        content.appendChild(grid);

        let selectedName = selected || null;
        let selectedEl = null;
        const folder = familyFolder(family) || "";
        let currentFolder = folder ? `img/${folder}` : "";

        function normPath(p) {
            return p.replace(/\\/g, "/");
        }

        function getSubfolders(folder) {
            const prefix = folder ? normPath(folder) + "/" : "";
            const subs = new Set();
            for (const p of presets) {
                const n = normPath(p);
                if (!n.startsWith(prefix)) continue;
                const rest = n.slice(prefix.length);
                if (!rest) continue;
                const slashIdx = rest.indexOf("/");
                if (slashIdx === -1) continue;
                subs.add(rest.slice(0, slashIdx));
            }
            return [...subs].sort();
        }

        function getPresetsInFolder(folder) {
            const prefix = folder ? normPath(folder) + "/" : "";
            return presets.filter(p => {
                const n = normPath(p);
                if (!prefix) return !n.includes("/");
                if (!n.startsWith(prefix)) return false;
                return !n.slice(prefix.length).includes("/");
            }).sort();
        }

        function renderBreadcrumb() {
            const base = "model_presets/";
            pathBar.textContent = base + (currentFolder ? normPath(currentFolder) + "/" : "");
        }

        function makePresetThumb(name) {
            const thumb = document.createElement("div");
            css(thumb, `position:relative;height:100px;background:#2a2a2a;border:2px solid ${name === selectedName ? "#2a6acf" : "#444"};border-radius:6px;cursor:pointer;font-size:11px;color:#ddd;user-select:none;box-sizing:border-box;overflow:hidden;background-image:url(/flakes/preset_cover?name=${encodeURIComponent(name)});background-size:cover;background-position:center;transition:border-color 0.15s ease;`);

            const overlay = document.createElement("div");
            css(overlay, "position:absolute;inset:0;background:rgba(0,0,0,0.4);pointer-events:none;z-index:0;transition:background 0.15s ease;");
            thumb.appendChild(overlay);

            const displayLabel = displayNames[name] || name.replace(/\\/g, "/").split("/").pop() || name;
            const nameEl = document.createElement("div");
            nameEl.title = name;
            css(nameEl, "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:500;text-align:center;line-height:1.2;text-shadow:0 1px 3px rgba(0,0,0,0.9);padding:6px 4px;overflow:hidden;z-index:1;word-break:break-word;hyphens:auto;");
            nameEl.textContent = displayLabel;
            thumb.appendChild(nameEl);

            thumb.addEventListener("mouseenter", () => {
                thumb.style.borderColor = "#555";
                overlay.style.background = "rgba(0,0,0,0.25)";
            });
            thumb.addEventListener("mouseleave", () => {
                thumb.style.borderColor = name === selectedName ? "#2a6acf" : "#444";
                overlay.style.background = "rgba(0,0,0,0.4)";
            });

            thumb.addEventListener("click", () => {
                if (selectedEl) {
                    selectedEl.style.borderColor = "#444";
                }
                selectedName = name;
                selectedEl = thumb;
                thumb.style.borderColor = "#2a6acf";
            });
            thumb.addEventListener("dblclick", () => {
                close({ name });
            });

            if (name === selectedName) {
                selectedEl = thumb;
            }

            return thumb;
        }

        function renderGrid(filter = "") {
            grid.replaceChildren();
            selectedEl = null;
            const term = String(filter || "").toLowerCase().trim();
            renderBreadcrumb();

            if (term) {
                const prefix = currentFolder ? normPath(currentFolder) + "/" : "";
                const scoped = prefix
                    ? presets.filter(n => normPath(n).startsWith(prefix))
                    : presets;
                const filtered = scoped.filter(n => normPath(n).slice(prefix.length).toLowerCase().includes(term));
                if (filtered.length === 0) {
                    const empty = document.createElement("div");
                    empty.textContent = "No presets found.";
                    css(empty, "opacity:0.5;font-style:italic;padding:12px;text-align:center;grid-column:1 / -1;");
                    grid.appendChild(empty);
                    return;
                }
                for (const name of filtered) {
                    grid.appendChild(makePresetThumb(name));
                }
                return;
            }

            const subfolders = getSubfolders(currentFolder);
            const folderPresets = getPresetsInFolder(currentFolder);

            if (currentFolder) {
                const upItem = document.createElement("div");
                css(upItem, "height:100px;background:#252525;border:1px solid #444;border-radius:6px;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;user-select:none;box-sizing:border-box;");
                const upIcon = document.createElement("div");
                upIcon.textContent = "\u2191";
                css(upIcon, "font-size:24px;color:#888;");
                const upLabel = document.createElement("div");
                upLabel.textContent = "..";
                css(upLabel, "font-size:10px;color:#aaa;");
                upItem.appendChild(upIcon);
                upItem.appendChild(upLabel);
                upItem.addEventListener("click", () => {
                    const parts = normPath(currentFolder).split("/").filter(Boolean);
                    parts.pop();
                    currentFolder = parts.join("/");
                    searchInput.value = "";
                    renderGrid();
                });
                upItem.addEventListener("dblclick", (e) => e.stopPropagation());
                grid.appendChild(upItem);
            }

            for (const sub of subfolders) {
                const folderItem = document.createElement("div");
                css(folderItem, "height:100px;background:#252525;border:1px solid #444;border-radius:6px;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;user-select:none;box-sizing:border-box;");
                const fIcon = document.createElement("div");
                fIcon.textContent = "\uD83D\uDCC1";
                css(fIcon, "font-size:32px;");
                const fLabel = document.createElement("div");
                fLabel.textContent = sub;
                css(fLabel, "font-size:10px;color:#ddd;text-align:center;padding:0 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;");
                folderItem.appendChild(fIcon);
                folderItem.appendChild(fLabel);
                folderItem.addEventListener("click", () => {
                    currentFolder = currentFolder ? normPath(currentFolder) + "/" + sub : sub;
                    searchInput.value = "";
                    renderGrid();
                });
                folderItem.addEventListener("dblclick", () => {
                    currentFolder = currentFolder ? normPath(currentFolder) + "/" + sub : sub;
                    searchInput.value = "";
                    renderGrid();
                });
                grid.appendChild(folderItem);
            }

            for (const name of folderPresets) {
                grid.appendChild(makePresetThumb(name));
            }

            if (subfolders.length === 0 && folderPresets.length === 0) {
                const empty = document.createElement("div");
                empty.textContent = "No presets found.";
                css(empty, "opacity:0.5;font-style:italic;padding:12px;text-align:center;grid-column:1 / -1;");
                grid.appendChild(empty);
            }
        }

        pathBar.addEventListener("click", () => {
            currentFolder = "";
            searchInput.value = "";
            renderGrid();
        });

        renderGrid();
        searchInput.addEventListener("input", () => renderGrid(searchInput.value));
        searchInput.focus();

        const cancelBtn = makeButton("Cancel");
        cancelBtn.addEventListener("click", () => close(undefined));
        footer.appendChild(cancelBtn);

        const selectBtn = makeButton("Select", true);
        selectBtn.addEventListener("click", () => {
            if (!selectedName) {
                window.alert("Select a preset first.");
                return;
            }
            close({ name: selectedName });
        });
        footer.appendChild(selectBtn);
    });
}

const BROWSE_TITLES = {
    checkpoints: "Select Checkpoint", loras: "Select LoRA", flakes: "Select Flake",
    vae: "Select VAE", text_encoders: "Select Text Encoder", diffusion_models: "Select Diffusion Model",
};
// Image picks can switch between these ComfyUI folders.
export const IMAGE_ROOTS = ["inputs", "output", "flake_images", "models"];

const naturalOrder = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

// Grid picker in the style of Explorer's thumbnail view: folders first, natural
// case-insensitive order, 7 tiles per row. `roots` lists the browse types the
// user can switch between. Resolves to {file, path, type} — `file` relative to
// the root, `path` absolute (absent for LoRA/checkpoint search hits) — or null.
export function openFileBrowser({ type, defaultPath = "", roots = [type] }) {
    return new Promise((resolve) => {
        const { content, footer, close, handlers } = openOverlay();
        handlers.onClose = (v) => resolve(v ?? null);
        css(content.parentElement, content.parentElement.style.cssText + "width:min(1100px,94vw);max-width:94vw;");

        const title = document.createElement("h3");
        css(title, "margin:0 0 8px;font-size:16px;color:#fff;font-weight:500;");
        title.textContent = BROWSE_TITLES[type] || "Select Image";
        content.appendChild(title);

        let currentType = type;
        // Root tabs on the left; drive tabs (C:, D:, ...) on the right when the
        // root has folders on several drives — drives are never merged.
        let currentDrive = "";
        const tabsRow = document.createElement("div");
        css(tabsRow, "display:flex;gap:4px;margin-bottom:8px;");
        const tabs = document.createElement("div");
        css(tabs, "display:flex;gap:4px;");
        const driveTabs = document.createElement("div");
        css(driveTabs, "display:flex;gap:4px;margin-left:auto;");
        tabsRow.appendChild(tabs);
        tabsRow.appendChild(driveTabs);
        content.appendChild(tabsRow);
        if (roots.length < 2) tabs.style.display = "none";

        const pathBar = document.createElement("div");
        css(pathBar, "font-size:11px;color:#888;margin-bottom:8px;word-break:break-all;");
        content.appendChild(pathBar);

        const searchRow = document.createElement("div");
        css(searchRow, "margin-bottom:8px;");
        const searchInput = makeComfyInput("", "Search...");
        searchRow.appendChild(searchInput);
        content.appendChild(searchRow);

        const grid = document.createElement("div");
        css(grid, "display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px;max-height:65vh;overflow:auto;align-content:start;");
        content.appendChild(grid);

        let currentPath = defaultPath;
        let selected = null;
        let selectedTile = null;
        let dirEntries = [];
        let allFlatItems = []; // full flat list for search (loras/checkpoints only)

        const joinPath = (name) => currentPath ? currentPath.replace(/\\/g, "/") + "/" + name : name;

        function iconFace(icon) {
            const face = document.createElement("div");
            face.textContent = icon;
            css(face, "display:flex;align-items:center;justify-content:center;font-size:44px;");
            return face;
        }

        // Images show themselves; LoRAs and checkpoints show their sibling
        // preview image, falling back to a file icon.
        function fileFace(file, path) {
            let src = null;
            if (IMAGE_ROOTS.includes(currentType)) src = `/flakes/image?path=${encodeURIComponent(path)}`;
            else if (currentType === "loras") src = `/flakes/lora_sibling_image?path=${encodeURIComponent(file)}`;
            else if (currentType === "checkpoints") src = `/flakes/checkpoint_sibling_image?path=${encodeURIComponent(file)}`;
            if (!src) return iconFace("📄");
            const img = document.createElement("img");
            img.loading = "lazy";
            img.src = src;
            img.addEventListener("error", () => {
                const icon = iconFace("📄");
                css(icon, icon.style.cssText + "width:100%;aspect-ratio:1/1;background:#1a1a1a;border-radius:3px;pointer-events:none;");
                img.replaceWith(icon);
            });
            css(img, "object-fit:contain;");
            return img;
        }

        function makeTile(label, face, onClick, onDblClick) {
            const tile = document.createElement("div");
            tile.title = label;
            css(tile, "display:flex;flex-direction:column;gap:4px;padding:4px;background:#2a2a2a;color:#ddd;border:1px solid #444;border-radius:4px;cursor:pointer;min-width:0;user-select:none;");
            css(face, face.style.cssText + "width:100%;aspect-ratio:1/1;background:#1a1a1a;border-radius:3px;pointer-events:none;");
            const cap = document.createElement("span");
            cap.textContent = label;
            css(cap, "font-size:10px;color:#aaa;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none;");
            tile.appendChild(face);
            tile.appendChild(cap);
            tile.addEventListener("mouseenter", () => { tile.style.background = "#333"; });
            tile.addEventListener("mouseleave", () => { tile.style.background = "#2a2a2a"; });
            tile.addEventListener("click", () => onClick(tile));
            if (onDblClick) tile.addEventListener("dblclick", onDblClick);
            return tile;
        }

        function fileTile(label, file, path) {
            const pick = { file, path, type: currentType };
            return makeTile(label, fileFace(file, path), (tile) => {
                if (selectedTile) selectedTile.style.borderColor = "#444";
                selected = pick;
                selectedTile = tile;
                tile.style.borderColor = "#2a6acf";
            }, () => close(pick));
        }

        function showEmpty(text) {
            const empty = document.createElement("div");
            empty.textContent = text;
            css(empty, "opacity:0.5;font-style:italic;padding:12px;text-align:center;font-size:12px;grid-column:1 / -1;");
            grid.appendChild(empty);
        }

        function renderEntries(filter = "") {
            grid.replaceChildren();
            selected = null;
            selectedTile = null;
            const term = String(filter || "").toLowerCase().trim();

            // When searching, use the full flat list if available
            if (term && allFlatItems.length > 0) {
                const filtered = allFlatItems.filter(p => String(p).toLowerCase().includes(term)).sort(naturalOrder);
                for (const filePath of filtered) {
                    grid.appendChild(fileTile(filePath.replace(/\\/g, "/").split("/").pop(), filePath));
                }
                if (filtered.length === 0) showEmpty("No matches");
                return;
            }

            const entries = term
                ? dirEntries.filter(e => String(e.name || "").toLowerCase().includes(term))
                : dirEntries;

            if (currentPath) {
                grid.appendChild(makeTile("..", iconFace("⬆"), () => {
                    const parts = currentPath.replace(/\\/g, "/").split("/").filter(Boolean);
                    parts.pop();
                    loadDir(parts.join("/"));
                }));
            }
            for (const entry of entries) {
                if (entry.type === "dir") {
                    grid.appendChild(makeTile(entry.name, iconFace("📁"), () => loadDir(joinPath(entry.name))));
                } else {
                    grid.appendChild(fileTile(entry.name, joinPath(entry.name), entry.path));
                }
            }
            if (entries.length === 0) showEmpty(term ? "No matches" : "Empty folder");
        }

        function fmtPath(rel) {
            const r = (rel || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
            const baseLabel = (currentDrive && driveTabs.childElementCount ? `${currentDrive} ` : "") + (BROWSE_TYPE_LABELS[currentType] || currentType);
            return r ? `${baseLabel}/${r}/` : `${baseLabel}/`;
        }

        function renderDriveTabs(drives) {
            driveTabs.replaceChildren();
            if (drives.length < 2) return;
            for (const d of drives) {
                const tab = makeButton(d);
                tab.style.borderColor = d === currentDrive ? "#2a6acf" : "#444";
                tab.addEventListener("click", () => {
                    currentDrive = d;
                    loadDir(currentPath);
                });
                driveTabs.appendChild(tab);
            }
        }

        async function loadDir(path) {
            pathBar.textContent = fmtPath(path);
            searchInput.value = "";
            try {
                const data = await fetchBrowse(currentType, path, currentDrive);
                currentDrive = data.drive || "";
                renderDriveTabs(data.drives || []);
                currentPath = data.path || "";
                pathBar.textContent = fmtPath(currentPath);
                // Folders first, then natural case-insensitive name order (Explorer).
                dirEntries = (data.entries || []).sort((a, b) => (a.type === "dir" ? 0 : 1) - (b.type === "dir" ? 0 : 1)
                    || naturalOrder(a.name, b.name));
                renderEntries();
            } catch (err) {
                if (path) {
                    // Requested directory does not exist — fall back to root
                    return loadDir("");
                }
                dirEntries = [];
                grid.replaceChildren();
                showEmpty(err.message || "failed to load");
            }
        }

        function switchRoot(root, path = "") {
            currentType = root;
            for (const b of tabs.children) b.style.borderColor = b.dataset.root === root ? "#2a6acf" : "#444";
            allFlatItems = [];
            // Pre-fetch the full flat list so search works across all subdirectories
            if (root === "loras") fetchLoras().then(list => { allFlatItems = list || []; }).catch(() => {});
            else if (root === "checkpoints") fetchCheckpoints().then(list => { allFlatItems = list || []; }).catch(() => {});
            loadDir(path);
        }

        for (const root of roots) {
            const tab = makeButton(`${BROWSE_TYPE_LABELS[root] || root}/`);
            tab.dataset.root = root;
            tab.addEventListener("click", () => switchRoot(root));
            tabs.appendChild(tab);
        }

        searchInput.addEventListener("input", () => renderEntries(searchInput.value));
        searchInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                const term = searchInput.value.toLowerCase().trim();
                const match = dirEntries.find(e => e.type === "file" && e.name.toLowerCase().includes(term));
                if (match) close({ file: joinPath(match.name), path: match.path, type: currentType });
            }
        });
        switchRoot(type, defaultPath);
        searchInput.focus();

        const cancelBtn = makeButton("Cancel");
        cancelBtn.addEventListener("click", () => close(undefined));
        footer.appendChild(cancelBtn);

        const selectBtn = makeButton("Select", true);
        selectBtn.addEventListener("click", () => {
            if (!selected) {
                window.alert("Select a file first.");
                return;
            }
            close(selected);
        });
        footer.appendChild(selectBtn);
    });
}
