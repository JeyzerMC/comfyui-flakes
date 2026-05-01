import { css } from "./utils.js";

export function openOverlay() {
    const overlay = document.createElement("div");
    css(overlay, "position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,sans-serif;");
    const panel = document.createElement("div");
    css(panel, "background:#1e1e1e;color:#ddd;border:1px solid #2a2a2a;border-radius:12px;min-width:480px;max-width:720px;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,0.5);");

    const content = document.createElement("div");
    css(content, "flex:1;overflow:auto;padding:20px;display:flex;flex-direction:column;gap:4px;min-height:0;");

    const footer = document.createElement("div");
    css(footer, "flex-shrink:0;padding:12px 20px;border-top:1px solid #333;display:flex;gap:8px;justify-content:flex-end;");

    panel.appendChild(content);
    panel.appendChild(footer);
    overlay.appendChild(panel);

    const handlers = { onClose: null };
    function close(value) {
        document.body.removeChild(overlay);
        document.removeEventListener("keydown", onKey);
        handlers.onClose?.(value);
    }
    function onKey(e) { if (e.key === "Escape") close(undefined); }
    document.addEventListener("keydown", onKey);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(undefined); });

    document.body.appendChild(overlay);
    return { overlay, panel, content, footer, close, handlers };
}
