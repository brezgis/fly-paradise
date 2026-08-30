#!/usr/bin/env python3
"""Build the static GitHub Pages bundle in dist/.

The WebGPU renderer is an ES module, so the deployable artifact is a small
directory rather than the project's former single-file HTML build.
"""

import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "dist"
FILES = (
    "index.html",
    "js/app.js",
    "js/flymodel.data.js",
    "js/brain.data.js",
    "js/world.js",
    "js/fly.js",
    "js/brain.js",
    "js/interact.js",
    "js/main.js",
    "vendor/three.webgpu.min.js",
    "vendor/three.core.min.js",
    "vendor/OrbitControls.module.js",
    "vendor/THREE_LICENSE",
    "vendor/FLYGYM_LICENSE",
    "vendor/FLYWIRE_DATA_LICENSE.md",
)


OUT.mkdir(parents=True, exist_ok=True)
for relative in FILES:
    source = ROOT / relative
    target = OUT / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)

# This exact path was produced by the pre-WebGPU builder. Keeping it beside
# dist/index.html is misleading because it contains the old renderer/data.
legacy = OUT / "fly_paradise.html"
if legacy.exists():
    legacy.unlink()

size = sum((OUT / relative).stat().st_size for relative in FILES)
print(f"{OUT}/index.html + assets ({size / 1024 / 1024:.2f} MB)")
