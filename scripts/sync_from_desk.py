#!/usr/bin/env python3
"""Copy fresh price data from a compute-desk checkout into this repo, then commit and push.

Usage:
    python3 scripts/sync_from_desk.py --source /path/to/compute-desk [--no-push] [--dry-run]

Copies data/gpu_prices.csv, data/gpu_prices.json, data/lead_times.csv, data/models.csv
and every data/history/*.json snapshot. Commits only when something changed.
"""
import argparse
import datetime
import json
import shutil
import subprocess
import sys
from pathlib import Path

FILES = ["gpu_prices.csv", "gpu_prices.json", "lead_times.csv", "models.csv"]
REPO = Path(__file__).resolve().parent.parent


def validate(src_data: Path) -> None:
    """Refuse to copy obviously broken data."""
    j = json.loads((src_data / "gpu_prices.json").read_text())
    if not isinstance(j, dict) or "data" not in j or not j["data"]:
        raise ValueError("gpu_prices.json has no rows")
    header = (src_data / "gpu_prices.csv").read_text().splitlines()[0]
    for col in ("provider", "gpu", "price_usd_per_gpu_hr", "source_url", "date_checked"):
        if col not in header.split(","):
            raise ValueError(f"gpu_prices.csv is missing column {col}")


def copy_data(source: Path, dest: Path, dry_run: bool = False) -> list:
    """Copy data files from source/data to dest/data. Returns changed relative paths."""
    src_data = source / "data"
    validate(src_data)
    changed = []
    pairs = [(src_data / f, dest / "data" / f) for f in FILES if (src_data / f).exists()]
    pairs += [(p, dest / "data" / "history" / p.name) for p in sorted((src_data / "history").glob("*.json"))]
    for s, d in pairs:
        if d.exists() and d.read_bytes() == s.read_bytes():
            continue
        changed.append(str(d.relative_to(dest)))
        if not dry_run:
            d.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(s, d)
    return changed


def git(*args, cwd=REPO):
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True).stdout


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True, type=Path)
    ap.add_argument("--dest", type=Path, default=REPO)
    ap.add_argument("--no-push", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args(argv)
    changed = copy_data(a.source, a.dest, a.dry_run)
    if not changed:
        print("No data changes.")
        return 0
    print("Changed:", *changed, sep="\n  ")
    if a.dry_run:
        return 0
    git("add", "data", cwd=a.dest)
    git("commit", "-m", f"Data refresh {datetime.date.today().isoformat()}", cwd=a.dest)
    if not a.no_push:
        git("push", cwd=a.dest)
        print("Pushed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
