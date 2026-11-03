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
import vision
from schemas import CalcRequest, CalcResult, Meta, VectorizeResult

MAX_UPLOAD = 15 * 1024 * 1024

app = FastAPI(title="Sag & Clearance Analyser", version="1.0.0")
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
    return engine.calculate(req)


@app.post("/api/vectorize", response_model=VectorizeResult)
def vectorize(file: UploadFile = File(...), max_curves: int = Query(3, ge=1, le=6)) -> dict:
    # sync def -> FastAPI runs this CPU-bound work in its threadpool, keeping the event loop free
    data = file.file.read(MAX_UPLOAD + 1)
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, "Image too large (max 15 MB)")
    try:
        return vision.vectorize(data, max_curves)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e


DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if DIST.is_dir():
    app.mount("/", StaticFiles(directory=DIST, html=True), name="app")
