"""
FastAPI backend - Transmission Line Sag & Clearance Analyser (no auth, no database).

    uvicorn main:app --port 8000

If ../frontend/dist exists (npm run build) the React app is served from "/" too.
"""
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

import engine
import metadata
import vision
import vision_drone
from schemas import CalcRequest, CalcResult, Meta, PhotoResult, VectorizeResult

MAX_UPLOAD = 15 * 1024 * 1024

app = FastAPI(title="Sag & Clearance Analyser", version="1.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173"], allow_methods=["GET", "POST"],
                   allow_headers=["*"])

META = Meta(**engine.META)  # static -> validated once at startup


@app.get("/api/meta", response_model=Meta)
def meta() -> Meta:
    return META


@app.post("/api/calculate", response_model=CalcResult)
def calculate(req: CalcRequest) -> dict:
    if req.conductor not in engine.CONDUCTORS and req.custom_conductor is None:
        raise HTTPException(404, f"Conductor '{req.conductor}' not found")
    try:
        return engine.calculate(req)
    except ValueError as e:                     # physically impossible input, e.g. sag implying tension > UTS
        raise HTTPException(422, str(e)) from e


def _read_upload(file: UploadFile) -> bytes:
    data = file.file.read(MAX_UPLOAD + 1)
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, "Image too large (max 15 MB)")
    return data


# Both image routes are sync defs: FastAPI runs the CPU-bound OpenCV work in its threadpool.
@app.post("/api/vectorize", response_model=VectorizeResult)
def vectorize(file: UploadFile = File(...), max_curves: int = Query(3, ge=1, le=6)) -> dict:
    """Side-view image or drawing -> conductor curves, ground line, camera metadata."""
    data = _read_upload(file)
    try:
        return {**vision.vectorize(data, max_curves), "camera": metadata.read(data)}
    except ValueError as e:
        raise HTTPException(422, str(e)) from e


@app.post("/api/analyze-photo", response_model=PhotoResult)
def analyze_photo(file: UploadFile = File(...)) -> dict:
    """Oblique drone photo -> conductors, poles, attachment points, vegetation, leaf contact."""
    data = _read_upload(file)
    try:
        return {**vision_drone.analyze(data), "camera": metadata.read(data)}
    except ValueError as e:
        raise HTTPException(422, str(e)) from e


DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if DIST.is_dir():
    app.mount("/", StaticFiles(directory=DIST, html=True), name="app")
