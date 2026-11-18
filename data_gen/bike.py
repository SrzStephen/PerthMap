"""The `bike` stage: ride times from every grid cell to the CBD, and real ride paths per ~500 m block.

Output (data/results/web/): `bike.grid.bin` and `bike.routes.json`, plus a `bike` entry in `index.json`.
See docs/superpowers/specs/2026-11-18-cycling-design.md and data_gen/README.md for the formats.
"""
from __future__ import annotations

import gzip
import struct

import numpy as np

from elevation import Dem, along, climb, interpolate_water, sample_positions
from pipeline import GridMeta, decode_polyline, encode_polyline, to_metres

BIKE_MAGIC, BIKE_VERSION = b"PMB1", 1
U16_NA = 0xFFFF


def encode_bike_grid(seconds: np.ndarray, path: np.ndarray, cells: np.ndarray, meta: GridMeta) -> bytes:
    """gzip of "PMB1", u16 version, u32 width, u32 height, then u16 planes `seconds` and `path` (row 0 = south).

    `seconds`/`path` are per listed cell (`cells` = flat indices); NaN seconds and path -1 become 0xFFFF."""
    n = meta.width * meta.height
    sec = np.full(n, U16_NA, dtype="<u2")
    pth = np.full(n, U16_NA, dtype="<u2")
    s = np.asarray(seconds, dtype=float)
    ok = np.isfinite(s)
    sec[cells[ok]] = np.clip(np.rint(s[ok]), 0, U16_NA - 1).astype("<u2")
    p = np.asarray(path, dtype=np.int64)
    pth[cells[p >= 0]] = p[p >= 0].astype("<u2")
    header = struct.pack("<4sHII", BIKE_MAGIC, BIKE_VERSION, meta.width, meta.height)
    return gzip.compress(header + sec.tobytes() + pth.tobytes(), 9)


def decode_bike_grid(b: bytes) -> dict[str, np.ndarray]:
    raw = gzip.decompress(b)
    magic, version, w, h = struct.unpack_from("<4sHII", raw)
    assert magic == BIKE_MAGIC and version == BIKE_VERSION
    n, o = w * h, 14
    return {"seconds": np.frombuffer(raw, "<u2", n, o), "path": np.frombuffer(raw, "<u2", n, o + 2 * n)}


def representatives(cells: np.ndarray, reachable: np.ndarray, meta: GridMeta,
                    block: int) -> tuple[np.ndarray, np.ndarray]:
    """One representative per block x block cells: the reachable cell nearest the block centre.

    Returns (cell index of each representative, per listed cell the index of its block's representative or -1)."""
    cells = np.asarray(cells, dtype=np.int64)
    x, y = cells % meta.width, cells // meta.width
    bx, by = x // block, y // block
    blocks = by * ((meta.width + block - 1) // block) + bx
    centre = (block - 1) / 2
    d2 = (x - bx * block - centre) ** 2 + (y - by * block - centre) ** 2
    cand = np.flatnonzero(reachable)
    # per block: smallest distance, ties -> lowest cell index
    order = cand[np.lexsort((cells[cand], d2[cand], blocks[cand]))]
    first = np.r_[True, blocks[order][1:] != blocks[order][:-1]] if order.size else np.array([], bool)
    reps = order[first]
    rep_cells = cells[reps]
    rep_of_block = dict(zip(blocks[reps].tolist(), range(len(reps))))
    block_of = np.array([rep_of_block.get(b, -1) for b in blocks.tolist()], dtype=np.int64)
    return rep_cells, block_of


SIMPLIFY_DEG = 0.00005  # ~5 m, as RouteTables
ELEV_STEP_M = 50


class SegmentTable:
    """Bike path segments shared between paths, with heights.

    A segment is one MOTIS step, keyed by (previous step's toOsmNode, its toOsmNode); a path's first step is keyed
    with its start cell too, so it is never shared. Rides converging on the city therefore store common streets
    once. A segment's heights come from the first path that registers it (sampled every ELEV_STEP_M with that
    path's context for bridge interpolation) and are reused by later paths."""

    def __init__(self, dem: Dem | None, is_wet):
        self.dem = dem
        self.is_wet = is_wet
        self._index: dict[tuple, int] = {}
        self._points: list[np.ndarray] = []
        self._lengths: list[float] = []
        self._heights: list[np.ndarray | None] = []  # absolute, rounded metres; None = no elevation data

    def _register(self, key: tuple, polyline: dict) -> int:
        pts = np.asarray(decode_polyline(polyline["points"], polyline.get("precision", 6)))
        xy = to_metres(pts[:, 0], pts[:, 1])
        self._index[key] = len(self._points)
        self._points.append(pts)
        self._lengths.append(float(np.hypot(*np.diff(xy, axis=0).T).sum()) if len(pts) > 1 else 0.0)
        self._heights.append(None)
        return self._index[key]

    def add_path(self, start_cell: int, leg: dict) -> list:
        """[seconds, metres, ascent, descent, [segment ids]] for a MOTIS direct bike leg."""
        ids, new = [], set()
        prev = None
        for k, st in enumerate(leg.get("steps") or []):
            node = st.get("toOsmNode")
            key = (prev, node) if k else (None, node, start_cell)
            prev = node
            if key not in self._index:
                new.add(self._register(key, st["polyline"]))
            ids.append(self._index[key])
        if self.dem is not None and new:
            self._sample_heights(ids, new)

        ascent = descent = None
        if ids and all(self._heights[s] is not None for s in ids):
            ascent, descent = climb(np.concatenate([self._heights[s][1 if j else 0:] for j, s in enumerate(ids)]))
        return [int(round(leg["duration"])), int(round(leg["distance"])), ascent, descent, ids]

    def _sample_heights(self, ids: list[int], new: set[int]) -> None:
        """Heights for the path's new segments: raw DEM samples, bridges interpolated along the whole path
        (known segments contribute their stored heights). A new segment with any sample outside the DEM stays None."""
        parts, wets, missing = [], [], []
        for j, s in enumerate(ids):
            if s in new:
                lat, lon = along(self._points[s], sample_positions(self._lengths[s], ELEV_STEP_M))
                h = self.dem.sample(lat, lon)
                w = np.asarray(self.is_wet(lat, lon), bool) | np.isnan(h)
                missing.append(bool(np.isnan(h).any()))
            else:
                stored = self._heights[s]
                h = np.full(1, np.nan) if stored is None else stored.astype(float)
                w = np.isnan(h)
                missing.append(True)
            drop = 1 if j else 0  # the joint sample is the previous segment's last one
            parts.append(h[drop:])
            wets.append(w[drop:])
        fixed = interpolate_water(np.concatenate(parts), np.concatenate(wets))
        o = 0
        for j, s in enumerate(ids):
            n = len(parts[j])
            if s in new and not missing[j]:
                self._heights[s] = np.rint(fixed[o - 1:o + n] if j else fixed[o:o + n])  # joint included again
            o += n

    def finalize(self) -> dict:
        """{"shapes": encoded polylines (precision 5, ~5 m simplified), "lengths": metres, "elev": [h0, Δ…] | None}."""
        from shapely import LineString

        shapes = []
        for pts in self._points:
            if len(pts) > 2:
                pts = np.asarray(LineString(pts[:, ::-1]).simplify(SIMPLIFY_DEG).coords)[:, ::-1]
            shapes.append(encode_polyline([tuple(p) for p in pts], 5))
        elev = [None if h is None else [int(h[0]), *np.diff(h).astype(int).tolist()] for h in self._heights]
        return {"shapes": shapes, "lengths": [round(x) for x in self._lengths], "elev": elev}
