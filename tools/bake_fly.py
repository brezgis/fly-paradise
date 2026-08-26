#!/usr/bin/env python3
"""Bake the NeuroMechFly (flygym) Drosophila body meshes into a compact
three.js-ready data file: js/flymodel.data.js

Input:  a directory containing the flygym assets, laid out as:
          <src>/meshes/*.stl   (simplified_max2000faces set, left+center parts)
          <src>/model.xml      (legacy MJCF with the full body tree)
Output: js/flymodel.data.js    (quantized geometry + skeleton, ~250 KB)

The MJCF is z-up with the fly facing +x. We convert to three.js's y-up with
the fly facing +z via the cyclic permutation (x,y,z)mjc -> (y,z,x)three,
which keeps the frame right-handed (no winding flips needed).
Right-side parts don't ship as meshes; they're mirrored from the left
(mjc y -> -y, triangle winding reversed, quats conjugated for the mirror).

Usage: bake_fly.py <src_dir> <out_js>
"""
import base64
import json
import re
import struct
import sys

import numpy as np
import trimesh
import fast_simplification

SRC, OUT = sys.argv[1], sys.argv[2]

MESH_FILES = {
    "Thorax": "c_thorax", "A1A2": "c_abdomen12", "A3": "c_abdomen3",
    "A4": "c_abdomen4", "A5": "c_abdomen5", "A6": "c_abdomen6",
    "Head": "c_head", "LEye": "l_eye", "Rostrum": "c_rostrum",
    "Haustellum": "c_haustellum", "LPedicel": "l_pedicel",
    "LFuniculus": "l_funiculus", "LArista": "l_arista",
    "LWing": "l_wing", "LHaltere": "l_haltere",
}
for side, pre in (("LF", "lf"), ("LM", "lm"), ("LH", "lh")):
    MESH_FILES[side + "Coxa"] = pre + "_coxa"
    MESH_FILES[side + "Femur"] = pre + "_trochanterfemur"
    MESH_FILES[side + "Tibia"] = pre + "_tibia"
    for i in range(1, 6):
        MESH_FILES[f"{side}Tarsus{i}"] = f"{pre}_tarsus{i}"

# ---- parse MJCF body tree ----------------------------------------------------
xml = open(f"{SRC}/model.xml").read()
bodies = {}   # name -> {parent, pos(3), quat(wxyz)}
stack = []
for m in re.finditer(r"<body\s+([^>]*?)(/?)>|</body>", xml):
    if m.group(0) == "</body>":
        stack.pop()
        continue
    attrs = dict(re.findall(r'(\w+)="([^"]*)"', m.group(1)))
    name = attrs["name"]
    pos = np.array([float(v) for v in attrs.get("pos", "0 0 0").split()])
    quat = np.array([float(v) for v in attrs.get("quat", "1 0 0 0").split()])
    quat /= np.linalg.norm(quat)
    bodies[name] = {"parent": stack[-1] if stack else None, "pos": pos, "quat": quat}
    if not m.group(2):
        stack.append(name)


def quat_mat(q):
    w, x, y, z = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
        [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
        [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
    ])


def quat_mul(a, b):
    aw, ax, ay, az = a
    bw, bx, by, bz = b
    return np.array([
        aw * bw - ax * bx - ay * by - az * bz,
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
    ])


def chain_to(body, ancestor):
    """Transform (R, t) mapping <body>-frame points into <ancestor>-frame."""
    R, t = np.eye(3), np.zeros(3)
    b = body
    while b != ancestor:
        info = bodies[b]
        Rb, tb = quat_mat(info["quat"]), info["pos"]
        R, t = Rb @ R, Rb @ t * 0 + tb + Rb @ t
        b = info["parent"]
        if b is None and b != ancestor:
            raise ValueError(f"{ancestor} not an ancestor of {body}")
    return R, t


def load_stl(mesh_key, mirror=False):
    """Load one STL (in metres), scale to the mm body frame, optionally mirror."""
    path = f"{SRC}/meshes/{MESH_FILES[mesh_key]}.stl"
    mesh = trimesh.load(path, process=True)
    v = np.asarray(mesh.vertices, dtype=np.float64) * 1000.0
    f = np.asarray(mesh.faces)
    if mirror:
        v = v * np.array([1.0, -1.0, 1.0])
        f = f[:, ::-1]
    return v, f


def merge(parts):
    """parts: list of (verts, faces, R, t) already expressed for one frame."""
    vs, fs, off = [], [], 0
    for v, f, R, t in parts:
        vs.append(v @ R.T + t)
        fs.append(f + off)
        off += len(v)
    return np.vstack(vs), np.vstack(fs)


def decimate(v, f, target_faces):
    if len(f) <= target_faces:
        return v, f
    out_v, out_f = fast_simplification.simplify(v, f, target_count=target_faces)
    return out_v, out_f


MJC2THREE = np.array([[0, 1, 0], [0, 0, 1], [1, 0, 0]], dtype=np.float64)  # row i of three = mjc axis


def to_three_v(v):
    return v @ MJC2THREE.T


def to_three_p(p):
    return np.array([p[1], p[2], p[0]])


def to_three_q(q):
    return np.array([q[0], q[2], q[3], q[1]])  # (w, ay, az, ax)


def mirror_q(q):
    # mirror across the mjc xz-plane (y flip): negate x,z axis components
    return np.array([q[0], -q[1], q[2], -q[3]])


# ---- assemble parts ----------------------------------------------------------
# Each part: name, parent part, origin body (pos/quat in parent-part frame),
# list of (mesh_key, component body, mirror?) merged into the origin body frame.
def leg_parts(sideXml, sideOut, mirror):
    """sideXml: 'LF'|'RF'|..., mesh keys always come from the left ('LF'...)."""
    lхml = "L" + sideXml[1]
    out = []
    segs = [("Coxa", "thorax"), ("Femur", None), ("Tibia", None)]
    prev = None
    for seg, _ in segs:
        body = sideXml + seg
        out.append({
            "name": sideOut + "_" + seg.lower(),
            "parent": "thorax" if seg == "Coxa" else prev,
            "origin": body,
            "components": [(lхml + seg, body, mirror)],
            "faces": 340,
        })
        prev = sideOut + "_" + seg.lower()
    tars = {
        "name": sideOut + "_tarsus", "parent": prev, "origin": sideXml + "Tarsus1",
        "components": [(f"{lхml}Tarsus{i}", f"{sideXml}Tarsus{i}", mirror) for i in range(1, 6)],
        "faces": 620,
    }
    out.append(tars)
    return out


PARTS = [
    {"name": "thorax", "parent": None, "origin": "Thorax",
     "components": [("Thorax", "Thorax", False)], "faces": 1200},
    {"name": "abdomen", "parent": "thorax", "origin": "A1A2",
     "components": [("A1A2", "A1A2", False), ("A3", "A3", False), ("A4", "A4", False),
                    ("A5", "A5", False), ("A6", "A6", False)], "faces": 1700},
    {"name": "head", "parent": "thorax", "origin": "Head",
     "components": [("Head", "Head", False)], "faces": 950},
    {"name": "eye_l", "parent": "head", "origin": "LEye",
     "components": [("LEye", "LEye", False)], "faces": 650},
    {"name": "eye_r", "parent": "head", "origin": "REye",
     "components": [("LEye", "REye", True)], "faces": 650},
    {"name": "antenna_l", "parent": "head", "origin": "LPedicel",
     "components": [("LPedicel", "LPedicel", False), ("LFuniculus", "LFuniculus", False),
                    ("LArista", "LArista", False)], "faces": 400},
    {"name": "antenna_r", "parent": "head", "origin": "RPedicel",
     "components": [("LPedicel", "RPedicel", True), ("LFuniculus", "RFuniculus", True),
                    ("LArista", "RArista", True)], "faces": 400},
    {"name": "proboscis", "parent": "head", "origin": "Rostrum",
     "components": [("Rostrum", "Rostrum", False), ("Haustellum", "Haustellum", False)],
     "faces": 550},
    {"name": "wing_l", "parent": "thorax", "origin": "LWing",
     "components": [("LWing", "LWing", False)], "faces": 420},
    {"name": "wing_r", "parent": "thorax", "origin": "RWing",
     "components": [("LWing", "RWing", True)], "faces": 420},
    {"name": "haltere_l", "parent": "thorax", "origin": "LHaltere",
     "components": [("LHaltere", "LHaltere", False)], "faces": 140},
    {"name": "haltere_r", "parent": "thorax", "origin": "RHaltere",
     "components": [("LHaltere", "RHaltere", True)], "faces": 140},
]
for sx, so, mir in (("LF", "leg_lf", False), ("LM", "leg_lm", False), ("LH", "leg_lh", False),
                    ("RF", "leg_rf", True), ("RM", "leg_rm", True), ("RH", "leg_rh", True)):
    PARTS += leg_parts(sx, so, mir)

# body -> owning part origin body (for chains)
ORIGIN_OF = {p["origin"]: p for p in PARTS}

baked = []
total_faces = 0
for part in PARTS:
    origin = part["origin"]
    comps = []
    for mesh_key, body, mirror in part["components"]:
        v, f = load_stl(mesh_key, mirror)
        R, t = chain_to(body, origin)
        comps.append((v, f, R, t))
    v, f = merge(comps)
    v, f = decimate(v, f, part["faces"])
    v = to_three_v(v)
    baked.append({"part": part, "v": v, "f": f})
    total_faces += len(f)

# ---- global scale: fly length -> 1.0 ----------------------------------------
# assemble to world (thorax frame) to measure length along three-z
zmin, zmax = 1e9, -1e9
world = {}
for b in baked:
    origin = b["part"]["origin"]
    R, t = chain_to(origin, "Thorax")
    w = (b["v"] @ MJC2THREE.T @ np.linalg.inv(MJC2THREE.T)) if False else b["v"]
    # b.v is already three-frame *local*; rebuild in mjc, transform, re-map:
    v_mjc = b["v"] @ np.linalg.inv(MJC2THREE.T)
    wv = v_mjc @ R.T + t
    world[b["part"]["name"]] = wv
    zmin = min(zmin, wv[:, 0].min())   # mjc x == three z (length axis)
    zmax = max(zmax, wv[:, 0].max())
FLY_LEN = zmax - zmin
S = 1.0 / FLY_LEN

# ---- emit --------------------------------------------------------------------
def b64(arr):
    return base64.b64encode(arr.tobytes()).decode()

out_parts = []
for b in baked:
    part = b["part"]
    v = b["v"] * S
    f = b["f"].astype(np.uint32)
    if len(v) > 65000:
        raise ValueError("part too big for uint16 indices")
    vmin = v.min(axis=0)
    vrange = np.maximum(v.max(axis=0) - vmin, 1e-9)
    q = np.round((v - vmin) / vrange * 65535).astype(np.uint16)
    origin = part["origin"]
    info = bodies[origin]
    # origin transform relative to the *parent part's* origin body
    parent_part = part["parent"]
    if parent_part is None:
        pos, quat = np.zeros(3), np.array([1.0, 0, 0, 0])
    else:
        parent_origin = next(p["origin"] for p in PARTS if p["name"] == parent_part)
        R, t = chain_to(origin, parent_origin)
        pos = t
        # recover quat from R (parts here only ever carry their own body quat chain;
        # use trimesh for a robust conversion)
        quat = trimesh.transformations.quaternion_from_matrix(
            np.vstack([np.hstack([R, [[0], [0], [0]]]), [0, 0, 0, 1]]))
    out_parts.append({
        "name": part["name"], "parent": parent_part,
        "pos": [round(float(x), 6) for x in to_three_p(pos * S)],
        "quat": [round(float(x), 6) for x in to_three_q(quat)],
        "min": [round(float(x), 6) for x in vmin],
        "range": [round(float(x), 6) for x in vrange],
        "nv": len(v), "nf": len(f),
        "pos_b64": b64(q),
        "idx_b64": b64(f.astype(np.uint16)),
    })

# leg metadata: hip anchors (in thorax frame) + segment lengths, scaled
legs = {}
for sx, so in (("LF", "lf"), ("LM", "lm"), ("LH", "lh"), ("RF", "rf"), ("RM", "rm"), ("RH", "rh")):
    _, hip = chain_to(sx + "Coxa", "Thorax")
    lc = np.linalg.norm(bodies[sx + "Femur"]["pos"])
    lf_ = np.linalg.norm(bodies[sx + "Tibia"]["pos"])
    lt = np.linalg.norm(bodies[sx + "Tarsus1"]["pos"])
    tarsus_world = world[("leg_" + so + "_tarsus")]
    # tarsus length: extent along its own -z(mjc local... approximately) use chain span
    ltar = sum(np.linalg.norm(bodies[f"{sx}Tarsus{i}"]["pos"]) for i in range(2, 6)) + 0.09
    legs[so] = {
        "hip": [round(float(x), 6) for x in to_three_p(hip * S)],
        "lens": [round(float(x * S), 6) for x in (lc, lf_, lt, ltar)],
    }

model = {
    "source": "NeuroMechFly v2 (NeLy-EPFL/flygym), Apache-2.0. Micro-CT scan of an adult female Drosophila melanogaster.",
    "faces": int(total_faces),
    "legs": legs,
    "parts": out_parts,
}
js = "window.FP = window.FP || {};\nFP.FLY_MODEL = " + json.dumps(model) + ";\n"
open(OUT, "w").write(js)
print(f"parts: {len(out_parts)}  faces: {total_faces}  bytes: {len(js)}  fly_len_mm: {FLY_LEN:.3f}")
