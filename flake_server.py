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
async def _list_flakes(_request: web.Request) -> web.Response:
    try:
        names = flake_io.list_flakes()
        dirs = flake_io.list_dirs()
    except Exception as exc:
        logging.exception("[flakes] failed to list flakes")
        return _server_error(str(exc))
    return web.json_response({"flakes": names, "directories": dirs})


@routes.get("/flakes/meta")
async def _flake_meta(request: web.Request) -> web.Response:
    name = request.query.get("name", "").strip()
    if not name:
        return _bad_request("missing 'name' query param")
    try:
        options = flake_io.flake_options(name)
    except FileNotFoundError as exc:
        return _not_found(str(exc))
    except ValueError as exc:
        return _bad_request(str(exc))
    except Exception as exc:
        logging.exception("[flakes] failed to read meta for %s", name)
        return _server_error(str(exc))
    return web.json_response({"name": name, "options": options})


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
    if not name:
        return _bad_request("missing 'name'")
    if not isinstance(data, dict):
        return _bad_request("'data' must be an object")
    try:
        flake_io.save_flake(name, data)
    except ValueError as exc:
        return _bad_request(str(exc))
    except Exception as exc:
        logging.exception("[flakes] failed to save %s", name)
        return _server_error(str(exc))
    return web.json_response({"ok": True, "name": name})


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
    """Deduplicate by showing both full path and stem when they differ."""
    result: set[str] = set()
    for f in filenames:
        result.add(f)
        stem, _ = os.path.splitext(f)
        result.add(stem)
    return sorted(result)


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
async def _list_presets(_request: web.Request) -> web.Response:
    try:
        names = flake_io.list_presets()
    except Exception as exc:
        logging.exception("[flakes] failed to list presets")
        return _server_error(str(exc))
    return web.json_response({"presets": names})


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
    if not name:
        return _bad_request("missing 'name'")
    if not isinstance(data, dict):
        return _bad_request("'data' must be an object")
    try:
        flake_io.save_preset(name, data)
    except ValueError as exc:
        return _bad_request(str(exc))
    except Exception as exc:
        logging.exception("[flakes] failed to save preset %s", name)
        return _server_error(str(exc))
    return web.json_response({"ok": True, "name": name})


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

_BROWSE_TYPES = ("checkpoints", "loras", "flakes")

_BROWSE_FILTERS = {
    "checkpoints": (".safetensors", ".ckpt", ".pt", ".pth", ".bin", ".sft"),
    "loras": (".safetensors", ".ckpt", ".pt", ".pth", ".bin", ".sft"),
    "flakes": (".yaml", ".yml"),
}


def _get_browse_roots(browse_type: str) -> list[str]:
    """Resolve folder roots dynamically at request time."""
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
