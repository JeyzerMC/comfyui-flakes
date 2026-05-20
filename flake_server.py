from __future__ import annotations

import logging
import os

from aiohttp import web
from server import PromptServer

import folder_paths
from . import flake_io

routes = PromptServer.instance.routes


def _bad_request(msg: str) -> web.Response:
    return web.json_response({"error": msg}, status=400)


def _not_found(msg: str) -> web.Response:
    return web.json_response({"error": msg}, status=404)


def _server_error(msg: str) -> web.Response:
    return web.json_response({"error": msg}, status=500)


# ---------------------------------------------------------------------------
# Flake list / get / save / delete / meta
# ---------------------------------------------------------------------------

@routes.get("/flakes/list")
async def _list_flakes(request: web.Request) -> web.Response:
    family = request.query.get("family", "").strip() or None
    try:
        names = flake_io.list_flakes(family=family)
        dirs = flake_io.list_dirs(family=family)
        display_names = flake_io.list_flake_display_names(family=family)
    except Exception as exc:
        logging.exception("[flakes] failed to list flakes")
        return _server_error(str(exc))
    return web.json_response({"flakes": names, "directories": dirs, "display_names": display_names})


@routes.get("/flakes/meta")
async def _flake_meta(request: web.Request) -> web.Response:
    name = request.query.get("name", "").strip()
    if not name:
        return _bad_request("missing 'name' query param")
    try:
        variants = flake_io.flake_variants(name)
    except FileNotFoundError as exc:
        return _not_found(str(exc))
    except ValueError as exc:
        return _bad_request(str(exc))
    except Exception as exc:
        logging.exception("[flakes] failed to read meta for %s", name)
        return _server_error(str(exc))
    # Return both keys for a transitional window; clients should prefer
    # `variants`.
    return web.json_response({"name": name, "variants": variants, "options": variants})


@routes.get("/flakes/get")
async def _get_flake(request: web.Request) -> web.Response:
    name = request.query.get("name", "").strip()
    if not name:
        return _bad_request("missing 'name' query param")
    try:
        data = flake_io.read_flake_raw(name)
    except FileNotFoundError as exc:
        return _not_found(str(exc))
    except ValueError as exc:
        return _bad_request(str(exc))
    except Exception as exc:
        logging.exception("[flakes] failed to read %s", name)
        return _server_error(str(exc))
    return web.json_response({"name": name, "data": data})


@routes.put("/flakes/save")
async def _save_flake(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except Exception:
        return _bad_request("invalid JSON body")
    if not isinstance(body, dict):
        return _bad_request("body must be a JSON object")
    name = (body.get("name") or "").strip()
    data = body.get("data")
    family = (body.get("family") or "").strip() or None
    base_root_index = body.get("base_root_index")
    if base_root_index is not None:
        try:
            base_root_index = int(base_root_index)
        except (TypeError, ValueError):
            return _bad_request("base_root_index must be an integer")
    output_path = (body.get("output_path") or "").strip() or None
    old_name = (body.get("old_name") or "").strip() or None
    if not name and not output_path:
        return _bad_request("missing 'name' or 'output_path'")
    if not isinstance(data, dict):
        return _bad_request("'data' must be an object")
    try:
        saved_name = flake_io.save_flake(
            name, data,
            family=family,
            base_root_index=base_root_index,
            output_path=output_path,
            old_name=old_name,
        )
    except ValueError as exc:
        return _bad_request(str(exc))
    except Exception as exc:
        logging.exception("[flakes] failed to save %s", name)
        return _server_error(str(exc))
    return web.json_response({"ok": True, "name": saved_name})


@routes.delete("/flakes/delete")
async def _delete_flake(request: web.Request) -> web.Response:
    name = request.query.get("name", "").strip()
    if not name:
        return _bad_request("missing 'name' query param")
    try:
        flake_io.delete_flake(name)
    except FileNotFoundError as exc:
        return _not_found(str(exc))
    except ValueError as exc:
        return _bad_request(str(exc))
    except Exception as exc:
        logging.exception("[flakes] failed to delete %s", name)
        return _server_error(str(exc))
    return web.json_response({"ok": True, "name": name})


# ---------------------------------------------------------------------------
# Autocomplete sources (Phase 2)
# ---------------------------------------------------------------------------

def _shorten_filenames(filenames: list[str]) -> list[str]:
    """Return filenames with extensions stripped, deduplicated."""
    result: set[str] = set()
    for f in filenames:
        stem, _ = os.path.splitext(f)
        result.add(stem if stem else f)
    return sorted(result)


def _resolve_model_name(category: str, stem_or_name: str) -> str:
    """Resolve a stem-or-full model name to the full filename in a folder_paths category."""
    try:
        available = folder_paths.get_filename_list(category)
    except Exception:
        return stem_or_name
    available_norm = {p.replace("\\", "/"): p for p in available}
    norm = stem_or_name.replace("\\", "/")
    if norm in available_norm:
        return available_norm[norm]
    norm_stem, _ = os.path.splitext(norm)
    for cand_norm, candidate in available_norm.items():
        stem, _ = os.path.splitext(cand_norm)
        if stem == norm_stem:
            return candidate
    return stem_or_name


@routes.get("/flakes/loras")
async def _list_loras(_request: web.Request) -> web.Response:
    try:
        loras = folder_paths.get_filename_list("loras")
    except Exception as exc:
        logging.exception("[flakes] failed to list loras")
        return _server_error(str(exc))
    return web.json_response({"loras": _shorten_filenames(loras)})


@routes.get("/flakes/cnmodels")
async def _list_controlnets(_request: web.Request) -> web.Response:
    try:
        cns = folder_paths.get_filename_list("controlnet")
    except Exception as exc:
        logging.exception("[flakes] failed to list controlnets")
        return _server_error(str(exc))
    return web.json_response({"controlnets": _shorten_filenames(cns)})


@routes.get("/flakes/cn_types")
async def _list_cn_types(_request: web.Request) -> web.Response:
    return web.json_response({"types": [
        "openpose", "depth", "canny", "lineart", "lineart_anime",
        "softedge", "scribble", "normalbae", "seg", "tile", "ip2p",
    ]})


@routes.get("/flakes/checkpoints")
async def _list_checkpoints(_request: web.Request) -> web.Response:
    try:
        ckpts = folder_paths.get_filename_list("checkpoints")
    except Exception as exc:
        logging.exception("[flakes] failed to list checkpoints")
        return _server_error(str(exc))
    return web.json_response({"checkpoints": _shorten_filenames(ckpts)})


@routes.get("/flakes/vaes")
async def _list_vaes(_request: web.Request) -> web.Response:
    try:
        vaes = folder_paths.get_filename_list("vae")
    except Exception as exc:
        logging.exception("[flakes] failed to list VAEs")
        return _server_error(str(exc))
    return web.json_response({"vaes": _shorten_filenames(vaes)})


@routes.get("/flakes/text_encoders")
async def _list_text_encoders(_request: web.Request) -> web.Response:
    try:
        te_paths = folder_paths.get_filename_paths("text_encoders") if hasattr(folder_paths, "get_filename_paths") and folder_paths.get_filename_paths("text_encoders") else []
        tes = folder_paths.get_filename_list("text_encoders") if os.environ.get("FLAKES_TEXT_ENCODER_FOLDER") or True else []
    except Exception:
        tes = []
    try:
        if not tes:
            te_dir = folder_paths.get_folder_paths("text_encoders") if hasattr(folder_paths, "get_folder_paths") else []
            if isinstance(te_dir, str):
                te_dir = [te_dir]
            for d in te_dir:
                if os.path.isdir(d):
                    for dirpath, _, filenames in os.walk(d):
                        for fn in filenames:
                            if fn.lower().endswith((".safetensors", ".bin", ".pt", ".ckpt")):
                                rel = os.path.relpath(os.path.join(dirpath, fn), d).replace(os.sep, "/")
                                tes.append(rel)
    except Exception:
        pass
    return web.json_response({"text_encoders": _shorten_filenames(tes)})


@routes.get("/flakes/inputs")
async def _list_inputs(_request: web.Request) -> web.Response:
    try:
        input_dir = folder_paths.get_input_directory()
        names: list[str] = []
        if os.path.isdir(input_dir):
            for dirpath, _, filenames in os.walk(input_dir):
                for fn in filenames:
                    full = os.path.join(dirpath, fn)
                    rel = os.path.relpath(full, input_dir).replace(os.sep, "/")
                    names.append(rel)
        return web.json_response({"inputs": sorted(names)})
    except Exception as exc:
        logging.exception("[flakes] failed to list inputs")
        return _server_error(str(exc))


@routes.get("/flakes/embeddings")
async def _list_embeddings(_request: web.Request) -> web.Response:
    try:
        embeddings = folder_paths.get_filename_list("embeddings")
    except Exception as exc:
        logging.exception("[flakes] failed to list embeddings")
        return _server_error(str(exc))
    return web.json_response({"embeddings": _shorten_filenames(embeddings)})


# ---------------------------------------------------------------------------
# Cover image (Phase 3)
# ---------------------------------------------------------------------------

@routes.get("/flakes/cover")
async def _get_cover(request: web.Request) -> web.Response:
    name = request.query.get("name", "").strip()
    if not name:
        return _bad_request("missing 'name' query param")
    try:
        result = flake_io.read_cover(name)
    except ValueError as exc:
        return _bad_request(str(exc))
    except Exception as exc:
        logging.exception("[flakes] failed to read cover for %s", name)
        return _server_error(str(exc))
    if result is None:
        return _not_found(f"no cover for '{name}'")
    data, mime = result
    return web.Response(body=data, content_type=mime)


@routes.get("/flakes/variant_image")
async def _get_variant_image(request: web.Request) -> web.Response:
    name = request.query.get("name", "").strip()
    group = request.query.get("group", "").strip()
    choice = request.query.get("choice", "").strip()
    if not name or not group or not choice:
        return _bad_request("missing 'name', 'group' or 'choice' query param")
    try:
        result = flake_io.read_variant_image(name, group, choice)
    except ValueError as exc:
        return _bad_request(str(exc))
    except Exception as exc:
        logging.exception("[flakes] failed to read variant image for %s/%s/%s", name, group, choice)
        return _server_error(str(exc))
    if result is None:
        return _not_found(f"no variant image for '{name}' {group}/{choice}")
    data, mime = result
    return web.Response(body=data, content_type=mime)


@routes.post("/flakes/cover")
async def _upload_cover(request: web.Request) -> web.Response:
    reader = await request.multipart()
    field = await reader.next()
    if field is None:
        return _bad_request("no file field in multipart body")
    filename = field.filename or "cover.png"
    ext = os.path.splitext(filename)[1]
    data = await field.read()

    name = request.query.get("name", "").strip()
    if not name:
        return _bad_request("missing 'name' query param")
    try:
        flake_io.save_cover(name, ext, data)
    except ValueError as exc:
        return _bad_request(str(exc))
    except Exception as exc:
        logging.exception("[flakes] failed to save cover for %s", name)
        return _server_error(str(exc))
    return web.json_response({"ok": True, "name": name})


# ---------------------------------------------------------------------------
# Presets (Phase 4)
# ---------------------------------------------------------------------------

@routes.get("/flakes/presets")
async def _list_presets(request: web.Request) -> web.Response:
    family = request.query.get("family", "").strip() or None
    try:
        names = flake_io.list_presets(family=family)
        display_names = flake_io.list_preset_display_names(family=family)
    except Exception as exc:
        logging.exception("[flakes] failed to list presets")
        return _server_error(str(exc))
    return web.json_response({"presets": names, "display_names": display_names})


@routes.get("/flakes/preset")
async def _get_preset(request: web.Request) -> web.Response:
    name = request.query.get("name", "").strip()
    if not name:
        return _bad_request("missing 'name' query param")
    try:
        data = flake_io.read_preset_raw(name)
    except FileNotFoundError as exc:
        return _not_found(str(exc))
    except ValueError as exc:
        return _bad_request(str(exc))
    except Exception as exc:
        logging.exception("[flakes] failed to read preset %s", name)
        return _server_error(str(exc))
    return web.json_response({"name": name, "data": data})


@routes.put("/flakes/presets/save")
async def _save_preset(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except Exception:
        return _bad_request("invalid JSON body")
    if not isinstance(body, dict):
        return _bad_request("body must be a JSON object")
    name = (body.get("name") or "").strip()
    data = body.get("data")
    family = (body.get("family") or "").strip() or None
    base_root_index = body.get("base_root_index")
    if base_root_index is not None:
        try:
            base_root_index = int(base_root_index)
        except (TypeError, ValueError):
            return _bad_request("base_root_index must be an integer")
    output_path = (body.get("output_path") or "").strip() or None
    old_name = (body.get("old_name") or "").strip() or None
    if not name and not output_path:
        return _bad_request("missing 'name' or 'output_path'")
    if not isinstance(data, dict):
        return _bad_request("'data' must be an object")
    try:
        saved_name = flake_io.save_preset(
            name, data,
            family=family,
            base_root_index=base_root_index,
            output_path=output_path,
            old_name=old_name,
        )
    except ValueError as exc:
        return _bad_request(str(exc))
    except Exception as exc:
        logging.exception("[flakes] failed to save preset %s", name)
        return _server_error(str(exc))
    return web.json_response({"ok": True, "name": saved_name})


@routes.delete("/flakes/presets/delete")
async def _delete_preset(request: web.Request) -> web.Response:
    name = request.query.get("name", "").strip()
    if not name:
        return _bad_request("missing 'name' query param")
    try:
        flake_io.delete_preset(name)
    except FileNotFoundError as exc:
        return _not_found(str(exc))
    except ValueError as exc:
        return _bad_request(str(exc))
    except Exception as exc:
        logging.exception("[flakes] failed to delete preset %s", name)
        return _server_error(str(exc))
    return web.json_response({"ok": True, "name": name})


# ---------------------------------------------------------------------------
# Checkpoint sibling image (auto-cover)
# ---------------------------------------------------------------------------

_CHECKPOINT_IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".webp", ".gif")


def _sibling_image_response(folder_type: str, path: str) -> web.Response:
    resolved = _resolve_model_name(folder_type, path)
    try:
        full_path = folder_paths.get_full_path(folder_type, resolved)
    except Exception:
        full_path = None
    if not full_path or not os.path.isfile(full_path):
        return _not_found(f"{folder_type[:-1]} not found: {path}")
    dir_path = os.path.dirname(full_path)
    basename = os.path.splitext(os.path.basename(full_path))[0]
    mime_map = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".gif": "image/gif",
    }
    for ext in _CHECKPOINT_IMAGE_EXTS:
        sibling = os.path.join(dir_path, basename + ext)
        if os.path.isfile(sibling):
            mime = mime_map.get(ext, "application/octet-stream")
            with open(sibling, "rb") as f:
                return web.Response(body=f.read(), content_type=mime)
    return _not_found("no sibling image found")


def _resolve_sibling_image_relpath(folder_type: str, path: str) -> str | None:
    """Return the relative path (under the folder_type tree) of the sibling
    image for the given weight file, or None if no sibling exists."""
    resolved = _resolve_model_name(folder_type, path)
    try:
        full_path = folder_paths.get_full_path(folder_type, resolved)
    except Exception:
        full_path = None
    if not full_path or not os.path.isfile(full_path):
        return None
    dir_path = os.path.dirname(full_path)
    basename = os.path.splitext(os.path.basename(full_path))[0]
    for ext in _CHECKPOINT_IMAGE_EXTS:
        sibling = os.path.join(dir_path, basename + ext)
        if os.path.isfile(sibling):
            # Return path relative to the same folder_type tree the input came from
            try:
                roots = folder_paths.get_folder_paths(folder_type)
            except Exception:
                roots = []
            for root in roots:
                try:
                    rel = os.path.relpath(sibling, root)
                except ValueError:
                    continue
                if not rel.startswith(".."):
                    return rel.replace(os.sep, "/")
            return os.path.basename(sibling)
    return None


def _resolve_variant_sibling_image_relpath(folder_type: str, path: str, group: str, choice: str) -> str | None:
    """Return the relative path of the sibling image named
    ``<basename>_<group>_<choice>.ext`` for the given weight file, or None."""
    resolved = _resolve_model_name(folder_type, path)
    try:
        full_path = folder_paths.get_full_path(folder_type, resolved)
    except Exception:
        full_path = None
    if not full_path or not os.path.isfile(full_path):
        return None
    dir_path = os.path.dirname(full_path)
    basename = os.path.splitext(os.path.basename(full_path))[0]
    suffix = f"_{group.lower()}_{choice.lower()}"
    for ext in _CHECKPOINT_IMAGE_EXTS:
        sibling = os.path.join(dir_path, basename + suffix + ext)
        if os.path.isfile(sibling):
            try:
                roots = folder_paths.get_folder_paths(folder_type)
            except Exception:
                roots = []
            for root in roots:
                try:
                    rel = os.path.relpath(sibling, root)
                except ValueError:
                    continue
                if not rel.startswith(".."):
                    return rel.replace(os.sep, "/")
            return os.path.basename(sibling)
    return None


# ---------------------------------------------------------------------------
# Registered roots (so the UI can offer a base-path dropdown)
# ---------------------------------------------------------------------------


@routes.get("/flakes/roots")
async def _list_roots(request: web.Request) -> web.Response:
    """List the active base paths for either ``flakes`` or ``model_presets``.

    The first entry is the default ComfyUI install path; subsequent entries
    come from ``extra_model_paths.yaml``. Labels are derived from the parent
    directory name so the user can distinguish e.g. ``Default: C:\\...`` from
    ``Extra: D:\\...``.
    """
    kind = request.query.get("type", "").strip()
    if kind not in ("flakes", "model_presets"):
        return _bad_request("type must be 'flakes' or 'model_presets'")
    try:
        roots = folder_paths.get_folder_paths(kind)
    except Exception:
        roots = []
    if isinstance(roots, str):
        roots = [roots]
    base_path = folder_paths.base_path
    base_root = None
    extra_roots = []
    for i, root in enumerate(roots):
        if not root or not isinstance(root, str):
            continue
        real_root = os.path.realpath(root)
        real_base = os.path.realpath(base_path)
        if real_root.startswith(real_base + os.sep) or real_root == real_base:
            base_root = {"index": i, "path": root, "label": "Comfy Install"}
        else:
            extra_roots.append({"index": i, "path": root, "label": ""})

    entries = []
    if base_root:
        entries.append(base_root)
    for idx, extra in enumerate(extra_roots, start=1):
        extra["label"] = f"Extra Path {idx}"
        entries.append(extra)
    return web.json_response({"roots": entries})


@routes.get("/flakes/lora_sibling_image_path")
async def _get_lora_sibling_image_path(request: web.Request) -> web.Response:
    path = request.query.get("path", "").strip()
    if not path:
        return _bad_request("missing 'path' query param")
    rel = _resolve_sibling_image_relpath("loras", path)
    if rel is None:
        return _not_found("no sibling image found")
    return web.json_response({"path": rel})


@routes.get("/flakes/lora_variant_sibling_image_path")
async def _get_lora_variant_sibling_image_path(request: web.Request) -> web.Response:
    path = request.query.get("path", "").strip()
    group = request.query.get("group", "").strip()
    choice = request.query.get("choice", "").strip()
    if not path or not group or not choice:
        return _bad_request("missing 'path', 'group' or 'choice' query param")
    rel = _resolve_variant_sibling_image_relpath("loras", path, group, choice)
    if rel is None:
        return _not_found("no variant sibling image found")
    return web.json_response({"path": rel})


@routes.get("/flakes/checkpoint_sibling_image")
async def _get_checkpoint_sibling_image(request: web.Request) -> web.Response:
    path = request.query.get("path", "").strip()
    if not path:
        return _bad_request("missing 'path' query param")
    return _sibling_image_response("checkpoints", path)


@routes.get("/flakes/lora_sibling_image")
async def _get_lora_sibling_image(request: web.Request) -> web.Response:
    path = request.query.get("path", "").strip()
    if not path:
        return _bad_request("missing 'path' query param")
    return _sibling_image_response("loras", path)


# ---------------------------------------------------------------------------
# Preset cover image
# ---------------------------------------------------------------------------

@routes.get("/flakes/preset_cover")
async def _get_preset_cover(request: web.Request) -> web.Response:
    name = request.query.get("name", "").strip()
    if not name:
        return _bad_request("missing 'name' query param")
    try:
        result = flake_io.read_preset_cover(name)
    except ValueError as exc:
        return _bad_request(str(exc))
    except Exception as exc:
        logging.exception("[flakes] failed to read preset cover for %s", name)
        return _server_error(str(exc))
    if result is None:
        return _not_found(f"no cover for preset '{name}'")
    data, mime = result
    return web.Response(body=data, content_type=mime)


@routes.post("/flakes/preset_cover")
async def _upload_preset_cover(request: web.Request) -> web.Response:
    reader = await request.multipart()
    field = await reader.next()
    if field is None:
        return _bad_request("no file field in multipart body")
    filename = field.filename or "cover.png"
    ext = os.path.splitext(filename)[1]
    data = await field.read()

    name = request.query.get("name", "").strip()
    if not name:
        return _bad_request("missing 'name' query param")
    try:
        flake_io.save_preset_cover(name, ext, data)
    except ValueError as exc:
        return _bad_request(str(exc))
    except Exception as exc:
        logging.exception("[flakes] failed to save preset cover for %s", name)
        return _server_error(str(exc))
    return web.json_response({"ok": True, "name": name})


# ---------------------------------------------------------------------------
# File browser (custom directory picker backed by Python)
# ---------------------------------------------------------------------------

_BROWSE_TYPES = ("checkpoints", "loras", "flakes", "inputs")

_BROWSE_FILTERS = {
    "checkpoints": (".safetensors", ".ckpt", ".pt", ".pth", ".bin", ".sft"),
    "loras": (".safetensors", ".ckpt", ".pt", ".pth", ".bin", ".sft"),
    "flakes": (".yaml", ".yml"),
    "inputs": (".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"),
}


def _get_browse_roots(browse_type: str) -> list[str]:
    """Resolve folder roots dynamically at request time."""
    if browse_type == "inputs":
        input_dir = folder_paths.get_input_directory()
        return [input_dir] if input_dir and os.path.isdir(input_dir) else []
    try:
        paths = folder_paths.get_folder_paths(browse_type)
    except Exception:
        paths = []
    # get_folder_paths returns a list of str on modern ComfyUI,
    # but defensively wrap a single string.
    if isinstance(paths, str):
        return [paths]
    return [p for p in paths if p and isinstance(p, str)]


@routes.post("/flakes/browse")
async def _browse(_request: web.Request) -> web.Response:
    try:
        body = await _request.json()
    except Exception:
        return _bad_request("invalid JSON body")
    if not isinstance(body, dict):
        return _bad_request("body must be a JSON object")

    browse_type = (body.get("type") or "").strip()
    rel_path = (body.get("path") or "").strip()

    if browse_type not in _BROWSE_TYPES:
        return _bad_request(f"invalid browse type: {browse_type!r}")

    roots = _get_browse_roots(browse_type)
    exts = _BROWSE_FILTERS.get(browse_type, ())

    if not roots:
        return _server_error(f"no roots configured for {browse_type!r}")

    seen: set[str] = set()
    entries: list[dict[str, str]] = []
    valid_target_found = False

    for base in roots:
        target = os.path.normpath(os.path.join(base, rel_path)) if rel_path else base

        # Security: ensure target is inside base
        real_target = os.path.realpath(target)
        real_base = os.path.realpath(base)
        try:
            if os.path.commonpath([real_target, real_base]) != real_base:
                continue
        except ValueError:
            continue

        if not os.path.isdir(target):
            continue

        valid_target_found = True
        try:
            for item in sorted(os.listdir(target)):
                if item in seen:
                    continue
                seen.add(item)
                full = os.path.join(target, item)
                if os.path.isdir(full):
                    entries.append({"name": item, "type": "dir"})
                elif os.path.isfile(full):
                    if exts and not item.lower().endswith(exts):
                        continue
                    entries.append({"name": item, "type": "file"})
        except Exception:
            continue

    if not valid_target_found and not entries:
        return _not_found(f"directory not found: {rel_path}")

    return web.json_response({"path": rel_path, "entries": entries})
