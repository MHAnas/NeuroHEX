from fastapi import APIRouter
from fastapi.responses import JSONResponse
import time

router = APIRouter()


@router.get("/health")
async def health():
    return JSONResponse({
        "status": "ok",
        "timestamp": time.time(),
        "service": "NeuroHEX API v2.0",
        "citation": "SynthSeg — Billot et al., Nature Methods 2023",
    })