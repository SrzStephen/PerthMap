"""Public schools (DET-024) and their local intake areas (Department of Education WA intake-map GeoPDFs)."""
from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

import requests

from pipeline import BBox, log

SLIP_SCHOOLS = ("https://public-services.slip.wa.gov.au/public/rest/services/SLIP_Public_Services/"
                "Education/MapServer/13/query")
INTAKE_MAP = "https://www.det.wa.edu.au/schoolsonline/school_file_download"
YEARS = ["PKG", "KIN", "PPR"] + [f"Y{n:02d}" for n in range(1, 13)]
LAST_PRIMARY = YEARS.index("Y06")
RETRIES = 3


@dataclass
class School:
    code: str
    name: str
    primary: bool
    secondary: bool
    lat: float
    lon: float


def _title(name: str) -> str:
    return " ".join(w.capitalize() for w in name.split())


def _school(p: dict, bbox: BBox) -> School | None:
    if p.get("sector") != "GOVERNMENT" or p.get("lowyear") not in YEARS or p.get("highyear") not in YEARS:
        return None
    lat, lon = p["latitude"], p["longitude"]
    if not (bbox.min_lon <= lon <= bbox.max_lon and bbox.min_lat <= lat <= bbox.max_lat):
        return None
    low, high = YEARS.index(p["lowyear"]), YEARS.index(p["highyear"])
    primary, secondary = low <= LAST_PRIMARY, high > LAST_PRIMARY
    return School(p["code"], _title(p["schoolname"]), primary, secondary, lat, lon)


def fetch_schools(bbox: BBox, session=requests) -> list[School]:
    out, offset = [], 0
    while True:
        r = session.get(SLIP_SCHOOLS, params={"where": "1=1", "outFields": "*", "outSR": 4326, "f": "geojson",
                                              "resultOffset": offset, "orderByFields": "objectid"}, timeout=60)
        r.raise_for_status()
        body = r.json()
        feats = body.get("features", [])
        out += [s for f in feats if (s := _school(f["properties"], bbox))]
        offset += len(feats)
        if not body.get("exceededTransferLimit") or not feats:
            return out


def _get(session, url: str, params: dict) -> bytes:
    for attempt in range(RETRIES + 1):
        try:
            r = session.get(url, params=params, timeout=60)
            if r.status_code < 500:
                r.raise_for_status()
                return r.content
        except (requests.ConnectionError, requests.Timeout):
            if attempt == RETRIES:
                raise
        if attempt == RETRIES:
            raise requests.HTTPError(f"{url} {params}: HTTP {r.status_code}")
        time.sleep(2 ** attempt)
    raise AssertionError("unreachable")


def download_maps(codes: list[str], dest: Path, workers: int = 8, session=None) -> dict[str, list[Path]]:
    """Each school's intake maps (`<code>_1.pdf`, `<code>_2.pdf`); cached results, PDF or known-absent, are reused."""
    dest.mkdir(parents=True, exist_ok=True)
    local = threading.local()

    def sess():
        if session is not None:
            return session
        if not hasattr(local, "s"):
            local.s = requests.Session()
        return local.s

    def one(code: str, n: int) -> Path | None:
        pdf, none = dest / f"{code}_{n}.pdf", dest / f"{code}_{n}.none"
        if pdf.exists():
            return pdf
        if none.exists():
            return None
        body = _get(sess(), INTAKE_MAP, {"schoolID": code, "fileType": f"INTAKE_MAP0{n}", "yearID": "_NA"})
        if not body.startswith(b"%PDF"):
            none.touch()
            return None
        tmp = pdf.with_suffix(".part")
        tmp.write_bytes(body)
        tmp.rename(pdf)
        return pdf

    jobs = [(c, n) for c in codes for n in (1, 2)]
    with ThreadPoolExecutor(workers) as pool:
        results = list(pool.map(lambda j: one(*j), jobs))
    out: dict[str, list[Path]] = {}
    for (code, _), path in zip(jobs, results):
        if path:
            out.setdefault(code, []).append(path)
    log(f"intake maps: {sum(len(v) for v in out.values())} PDFs for {len(out)}/{len(codes)} schools")
    return out
