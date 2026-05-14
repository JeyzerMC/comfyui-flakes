import { css } from "../utils.js";

export const CATEGORIES = ["Models", "Prompts", "Parameters", "Metadata"];

export const CATEGORY_STYLE = {
    Models: { icon: "\uD83D\uDCBB", color: "#4a9eff" },
    Prompts: { icon: "\uD83D\uDCDD", color: "#4aff9e" },
    Parameters: { icon: "\u2699\uFE0F", color: "#ff9e4a" },
    Metadata: { icon: "\uD83D\uDCCB", color: "#9e4aff" },
};

export function makeOverlay(container, category, data) {
    const existing = container.querySelector(".flake-preview-overlay");
    if (existing) existing.remove();

    const info = CATEGORY_STYLE[category];
    const entries = Object.entries(data);
    const accent = info.color;

    const overlay = document.createElement("div");
    css(overlay, "position:absolute;inset:0;background:rgba(0,0,0,0.92);z-index:100;display:flex;flex-direction:column;padding:10px;box-sizing:border-box;overflow-y:auto;");

    const header = document.createElement("div");
    css(header, "display:flex;align-items:center;gap:6px;margin-bottom:8px;flex-shrink:0;");
    const iconEl = document.createElement("span");
    iconEl.textContent = info.icon;
    iconEl.style.fontSize = "15px";
    header.appendChild(iconEl);
    const titleEl = document.createElement("span");
    titleEl.textContent = category;
    css(titleEl, `font-size:13px;font-weight:600;color:${accent};`);
    header.appendChild(titleEl);
    const closeBtn = document.createElement("button");
    closeBtn.textContent = "\u2715";
    css(closeBtn, "margin-left:auto;background:none;border:1px solid #555;color:#aaa;width:22px;height:22px;border-radius:4px;cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center;padding:0;line-height:1;");
    closeBtn.addEventListener("click", (e) => { e.stopPropagation(); overlay.remove(); });
    header.appendChild(closeBtn);
    overlay.appendChild(header);

    if (entries.length === 0) {
        const empty = document.createElement("div");
        css(empty, "font-size:11px;color:#555;text-align:center;padding:20px;");
        empty.textContent = "No data available";
        overlay.appendChild(empty);
    } else {
        const list = document.createElement("div");
        css(list, "display:flex;flex-direction:column;gap:4px;");
        for (const [key, value] of entries) {
            const row = document.createElement("div");
            css(row, `background:#1e1e1e;border:1px solid #333;border-radius:4px;padding:5px 7px;`);
            const keyEl = document.createElement("div");
            keyEl.textContent = key;
            css(keyEl, `font-size:10px;color:${accent};font-weight:600;`);
            row.appendChild(keyEl);
            const valEl = document.createElement("div");
            const valStr = typeof value === "string" ? value : String(value);
            valEl.textContent = valStr;
            css(valEl, "font-size:11px;color:#ddd;word-break:break-word;white-space:pre-wrap;max-height:120px;overflow-y:auto;");
            row.appendChild(valEl);
            list.appendChild(row);
        }
        overlay.appendChild(list);
    }

    overlay.addEventListener("click", (e) => {
        if (e.target === overlay) overlay.remove();
    });

    container.style.position = "relative";
    container.appendChild(overlay);
}

export function makeButton(category, info, hasData, onClick) {
    const btn = document.createElement("div");
    const accent = info.color;
    const disabledStyle = hasData ? "" : "opacity:0.35;cursor:default;";
    css(btn, `position:relative;background:#222;border:1px solid ${hasData ? accent + "44" : "#333"};border-radius:8px;padding:8px 6px;cursor:${hasData ? "pointer" : "default"};transition:border-color 0.15s,background 0.15s;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;min-height:54px;box-sizing:border-box;${disabledStyle}`);

    if (hasData) {
        btn.addEventListener("mouseenter", () => {
            btn.style.borderColor = accent;
            btn.style.background = "#282828";
        });
        btn.addEventListener("mouseleave", () => {
            btn.style.borderColor = accent + "44";
            btn.style.background = "#222";
        });
    }

    const iconSpan = document.createElement("span");
    iconSpan.textContent = info.icon;
    iconSpan.style.fontSize = "16px";
    btn.appendChild(iconSpan);

    const label = document.createElement("span");
    label.textContent = category;
    css(label, `font-size:11px;font-weight:600;color:${hasData ? accent : "#666"};`);
    btn.appendChild(label);

    if (hasData) {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            onClick(category);
        });
    }

    return btn;
}

export function setupPreviewFlakeDataWidget(node) {
    if (!node.properties) node.properties = {};
    node.properties._preview_data = null;

    const container = document.createElement("div");
    css(container, "position:relative;display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:6px;font-size:12px;color:#ddd;min-height:130px;");

    let currentData = null;

    function render(previewData) {
        container.replaceChildren();
        for (const cat of CATEGORIES) {
            const info = CATEGORY_STYLE[cat];
            const data = previewData ? (previewData[cat] || {}) : {};
            const hasData = previewData && Object.keys(data).length > 0;
            const btn = makeButton(cat, info, hasData, (category) => {
                const catData = currentData ? (currentData[category] || {}) : {};
                makeOverlay(container, category, catData);
            });
            container.appendChild(btn);
        }
    }

    const origOnExecuted = node.onExecuted;
    node.onExecuted = function (output) {
        const r = origOnExecuted?.apply(this, arguments);
        if (output && output.preview_data) {
            currentData = output.preview_data;
            node.properties._preview_data = currentData;
            render(currentData);
        }
        return r;
    };

    const origOnConfigure = node.onConfigure;
    node.onConfigure = function () {
        const r = origOnConfigure?.apply(this, arguments);
        node._configured = true;
        if (node.properties?._preview_data) {
            currentData = node.properties._preview_data;
            render(currentData);
        } else {
            render(null);
        }
        return r;
    };

    node._preview_update = function () {
        if (currentData) {
            render(currentData);
        } else {
            render(null);
        }
    };

    const previewWidget = node.addDOMWidget("preview_ui", "div", container, { serialize: false, margin: 4 });
    previewWidget.computeSize = () => [node.size[0], 140];

    render(null);
}