"""Optional post-processing for Flake Generate: ADetailer (Face Detailer) and
upscaling (#287, #288).

These features soft-depend on community/core node packs. Rather than importing
those packages directly (their import paths differ across installs), we resolve
the node classes from ComfyUI's global ``NODE_CLASS_MAPPINGS`` at call time and
raise a clear, actionable error if they are missing. Nothing here is imported at
module load, so Flakes still loads fine without the optional packs.

NOTE: external node signatures (especially Impact Pack's ``FaceDetailer.doit``)
vary between versions. The calls below target current mainline signatures and
may need adjustment for your installed versions — verify in a running ComfyUI.
"""
from __future__ import annotations

import logging
from typing import Any


def _node_classes(*names: str) -> dict[str, Any]:
    import nodes
    ncm = getattr(nodes, "NODE_CLASS_MAPPINGS", {})
    return {n: ncm.get(n) for n in names}


def run_face_detailer(
    images,
    model,
    clip,
    vae,
    positive,
    negative,
    seed: int,
    steps: int,
    cfg: float,
    sampler_name: str,
    scheduler: str,
    denoise: float = 0.4,
    bbox_model: str = "bbox/face_yolov8m.pt",
):
    """Run an ADetailer-style face-detail pass using ComfyUI-Impact-Pack.

    Returns the enhanced IMAGE tensor batch, or the input unchanged if the pass
    cannot run. Requires ComfyUI-Impact-Pack (FaceDetailer) and Impact Subpack
    (UltralyticsDetectorProvider).
    """
    cls = _node_classes("FaceDetailer", "UltralyticsDetectorProvider", "SAMLoader")
    FaceDetailer = cls["FaceDetailer"]
    UltralyticsDetectorProvider = cls["UltralyticsDetectorProvider"]
    SAMLoader = cls["SAMLoader"]
    if FaceDetailer is None or UltralyticsDetectorProvider is None:
        raise RuntimeError(
            "ADetailer requires ComfyUI-Impact-Pack (FaceDetailer) and Impact "
            "Subpack (UltralyticsDetectorProvider). Install them and restart ComfyUI."
        )

    bbox_detector = UltralyticsDetectorProvider().doit(bbox_model)[0]
    sam_model_opt = None
    if SAMLoader is not None:
        try:
            sam_model_opt = SAMLoader().load_model("sam_vit_b_01ec64.pth", "AUTO")[0]
        except Exception:
            sam_model_opt = None

    result = FaceDetailer().doit(
        images, model, clip, vae,
        guide_size=512, guide_size_for=True, max_size=1024,
        seed=seed, steps=steps, cfg=cfg, sampler_name=sampler_name, scheduler=scheduler,
        positive=positive, negative=negative, denoise=denoise,
        feather=5, noise_mask=True, force_inpaint=True,
        bbox_threshold=0.5, bbox_dilation=10, bbox_crop_factor=3.0,
        sam_detection_hint="center-1", sam_dilation=0, sam_threshold=0.93,
        sam_bbox_expansion=0, sam_mask_hint_threshold=0.7,
        sam_mask_hint_use_negative="False", drop_size=10,
        bbox_detector=bbox_detector, wildcard="", cycle=1,
        sam_model_opt=sam_model_opt,
    )
    # FaceDetailer.doit returns (image, cropped, cropped_enhanced,
    # cropped_enhanced_alpha, mask, detailer_pipe, cnet_images). [0] is the
    # composited result image.
    enhanced = result[0] if isinstance(result, (tuple, list)) else result
    logging.info("[flakes] ADetailer (FaceDetailer) pass complete")
    return enhanced


def upscale_images(images, upscale_model_name: str = "", factor: float = 1.5):
    """Upscale an IMAGE batch (#288).

    If ``upscale_model_name`` is set, run it through the core ESRGAN-style model
    upscaler first; then rescale so the final size is ``factor`` × the original
    (so the requested factor holds regardless of the model's native scale). Uses
    core ComfyUI nodes; raises a clear error if they are unavailable.
    """
    import comfy.utils

    out = images
    name = (upscale_model_name or "").strip()
    if name and name.lower() not in ("(none)", "none", ""):
        cls = _node_classes("UpscaleModelLoader", "ImageUpscaleWithModel")
        loader = cls["UpscaleModelLoader"]
        applier = cls["ImageUpscaleWithModel"]
        if loader is None or applier is None:
            raise RuntimeError(
                "Upscaling with a model requires the core ComfyUI upscale nodes "
                "(UpscaleModelLoader / ImageUpscaleWithModel)."
            )
        upscale_model = loader().load_model(name)[0]
        out = applier().upscale(upscale_model, out)[0]

    if factor and abs(float(factor) - 1.0) > 1e-3:
        h, w = int(images.shape[1]), int(images.shape[2])
        target_w = max(1, int(round(w * float(factor))))
        target_h = max(1, int(round(h * float(factor))))
        samples = out.movedim(-1, 1)
        samples = comfy.utils.common_upscale(samples, target_w, target_h, "lanczos", "disabled")
        out = samples.movedim(1, -1)

    logging.info("[flakes] upscale pass complete (model=%s factor=%.2f)", name or "none", float(factor))
    return out


def apply_ipadapter_faceid(model, image, weight: float = 0.8, preset: str = "FACEID PLUS V2"):
    """Apply IPAdapter FaceID to a model for consistent-face generation (#289).

    Soft-depends on ComfyUI_IPAdapter_plus, resolved from NODE_CLASS_MAPPINGS.
    Returns the patched model. SDXL-first; requires FaceID models + insightface.
    """
    cls = _node_classes(
        "IPAdapterUnifiedLoaderFaceID", "IPAdapterUnifiedLoader",
        "IPAdapterFaceID", "IPAdapterAdvanced", "IPAdapter",
    )
    loader = cls["IPAdapterUnifiedLoaderFaceID"] or cls["IPAdapterUnifiedLoader"]
    applier = cls["IPAdapterFaceID"] or cls["IPAdapterAdvanced"] or cls["IPAdapter"]
    if loader is None or applier is None:
        raise RuntimeError(
            "Flake IPAdapter requires ComfyUI_IPAdapter_plus (and FaceID models + "
            "insightface). Install it and restart ComfyUI."
        )

    loaded = loader().load_models(model, preset)
    patched_model, ipadapter = loaded[0], loaded[1]

    applied = applier().apply_ipadapter(patched_model, ipadapter, image=image, weight=weight)
    new_model = applied[0] if isinstance(applied, (tuple, list)) else applied
    logging.info("[flakes] IPAdapter FaceID applied (preset=%s weight=%.2f)", preset, float(weight))
    return new_model
