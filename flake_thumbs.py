"""Downscaled cover images for grids and pickers (#451), cached as WebP in
ComfyUI's temp dir and keyed by source path, mtime and size so an edited
cover gets a new thumbnail."""
from __future__ import annotations

import hashlib
import os
import tempfile

from PIL import Image, ImageOps

import folder_paths


def thumbnail(path: str, px: int) -> str:
    """Path of a WebP copy of the image at *path* fitting in px x px."""
    st = os.stat(path)
    key = hashlib.sha1(f"{os.path.abspath(path)}|{st.st_mtime_ns}|{st.st_size}|{px}".encode()).hexdigest()
    folder = os.path.join(folder_paths.get_temp_directory(), "flakes_thumbs")
    out = os.path.join(folder, f"{key}.webp")
    if os.path.isfile(out):
        return out
    with Image.open(path) as img:
        thumb = ImageOps.exif_transpose(img)
        thumb.thumbnail((px, px))
        os.makedirs(folder, exist_ok=True)
        # Write then rename: a concurrent request for the same cover must never
        # serve a half-written file.
        fd, tmp = tempfile.mkstemp(dir=folder, suffix=".tmp")
        with os.fdopen(fd, "wb") as f:
            thumb.save(f, "WEBP", quality=85)
    os.replace(tmp, out)
    return out
