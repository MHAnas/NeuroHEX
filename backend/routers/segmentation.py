"""
/segment  —  SynthSeg 32-region parcellation
POST body: multipart/form-data  field "file" = NIfTI (.nii / .nii.gz)
Returns:   UNCOMPRESSED binary NIfTI-1 label map (int16, FreeSurfer label IDs)
"""

from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import Response
import tempfile, shutil, logging, time
from pathlib import Path

from services.synthseg_runner import run_synthseg

log = logging.getLogger("neurohex.segment")
router = APIRouter()


@router.post("")
async def segment(file: UploadFile = File(...)):
    name = (file.filename or "scan.nii").lower()
    if not (name.endswith(".nii") or name.endswith(".nii.gz")):
        raise HTTPException(status_code=400, detail="Only .nii / .nii.gz accepted.")

    t0 = time.perf_counter()
    log.info(f"Received file: {file.filename} ({file.size or '?'} bytes)")

    with tempfile.TemporaryDirectory(prefix="neurohex_") as tmpdir:
        in_path  = Path(tmpdir) / (file.filename or "scan.nii")
        # Always request UNCOMPRESSED output so the browser can parse it raw
        out_path = Path(tmpdir) / "labels.nii"

        with open(in_path, "wb") as f:
            shutil.copyfileobj(file.file, f)

        log.info(f"Running SynthSeg on {in_path} …")
        label_bytes = await run_synthseg(str(in_path), str(out_path))

    elapsed = time.perf_counter() - t0
    log.info(f"Done in {elapsed:.1f}s — {len(label_bytes)} bytes")

    return Response(
        content=label_bytes,
        media_type="application/octet-stream",
        headers={
            "X-NeuroHEX-Elapsed":       f"{elapsed:.1f}",
            "X-Model":                  "SynthSeg-Billot2023",
            "Content-Disposition":      'attachment; filename="labels.nii"',
            "Access-Control-Expose-Headers": "X-NeuroHEX-Elapsed,X-Model",
        },
    )