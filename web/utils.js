// ---------- Default-flake helpers ----------

export function makeDefaultEntry() {
    return {
        inline: true,
        content: { options: {} },
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

    const el = document.createElement("input");
    el.type = "text";
    el.value = value;
    el.placeholder = placeholder;
    const listId = `sd-${Math.random().toString(36).slice(2,9)}`;
    el.setAttribute("list", listId);
    css(el, "background:#1a1a1a;color:#ddd;border:1px solid #333;padding:6px 8px;border-radius:6px;font-size:13px;width:100%;box-sizing:border-box;outline:none;");
    el.addEventListener("focus", () => { el.style.borderColor = "#555"; });
    el.addEventListener("blur", () => { el.style.borderColor = "#333"; });

    const datalist = document.createElement("datalist");
    datalist.id = listId;
    for (const item of items) {
        const o = document.createElement("option");
        o.value = item;
        datalist.appendChild(o);
    }

    wrap.appendChild(el);
    wrap.appendChild(datalist);
    return { element: el, datalist, container: wrap };
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
    css(minusBtn, "width:28px;height:32px;padding:0;background:transparent;color:#888;border:none;border-right:1px solid #333;cursor:pointer;font-size:14px;line-height:1;flex-shrink:0;transition:background 0.1s;");
    minusBtn.addEventListener("mouseenter", () => minusBtn.style.background = "#252525");
    minusBtn.addEventListener("mouseleave", () => minusBtn.style.background = "transparent");

    const valSpan = document.createElement("span");
    valSpan.textContent = format(current);
    css(valSpan, "flex:1;text-align:center;font-size:13px;color:#ddd;font-variant-numeric:tabular-nums;user-select:none;cursor:ew-resize;height:32px;display:flex;align-items:center;justify-content:center;");

    const plusBtn = document.createElement("button");
    plusBtn.textContent = "+";
    css(plusBtn, "width:28px;height:32px;padding:0;background:transparent;color:#888;border:none;border-left:1px solid #333;cursor:pointer;font-size:14px;line-height:1;flex-shrink:0;transition:background 0.1s;");
    plusBtn.addEventListener("mouseenter", () => plusBtn.style.background = "#252525");
    plusBtn.addEventListener("mouseleave", () => plusBtn.style.background = "transparent");

    function update(v) {
        current = clamp(v);
        valSpan.textContent = format(current);
    }

    minusBtn.addEventListener("click", () => update(current - step));
    plusBtn.addEventListener("click", () => update(current + step));

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
        input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } if (e.key === "Escape") { input.replaceWith(valSpan); valSpan.textContent = format(current); } });
    });

    let dragging = false;
    let startX = 0;
    let startVal = 0;
    const pxPerStep = 4;

    valSpan.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragging = true;
        startX = e.clientX;
        startVal = current;
        valSpan.style.cursor = "grabbing";
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

export function makeAddBlock({ onNew, onLoad }) {
    const block = document.createElement("div");
    css(block, `position:relative;height:80px;background:#2a2a2a;border:1px dashed #555;border-radius:4px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;cursor:pointer;font-size:11px;color:#999;user-select:none;box-sizing:border-box;`);

    const icon = document.createElement("div");
    css(icon, "font-size:20px;font-weight:300;color:#666;line-height:1;");
    icon.textContent = "+";
    block.appendChild(icon);

    const label = document.createElement("div");
    css(label, "font-size:9px;text-align:center;");
    label.textContent = "Add flake";
    block.appendChild(label);

    const menu = document.createElement("div");
    css(menu, "position:absolute;top:100%;left:0;right:0;background:#1e1e1e;border:1px solid #444;border-radius:4px;display:none;flex-direction:column;padding:2px;z-index:100;box-shadow:0 4px 12px rgba(0,0,0,0.5);margin-top:2px;");

    const newBtn = document.createElement("button");
    newBtn.textContent = "+ New flake";
    css(newBtn, "width:100%;padding:6px 8px;background:#2a2a2a;color:#ddd;border:1px solid #444;border-radius:3px;cursor:pointer;font-size:12px;text-align:left;margin-bottom:2px;");
    const loadBtn = document.createElement("button");
    loadBtn.textContent = "\u2191 Load existing";
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
