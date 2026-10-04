#!/usr/bin/env python3
"""Download the original-resolution images of a public Instagram post.

usage:
  python tools/ikki/ig_get.py <post-url> <out-prefix>
  e.g. python tools/ikki/ig_get.py https://www.instagram.com/p/DWEDUs2k0P_/ tools/ikki/input/cafe
       -> tools/ikki/input/cafe_01.jpg, cafe_02.jpg, ...  (one file per carousel slide)

needs: pip install playwright && python -m playwright install chromium
No login. Reads the image list Instagram embeds in the logged-out post page and
takes the first (largest, uncropped) candidate of every slide.
"""
import json
import re
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/130.0 Safari/537.36")


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    url, prefix = sys.argv[1], sys.argv[2]
    Path(prefix).parent.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel="chromium")   # full Chromium; the headless shell gets an empty page
        page = browser.new_page(locale="ko-KR", user_agent=UA)
        page.goto(url, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(4000)
        blob = page.evaluate("""() => [...document.querySelectorAll('script')]
            .map(s => s.textContent).find(t => t.includes('image_versions2')) || ''""")
        urls = []
        for m in re.finditer(r'"image_versions2":\{"candidates":\[\{"url":"([^"]+)"', blob):
            u = json.loads('"' + m.group(1) + '"')
            if u not in urls:
                urls.append(u)
        if not urls:
            browser.close()
            sys.exit("No images found. The page may need a login: open the post in a normal browser, "
                     "save the image, and pass that file to the next step instead.")
        for i, u in enumerate(urls, 1):
            res = page.request.get(u)
            out = f"{prefix}_{i:02d}.jpg"
            Path(out).write_bytes(res.body())
            print(out, res.status, len(res.body()), "bytes")
        browser.close()


if __name__ == "__main__":
    main()
