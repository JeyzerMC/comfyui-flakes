import { css } from "../utils.js";
import { openOverlay } from "../modal.js";

export const CATEGORIES = ["Models", "Inputs"];

export const CATEGORY_STYLE = {
    Models: { icon: "💻", color: "#4a9eff" },
    Inputs: { icon: "📝", color: "#4aff9e" },
};

export function makeOverlay(category, data) {
    const info = CATEGORY_STYLE[category] || { icon: "📋", color: "#aaa" };
    const entries = Object.entries(data);
    const accent = info.color;

    const { content, footer, close } = openOverlay();

    const header = document.createElement("div");
    css(header, "display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-shrink:0;padding-bottom:10px;border-bottom:1px solid #333;");
    const iconEl = document.createElement("span");
    iconEl.textContent = info.icon;
    iconEl.style.fontSize = "18px";
    header.appendChild(iconEl);
    const titleEl = document.createElement("span");
    titleEl.textContent = category;
    css(titleEl, `font-size:15px;font-weight:600;color:${accent};`);
    header.appendChild(titleEl);
    content.appendChild(header);

    if (entries.length === 0) {
        const empty = document.createElement("div");
        css(empty, "font-size:13px;color:#555;text-align:center;padding:40px;");
        empty.textContent = "No data available";
        content.appendChild(empty);
    } else {
        const list = document.createElement("div");
        css(list, "display:flex;flex-direction:column;gap:6px;");
        for (const [key, value] of entries) {
            const row = document.createElement("div");
            css(row, "background:#181818;border:1px solid #333;border-radius:6px;padding:8px 10px;");
            const keyEl = document.createElement("div");
            keyEl.textContent = key;
            css(keyEl, `font-size:11px;color:${accent};font-weight:600;margin-bottom:3px;`);
            row.appendChild(keyEl);
            const valEl = document.createElement("div");
            const valStr = typeof value === "string" ? value : String(value);
            valEl.textContent = valStr;
            css(valEl, "font-size:13px;color:#ddd;word-break:break-word;white-space:pre-wrap;");
            row.appendChild(valEl);
            list.appendChild(row);
        }
        content.appendChild(list);
    }

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "Close";
    css(closeBtn, "padding:6px 18px;background:#333;color:#ddd;border:1px solid #555;border-radius:6px;cursor:pointer;font-size:13px;");
    closeBtn.addEventListener("click", () => close());
    footer.appendChild(closeBtn);
}

export function makeButton(category, info, hasData, onClick) {
    const btn = document.createElement("div");
    const accent = info.color;
    css(btn, `position:relative;background:#222;border:1px solid ${hasData ? accent + "44" : "#333"};border-radius:8px;padding:8px 6px;cursor:${hasData ? "pointer" : "default"};transition:border-color 0.15s,background 0.15s;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;min-height:54px;box-sizing:border-box;${hasData ? "" : "opacity:0.35;"}`);

    if (hasData) {
        btn.addEventListener("mouseenter", () => {
            btn.style.borderColor = accent;
            btn.style.background = "#282828";
        });
        btn.addEventListener("mouseleave", () => {
            btn.style.borderColor = accent + "44";
            btn.style.background = "#222";
        });
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            onClick(category);
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

    return btn;
}

export function setupPreviewFlakeDataWidget(node) {
    if (!node.properties) node.properties = {};
    node.properties._preview_data = null;

    const container = document.createElement("div");
    css(container, "position:relative;display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:6px;font-size:12px;color:#ddd;min-height:80px;");

    let currentData = null;

    function render(previewData) {
        container.replaceChildren();
        for (const cat of CATEGORIES) {
            const info = CATEGORY_STYLE[cat];
            const data = previewData ? (previewData[cat] || {}) : {};
            const hasData = previewData && Object.keys(data).length > 0;
            const btn = makeButton(cat, info, hasData, (category) => {
                const catData = currentData ? (currentData[category] || {}) : {};
                makeOverlay(category, catData);
            });
            container.appendChild(btn);
        }
    }

    const origOnExecuted = node.onExecuted;
    node.onExecuted = function (output) {
        const r = origOnExecuted?.apply(this, arguments);
        let payload = output?.preview_data ?? output?.ui?.preview_data;
        if (Array.isArray(payload)) payload = payload[0];
        if (payload) {
            currentData = payload;
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
        render(currentData ?? null);
    };

    const previewWidget = node.addDOMWidget("preview_ui", "div", container, { serialize: false, margin: 4 });
    previewWidget.computeSize = () => [node.size[0], 88];

    render(null);
}
