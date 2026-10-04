#!/usr/bin/env python3
"""Export the 'Songjeong-dong cafe' photo for the site from a sharper source.

usage:
  python tools/ikki/make_cafe.py --src tools/ikki/input/cafe_2x.png --out wethru/interior/ikki-archive/assets

Finds the same framing as ref/cafe_ref.jpg inside --src (so the baked-in
"PLANT DESIGN | ..." banner at the top is left out), then writes
  cafe_tree.webp     1080 px wide  (phones)
  cafe_tree@2x.webp  2160 px wide  (only if the source has the pixels for it)
The site picks between them with srcset.

needs: pip install numpy opencv-python pillow
"""
import argparse
import os

import cv2
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
REF = os.path.join(HERE, "ref", "cafe_ref.jpg")   # 1080 x 1225 = original rows 125..1350


def align(src_gray, ref_gray):
    h, w = ref_gray.shape
    x0, y0 = int(w * 0.1), int(h * 0.1)
    tpl = ref_gray[y0:int(h * 0.9), x0:int(w * 0.9)]
    base = w / src_gray.shape[1]
    best = None
    for f in list(np.linspace(0.8, 1.25, 46)):
        r = base * f
        small = cv2.resize(src_gray, None, fx=r, fy=r, interpolation=cv2.INTER_AREA)
        if small.shape[0] < tpl.shape[0] or small.shape[1] < tpl.shape[1]:
            continue
        res = cv2.matchTemplate(small, tpl, cv2.TM_CCOEFF_NORMED)
        _, mv, _, ml = cv2.minMaxLoc(res)
        if best is None or mv > best[0]:
            best = (mv, f, r, ml)
    f0 = best[1]
    for f in np.linspace(f0 - 0.01, f0 + 0.01, 21):
        r = base * f
        small = cv2.resize(src_gray, None, fx=r, fy=r, interpolation=cv2.INTER_AREA)
        res = cv2.matchTemplate(small, tpl, cv2.TM_CCOEFF_NORMED)
        _, mv, _, ml = cv2.minMaxLoc(res)
        if mv > best[0]:
            best = (mv, f, r, ml)
    score, _, r, (lx, ly) = best
    return 1.0 / r, ((lx - x0) / r, (ly - y0) / r), score


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--quality", type=int, default=82)
    args = ap.parse_args()

    im = Image.open(args.src).convert("RGB")
    ref = np.asarray(Image.open(REF).convert("L"))
    S, (Tx, Ty), score = align(np.asarray(im.convert("L")), ref)
    print(f"aligned: scale {S:.4f}, offset ({Tx:.1f}, {Ty:.1f}), match {score:.3f}")
    if score < 0.6:
        raise SystemExit("The source does not look like the reference photo (match < 0.6). Check --src.")
    rh, rw = ref.shape
    box = [Tx, Ty, Tx + rw * S, Ty + rh * S]
    box = [max(0, round(box[0])), max(0, round(box[1])), min(im.width, round(box[2])), min(im.height, round(box[3]))]
    crop = im.crop(box)
    print("crop", box, crop.size)
    os.makedirs(args.out, exist_ok=True)
    for name, width in (("cafe_tree.webp", 1080), ("cafe_tree@2x.webp", 2160)):
        if crop.width < width * 0.95 and width > 1080:
            print("skip", name, "(source too small)")
            continue
        out = crop.resize((width, round(crop.height * width / crop.width)), Image.LANCZOS) if crop.width != width else crop
        path = os.path.join(args.out, name)
        out.save(path, "WEBP", quality=args.quality, method=6)
        print(name, out.size, os.path.getsize(path) // 1024, "KB")


if __name__ == "__main__":
    main()
