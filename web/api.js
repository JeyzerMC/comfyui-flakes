// ---------- API ----------

let LIST_PROMISE = null;
let LIST_KEY = null;

export function invalidateList() { LIST_PROMISE = null; LIST_KEY = null; }

// `kind` "anim" lists the animate flakes under anim/ (#431); `family` is then
// an animate family label.
export async function fetchList(family = "", kind = "img") {
    const query = new URLSearchParams({ family: family || "", kind });
    if (!LIST_PROMISE || LIST_KEY !== `${kind}:${family}`) {
        LIST_KEY = `${kind}:${family}`;
        LIST_PROMISE = fetch(`/flakes/list?${query}`).then(r => r.json()).then(d => ({
            flakes: Array.isArray(d.flakes) ? d.flakes : [],
            directories: Array.isArray(d.directories) ? d.directories : [],
            display_names: d.display_names || {},
            // Surface tag_names so the Load-existing-flake picker can show the
            // LoRA tag line, matching the grid items (#334).
            tag_names: d.tag_names || {},
            favorites: Array.isArray(d.favorites) ? d.favorites : [],
            folder_covers: d.folder_covers || {},
        }));
    }
    return LIST_PROMISE;
}

export async function fetchFlake(name) {
    const r = await fetch(`/flakes/get?name=${encodeURIComponent(name)}`);
    if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${r.status}`);
    }
    return (await r.json()).data || {};
}

export async function saveFlakeApi(name, data, family = "", baseRootIndex = null, outputPath = null, oldName = null, kind = "img") {
    const body = { name, data, family: family || undefined, kind };
    if (baseRootIndex != null) body.base_root_index = baseRootIndex;
    if (outputPath != null) body.output_path = outputPath;
    if (oldName != null) body.old_name = oldName;
    const r = await fetch("/flakes/save", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${r.status}`);
    }
    invalidateList();
    delete META_CACHE[name];
    delete DEFAULTS_CACHE[name];
    const result = await r.json().catch(() => ({}));
    return result.name || name;
}

export async function deleteFlakeApi(name) {
    const r = await fetch(`/flakes/delete?name=${encodeURIComponent(name)}`, { method: "DELETE" });
    if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${r.status}`);
    }
    invalidateList();
}

// Animate families with their preset defaults (#429).
let ANIM_FAMILIES_PROMISE = null;
export function fetchAnimFamilies() {
    if (!ANIM_FAMILIES_PROMISE) ANIM_FAMILIES_PROMISE = fetch("/flakes/anim/families").then(r => r.json()).then(d => d.families || []);
    return ANIM_FAMILIES_PROMISE;
}

// --- Autocomplete / assets ---

let LORAS_PROMISE = null;
export function fetchLoras() {
    if (!LORAS_PROMISE) LORAS_PROMISE = fetch("/flakes/loras").then(r => r.json()).then(d => d.loras || []);
    return LORAS_PROMISE;
}

// family label -> [{name, kind}] files a CN entry can pick as `model` (#381).
const CN_MODELS_PROMISES = {};
export function fetchCnModels(family) {
    if (!CN_MODELS_PROMISES[family]) {
        CN_MODELS_PROMISES[family] = fetch(`/flakes/cn_models?family=${encodeURIComponent(family || "")}`)
            .then(r => r.json()).then(d => d.models || []);
    }
    return CN_MODELS_PROMISES[family];
}

let CN_TYPES_PROMISE = null;
export function fetchCnTypes() {
    if (!CN_TYPES_PROMISE) CN_TYPES_PROMISE = fetch("/flakes/cn_types").then(r => r.json()).then(d => d.types || []);
    return CN_TYPES_PROMISE;
}

let INPUTS_PROMISE = null;
export function fetchInputs() {
    if (!INPUTS_PROMISE) INPUTS_PROMISE = fetch("/flakes/inputs").then(r => r.json()).then(d => d.inputs || []);
    return INPUTS_PROMISE;
}

let CKPTS_PROMISE = null;
export function fetchCheckpoints() {
    if (!CKPTS_PROMISE) CKPTS_PROMISE = fetch("/flakes/checkpoints").then(r => r.json()).then(d => d.checkpoints || []);
    return CKPTS_PROMISE;
}

export async function fetchBrowse(type, path = "", drive = "") {
    const r = await fetch("/flakes/browse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, path, drive }),
    });
    if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${r.status}`);
    }
    return (await r.json());
}

export async function fetchPreset(name) {
    const r = await fetch(`/flakes/preset?name=${encodeURIComponent(name)}`);
    if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${r.status}`);
    }
    return (await r.json()).data || {};
}

// Resolve which registered model_presets root the preset currently lives in,
// so the editor can preselect the correct base path on edit. Returns null when
// unknown. Kept separate from fetchPreset so existing callers are untouched.
export async function fetchPresetRootIndex(name) {
    try {
        const r = await fetch(`/flakes/preset?name=${encodeURIComponent(name)}`);
        if (!r.ok) return null;
        const d = await r.json();
        return d.base_root_index ?? null;
    } catch {
        return null;
    }
}

export async function fetchPresets(family = "") {
    const query = family ? `?family=${encodeURIComponent(family)}` : "";
    const r = await fetch(`/flakes/presets${query}`, { cache: "no-store" });
    if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${r.status}`);
    }
    return (await r.json()).presets || [];
}

// --- Cover ---

export function getCoverUrl(name) {
    return `/flakes/cover?name=${encodeURIComponent(name)}`;
}

export function getVariantImageUrl(name, group, choice) {
    return `/flakes/variant_image?name=${encodeURIComponent(name)}&group=${encodeURIComponent(group)}&choice=${encodeURIComponent(choice)}`;
}

// /view drops any folder in `filename`, so a path under input/ goes as `subfolder`.
export function inputImageUrl(path) {
    const parts = path.replace(/\\/g, "/").split("/");
    const filename = parts.pop();
    return `/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(parts.join("/"))}&type=input`;
}

export function flakeAssetUrl(name, path) {
    return `/flakes/asset?name=${encodeURIComponent(name)}&path=${encodeURIComponent(path)}`;
}

export function loraSiblingImageUrl(path) {
    return `/flakes/lora_sibling_image?path=${encodeURIComponent(path)}`;
}

export async function fetchLoraSiblingImage(path) {
    const r = await fetch(loraSiblingImageUrl(path));
    if (!r.ok) return null;
    const blob = await r.blob();
    const ct = r.headers.get("Content-Type") || "image/png";
    const extMap = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
    const ext = extMap[ct] || "png";
    return { blob, ext, mime: ct };
}

export async function fetchLoraSiblingImagePath(loraPath) {
    const r = await fetch(`/flakes/lora_sibling_image_path?path=${encodeURIComponent(loraPath)}`);
    if (!r.ok) return null;
    const d = await r.json().catch(() => ({}));
    return d.path || null;
}

export async function fetchLoraVariantSiblingImagePath(loraPath, group, choice) {
    const r = await fetch(`/flakes/lora_variant_sibling_image_path?path=${encodeURIComponent(loraPath)}&group=${encodeURIComponent(group)}&choice=${encodeURIComponent(choice)}`);
    if (!r.ok) return null;
    const d = await r.json().catch(() => ({}));
    return d.path || null;
}

// --- Flake meta ---

const META_CACHE = {};
const DEFAULTS_CACHE = {};
export async function fetchFlakeMeta(name) {
    if (META_CACHE[name]) return META_CACHE[name];
    const r = await fetch(`/flakes/meta?name=${encodeURIComponent(name)}`);
    if (!r.ok) return {};
    const d = await r.json();
    META_CACHE[name] = d.variants || d.options || {};
    DEFAULTS_CACHE[name] = d.defaults || {};
    return META_CACHE[name];
}

// A flake's {group: default choice} map (#388), or undefined until
// fetchFlakeMeta has loaded it.
export function cachedVariantDefaults(name) {
    return DEFAULTS_CACHE[name];
}

// Synchronous best-effort count of a flake's full variant-combination set
// (product of each group's choice count), using whatever is in META_CACHE.
// Returns 1 when the meta isn't cached yet (#343) — the exact batch count is
// still computed at queue time from the freshly-fetched meta.
export function variantComboCount(name) {
    const m = META_CACHE[name];
    if (!m) return 1;
    let n = 1;
    for (const g of Object.keys(m)) {
        if (Array.isArray(m[g]) && m[g].length) n *= m[g].length;
    }
    return n || 1;
}

let EMBEDDINGS_PROMISE = null;
export function fetchEmbeddings() {
    if (!EMBEDDINGS_PROMISE) EMBEDDINGS_PROMISE = fetch("/flakes/embeddings").then(r => r.json()).then(d => d.embeddings || []);
    return EMBEDDINGS_PROMISE;
}
