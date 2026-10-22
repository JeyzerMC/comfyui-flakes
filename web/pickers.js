import { openOverlay } from "./modal.js";
import { css, makeButton, makeComfyInput, makeComfyValueSlider, familyFolder, renderFlakeLabel, ANIM_DIR } from "./utils.js";
import { getCoverUrl, getVariantImageUrl, fetchBrowse, fetchLoras, fetchCheckpoints, fetchAnimFamily, pickedImageUrl, uploadInputImage } from "./api.js";

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
    lora_images: "models/loras",
};

const withoutPresets = (names) => names.filter(n => {
    const norm = n.replace(/\\/g, "/");
    return !norm.startsWith("model_presets/") && norm !== "model_presets";
});

// `kind` "anim" picks animate flakes: `family` is an animate family label and
// the picker opens in its video/<folder>.
export async function openFileLoadPicker({ flakes, directories, family = "", kind = "img", displayNames = {}, tagNames = {}, favorites = [], folderCovers = {} }) {
    const animFolder = kind === "anim" ? (await fetchAnimFamily(family).catch(() => null))?.folder : null;
    return openNamePicker({
        title: "Load existing flake", kind: "flakes", drivesKind: kind === "anim" ? "anim" : "flakes", noun: "flake", base: "models/flakes/",
        names: withoutPresets(flakes), directories: withoutPresets(directories), family, startFolder: animFolder ? `${ANIM_DIR}/${animFolder}` : null,
        coverUrl: getCoverUrl, favorites, folderCovers,
        // Stacked label with a dimmer tag line, matching the grid (#297).
        renderLabel: (el, name) => renderFlakeLabel(el, { name: displayNames[name] || name.split("/").pop(), tags: tagNames[name] || [] }),
    });
}

export async function openPresetPicker({ selected = "", family = "", kind = "img" } = {}) {
    let presets = [];
    let displayNames = {};
    try {
        const query = new URLSearchParams({ kind, ...(family ? { family } : {}) });
        const d = await (await fetch(`/flakes/presets?${query}`, { cache: "no-store" })).json();
        presets = d.presets || [];
        displayNames = d.display_names || {};
    } catch (err) {
        console.error("[flakes] failed to load presets for picker:", err);
    }
    // Animate presets open in video/<folder>; image ones derive img/<folder> from the family.
    const animFolder = kind === "anim" ? (await fetchAnimFamily(family).catch(() => null))?.folder : null;
    return openNamePicker({
        title: "Select a Preset", kind: "presets", noun: "preset", base: "model_presets/",
        names: presets, family, selected, startFolder: animFolder ? `${ANIM_DIR}/${animFolder}` : null,
        coverUrl: (name) => `/flakes/preset_cover?name=${encodeURIComponent(name)}`,
        renderLabel: (el, name) => { el.textContent = displayNames[name] || name.replace(/\\/g, "/").split("/").pop(); },
    });
}

// Grid picker over slash-separated names (flakes or presets): folders first,
// natural case-insensitive order, 7 tiles per row, and drive tabs (C:, D:, ...)
// when the names span several drives. One drive is shown at a time, an extra
// model path's by default. Without `directories`, folders come from the names.
// `drivesKind` is the /flakes/drives kind when it isn't `kind`.
// Resolves to {name} or null.
function openNamePicker({ title, kind, drivesKind = kind, noun, base, names, directories = null, family, startFolder = null, selected = "", coverUrl, renderLabel, favorites = [], folderCovers = {} }) {
    return new Promise((resolve) => {
        const { content, footer, close, handlers } = openOverlay();
        handlers.onClose = (v) => resolve(v ?? null);
        css(content.parentElement, content.parentElement.style.cssText + "width:min(1100px,94vw);max-width:94vw;");

        const headerRow = document.createElement("div");
        css(headerRow, "display:flex;align-items:center;gap:4px;margin-bottom:8px;");
        const titleEl = document.createElement("h3");
        css(titleEl, "margin:0;font-size:16px;color:#fff;font-weight:500;");
        titleEl.textContent = title;
        headerRow.appendChild(titleEl);
        const driveTabs = document.createElement("div");
        css(driveTabs, "display:flex;gap:4px;margin-left:auto;");
        headerRow.appendChild(driveTabs);
        content.appendChild(headerRow);
        let drives = { drives: [] };
        let currentDrive = "";
        const onDrive = (map, name) => !currentDrive || !map?.[name] || map[name].includes(currentDrive);
        const visibleNames = () => names.filter(n => onDrive(drives[kind], n));
        const visibleDirs = () => directories
            ? directories.filter(d => onDrive(drives.directories, d))
            : visibleNames().flatMap(n => normPath(n).split("/").slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join("/")));

        function renderDriveTabs() {
            driveTabs.replaceChildren();
            if (drives.drives.length < 2) return;
            for (const d of drives.drives) {
                const tab = makeButton(d);
                tab.style.borderColor = d === currentDrive ? "#2a6acf" : "#444";
                tab.addEventListener("click", () => {
                    currentDrive = d;
                    renderDriveTabs();
                    renderGrid(searchInput.value);
                });
                driveTabs.appendChild(tab);
            }
        }

        const pathBar = document.createElement("div");
        css(pathBar, "font-size:11px;color:#888;margin-bottom:6px;word-break:break-all;cursor:pointer;");
        content.appendChild(pathBar);

        const searchRow = document.createElement("div");
        css(searchRow, "margin-bottom:8px;");
        const searchInput = makeComfyInput("", `Search ${noun}s...`);
        searchRow.appendChild(searchInput);
        content.appendChild(searchRow);

        const grid = document.createElement("div");
        css(grid, "display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px;max-height:65vh;overflow:auto;align-content:start;");
        content.appendChild(grid);

        const folder = familyFolder(family);
        let currentFolder = startFolder ?? (folder ? `img/${folder}` : "");
        let selectedName = selected || null;
        let selectedEl = null;

        function normPath(p) {
            return p.replace(/\\/g, "/");
        }

        function getSubfolders(folder) {
            const prefix = folder ? normPath(folder) + "/" : "";
            const subs = new Set();
            for (const d of visibleDirs()) {
                const n = normPath(d);
                if (!n.startsWith(prefix)) continue;
                const rest = n.slice(prefix.length);
                if (!rest || rest.includes("/")) continue;
                subs.add(rest);
            }
            return [...subs].sort(naturalOrder);
        }

        function getNamesInFolder(folder) {
            const prefix = folder ? normPath(folder) + "/" : "";
            return visibleNames().filter(f => {
                const n = normPath(f);
                if (!prefix) return !n.includes("/");
                if (!n.startsWith(prefix)) return false;
                return !n.slice(prefix.length).includes("/");
            }).sort((x, y) => naturalOrder(x.split("/").pop(), y.split("/").pop()));
        }

        function renderBreadcrumb() {
            const drive = drives.drives.length > 1 ? `${currentDrive} ` : "";
            pathBar.textContent = drive + base + (currentFolder ? normPath(currentFolder) + "/" : "");
        }

        function showEmpty() {
            const empty = document.createElement("div");
            empty.textContent = `No ${noun}s found.`;
            css(empty, "opacity:0.5;font-style:italic;padding:12px;text-align:center;grid-column:1 / -1;");
            grid.appendChild(empty);
        }

        function openFolder(path) {
            currentFolder = path;
            searchInput.value = "";
            renderGrid();
        }

        function renderGrid(filter = "") {
            grid.replaceChildren();
            selectedEl = null;
            const term = filter.toLowerCase().trim();
            renderBreadcrumb();

            if (term) {
                // Search mode: scoped to currentFolder so the breadcrumb stays meaningful
                const prefix = currentFolder ? normPath(currentFolder) + "/" : "";
                const filtered = visibleNames().filter(n => normPath(n).startsWith(prefix) && normPath(n).slice(prefix.length).toLowerCase().includes(term));
                if (filtered.length === 0) return showEmpty();
                for (const name of filtered) grid.appendChild(makeThumb(name));
                return;
            }

            const subfolders = getSubfolders(currentFolder);
            const folderNames = getNamesInFolder(currentFolder);

            if (currentFolder) {
                const parts = normPath(currentFolder).split("/").filter(Boolean);
                parts.pop();
                grid.appendChild(makeFolderTile("↑", "..", () => openFolder(parts.join("/"))));
            }
            for (const sub of subfolders) {
                const path = currentFolder ? normPath(currentFolder) + "/" + sub : sub;
                grid.appendChild(makeFolderTile("📁", sub, () => openFolder(path), folderCovers[path]));
            }
            for (const name of folderNames) grid.appendChild(makeThumb(name));
            if (subfolders.length === 0 && folderNames.length === 0) showEmpty();
        }

        // Windows-style folder; `cover` names the flake whose cover sticks out of it (#424, #444).
        function makeFolderTile(icon, label, onClick, cover) {
            const item = document.createElement("div");
            css(item, "aspect-ratio:1/1;background-color:#252525;border:1px solid #444;border-radius:4px;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;user-select:none;box-sizing:border-box;");
            const labelEl = document.createElement("div");
            labelEl.textContent = label;
            css(labelEl, "font-size:10px;color:#ddd;text-align:center;padding:0 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;");
            if (label === "..") {
                const iconEl = document.createElement("div");
                iconEl.textContent = icon;
                css(iconEl, "font-size:24px;color:#888;");
                item.appendChild(iconEl);
            } else {
                const folder = document.createElement("div");
                css(folder, "position:relative;width:80%;flex:1;min-height:0;margin-top:6px;");
                const part = (style) => {
                    const el = document.createElement("div");
                    css(el, "position:absolute;box-sizing:border-box;" + style);
                    folder.appendChild(el);
                    return el;
                };
                part("left:0;top:0;width:42%;height:20%;background:#c9962a;border-radius:4px 4px 0 0;");
                part("left:0;right:0;top:10%;bottom:0;background:#c9962a;border-radius:0 4px 4px 4px;");
                if (cover) part(`left:5%;right:5%;top:14%;bottom:4%;background:#ddd url(${coverUrl(cover)}) center/cover;border-radius:2px;box-shadow:0 0 2px rgba(0,0,0,0.5);`);
                part("left:0;right:0;bottom:0;height:22%;background:linear-gradient(#f2c94c,#e8b93a);border-radius:4px 4px 3px 3px;border-top:1px solid #f7dc84;");
                item.appendChild(folder);
            }
            item.appendChild(labelEl);
            item.addEventListener("click", onClick);
            item.addEventListener("dblclick", (e) => e.stopPropagation());
            return item;
        }

        function makeThumb(name) {
            const thumb = document.createElement("div");
            css(thumb, `position:relative;aspect-ratio:1/1;background:#2a2a2a;border:1px solid ${name === selectedName ? "#2a6acf" : "#444"};border-radius:4px;cursor:pointer;font-size:10px;color:#ddd;user-select:none;box-sizing:border-box;overflow:hidden;background-image:url(${coverUrl(name)});background-size:cover;background-position:center;`);
            if (name === selectedName) selectedEl = thumb;

            const overlay = document.createElement("div");
            css(overlay, "position:absolute;inset:0;background:rgba(0,0,0,0.45);pointer-events:none;z-index:0;");
            thumb.appendChild(overlay);

            const nameEl = document.createElement("div");
            nameEl.title = name;
            css(nameEl, "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:500;text-align:center;line-height:1.2;text-shadow:0 1px 3px rgba(0,0,0,0.8);padding:0 4px;overflow:hidden;z-index:1;word-break:break-word;hyphens:auto;");
            renderLabel(nameEl, name);
            thumb.appendChild(nameEl);

            if (favorites.includes(name)) {
                const star = document.createElement("div");
                star.textContent = "★";
                css(star, "position:absolute;top:2px;right:4px;color:#f5c518;font-size:12px;line-height:1;text-shadow:0 1px 3px rgba(0,0,0,0.9);pointer-events:none;z-index:2;");
                thumb.appendChild(star);
            }

            thumb.addEventListener("click", () => {
                if (selectedEl) selectedEl.style.borderColor = "#444";
                selectedName = name;
                selectedEl = thumb;
                thumb.style.borderColor = "#2a6acf";
            });
            thumb.addEventListener("dblclick", () => close({ name }));
            return thumb;
        }

        pathBar.addEventListener("click", () => openFolder(""));

        renderGrid();
        searchInput.addEventListener("input", () => renderGrid(searchInput.value));
        searchInput.focus();
        fetch(`/flakes/drives?kind=${drivesKind}&family=${encodeURIComponent(family || "")}`).then(r => r.json()).then((d) => {
            drives = d;
            currentDrive = d.default || "";
            renderDriveTabs();
            renderGrid(searchInput.value);
        }).catch(() => {});

        const cancelBtn = makeButton("Cancel");
        cancelBtn.addEventListener("click", () => close(undefined));
        footer.appendChild(cancelBtn);

        const selectBtn = makeButton("Select", true);
        selectBtn.addEventListener("click", () => {
            if (!selectedName) {
                window.alert(`Select a ${noun} first.`);
                return;
            }
            close({ name: selectedName });
        });
        footer.appendChild(selectBtn);
    });
}

// Flake Combo "Multiple ↗" (#406): check several choices of one variant group.
// The slider sets how many choices Randomize checks; each press re-rolls.
// Resolves to the checked choices in group order, or null on cancel.
export function openVariantMultiPicker({ flakeName, group, choices, selected = [] }) {
    return new Promise((resolve) => {
        const { content, footer, close, handlers } = openOverlay();
        handlers.onClose = (v) => resolve(v ?? null);
        const checked = new Set(selected.filter(c => choices.includes(c)));

        const titleEl = document.createElement("h3");
        css(titleEl, "margin:0 0 8px;font-size:16px;color:#fff;font-weight:500;");
        titleEl.textContent = group;
        content.appendChild(titleEl);

        const topRow = document.createElement("div");
        css(topRow, "display:flex;align-items:center;gap:8px;margin-bottom:8px;");
        const slider = makeComfyValueSlider(checked.size, 0, choices.length, 1);
        slider.style.flex = "1";
        const randomBtn = makeButton("Randomize");
        randomBtn.style.height = "32px";
        randomBtn.addEventListener("click", () => {
            const pool = [...choices];
            for (let i = pool.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [pool[i], pool[j]] = [pool[j], pool[i]];
            }
            checked.clear();
            for (const c of pool.slice(0, slider.getValue())) checked.add(c);
            refreshTiles();
        });
        topRow.append(slider, randomBtn);
        content.appendChild(topRow);

        const grid = document.createElement("div");
        css(grid, "display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:6px;max-height:65vh;overflow:auto;align-content:start;");
        content.appendChild(grid);

        // Tiles show the choice image, or its initial when it has none.
        const tiles = choices.map((choice) => {
            const tile = document.createElement("div");
            const initial = document.createElement("div");
            initial.textContent = choice.trim().charAt(0).toUpperCase();
            css(initial, "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:36px;font-weight:600;color:#555;");
            const img = document.createElement("img");
            img.src = getVariantImageUrl(flakeName, group, choice);
            img.addEventListener("error", () => img.remove());
            css(img, "position:absolute;inset:0;width:100%;height:100%;object-fit:cover;");
            const nameEl = document.createElement("div");
            nameEl.textContent = choice;
            nameEl.title = choice;
            css(nameEl, "position:absolute;left:0;right:0;bottom:0;padding:12px 4px 4px;font-size:11px;font-weight:500;text-align:center;color:#fff;background:linear-gradient(transparent,rgba(0,0,0,0.85));overflow:hidden;text-overflow:ellipsis;white-space:nowrap;");
            const mark = document.createElement("div");
            mark.textContent = "✓";
            css(mark, "position:absolute;top:4px;right:4px;width:20px;height:20px;border-radius:50%;background:#2a6acf;color:#fff;font-size:13px;font-weight:700;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,0.8);");
            tile.append(initial, img, nameEl, mark);
            tile.addEventListener("click", () => {
                if (checked.has(choice)) checked.delete(choice);
                else checked.add(choice);
                refreshTiles();
            });
            grid.appendChild(tile);
            return { tile, mark, choice };
        });
        function refreshTiles() {
            for (const { tile, mark, choice } of tiles) {
                const on = checked.has(choice);
                css(tile, `position:relative;aspect-ratio:1/1;background:#252525;border:2px solid ${on ? "#2a6acf" : "#444"};border-radius:4px;cursor:pointer;user-select:none;box-sizing:border-box;overflow:hidden;${on ? "" : "opacity:0.55;"}`);
                mark.style.display = on ? "flex" : "none";
            }
        }
        refreshTiles();

        const cancelBtn = makeButton("Cancel");
        cancelBtn.addEventListener("click", () => close(undefined));
        footer.appendChild(cancelBtn);

        const okBtn = makeButton("OK", true);
        okBtn.addEventListener("click", () => close(choices.filter(c => checked.has(c))));
        footer.appendChild(okBtn);
    });
}

const BROWSE_TITLES = {
    checkpoints: "Select Checkpoint", loras: "Select LoRA", flakes: "Select Flake",
    vae: "Select VAE", text_encoders: "Select Text Encoder", diffusion_models: "Select Diffusion Model",
};
// Image picks can switch between these ComfyUI folders.
export const IMAGE_ROOTS = ["inputs", "output", "flake_images", "models", "lora_images"];
const ROOT_TAB_LABELS = { lora_images: "loras" };

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
        // root has folders on several drives — drives are never merged. The
        // server picks the extra model path's drive until one is clicked.
        let currentDrive = "";
        let chosenDrive = "";
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
        css(pathBar, "display:flex;flex-wrap:wrap;align-items:center;gap:2px;font-size:11px;color:#ddd;margin-bottom:8px;");
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

        // Large preview above the picker; Esc is caught in the capture phase so
        // the picker's own Esc handler doesn't close it too.
        function openPreview(path) {
            const backdrop = document.createElement("div");
            css(backdrop, "position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:10000;display:flex;align-items:center;justify-content:center;cursor:zoom-out;");
            const img = document.createElement("img");
            img.src = `/flakes/image?path=${encodeURIComponent(path)}`;
            css(img, "max-width:92vw;max-height:92vh;object-fit:contain;border-radius:4px;box-shadow:0 8px 32px rgba(0,0,0,0.6);");
            backdrop.appendChild(img);
            const closePreview = () => {
                backdrop.remove();
                window.removeEventListener("keydown", onKey, true);
            };
            function onKey(e) {
                if (e.key !== "Escape") return;
                e.preventDefault();
                e.stopImmediatePropagation();
                closePreview();
            }
            window.addEventListener("keydown", onKey, true);
            backdrop.addEventListener("click", closePreview);
            document.body.appendChild(backdrop);
        }

        function fileTile(label, file, path) {
            const pick = { file, path, type: currentType };
            const tile = makeTile(label, fileFace(file, path), (tile) => {
                if (selectedTile) selectedTile.style.borderColor = "#444";
                selected = pick;
                selectedTile = tile;
                tile.style.borderColor = "#2a6acf";
            }, () => close(pick));
            if (IMAGE_ROOTS.includes(currentType)) {
                const zoom = document.createElement("button");
                zoom.textContent = "\u{1F50D}";
                zoom.title = "Preview";
                css(zoom, "position:absolute;top:6px;right:6px;padding:2px 5px;cursor:pointer;border-radius:3px;font-size:11px;background:rgba(0,0,0,0.65);color:#ddd;border:1px solid #444;opacity:0;");
                tile.style.position = "relative";
                tile.addEventListener("mouseenter", () => { zoom.style.opacity = "1"; });
                tile.addEventListener("mouseleave", () => { zoom.style.opacity = "0"; });
                zoom.addEventListener("click", (e) => { e.stopPropagation(); openPreview(path); });
                zoom.addEventListener("dblclick", (e) => e.stopPropagation());
                tile.appendChild(zoom);
            }
            return tile;
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

        function renderPath(rel) {
            const parts = (rel || "").replace(/\\/g, "/").split("/").filter(Boolean);
            const rootLabel = (currentDrive && driveTabs.childElementCount ? `${currentDrive} ` : "") + (BROWSE_TYPE_LABELS[currentType] || currentType);
            const crumbs = [rootLabel, ...parts];
            pathBar.replaceChildren();
            crumbs.forEach((name, i) => {
                if (i) {
                    const sep = document.createElement("span");
                    sep.textContent = "›";
                    css(sep, "color:#666;");
                    pathBar.appendChild(sep);
                }
                if (i === crumbs.length - 1) {
                    const cur = document.createElement("span");
                    cur.textContent = name;
                    css(cur, "padding:2px 6px;");
                    pathBar.appendChild(cur);
                    return;
                }
                const crumb = document.createElement("button");
                crumb.textContent = name;
                css(crumb, "padding:2px 6px;cursor:pointer;border-radius:3px;font-size:11px;background:transparent;color:#aaa;border:1px solid transparent;");
                crumb.addEventListener("mouseenter", () => { crumb.style.background = "#333"; });
                crumb.addEventListener("mouseleave", () => { crumb.style.background = "transparent"; });
                crumb.addEventListener("click", () => loadDir(parts.slice(0, i).join("/")));
                pathBar.appendChild(crumb);
            });
        }

        function renderDriveTabs(drives) {
            driveTabs.replaceChildren();
            if (drives.length < 2) return;
            for (const d of drives) {
                const tab = makeButton(d);
                tab.style.borderColor = d === currentDrive ? "#2a6acf" : "#444";
                tab.addEventListener("click", () => {
                    chosenDrive = d;
                    loadDir(currentPath);
                });
                driveTabs.appendChild(tab);
            }
        }

        async function loadDir(path) {
            renderPath(path);
            searchInput.value = "";
            try {
                const data = await fetchBrowse(currentType, path, chosenDrive);
                currentDrive = data.drive || "";
                renderDriveTabs(data.drives || []);
                currentPath = data.path || "";
                renderPath(currentPath);
                // Folders first, then natural case-insensitive name order (Explorer).
                dirEntries = (data.entries || []).sort((a, b) => (a.type === "dir" ? 0 : 1) - (b.type === "dir" ? 0 : 1)
                    || naturalOrder(a.name, b.name));
                renderEntries();
            } catch (err) {
                if (path) {
                    // Requested directory does not exist — open its closest parent
                    return loadDir(path.replace(/\\/g, "/").split("/").slice(0, -1).join("/"));
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
            const tab = makeButton(`${ROOT_TAB_LABELS[root] || BROWSE_TYPE_LABELS[root] || root}/`);
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

// Flake images (cover, ControlNet, variant) are picked in place from any
// ComfyUI folder rather than uploaded, so the save can move the original file
// and its batch, or keep it where it is inside the flake's folder (#392, #396).
// input/ picks stay input-relative; other folders give an absolute path.
// Without an earlier pick in this session, an existing flake opens on its folder.
let lastImageDir = null;
export async function pickImage(flakeName) {
    const start = lastImageDir || (flakeName ? { type: "flake_images", path: flakeName } : { type: "inputs", path: "" });
    const result = await openFileBrowser({ type: start.type, defaultPath: start.path, roots: IMAGE_ROOTS });
    if (!result?.file) return null;
    lastImageDir = { type: result.type, path: result.file.split("/").slice(0, -1).join("/") };
    return result.type === "inputs" ? result.file : result.path;
}

// Image files dragged in from disk (#447). While they are over the page every
// connected drop target is highlighted, the hovered one more strongly. Other
// drags (grid reorder, cross-node flake moves) are left alone.
const dropTargets = new Set();
const dropStyle = document.createElement("style");
dropStyle.textContent = `
.flakes-drop-armed { outline:2px dashed #4a9eff !important; outline-offset:-2px; box-shadow:inset 0 0 0 999px rgba(74,158,255,0.12) !important; }
.flakes-drop-hover { outline-style:solid !important; box-shadow:inset 0 0 0 999px rgba(74,158,255,0.3) !important; }`;
document.head.appendChild(dropStyle);

const isFileDrag = (e) => e.dataTransfer?.types.includes("Files");

function paintDropTargets(e) {
    for (const el of dropTargets) {
        if (!el.isConnected) {
            dropTargets.delete(el);
            continue;
        }
        el.classList.toggle("flakes-drop-armed", !!e);
        el.classList.toggle("flakes-drop-hover", !!e && el.contains(e.target));
    }
}
window.addEventListener("dragover", (e) => { if (isFileDrag(e)) paintDropTargets(e); }, true);
window.addEventListener("dragleave", (e) => { if (!e.relatedTarget) paintDropTargets(null); }, true);
window.addEventListener("drop", () => paintDropTargets(null), true);
window.addEventListener("dragend", () => paintDropTargets(null), true);

// Dropped images upload to input/flakes/ and reach `onImages` as input-relative
// paths, in drop order, like input/ picks. Stopping the events keeps ComfyUI
// from loading the file as a workflow.
export function makeImageDropTarget(el, onImages) {
    dropTargets.add(el);
    el.addEventListener("dragover", (e) => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "copy";
    });
    el.addEventListener("drop", async (e) => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        e.stopPropagation();
        // Copied first: the drop's file list empties once this handler awaits.
        const files = [...e.dataTransfer.files].filter(f => f.type.startsWith("image/"));
        const paths = [];
        for (const file of files) paths.push(await uploadInputImage(file));
        if (paths.length) onImages(paths);
    });
}

// Bottom-left button of a Flake Animate grid item (#441): `+` picks its first
// input image, the image count opens the item's image list. `onChanged` runs
// after every edit of `entry.images`.
export function makeItemImagesButton(entry, onChanged) {
    const count = entry.images?.length || 0;
    const btn = document.createElement("button");
    btn.textContent = count ? String(count) : "+";
    btn.title = count ? "Input images (one video each)" : "Add an input image";
    css(btn, "position:absolute;bottom:2px;left:2px;z-index:6;min-width:18px;height:16px;padding:0 4px;border:none;border-radius:8px;background:rgba(0,0,0,0.65);color:#cfe6ff;font-size:10px;font-weight:700;line-height:16px;cursor:pointer;");
    btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (count) {
            openItemImages(entry, onChanged);
            return;
        }
        const path = await pickImage();
        if (!path) return;
        entry.images = [path];
        onChanged();
    });
    btn.addEventListener("mousedown", (e) => e.stopPropagation());
    btn.addEventListener("dblclick", (e) => e.stopPropagation());
    return btn;
}

// Images dropped on a Flake Animate grid item or its image list are appended
// to the item's input images (#448).
export function makeItemImagesDropTarget(el, entry, onChanged) {
    makeImageDropTarget(el, (paths) => {
        entry.images = [...(entry.images || []), ...paths];
        onChanged();
    });
}

// Small overlay grid of an item's input images: click previews one larger,
// ✕ removes it, drag reorders, the + tile adds one.
function openItemImages(entry, onChanged) {
    const { overlay, panel, content, footer } = openOverlay();
    css(panel, panel.style.cssText + "width:auto;");
    footer.style.display = "none";
    let dragFrom = null;

    function changed() {
        onChanged();
        render();
    }

    function preview(path) {
        const view = document.createElement("div");
        css(view, "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;cursor:zoom-out;");
        const img = document.createElement("img");
        img.src = pickedImageUrl(path);
        css(img, "max-width:80vw;max-height:80vh;border-radius:6px;box-shadow:0 8px 32px rgba(0,0,0,0.7);");
        view.appendChild(img);
        view.addEventListener("click", () => view.remove());
        overlay.appendChild(view);
    }

    function makeTile() {
        const tile = document.createElement("div");
        css(tile, "position:relative;width:96px;height:96px;border-radius:4px;background:#2a2a2a center/cover no-repeat;box-sizing:border-box;cursor:pointer;");
        return tile;
    }

    function render() {
        const grid = document.createElement("div");
        css(grid, "display:grid;grid-template-columns:repeat(4, 96px);gap:6px;");
        entry.images.forEach((path, i) => {
            const tile = makeTile();
            tile.style.backgroundImage = `url("${pickedImageUrl(path)}")`;
            tile.title = path;
            tile.draggable = true;
            tile.addEventListener("click", () => preview(path));
            tile.addEventListener("dragstart", () => { dragFrom = i; });
            tile.addEventListener("dragend", () => { dragFrom = null; });
            tile.addEventListener("dragover", (e) => { if (dragFrom !== null && dragFrom !== i) e.preventDefault(); });
            tile.addEventListener("drop", (e) => {
                if (dragFrom === null) return;  // files from disk: the panel's drop target
                e.preventDefault();
                entry.images.splice(i, 0, ...entry.images.splice(dragFrom, 1));
                dragFrom = null;
                changed();
            });
            const remove = document.createElement("button");
            remove.textContent = "✕";
            remove.title = "Remove image";
            css(remove, "position:absolute;top:2px;right:2px;width:18px;height:18px;padding:0;border:none;border-radius:9px;background:rgba(0,0,0,0.65);color:#fff;font-size:11px;line-height:18px;cursor:pointer;");
            remove.addEventListener("click", (e) => {
                e.stopPropagation();
                entry.images.splice(i, 1);
                changed();
            });
            tile.appendChild(remove);
            grid.appendChild(tile);
        });
        const add = makeTile();
        add.textContent = "+";
        add.title = "Add an input image";
        css(add, add.style.cssText + "border:1px dashed #555;display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:300;color:#777;");
        add.addEventListener("click", async () => {
            const path = await pickImage();
            if (!path) return;
            entry.images.push(path);
            changed();
        });
        grid.appendChild(add);
        content.replaceChildren(grid);
    }
    render();
    makeItemImagesDropTarget(panel, entry, changed);
}
