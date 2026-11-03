"""Build aquatic-twin/web/erie.scene.json.

python aquatic-twin/scripts/build_scene.py              # placeholder lakebed, no downloads, stdlib only
python aquatic-twin/scripts/build_scene.py --real       # NOAA grid: downloads erie_lld.grd.gz (22.6 MB), needs numpy + scipy
python aquatic-twin/scripts/build_scene.py --grid PATH  # same, from a local .grd or .grd.gz
"""
import argparse
import gzip
import json
import math
import os
import shutil
import tempfile
import urllib.request

NOAA_URL = "https://www.ngdc.noaa.gov/mgg/greatlakes/erie/data/netcdf/erie_lld.grd.gz"
OUT = os.path.join(os.path.dirname(__file__), "..", "web", "erie.scene.json")

NX, NY, NZ = 128, 48, 12
LON0, LON1, LAT0, LAT1 = -83.6, -78.75, 41.35, 42.95

# Rough hand-traced shoreline (lon, lat), for the placeholder only.
OUTLINE = [
    (-83.15, 42.05), (-82.95, 42.0), (-82.52, 41.91), (-82.1, 42.03), (-81.85, 42.26), (-81.2, 42.66),
    (-80.6, 42.6), (-80.2, 42.56), (-80.05, 42.55), (-79.5, 42.85), (-79.25, 42.87), (-78.88, 42.88),
    (-79.33, 42.49), (-80.1, 42.15), (-80.8, 41.9), (-81.7, 41.5), (-82.18, 41.47), (-82.7, 41.47),
    (-82.72, 41.54), (-82.94, 41.52), (-83.45, 41.72), (-83.35, 41.9),
]
SITES = {"toledo_intake": (-83.25, 41.70), "port_clinton": (-82.94, 41.55), "sandusky": (-82.70, 41.50), "cleveland": (-81.70, 41.55)}
SOURCES = {"maumee": (-83.42, 41.72, "04193500")}


def grid_ij(lon, lat):
    return round((lon - LON0) / (LON1 - LON0) * (NX - 1)), round((lat - LAT0) / (LAT1 - LAT0) * (NY - 1))


def inside(lon, lat):
    hit = False
    for n, (x1, y1) in enumerate(OUTLINE):
        x2, y2 = OUTLINE[(n + 1) % len(OUTLINE)]
        if (y1 > lat) != (y2 > lat) and lon < x1 + (lat - y1) / (y2 - y1) * (x2 - x1):
            hit = not hit
    return hit


def shore_km(lon, lat):
    best = 1e9
    kx, ky = 82.7, 111.0
    for n, (x1, y1) in enumerate(OUTLINE):
        x2, y2 = OUTLINE[(n + 1) % len(OUTLINE)]
        ax, ay, bx, by = x1 * kx, y1 * ky, x2 * kx, y2 * ky
        px, py = lon * kx, lat * ky
        t = max(0, min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)))
        best = min(best, math.hypot(px - ax - t * (bx - ax), py - ay - t * (by - ay)))
    return best


def basin_depth(lon):
    points = [(-83.6, 9), (-82.6, 10), (-82.35, 12), (-82.0, 24), (-80.6, 25), (-80.2, 22), (-79.8, 60), (-79.4, 40), (-78.75, 12)]
    for (x1, d1), (x2, d2) in zip(points, points[1:]):
        if x1 <= lon <= x2:
            return d1 + (d2 - d1) * (lon - x1) / (x2 - x1)
    return 10


def placeholder_grid():
    depth, land = [], []
    for j in range(NY):
        lat = LAT0 + (LAT1 - LAT0) * j / (NY - 1)
        for i in range(NX):
            lon = LON0 + (LON1 - LON0) * i / (NX - 1)
            if inside(lon, lat):
                d = max(1.5, basin_depth(lon) * (1 - math.exp(-shore_km(lon, lat) / 12)))
                depth.append(round(d, 1)); land.append(0)
            else:
                depth.append(0); land.append(10)
    return depth, land


def real_grid(path):
    import numpy as np
    from scipy.io import netcdf_file
    if path.endswith(".gz"):
        raw = path[:-3]
        with gzip.open(path) as src, open(raw, "wb") as dst:
            shutil.copyfileobj(src, dst)
        path = raw
    with netcdf_file(path, "r", mmap=False) as f:
        print("Variables in grid:", list(f.variables))
        names = list(f.variables)
        xn = next(n for n in names if n.lower() in ("x", "lon", "longitude"))
        yn = next(n for n in names if n.lower() in ("y", "lat", "latitude"))
        zn = next(n for n in names if n.lower() in ("z", "elevation", "depth", "topo"))
        x, y, z = np.array(f.variables[xn].data), np.array(f.variables[yn].data), np.array(f.variables[zn].data, dtype=float)
    print(f"Grid {z.shape}, lon {x.min():.3f}..{x.max():.3f}, lat {y.min():.3f}..{y.max():.3f}, z {np.nanmin(z):.1f}..{np.nanmax(z):.1f}")
    depth, land = [], []
    sx, sy = max(1, len(x) // (NX * 8)), max(1, len(y) // (NY * 8))
    for j in range(NY):
        lat0 = LAT0 + (LAT1 - LAT0) * (j - .5) / (NY - 1)
        lat1 = lat0 + (LAT1 - LAT0) / (NY - 1)
        ys = np.where((y >= lat0) & (y < lat1))[0][::sy]
        for i in range(NX):
            lon0 = LON0 + (LON1 - LON0) * (i - .5) / (NX - 1)
            lon1 = lon0 + (LON1 - LON0) / (NX - 1)
            xs = np.where((x >= lon0) & (x < lon1))[0][::sx]
            cell = z[np.ix_(ys, xs)] if len(ys) and len(xs) else np.array([1.0])
            wet = cell[cell < 0]
            if wet.size > cell.size / 2:
                depth.append(round(max(1.5, float(-wet.mean())), 1)); land.append(0)
            else:
                depth.append(0); land.append(round(max(0.0, float(np.nanmean(cell))), 1))
    return depth, land


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--real", action="store_true")
    ap.add_argument("--grid")
    args = ap.parse_args()
    path = args.grid
    if args.real and not path:
        path = os.path.join(tempfile.mkdtemp(), "erie_lld.grd.gz")
        print("Downloading", NOAA_URL)
        urllib.request.urlretrieve(NOAA_URL, path)
    depth, land = real_grid(path) if path else placeholder_grid()
    lat_mid = (LAT0 + LAT1) / 2
    scene = {
        "id": "erie", "name": "Lake Erie",
        "lakebed": "NOAA NCEI" if path else "PLACEHOLDER: hand-traced outline and published basin depths",
        "placeholder": not path,
        "nx": NX, "ny": NY, "nz": NZ,
        "dx_m": round((LON1 - LON0) / (NX - 1) * 111320 * math.cos(math.radians(lat_mid))),
        "dy_m": round((LAT1 - LAT0) / (NY - 1) * 111320),
        "bounds": [LON0, LAT0, LON1, LAT1], "z_exaggeration": 600,
        "depth_m": depth, "land_m": land,
        "sources": [{"id": k, "i": grid_ij(v[0], v[1])[0], "j": grid_ij(v[0], v[1])[1], "gauge": v[2]} for k, v in SOURCES.items()],
        "sites": [{"id": k, "i": grid_ij(*v)[0], "j": grid_ij(*v)[1]} for k, v in SITES.items()],
    }
    with open(OUT, "w") as f:
        json.dump(scene, f, separators=(",", ":"))
    wet = sum(1 for d in depth if d > 0)
    print(f"Wrote {os.path.normpath(OUT)}: {wet} wet columns, max depth {max(depth)} m, placeholder={scene['placeholder']}")


if __name__ == "__main__":
    main()
