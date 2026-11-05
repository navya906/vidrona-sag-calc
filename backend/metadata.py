"""
Camera metadata from drone / phone photos: EXIF (GPS, altitude, focal length) and DJI XMP
(relative altitude, gimbal angles). Everything is optional - a missing or broken block never
raises; the caller gets None for whatever is absent.
"""
from __future__ import annotations

import re
from fractions import Fraction
from typing import Any, Optional

import piexif

_XMP_FIELDS = {
    "relative_altitude_m": ("RelativeAltitude", float),
    "gimbal_pitch_deg": ("GimbalPitchDegree", float),
    "gimbal_yaw_deg": ("GimbalYawDegree", float),
    "flight_yaw_deg": ("FlightYawDegree", float),
}


def _ratio(v: Any) -> Optional[float]:
    try:
        if isinstance(v, tuple) and len(v) == 2:
            return float(Fraction(int(v[0]), int(v[1]))) if v[1] else None
        return float(v)
    except (TypeError, ValueError, ZeroDivisionError):
        return None


def _dms(coord: Any, ref: Any) -> Optional[float]:
    try:
        d, m, s = (_ratio(c) for c in coord)
        if None in (d, m, s):
            return None
        val = d + m / 60 + s / 3600
        return -val if ref in (b"S", b"W", "S", "W") else val
    except (TypeError, ValueError):
        return None


def _xmp(data: bytes) -> dict[str, Optional[float]]:
    out: dict[str, Optional[float]] = {k: None for k in _XMP_FIELDS}
    start = data.find(b"<x:xmpmeta")
    if start < 0:
        return out
    block = data[start:data.find(b"</x:xmpmeta>", start) + 12].decode("utf-8", "ignore")
    for key, (tag, cast) in _XMP_FIELDS.items():
        m = re.search(rf'drone-dji:{tag}="([-+]?[0-9.]+)"', block) or re.search(rf"<drone-dji:{tag}>([-+]?[0-9.]+)<", block)
        if m:
            try:
                out[key] = cast(m.group(1))
            except ValueError:
                pass
    return out


def read(data: bytes) -> dict[str, Any]:
    out: dict[str, Any] = {
        "latitude": None, "longitude": None, "altitude_m": None,
        "focal_length_mm": None, "focal_length_35mm": None, "camera": None, "taken_at": None,
        **{k: None for k in _XMP_FIELDS},
    }
    try:
        ex = piexif.load(data)
    except Exception:
        ex = {}
    zero, exif, gps = ex.get("0th", {}) or {}, ex.get("Exif", {}) or {}, ex.get("GPS", {}) or {}
    try:
        make = (zero.get(piexif.ImageIFD.Make) or b"").decode("utf-8", "ignore").strip("\x00 ")
        model = (zero.get(piexif.ImageIFD.Model) or b"").decode("utf-8", "ignore").strip("\x00 ")
        out["camera"] = " ".join(x for x in (make, model) if x) or None
        taken = exif.get(piexif.ExifIFD.DateTimeOriginal)
        out["taken_at"] = taken.decode("utf-8", "ignore").strip("\x00 ") if taken else None
        out["focal_length_mm"] = _ratio(exif.get(piexif.ExifIFD.FocalLength))
        f35 = exif.get(piexif.ExifIFD.FocalLengthIn35mmFilm)
        out["focal_length_35mm"] = float(f35) if f35 else None
        if gps:
            out["latitude"] = _dms(gps.get(piexif.GPSIFD.GPSLatitude), gps.get(piexif.GPSIFD.GPSLatitudeRef))
            out["longitude"] = _dms(gps.get(piexif.GPSIFD.GPSLongitude), gps.get(piexif.GPSIFD.GPSLongitudeRef))
            alt = _ratio(gps.get(piexif.GPSIFD.GPSAltitude))
            if alt is not None and gps.get(piexif.GPSIFD.GPSAltitudeRef) == 1:
                alt = -alt
            out["altitude_m"] = alt
    except Exception:
        pass
    out.update({k: v for k, v in _xmp(data).items() if v is not None})
    out["available"] = any(v is not None for k, v in out.items() if k not in ("camera", "taken_at"))
    return out
