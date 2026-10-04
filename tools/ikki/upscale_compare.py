#!/usr/bin/env python3
"""Create exact 2x candidates and native-pixel comparisons; never select automatically.

python tools/ikki/upscale_compare.py --exe tools/ikki/bin/realesrgan-ncnn-vulkan.exe
Candidates and 100% crop boards go in compare/. Copy the visually preferred
candidate for each photo to input/{hang,cafe}_2x.png before running the exporters.
"""
import argparse
import json
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from make_hang_layers import align

HERE = Path(__file__).resolve().parent
# Reference-pixel coordinates. Cafe reference starts at original row 125.
CROPS = {
    "hang": [("conifer-leaves", (295, 160, 515, 380)),
             ("red-strands", (205, 650, 425, 870))],
    "cafe": [("tree-leaves", (545, 365, 765, 585)),
             ("white-flowers", (620, 855, 840, 1075))],
}


def comparison(original, esrgan, lanczos, box, title, path):
    """All panels use 1 image pixel per output pixel; original is centered."""
    original_crop = original.crop(box)
    box2 = tuple(v * 2 for v in box)
    panels = [original_crop, esrgan.crop(box2), lanczos.crop(box2)]
    w, h = panels[1].size
    board = Image.new("RGB", (3 * (w + 24), h + 90), "#202020")
    draw = ImageDraw.Draw(board)
    labels = ["Original / 100%", "Real-ESRGAN x4 -> 2x / 100%",
              "Lanczos 2x + mild unsharp / 100%"]
    for i, (panel, label) in enumerate(zip(panels, labels)):
        x = i * (w + 24) + 12
        draw.text((x, 12), label, fill="white")
        board.paste(panel, (x + (w - panel.width) // 2,
                           38 + (h - panel.height) // 2))
    draw.text((12, h + 54), f"{title}; original box {box}; native pixels, no display resampling", fill="white")
    board.save(path)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--exe", type=Path, required=True)
    args = ap.parse_args()
    exe = args.exe.resolve()
    out = HERE / "compare"
    out.mkdir(exist_ok=True)
    manifest = {}
    for name in ("hang", "cafe"):
        source = HERE / "input" / f"{name}_original.jpg"
        original = Image.open(source).convert("RGB")
        x4path = HERE / "input" / f"{name}_x4.png"
        print(f"{name}: Real-ESRGAN x4plus {original.size}", flush=True)
        with (out / f"{name}_esrgan.log").open("w") as log:
            subprocess.run([str(exe), "-i", str(source), "-o", str(x4path),
                            "-n", "realesrgan-x4plus", "-s", "4", "-t", "64",
                            "-m", str(exe.parent / "models"), "-f", "png"],
                           cwd=exe.parent, stdout=log, stderr=log, check=True)
        if "failed" in (out / f"{name}_esrgan.log").read_text().lower():
            raise RuntimeError(f"Vulkan failure: see compare/{name}_esrgan.log")
        size = (original.width * 2, original.height * 2)
        with Image.open(x4path) as x4:
            if x4.size != (original.width * 4, original.height * 4):
                raise ValueError(f"Unexpected x4 size: {x4.size}")
            esrgan = x4.convert("RGB").resize(size, Image.Resampling.LANCZOS)
        lanczos = original.resize(size, Image.Resampling.LANCZOS).filter(
            ImageFilter.UnsharpMask(radius=0.8, percent=45, threshold=3))
        esrgan.save(out / f"{name}_esrgan_2x.png")
        lanczos.save(out / f"{name}_lanczos_2x.png")
        ref = np.asarray(Image.open(HERE / "ref" / f"{name}_ref.jpg").convert("L"))
        scale, (tx, ty), score = align(np.asarray(original.convert("L")), ref)
        if score < 0.95:
            raise ValueError(f"Crop alignment failed: {name} {score}")
        boxes = {}
        for label, rect in CROPS[name]:
            box = tuple(round(v * scale + (tx if i % 2 == 0 else ty)) for i, v in enumerate(rect))
            comparison(original, esrgan, lanczos, box, f"{name}: {label}",
                       out / f"{name}_{label}_100pct.png")
            boxes[label] = box
        manifest[name] = {"source": str(source), "original_size": original.size,
                          "candidate_size": size, "crop_alignment": score,
                          "crop_boxes": boxes,
                          "unsharp": {"radius": 0.8, "percent": 45, "threshold": 3}}
        print(f"{name}: wrote {size} candidates and 100% crops", flush=True)
    (out / "upscale_manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
