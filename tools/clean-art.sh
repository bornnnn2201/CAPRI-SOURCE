#!/usr/bin/env bash
# Cleans her art from the show (built by build-cutins.py and build-intro.py) to flat cel colours:
# upscaled, every pixel snapped to the picture's own 32 colours (no dither: the GIF's dither and the
# video's compression mush go, her colours stay hers), then brought down for clean edges.
#   cut-ins  720x480  (twice what fx.js draws them at)
#   faces    256x256
#   intro    2090x1176 (1.25x the layout fx.js GRAB uses: sharp on a full screen), its cut-out kept
#
#   bash tools/clean-art.sh            (needs ffmpeg with libwebp on the PATH, or FFMPEG=...)
# Run it on the pictures as build-*.py wrote them, once: it works from what's in assets/capri.
set -euo pipefail
FF="${FFMPEG:-ffmpeg}"
ART="$(cd "$(dirname "$0")/.." && pwd)/assets/capri"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

palette() { "$FF" -y -loglevel error -i "$1" -vf "format=rgba,palettegen=max_colors=32:stats_mode=full:reserve_transparent=${2:-0}" "$TMP/pal.png"; }

for f in "$ART"/cutin-*.png "$ART"/face-*.png "$ART"/capri-face.png; do
  size=$([[ $(basename "$f") == cutin-* ]] && echo 720:480 || echo 256:256)
  palette "$f"
  "$FF" -y -loglevel error -i "$f" -i "$TMP/pal.png" -filter_complex \
    "[0]scale=iw*4:ih*4:flags=lanczos[u];[u][1]paletteuse=dither=none,scale=$size:flags=area,format=rgb24" "$TMP/out.png"
  mv "$TMP/out.png" "$f"
done

for f in "$ART"/intro-*.webp; do
  palette "$f" 1
  "$FF" -y -loglevel error -i "$f" -i "$TMP/pal.png" -filter_complex \
    "[0]format=rgba,split[c][al];[c]scale=iw*3:ih*3:flags=lanczos[u];[u][1]paletteuse=dither=none:alpha_threshold=1,scale=2090:1176:flags=area,format=rgba[snap];[al]alphaextract,scale=2090:1176:flags=lanczos[a];[snap][a]alphamerge,format=rgba" \
    -c:v libwebp -lossless 1 -compression_level 6 -pix_fmt bgra "$TMP/out.webp"
  mv "$TMP/out.webp" "$f"
done
echo "cleaned: $(ls "$ART"/cutin-*.png "$ART"/face-*.png "$ART"/capri-face.png "$ART"/intro-*.webp | wc -l) pictures"
