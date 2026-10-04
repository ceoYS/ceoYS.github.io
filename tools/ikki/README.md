# ikki archive 사진 고해상도 작업 도구

사이트(`wethru/interior/ikki-archive/`)의 주요 사진 2장을 더 선명하게 바꾸는 도구입니다.

| 사진 | 사이트에서 쓰는 곳 | 지금 상태 |
|---|---|---|
| 행잉 작품 | 첫 화면, 스크롤하면 4개 층으로 조립됨 | 인스타 원본 1440×1781, 2배 처리 후 조립 캔버스 1460×1876 |
| 송정동 대형 카페 나무 | 두 번째 큰 사진 | 1080px / 2160px WebP를 srcset으로 제공 |

## 순서

1. **원본 받기** (로그인 없이 공개 게시물의 원본 해상도 이미지)
   ```
   python tools/ikki/ig_get.py <게시물 URL> tools/ikki/input/hang
   ```
   카페 사진 원본은 이미 `input/cafe_original.jpg`에 있습니다(1080×1350).
   필요: `pip install playwright` → `python -m playwright install chromium`

2. **2배 업스케일**: 결과를 `input/hang_2x.png`, `input/cafe_2x.png`로 저장합니다.
   - 기본: Real-ESRGAN ncnn-vulkan(`realesrgan-x4plus`)으로 4배 → Lanczos로 2배까지 줄이기
   - 비교용: Lanczos 2배 + 약한 언샤프
   - 둘을 100% 크롭으로 비교해 더 자연스러운 쪽을 고릅니다. 침엽 잎, 이끼 결이 유화처럼 뭉개지거나 없던 무늬가 생기면 탈락입니다.
   - Windows 빌드를 `bin/`에 푼 뒤 비교 후보와 100% 크롭을 한 번에 생성할 수 있습니다.
     ```
     python tools/ikki/upscale_compare.py --exe tools/ikki/bin/realesrgan-ncnn-vulkan.exe
     ```
   - 결과는 `compare/{hang,cafe}_{esrgan,lanczos}_2x.png`입니다. 육안으로 고른 파일을 `input/{hang,cafe}_2x.png`로 복사합니다. 비교판의 원본은 확대하지 않은 100%, 두 후보도 100%입니다.
   - Intel Arc에서 타일 256은 Vulkan 오류가 발생해 64를 사용합니다. 로그에 `failed`가 있으면 후보 생성을 중단합니다.

3. **사이트용 파일 만들기**
   ```
   python tools/ikki/make_hang_layers.py --src tools/ikki/input/hang_2x.png --out wethru/interior/ikki-archive/assets --max-height 1876
   python tools/ikki/make_cafe.py        --src tools/ikki/input/cafe_2x.png --out wethru/interior/ikki-archive/assets
   ```
   - 두 스크립트 모두 `ref/`의 기준 사진과 자동으로 맞춰서, 해상도나 여백이 달라도 같은 구도로 잘라냅니다. 일치도(match)가 0.6 미만이면 멈춥니다.
   - `make_hang_layers.py`는 `tools/ikki/out/hang_preview.jpg`(조립 확인용)와 `hang_layout.json`(위치값)을 남깁니다.
   - 배경 분리가 마음에 안 들면 다른 도구(rembg, BiRefNet 등)로 만든 매트(흰색 = 작품)를 `--alpha matte.png`로 넘길 수 있습니다.
     ```
     pip install "rembg[cpu]"
     python tools/ikki/make_hang_matte.py --src tools/ikki/input/hang_2x.png --out tools/ikki/out/hang_birefnet.png
     python tools/ikki/make_hang_layers.py --src tools/ikki/input/hang_2x.png --alpha tools/ikki/out/hang_birefnet.png --out wethru/interior/ikki-archive/assets --max-height 1876
     ```
   - 모델은 Git에서 제외된 `bin/models/`에 저장합니다. 매트는 투명도만 정하며 사진 픽셀을 생성하지 않습니다. 전체 밝기·색감 보정은 하지 않습니다.

4. **index.html 반영** (CONFIG 안의 아래 값만)
   - `CONFIG.hero.piece.layers`의 x / y / w, `CONFIG.hero.piece.tip` ← `out/hang_layout.json`
   - `CONFIG.chapter.src2x` ← `"assets/cafe_tree@2x.webp"`
   - `CONFIG.chapter.w`, `h` ← 출력된 1x WebP 크기

필요 패키지: `pip install numpy opencv-python pillow playwright`

## 2026-10-04 적용 결과

- 행잉 원본: https://www.instagram.com/p/DDzKkebPn4x/ 에서 받은 1440×1781 JPEG. `input/hang_original.jpg`에 보관합니다.
- 두 사진 모두 Lanczos 2배 + 약한 언샤프(radius 0.8, percent 45, threshold 3)를 선택했습니다. Real-ESRGAN x4plus 4배 → Lanczos 2배 후보는 침엽 잎·붉은 줄기·나뭇잎·흰 꽃의 질감이 매끈하게 뭉치거나 유화처럼 단순화되어 제외했습니다.
- 행잉은 BiRefNet 매트가 기본 매트보다 아래 잎 사이의 커튼 잔여물을 잘 제거해 채택했습니다. 정렬 match: 행잉 0.996, 카페 0.999.
- 행잉 조립 캔버스는 1460×1876, 카페 WebP는 1080×1224 / 2160×2448입니다. 카페의 1px 높이 차이는 기준 사진 자동 정렬 결과입니다. 하단 `ikki archive` 워터마크는 그대로입니다.
- `compare/hang_conifer-leaves_100pct.png`, `compare/hang_red-strands_100pct.png`, `compare/cafe_tree-leaves_100pct.png`, `compare/cafe_white-flowers_100pct.png`에서 원본과 두 후보를 비교할 수 있습니다. `compare/`, `out/`, 2배 PNG, 바이너리와 모델은 Git에서 제외됩니다.
