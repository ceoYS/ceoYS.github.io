# ikki archive 사진 고해상도 작업 도구

사이트(`wethru/interior/ikki-archive/`)의 주요 사진 2장을 더 선명하게 바꾸는 도구입니다.

| 사진 | 사이트에서 쓰는 곳 | 지금 상태 |
|---|---|---|
| 행잉 작품 | 첫 화면, 스크롤하면 4개 층으로 조립됨 | 폰 캡처(가로 810px)에서 잘라냄 |
| 송정동 대형 카페 나무 | 두 번째 큰 사진 | 1080px, 2배 버전 없음 |

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

3. **사이트용 파일 만들기**
   ```
   python tools/ikki/make_hang_layers.py --src tools/ikki/input/hang_2x.png --out wethru/interior/ikki-archive/assets
   python tools/ikki/make_cafe.py        --src tools/ikki/input/cafe_2x.png --out wethru/interior/ikki-archive/assets
   ```
   - 두 스크립트 모두 `ref/`의 기준 사진과 자동으로 맞춰서, 해상도나 여백이 달라도 같은 구도로 잘라냅니다. 일치도(match)가 0.6 미만이면 멈춥니다.
   - `make_hang_layers.py`는 `tools/ikki/out/hang_preview.jpg`(조립 확인용)와 `hang_layout.json`(위치값)을 남깁니다.
   - 배경 분리가 마음에 안 들면 다른 도구(rembg, BiRefNet 등)로 만든 매트(흰색 = 작품)를 `--alpha matte.png`로 넘길 수 있습니다.

4. **index.html 반영** (CONFIG 안의 아래 값만)
   - `CONFIG.hero.piece.layers`의 x / y / w, `CONFIG.hero.piece.tip` ← `out/hang_layout.json`
   - `CONFIG.chapter.src2x` ← `"assets/cafe_tree@2x.webp"`

필요 패키지: `pip install numpy opencv-python pillow playwright`
