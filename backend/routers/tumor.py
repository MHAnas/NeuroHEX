"""
/tumor  —  BraTS brain tumor segmentation
POST body: multipart/form-data  field "file" = raw NIfTI (.nii / .nii.gz)
Returns:   JSON with tumor volumes (cm³) + binary NIfTI label map (base64)
"""

from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse
import tempfile, shutil, logging, time, base64
from pathlib import Path

from services.tumor_runner import run_tumor_detection

log = logging.getLogger("neurohex.tumor")
router = APIRouter()


@router.post("")
async def tumor(file: UploadFile = File(...)):
    """
    Accept a NIfTI, run BraTS ONNX tumor segmentation.
    Returns volumes in cm³ for edema, enhancing, necrotic classes + label map.
    """
    if not (file.filename.endswith(".nii") or file.filename.endswith(".nii.gz")):
        raise HTTPException(status_code=400, detail="NIfTI files only.")

    t0 = time.perf_counter()
    log.info(f"Tumor detection — file: {file.filename}")

    with tempfile.TemporaryDirectory(prefix="neurohex_tumor_") as tmpdir:
        in_path = Path(tmpdir) / file.filename
        with open(in_path, "wb") as f:
            shutil.copyfileobj(file.file, f)

        result = await run_tumor_detection(str(in_path))

    elapsed = time.perf_counter() - t0
    log.info(f"Tumor detection done in {elapsed:.1f}s")

    # Encode label map as base64 for JSON transport
    label_b64 = base64.b64encode(result["label_bytes"]).decode("ascii")

    return JSONResponse({
        "elapsed_s":       round(elapsed, 2),
        "model":           "BraTS-2020-ONNX",
        "edema_cm3":       result["edema_cm3"],
        "enhancing_cm3":   result["enhancing_cm3"],
        "necrotic_cm3":    result["necrotic_cm3"],
        "total_tumor_cm3": result["total_cm3"],
        "classification":  result["classification"],
        "label_nii_b64":   label_b64,
        "citation":        "BraTS 2020 — Menze et al. IEEE TMI 2015",
    })