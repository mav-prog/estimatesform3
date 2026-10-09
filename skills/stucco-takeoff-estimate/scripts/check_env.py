#!/usr/bin/env python3
"""Check that the takeoff scripts can run here: Python version, the four packages, and a
tiny end-to-end geometry test. Run this first on a new machine.

    python3 check_env.py

If a package is missing it prints the install command. On a Mac whose system Python
refuses pip installs ("externally managed environment"), use a virtual environment:

    python3 -m venv ~/.venvs/stucco && source ~/.venvs/stucco/bin/activate
    pip install -r requirements.txt
"""
import importlib
import sys

NEEDED = [("pymupdf", "pymupdf"), ("shapely", "shapely"), ("reportlab", "reportlab"), ("PIL", "Pillow")]


def main():
    ok = True
    print(f"python {sys.version.split()[0]} at {sys.executable}")
    if sys.version_info < (3, 10):
        print("  needs Python 3.10 or newer")
        ok = False
    missing = []
    for module, package in NEEDED:
        try:
            m = importlib.import_module(module)
            print(f"  ok  {package} {getattr(m, '__version__', getattr(m, 'VersionBind', ''))}")
        except ImportError:
            print(f"  MISSING {package}")
            missing.append(package)
    if missing:
        print(f"\ninstall with:  {sys.executable} -m pip install {' '.join(missing)}")
        print("or everything:  pip install -r requirements.txt   (from the scripts folder)")
        return 1
    # a small geometry check: two squares sharing an edge polygonize into two faces
    from takeoff_common import polygonize_segments
    segs = [(0, 0, 10, 0), (10, 0, 10, 10), (10, 10, 0, 10), (0, 10, 0, 0), (10, 0, 20, 0), (20, 0, 20, 10), (20, 10, 10, 10)]
    faces = polygonize_segments(segs)
    if len(faces) == 2 and abs(sum(f.area for f in faces) - 200) < 1e-6:
        print("  ok  geometry (shapely/GEOS noding and polygonize)")
    else:
        print(f"  geometry check failed: {len(faces)} faces, area {sum(f.area for f in faces)}")
        ok = False
    print("\nready" if ok else "\nnot ready")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
