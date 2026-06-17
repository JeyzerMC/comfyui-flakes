// ---------- Model family ----------

export const FAMILY_FOLDERS = {
    "SDXL/Base": "sdxl",
    "SDXL/Illustrious": "illustrious",
    "SDXL/Pony": "pony",
    "ZImage/Base": "zib",
    "ZImage/Turbo": "zit",
    "Anima/Base": "anima",
    "Flux/Klein": "flux_klein",
    "Common": "common",
};

export function familyFolder(family) {
    return FAMILY_FOLDERS[family] || null;
}

// Mirror of flake_io._CN_MODEL_MAP — keep in sync.
export const CN_MODEL_MAP = {
    sdxl: {
        openpose: "controlnet_openpose_sdxl",
        depth: "controlnet_depth_sdxl",
        canny: "controlnet_canny_sdxl",
        lineart: "controlnet_lineart_sdxl",
        lineart_anime: "controlnet_lineart_anime_sdxl",
        softedge: "controlnet_softedge_sdxl",
        scribble: "controlnet_scribble_sdxl",
        normalbae: "controlnet_normalbae_sdxl",
        seg: "controlnet_seg_sdxl",
        tile: "controlnet_tile_sdxl",
        ip2p: "controlnet_ip2p_sdxl",
    },
    illustrious: {
        openpose: "controlnet_openpose_sdxl",
        depth: "controlnet_depth_sdxl",
        canny: "controlnet_canny_sdxl",
        lineart: "controlnet_lineart_sdxl",
        lineart_anime: "controlnet_lineart_anime_sdxl",
        softedge: "controlnet_softedge_sdxl",
        scribble: "controlnet_scribble_sdxl",
        normalbae: "controlnet_normalbae_sdxl",
        seg: "controlnet_seg_sdxl",
        tile: "controlnet_tile_sdxl",
        ip2p: "controlnet_ip2p_sdxl",
    },
    pony: {
        openpose: "controlnet_openpose_sdxl",
        depth: "controlnet_depth_sdxl",
        canny: "controlnet_canny_sdxl",
        lineart: "controlnet_lineart_sdxl",
        lineart_anime: "controlnet_lineart_anime_sdxl",
        softedge: "controlnet_softedge_sdxl",
        scribble: "controlnet_scribble_sdxl",
        normalbae: "controlnet_normalbae_sdxl",
        seg: "controlnet_seg_sdxl",
        tile: "controlnet_tile_sdxl",
        ip2p: "controlnet_ip2p_sdxl",
    },
    zib: {
        openpose: "controlnet_openpose_zib",
        depth: "controlnet_depth_zib",
        canny: "controlnet_canny_zib",
        lineart: "controlnet_lineart_zib",
        lineart_anime: "controlnet_lineart_anime_zib",
        softedge: "controlnet_softedge_zib",
        scribble: "controlnet_scribble_zib",
        normalbae: "controlnet_normalbae_zib",
        seg: "controlnet_seg_zib",
        tile: "controlnet_tile_zib",
        ip2p: "controlnet_ip2p_zib",
    },
    zit: {
        openpose: "controlnet_openpose_zib",
        depth: "controlnet_depth_zib",
        canny: "controlnet_canny_zib",
        lineart: "controlnet_lineart_zib",
        lineart_anime: "controlnet_lineart_anime_zib",
        softedge: "controlnet_softedge_zib",
        scribble: "controlnet_scribble_zib",
        normalbae: "controlnet_normalbae_zib",
        seg: "controlnet_seg_zib",
        tile: "controlnet_tile_zib",
        ip2p: "controlnet_ip2p_zib",
    },
    common: {
        openpose: "controlnet_openpose_sdxl",
        depth: "controlnet_depth_sdxl",
        canny: "controlnet_canny_sdxl",
        lineart: "controlnet_lineart_sdxl",
        lineart_anime: "controlnet_lineart_anime_sdxl",
        softedge: "controlnet_softedge_sdxl",
        scribble: "controlnet_scribble_sdxl",
        normalbae: "controlnet_normalbae_sdxl",
        seg: "controlnet_seg_sdxl",
        tile: "controlnet_tile_sdxl",
        ip2p: "controlnet_ip2p_sdxl",
    },
    anima: {
        openpose: "controlnet_openpose_anima",
        depth: "controlnet_depth_anima",
        canny: "controlnet_canny_anima",
        lineart: "controlnet_lineart_anima",
        lineart_anime: "controlnet_lineart_anime_anima",
        softedge: "controlnet_softedge_anima",
        scribble: "controlnet_scribble_anima",
        normalbae: "controlnet_normalbae_anima",
        seg: "controlnet_seg_anima",
        tile: "controlnet_tile_anima",
        ip2p: "controlnet_ip2p_anima",
    },
    flux_klein: {
        openpose: "controlnet_openpose_flux",
        depth: "controlnet_depth_flux",
        canny: "controlnet_canny_flux",
        lineart: "controlnet_lineart_flux",
        lineart_anime: "controlnet_lineart_anime_flux",
        softedge: "controlnet_softedge_flux",
        scribble: "controlnet_scribble_flux",
        normalbae: "controlnet_normalbae_flux",
        seg: "controlnet_seg_flux",
        tile: "controlnet_tile_flux",
        ip2p: "controlnet_ip2p_flux",
    },
};

// Global registry for mutually-exclusive option panels (flake combo/stack dropdowns).
// Each panel registers a close function; opening a new panel closes all others.
const _openPanels = new Set();

export function _registerOpenPanel(closeFn) {
    _closeAllPanels();
    _openPanels.add(closeFn);
}

export function _unregisterOpenPanel(closeFn) {
    _openPanels.delete(closeFn);
}

function _closeAllPanels() {
    for (const fn of _openPanels) fn();
}

// ---------- Widget show/hide ----------
// Hide a node widget so it neither renders nor takes vertical space, but
// stays in node.widgets so prompt serialization still includes its value
// (necessary for widgets bound to REQUIRED Python inputs).
//
// Different ComfyUI frontend versions render widgets differently:
//   - LiteGraph canvas-drawn COMBO/STRING widgets render via `widget.draw`.
//   - The modern Vue/DOM frontend uses `widget.element` and/or `widget.inputEl`.
//   - Both versions usually honor `widget.computeSize` returning [0, -4] to
//     collapse the row height.
// We stack every known signal so at least one is honored.
const _widgetHideState = new WeakMap();
export function setWidgetHidden(widget, hide) {
    if (!widget) return;
    let saved = _widgetHideState.get(widget);
    if (hide) {
        if (saved) return; // already hidden
        const state = widget._state || null; // modern ComfyUI proxy mirror
        saved = {
            type: widget.type,
            computeSize: widget.computeSize,
            draw: widget.draw,
            options: widget.options,
            elementDisplay: widget.element ? widget.element.style.display : null,
            inputElDisplay: widget.inputEl ? widget.inputEl.style.display : null,
            stateType: state ? state.type : null,
            stateDisabled: state ? state.disabled : null,
            stateLabel: state ? state.label : null,
        };
        _widgetHideState.set(widget, saved);
        widget.computeSize = () => [0, -4];
        widget.type = "hidden";
        widget.hidden = true;
        widget.draw = function () {};
        widget.options = { ...(widget.options || {}), serialize: true };
        if (widget.element) {
            widget.element.style.setProperty("display", "none", "important");
            let parent = widget.element.parentElement;
            while (parent && !parent.classList.contains("comfy-widgets-divider") && parent.parentElement) {
                parent = parent.parentElement;
            }
            if (parent) parent.style.setProperty("display", "none", "important");
        }
        if (widget.inputEl) widget.inputEl.style.setProperty("display", "none", "important");
        // Mirror onto _state (#216 v3): on modern frontends the canvas-drawn
        // ComboWidget renders from this Proxy rather than the top-level widget
        // object. Setting type='hidden' here is what actually suppresses draw.
        if (state) {
            try { state.type = "hidden"; } catch { /* proxy may be read-only */ }
            try { state.disabled = true; } catch { /* */ }
            try { state.label = ""; } catch { /* */ }
        }
    } else {
        if (!saved) return; // already visible
        widget.type = saved.type;
        widget.computeSize = saved.computeSize;
        if (saved.draw) widget.draw = saved.draw;
        else delete widget.draw;
        if (saved.options) widget.options = saved.options;
        widget.hidden = false;
        if (widget.element && saved.elementDisplay !== null) {
            widget.element.style.removeProperty("display");
            widget.element.style.display = saved.elementDisplay;
        }
        if (widget.inputEl && saved.inputElDisplay !== null) {
            widget.inputEl.style.removeProperty("display");
            widget.inputEl.style.display = saved.inputElDisplay;
        }
        // Restore parent container display
        if (widget.element) {
            let parent = widget.element.parentElement;
            while (parent && !parent.classList.contains("comfy-widgets-divider") && parent.parentElement) {
                parent = parent.parentElement;
            }
            if (parent) parent.style.removeProperty("display");
        }
        const state = widget._state || null;
        if (state) {
            if (saved.stateType !== null) try { state.type = saved.stateType; } catch { /* */ }
            if (saved.stateDisabled !== null) try { state.disabled = saved.stateDisabled; } catch { /* */ }
            if (saved.stateLabel !== null) try { state.label = saved.stateLabel; } catch { /* */ }
        }
        _widgetHideState.delete(widget);
    }
}

// Wrap a textarea (or any block element) in a relative container with an
// absolute-positioned ✕ button anchored to the top-right corner. The button
// is invisible by default and fades in when the container is hovered. Used
// for the prompt-field remove affordance (#226) so the X consumes no layout
// space when not hovered.
export function makeHoverRemoveWrapper(child, onRemove, title = "Remove") {
    const wrap = document.createElement("div");
    css(wrap, "position:relative;flex:1;min-width:0;display:flex;flex-direction:column;");
    wrap.appendChild(child);
    const btn = document.createElement("button");
    btn.textContent = "✕";
    btn.title = title;
    btn.type = "button";
    css(btn, [
        "position:absolute;top:4px;right:4px;z-index:2;",
        "width:18px;height:18px;padding:0;border-radius:3px;",
        "background:rgba(40,40,40,0.85);color:#bbb;",
        "border:1px solid #444;cursor:pointer;font-size:11px;line-height:1;",
        "display:flex;align-items:center;justify-content:center;",
        "opacity:0;transition:opacity 0.12s ease;",
    ].join(""));
    wrap.addEventListener("mouseenter", () => { btn.style.opacity = "1"; });
    wrap.addEventListener("mouseleave", () => { btn.style.opacity = "0"; });
    btn.addEventListener("focus", () => { btn.style.opacity = "1"; });
    btn.addEventListener("blur", () => { btn.style.opacity = "0"; });
    btn.addEventListener("mouseenter", () => { btn.style.background = "rgba(90,40,40,0.95)"; btn.style.color = "#fdd"; });
    btn.addEventListener("mouseleave", () => { btn.style.background = "rgba(40,40,40,0.85)"; btn.style.color = "#bbb"; });
    btn.addEventListener("click", (e) => { e.stopPropagation(); e.preventDefault(); onRemove(); });
    wrap.appendChild(btn);
    return wrap;
}

// ---------- Zoom scaling for native <select> in DOM widgets ----------



// ---------- Default-flake helpers ----------

export function makeDefaultEntry() {
    return {
        inline: true,
        content: { prompt: { positive: "" } },
        loras: [],
        strength: 1.0,
        option: {},
    };
}

export function ensureDefault(entries) {
    if (!entries.length || !entries[0].inline) entries.unshift(makeDefaultEntry());
    return entries;
}

// ---------- Style helpers ----------

export const css = (el, s) => { el.style.cssText = s; return el; };

export function makeButton(label, primary = false) {
    const b = document.createElement("button");
    b.textContent = label;
    css(b, `padding:6px 12px;cursor:pointer;border-radius:3px;font-size:12px;${
        primary
            ? "background:#2a6acf;color:#fff;border:1px solid #2a6acf;"
            : "background:#2a2a2a;color:#ddd;border:1px solid #444;"
    }`);
    return b;
}

export function makeSmallButton(label) {
    const b = document.createElement("button");
    b.textContent = label;
    css(b, "padding:2px 6px;font-size:10px;cursor:pointer;background:#2a2a2a;color:#ddd;border:1px solid #444;border-radius:3px;");
    return b;
}

export function makeIconBtn(text, title, onClick) {
    const b = document.createElement("button");
    b.textContent = text;
    b.title = title;
    css(b, "width:18px;height:18px;padding:0;cursor:pointer;background:#2a2a2a;color:#aaa;border:1px solid #444;border-radius:3px;font-size:10px;line-height:16px;text-align:center;flex-shrink:0;");
    b.addEventListener("click", onClick);
    b.addEventListener("dblclick", (e) => e.stopPropagation());
    b.addEventListener("mousedown", (e) => e.stopPropagation());
    return b;
}

export function makeInput(value = "", placeholder = "") {
    const el = document.createElement("input");
    el.type = "text";
    el.value = value;
    el.placeholder = placeholder;
    css(el, "background:#2a2a2a;color:#ddd;border:1px solid #444;padding:4px 6px;border-radius:3px;font-size:12px;width:100%;box-sizing:border-box;");
    return el;
}

export function makeTextarea(value = "", placeholder = "", rows = 3) {
    const el = document.createElement("textarea");
    el.value = value;
    el.placeholder = placeholder;
    el.rows = rows;
    css(el, "background:#2a2a2a;color:#ddd;border:1px solid #444;padding:6px;border-radius:3px;font-size:12px;width:100%;box-sizing:border-box;font-family:inherit;resize:vertical;");
    return el;
}

// Grow a textarea to fit its content up to maxPx, then scroll (#264). Returns
// the resize fn so callers can trigger it after programmatic value changes.
export function attachAutoGrow(el, maxPx = 240) {
    el.style.resize = "none";
    el.style.overflowY = "hidden";
    const resize = () => {
        el.style.height = "auto";
        const h = Math.min(el.scrollHeight, maxPx);
        el.style.height = `${h}px`;
        el.style.overflowY = el.scrollHeight > maxPx ? "auto" : "hidden";
    };
    el.addEventListener("input", resize);
    // scrollHeight needs layout — size on the next frame once in the DOM.
    requestAnimationFrame(resize);
    return resize;
}

export function makeLabel(text) {
    const l = document.createElement("div");
    l.textContent = text;
    css(l, "font-size:11px;opacity:0.7;margin:4px 0 2px;");
    return l;
}

export function makeNumberInput(value = 0, placeholder = "", step = 0.1) {
    const el = document.createElement("input");
    el.type = "number";
    el.value = String(value);
    el.placeholder = placeholder;
    el.step = String(step);
    css(el, "background:#2a2a2a;color:#ddd;border:1px solid #444;padding:4px 6px;border-radius:3px;font-size:12px;width:100%;box-sizing:border-box;");
    return el;
}

// ----- ComfyUI-native style helpers (for modal) -----

export function makeComfyLabel(text) {
    const l = document.createElement("div");
    l.textContent = text;
    css(l, "font-size:13px;color:#aaa;margin:10px 0 4px;font-weight:400;");
    return l;
}

export function makeComfyInput(value = "", placeholder = "") {
    const el = document.createElement("input");
    el.type = "text";
    el.value = value;
    el.placeholder = placeholder;
    css(el, "background:#1a1a1a;color:#ddd;border:1px solid #333;padding:6px 8px;border-radius:6px;font-size:13px;width:100%;box-sizing:border-box;outline:none;");
    el.addEventListener("focus", () => { el.style.borderColor = "#555"; });
    el.addEventListener("blur", () => { el.style.borderColor = "#333"; });
    return el;
}

export function makeComfyDropdown(options = [], selected = "") {
    const wrap = document.createElement("div");
    css(wrap, "position:relative;width:100%;");
    const el = document.createElement("select");
    for (const opt of options) {
        const o = document.createElement("option");
        o.value = opt.value;
        o.textContent = opt.label;
        if (opt.value === selected) o.selected = true;
        el.appendChild(o);
    }
    css(el, "background:#1a1a1a;color:#ddd;border:1px solid #333;padding:6px 8px;border-radius:6px;font-size:13px;width:100%;box-sizing:border-box;appearance:none;cursor:pointer;outline:none;");
    el.addEventListener("focus", () => { el.style.borderColor = "#555"; });
    el.addEventListener("blur", () => { el.style.borderColor = "#333"; });

    const chevron = document.createElement("div");
    chevron.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>`;
    css(chevron, "position:absolute;right:8px;top:50%;transform:translateY(-50%);pointer-events:none;");

    wrap.appendChild(el);
    wrap.appendChild(chevron);
    return { element: el, container: wrap };
}

export function makePanelDropdown(options = [], selected = "") {
    const wrap = document.createElement("div");
    css(wrap, "position:relative;width:100%;");
    const el = document.createElement("select");
    for (const opt of options) {
        const o = document.createElement("option");
        o.value = opt.value;
        o.textContent = opt.label;
        css(o, "font-size:13px;text-align:center;");
        if (opt.value === selected) o.selected = true;
        el.appendChild(o);
    }
    css(el, "background:#1a1a1a;color:#ddd;border:1px solid #333;border-radius:4px;font-size:13px;height:26px;width:100%;box-sizing:border-box;appearance:none;-webkit-appearance:none;-moz-appearance:none;cursor:pointer;outline:none;text-align:center;text-align-last:center;-moz-text-align-last:center;padding:0 18px;");
    el.addEventListener("focus", () => { el.style.borderColor = "#555"; });
    el.addEventListener("blur", () => { el.style.borderColor = "#333"; });

    const chevron = document.createElement("div");
    chevron.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>`;
    css(chevron, "position:absolute;right:4px;top:50%;transform:translateY(-50%);pointer-events:none;");

    wrap.appendChild(el);
    wrap.appendChild(chevron);
    return { element: el, container: wrap };
}

export function makeSearchableDropdown(items = [], value = "", placeholder = "") {
    const wrap = document.createElement("div");
    css(wrap, "position:relative;width:100%;");

    const row = document.createElement("div");
    css(row, "position:relative;display:flex;align-items:center;");
    wrap.appendChild(row);

    const el = document.createElement("input");
    el.type = "text";
    el.value = value;
    el.placeholder = placeholder;
    css(el, "background:#1a1a1a;color:#ddd;border:1px solid #333;padding:6px 28px 6px 8px;border-radius:6px;font-size:13px;width:100%;box-sizing:border-box;outline:none;");
    el.addEventListener("focus", () => { el.style.borderColor = "#555"; });
    el.addEventListener("blur", () => { el.style.borderColor = "#333"; });

    const arrowBtn = document.createElement("button");
    arrowBtn.type = "button";
    arrowBtn.tabIndex = -1;
    arrowBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>`;
    css(arrowBtn, "position:absolute;right:4px;top:50%;transform:translateY(-50%);background:transparent;border:none;cursor:pointer;padding:2px;display:flex;align-items:center;justify-content:center;z-index:2;line-height:1;");
    arrowBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (dropdown.style.display === "block") {
            closeDropdown();
        } else {
            openDropdown();
        }
    });

    row.appendChild(el);
    row.appendChild(arrowBtn);

    // position:fixed so the menu escapes any overflow:auto ancestor (e.g. the
    // modal body) that would otherwise clip it for fields near the bottom
    // (#263). Coordinates are computed from the input on open.
    const dropdown = document.createElement("div");
    css(dropdown, "position:fixed;max-height:200px;overflow-y:auto;background:#1e1e1e;border:1px solid #444;border-radius:6px;z-index:10000;display:none;box-shadow:0 4px 12px rgba(0,0,0,0.5);");
    wrap.appendChild(dropdown);

    function positionDropdown() {
        const r = el.getBoundingClientRect();
        const maxH = 200;
        const below = window.innerHeight - r.bottom;
        dropdown.style.left = `${r.left}px`;
        dropdown.style.width = `${r.width}px`;
        if (below < maxH && r.top > below) {
            // Not enough room below — open upward.
            dropdown.style.top = "auto";
            dropdown.style.bottom = `${window.innerHeight - r.top + 2}px`;
        } else {
            dropdown.style.bottom = "auto";
            dropdown.style.top = `${r.bottom + 2}px`;
        }
    }

    let allItems = [...items];
    let dropdownOpen = false;

    function renderDropdown(filter = "") {
        dropdown.replaceChildren();
        const lower = filter.toLowerCase();
        const filtered = allItems.filter(item => !lower || item.toLowerCase().includes(lower));
        if (filtered.length === 0) {
            const empty = document.createElement("div");
            css(empty, "padding:6px 8px;font-size:12px;color:#666;");
            empty.textContent = "No matches";
            dropdown.appendChild(empty);
            return;
        }
        for (const item of filtered) {
            const opt = document.createElement("div");
            opt.textContent = item;
            css(opt, "padding:4px 8px;cursor:pointer;font-size:12px;color:#ddd;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;");
            opt.addEventListener("mouseenter", () => { opt.style.background = "#333"; });
            opt.addEventListener("mouseleave", () => { opt.style.background = "transparent"; });
            opt.addEventListener("mousedown", (e) => {
                e.preventDefault();
                e.stopPropagation();
                el.value = item;
                el.dispatchEvent(new Event("change", { bubbles: true }));
                el.dispatchEvent(new Event("input", { bubbles: true }));
                closeDropdown();
            });
            dropdown.appendChild(opt);
        }
    }

    function _reposition() { if (dropdownOpen) positionDropdown(); }

    function openDropdown() {
        dropdownOpen = true;
        dropdown.style.display = "block";
        positionDropdown();
        renderDropdown(el.value);
        window.addEventListener("scroll", _reposition, true);
        window.addEventListener("resize", _reposition);
    }

    function closeDropdown() {
        dropdownOpen = false;
        dropdown.style.display = "none";
        window.removeEventListener("scroll", _reposition, true);
        window.removeEventListener("resize", _reposition);
    }

    el.addEventListener("focus", () => { openDropdown(); });
    el.addEventListener("input", () => {
        if (dropdownOpen) renderDropdown(el.value);
    });
    el.addEventListener("dblclick", () => {
        el.select();
        openDropdown();
    });

    document.addEventListener("mousedown", (e) => {
        if (!wrap.contains(e.target)) closeDropdown();
    });

    const datalist = {
        appendChild(child) {
            if (child.tagName === "OPTION" && child.value) {
                allItems.push(child.value);
            }
            return child;
        },
    };

    return { element: el, datalist, container: wrap };
}

// Multi-select chip list backed by a searchable dropdown (#294). Picking an
// option (or pressing Enter on free text) appends a chip and clears the input,
// so several values can be added in a row — unlike a single searchable input
// whose value gets replaced on each pick. `datalist.appendChild` populates the
// option list (same shape as makeSearchableDropdown); `getValues()` returns the
// selected list in order.
export function makeChipMultiSelect({ options = [], selected = [], placeholder = "" } = {}) {
    const container = document.createElement("div");
    css(container, "display:flex;flex-direction:column;gap:4px;");
    const chosen = [...selected];

    const chipRow = document.createElement("div");
    css(chipRow, "display:flex;flex-wrap:wrap;gap:3px;");
    container.appendChild(chipRow);

    const dd = makeSearchableDropdown(options, "", placeholder);
    container.appendChild(dd.container);

    function renderChips() {
        chipRow.replaceChildren();
        chosen.forEach((val, i) => {
            const chip = document.createElement("span");
            css(chip, "display:inline-flex;align-items:center;gap:4px;background:#2a3a4a;border:1px solid #3a5a8a;border-radius:3px;padding:1px 6px;font-size:11px;color:#cde;");
            chip.textContent = val;
            const x = document.createElement("span");
            x.textContent = "✕";
            css(x, "cursor:pointer;color:#9ab;font-size:10px;");
            x.addEventListener("click", () => { chosen.splice(i, 1); renderChips(); });
            chip.appendChild(x);
            chipRow.appendChild(chip);
        });
    }

    function addValue(v) {
        const val = (v || "").trim();
        if (!val || chosen.includes(val)) return;
        chosen.push(val);
        renderChips();
    }

    dd.element.addEventListener("change", () => {
        addValue(dd.element.value);
        dd.element.value = "";
    });
    dd.element.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            addValue(dd.element.value);
            dd.element.value = "";
        }
    });

    renderChips();
    return { container, datalist: dd.datalist, getValues: () => [...chosen] };
}

export function makeComfyNumberInput(value, placeholder, step = 1) {
    const el = document.createElement("input");
    el.type = "number";
    el.value = String(value);
    el.placeholder = placeholder;
    el.step = String(step);
    css(el, "background:#1a1a1a;color:#ddd;border:1px solid #333;padding:6px 8px;border-radius:6px;font-size:13px;width:100%;box-sizing:border-box;outline:none;");
    el.addEventListener("focus", () => { el.style.borderColor = "#555"; });
    el.addEventListener("blur", () => { el.style.borderColor = "#333"; });
    return el;
}

export function makeComfySlider(value, min, max, step) {
    const row = document.createElement("div");
    css(row, "display:flex;align-items:center;gap:0;background:#1a1a1a;border:1px solid #333;border-radius:6px;overflow:hidden;");

    let current = parseFloat(value) || 0;
    const clamp = (v) => Math.min(max, Math.max(min, v));
    const format = (v) => Number.isInteger(step) ? String(v) : v.toFixed(step < 0.1 ? 2 : 1);
    current = clamp(current);

    const minusBtn = document.createElement("button");
    minusBtn.textContent = "\u2212";
    css(minusBtn, "width:22px;height:32px;padding:0;background:transparent;color:#888;border:none;border-right:1px solid #333;cursor:pointer;font-size:14px;line-height:1;flex-shrink:0;transition:background 0.1s;");
    minusBtn.addEventListener("mouseenter", () => minusBtn.style.background = "#252525");
    minusBtn.addEventListener("mouseleave", () => minusBtn.style.background = "transparent");

    const valSpan = document.createElement("span");
    valSpan.textContent = format(current);
    css(valSpan, "flex:1;text-align:center;font-size:13px;color:#ddd;font-variant-numeric:tabular-nums;user-select:none;cursor:ew-resize;height:32px;display:flex;align-items:center;justify-content:center;");

    const plusBtn = document.createElement("button");
    plusBtn.textContent = "+";
    css(plusBtn, "width:22px;height:32px;padding:0;background:transparent;color:#888;border:none;border-left:1px solid #333;cursor:pointer;font-size:14px;line-height:1;flex-shrink:0;transition:background 0.1s;");
    plusBtn.addEventListener("mouseenter", () => plusBtn.style.background = "#252525");
    plusBtn.addEventListener("mouseleave", () => plusBtn.style.background = "transparent");

    function update(v) {
        current = clamp(v);
        valSpan.textContent = format(current);
    }

    minusBtn.addEventListener("click", () => update(current - step));
    plusBtn.addEventListener("click", () => update(current + step));

    let didDrag = false;
    valSpan.addEventListener("click", (e) => {
        e.stopPropagation();
        if (didDrag) { didDrag = false; return; }
        if (valSpan.contentEditable === "true") return;
        valSpan.contentEditable = "true";
        valSpan.style.userSelect = "text";
        valSpan.style.cursor = "text";
        valSpan.focus();
        const range = document.createRange();
        range.selectNodeContents(valSpan);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    });
    function exitEdit() {
        valSpan.contentEditable = "false";
        valSpan.style.userSelect = "none";
        valSpan.style.cursor = "ew-resize";
        const v = parseFloat(valSpan.textContent);
        if (!isNaN(v)) update(v);
        valSpan.textContent = format(current);
    }
    valSpan.addEventListener("blur", exitEdit);
    valSpan.addEventListener("keydown", (e) => {
        if (valSpan.contentEditable !== "true") return;
        e.stopPropagation();
        if (e.key === "Enter") { e.preventDefault(); valSpan.blur(); }
        if (e.key === "Escape") {
            valSpan.contentEditable = "false";
            valSpan.style.userSelect = "none";
            valSpan.style.cursor = "ew-resize";
            valSpan.textContent = format(current);
        }
    });

    let dragging = false;
    let startX = 0;
    let startVal = 0;
    const pxPerStep = 4;

    valSpan.addEventListener("mousedown", (e) => {
        if (valSpan.contentEditable === "true") return;
        e.preventDefault();
        e.stopPropagation();
        dragging = true;
        didDrag = false;
        startX = e.clientX;
        startVal = current;
        valSpan.style.cursor = "grabbing";
    });

    window.addEventListener("mousemove", (e) => {
        if (!dragging) return;
        const deltaPx = e.clientX - startX;
        if (Math.abs(deltaPx) > 2) didDrag = true;
        const deltaSteps = Math.round(deltaPx / pxPerStep);
        const newVal = clamp(startVal + deltaSteps * step);
        if (newVal !== current) {
            current = newVal;
            valSpan.textContent = format(current);
        }
    });

    window.addEventListener("mouseup", () => {
        if (!dragging) return;
        dragging = false;
        valSpan.style.cursor = "ew-resize";
    });

    row.appendChild(minusBtn);
    row.appendChild(valSpan);
    row.appendChild(plusBtn);

    row.getValue = () => current;
    return row;
}

export function makeComfyValueSlider(value, min, max, step, onChange) {
    const row = document.createElement("div");
    css(row, "display:flex;align-items:center;background:#1a1a1a;border:1px solid #333;border-radius:6px;overflow:hidden;height:32px;cursor:ew-resize;");

    let current = parseFloat(value) || 0;
    const clamp = (v) => Math.min(max, Math.max(min, v));
    const format = (v) => Number.isInteger(step) ? String(v) : v.toFixed(step < 0.1 ? 2 : 1);
    current = clamp(current);

    const valSpan = document.createElement("span");
    valSpan.textContent = format(current);
    css(valSpan, "flex:1;text-align:center;font-size:13px;color:#ddd;font-variant-numeric:tabular-nums;user-select:none;height:32px;display:flex;align-items:center;justify-content:center;");

    function update(v) {
        current = clamp(v);
        valSpan.textContent = format(current);
        if (onChange) onChange(current);
    }

    valSpan.addEventListener("click", (e) => {
        e.stopPropagation();
        const input = document.createElement("input");
        input.type = "number";
        input.value = String(current);
        input.step = String(step);
        css(input, "flex:1;text-align:center;font-size:13px;color:#ddd;background:transparent;border:none;outline:none;height:32px;");
        valSpan.replaceWith(input);
        input.focus();
        input.select();
        function commit() {
            const v = parseFloat(input.value);
            if (!isNaN(v)) update(v);
            input.replaceWith(valSpan);
            valSpan.textContent = format(current);
        }
        input.addEventListener("blur", commit);
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") { e.preventDefault(); commit(); }
            if (e.key === "Escape") { input.replaceWith(valSpan); valSpan.textContent = format(current); }
        });
    });

    let dragging = false;
    let startX = 0;
    let startVal = 0;
    const pxPerStep = 4;

    row.addEventListener("mousedown", (e) => {
        if (e.target === valSpan) return;
        e.preventDefault();
        dragging = true;
        startX = e.clientX;
        startVal = current;
        row.style.cursor = "grabbing";
    });

    valSpan.addEventListener("mousedown", (e) => {
        e.preventDefault();
        dragging = true;
        startX = e.clientX;
        startVal = current;
        row.style.cursor = "grabbing";
    });

    window.addEventListener("mousemove", (e) => {
        if (!dragging) return;
        const deltaPx = e.clientX - startX;
        const deltaSteps = Math.round(deltaPx / pxPerStep);
        const newVal = clamp(startVal + deltaSteps * step);
        if (newVal !== current) {
            current = newVal;
            valSpan.textContent = format(current);
        }
    });

    window.addEventListener("mouseup", () => {
        if (!dragging) return;
        dragging = false;
        row.style.cursor = "ew-resize";
    });

    row.appendChild(valSpan);
    row.getValue = () => current;
    row.update = update;
    return row;
}

export function makeSmallValueSlider(value, min, max, step, onChange) {
    const row = document.createElement("div");
    css(row, "display:flex;align-items:center;background:#1a1a1a;border:1px solid #333;border-radius:4px;overflow:hidden;height:22px;cursor:ew-resize;");

    let current = parseFloat(value) || 0;
    const clamp = (v) => Math.min(max, Math.max(min, v));
    const format = (v) => Number.isInteger(step) ? String(v) : v.toFixed(step < 0.1 ? 2 : 1);
    current = clamp(current);

    const valSpan = document.createElement("span");
    valSpan.textContent = format(current);
    css(valSpan, "flex:1;text-align:center;font-size:10px;color:#ddd;font-variant-numeric:tabular-nums;user-select:none;height:22px;display:flex;align-items:center;justify-content:center;");

    function update(v) {
        current = clamp(v);
        valSpan.textContent = format(current);
        if (onChange) onChange(current);
    }

    valSpan.addEventListener("click", (e) => {
        e.stopPropagation();
        const input = document.createElement("input");
        input.type = "number";
        input.value = String(current);
        input.step = String(step);
        css(input, "flex:1;text-align:center;font-size:10px;color:#ddd;background:transparent;border:none;outline:none;height:22px;");
        valSpan.replaceWith(input);
        input.focus();
        input.select();
        function commit() {
            const v = parseFloat(input.value);
            if (!isNaN(v)) update(v);
            input.replaceWith(valSpan);
            valSpan.textContent = format(current);
        }
        input.addEventListener("blur", commit);
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") { e.preventDefault(); commit(); }
            if (e.key === "Escape") { input.replaceWith(valSpan); valSpan.textContent = format(current); }
        });
    });

    let dragging = false;
    let startX = 0;
    let startVal = 0;
    const pxPerStep = 4;

    row.addEventListener("mousedown", (e) => {
        if (e.target === valSpan) return;
        e.preventDefault();
        dragging = true;
        startX = e.clientX;
        startVal = current;
        row.style.cursor = "grabbing";
    });

    valSpan.addEventListener("mousedown", (e) => {
        e.preventDefault();
        dragging = true;
        startX = e.clientX;
        startVal = current;
        row.style.cursor = "grabbing";
    });

    window.addEventListener("mousemove", (e) => {
        if (!dragging) return;
        const deltaPx = e.clientX - startX;
        const deltaSteps = Math.round(deltaPx / pxPerStep);
        const newVal = clamp(startVal + deltaSteps * step);
        if (newVal !== current) {
            current = newVal;
            valSpan.textContent = format(current);
        }
    });

    window.addEventListener("mouseup", () => {
        if (!dragging) return;
        dragging = false;
        row.style.cursor = "ew-resize";
    });

    row.appendChild(valSpan);
    row.getValue = () => current;
    row.update = update;
    return row;
}

// ---------- Shared grid item helpers ----------

export const TYPE_COLORS = {
    Style: "#8a6acf", Slider: "#6a9acf", Character: "#6acf8a",
    Pose: "#cf8a6a", Concept: "#6acfcf", Other: "#cf6a8a",
};

export function svgIcon(d, w = 14) {
    const tpl = document.createElement("template");
    tpl.innerHTML = `<svg width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
    return tpl.content.firstChild;
}

const HOVER_BTN_SIZE = 26;
const HOVER_BTN_CSS = `width:${HOVER_BTN_SIZE}px;height:${HOVER_BTN_SIZE}px;padding:0;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.92);color:#222;border:none;border-radius:4px;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,0.5);overflow:hidden;line-height:1;box-sizing:border-box;`;

export function makeGridItemOverlay({
    block,
    showHoverButtons = true,
    buttons = [],
    showTriangle = false,
}) {
    const overlay = document.createElement("div");
    css(overlay, "position:absolute;inset:0;background:rgba(0,0,0,0.45);pointer-events:none;z-index:0;border-radius:3px;");
    block.appendChild(overlay);

    let hoverWrap = null;
    if (showHoverButtons && buttons.length > 0) {
        hoverWrap = document.createElement("div");
        css(hoverWrap, "position:absolute;inset:0;display:none;align-items:center;justify-content:center;gap:4px;z-index:3;background:rgba(0,0,0,0.35);border-radius:3px;padding:4px;box-sizing:border-box;");
        for (const btn of buttons) {
            hoverWrap.appendChild(btn);
        }
        block.appendChild(hoverWrap);
        block.addEventListener("mouseenter", () => { hoverWrap.style.display = "flex"; });
        block.addEventListener("mouseleave", () => { hoverWrap.style.display = "none"; });
    }

    let triangleBtn = null;
    if (showTriangle) {
        triangleBtn = document.createElement("button");
        triangleBtn.innerHTML = "&#9662;";
        const triSize = Math.round(18 * 1.3);
        css(triangleBtn, `position:absolute;bottom:3px;left:50%;transform:translateX(-50%);background:transparent;color:#fff;border:none;padding:0;font-size:${triSize}px;line-height:1;cursor:pointer;z-index:4;opacity:0;pointer-events:auto;`);
        triangleBtn.addEventListener("click", (e) => { e.stopPropagation(); });
        triangleBtn.addEventListener("dblclick", (e) => e.stopPropagation());
        triangleBtn.addEventListener("mousedown", (e) => e.stopPropagation());
        block.appendChild(triangleBtn);
        block.addEventListener("mouseenter", () => { triangleBtn.style.opacity = "1"; });
        block.addEventListener("mouseleave", () => { triangleBtn.style.opacity = "0"; });
    }

    return { overlay, hoverWrap, triangleBtn };
}

export function makeHoverButton({ svg, title, onClick }) {
    const btn = document.createElement("button");
    btn.title = title;
    btn.appendChild(svgIcon(svg));
    css(btn, HOVER_BTN_CSS);
    btn.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
    return btn;
}

export function makeTypeRibbon(entry, isBypassed, onToggleBypass, idx) {
    const typeTag = entry.flake_type || "Other";
    const color = TYPE_COLORS[typeTag] || TYPE_COLORS.Other;
    const ribbon = document.createElement("div");
    ribbon.textContent = typeTag[0];
    ribbon.title = isBypassed ? `${typeTag} (click to activate)` : `${typeTag} (click to bypass)`;
    const bgColor = isBypassed ? "#555" : color;
    css(ribbon, `position:absolute;top:0;left:0;width:16px;height:16px;background:${bgColor};color:#fff;font-size:9px;font-weight:700;display:flex;align-items:center;justify-content:center;border-radius:4px 0 4px 0;z-index:5;text-shadow:none;cursor:pointer;transition:opacity 0.15s;`);
    ribbon.addEventListener("mouseenter", () => { ribbon.style.opacity = "0.8"; });
    ribbon.addEventListener("mouseleave", () => { ribbon.style.opacity = "1"; });
    if (onToggleBypass) {
        ribbon.addEventListener("click", (e) => { e.stopPropagation(); onToggleBypass(idx); });
    }
    return ribbon;
}

// Format a flake's selected variant choices as a " (Choice, Choice)" suffix.
// Returns "" when no variant choice is selected.
export function variantSuffix(entry) {
    const variant = entry?.variant;
    if (!variant || typeof variant !== "object") return "";
    const choices = Object.values(variant).filter(v => v != null && v !== "");
    return choices.length ? ` (${choices.join(", ")})` : "";
}

export function makeBypassStrike() {
    const strike = document.createElement("div");
    css(strike, "position:absolute;top:50%;left:10%;right:10%;height:2.5px;background:rgba(230,90,90,0.85);transform:translateY(-50%) rotate(-30deg);z-index:4;pointer-events:none;");
    return strike;
}

// Long-press ("hold") a combo activation checkbox to "single out": activate
// only this item and deactivate every other one. A normal click still toggles
// just this item. Used by Flake Combo and Flake Model Combo (#281).
export function attachHoldToSingleOut(checkbox, onSingleOut, holdMs = 450) {
    let timer = null;
    let didHold = false;
    const start = (e) => {
        if (e.button != null && e.button !== 0) return;
        didHold = false;
        timer = setTimeout(() => {
            timer = null;
            didHold = true;
            onSingleOut();
        }, holdMs);
    };
    const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
    checkbox.addEventListener("mousedown", start);
    checkbox.addEventListener("mouseup", cancel);
    checkbox.addEventListener("mouseleave", cancel);
    // After a hold has fired, swallow the click/change that the release would
    // otherwise produce so the normal single-item toggle does not also run.
    checkbox.addEventListener("click", (e) => {
        if (didHold) { e.preventDefault(); e.stopPropagation(); }
    }, true);
    checkbox.addEventListener("change", (e) => {
        if (didHold) { e.stopPropagation(); didHold = false; }
    }, true);
}

// Cached sampler/scheduler option lists from the backend (Advanced KSampler
// parity, #285). Shared by the model-preset override panel (#279).
let _samplerListCache = null;
export async function fetchSamplerLists() {
    if (_samplerListCache) return _samplerListCache;
    try {
        const r = await fetch("/flakes/samplers");
        const d = await r.json();
        _samplerListCache = { samplers: d.samplers || [], schedulers: d.schedulers || [] };
    } catch {
        _samplerListCache = { samplers: [], schedulers: [] };
    }
    return _samplerListCache;
}

// Serialize a model-preset override object to the JSON consumed by the backend
// `overrides_json` widget (#279). Drops empty fields so the preset's own values
// pass through. Returns "" when there are no overrides.
export function serializeModelOverrides(ovr) {
    if (!ovr || typeof ovr !== "object") return "";
    const out = {};
    if (ovr.filename_prefix) out.filename_prefix = ovr.filename_prefix;
    if (ovr.steps != null && ovr.steps !== "") out.steps = ovr.steps;
    if (ovr.cfg != null && ovr.cfg !== "") out.cfg = ovr.cfg;
    if (ovr.sampler) out.sampler = ovr.sampler;
    if (ovr.scheduler) out.scheduler = ovr.scheduler;
    return Object.keys(out).length ? JSON.stringify(out) : "";
}

// Build a per-instance override panel for a model preset (#279): Filename
// Prefix, Steps, CFG, Sampler, Scheduler. Mutates the passed `overrides`
// object in place and calls `onChange` on every edit. Empty fields mean
// "use the preset's value".
export function makeModelOverridePanel(overrides, onChange) {
    const col = document.createElement("div");
    css(col, "width:180px;padding:6px;display:flex;flex-direction:column;gap:3px;box-sizing:border-box;");
    const inputCss = "width:100%;box-sizing:border-box;background:#1a1a1a;color:#ddd;border:1px solid #333;padding:2px 4px;border-radius:3px;font-size:10px;outline:none;";
    const label = (text) => {
        const l = document.createElement("div");
        l.textContent = text;
        css(l, "font-size:9px;opacity:0.7;text-align:center;");
        col.appendChild(l);
    };

    label("Filename Prefix");
    const fp = document.createElement("input");
    fp.type = "text";
    fp.value = overrides.filename_prefix || "";
    fp.placeholder = "(preset default)";
    css(fp, inputCss);
    fp.addEventListener("input", () => { overrides.filename_prefix = fp.value || ""; onChange(); });
    col.appendChild(fp);

    const numField = (text, key, step) => {
        label(text);
        const inp = document.createElement("input");
        inp.type = "number";
        inp.step = step;
        inp.value = overrides[key] ?? "";
        inp.placeholder = "default";
        css(inp, inputCss);
        inp.addEventListener("input", () => { overrides[key] = inp.value === "" ? null : inp.value; onChange(); });
        col.appendChild(inp);
    };
    numField("Steps", "steps", "1");
    numField("CFG", "cfg", "0.1");

    label("Sampler");
    const sampDD = makePanelDropdown([{ value: "", label: "(default)" }], overrides.sampler || "");
    sampDD.element.addEventListener("change", () => { overrides.sampler = sampDD.element.value || ""; onChange(); });
    col.appendChild(sampDD.container);

    label("Scheduler");
    const schedDD = makePanelDropdown([{ value: "", label: "(default)" }], overrides.scheduler || "");
    schedDD.element.addEventListener("change", () => { overrides.scheduler = schedDD.element.value || ""; onChange(); });
    col.appendChild(schedDD.container);

    fetchSamplerLists().then(({ samplers, schedulers }) => {
        for (const s of samplers) {
            const o = document.createElement("option");
            o.value = s; o.textContent = s;
            if (s === overrides.sampler) o.selected = true;
            sampDD.element.appendChild(o);
        }
        for (const s of schedulers) {
            const o = document.createElement("option");
            o.value = s; o.textContent = s;
            if (s === overrides.scheduler) o.selected = true;
            schedDD.element.appendChild(o);
        }
    });

    return col;
}

// ---------- Drag indicator helpers ----------

export function _showDropIndicator(block) {
    let indicator = block.querySelector(".flake-drop-indicator");
    if (!indicator) {
        indicator = document.createElement("div");
        indicator.className = "flake-drop-indicator";
        css(indicator, "position:absolute;left:-3px;top:0;bottom:0;width:2px;background:#2a6acf;border-radius:1px;z-index:10;pointer-events:none;");
        block.appendChild(indicator);
    }
}

export function _hideDropIndicator(block) {
    const indicator = block.querySelector(".flake-drop-indicator");
    if (indicator) indicator.remove();
}

export function _hideAllDropIndicators() {
    for (const ind of document.querySelectorAll(".flake-drop-indicator")) {
        ind.remove();
    }
}

export function makeAddBlock({ onNew, onLoad, addLabel = "Add flake", newLabel = "+ New flake", loadLabel = "↑ Load flake" }) {
    const block = document.createElement("div");
    css(block, `position:relative;height:80px;background:#2a2a2a;border:1px dashed #555;border-radius:4px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;cursor:pointer;font-size:11px;color:#999;user-select:none;box-sizing:border-box;`);

    const icon = document.createElement("div");
    css(icon, "font-size:20px;font-weight:300;color:#666;line-height:1;");
    icon.textContent = "+";
    block.appendChild(icon);

    const label = document.createElement("div");
    css(label, "font-size:9px;text-align:center;");
    label.textContent = addLabel;
    block.appendChild(label);

    const menu = document.createElement("div");
    css(menu, "position:absolute;top:100%;left:0;right:0;background:#1e1e1e;border:1px solid #444;border-radius:4px;display:none;flex-direction:column;padding:2px;z-index:100;box-shadow:0 4px 12px rgba(0,0,0,0.5);margin-top:2px;");

    const newBtn = document.createElement("button");
    newBtn.textContent = newLabel;
    css(newBtn, "width:100%;padding:6px 8px;background:#2a2a2a;color:#ddd;border:1px solid #444;border-radius:3px;cursor:pointer;font-size:12px;text-align:left;margin-bottom:2px;");
    const loadBtn = document.createElement("button");
    loadBtn.textContent = loadLabel;
    css(loadBtn, "width:100%;padding:6px 8px;background:#2a2a2a;color:#ddd;border:1px solid #444;border-radius:3px;cursor:pointer;font-size:12px;text-align:left;");

    menu.appendChild(newBtn);
    menu.appendChild(loadBtn);
    block.appendChild(menu);

    let hideHandler = null;

    function showMenu() {
        menu.style.display = "flex";
        if (!hideHandler) {
            hideHandler = (e) => {
                if (!block.contains(e.target)) hideMenu();
            };
            document.addEventListener("click", hideHandler);
        }
    }

    function hideMenu() {
        menu.style.display = "none";
        if (hideHandler) {
            document.removeEventListener("click", hideHandler);
            hideHandler = null;
        }
    }

    block.addEventListener("click", (e) => {
        e.stopPropagation();
        menu.style.display === "flex" ? hideMenu() : showMenu();
    });

    menu.addEventListener("click", (e) => e.stopPropagation());

    newBtn.addEventListener("click", () => {
        hideMenu();
        onNew();
    });

    loadBtn.addEventListener("click", () => {
        hideMenu();
        onLoad();
    });

    block.addEventListener("dragover", (e) => e.preventDefault());
    block.addEventListener("drop", (e) => e.preventDefault());

    return block;
}
