"""Heights along bike paths from SRTM `.hgt` tiles.

A tile named like S32E115 has its south-west corner at lat -32, lon 115 and spans one degree; it is a square of
big-endian int16 metres, row 0 = north edge, with the edge rows/columns shared with neighbouring tiles. SRTM is a
surface model (treetops, roofs, the water under bridges), hence the median filter and `interpolate_water`.
"""
from __future__ import annotations

import math
from pathlib import Path

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view

from pipeline import BBox, to_metres

VOID = -32768


def _tile_corner(path: Path) -> tuple[float, float]:
    """(north, west) of a tile from its name."""
    name = path.stem.upper()
    lat = int(name[1:3]) * (-1 if name[0] == "S" else 1)
    lon = int(name[4:7]) * (-1 if name[3] == "W" else 1)
    return lat + 1, lon


def fill_voids(h: np.ndarray) -> np.ndarray:
    """Replace VOID cells by the mean of their valid 3x3 neighbours, repeatedly, until none are left (or stuck)."""
    h = h.astype(float)
    void = h == VOID
    while void.any():
        vals = np.pad(np.where(void, 0.0, h), 1)
        ok = np.pad(~void, 1).astype(float)
        sums = sliding_window_view(vals, (3, 3)).sum(axis=(2, 3))
        counts = sliding_window_view(ok, (3, 3)).sum(axis=(2, 3))
        fillable = void & (counts > 0)
        if not fillable.any():
            break
        h[fillable] = sums[fillable] / counts[fillable]
        void &= ~fillable
    return h


def _window(h: np.ndarray, size: int, reduce, rows_per_chunk: int = 256) -> np.ndarray:
    """size x size moving `reduce` with edge padding (chunked by rows to bound memory)."""
    r = size // 2
    padded = np.pad(h, r, mode="edge")
    out = np.empty(h.shape, dtype=float)
    for y in range(0, h.shape[0], rows_per_chunk):
        block = padded[y:y + rows_per_chunk + 2 * r]
        out[y:y + rows_per_chunk] = reduce(sliding_window_view(block, (size, size)), axis=(2, 3))
    return out


def median_filter(h: np.ndarray, size: int = 5) -> np.ndarray:
    return _window(h, size, np.median)


def opening(h: np.ndarray, size: int = 9) -> np.ndarray:
    """Grey-scale opening (min then max filter): removes raised objects narrower than the window - CBD towers,
    stands of trees - and keeps wider landforms, turning SRTM's surface heights into ground heights."""
    return _window(_window(h, size, np.min), size, np.max)


class Dem:
    """Grid-registered heights: heights[i, j] is at (north - i * step, west + j * step)."""

    def __init__(self, heights: np.ndarray, north: float, west: float, step: float):
        self.heights = np.asarray(heights, dtype=float)
        self.north, self.west, self.step = north, west, step

    @classmethod
    def from_tiles(cls, paths: list[Path], bbox: BBox) -> "Dem":
        """Mosaic of the tiles cropped to `bbox`: voids filled, 9x9 opening (ground, not roofs), 5x5 median."""
        tiles = []
        for p in paths:
            raw = np.fromfile(p, dtype=">i2")
            n = math.isqrt(raw.size)
            if n * n != raw.size:
                raise ValueError(f"{p}: not a square .hgt tile")
            tiles.append((*_tile_corner(Path(p)), raw.reshape(n, n)))
        n = tiles[0][2].shape[0]
        step = 1 / (n - 1)
        north = max(t[0] for t in tiles)
        west = min(t[1] for t in tiles)
        rows = round((north - (min(t[0] for t in tiles) - 1)) / step) + 1
        cols = round(((max(t[1] for t in tiles) + 1) - west) / step) + 1
        mosaic = np.full((rows, cols), VOID, dtype=np.int16)
        for t_north, t_west, h in tiles:
            i0, j0 = round((north - t_north) / step), round((t_west - west) / step)
            mosaic[i0:i0 + n, j0:j0 + n] = h
        i0 = max(0, math.floor((north - bbox.max_lat) / step))
        i1 = min(rows, math.ceil((north - bbox.min_lat) / step) + 1)
        j0 = max(0, math.floor((bbox.min_lon - west) / step))
        j1 = min(cols, math.ceil((bbox.max_lon - west) / step) + 1)
        crop = median_filter(opening(fill_voids(mosaic[i0:i1, j0:j1])))
        return cls(crop, north - i0 * step, west + j0 * step, step)

    def sample(self, lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
        """Bilinear heights; NaN outside the covered area."""
        y = (self.north - np.asarray(lat, dtype=float)) / self.step
        x = (np.asarray(lon, dtype=float) - self.west) / self.step
        rows, cols = self.heights.shape
        out = np.full(y.shape, np.nan)
        ok = (y >= 0) & (x >= 0) & (y <= rows - 1) & (x <= cols - 1)
        y, x = y[ok], x[ok]
        i0 = np.minimum(np.floor(y).astype(int), rows - 2) if rows > 1 else np.zeros(y.shape, int)
        j0 = np.minimum(np.floor(x).astype(int), cols - 2) if cols > 1 else np.zeros(x.shape, int)
        fy, fx = y - i0, x - j0
        h = self.heights
        i1, j1 = np.minimum(i0 + 1, rows - 1), np.minimum(j0 + 1, cols - 1)
        out[ok] = (h[i0, j0] * (1 - fy) * (1 - fx) + h[i0, j1] * (1 - fy) * fx
                   + h[i1, j0] * fy * (1 - fx) + h[i1, j1] * fy * fx)
        return out


def sample_positions(length_m: float, step: float = 50) -> np.ndarray:
    """0, step, 2*step, ... and always `length_m` itself."""
    if length_m <= 0:
        return np.array([0.0])
    pos = np.arange(0, length_m, step, dtype=float)
    return np.append(pos, float(length_m))


def along(points: np.ndarray, at_m: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """(lat, lon) at distances along a (lat, lon) polyline; clamped to its ends."""
    pts = np.asarray(points, dtype=float)
    xy = to_metres(pts[:, 0], pts[:, 1])
    cum = np.concatenate([[0.0], np.cumsum(np.hypot(*np.diff(xy, axis=0).T))])
    return np.interp(at_m, cum, pts[:, 0]), np.interp(at_m, cum, pts[:, 1])


def interpolate_water(heights: np.ndarray, wet: np.ndarray) -> np.ndarray:
    """Wet samples (bridges: SRTM records the water) interpolated by index from the nearest dry ones."""
    heights = np.asarray(heights, dtype=float)
    wet = np.asarray(wet, dtype=bool)
    dry = np.flatnonzero(~wet)
    if dry.size == 0 or not wet.any():
        return heights.copy()
    out = heights.copy()
    idx = np.flatnonzero(wet)
    out[idx] = np.interp(idx, dry, heights[dry])  # np.interp holds the end values outside [first, last] dry
    return out


def climb(heights: np.ndarray, hysteresis: float = 10.0) -> tuple[int, int]:
    """(ascent, descent) in whole metres between turning points; a peak or valley only counts once the profile
    reverses by more than `hysteresis` (10 m by default: SRTM's trees and roofs add wiggles of several metres)."""
    h = np.asarray(heights, dtype=float)
    if h.size == 0:
        return 0, 0
    pivots, trend, ext = [h[0]], 0, h[0]
    for x in h[1:]:
        if trend == 0:
            if abs(x - pivots[0]) >= hysteresis:
                trend, ext = (1 if x > pivots[0] else -1), x
        elif (x - ext) * trend > 0:
            ext = x
        elif abs(x - ext) >= hysteresis:
            pivots.append(ext)
            trend, ext = -trend, x
    if trend:
        pivots.append(ext)
    d = np.diff(pivots)
    return round(d[d > 0].sum()), round(-d[d < 0].sum())
