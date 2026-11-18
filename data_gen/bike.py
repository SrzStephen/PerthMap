"""The `bike` stage: ride times from every grid cell to the CBD, and real ride paths per ~500 m block.

Output (data/results/web/): `bike.grid.bin` and `bike.routes.json`, plus a `bike` entry in `index.json`.
See docs/superpowers/specs/2026-11-18-cycling-design.md and data_gen/README.md for the formats.
"""
from __future__ import annotations

import gzip
import struct

import numpy as np

from pipeline import GridMeta

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
