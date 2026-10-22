"""Tests for the file picker's `models` root and the diffusion model sibling
image (#440): models/unet and models/diffusion_models are listed and
browsable, junctioned folders included. flake_server is loaded with aiohttp,
PromptServer and flake_compose stubbed."""
import asyncio
import importlib.util
import os
import sys
import types

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PKG = "_fpkg_browse"


def _load(modname):
    spec = importlib.util.spec_from_file_location(f"{PKG}.{modname}", os.path.join(ROOT, f"{modname}.py"))
    mod = importlib.util.module_from_spec(spec)
    sys.modules[f"{PKG}.{modname}"] = mod
    spec.loader.exec_module(mod)
    return mod


def _setup():
    fp = types.ModuleType("folder_paths")
    fp.get_filename_list = lambda category: []
    fp.base_path = os.getcwd()
    sys.modules["folder_paths"] = fp

    web = types.SimpleNamespace(
        Request=object, Response=lambda body, content_type: types.SimpleNamespace(status=200, body=body, content_type=content_type),
        json_response=lambda data, status=200: types.SimpleNamespace(status=status, data=data))
    sys.modules["aiohttp"] = types.SimpleNamespace(web=web)
    sys.modules["aiohttp.web"] = web
    routes = types.SimpleNamespace(**{m: lambda path: lambda f: f for m in ("get", "post", "put", "delete")})
    sys.modules["server"] = types.SimpleNamespace(PromptServer=types.SimpleNamespace(instance=types.SimpleNamespace(routes=routes)))
    sys.modules["latent_preview"] = types.ModuleType("latent_preview")

    pkg = types.ModuleType(PKG)
    pkg.__path__ = [ROOT]
    sys.modules[PKG] = pkg
    compose = types.ModuleType(f"{PKG}.flake_compose")
    compose.anima_cn_files = None
    sys.modules[f"{PKG}.flake_compose"] = compose
    _load("flake_io")
    return fp, _load("flake_server")


fp, srv = _setup()


@pytest.fixture
def models(tmp_path):
    models = tmp_path / "models"
    for folder, files in {"unet": ["wan_high.safetensors", "wan_high.png"], "diffusion_models": ["h3.png"], "checkpoints": []}.items():
        (models / folder).mkdir(parents=True)
        for f in files:
            (models / folder / f).write_bytes(b"x")
    fp.models_dir = str(models)
    fp.folder_names_and_paths = {
        "checkpoints": ([str(models / "checkpoints")], set()),
        "diffusion_models": ([str(models / "unet"), str(models / "diffusion_models")], set()),
    }
    fp.get_folder_paths = lambda name: fp.folder_names_and_paths[name][0]
    fp.get_full_path = lambda name, f: next((p for d in fp.get_folder_paths(name) if os.path.isfile(p := os.path.join(d, f))), None)
    return models


class _Request:
    def __init__(self, body=None, query=None):
        self.body, self.query = body, query or {}

    async def json(self):
        return self.body


def _browse(path=""):
    return asyncio.run(srv._browse(_Request({"type": "models", "path": path})))


def _names(resp):
    return {e["name"] for e in resp.data["entries"]}


def test_models_root_lists_unet_and_diffusion_models(models):
    assert {"unet", "diffusion_models", "checkpoints"} <= _names(_browse())


def test_unet_lists_its_images(models):
    resp = _browse("unet")
    assert _names(resp) == {"wan_high.png"}
    assert resp.data["entries"][0]["path"] == str(models / "unet" / "wan_high.png")


def test_diffusion_models_merges_unet_images(models):
    assert _names(_browse("diffusion_models")) == {"wan_high.png", "h3.png"}


def test_junctioned_unet_is_browsable(models, tmp_path):
    elsewhere = tmp_path / "elsewhere"
    os.replace(models / "unet", elsewhere)
    try:
        os.symlink(elsewhere, models / "unet", target_is_directory=True)
    except OSError:
        pytest.skip("symlinks not permitted")
    assert _names(_browse("unet")) == {"wan_high.png"}


def test_parent_of_models_is_refused(models):
    assert _browse("..").status == 404


def test_diffusion_model_sibling_image(models):
    resp = asyncio.run(srv._get_diffusion_model_sibling_image(_Request(query={"path": "wan_high.safetensors"})))
    assert (resp.status, resp.content_type) == (200, "image/png")


def test_roots_exclude_temp_local_root(tmp_path):
    fp.get_temp_directory = lambda: str(tmp_path / "temp")
    fp.models_dir = str(tmp_path / "models")
    for kind in ("flakes", "model_presets"):
        real = str(tmp_path / "models" / kind)
        fp.get_folder_paths = lambda k, real=real, kind=kind: [real, srv.flake_io.local_root(kind)]
        roots = asyncio.run(srv._list_roots(_Request(query={"type": kind}))).data["roots"]
        assert [r["index"] for r in roots] == [0]
