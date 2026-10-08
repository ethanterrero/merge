#!/usr/bin/env python3
"""Build the place_boundaries rows for the boundary migrations.

0008 (San Francisco neighborhoods and city limits): downloads two public-domain
sources into a fresh, empty temp directory outside the repo, simplifies the
polygons, and rewrites the generated block of the migration (between the
BEGIN/END GENERATED markers).

  python3 -I scripts/boundaries/build.py supabase/migrations/0008_commute_privacy.sql

Pass --from-dir DIR to reuse files fetched earlier (named as in SOURCES).

0009 (East Bay neighborhoods): reads the hand-drawn outlines in
east-bay-neighborhoods.geojson next to this script (no downloads) and rewrites
the generated block of 0009. The SQL clips each outline to its city's TIGER
limits and removes overlaps in file order when the migration runs.

  python3 -I scripts/boundaries/build.py --east-bay supabase/migrations/0009_east_bay_neighborhoods.sql

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

EAST_BAY_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "east-bay-neighborhoods.geojson")
EAST_BAY_SOURCE = "Merge (hand-drawn, approximate)"
EAST_BAY_LICENSE = "CC0-1.0"
EAST_BAY_CITIES = {"Alameda", "Oakland", "Berkeley"}
EAST_BAY_MAX_VERTICES = 20
EAST_BAY_MIN_PART_M2 = MIN_RING_M2  # clipping slivers smaller than this are dropped
EAST_BAY_BEGIN = "-- BEGIN GENERATED east_bay_neighborhoods (scripts/boundaries/build.py --east-bay; do not edit by hand)"
EAST_BAY_END = "-- END GENERATED east_bay_neighborhoods"


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


def segments_cross(a, b, c, d):
    """True if segments ab and cd properly cross (shared endpoints don't count)."""

    def orient(p, q, r):
        v = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
        return (v > 0) - (v < 0)

    if len({a, b, c, d}) < 4:
        return False
    return orient(a, b, c) * orient(a, b, d) < 0 and orient(c, d, a) * orient(c, d, b) < 0


def east_bay_neighborhoods(path):
    """Hand-drawn outlines, validated, in file (priority) order."""
    with open(path, "rb") as f:
        data = json.loads(f.read().decode("utf-8"))
    if data.get("source") != EAST_BAY_SOURCE or data.get("license") != EAST_BAY_LICENSE:
        raise SystemExit(f"{path} must declare source {EAST_BAY_SOURCE!r} and license {EAST_BAY_LICENSE!r}")
    rows, seen = [], set()
    for feat in data.get("features", []):
        props = feat.get("properties") or {}
        name, city = str(props.get("name", "")).strip(), str(props.get("city", "")).strip()
        geom = feat.get("geometry") or {}
        if not name or city not in EAST_BAY_CITIES:
            raise SystemExit(f"Unexpected East Bay feature: {name!r} in {city!r}")
        if (name, city) in seen:
            raise SystemExit(f"Duplicate East Bay neighborhood: {name}, {city}")
        seen.add((name, city))
        if geom.get("type") != "Polygon" or len(geom.get("coordinates", [])) != 1:
            raise SystemExit(f"{name}, {city}: expected a Polygon with one ring and no holes")
        ring = [check_coord(p) for p in geom["coordinates"][0]]
        if ring[0] != ring[-1]:
            raise SystemExit(f"{name}, {city}: ring is not closed")
        if not 3 <= len(ring) - 1 <= EAST_BAY_MAX_VERTICES:
            raise SystemExit(f"{name}, {city}: {len(ring) - 1} vertices; keep outlines to 3-{EAST_BAY_MAX_VERTICES}")
        edges = list(zip(ring, ring[1:]))
        for i in range(len(edges)):
            for j in range(i + 1, len(edges)):
                if segments_cross(*edges[i], *edges[j]):
                    raise SystemExit(f"{name}, {city}: outline crosses itself")
        if abs(ring_area_m2(ring)) < MIN_RING_M2:
            raise SystemExit(f"{name}, {city}: outline is too small")
        slug = lambda t: re.sub(r"[^a-z0-9]+", "-", t.lower()).strip("-")
        wkt = "POLYGON((" + ",".join(f"{x:.{DECIMALS}f} {y:.{DECIMALS}f}" for x, y in ring) + "))"
        rows.append({"id": f"merge-eastbay:{slug(city)}:{slug(name)}", "name": name, "city": city, "wkt": wkt})
    if len(rows) < 20:
        raise SystemExit(f"Expected the East Bay neighborhood set, got {len(rows)} features")
    return rows


def render_east_bay(rows, digest):
    values = ",\n".join(
        f"      ({i}, {sql_text(r['id'])}, {sql_text(r['name'])}, {sql_text(r['city'])},\n"
        f"       {sql_text(r['wkt'])})"
        for i, r in enumerate(rows, 1)
    )
    return f"""{EAST_BAY_BEGIN}
-- Source: scripts/boundaries/east-bay-neighborhoods.geojson (sha256 {digest}).
-- Replaces any earlier hand-drawn rows, so it can run again. Outlines are in
-- priority order: each is clipped to its city's TIGER limits, loses whatever an
-- earlier outline already covers, and drops slivers under {EAST_BAY_MIN_PART_M2:g} m2.
delete from public.place_boundaries where source = {sql_text(EAST_BAY_SOURCE)};

do $$
declare
  r record;
  g extensions.geometry;
  taken extensions.geometry := extensions.st_geomfromtext('MULTIPOLYGON EMPTY', 4326);
begin
  for r in
    select * from (values
{values}
    ) v(ord, id, name, city, wkt)
    order by ord
  loop
    select extensions.st_difference(
             extensions.st_intersection(extensions.st_makevalid(extensions.st_geomfromtext(r.wkt, 4326)), c.geom),
             taken)
      into g
      from public.place_boundaries c
     where c.kind = 'city' and c.city = r.city;
    if not found then
      raise exception 'No city boundary for %', r.city;
    end if;

    select extensions.st_multi(extensions.st_union(d.geom))
      into g
      from extensions.st_dump(extensions.st_collectionextract(extensions.st_makevalid(g), 3)) d
     where extensions.st_area(d.geom::extensions.geography) >= {EAST_BAY_MIN_PART_M2:g};
    if g is null then
      raise exception '% is empty after clipping', r.id;
    end if;

    insert into public.place_boundaries (id, kind, name, city, source, license, geom)
    values (r.id, 'neighborhood', r.name, r.city, {sql_text(EAST_BAY_SOURCE)}, {sql_text(EAST_BAY_LICENSE)}, g);
    taken := extensions.st_union(taken, g);
  end loop;
end
$$;
{EAST_BAY_END}"""


def replace_block(path, begin, end, block):
    with open(path, encoding="utf-8") as f:
        text = f.read()
    start, stop = text.find(begin), text.find(end)
    if start < 0 or stop < start:
        raise SystemExit(f"{path} has no generated block markers")
    text = text[:start] + block + text[stop + len(end) :]
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


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
    ap.add_argument("migration", help="path to the migration whose generated block is replaced")
    ap.add_argument("--from-dir", help="reuse downloads in this directory instead of fetching")
    ap.add_argument("--east-bay", action="store_true", help="build the hand-drawn East Bay block (0009)")
    args = ap.parse_args()

    if args.east_bay:
        rows = east_bay_neighborhoods(EAST_BAY_FILE)
        block = render_east_bay(rows, sha256(EAST_BAY_FILE))
        replace_block(args.migration, EAST_BAY_BEGIN, EAST_BAY_END, block)
        print(f"{len(rows)} East Bay neighborhoods, {len(block.encode('utf-8'))} bytes", file=sys.stderr)
        return

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
    replace_block(args.migration, BEGIN, END, block)
    print(f"{len(rows)} rows, {len(block.encode('utf-8'))} bytes; downloads in {workdir}", file=sys.stderr)


if __name__ == "__main__":
    main()
