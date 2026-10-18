from __future__ import annotations

import logging
import os

from aiohttp import web
from server import PromptServer

import folder_paths
import latent_preview
from . import flake_families, flake_io
from .flake_compose import anima_cn_files

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
        tag_names = flake_io.list_flake_tag_names(family=family)
    except Exception as exc:
        logging.exception("[flakes] failed to list flakes")
        return _server_error(str(exc))
    return web.json_response({"flakes": names, "directories": dirs, "display_names": display_names, "tag_names": tag_names})


@routes.get("/flakes/drives")
async def _flake_drives(request: web.Request) -> web.Response:
    """Drives holding each flake and folder (or each preset with
    kind=presets), so the load picker can show one drive at a time like the
    file picker."""
    family = request.query.get("family", "").strip() or None
    if request.query.get("kind") == "presets":
        presets: dict[str, list[str]] = {}
        for root in folder_paths.get_folder_paths("model_presets"):
            for name in flake_io.list_presets(family=family, roots=[root]):
                presets.setdefault(name, []).append(_drive(root))
        drives = sorted({d for ds in presets.values() for d in ds})
        return web.json_response({
            "presets": presets, "drives": drives,
            "default": _default_drive(drives) if drives else "",
        })
    flakes: dict[str, list[str]] = {}
    dirs: dict[str, list[str]] = {}
    for root in folder_paths.get_folder_paths("flakes"):
        drive = _drive(root)
        for name in flake_io.list_flakes(family=family, roots=[root]):
            flakes.setdefault(name, []).append(drive)
        for name in flake_io.list_dirs(family=family, roots=[root]):
            dirs.setdefault(name, []).append(drive)
    drives = sorted({d for ds in (*flakes.values(), *dirs.values()) for d in ds})
    return web.json_response({
        "flakes": flakes, "directories": dirs, "drives": drives,
        "default": _default_drive(drives) if drives else "",
    })


@routes.get("/flakes/series")
async def _list_series(request: web.Request) -> web.Response:
    family = request.query.get("family", "").strip() or None
    try:
        series = flake_io.list_series(family=family)
    except Exception as exc:
        logging.exception("[flakes] failed to list series")
        return _server_error(str(exc))
    return web.json_response({"series": series})


@routes.get("/flakes/samplers")
async def _list_samplers(request: web.Request) -> web.Response:
    """Expose the installed ComfyUI's KSampler sampler/scheduler lists so the
    preset editor stays in sync with core (Advanced KSampler parity)."""
    try:
        from comfy.samplers import KSampler
        samplers = list(KSampler.SAMPLERS)
        schedulers = list(KSampler.SCHEDULERS)
    except Exception as exc:
        logging.exception("[flakes] failed to list samplers/schedulers")
        return _server_error(str(exc))
    return web.json_response({"samplers": samplers, "schedulers": schedulers})


@routes.get("/flakes/preview_default")
async def _preview_default(request: web.Request) -> web.Response:
    """The server's --preview-method, used when the frontend Live preview
    setting is left at "default" (#380)."""
    return web.json_response({"method": latent_preview.default_preview_method.value})


@routes.get("/flakes/meta")
async def _flake_meta(request: web.Request) -> web.Response:
    name = request.query.get("name", "").strip()
    if not name:
        return _bad_request("missing 'name' query param")
    try:
        flake = flake_io.load_flake(name)
    except FileNotFoundError as exc:
        return _not_found(str(exc))
    except ValueError as exc:
        return _bad_request(str(exc))
    except Exception as exc:
        logging.exception("[flakes] failed to read meta for %s", name)
        return _server_error(str(exc))
    # Return both keys for a transitional window; clients should prefer
    # `variants`.
    variants = {group: list(choices.keys()) for group, choices in flake.variants.items()}
    return web.json_response({"name": name, "variants": variants, "options": variants, "defaults": flake_io.variant_defaults(flake)})


@routes.get("/flakes/get")
async def _get_flake(request: web.Request) -> web.Response:
    name = request.query.get("name", "").strip()
    if not name:
        return _bad_request("missing 'name' query param")
    try:
        data = flake_io.read_flake_raw(name)
        base_root_index = flake_io._find_flake_root_index(name)
    except FileNotFoundError as exc:
        return _not_found(str(exc))
    except ValueError as exc:
        return _bad_request(str(exc))
    except Exception as exc:
        logging.exception("[flakes] failed to read %s", name)
        return _server_error(str(exc))
    return web.json_response({"name": name, "data": data, "base_root_index": base_root_index})


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


@routes.get("/flakes/cn_models")
async def _list_cn_models(request: web.Request) -> web.Response:
    """ControlNet files a flake's CN entry can name as ``model`` for a family:
    Anima LLLite patches and VACE files (#381). Other families pick by type."""
    family = flake_families.get(request.query.get("family"))
    if family is None or family.cn_kind != "anima_lllite":
        return web.json_response({"models": []})
    try:
        models = anima_cn_files()
    except Exception as exc:
        logging.exception("[flakes] failed to list Anima controlnets")
        return _server_error(str(exc))
    return web.json_response({"models": models})


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


@routes.get("/flakes/families")
async def _list_families(_request: web.Request) -> web.Response:
    """Serve the model-family registry so the web layer stops duplicating it
    (#355, #360). The JS keeps its own literals as a bootstrap fallback, so a
    failure here degrades to the previous behaviour rather than breaking the
    editor."""
    try:
        families = [
            {
                "label": f.label,
                "folder": f.folder,
                "selectable": f.selectable,
                "clip_type": f.clip_type,
                "steps": f.steps,
                "cfg": f.cfg,
                "sampler": f.sampler,
                "scheduler": f.scheduler,
                "width": f.width,
                "height": f.height,
                "supports_clip_skip": f.supports_clip_skip,
                "default_shift": f.default_shift,
                "cn_models": f.cn_models,
                "cn_kind": f.cn_kind,
            }
            for f in flake_families.FAMILIES
        ]
    except Exception as exc:
        logging.exception("[flakes] failed to list families")
        return _server_error(str(exc))
    return web.json_response({"families": families})


@routes.get("/flakes/clip_types")
async def _list_clip_types(_request: web.Request) -> web.Response:
    """CLIPType members this ComfyUI build supports, for the preset editor's
    text-encoder type dropdown."""
    try:
        import comfy.sd

        types = sorted(m.name for m in comfy.sd.CLIPType)
    except Exception:
        types = ["STABLE_DIFFUSION"]
    return web.json_response({"clip_types": types})


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


@routes.get("/flakes/asset")
async def _get_asset(request: web.Request) -> web.Response:
    """Serve a `./` image owned by a flake (relative to its yaml directory)."""
    name = request.query.get("name", "").strip()
    path = request.query.get("path", "").strip()
    if not name or not path:
        return _bad_request("missing 'name' or 'path' query param")
    try:
        result = flake_io.read_flake_asset(name, path)
    except FileNotFoundError as exc:
        return _not_found(str(exc))
    except ValueError as exc:
        return _bad_request(str(exc))
    except Exception as exc:
        logging.exception("[flakes] failed to read asset %s for %s", path, name)
        return _server_error(str(exc))
    if result is None:
        return _not_found(f"no image '{path}' for '{name}'")
    data, mime = result
    return web.Response(body=data, content_type=mime)


@routes.delete("/flakes/cover")
async def _delete_cover_route(request: web.Request) -> web.Response:
    """Delete the cover image file alongside a flake's yaml. Used by the
    modal's hover-X remove button (#239)."""
    name = request.query.get("name", "").strip()
    if not name:
        return _bad_request("missing 'name' query param")
    try:
        flake_io._delete_cover(name)
    except FileNotFoundError:
        pass  # already gone — idempotent
    except Exception as exc:
        logging.exception("[flakes] failed to delete cover for %s", name)
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
    try:
        base_root_index = flake_io._find_preset_root_index(name)
    except Exception:
        base_root_index = None
    return web.json_response({"name": name, "data": data, "base_root_index": base_root_index})


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
    install_dir = os.path.join(folder_paths.models_dir, "flakes")
    if kind == "model_presets":
        install_dir = os.path.join(install_dir, "model_presets")
    install_dir = os.path.normcase(os.path.realpath(install_dir))
    base_root = None
    extra_roots = []
    for i, root in enumerate(roots):
        if not root or not isinstance(root, str):
            continue
        if os.path.normcase(os.path.realpath(root)) == install_dir:
            base_root = {"index": i, "path": root, "label": "Comfy Install", "is_install": True}
        else:
            extra_roots.append({"index": i, "path": root, "label": "", "is_install": False})

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

_MODEL_EXTS = (".safetensors", ".ckpt", ".pt", ".pth", ".bin", ".sft")
_IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp")

_BROWSE_FILTERS = {
    "checkpoints": _MODEL_EXTS,
    "loras": _MODEL_EXTS,
    "vae": _MODEL_EXTS,
    "text_encoders": (*_MODEL_EXTS, ".gguf"),
    "diffusion_models": (*_MODEL_EXTS, ".gguf"),
    "flakes": (".yaml", ".yml"),
    "inputs": _IMAGE_EXTS,
    "output": _IMAGE_EXTS,
    "flake_images": _IMAGE_EXTS,
    "models": _IMAGE_EXTS,
    "lora_images": _IMAGE_EXTS,
}
_BROWSE_TYPES = tuple(_BROWSE_FILTERS)


def _get_browse_roots(browse_type: str) -> list[str]:
    """Resolve folder roots dynamically at request time."""
    if browse_type == "inputs":
        roots = [folder_paths.get_input_directory()]
    elif browse_type == "output":
        roots = [folder_paths.get_output_directory()]
    elif browse_type == "models":
        roots = [folder_paths.models_dir]
    elif browse_type == "flake_images":
        roots = folder_paths.get_folder_paths("flakes")
    elif browse_type == "lora_images":
        roots = folder_paths.get_folder_paths("loras")
    else:
        roots = folder_paths.get_folder_paths(browse_type)
    return [r for r in roots if r and os.path.isdir(r)]


@routes.get("/flakes/image")
async def _get_image(request: web.Request) -> web.Response:
    """Serve an image by absolute path for the file picker and editor previews,
    confined to the ComfyUI folders the picker browses."""
    path = request.query.get("path", "").strip()
    if not path or os.path.splitext(path)[1].lower() not in _IMAGE_EXTS:
        return _bad_request("'path' must be an image file")
    if not any(flake_io._is_inside(path, root) for root in flake_io.picker_roots()):
        return _bad_request("path is outside the browsable folders")
    if not os.path.isfile(path):
        return _not_found(f"image not found: {path}")
    return web.FileResponse(path)


def _drive(path: str) -> str:
    return os.path.splitdrive(os.path.abspath(path))[0].upper()


def _default_drive(drives: list[str]) -> str:
    """An extra model path's drive when one is in use, else ComfyUI's own."""
    base = _drive(folder_paths.models_dir)
    return next((d for d in drives if d != base), base if base in drives else drives[0])


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
    drive = (body.get("drive") or "").strip()

    if browse_type not in _BROWSE_TYPES:
        return _bad_request(f"invalid browse type: {browse_type!r}")

    roots = _get_browse_roots(browse_type)
    exts = _BROWSE_FILTERS.get(browse_type, ())

    if not roots:
        return _server_error(f"no roots configured for {browse_type!r}")

    seen: set[str] = set()  # normcase'd names: one entry per folder on Windows, whatever the case
    entries: list[dict[str, str]] = []
    valid_target_found = False

    # (base, path under base) pairs to list. models/<category>/ also lists the
    # category's extra model paths, like ComfyUI resolves them.
    targets = [(base, rel_path) for base in roots]
    categories = {
        name: [p for p in folder_paths.get_folder_paths(name) if os.path.isdir(p)]
        for name in folder_paths.folder_names_and_paths if name != "custom_nodes"
    } if browse_type == "models" else {}
    category, _, rest = rel_path.replace("\\", "/").partition("/")
    if category in categories:
        targets += [(p, rest) for p in categories[category]]

    # Folders on different drives are never merged: the picker shows one drive
    # at a time and switches between them (C:, D:, ...).
    drives = sorted({_drive(b) for b in roots} | {_drive(p) for paths in categories.values() for p in paths})
    if drive not in drives:
        drive = _default_drive(drives)
    targets = [(b, r) for b, r in targets if _drive(b) == drive]
    if browse_type == "models" and not category:
        for name, paths in categories.items():
            if os.path.normcase(name) not in seen and any(_drive(p) == drive for p in paths):
                seen.add(os.path.normcase(name))
                entries.append({"name": name, "type": "dir"})

    for base, rel in targets:
        target = os.path.normpath(os.path.join(base, rel)) if rel else base

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
                if os.path.normcase(item) in seen:
                    continue
                seen.add(os.path.normcase(item))
                full = os.path.join(target, item)
                if os.path.isdir(full):
                    entries.append({"name": item, "type": "dir"})
                elif os.path.isfile(full):
                    if exts and not item.lower().endswith(exts):
                        continue
                    entries.append({"name": item, "type": "file", "path": full})
        except Exception:
            continue

    if not valid_target_found and not entries:
        return _not_found(f"directory not found: {rel_path}")

    return web.json_response({"path": rel_path, "entries": entries, "drive": drive, "drives": drives})


# ---------------------------------------------------------------------------
# Reveal an output image in the OS file explorer (#329)
# ---------------------------------------------------------------------------

@routes.post("/flakes/reveal")
async def _reveal_image(request: web.Request) -> web.Response:
    """Open the OS file explorer at a generated image, selecting it when possible.

    The client posts {filename, subfolder, type}; the absolute path is resolved
    server-side via folder_paths so no absolute path is trusted from the browser.
    """
    try:
        body = await request.json()
    except Exception:
        return _bad_request("invalid JSON body")
    if not isinstance(body, dict):
        return _bad_request("body must be a JSON object")

    filename = (body.get("filename") or "").strip()
    if not filename:
        return _bad_request("missing 'filename'")
    subfolder = (body.get("subfolder") or "").strip()
    folder_type = (body.get("type") or "output").strip()

    try:
        base = folder_paths.get_directory_by_type(folder_type) or folder_paths.get_output_directory()
    except Exception:
        base = folder_paths.get_output_directory()

    target = os.path.normpath(os.path.join(base, subfolder, filename))
    # Confine the target to the resolved base directory.
    real_base, real_target = os.path.realpath(base), os.path.realpath(target)
    if os.path.commonpath([real_base, real_target]) != real_base:
        return _bad_request("path escapes the output directory")
    if not os.path.exists(real_target):
        return _not_found(f"image not found: {filename}")

    import subprocess
    import sys
    try:
        if sys.platform.startswith("win"):
            subprocess.Popen(["explorer", "/select,", real_target])
        elif sys.platform == "darwin":
            subprocess.Popen(["open", "-R", real_target])
        else:
            subprocess.Popen(["xdg-open", os.path.dirname(real_target)])
    except Exception as exc:
        logging.exception("[flakes] failed to reveal %s", real_target)
        return _server_error(str(exc))
    return web.json_response({"ok": True, "path": real_target})
