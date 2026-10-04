#!/usr/bin/env python3
"""Predict a foreground-only matte; does not generate or recolour photo pixels.

Optional dependency: pip install "rembg[cpu]"
python tools/ikki/make_hang_matte.py --src tools/ikki/input/hang_2x.png --out tools/ikki/out/hang_birefnet.png
"""
import argparse
import os
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--src", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    os.environ.setdefault("U2NET_HOME", str(HERE / "bin" / "models"))
    os.environ.setdefault("OMP_NUM_THREADS", "8")
    from rembg import new_session, remove

    session = new_session("birefnet-general", providers=["CPUExecutionProvider"])
    src = Image.open(args.src).convert("RGB")
    matte = remove(src, session=session, only_mask=True)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    matte.save(args.out)
    print(f"Saved {args.out}: {matte.size}, white = foreground")


if __name__ == "__main__":
    main()
