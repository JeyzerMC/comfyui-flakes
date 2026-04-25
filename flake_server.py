from __future__ import annotations

import logging

from aiohttp import web
from server import PromptServer

from . import flake_io

routes = PromptServer.instance.routes


def _bad_request(msg: str) -> web.Response:
    return web.json_response({"error": msg}, status=400)


def _not_found(msg: str) -> web.Response:
    return web.json_response({"error": msg}, status=404)


def _server_error(msg: str) -> web.Response:
    return web.json_response({"error": msg}, status=500)


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
