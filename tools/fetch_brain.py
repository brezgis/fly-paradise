#!/usr/bin/env python3
"""Download the pinned FlyWire Codex FAFB v783 inputs used by bake_brain.py."""

import hashlib
import sys
import urllib.request
from pathlib import Path


BASE = "https://storage.googleapis.com/flywire-data/codex/data/fafb/783/"
FILES = {
    "neurons.csv.gz": "6a6b3759e635f0f35a677d169052362131ec61d95f55919298b55c43fce4e719",
    "classification.csv.gz": "e946b552f4056dfc977707be0674609832c3f64332a22d69dc0d9615e7aae663",
    "coordinates.csv.gz": "14337121f451f98c2576cee72c24409ada5aaf7948b7c7ca8de9040296840e05",
    "consolidated_cell_types.csv.gz": "8aba246d71dc40361677493629972ce3883048c3d02010adc42bda22962a1a2d",
    "connections_princeton.csv.gz": "445f996bf6c4b1803b9ba186189138a3061ff8623aa94c0abcf38af30a5bd48b",
}


destination = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("data/flywire-v783")
destination.mkdir(parents=True, exist_ok=True)
for name, expected in FILES.items():
    path = destination / name
    if not path.exists() or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
        print(f"downloading {name} …", flush=True)
        urllib.request.urlretrieve(BASE + name, path)
    actual = hashlib.sha256(path.read_bytes()).hexdigest()
    if actual != expected:
        raise SystemExit(f"Checksum mismatch for {path}: {actual}")
    print(f"verified {path}")
