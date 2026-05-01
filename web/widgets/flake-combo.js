import { css, makeAddBlock } from "../utils.js";
import { fetchList, fetchFlake, getCoverUrl } from "../api.js";
import { openEditModal } from "../flake-modal.js";
import { openFileLoadPicker } from "../pickers.js";

function makeComboBlock({ entry, idx, isActive, onActivate, onRemove }) {
    const hasCover = !!entry.name;
    const block = document.createElement("div");
    block.dataset.idx = String(idx);

    css(block, `position:relative;height:80px;background:${
        isActive ? "#2a4a3a" : "#2a2a2a"
    };border:2px solid ${
        isActive ? "#3a8a5a" : "#444"
    };border-radius:4px;cursor:pointer;font-size:11px;color:#ddd;user-select:none;box-sizing:border-box;${
        hasCover ? `background-image:url(${getCoverUrl(entry.name)});background-size:cover;background-position:center;` : ""
    }`);

    if (hasCover) {
        const overlay = document.createElement("div");
        css(overlay, "position:absolute;inset:0;background:rgba(0,0,0,0.45);pointer-events:none;z-index:0;");
        block.appendChild(overlay);
    }

    const fullName = entry.display_name || entry.name || "(missing)";
    const shortName = fullName.split(/[\/\\ _\-]+/).pop() || fullName;
    const nameEl = document.createElement("div");
    nameEl.title = fullName;
    css(nameEl, "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:500;text-align:center;line-height:1.2;text-shadow:0 1px 3px rgba(0,0,0,0.8);padding:0 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;z-index:1;");
    nameEl.textContent = shortName;
    block.appendChild(nameEl);

    if (isActive) {
        const check = document.createElement("div");
        check.textContent = "\u2713";
        css(check, "position:absolute;top:2px;left:2px;width:16px;height:16px;line-height:14px;text-align:center;font-size:10px;background:rgba(58,138,90,0.8);color:#fff;border-radius:2px;z-index:2;");
        block.appendChild(check);
    }

    const rm = document.createElement("button");
    rm.textContent = "\u2715";
    rm.title = "Remove from combo";
    css(rm, "position:absolute;top:2px;right:2px;width:16px;height:16px;line-height:14px;text-align:center;font-size:10px;background:rgba(0,0,0,0.5);color:#ddd;border:1px solid #555;border-radius:2px;cursor:pointer;padding:0;z-index:2;");
    rm.addEventListener("click", (e) => { e.stopPropagation(); onRemove(idx); });
    block.appendChild(rm);

    block.addEventListener("click", () => onActivate(idx));

    return block;
}

export function setupFlakeComboWidget(node) {
    const flakesHidden = node.widgets?.find(w => w.name === "flakes_json");
    if (!flakesHidden) return;

    flakesHidden.computeSize = () => [0, -4];
    flakesHidden.type = "hidden";
    flakesHidden.hidden = true;
    if (flakesHidden.element) { flakesHidden.element.remove(); flakesHidden.element = null; }
    if (flakesHidden.inputEl) { flakesHidden.inputEl.remove(); flakesHidden.inputEl = null; }

    if (!node.properties) node.properties = {};
    if (!node.properties._combo_flakes) node.properties._combo_flakes = [];
    if (node.properties._combo_active_index == null) node.properties._combo_active_index = 0;

    function readAllFlakes() {
        const flakes = node.properties._combo_flakes || [];
        for (const entry of flakes) {
            if (!entry.loras && entry.strength != null) {
                entry.loras = [entry.strength];
            }
            if (!entry.loras) entry.loras = [];
        }
        return flakes;
    }
    function writeAllFlakes(flakes) {
        node.properties._combo_flakes = flakes;
        updateActiveFlake();
    }
    function updateActiveFlake() {
        const flakes = readAllFlakes();
        const idx = node.properties._combo_active_index || 0;
        const active = flakes[idx] || null;
        flakesHidden.value = JSON.stringify(active ? [active] : []);
    }

    const container = document.createElement("div");
    css(container, "display:flex;flex-direction:column;gap:2px;padding:0 6px 3px 6px;font-size:12px;color:#ddd;");

    const grid = document.createElement("div");
    css(grid, "display:grid;grid-template-columns:repeat(auto-fill, minmax(72px, 1fr));gap:4px;");
    container.appendChild(grid);

    function render() {
        const flakes = readAllFlakes();
        const activeIdx = node.properties._combo_active_index || 0;
        grid.replaceChildren();

        for (let i = 0; i < flakes.length; i++) {
            const blk = makeComboBlock({
                entry: flakes[i],
                idx: i,
                isActive: i === activeIdx,
                onActivate: (idx) => {
                    node.properties._combo_active_index = idx;
                    updateActiveFlake();
                    render();
                },
                onRemove: (idx) => {
                    const arr = readAllFlakes();
                    arr.splice(idx, 1);
                    if (node.properties._combo_active_index >= arr.length) {
                        node.properties._combo_active_index = Math.max(0, arr.length - 1);
                    }
                    writeAllFlakes(arr);
                    render();
                },
            });
            grid.appendChild(blk);
        }

        if (grid._addBlock) grid.appendChild(grid._addBlock);
    }

    async function handleNew() {
        const { directories } = await fetchList();
        const result = await openEditModal({
            mode: "create",
            data: {},
            dirs: directories,
        });
        if (!result || !result.created) return;
        const arr = readAllFlakes();
        let has_lora = false;
        let display_name = null;
        let loras = [];
        if (result.data && (result.data.path || (result.data.loras && result.data.loras.length > 0))) has_lora = true;
        else if (result.name) {
            try { const d = await fetchFlake(result.name); has_lora = !!(d && (d.path || (d.loras && d.loras.length > 0))); } catch {}
        }
        if (result.data && result.data.name) display_name = result.data.name;
        else if (result.name) {
            try { const d = await fetchFlake(result.name); display_name = d.name || null; } catch {}
        }
        if (result.data && result.data.loras) {
            loras = result.data.loras.map(l => l.strength ?? 1.0);
        } else if (result.data && result.data.path) {
            loras = [result.data.strength ?? 1.0];
        } else if (result.name) {
            try {
                const d = await fetchFlake(result.name);
                if (d.loras) loras = d.loras.map(l => l.strength ?? 1.0);
                else if (d.path) loras = [d.strength ?? 1.0];
            } catch {}
        }
        arr.push({ name: result.name, loras, option: {}, has_lora, display_name });
        writeAllFlakes(arr);
        render();
    }

    async function handleLoad() {
        const { flakes, directories } = await fetchList();
        const result = await openFileLoadPicker({ flakes, directories });
        if (!result || !result.name) return;
        const arr = readAllFlakes();
        let has_lora = false;
        let display_name = null;
        let loras = [];
        try {
            const d = await fetchFlake(result.name);
            has_lora = !!(d && (d.path || (d.loras && d.loras.length > 0)));
            display_name = d.name || null;
            if (d.loras) loras = d.loras.map(l => l.strength ?? 1.0);
            else if (d.path) loras = [d.strength ?? 1.0];
        } catch {}
        arr.push({ name: result.name, loras, option: {}, has_lora, display_name });
        writeAllFlakes(arr);
        render();
    }

    grid._addBlock = makeAddBlock({ onNew: handleNew, onLoad: handleLoad });

    node._combo_render = render;
    const comboWidget = node.addDOMWidget("combo_ui", "div", container, { serialize: false, margin: 4 });
    comboWidget.computeSize = () => {
        const rows = Math.max(1, Math.ceil((readAllFlakes().length + 1) / 2));
        return [node.size[0], rows * 84 + 31];
    };
    updateActiveFlake();
    render();
}
