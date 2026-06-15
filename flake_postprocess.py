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
