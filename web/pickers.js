import { openOverlay } from "./modal.js";
import { css, makeButton, makeComfyInput } from "./utils.js";
import { getCoverUrl, fetchBrowse } from "./api.js";

export async function openFileLoadPicker({ flakes, directories, family = "" }) {
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
        css(content.parentElement, content.parentElement.style.cssText + "min-width:420px;max-width:640px;");

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
        css(grid, "display:grid;grid-template-columns:repeat(auto-fill, minmax(80px, 1fr));gap:4px;max-height:360px;overflow:auto;");
        content.appendChild(grid);

        let currentFolder = "";
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
            return [...subs].sort();
        }

        function getFlakesInFolder(folder) {
            const prefix = folder ? normPath(folder) + "/" : "";
            return allFlakes.filter(f => {
                const n = normPath(f);
                if (!prefix) return !n.includes("/");
                if (!n.startsWith(prefix)) return false;
                return !n.slice(prefix.length).includes("/");
            }).sort();
        }

        function renderBreadcrumb() {
            if (!currentFolder) {
                pathBar.textContent = "root /";
                return;
            }
            pathBar.textContent = "root / " + normPath(currentFolder).split("/").join(" / ");
        }

        function renderGrid(filter = "") {
            grid.replaceChildren();
            selectedName = null;
            selectedEl = null;
            const term = filter.toLowerCase().trim();
            renderBreadcrumb();

            if (term) {
                // Search mode: flat grid of all matching flakes
                const filtered = allFlakes.filter(n => n.toLowerCase().includes(term));
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
                css(upItem, "height:80px;background:#252525;border:1px solid #444;border-radius:4px;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;user-select:none;box-sizing:border-box;");
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
                css(folderItem, "height:80px;background:#252525;border:1px solid #444;border-radius:4px;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;user-select:none;box-sizing:border-box;");
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

            if (subfolders.length === 0 && folderFlakes.length === 0 && !currentFolder) {
                const empty = document.createElement("div");
                empty.textContent = "No flakes found.";
                css(empty, "opacity:0.5;font-style:italic;padding:12px;text-align:center;grid-column:1 / -1;");
                grid.appendChild(empty);
            }
        }

        function makeFlakeThumb(name) {
            const thumb = document.createElement("div");
            css(thumb, `position:relative;height:80px;background:#2a2a2a;border:1px solid #444;border-radius:4px;cursor:pointer;font-size:10px;color:#ddd;user-select:none;box-sizing:border-box;overflow:hidden;background-image:url(${getCoverUrl(name)});background-size:cover;background-position:center;`);

            const overlay = document.createElement("div");
            css(overlay, "position:absolute;inset:0;background:rgba(0,0,0,0.45);pointer-events:none;z-index:0;");
            thumb.appendChild(overlay);

            const shortName = name.split(/[\/\\ _\-]+/).pop() || name;
            const nameEl = document.createElement("div");
            nameEl.title = name;
            css(nameEl, "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:500;text-align:center;line-height:1.2;text-shadow:0 1px 3px rgba(0,0,0,0.8);padding:0 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;z-index:1;");
            nameEl.textContent = shortName;
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
        try {
            const query = family ? `?family=${encodeURIComponent(family)}` : "";
            const r = await fetch(`/flakes/presets${query}`, { cache: "no-store" });
            const d = await r.json();
            presets = d.presets || [];
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

        // Search bar
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

        function renderGrid(filter = "") {
            grid.replaceChildren();
            selectedEl = null;
            const term = String(filter || "").toLowerCase().trim();
            const filtered = term
                ? presets.filter(n => String(n || "").toLowerCase().includes(term))
                : presets;

            if (filtered.length === 0) {
                const empty = document.createElement("div");
                empty.textContent = term ? "No presets found." : "No presets available.";
                css(empty, "opacity:0.5;font-style:italic;padding:12px;text-align:center;grid-column:1 / -1;");
                grid.appendChild(empty);
                return;
            }

            for (const name of filtered) {
                const thumb = document.createElement("div");
                css(thumb, `position:relative;height:100px;background:#2a2a2a;border:2px solid ${name === selectedName ? "#2a6acf" : "#444"};border-radius:6px;cursor:pointer;font-size:11px;color:#ddd;user-select:none;box-sizing:border-box;overflow:hidden;background-image:url(/flakes/preset_cover?name=${encodeURIComponent(name)});background-size:cover;background-position:center;transition:border-color 0.15s ease;`);

                const overlay = document.createElement("div");
                css(overlay, "position:absolute;inset:0;background:rgba(0,0,0,0.4);pointer-events:none;z-index:0;transition:background 0.15s ease;");
                thumb.appendChild(overlay);

                const shortName = name.split(/[\/\\ _\-]+/).pop() || name;
                const nameEl = document.createElement("div");
                nameEl.title = name;
                css(nameEl, "position:absolute;bottom:0;left:0;right:0;padding:6px 4px;text-align:center;font-size:11px;font-weight:500;line-height:1.2;text-shadow:0 1px 3px rgba(0,0,0,0.9);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;z-index:1;");
                nameEl.textContent = shortName;
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

                grid.appendChild(thumb);
            }
        }

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

export function openFileBrowser({ type, defaultPath = "" }) {
    return new Promise((resolve) => {
        const { content, footer, close, handlers } = openOverlay();
        handlers.onClose = (v) => resolve(v ?? null);
        css(content.parentElement, content.parentElement.style.cssText + "min-width:420px;max-width:560px;");

        const title = document.createElement("h3");
        css(title, "margin:0 0 8px;font-size:16px;color:#fff;font-weight:500;");
        title.textContent = type === "checkpoints" ? "Select Checkpoint" : type === "loras" ? "Select LoRA" : "Select Flake";
        content.appendChild(title);

        const pathBar = document.createElement("div");
        css(pathBar, "font-size:11px;color:#888;margin-bottom:8px;word-break:break-all;");
        content.appendChild(pathBar);

        const searchRow = document.createElement("div");
        css(searchRow, "margin-bottom:8px;");
        const searchInput = makeComfyInput("", "Search...");
        searchRow.appendChild(searchInput);
        content.appendChild(searchRow);

        const listBox = document.createElement("div");
        css(listBox, "display:flex;flex-direction:column;gap:2px;max-height:320px;overflow:auto;");
        content.appendChild(listBox);

        let currentPath = defaultPath;
        let selectedFile = null;
        let dirEntries = [];

        function renderEntries(filter = "") {
            listBox.replaceChildren();
            const term = String(filter || "").toLowerCase().trim();
            const entries = term
                ? dirEntries.filter(e => String(e.name || "").toLowerCase().includes(term))
                : dirEntries;

            if (currentPath) {
                const upBtn = document.createElement("button");
                upBtn.textContent = "\u2191 ..";
                css(upBtn, "text-align:left;padding:6px 10px;background:#252525;color:#ddd;border:1px solid #444;border-radius:3px;cursor:pointer;font-size:12px;");
                upBtn.addEventListener("mouseenter", () => { upBtn.style.background = "#333"; });
                upBtn.addEventListener("mouseleave", () => { upBtn.style.background = "#252525"; });
                upBtn.addEventListener("click", () => {
                    const parts = currentPath.replace(/\\/g, "/").split("/").filter(Boolean);
                    parts.pop();
                    loadDir(parts.join("/"));
                });
                listBox.appendChild(upBtn);
            }

            for (const entry of entries) {
                const row = document.createElement("button");
                row.textContent = entry.type === "dir" ? "\uD83D\uDCC1 " + entry.name : entry.name;
                css(row, "text-align:left;padding:6px 10px;background:#2a2a2a;color:#ddd;border:1px solid #444;border-radius:3px;cursor:pointer;font-size:12px;");
                row.addEventListener("mouseenter", () => { row.style.background = "#333"; });
                row.addEventListener("mouseleave", () => { row.style.background = "#2a2a2a"; });
                if (entry.type === "dir") {
                    row.addEventListener("click", () => {
                        const next = currentPath ? currentPath.replace(/\\/g, "/") + "/" + entry.name : entry.name;
                        loadDir(next);
                    });
                } else {
                    row.addEventListener("click", () => {
                        selectedFile = currentPath ? currentPath.replace(/\\/g, "/") + "/" + entry.name : entry.name;
                        for (const b of listBox.querySelectorAll("button")) {
                            b.style.borderColor = "#444";
                        }
                        row.style.borderColor = "#2a6acf";
                    });
                    row.addEventListener("dblclick", () => {
                        selectedFile = currentPath ? currentPath.replace(/\\/g, "/") + "/" + entry.name : entry.name;
                        close({ file: selectedFile });
                    });
                }
                listBox.appendChild(row);
            }

            if (entries.length === 0) {
                const empty = document.createElement("div");
                empty.textContent = term ? "No matches" : "Empty folder";
                css(empty, "opacity:0.5;font-style:italic;padding:12px;text-align:center;font-size:12px;");
                listBox.appendChild(empty);
            }
        }

        async function loadDir(path) {
            pathBar.textContent = path || "/";
            selectedFile = null;
            searchInput.value = "";
            try {
                const data = await fetchBrowse(type, path);
                currentPath = data.path || "";
                pathBar.textContent = currentPath || "/";
                dirEntries = data.entries || [];
                renderEntries();
            } catch (err) {
                dirEntries = [];
                listBox.replaceChildren();
                const errEl = document.createElement("div");
                css(errEl, "color:#f88;padding:12px;text-align:center;font-size:12px;");
                errEl.textContent = err.message || "failed to load";
                listBox.appendChild(errEl);
            }
        }

        searchInput.addEventListener("input", () => renderEntries(searchInput.value));
        searchInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                const term = searchInput.value.toLowerCase().trim();
                const matches = dirEntries.filter(e => e.type === "file" && e.name.toLowerCase().includes(term));
                if (matches.length > 0) {
                    selectedFile = currentPath ? currentPath.replace(/\\/g, "/") + "/" + matches[0].name : matches[0].name;
                    close({ file: selectedFile });
                }
            }
        });
        loadDir(defaultPath);
        searchInput.focus();

        const cancelBtn = makeButton("Cancel");
        cancelBtn.addEventListener("click", () => close(undefined));
        footer.appendChild(cancelBtn);

        const selectBtn = makeButton("Select", true);
        selectBtn.addEventListener("click", () => {
            if (!selectedFile) {
                window.alert("Select a file first.");
                return;
            }
            close({ file: selectedFile });
        });
        footer.appendChild(selectBtn);
    });
}
