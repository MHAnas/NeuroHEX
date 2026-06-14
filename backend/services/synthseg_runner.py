"""
SynthSeg runner service — NeuroHEX v2.0
"""

import sys
import asyncio
import logging
from pathlib import Path
import numpy as np

log = logging.getLogger("neurohex.synthseg")

# ── Inject SynthSeg into path before any detection ──────────────────────────
_BACKEND_DIR   = Path(__file__).resolve().parent.parent
_SYNTHSEG_ROOT = _BACKEND_DIR / "SynthSeg"

if _SYNTHSEG_ROOT.exists():
    _root_str = str(_SYNTHSEG_ROOT)
    if _root_str not in sys.path:
        sys.path.insert(0, _root_str)
        log.info(f"sys.path ← {_root_str}")
else:
    log.warning(f"SynthSeg folder not found at {_SYNTHSEG_ROOT}")

# ── Detect which backend is available ───────────────────────────────────────
def _has_cmd(cmd):
    import shutil
    return shutil.which(cmd) is not None

HAS_SYNTHSEG_CLI = _has_cmd("mri_synthseg")
HAS_SYNTHSEG_PY  = False

try:
    from SynthSeg.predict import predict as _ss_predict  # noqa
    HAS_SYNTHSEG_PY = True
    log.info("SynthSeg Python API ready")
except Exception as e:
    log.warning(f"SynthSeg Python API unavailable ({type(e).__name__}: {e})")

log.info(
    f"SynthSeg CLI={HAS_SYNTHSEG_CLI} PY={HAS_SYNTHSEG_PY} "
    f"→ {'CLI' if HAS_SYNTHSEG_CLI else 'Python' if HAS_SYNTHSEG_PY else 'DEMO'}"
)


# ── Public entry point ───────────────────────────────────────────────────────
async def run_synthseg(in_path: str, out_path: str) -> bytes:
    if HAS_SYNTHSEG_CLI:
        return await _run_cli(in_path, out_path)
    elif HAS_SYNTHSEG_PY:
        return await _run_python(in_path, out_path)
    else:
        log.warning("SynthSeg unavailable — using demo fallback")
        return await _run_demo_fallback(in_path, out_path)


# ── CLI (FreeSurfer mri_synthseg) ────────────────────────────────────────────
async def _run_cli(in_path, out_path):
    cmd = ["mri_synthseg", "--i", in_path, "--o", out_path, "--parc", "--robust"]
    log.info(f"CLI: {' '.join(cmd)}")
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    stdout, stderr = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(f"mri_synthseg failed:\n{stderr.decode()}")
    return Path(out_path).read_bytes()


# ── Python API ───────────────────────────────────────────────────────────────
async def _run_python(in_path, out_path):
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _synthseg_sync, in_path, out_path)

def _synthseg_sync(in_path, out_path):
    from SynthSeg.predict import predict

    log.info(f"SynthSeg running on {Path(in_path).name} — this takes 60–120s on CPU")

    _SS   = _SYNTHSEG_ROOT
    _DATA = _SS / "data" / "labels_classes_priors"

    path_model          = str(_SS    / "models" / "synthseg_1.0.h5")
    labels_segmentation = str(_DATA  / "synthseg_segmentation_labels.npy")
    names_segmentation  = str(_DATA  / "synthseg_segmentation_names.npy")
    topology_classes    = str(_DATA  / "synthseg_topological_classes.npy")

    log.info(f"Model:  {path_model}")
    log.info(f"Labels: {labels_segmentation}")

    predict(
        path_images=in_path,
        path_segmentations=out_path,
        path_model=path_model,
        labels_segmentation=labels_segmentation,
        names_segmentation=names_segmentation,
        topology_classes=topology_classes,
        verbose=True,
    )

    data = Path(out_path).read_bytes()
    log.info(f"SynthSeg done — {len(data):,} bytes")
    return data
# ── Demo fallback ────────────────────────────────────────────────────────────
async def _run_demo_fallback(in_path, out_path):
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _demo_sync, in_path, out_path)

def _demo_sync(in_path: str, out_path: str) -> bytes:
    import nibabel as nib

    img  = nib.load(in_path)
    data = np.asarray(img.dataobj, dtype=np.float32)
    dims = data.shape[:3]
    flat = data.ravel()
    N    = flat.size

    nonzero = flat[flat > 0]
    if nonzero.size == 0:
        nonzero = flat
    p12 = float(np.percentile(nonzero, 12))
    p38 = float(np.percentile(nonzero, 38))
    p62 = float(np.percentile(nonzero, 62))
    p72 = float(np.percentile(nonzero, 72))

    labels = np.zeros(N, dtype=np.int16)
    labels[(flat >= p12) & (flat <  p38)] = 24
    labels[(flat >= p38) & (flat <  p62)] = 3
    labels[(flat >= p62) & (flat <  p72)] = 2
    labels[flat >= p72]                   = 41

    label_3d = labels.reshape(dims)
    cx = dims[0] // 2
    cy = int(dims[1] * 0.40)
    cz = dims[2] // 2

    # Realistic sphere blobs for each subcortical region
    _BLOBS = [
        (-12,  0, -8,  17, 9),   # hippo L
        ( 12,  0, -8,  53, 9),   # hippo R
        (-10,  6,  0,  10, 11),  # thalamus L
        ( 10,  6,  0,  49, 11),  # thalamus R
        (-18,  4,  0,  12, 10),  # putamen L
        ( 18,  4,  0,  51, 10),  # putamen R
        (-14, 10,  2,  11, 9),   # caudate L
        ( 14, 10,  2,  50, 9),   # caudate R
        (-15,  4,  0,  13, 7),   # pallidum L
        ( 15,  4,  0,  52, 7),   # pallidum R
        (-12, -2,-10,  18, 7),   # amygdala L
        ( 12, -2,-10,  54, 7),   # amygdala R
        (  0,-20,  0,  16, 16),  # brainstem
        (-18,-28,  0,   8, 20),  # cerebellum L
        ( 18,-28,  0,  47, 20),  # cerebellum R
    ]

    for dx, dy, dz, lbl, r in _BLOBS:
        bx, by, bz = cx+dx, cy+dy, cz+dz
        r2 = r * r
        for ix in range(max(0, bx-r), min(dims[0], bx+r+1)):
            for iy in range(max(0, by-r), min(dims[1], by+r+1)):
                for iz in range(max(0, bz-r), min(dims[2], bz+r+1)):
                    if (ix-bx)**2+(iy-by)**2+(iz-bz)**2 <= r2:
                        label_3d[ix, iy, iz] = lbl

    out_img = nib.Nifti1Image(label_3d.astype(np.int16), img.affine, img.header)
    nib.save(out_img, out_path)
    nb = Path(out_path).stat().st_size
    log.info(f"Demo NIfTI written: {out_path} ({nb} bytes, expected ~{N*2})")
    return Path(out_path).read_bytes()