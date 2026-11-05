"""Pydantic v2 contracts shared by the API and the React client (field names match JSON 1:1)."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

PhaseKey = Literal["A-Y", "A-R", "A-B", "B-Y", "B-R", "B-B"]


# ---------- requests ----------
class Conductor(BaseModel):
    diameter_mm: float = Field(gt=0)
    weight_kg_km: float = Field(gt=0)
    uts_kN: float = Field(gt=0)
    area_mm2: float = Field(gt=0)
    E_GPa: float = Field(gt=0)
    alpha: float = Field(gt=0)
    verified: bool = False


class TreeInput(BaseModel):
    height: float = Field(gt=0, le=80)
    x: float = Field(ge=0)                    # position along span (m)
    offset: float = 0                         # horizontal distance from line centre (m)
    canopy_radius: float = Field(2.0, ge=0)
    growth_rate: float = Field(0.5, ge=0)     # m / year
    clearance_override: Optional[float] = Field(None, gt=0)


class Measured(BaseModel):
    """Values extracted from an image (already converted to metres)."""
    sag: float = Field(gt=0)
    phase_sags: dict[PhaseKey, float] = {}
    photo_temp: float = Field(35, ge=-20, le=120)     # conductor temperature when the photo was taken (°C)


class CalcRequest(BaseModel):
    voltage_kv: Literal[11, 33, 220]
    location: Literal["elsewhere", "along_street", "across_street"] = "elsewhere"
    insulated: bool = False                       # 11 kV covered conductor
    span: float = Field(gt=5, le=2000)
    attach_height: float = Field(gt=1, le=200)   # lowest phase
    conductor: str = "ACSR Panther"
    custom_conductor: Optional[Conductor] = None
    factor_of_safety: float = Field(2.0, gt=1, le=10)
    tension_kN: Optional[float] = Field(None, gt=0)
    ref_temp: float = 32
    max_temp: float = 75
    wind_pressure: float = Field(0, ge=0)          # Pa
    phase_gap: float = Field(4.0, gt=0)
    phase_offset: float = 0
    phase_sag_dev: dict[PhaseKey, float] = {}      # % deviation per phase
    ratio_warn: float = Field(0.10, gt=0)          # |ratio - 1| tolerance
    ratio_crit: float = Field(0.25, gt=0)
    ground_clearance_override: Optional[float] = Field(None, gt=0)
    assess_at: Optional[Literal["reference", "max_temp"]] = None
    measured: Optional[Measured] = None
    tree: Optional[TreeInput] = None


# ---------- responses ----------
class Requirement(BaseModel):
    value: Optional[float]
    rule: str
    source: str
    verified: bool = False


class Mechanics(BaseModel):
    weight_N_m: float
    tension_ref_kN: float
    tension_max_temp_kN: float
    factor_of_safety: float
    sag_ref: float
    sag_max_temp: float
    sag_max_temp_catenary: float
    catenary_diff_pct: float
    blowout_deg: float
    swing_mid: float
    sag_assessed: float
    assess_at: Literal["reference", "max_temp"]
    lowest_point: float


class Assessment(BaseModel):
    required: Requirement
    severity: Optional[int]
    label: str
    margin: Optional[float]
    passed: Optional[bool]


class GroundResult(Assessment):
    actual: float
    ratio: float


class TreeResult(Assessment):
    distance: float
    conductor_x: float
    conductor_z: float
    years_to_violation: Optional[float]
    max_safe_height_below: Optional[float]


class Phase(BaseModel):
    id: PhaseKey
    arm: Literal["A", "B"]
    phase: Literal["R", "Y", "B"]
    attach: float
    sag: float
    lowest: float


class PhaseRatio(BaseModel):
    arm: Literal["A", "B"]
    pair: str
    tower_gap: float
    midspan_gap: float
    ratio: float
    deviation_pct: float
    sag_ratio: float
    status: Literal["OK", "Warning", "Critical"]


class SweepPoint(BaseModel):
    temp: float
    tension_kN: float
    sag: float


class Point(BaseModel):
    x: float
    y: float


class PhaseProfile(BaseModel):
    id: PhaseKey
    points: list[Point]


class ClearanceRow(BaseModel):
    kv: int
    ground: float
    tree: float


class CalcResult(BaseModel):
    mechanics: Mechanics
    ground: GroundResult
    tree: Optional[TreeResult]
    phases: list[Phase]
    ratios: list[PhaseRatio]
    temperature_sweep: list[SweepPoint]
    phase_profiles: list[PhaseProfile]
    clearance_by_voltage: list[ClearanceRow]
    row_width: Optional[float]
    notes: list[str]


class Meta(BaseModel):
    conductors: dict[str, Conductor]
    presets: dict[int, dict[str, float | str]]
    voltages: list[int]
    sources: dict[str, str]


class Curve(BaseModel):
    attach_left: tuple[float, float]
    attach_right: tuple[float, float]
    lowest: tuple[float, float]
    sag_px: float
    span_px: float
    coverage: float
    points: list[tuple[float, float]]


class Camera(BaseModel):
    available: bool
    camera: Optional[str] = None
    taken_at: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    altitude_m: Optional[float] = None
    relative_altitude_m: Optional[float] = None
    gimbal_pitch_deg: Optional[float] = None
    gimbal_yaw_deg: Optional[float] = None
    flight_yaw_deg: Optional[float] = None
    focal_length_mm: Optional[float] = None
    focal_length_35mm: Optional[float] = None


class VectorizeResult(BaseModel):
    width: int
    height: int
    curves: list[Curve]
    ground_y: float
    ground_method: str
    confidence: float
    camera: Camera


class DroneConductor(BaseModel):
    id: int
    points: list[tuple[float, float]]
    length_px: float
    width_px: float
    contact_pct: float
    contact_segments: list[tuple[float, float, float, float]]
    corridor_vegetation_pct: float
    status: Literal["Contact", "Possible encroachment", "Clear"]


class PhotoResult(BaseModel):
    width: int
    height: int
    conductors: list[DroneConductor]
    poles: list[tuple[int, int, int, int]]
    attachment_points: list[tuple[float, float]]
    vegetation_pct: float
    camera: Camera
