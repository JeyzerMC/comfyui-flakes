// ---------- API ----------

let LIST_PROMISE = null;
let LIST_FAMILY = null;

export function invalidateList() { LIST_PROMISE = null; LIST_FAMILY = null; }

export async function fetchList(family = "") {
    const query = family ? `?family=${encodeURIComponent(family)}` : "";
    if (!LIST_PROMISE || LIST_FAMILY !== family) {
        LIST_FAMILY = family;
        LIST_PROMISE = fetch(`/flakes/list${query}`).then(r => r.json()).then(d => ({
            flakes: Array.isArray(d.flakes) ? d.flakes : [],
            directories: Array.isArray(d.directories) ? d.directories : [],
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

export async function saveFlakeApi(name, data, family = "") {
    const r = await fetch("/flakes/save", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, data, family: family || undefined }),
    });
    if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${r.status}`);
    }
    invalidateList();
}

export async function deleteFlakeApi(name) {
    const r = await fetch(`/flakes/delete?name=${encodeURIComponent(name)}`, { method: "DELETE" });
    if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${r.status}`);
    }
    invalidateList();
}

// --- Autocomplete / assets ---

let LORAS_PROMISE = null;
export function fetchLoras() {
    if (!LORAS_PROMISE) LORAS_PROMISE = fetch("/flakes/loras").then(r => r.json()).then(d => d.loras || []);
    return LORAS_PROMISE;
}

let CNMODELS_PROMISE = null;
export function fetchCnModels() {
    if (!CNMODELS_PROMISE) CNMODELS_PROMISE = fetch("/flakes/cnmodels").then(r => r.json()).then(d => d.controlnets || []);
    return CNMODELS_PROMISE;
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

let VAES_PROMISE = null;
export function fetchVaes() {
    if (!VAES_PROMISE) VAES_PROMISE = fetch("/flakes/vaes").then(r => r.json()).then(d => d.vaes || []);
    return VAES_PROMISE;
}

export async function fetchBrowse(type, path = "") {
    const r = await fetch("/flakes/browse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, path }),
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

export async function uploadCover(name, file) {
    const form = new FormData();
    form.append("file", file);
    const r = await fetch(`/flakes/cover?name=${encodeURIComponent(name)}`, {
        method: "POST",
        body: form,
    });
    if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${r.status}`);
    }
}

// --- Flake meta ---

const META_CACHE = {};
export async function fetchFlakeMeta(name) {
    if (META_CACHE[name]) return META_CACHE[name];
    const r = await fetch(`/flakes/meta?name=${encodeURIComponent(name)}`);
    if (!r.ok) return {};
    const d = await r.json();
    META_CACHE[name] = d.options || {};
    return META_CACHE[name];
}

let EMBEDDINGS_PROMISE = null;
export function fetchEmbeddings() {
    if (!EMBEDDINGS_PROMISE) EMBEDDINGS_PROMISE = fetch("/flakes/embeddings").then(r => r.json()).then(d => d.embeddings || []);
    return EMBEDDINGS_PROMISE;
}
