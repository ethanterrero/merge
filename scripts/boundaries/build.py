#!/usr/bin/env python3
"""Build the place_boundaries rows for supabase/migrations/0008_commute_privacy.sql.

Downloads two public-domain sources into a fresh, empty temp directory outside
the repo, simplifies the polygons, and rewrites the generated block of the
migration (between the BEGIN/END GENERATED markers).

  python3 -I scripts/boundaries/build.py supabase/migrations/0008_commute_privacy.sql

Pass --from-dir DIR to reuse files fetched earlier (named as in SOURCES).

The downloads are untrusted data: they're parsed with the standard library
(json, zipfile, struct) and never executed, unpacked to disk, or imported.
Standard library only, so there is nothing to install.
"""

import argparse
import hashlib
import io
import json
import math
import os
import re
import struct
import sys
import tempfile
import urllib.request
import zipfile

SF_URL = "https://data.sf.gov/resource/j2bu-swwd.geojson"
SF_PAGE = "https://data.sfgov.org/d/j2bu-swwd"
SF_LICENSE = "PDDL-1.0 (Open Data Commons Public Domain Dedication and License)"

TIGER_URL = "https://www2.census.gov/geo/tiger/TIGER2025/PLACE/tl_2025_06_place.zip"
TIGER_LICENSE = "Public domain (U.S. Government work, 17 U.S.C. 105)"

SOURCES = {"sf_neighborhoods.geojson": SF_URL, "tiger_ca_place.zip": TIGER_URL}
MAX_DOWNLOAD = 64 * 1024 * 1024

# Incorporated cities along the pilot corridor, by Census GEOID (state 06 + place).
CITIES = {
    "0667000": "San Francisco",
    "0600562": "Alameda",
    "0653000": "Oakland",
    "0606000": "Berkeley",
    "0622594": "Emeryville",
    "0656938": "Piedmont",
    "0668084": "San Leandro",
    "0660620": "Richmond",
    "0600674": "Albany",
}

TOLERANCE_M = 20.0  # Douglas-Peucker tolerance
MIN_RING_M2 = 2000.0  # drop islands and holes smaller than this after simplifying
DECIMALS = 5  # about 1 m
LAT0 = 37.8
M_PER_DEG_LAT = 111_000.0
M_PER_DEG_LON = 111_320.0 * math.cos(math.radians(LAT0))

BEGIN = "-- BEGIN GENERATED place_boundaries (scripts/boundaries/build.py; do not edit by hand)"
END = "-- END GENERATED place_boundaries"


def fetch(url, path):
    req = urllib.request.Request(url, headers={"User-Agent": "merge-boundaries-build/1"})
    with urllib.request.urlopen(req, timeout=300) as resp, open(path, "wb") as out:
        total = 0
        while True:
            chunk = resp.read(1 << 16)
            if not chunk:
                break
            total += len(chunk)
            if total > MAX_DOWNLOAD:
                raise SystemExit(f"{url} is larger than {MAX_DOWNLOAD} bytes; refusing")
            out.write(chunk)


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


# Geometry helpers (lon/lat rings, closed: first == last) ---------------------


def to_m(pt):
    return ((pt[0]) * M_PER_DEG_LON, (pt[1]) * M_PER_DEG_LAT)


def ring_area_m2(ring):
    pts = [to_m(p) for p in ring]
    s = 0.0
    for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
        s += x1 * y2 - x2 * y1
    return s / 2.0  # signed: counterclockwise positive


def douglas_peucker(points, tol):
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    pts = [to_m(p) for p in points]
    while stack:
        a, b = stack.pop()
        ax, ay = pts[a]
        bx, by = pts[b]
        dx, dy = bx - ax, by - ay
        seg = dx * dx + dy * dy
        best, idx = -1.0, -1
        for i in range(a + 1, b):
            px, py = pts[i]
            if seg == 0:
                d = math.hypot(px - ax, py - ay)
            else:
                t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / seg))
                d = math.hypot(px - (ax + t * dx), py - (ay + t * dy))
            if d > best:
                best, idx = d, i
        if best > tol:
            keep[idx] = True
            stack.append((a, idx))
            stack.append((idx, b))
    return [p for p, k in zip(points, keep) if k]


def simplify_ring(ring):
    if ring[0] != ring[-1]:
        ring = ring + [ring[0]]
    # Split the closed ring at its farthest vertex so both halves have fixed ends.
    far = max(range(len(ring)), key=lambda i: (ring[i][0] - ring[0][0]) ** 2 + (ring[i][1] - ring[0][1]) ** 2)
    out = douglas_peucker(ring[: far + 1], TOLERANCE_M)[:-1] + douglas_peucker(ring[far:], TOLERANCE_M)
    out = [(round(x, DECIMALS), round(y, DECIMALS)) for x, y in out]
    dedup = [out[0]]
    for p in out[1:]:
        if p != dedup[-1]:
            dedup.append(p)
    if len(dedup) < 4 or abs(ring_area_m2(dedup)) < MIN_RING_M2:
        return None
    return dedup


def point_in_ring(pt, ring):
    x, y = pt
    inside = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def polygons_wkt(polygons):
    """polygons: list of [outer, hole, ...] rings. Returns MULTIPOLYGON WKT or None."""
    parts = []
    for rings in polygons:
        outer = simplify_ring(rings[0])
        if outer is None:
            continue
        holes = [h for h in (simplify_ring(r) for r in rings[1:]) if h is not None]
        parts.append(
            "(" + ",".join("(" + ",".join(f"{x:.{DECIMALS}f} {y:.{DECIMALS}f}" for x, y in r) + ")" for r in [outer] + holes) + ")"
        )
    if not parts:
        return None
    return "MULTIPOLYGON(" + ",".join(parts) + ")"


# Sources -----------------------------------------------------------------------


def check_coord(p):
    if not (isinstance(p, list) and len(p) >= 2 and all(isinstance(v, (int, float)) for v in p[:2])):
        raise SystemExit("Unexpected coordinate in GeoJSON")
    lon, lat = float(p[0]), float(p[1])
    if not (-123.2 < lon < -121.5 and 37.0 < lat < 38.5):
        raise SystemExit(f"Coordinate outside the Bay Area: {lon} {lat}")
    return (lon, lat)


def sf_neighborhoods(path):
    with open(path, "rb") as f:
        data = json.loads(f.read().decode("utf-8"))
    rows = []
    for feat in data.get("features", []):
        name = str(feat.get("properties", {}).get("nhood", "")).strip()
        geom = feat.get("geometry") or {}
        if not name or geom.get("type") not in ("Polygon", "MultiPolygon"):
            raise SystemExit(f"Unexpected SF feature: {name!r} {geom.get('type')!r}")
        polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
        polygons = [[[check_coord(p) for p in ring] for ring in poly] for poly in polys]
        rows.append(
            {
                "id": "datasf-j2bu-swwd:" + re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-"),
                "kind": "neighborhood",
                "name": name,
                "city": "San Francisco",
                "source": f"DataSF Analysis Neighborhoods ({SF_PAGE})",
                "license": SF_LICENSE,
                "wkt": polygons_wkt(polygons),
            }
        )
    if not 30 <= len(rows) <= 60:
        raise SystemExit(f"Expected about 41 SF neighborhoods, got {len(rows)}")
    return rows


def read_dbf(buf):
    n_records, header_len, record_len = struct.unpack("<xxxxIHH", buf[:12])
    fields, pos = [], 32
    while buf[pos] != 0x0D:
        name = buf[pos : pos + 11].split(b"\0")[0].decode("ascii")
        length = buf[pos + 16]
        fields.append((name, length))
        pos += 32
    records = []
    for i in range(n_records):
        start = header_len + i * record_len + 1  # skip the deletion flag
        rec, off = {}, start
        for name, length in fields:
            rec[name] = buf[off : off + length].decode("utf-8", "replace").strip()
            off += length
        records.append(rec)
    return records


def read_shp_polygons(buf):
    """Yields each record's rings (lon/lat), in file order."""
    if struct.unpack(">i", buf[:4])[0] != 9994:
        raise SystemExit("Not a shapefile")
    pos = 100
    while pos < len(buf):
        _, content_words = struct.unpack(">ii", buf[pos : pos + 8])
        content = buf[pos + 8 : pos + 8 + content_words * 2]
        pos += 8 + content_words * 2
        shape_type = struct.unpack("<i", content[:4])[0]
        if shape_type == 0:
            yield []
            continue
        if shape_type != 5:
            raise SystemExit(f"Unexpected shape type {shape_type}")
        n_parts, n_points = struct.unpack("<ii", content[36:44])
        parts = list(struct.unpack(f"<{n_parts}i", content[44 : 44 + 4 * n_parts]))
        base = 44 + 4 * n_parts
        coords = [struct.unpack("<dd", content[base + 16 * i : base + 16 * i + 16]) for i in range(n_points)]
        bounds = parts + [n_points]
        yield [coords[bounds[i] : bounds[i + 1]] for i in range(n_parts)]


def tiger_cities(path):
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        shp = next(n for n in names if n.endswith(".shp"))
        dbf = next(n for n in names if n.endswith(".dbf"))
        for n in (shp, dbf):
            if z.getinfo(n).file_size > MAX_DOWNLOAD:
                raise SystemExit(f"{n} is too large")
        records = read_dbf(z.read(dbf))
        shapes = list(read_shp_polygons(z.read(shp)))
    if len(records) != len(shapes):
        raise SystemExit("Shapefile and DBF record counts differ")
    rows = []
    for rec, rings in zip(records, shapes):
        geoid = rec.get("GEOID")
        if geoid not in CITIES:
            continue
        if rec.get("NAME") != CITIES[geoid]:
            raise SystemExit(f"GEOID {geoid} is {rec.get('NAME')!r}, expected {CITIES[geoid]!r}")
        rings = [[check_coord(list(p)) for p in r] for r in rings]
        # Shapefile rule: outer rings clockwise (negative signed area), holes counterclockwise.
        outers = [[r] for r in rings if ring_area_m2(r) < 0]
        for hole in (r for r in rings if ring_area_m2(r) > 0):
            owner = next((o for o in outers if point_in_ring(hole[0], o[0])), None)
            if owner is not None:
                owner.append(hole)
        rows.append(
            {
                "id": f"tiger2025-place:{geoid}",
                "kind": "city",
                "name": CITIES[geoid],
                "city": CITIES[geoid],
                "source": f"US Census Bureau TIGER/Line 2025, Places, California ({TIGER_URL})",
                "license": TIGER_LICENSE,
                "wkt": polygons_wkt(outers),
            }
        )
    missing = set(CITIES.values()) - {r["name"] for r in rows}
    if missing:
        raise SystemExit(f"Cities missing from TIGER: {sorted(missing)}")
    return rows


def sql_text(s):
    return "'" + s.replace("'", "''") + "'"


def render(rows, hashes):
    lines = [
        BEGIN,
        f"-- Sources (sha256 of the downloads this was built from):",
    ]
    for name, url in SOURCES.items():
        lines.append(f"--   {url}  {hashes[name]}")
    lines.append(f"-- Simplified with Douglas-Peucker at {TOLERANCE_M:g} m; coordinates rounded to {DECIMALS} decimals.")
    lines.append("insert into public.place_boundaries (id, kind, name, city, source, license, geom) values")
    values = []
    for r in sorted(rows, key=lambda r: (r["kind"], r["id"])):
        if r["wkt"] is None:
            raise SystemExit(f"{r['id']} simplified to nothing")
        geom = (
            "extensions.st_multi(extensions.st_collectionextract(extensions.st_makevalid("
            f"extensions.st_geomfromtext({sql_text(r['wkt'])}, 4326)), 3))"
        )
        values.append(
            f"  ({sql_text(r['id'])}, {sql_text(r['kind'])}, {sql_text(r['name'])}, {sql_text(r['city'])},\n"
            f"   {sql_text(r['source'])},\n   {sql_text(r['license'])},\n   {geom})"
        )
    lines.append(",\n".join(values) + ";")
    lines.append(END)
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("migration", help="path to 0008_commute_privacy.sql (its generated block is replaced)")
    ap.add_argument("--from-dir", help="reuse downloads in this directory instead of fetching")
    args = ap.parse_args()

    if args.from_dir:
        workdir = args.from_dir
    else:
        workdir = tempfile.mkdtemp(prefix="merge-boundaries-")
        for name, url in SOURCES.items():
            print(f"fetch {url}", file=sys.stderr)
            fetch(url, os.path.join(workdir, name))
    hashes = {name: sha256(os.path.join(workdir, name)) for name in SOURCES}

    rows = sf_neighborhoods(os.path.join(workdir, "sf_neighborhoods.geojson"))
    rows += tiger_cities(os.path.join(workdir, "tiger_ca_place.zip"))
    block = render(rows, hashes)

    with open(args.migration, encoding="utf-8") as f:
        text = f.read()
    start, end = text.find(BEGIN), text.find(END)
    if start < 0 or end < start:
        raise SystemExit(f"{args.migration} has no generated block markers")
    text = text[:start] + block + text[end + len(END) :]
    with open(args.migration, "w", encoding="utf-8") as f:
        f.write(text)
    print(f"{len(rows)} rows, {len(block.encode('utf-8'))} bytes; downloads in {workdir}", file=sys.stderr)


if __name__ == "__main__":
    main()
