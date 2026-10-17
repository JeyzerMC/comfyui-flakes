import {
    css, makeSmallButton, makeComfyInput, makeComfyDropdown, makeSearchableDropdown,
    makeComfyNumberInput, makeComfyValueSlider, makeLabel, familyFolder,
} from "./utils.js";
import { fetchLoras, fetchFlake } from "./api.js";
import { openFileBrowser, openFileLoadPicker } from "./pickers.js";

// LoRA and flake-link list editors shared by the flake and model preset editors.

// Transient menu anchored under a ☰ handle. `items` is [{ label, onClick }].
export function openFieldMenu(anchorEl, items) {
    const menu = document.createElement("div");
    css(menu, "display:flex;flex-direction:column;gap:2px;background:#1e1e1e;border:1px solid #444;border-radius:4px;padding:4px;box-shadow:0 4px 12px rgba(0,0,0,0.5);position:fixed;z-index:10000;");
    function cleanup() {
        document.removeEventListener("click", onOutside, true);
        if (menu.parentElement) menu.remove();
    }
    function onOutside(e) {
        if (!menu.contains(e.target) && e.target !== anchorEl) cleanup();
    }
    for (const o of items) {
        const it = document.createElement("button");
        it.textContent = o.label;
        css(it, "text-align:left;padding:4px 8px;background:#2a2a2a;color:#ddd;border:1px solid #444;border-radius:3px;cursor:pointer;font-size:12px;");
        it.addEventListener("click", (e) => { e.stopPropagation(); cleanup(); o.onClick(); });
        menu.appendChild(it);
    }
    document.body.appendChild(menu);
    const rect = anchorEl.getBoundingClientRect();
    menu.style.left = `${rect.left}px`;
    menu.style.top = `${rect.bottom + 4}px`;
    // Defer so the opening click doesn't immediately close it.
    setTimeout(() => document.addEventListener("click", onOutside, true), 0);
}

// ☰ handle for a schedulable card (LoRA / prompt / flake link, #372).
export function makeScheduleHandle(entry, rerender) {
    const handle = document.createElement("span");
    handle.textContent = "☰";
    css(handle, "cursor:pointer;color:#666;font-size:12px;user-select:none;");
    handle.title = "Options";
    handle.addEventListener("click", (e) => {
        e.stopPropagation();
        openFieldMenu(handle, [scheduleMenuItem(entry, rerender)]);
    });
    return handle;
}

function scheduleMenuItem(entry, rerender) {
    if (entry.schedule) {
        return { label: "Remove Hook Scheduler", onClick: () => { delete entry.schedule; rerender(); } };
    }
    return {
        label: "Add Hook Scheduler",
        onClick: () => { entry.schedule = [{ start: 0.0, strength: 1.0 }, { start: 0.5, strength: 0.0 }]; rerender(); },
    };
}

// Keyframe editor for `entry.schedule` (#372): a 0-100% timeline showing the
// strength of each segment plus Start % / Strength rows. Start is stored as a
// fraction; strength holds until the next keyframe and is 1.0 before the first.
export function makeSchedulePanel(entry) {
    const panel = document.createElement("div");
    css(panel, "display:flex;flex-direction:column;gap:4px;background:#1e1e1e;border:1px solid #333;border-radius:4px;padding:6px;");
    const fmt = (v) => String(Math.round(v * 100) / 100);
    function draw() {
        panel.replaceChildren();
        const kfs = entry.schedule;
        kfs.sort((a, b) => a.start - b.start);
        const maxStrength = Math.max(1, ...kfs.map(k => k.strength));
        const bar = document.createElement("div");
        css(bar, "position:relative;height:18px;background:#141414;border:1px solid #333;border-radius:3px;overflow:hidden;");
        const segments = [{ start: 0, strength: 1.0 }, ...kfs];
        segments.forEach((k, i) => {
            const end = i + 1 < segments.length ? segments[i + 1].start : 1;
            if (end <= k.start) return;
            const seg = document.createElement("div");
            const alpha = 0.15 + 0.75 * Math.min(1, k.strength / maxStrength);
            css(seg, `position:absolute;top:0;bottom:0;left:${k.start * 100}%;width:${(end - k.start) * 100}%;background:rgba(74,158,255,${k.strength > 0 ? alpha : 0});border-left:1px solid #444;box-sizing:border-box;font-size:10px;color:#ddd;display:flex;align-items:center;justify-content:center;overflow:hidden;white-space:nowrap;`);
            seg.textContent = fmt(k.strength);
            seg.title = `${fmt(k.start * 100)}% – ${fmt(end * 100)}%: strength ${fmt(k.strength)}`;
            bar.appendChild(seg);
        });
        panel.appendChild(bar);

        kfs.forEach((k, i) => {
            const row = document.createElement("div");
            css(row, "display:flex;gap:6px;align-items:center;");
            const startLbl = document.createElement("span");
            startLbl.textContent = "Start %";
            css(startLbl, "font-size:11px;color:#888;white-space:nowrap;");
            row.appendChild(startLbl);
            const startIn = makeComfyNumberInput(fmt(k.start * 100), "0", 1);
            startIn.min = "0";
            startIn.max = "100";
            css(startIn, startIn.style.cssText + "flex:1;min-width:0;padding:3px 6px;font-size:12px;");
            startIn.addEventListener("change", () => {
                const v = parseFloat(startIn.value);
                k.start = Number.isFinite(v) ? Math.min(100, Math.max(0, v)) / 100 : k.start;
                draw();
            });
            row.appendChild(startIn);
            const strLbl = document.createElement("span");
            strLbl.textContent = "Strength";
            css(strLbl, "font-size:11px;color:#888;white-space:nowrap;");
            row.appendChild(strLbl);
            const strIn = makeComfyNumberInput(fmt(k.strength), "1", 0.05);
            strIn.min = "0";
            css(strIn, strIn.style.cssText + "flex:1;min-width:0;padding:3px 6px;font-size:12px;");
            strIn.addEventListener("change", () => {
                const v = parseFloat(strIn.value);
                k.strength = Number.isFinite(v) ? Math.max(0, v) : k.strength;
                draw();
            });
            row.appendChild(strIn);
            const rm = makeSmallButton("✕");
            rm.title = "Remove keyframe";
            if (kfs.length === 1) rm.style.visibility = "hidden";
            rm.addEventListener("click", () => { kfs.splice(i, 1); draw(); });
            row.appendChild(rm);
            panel.appendChild(row);
        });

        const addBtn = makeSmallButton("+ Keyframe");
        addBtn.style.alignSelf = "flex-start";
        addBtn.addEventListener("click", () => {
            const last = kfs[kfs.length - 1];
            kfs.push({ start: last ? (last.start + 1) / 2 : 0, strength: 1.0 });
            draw();
        });
        panel.appendChild(addBtn);
    }
    draw();
    return panel;
}

// Open the load picker (search bar + folders + flakes) and return the chosen
// flake name, or null. `exclude` keeps a flake from linking to itself.
export async function pickFlakeTarget(family, exclude) {
    try {
        const list = await (await fetch(`/flakes/list?family=${encodeURIComponent(family || "")}`)).json();
        const flakes = (list.flakes || []).filter(n => n !== exclude);
        const res = await openFileLoadPicker({
            flakes,
            directories: list.directories || [],
            family: family || "",
            displayNames: list.display_names || {},
            tagNames: list.tag_names || {},
        });
        return res && res.name ? res.name : null;
    } catch { return null; }
}

// LoRA cards for `loras`. `onTagChange` enables the tag-name checkbox (#274);
// `onFirstPath` is called when the first LoRA's file changes.
// `loraDir()` gives the folder the LoRA picker opens in (the flake's own
// path, e.g. img/anima/characters); defaults to the family folder.
export function renderLoraList(box, loras, { family, onTagChange, onFirstPath, loraDir } = {}) {
    const folder = familyFolder(family);
    function renderLoras() {
        box.replaceChildren();
        for (let i = 0; i < loras.length; i++) {
            const lora = loras[i];
            const card = document.createElement("div");
            css(card, "background:#252525;padding:10px;border-radius:6px;display:flex;flex-direction:column;gap:6px;border:1px solid #333;");

            const header = document.createElement("div");
            css(header, "display:flex;gap:6px;align-items:center;");

            header.appendChild(makeScheduleHandle(lora, renderLoras));

            const title = document.createElement("span");
            const titleText = lora.name ? `LoRA: ${lora.name}` : "LoRA";
            title.textContent = titleText;
            css(title, "flex:1;font-size:12px;font-weight:500;color:#aaa;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;");
            header.appendChild(title);

            if (lora.url) {
                const linkIcon = document.createElement("a");
                linkIcon.textContent = "\uD83D\uDD17";
                css(linkIcon, "font-size:12px;text-decoration:none;cursor:pointer;color:#4a9eff;");
                linkIcon.addEventListener("click", (e) => {
                    e.stopPropagation();
                    window.open(lora.url, "_blank");
                });
                header.appendChild(linkIcon);
            }

            const editBtn = document.createElement("button");
            editBtn.innerHTML = lora._editing ? "&#9652;" : "&#9662;";
            css(editBtn, "background:transparent;color:#888;border:none;padding:0;font-size:14px;cursor:pointer;line-height:1;display:flex;align-items:center;justify-content:center;height:20px;width:20px;");
            editBtn.title = "Edit name and URL";
            editBtn.addEventListener("click", () => {
                lora._editing = !lora._editing;
                renderLoras();
            });
            header.appendChild(editBtn);

            const removeBtn = makeSmallButton("\u2715");
            removeBtn.addEventListener("click", () => {
                loras.splice(i, 1);
                renderLoras();
            });
            header.appendChild(removeBtn);

            card.appendChild(header);

            if (lora._editing) {
                const editRow = document.createElement("div");
                css(editRow, "display:flex;flex-direction:column;gap:4px;");
                const nameInput = makeComfyInput(lora.name || "", "Display name");
                nameInput.addEventListener("change", () => {
                    lora.name = nameInput.value;
                    if (lora.tag_name) onTagChange?.();
                    renderLoras();
                });
                const urlInput = makeComfyInput(lora.url || "", "https://civitai.com/models/...");
                urlInput.addEventListener("change", () => {
                    lora.url = urlInput.value;
                    renderLoras();
                });
                editRow.appendChild(makeLabel("Name"));
                editRow.appendChild(nameInput);
                if (onTagChange) {
                    // Tag-name checkbox (#274): append this LoRA's name to the
                    // output stem, output path, and grid display name.
                    const tagRow = document.createElement("div");
                    css(tagRow, "display:flex;align-items:center;gap:6px;margin-top:2px;");
                    const tagChk = document.createElement("input");
                    tagChk.type = "checkbox";
                    tagChk.checked = !!lora.tag_name;
                    css(tagChk, "cursor:pointer;margin:0;");
                    const tagLbl = document.createElement("label");
                    tagLbl.textContent = "Tag flake with this LoRA's name";
                    css(tagLbl, "font-size:11px;color:#aaa;cursor:pointer;");
                    const toggleTag = () => {
                        lora.tag_name = tagChk.checked;
                        onTagChange();
                    };
                    tagChk.addEventListener("change", toggleTag);
                    tagLbl.addEventListener("click", () => { tagChk.checked = !tagChk.checked; toggleTag(); });
                    tagRow.appendChild(tagChk);
                    tagRow.appendChild(tagLbl);
                    editRow.appendChild(tagRow);
                }
                editRow.appendChild(makeLabel("URL"));
                editRow.appendChild(urlInput);
                card.appendChild(editRow);
            }

            const pathRow = document.createElement("div");
            css(pathRow, "display:flex;gap:4px;align-items:center;");

            const loraWrap = makeSearchableDropdown([], lora.path || "", "Select LoRA...");
            loraWrap.container.style.display = "none";
            (async () => {
                try {
                    const names = await fetchLoras();
                    for (const l of names) loraWrap.datalist.appendChild(Object.assign(document.createElement("option"), { value: l }));
                } catch { /* ignore */ }
            })();

            const pathBox = document.createElement("div");
            css(pathBox, "flex:1;background:#1a1a1a;color:#ddd;border:1px solid #333;padding:6px 8px;border-radius:6px;font-size:13px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;height:32px;box-sizing:border-box;display:flex;align-items:center;");
            pathBox.textContent = lora.path ? lora.path.replace(/\.safetensors?$/i, "").split(/[\\/]/).pop() : "No LoRA selected";
            pathBox.title = lora.path || "";

            const pathEditBtn = makeSmallButton("...");
            pathEditBtn.title = "Type manually";

            pathBox.addEventListener("click", async () => {
                const result = await openFileBrowser({ type: "loras", defaultPath: loraDir?.() || (folder ? `img/${folder}` : "") });
                if (result && result.file) {
                    lora.path = result.file;
                    pathBox.textContent = lora.path ? lora.path.replace(/\.safetensors?$/i, "").split(/[\\/]/).pop() : "No LoRA selected";
                    pathBox.title = lora.path || "";
                    loraWrap.element.value = lora.path;
                    if (i === 0) onFirstPath?.(lora.path);
                }
            });

            pathEditBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                pathBox.style.display = "none";
                pathEditBtn.style.display = "none";
                loraWrap.container.style.display = "block";
                loraWrap.element.focus();
            });

            loraWrap.element.addEventListener("change", () => {
                const val = loraWrap.element.value;
                lora.path = val;
                pathBox.textContent = val ? val.replace(/\.safetensors?$/i, "").split(/[\\/]/).pop() : "No LoRA selected";
                pathBox.title = val;
                pathBox.style.display = "block";
                pathEditBtn.style.display = "inline-block";
                loraWrap.container.style.display = "none";
                if (i === 0 && val) onFirstPath?.(val);
            });

            loraWrap.element.addEventListener("blur", () => {
                setTimeout(() => {
                    const val = loraWrap.element.value;
                    lora.path = val;
                    pathBox.textContent = val ? val.replace(/\.safetensors?$/i, "").split(/[\\/]/).pop() : "No LoRA selected";
                    pathBox.title = val;
                    pathBox.style.display = "block";
                    pathEditBtn.style.display = "inline-block";
                    loraWrap.container.style.display = "none";
                    if (i === 0 && val) onFirstPath?.(val);
                }, 200);
            });

            pathRow.appendChild(pathBox);
            pathRow.appendChild(pathEditBtn);
            pathRow.appendChild(loraWrap.container);

            if (lora.path) {
                const clearBtn = makeSmallButton("\u2715");
                css(clearBtn, "color:#f88;");
                clearBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    lora.path = "";
                    pathBox.textContent = "No LoRA selected";
                    pathBox.title = "";
                    loraWrap.element.value = "";
                });
                pathRow.appendChild(clearBtn);
            }

            card.appendChild(pathRow);

            const strSlider = makeComfyValueSlider(lora.strength ?? 1.0, -10, 10, 0.05, (v) => {
                lora.strength = v;
            });
            card.appendChild(strSlider);
            if (lora.schedule) card.appendChild(makeSchedulePanel(lora));

            box.appendChild(card);
        }

        const addBtn = makeSmallButton("+ Add LoRA");
        addBtn.addEventListener("click", () => {
            // Open new LoRA entries expanded (name + URL visible).
            // _editing is runtime-only and stripped on save.
            loras.push({ name: "", url: "", path: "", strength: 1.0, _editing: true });
            renderLoras();
        });
        box.appendChild(addBtn);
    }
    renderLoras();
}

export function serializeLoras(loras) {
    return loras.map(l => ({
        name: l.name || "",
        url: l.url || "",
        path: l.path || "",
        strength: l.strength ?? 1.0,
        ...(l.tag_name ? { tag_name: true } : {}),
        ...(l.schedule?.length ? { schedule: l.schedule } : {}),
    }));
}

// Flake links as { target, variant, lora_strengths, schedule? }, with the
// legacy single `flake_link` normalized into the list (#234).
export function normalizeLinks(data) {
    return (Array.isArray(data.flake_links)
        ? data.flake_links
        : (data.flake_link ? [data.flake_link] : [])
    ).filter(l => l && l.target).map(l => ({
        target: String(l.target || ""),
        variant: { ...(l.variant || {}) },
        lora_strengths: Array.isArray(l.lora_strengths) ? [...l.lora_strengths] : [],
        ...(Array.isArray(l.schedule) ? { schedule: l.schedule.map(k => ({ ...k })) } : {}),
    }));
}

function renderOneLinkOverrides(link, box) {
    box.replaceChildren();
    if (!link.target) return;
    (async () => {
        let linkedData;
        try {
            linkedData = await fetchFlake(link.target);
        } catch {
            const err = document.createElement("div");
            err.textContent = `Target not found: ${link.target}`;
            css(err, "font-size:11px;color:#f99;");
            box.appendChild(err);
            return;
        }
        const variants = linkedData.variants || linkedData.options || {};
        if (Object.keys(variants).length > 0) {
            const vLabel = document.createElement("div");
            vLabel.textContent = "Variant choice override (saved on this flake)";
            css(vLabel, "font-size:11px;color:#aaa;font-weight:500;");
            box.appendChild(vLabel);
            for (const [group, choices] of Object.entries(variants)) {
                const row = document.createElement("div");
                css(row, "display:flex;gap:8px;align-items:center;");
                const gLabel = document.createElement("span");
                gLabel.textContent = group;
                css(gLabel, "flex:0 0 120px;font-size:12px;color:#bbb;");
                row.appendChild(gLabel);
                const opts = [{ value: "", label: "— none —" }, ...Object.keys(choices).map(c => ({ value: c, label: c }))];
                const dd = makeComfyDropdown(opts, link.variant?.[group] || "");
                dd.element.addEventListener("change", () => {
                    link.variant = link.variant || {};
                    if (dd.element.value) link.variant[group] = dd.element.value;
                    else delete link.variant[group];
                });
                css(dd.container, "flex:1;min-width:0;");
                row.appendChild(dd.container);
                box.appendChild(row);
            }
        }
        // Linked flake's LoRAs — the modern `loras` list, or a
        // legacy single LoRA stored as `path`/`strength` (#300).
        // Without the legacy fallback, a single-LoRA target shows
        // no override sliders at all.
        const loras = (Array.isArray(linkedData.loras) && linkedData.loras.length)
            ? linkedData.loras
            : (linkedData.path ? [{ name: "", path: linkedData.path, strength: linkedData.strength ?? 1.0 }] : []);
        if (loras.length > 0) {
            const lLabel = document.createElement("div");
            lLabel.textContent = "LoRA strength overrides";
            css(lLabel, "font-size:11px;color:#aaa;font-weight:500;margin-top:4px;");
            box.appendChild(lLabel);
            link.lora_strengths = link.lora_strengths || [];
            while (link.lora_strengths.length < loras.length) link.lora_strengths.push(null);
            loras.forEach((lr, i) => {
                const row = document.createElement("div");
                css(row, "display:flex;gap:8px;align-items:center;");
                const nm = document.createElement("span");
                nm.textContent = lr.name || lr.path || `LoRA ${i + 1}`;
                css(nm, "flex:0 0 160px;font-size:12px;color:#bbb;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;");
                row.appendChild(nm);
                const cur = link.lora_strengths[i];
                const defaultStrength = lr.strength ?? 1.0;
                const initial = (cur === null || cur === undefined) ? defaultStrength : cur;
                // makeSmallValueSlider returns a bare element (not {container}).
                // The old `.container` access made css() throw, so the
                // sliders never rendered — only the label did (#307).
                // Range matches the grid override dropdown (-10..10).
                // Uses the larger makeComfyValueSlider for readability (#312).
                const slider = makeComfyValueSlider(initial, -10, 10, 0.05, (v) => {
                    link.lora_strengths[i] = v;
                });
                slider.style.flex = "1";
                row.appendChild(slider);
                const resetBtn = makeSmallButton("↺");
                resetBtn.title = "Use linked flake's default strength";
                resetBtn.addEventListener("click", () => {
                    link.lora_strengths[i] = null;
                    renderOneLinkOverrides(link, box);
                });
                row.appendChild(resetBtn);
                box.appendChild(row);
            });
        }
    })();
}

// Flake link cards (#234): each target is picked with `pickTarget` and can
// override the target's variant choices and LoRA strengths.
export function renderLinkList(box, links, pickTarget) {
    function renderLinks() {
        box.replaceChildren();
        links.forEach((link, li) => {
            const card = document.createElement("div");
            css(card, "background:#252525;padding:8px;border-radius:6px;border:1px solid #333;display:flex;flex-direction:column;gap:6px;");
            const header = document.createElement("div");
            css(header, "display:flex;gap:8px;align-items:center;");
            header.appendChild(makeScheduleHandle(link, renderLinks));
            const title = document.createElement("span");
            title.textContent = link.target ? link.target.split("/").pop() : "(no target)";
            title.title = link.target || "";
            css(title, "flex:1;font-size:12px;font-weight:500;color:#cdd;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;");
            header.appendChild(title);
            const changeBtn = makeSmallButton("Change");
            changeBtn.addEventListener("click", async () => {
                const picked = await pickTarget();
                if (picked && picked !== link.target) {
                    link.target = picked;
                    link.variant = {};
                    link.lora_strengths = [];
                    renderLinks();
                }
            });
            header.appendChild(changeBtn);
            const removeBtn = makeSmallButton("✕");
            removeBtn.addEventListener("click", () => {
                links.splice(li, 1);
                renderLinks();
            });
            header.appendChild(removeBtn);
            card.appendChild(header);
            const ovrBox = document.createElement("div");
            css(ovrBox, "display:flex;flex-direction:column;gap:6px;");
            card.appendChild(ovrBox);
            renderOneLinkOverrides(link, ovrBox);
            if (link.schedule) card.appendChild(makeSchedulePanel(link));
            box.appendChild(card);
        });
        const addBtn = makeSmallButton("+ Add flake link");
        addBtn.addEventListener("click", async () => {
            const picked = await pickTarget();
            if (picked) {
                links.push({ target: picked, variant: {}, lora_strengths: [] });
                renderLinks();
            }
        });
        box.appendChild(addBtn);
    }
    renderLinks();
}

export function serializeLinks(links) {
    const outLinks = [];
    for (const link of links) {
        if (!link || !link.target) continue;
        const out = { target: link.target };
        const variant = link.variant ? Object.fromEntries(Object.entries(link.variant).filter(([, v]) => v)) : {};
        if (Object.keys(variant).length > 0) out.variant = variant;
        // Drop trailing nulls to keep the yaml clean.
        let strengths = (link.lora_strengths || []).slice();
        while (strengths.length && (strengths[strengths.length - 1] === null || strengths[strengths.length - 1] === undefined)) {
            strengths.pop();
        }
        if (strengths.length > 0) out.lora_strengths = strengths;
        if (link.schedule?.length) out.schedule = link.schedule;
        outLinks.push(out);
    }
    return outLinks;
}
