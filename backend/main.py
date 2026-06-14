"""
NeuroHEX Backend — FastAPI v2.0  (ICADHI 2026)
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import logging

from routers import segmentation, tumor, health

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)

app = FastAPI(
    title="NeuroHEX API",
    description="Deep-learning MRI analysis backend — ICADHI 2026",
    version="2.0.0",
)

# ── CORS — allow Vite dev server (port 5173) and any other origin ─────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],           # tighten to ["http://localhost:5173"] for prod
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router,       tags=["health"])
app.include_router(segmentation.router, prefix="/segment", tags=["segmentation"])
app.include_router(tumor.router,        prefix="/tumor",   tags=["tumor"])


@app.get("/version")
async def version():
    return {
        "service": "NeuroHEX API",
        "version": "2.0.0",
        "segmentation_model": "SynthSeg (Billot et al., Nature Methods 2023)",
        "tumor_model":        "BraTS 2020 ONNX (demo fallback active)",
        "competition":        "ICADHI 2026",
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)