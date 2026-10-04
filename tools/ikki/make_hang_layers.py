#!/usr/bin/env python3
"""Rebuild the hanging-piece hero layers from a sharper source photo.

usage:
  python tools/ikki/make_hang_layers.py --src tools/ikki/input/hang_2x.png \
         --out wethru/interior/ikki-archive/assets [--alpha my_matte.png] [--max-height 1600]

What it does
  1. Finds the same photo inside --src (template match against ref/hang_ref.jpg), so any
     resolution or slightly different framing works: Instagram original, an upscaled copy, a screenshot.
  2. Cuts the piece away from the white curtain (or uses --alpha: an 8-bit matte, white = piece,
     e.g. from rembg/BiRefNet) and removes the curtain that shows through gaps.
  3. Un-mixes the white curtain from edge pixels so the piece sits cleanly on the dark stage.
  4. Splits it into the four layers the site animates (cone, middle, ring, strands) along the same
     wavy, feathered seams, so the layers still land seamlessly.
  5. Writes hang_cone/middle/ring/strands.webp and hang_all.webp to --out, and
     hang_layout.json + hang_preview.jpg (re-assembled check image) to --report (default tools/ikki/out).

needs: pip install numpy opencv-python pillow
After running, copy the x/y/w values (and tip) from hang_layout.json into CONFIG.hero.piece in index.html.
"""
import argparse
import json
import os

import cv2
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
REF = os.path.join(HERE, "ref", "hang_ref.jpg")          # 810 x 962: the photo area of the original screenshot

# Geometry below is in reference pixels (810 x 962). It is mapped onto the new source.
CROP = (30, 24, 760, 962)                                # stage box the site positions layers against
CUT_PTS = [
    [(0, 270), (300, 270), (330, 296), (480, 296), (505, 270), (810, 270)],
    [(0, 478), (280, 478), (330, 548), (480, 552), (560, 540), (810, 536)],
    [(0, 708), (810, 708)],
]
CUT_PHASE = [0.0, 1.1, 2.3]
NAMES = ["cone", "middle", "ring", "strands"]


def odd(n):
    n = max(1, int(round(n)))
    return n if n % 2 else n + 1


def align(src_gray, ref_gray):
    """Return S, (Tx, Ty), score so that ref point p maps to src point p*S + T."""
    h, w = ref_gray.shape
    x0, y0 = int(w * 0.12), int(h * 0.12)
    tpl = ref_gray[y0:int(h * 0.88), x0:int(w * 0.88)]
    base = w / src_gray.shape[1]

    def search(factors):
        best = None
        for f in factors:
            r = base * f
            small = cv2.resize(src_gray, None, fx=r, fy=r, interpolation=cv2.INTER_AREA)
            if small.shape[0] < tpl.shape[0] or small.shape[1] < tpl.shape[1]:
                continue
            res = cv2.matchTemplate(small, tpl, cv2.TM_CCOEFF_NORMED)
            _, mv, _, ml = cv2.minMaxLoc(res)
            if best is None or mv > best[0]:
                best = (mv, f, r, ml)
        return best

    best = search(np.linspace(0.7, 1.4, 71))
    best = search(np.linspace(best[1] - 0.012, best[1] + 0.012, 25)) or best
    score, _, r, (lx, ly) = best
    return 1.0 / r, ((lx - x0) / r, (ly - y0) / r), score


def heuristic_matte(a, S, M):
    """The matte used for the current site, with every size scaled by S. M maps ref->src coords."""
    H, W, _ = a.shape
    L = a.mean(axis=2)
    Sat = a.max(axis=2) - a.min(axis=2)
    obj0 = (Sat > 38) | (L < 150)
    bgL = L.copy()
    bgL[obj0] = np.nan
    xs = np.arange(W)
    for y in range(H):
        row = bgL[y]
        m = ~np.isnan(row)
        bgL[y] = np.interp(xs, np.where(m)[0], row[m]) if m.sum() > 10 else (bgL[y - 1] if y else 230)
    bgL = cv2.GaussianBlur(bgL.astype(np.float32), (0, 0), 25 * S)
    d = np.clip(bgL - L, 0, None)
    alpha = np.clip(np.maximum(d / 55.0, (Sat - 14) / 45.0), 0, 1).astype(np.float32)
    alpha = cv2.GaussianBlur(alpha, (0, 0), max(0.3, 0.6 * S))
    alpha = keep_components(alpha, 0.35, 60 * S * S, dilate=5 * S)

    # rod strip at the very top, then keep only parts around the sculpture
    top = int(M(0, 24)[1])
    alpha[:max(0, top)] = 0
    core = (alpha > 0.45).astype(np.uint8)
    n, lab, st, cen = cv2.connectedComponentsWithStats(core, 8)
    (bx0, by0), (bx1, by1) = M(150, 40), M(700, 940)
    keep = np.zeros_like(core)
    for i in range(1, n):
        if st[i, cv2.CC_STAT_AREA] < 25 * S * S:
            continue
        cx, cy = cen[i]
        if bx0 < cx < bx1 and by0 < cy < by1:
            keep[lab == i] = 1
    zone = cv2.dilate(keep, np.ones((odd(15 * S),) * 2, np.uint8))
    alpha = alpha * zone
    solid = cv2.morphologyEx((alpha > 0.4).astype(np.uint8), cv2.MORPH_CLOSE, np.ones((odd(9 * S),) * 2, np.uint8))
    ff = solid.copy()
    cv2.floodFill(ff, np.zeros((H + 2, W + 2), np.uint8), (0, 0), 1)
    solid = np.clip(solid + (ff == 0).astype(np.uint8), 0, 1)
    interior = cv2.erode(solid, np.ones((odd(7 * S),) * 2, np.uint8)).astype(np.float32)
    alpha = np.clip(np.maximum(alpha, cv2.GaussianBlur(interior, (0, 0), 1.5 * S)), 0, 1)

    # floor below the piece
    yy, xx = np.mgrid[0:H, 0:W]
    alpha[(yy > M(0, 850)[1]) & (Sat < 28)] = 0
    alpha[(yy > M(0, 855)[1]) & (xx < M(215, 0)[0])] = 0
    low = ((alpha > 0.3) & (yy > M(0, 700)[1])).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(low, 8)
    for i in range(1, n):
        if st[i, cv2.CC_STAT_AREA] < 40 * S * S:
            alpha[lab == i] = 0
    return alpha


def keep_components(alpha, thr, min_area, dilate):
    b = (alpha > thr).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(b, 8)
    keep = np.zeros_like(b)
    for i in range(1, n):
        if st[i, cv2.CC_STAT_AREA] >= min_area:
            keep[lab == i] = 1
    keep = cv2.dilate(keep, np.ones((odd(dilate),) * 2, np.uint8)).astype(np.float32)
    return alpha * keep


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--alpha", help="optional 8-bit matte for --src (white = piece)")
    ap.add_argument("--max-height", type=int, default=1600, help="height of the stage box in the output")
    ap.add_argument("--report", default=os.path.join(HERE, "out"), help="where hang_layout.json and hang_preview.jpg go")
    args = ap.parse_args()

    src = np.asarray(Image.open(args.src).convert("RGB")).astype(np.float32)
    ref = np.asarray(Image.open(REF).convert("L"))
    H, W, _ = src.shape
    S, (Tx, Ty), score = align(cv2.cvtColor(src.astype(np.uint8), cv2.COLOR_RGB2GRAY), ref)
    print(f"aligned: scale {S:.4f}, offset ({Tx:.1f}, {Ty:.1f}), match {score:.3f}")
    if score < 0.6:
        raise SystemExit("The source does not look like the reference photo (match < 0.6). Check --src.")
    M = lambda x, y: (x * S + Tx, y * S + Ty)

    if args.alpha:
        alpha = np.asarray(Image.open(args.alpha).convert("L").resize((W, H), Image.LANCZOS)).astype(np.float32) / 255
    else:
        alpha = heuristic_matte(src, S, M)

    # un-mix the white curtain from edge colours
    small = max(1, int(max(H, W) / 1000))
    obj = cv2.dilate((alpha > 0.02).astype(np.uint8) * 255, np.ones((odd(7 * S),) * 2, np.uint8))
    s8 = src.astype(np.uint8)
    bg = cv2.inpaint(cv2.resize(s8, (W // small, H // small)), cv2.resize(obj, (W // small, H // small)), 7, cv2.INPAINT_TELEA)
    bg = cv2.GaussianBlur(cv2.resize(bg, (W, H)).astype(np.float32), (0, 0), 6 * S)
    al = np.clip((alpha - 0.08) / 0.92, 0, 1) ** 1.25
    fg = np.clip((src - (1 - alpha[..., None]) * bg) / np.maximum(alpha, 0.06)[..., None], 0, 255)
    fg = np.where(alpha[..., None] > 0.97, src, fg)
    # Preserve source colours; only un-mix the curtain at translucent edges.

    # curtain seen through gaps inside the sculpture
    mn = src.min(axis=2)
    sat = src.max(axis=2) - mn
    curtain = ((mn > 150) & (sat < 24)).astype(np.float32)
    curtain = cv2.morphologyEx(curtain, cv2.MORPH_OPEN, np.ones((odd(3 * S),) * 2, np.uint8))
    curtain = cv2.dilate(curtain, np.ones((odd(3 * S),) * 2, np.uint8))
    curtain = cv2.GaussianBlur(curtain, (0, 0), 1.2 * S)
    al = al * (1 - np.clip(curtain * 1.15, 0, 1))
    al = keep_components(al, 0.35, 60 * S * S, dilate=5 * S)
    al = np.clip(cv2.GaussianBlur(al, (0, 0), 0.5) if S > 1.5 else al, 0, 1)

    # seams, mapped from reference coords
    xs = np.arange(W, dtype=np.float32)
    xr = (xs - Tx) / S
    cuts = []
    for pts, ph in zip(CUT_PTS, CUT_PHASE):
        px, py = zip(*pts)
        yr = np.interp(xr, px, py) + 9 * np.sin(xr / 23 + ph) + 5 * np.sin(xr / 9.3 + 1.7 * ph)
        cuts.append((yr * S + Ty).astype(np.float32))
    Y = np.arange(H, dtype=np.float32)[:, None]
    bw = lambda c: np.clip((c[None, :] + 16 * S - Y) / (8 * S), 0, 1)     # lower-z layer fades out below the seam
    tw = lambda c: np.clip((Y - (c[None, :] - 12 * S)) / (12 * S), 0, 1)  # higher-z layer fades in above the seam
    weights = [bw(cuts[0]), tw(cuts[0]) * bw(cuts[1]), tw(cuts[1]) * bw(cuts[2]), tw(cuts[2])]

    (cx0, cy0), (cx1, cy1) = M(*CROP[:2]), M(*CROP[2:])
    cx0, cy0, cx1, cy1 = [int(round(v)) for v in (cx0, cy0, cx1, cy1)]
    cx0, cy0, cx1, cy1 = max(0, cx0), max(0, cy0), min(W, cx1), min(H, cy1)
    SW, SH = cx1 - cx0, cy1 - cy0
    q = min(1.0, args.max_height / SH)
    os.makedirs(args.out, exist_ok=True)

    def save(rgba, name):
        im = Image.fromarray(rgba, "RGBA")
        if q < 1:
            im = im.resize((max(1, round(im.width * q)), max(1, round(im.height * q))), Image.LANCZOS)
        im.save(os.path.join(args.out, name), "WEBP", quality=86, alpha_quality=92, method=6)
        return im.size

    layout = []
    for name, wgt in zip(NAMES, weights):
        a = al * wgt
        a[:cy0] = 0
        ys, xs_ = np.where(a > 0.02)
        bx0, by0, bx1, by1 = xs_.min(), ys.min(), xs_.max() + 1, ys.max() + 1
        size = save(np.dstack([fg, a * 255]).astype(np.uint8)[by0:by1, bx0:bx1], f"hang_{name}.webp")
        layout.append({"key": name, "src": f"assets/hang_{name}.webp",
                       "x": round((bx0 - cx0) / SW * 100, 2), "y": round((by0 - cy0) / SH * 100, 2),
                       "w": round((bx1 - bx0) / SW * 100, 2), "px": list(size)})
    full = save(np.dstack([fg, al * 255]).astype(np.uint8)[cy0:cy1, cx0:cx1], "hang_all.webp")

    # tip of the cone, for the wire
    a0 = (al * weights[0])[cy0:cy1, cx0:cx1]
    ys, xs_ = np.where(a0 > 0.5)
    tip = {"x": round(float(xs_[ys < ys.min() + 6 * S].mean()) / SW * 100, 2), "y": round(float(ys.min()) / SH * 100, 2)}

    os.makedirs(args.report, exist_ok=True)
    with open(os.path.join(args.report, "hang_layout.json"), "w", encoding="utf-8") as f:
        json.dump({"stage_px": [round(SW * q), round(SH * q)], "ratio": round(SW / SH, 4), "tip": tip, "layers": layout},
                  f, ensure_ascii=False, indent=1)

    # preview: layers re-assembled on the dark stage, plus each layer pulled apart
    stage = np.zeros((SH, SW * 2, 3), np.float32) + np.array([11, 14, 10], np.float32)
    comp = stage[:, :SW]
    for wgt in weights:
        a = (al * wgt)[cy0:cy1, cx0:cx1][..., None]
        comp[:] = fg[cy0:cy1, cx0:cx1] * a + comp * (1 - a)
    for i, wgt in enumerate(weights):
        a = (al * wgt)[cy0:cy1, cx0:cx1][..., None]
        dy = int((3 - i) * 0.035 * SH)
        part = np.zeros_like(comp)
        part[: SH - dy] = (fg[cy0:cy1, cx0:cx1] * a)[dy:]
        pa = np.zeros((SH, SW, 1), np.float32)
        pa[: SH - dy] = a[dy:]
        stage[:, SW:] = part + stage[:, SW:] * (1 - pa)
    prev = Image.fromarray(stage.astype(np.uint8))
    prev.thumbnail((1600, 1600))
    prev.save(os.path.join(args.report, "hang_preview.jpg"), quality=85)

    print(json.dumps({"stage_px": [round(SW * q), round(SH * q)], "tip": tip, "layers": [
        {k: v for k, v in l.items() if k in ("key", "x", "y", "w")} for l in layout]}, ensure_ascii=False))
    print("full cutout", full, "-> paste the x/y/w values into CONFIG.hero.piece.layers")


if __name__ == "__main__":
    main()
