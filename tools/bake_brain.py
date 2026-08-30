#!/usr/bin/env python3
"""Bake a compact, browser-ready FlyWire brain overview.

The input files are the public, static Codex FAFB v783 CSV exports.  The
output deliberately contains representative neuron coordinates and a subset
of the strongest measured edges, not reconstructed neuron morphologies.

Usage:
    python3 tools/bake_brain.py <codex_dir> js/brain.data.js

Expected files in <codex_dir>:
    neurons.csv.gz
    classification.csv.gz
    coordinates.csv.gz
    consolidated_cell_types.csv.gz
    connections_princeton.csv.gz
"""

import base64
import csv
import gzip
import json
import math
import struct
import sys
from collections import defaultdict
from pathlib import Path


SRC = Path(sys.argv[1])
OUT = Path(sys.argv[2])
REGIONS = ("optic", "antennal", "mushroom", "cx", "sez", "ammc", "motor", "bg")
REGION_INDEX = {name: i for i, name in enumerate(REGIONS)}


def rows(name):
    with gzip.open(SRC / name, "rt", newline="") as handle:
        yield from csv.DictReader(handle)


def neuron_region(meta, anatomy):
    super_class = anatomy.get("super_class", "")
    cell_class = anatomy.get("class", "")
    group = set(meta.get("group", "").split("."))

    if super_class in {"motor", "descending", "ascending", "sensory_ascending"}:
        return "motor"
    if cell_class == "mechanosensory" or group.intersection({"AMMC", "WED"}):
        return "ammc"
    if cell_class == "gustatory" or group.intersection({"GNG", "PRW", "FLA"}):
        return "sez"
    if cell_class in {"Kenyon_Cell", "MBON", "DAN", "MBIN"} or any(g.startswith("MB_") for g in group):
        return "mushroom"
    if cell_class == "CX" or group.intersection({"FB", "EB", "PB", "NO", "BU", "LAL", "CRE"}):
        return "cx"
    if cell_class in {"olfactory", "ALPN", "ALLN", "LHLN", "ALIN", "ALON"} or group.intersection({"AL", "LH"}):
        return "antennal"
    if super_class in {"optic", "visual_projection", "visual_centrifugal"}:
        return "optic"
    return "bg"


def encode_u16(values):
    return base64.b64encode(struct.pack("<" + "H" * len(values), *values)).decode("ascii")


def encode_u8(values):
    return base64.b64encode(bytes(values)).decode("ascii")


def quantile(values, q):
    ordered = sorted(values)
    at = q * (len(ordered) - 1)
    lo = int(math.floor(at))
    hi = int(math.ceil(at))
    if lo == hi:
        return ordered[lo]
    t = at - lo
    return ordered[lo] * (1 - t) + ordered[hi] * t


neurons = {row["root_id"]: row for row in rows("neurons.csv.gz")}
classification = {row["root_id"]: row for row in rows("classification.csv.gz")}
cell_types = {row["root_id"]: row["primary_type"] for row in rows("consolidated_cell_types.csv.gz")}

# Codex can list several representative coordinates for a neuron. The first
# coordinate is the same convention used by Codex-derived soma overviews.
coordinates = {}
for row in rows("coordinates.csv.gz"):
    rid = row["root_id"]
    if rid in coordinates:
        continue
    xyz = row["position"].strip("[]").split()
    if len(xyz) == 3:
        coordinates[rid] = tuple(float(v) for v in xyz)

ids = sorted(set(neurons).intersection(classification, coordinates), key=int)
if len(ids) != 139255:
    raise SystemExit(f"Expected 139255 FAFB neurons, found {len(ids)}")

# Robust bounds prevent a handful of tag coordinates from flattening the
# brain. Source FAFB axes are transformed to three.js as x, z, -y.
source_axes = list(zip(*(coordinates[rid] for rid in ids)))
lo = [quantile(axis, 0.01) for axis in source_axes]
hi = [quantile(axis, 0.99) for axis in source_axes]
target_min = (-4.5, -2.6, -1.8)
target_max = (4.5, 2.6, 1.8)


def normalize(raw):
    source = (raw[0], raw[2], -raw[1])
    source_lo = (lo[0], lo[2], -hi[1])
    source_hi = (hi[0], hi[2], -lo[1])
    out = []
    for value, a, b, ta, tb in zip(source, source_lo, source_hi, target_min, target_max):
        t = max(0.0, min(1.0, (value - a) / max(1.0, b - a)))
        out.append(ta + t * (tb - ta))
    return tuple(out)


def quantize(pos):
    return tuple(round(max(0, min(1, (v - a) / (b - a))) * 65535)
                 for v, a, b in zip(pos, target_min, target_max))


region_of = {}
normalized = {}
points = {name: [] for name in REGIONS}
types_by_region = defaultdict(lambda: defaultdict(int))
for rid in ids:
    region = neuron_region(neurons[rid], classification[rid])
    region_of[rid] = region
    normalized[rid] = normalize(coordinates[rid])
    points[region].extend(quantize(normalized[rid]))
    if cell_types.get(rid):
        types_by_region[region][cell_types[rid]] += 1

# Preserve all strong connections (>=100 synapses) as exact Codex edges, and
# aggregate every commonly accepted edge (>=5 synapses) into a region matrix.
edge_positions = []
edge_regions = []
edge_weights = []
matrix = [[0 for _ in REGIONS] for _ in REGIONS]
edge_count_all = 0
for row in rows("connections_princeton.csv.gz"):
    synapses = int(row["syn_count"])
    if synapses < 5:
        continue
    pre = row["pre_root_id"]
    post = row["post_root_id"]
    if pre not in region_of or post not in region_of:
        continue
    a = REGION_INDEX[region_of[pre]]
    b = REGION_INDEX[region_of[post]]
    matrix[a][b] += synapses
    edge_count_all += 1
    if synapses >= 100:
        edge_positions.extend(quantize(normalized[pre]))
        edge_positions.extend(quantize(normalized[post]))
        edge_regions.append(a if region_of[pre] != "bg" else b)
        edge_weights.append(min(255, round(math.log2(synapses + 1) * 24)))

# Normalize outgoing region weights for a stable lightweight activity model.
matrix_norm = []
for row in matrix:
    total = sum(row) or 1
    matrix_norm.extend(round(value / total, 7) for value in row)

payload = {
    "dataset": "FlyWire FAFB v783",
    "snapshot": 783,
    "neuron_count": len(ids),
    "connection_count_threshold_5": edge_count_all,
    "strong_edge_threshold": 100,
    "strong_edge_count": len(edge_regions),
    "coordinate_kind": "first Codex representative coordinate per proofread neuron",
    "bounds": {"min": target_min, "range": tuple(b - a for a, b in zip(target_min, target_max))},
    "region_order": REGIONS,
    "region_matrix": matrix_norm,
    "regions": {
        name: {
            "count": len(points[name]) // 3,
            "positions_u16_b64": encode_u16(points[name]),
            "common_types": sorted(types_by_region[name].items(), key=lambda item: (-item[1], item[0]))[:6],
        }
        for name in REGIONS
    },
    "strong_edges": {
        "positions_u16_b64": encode_u16(edge_positions),
        "regions_u8_b64": encode_u8(edge_regions),
        "weights_u8_b64": encode_u8(edge_weights),
    },
    "source": "https://codex.flywire.ai/",
    "citation_doi": "10.1038/s41586-024-07558-y",
}

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text("/* Generated by tools/bake_brain.py; do not edit. */\nwindow.FP = window.FP || {};\nFP.FLYWIRE_BRAIN = " +
               json.dumps(payload, separators=(",", ":")) + ";\n")
print(f"{OUT}: {len(ids)} neurons, {edge_count_all} thresholded edges, {len(edge_regions)} strong edges")
