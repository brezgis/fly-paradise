#!/usr/bin/env python3
"""Inline every local <script src> into one self-contained HTML file.
Usage: build.py [out]   (default: dist/fly_paradise.html)"""
import re
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
out = Path(sys.argv[1]) if len(sys.argv) > 1 else root / "dist" / "fly_paradise.html"

html = (root / "index.html").read_text()

def inline(m):
    src = m.group(1)
    body = (root / src).read_text()
    return f"<script>\n/* inlined: {src} */\n{body}\n</script>"

html = re.sub(r'<script src="([^"]+)"></script>', inline, html)
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(html)
print(f"{out}  ({out.stat().st_size / 1024:.0f} KB)")
