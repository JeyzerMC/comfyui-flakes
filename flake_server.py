from __future__ import annotations

import logging

from aiohttp import web
from server import PromptServer

from . import flake_io

routes = PromptServer.instance.routes


@routes.get("/flakes/list")
async def _list_flakes(_request: web.Request) -> web.Response:
    try:
        names = flake_io.list_flakes()
    except Exception as exc:
        logging.exception("[flakes] failed to list flakes")
        return web.json_response({"error": str(exc)}, status=500)
    return web.json_response({"flakes": names})


@routes.get("/flakes/meta")
async def _flake_meta(request: web.Request) -> web.Response:
    name = request.query.get("name", "").strip()
    if not name:
        return web.json_response({"error": "missing 'name' query param"}, status=400)
    try:
        options = flake_io.flake_options(name)
    except FileNotFoundError as exc:
        return web.json_response({"error": str(exc)}, status=404)
    except Exception as exc:
        logging.exception("[flakes] failed to read meta for %s", name)
        return web.json_response({"error": str(exc)}, status=500)
    return web.json_response({"name": name, "options": options})
