import { css } from "../utils.js";
import { fetchPreset } from "../api.js";
import { openPresetEditModal, refreshPresetOptions } from "../preset-modal.js";
import { openPresetPicker } from "../pickers.js";

export function setupFlakeModelPresetWidget(node) {
    const presetWidget = node.widgets?.find(w => w.name === "preset");
    const familyWidget = node.widgets?.find(w => w.name === "model_family");
    if (!presetWidget) return;

    // Move hidden preset widget to end of widgets array
    const presetIdx = node.widgets.indexOf(presetWidget);
    if (presetIdx !== -1) {
        node.widgets.splice(presetIdx, 1);
        node.widgets.push(presetWidget);
    }
    presetWidget.computeSize = () => [0, 0];
    presetWidget.type = "hidden";
    presetWidget.hidden = true;
    if (presetWidget.element) presetWidget.element.style.display = "none";
    if (presetWidget.inputEl) presetWidget.inputEl.style.display = "none";

    function getFamily() {
        return familyWidget?.value || "SDXL/Base";
    }

    const container = document.createElement("div");
    css(container, "display:flex;flex-direction:column;align-items:center;gap:8px;padding:6px;");

    // ---- Unselected state: two buttons ----
    const buttonRow = document.createElement("div");
    css(buttonRow, "display:flex;gap:8px;align-items:center;justify-content:center;");

    const selectBtn = document.createElement("button");
    selectBtn.textContent = "Select Preset";
    css(selectBtn, "padding:6px 14px;cursor:pointer;border-radius:4px;font-size:11px;background:#2a2a2a;color:#999;border:1px dashed #555;transition:background 0.15s ease;");
    selectBtn.addEventListener("mouseenter", () => { selectBtn.style.background = "#333"; });
    selectBtn.addEventListener("mouseleave", () => { selectBtn.style.background = "#2a2a2a"; });
    selectBtn.addEventListener("click", async () => {
        const result = await openPresetPicker({ selected: presetWidget.value, family: getFamily() });
        if (result && result.name) {
            presetWidget.value = result.name;
            render();
        }
    });
    buttonRow.appendChild(selectBtn);

    const createBtn = document.createElement("button");
    createBtn.textContent = "Create Preset";
    css(createBtn, "padding:6px 14px;cursor:pointer;border-radius:4px;font-size:11px;background:#2a2a2a;color:#999;border:1px dashed #555;transition:background 0.15s ease;");
    createBtn.addEventListener("mouseenter", () => { createBtn.style.background = "#333"; });
    createBtn.addEventListener("mouseleave", () => { createBtn.style.background = "#2a2a2a"; });
    createBtn.addEventListener("click", async () => {
        const result = await openPresetEditModal({
            mode: "create",
            family: getFamily(),
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
        if (result && result.name) {
            presetWidget.value = result.name;
            await refreshPresetOptions(getFamily());
            render();
        }
    });
    buttonRow.appendChild(createBtn);
    container.appendChild(buttonRow);

    // ---- Selected state: image + label + hover buttons ----
    const selectedWrap = document.createElement("div");
    css(selectedWrap, "display:none;flex-direction:column;align-items:center;gap:4px;width:100%;position:relative;");

    const imgWrap = document.createElement("div");
    css(imgWrap, "position:relative;width:100%;max-width:200px;aspect-ratio:2/3;border-radius:6px;overflow:hidden;background:#1a1a1a;border:1px solid #444;cursor:pointer;");

    const coverImg = document.createElement("img");
    css(coverImg, "width:100%;height:100%;object-fit:cover;display:block;");
    imgWrap.appendChild(coverImg);

    // Hover buttons container (top-right)
    const hoverBtns = document.createElement("div");
    css(hoverBtns, "position:absolute;top:6px;right:6px;display:none;gap:6px;z-index:2;");

    const HOVER_BTN_STYLE = "width:36px;height:36px;padding:0;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.92);color:#222;border:none;border-radius:6px;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,0.4);transition:transform 0.12s ease, background 0.12s ease;";

    // Modify Preset button (edit icon, styled like Load Image edit button)
    const modifyBtn = document.createElement("button");
    modifyBtn.title = "Modify Preset";
    modifyBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
    css(modifyBtn, HOVER_BTN_STYLE);
    modifyBtn.addEventListener("mouseenter", () => { modifyBtn.style.background = "#fff"; modifyBtn.style.transform = "scale(1.08)"; });
    modifyBtn.addEventListener("mouseleave", () => { modifyBtn.style.background = "rgba(255,255,255,0.92)"; modifyBtn.style.transform = "scale(1)"; });
    modifyBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const current = presetWidget.value;
        if (!current) return;
        let data;
        try {
            data = await fetchPreset(current);
        } catch (err) {
            window.alert(`Failed to load preset '${current}': ${err.message || err}`);
            return;
        }
        const result = await openPresetEditModal({ mode: "edit", name: current, data });
        if (result) {
            await refreshPresetOptions();
            render();
        }
    });
    hoverBtns.appendChild(modifyBtn);

    // Remove Preset button (X in circle, styled like Load Image remove button)
    const removeBtn = document.createElement("button");
    removeBtn.title = "Remove Preset";
    removeBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>`;
    css(removeBtn, HOVER_BTN_STYLE);
    removeBtn.addEventListener("mouseenter", () => { removeBtn.style.background = "#fff"; removeBtn.style.transform = "scale(1.08)"; });
    removeBtn.addEventListener("mouseleave", () => { removeBtn.style.background = "rgba(255,255,255,0.92)"; removeBtn.style.transform = "scale(1)"; });
    removeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        presetWidget.value = "Select a preset...";
        render();
    });
    hoverBtns.appendChild(removeBtn);

    imgWrap.appendChild(hoverBtns);

    // Show/hide hover buttons on image hover
    imgWrap.addEventListener("mouseenter", () => { hoverBtns.style.display = "flex"; });
    imgWrap.addEventListener("mouseleave", () => { hoverBtns.style.display = "none"; });

    selectedWrap.appendChild(imgWrap);

    const nameLabel = document.createElement("div");
    css(nameLabel, "font-size:12px;color:#aaa;text-align:center;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:0 4px;");
    selectedWrap.appendChild(nameLabel);

    container.appendChild(selectedWrap);

    function render() {
        const val = presetWidget.value || "";
        const isPlaceholder = !val || val === "Select a preset..." || val === "No model preset is selected";
        if (isPlaceholder) {
            buttonRow.style.display = "flex";
            selectedWrap.style.display = "none";
        } else {
            buttonRow.style.display = "none";
            selectedWrap.style.display = "flex";
            coverImg.src = `/flakes/preset_cover?name=${encodeURIComponent(val)}`;
            nameLabel.textContent = val;
            nameLabel.title = val;
        }
    }

    coverImg.addEventListener("error", () => {
        coverImg.style.display = "none";
    });
    coverImg.addEventListener("load", () => {
        coverImg.style.display = "block";
    });

    const origOnConfigure = node.onConfigure;
    node.onConfigure = function () {
        const r = origOnConfigure?.apply(this, arguments);
        render();
        return r;
    };

    const origSetValue = presetWidget.setValue;
    presetWidget.setValue = function (v) {
        const r = origSetValue?.apply(this, arguments);
        render();
        return r;
    };

    let lastPresetValue = presetWidget.value;
    const presetPoll = setInterval(() => {
        if (presetWidget.value !== lastPresetValue) {
            lastPresetValue = presetWidget.value;
            render();
        }
    }, 200);

    // Hook into native family widget changes
    if (familyWidget) {
        const origCallback = familyWidget.callback;
        familyWidget.callback = function (value) {
            const r = origCallback?.apply(this, arguments);
            refreshPresetOptions(value);
            render();
            return r;
        };
    }

    node.addDOMWidget("preset_ui", "div", container, { serialize: false });
    render();

    const origOnRemoved = node.onRemoved;
    node.onRemoved = function () {
        clearInterval(presetPoll);
        return origOnRemoved?.apply(this, arguments);
    };

    node._preset_render = render;
}
